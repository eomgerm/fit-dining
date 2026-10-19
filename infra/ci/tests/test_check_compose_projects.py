import contextlib
import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import check_compose_projects as ccp  # noqa: E402


class ParseManifestTest(unittest.TestCase):
    def test_skips_comments_and_blank_lines_and_splits_args(self):
        text = "# c\n\nedge infra/edge/c.yml --env-file infra/ci/ci.env\napp 'a b.yml' --allow x=1,2\n"
        self.assertEqual(
            ccp.parse_manifest(text),
            [
                ("edge", ["infra/edge/c.yml", "--env-file", "infra/ci/ci.env"]),
                ("app", ["a b.yml", "--allow", "x=1,2"]),
            ],
        )


class MainTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def run_main(self, manifest_text: str) -> int:
        m = self.dir / "projects.txt"
        m.write_text(manifest_text, encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            return ccp.main([str(m)])

    def test_empty_manifest_passes(self):
        self.assertEqual(self.run_main("# nothing\n"), 0)

    @unittest.skipUnless(shutil.which("docker"), "docker CLI 없음")
    def test_bad_project_fails_and_good_project_passes(self):
        bad = self.dir / "bad.yml"
        bad.write_text('services:\n  a:\n    image: x\n    ports: ["8080:80"]\n', encoding="utf-8")
        good = self.dir / "good.yml"
        good.write_text('services:\n  a:\n    image: x\n    ports: ["127.0.0.1:3000:80"]\n', encoding="utf-8")
        self.assertEqual(self.run_main(f"good {good.as_posix()}\n"), 0)
        self.assertEqual(self.run_main(f"good {good.as_posix()}\nbad {bad.as_posix()}\n"), 1)


if __name__ == "__main__":
    unittest.main()
