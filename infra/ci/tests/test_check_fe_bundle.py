import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import check_fe_bundle as cfb  # noqa: E402

SHA = "0123456789abcdef0123456789abcdef01234567"


def server_files(sha: str = SHA, unoptimized=True, deployment_id="same") -> str:
    """Next가 standalone에 남기는 required-server-files.json의 필요한 부분."""
    config = {"images": {} if unoptimized is None else {"unoptimized": unoptimized}}
    config["deploymentId"] = sha if deployment_id == "same" else deployment_id
    return json.dumps({"version": 1, "config": config})


def make_bundle(root: Path, sha: str = SHA) -> Path:
    """설계 6.8절의 P0 검사를 모두 통과하는 최소한의 FE 번들(standalone, static, public)을 만든다."""
    files = {
        "standalone/server.js": "const http = require('http');\nhttp.createServer((q, r) => r.end('ok')).listen(3000);\n",
        "standalone/.next/BUILD_ID": sha,
        "standalone/.next/required-server-files.json": server_files(sha),
        "standalone/.next/server/app/page.js": "export default function Page() { return 1 }\n",
        # node_modules 안은 검사하지 않는다(라이브러리 코드에는 localhost URL이 흔하다)
        "standalone/node_modules/next/index.js": "// http://localhost:3000 is fine in third-party code, so is mock\n",
        "static/chunks/app.js": "console.log('hello');\n",
        "public/sw.js": "self.addEventListener('install', () => {});\n",
        "public/manifest.webmanifest": "{}\n",
    }
    for rel, text in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    native = root / "standalone/node_modules/@img/sharp-linux-x64/lib/sharp.node"
    native.parent.mkdir(parents=True, exist_ok=True)
    native.write_bytes(b"\x7fELF\x00\x00")
    return root


def by_name(results, name):
    found = [r for r in results if r[1] == name]
    assert len(found) == 1, f"{name} 검사가 {len(found)}개다: {results}"
    return found[0]


class CheckFeBundleTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = make_bundle(Path(self._tmp.name))

    def tearDown(self):
        self._tmp.cleanup()

    def run_checks(self, sha=SHA):
        return cfb.check_bundle(self.root, sha)

    def assert_only_fails(self, *names):
        results = self.run_checks()
        failed = [r[1] for r in results if r[0] == "FAIL"]
        self.assertEqual(sorted(failed), sorted(names), results)

    def test_good_bundle_passes_every_check(self):
        results = self.run_checks()
        self.assertEqual([r for r in results if r[0] != "PASS"], [], results)
        self.assertEqual(
            {r[1] for r in results},
            {"server.js", "static", "build-id", "deployment-id", "images-unoptimized", "native-modules", "no-local-urls", "mock-words", "pwa-files"},
        )

    def test_missing_server_js_fails(self):
        (self.root / "standalone/server.js").unlink()
        self.assert_only_fails("server.js")

    def test_missing_or_empty_static_fails(self):
        (self.root / "static/chunks/app.js").unlink()
        self.assert_only_fails("static")
        (self.root / "static/chunks").rmdir()
        (self.root / "static").rmdir()
        self.assert_only_fails("static")

    def test_build_id_must_equal_the_commit_sha(self):
        (self.root / "standalone/.next/BUILD_ID").write_text("someother", encoding="utf-8")
        self.assert_only_fails("build-id")
        (self.root / "standalone/.next/BUILD_ID").unlink()
        self.assert_only_fails("build-id")

    def test_build_id_ignores_a_trailing_newline(self):
        (self.root / "standalone/.next/BUILD_ID").write_text(SHA + "\n", encoding="utf-8")
        self.assertEqual(by_name(self.run_checks(), "build-id")[0], "PASS")

    def test_empty_build_id_never_matches_an_empty_sha(self):
        # 빈 값끼리 같다고 통과하면 DEPLOYMENT_VERSION이 비어 빌드된 번들이 그대로 나간다(실제 번들에서 겪었다)
        (self.root / "standalone/.next/BUILD_ID").write_text("", encoding="utf-8")
        results = self.run_checks(sha="")
        self.assertEqual(by_name(results, "build-id")[0], "FAIL")
        self.assertEqual(by_name(results, "deployment-id")[0], "FAIL")

    def test_empty_deployment_id_never_matches_an_empty_sha(self):
        f = self.root / "standalone/.next/required-server-files.json"
        f.write_text(server_files(deployment_id=""), encoding="utf-8")
        self.assertEqual(by_name(self.run_checks(sha=""), "deployment-id")[0], "FAIL")

    def test_deployment_id_must_equal_the_commit_sha(self):
        f = self.root / "standalone/.next/required-server-files.json"
        f.write_text(server_files(deployment_id="other"), encoding="utf-8")
        self.assert_only_fails("deployment-id")
        f.write_text(server_files(deployment_id=None), encoding="utf-8")
        self.assert_only_fails("deployment-id")

    def test_images_must_be_unoptimized(self):
        f = self.root / "standalone/.next/required-server-files.json"
        f.write_text(server_files(unoptimized=False), encoding="utf-8")
        self.assert_only_fails("images-unoptimized")
        f.write_text(server_files(unoptimized=None), encoding="utf-8")
        self.assert_only_fails("images-unoptimized")
        f.write_text("not json", encoding="utf-8")
        self.assert_only_fails("images-unoptimized", "deployment-id")
        f.unlink()
        self.assert_only_fails("images-unoptimized", "deployment-id")

    def test_only_sharp_native_modules_are_allowed(self):
        other = self.root / "standalone/node_modules/some-native/build/x.node"
        other.parent.mkdir(parents=True)
        other.write_bytes(b"\x7fELF\x00")
        results = self.run_checks()
        status, _name, detail = by_name(results, "native-modules")
        self.assertEqual(status, "FAIL")
        self.assertIn("some-native/build/x.node", detail.replace("\\", "/"))
        self.assertNotIn("sharp-linux-x64", detail)
        self.assertEqual([r[1] for r in results if r[0] == "FAIL"], ["native-modules"])

    def test_local_urls_baked_into_the_bundle_fail(self):
        cases = {
            "static/chunks/app.js": "fetch('http://localhost:3000/api')",
            "standalone/server.js": "const base = 'https://127.0.0.1:8080';",
            "standalone/.next/server/app/page.js": "const base = 'HTTP://LOCALHOST/x';",
        }
        for rel, text in cases.items():
            with self.subTest(rel=rel):
                p = self.root / rel
                original = p.read_text(encoding="utf-8")
                p.write_text(original + text, encoding="utf-8")
                status, _n, detail = by_name(self.run_checks(), "no-local-urls")
                self.assertEqual(status, "FAIL")
                self.assertIn(rel, detail.replace("\\", "/"))
                p.write_text(original, encoding="utf-8")

    def test_framework_runtime_mentions_of_localhost_are_not_urls(self):
        # 실제 Next 번들의 런타임에서 나온 모양: 호스트 이름 비교, 템플릿으로 조립하는 주소, URL 파서
        (self.root / "standalone/.next/server/app/page.js").write_text(
            'r.hostname="localhost";\n'
            'new URL(`${a?"https":"http"}://localhost:${process.env.PORT||3e3}`);\n'
            'if("localhost"===s.host&&(s.host=""))return;\n'
            "e9=/^(?:127(?:\\.(?:25[0-5])){3}|\\[::1\\]|localhost)$/;\n",
            encoding="utf-8",
        )
        self.assertEqual(by_name(self.run_checks(), "no-local-urls")[0], "PASS")

    def test_local_urls_inside_node_modules_are_ignored(self):
        # make_bundle이 node_modules/next/index.js에 localhost URL을 넣어 뒀다
        self.assertEqual(by_name(self.run_checks(), "no-local-urls")[0], "PASS")

    def test_binary_files_are_not_scanned(self):
        (self.root / "static/chunks/logo.bin").write_bytes(b"\x00\x01http://localhost mock\x00")
        results = self.run_checks()
        self.assertEqual(by_name(results, "no-local-urls")[0], "PASS")
        self.assertEqual(by_name(results, "mock-words")[0], "PASS")

    def test_mock_words_warn_but_do_not_fail(self):
        # FE 앱 코드에 개발용 mock 스위치(?mock=empty, X-Mock-Scenario)가 들어 있다. 막지는 않고 드러낸다
        (self.root / "static/chunks/app.js").write_text('get("mock");headers={"X-Mock-Scenario":"empty"}', encoding="utf-8")
        results = self.run_checks()
        status, _n, detail = by_name(results, "mock-words")
        self.assertEqual(status, "WARN")
        self.assertIn("static/chunks/app.js", detail.replace("\\", "/"))
        self.assertEqual([r for r in results if r[0] == "FAIL"], [])

    def test_the_detail_never_prints_file_contents(self):
        (self.root / "static/chunks/app.js").write_text("const k = 'http://localhost:3000/secret-token-123';", encoding="utf-8")
        _s, _n, detail = by_name(self.run_checks(), "no-local-urls")
        self.assertNotIn("secret-token-123", detail)

    def test_missing_pwa_files_are_skipped_not_failed(self):
        (self.root / "public/sw.js").unlink()
        results = self.run_checks()
        self.assertEqual(by_name(results, "pwa-files")[0], "SKIP")
        self.assertEqual([r for r in results if r[0] == "FAIL"], [])

    def test_main_exit_codes(self):
        self.assertEqual(cfb.main([str(self.root), "--sha", SHA]), 0)
        (self.root / "standalone/server.js").unlink()
        self.assertEqual(cfb.main([str(self.root), "--sha", SHA]), 1)

    def test_main_rejects_an_empty_sha_with_a_clear_message(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = cfb.main([str(self.root), "--sha", ""])
        self.assertEqual(rc, 1)
        self.assertIn("--sha가 비어 있다", buf.getvalue())

    def test_main_reports_a_missing_bundle_directory(self):
        self.assertEqual(cfb.main([str(self.root / "nope"), "--sha", SHA]), 1)


if __name__ == "__main__":
    unittest.main()
