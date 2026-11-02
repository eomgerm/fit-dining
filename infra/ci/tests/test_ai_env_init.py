"""infra/app/ai-env-init.sh: ai-<환경>.env를 서버에 이미 있는 값에서 만든다. 비밀 값이 출력에 나오면 안 되고 몇 번 돌려도 같아야 한다.

진짜 envset.py와 진짜 ai.env.example을 임시 폴더의 env 파일에 돌린다. DB 작업(ensure-databases.sh)만 기록용 가짜로 바꾼다.
시험 값은 일부러 엔트로피가 낮은 가짜다(비밀 검사기에 걸리지 않게).
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "infra" / "app" / "ai-env-init.sh"
BASH = shutil.which("bash")
PYTHON = sys.executable

GMS_KEY = "testgmskey000000"
MODAL_KEY = "testmodalkey0000"
MODAL_SECRET = "testmodalsecret0000"
MODAL_URL = "https://example-fit-dev--fit-embed.modal.example"


def parse(path):
    out = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        k, _, v = line.partition("=")
        if k and not line.startswith("#"):
            out[k] = v
    return out


@unittest.skipUnless(BASH and PYTHON, "bash와 python이 필요하다")
class AiEnvInitTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.env = base / "etc-fit"
        self.env.mkdir()
        self.ensure_marker = base / "ensure-ran"
        self.ensure = base / "ensure-databases.sh"
        self.ensure.write_text(f"#!/bin/sh\necho ran >> '{self.ensure_marker.as_posix()}'\necho role과 DB가 설계대로다\n", encoding="utf-8", newline="\n")
        self.write("dev.env", f"APP_ENV=dev\nGMS_BASE_URL=https://gms.example/gmsapi\nGMS_API_KEY={GMS_KEY}\nGMS_ENABLED=true\n"
                              f"MODAL_BASE_URL={MODAL_URL}\nMODAL_KEY={MODAL_KEY}\nMODAL_SECRET={MODAL_SECRET}\n")
        self.write("data.env", "POSTGRES_PASSWORD=testpostgrespassword0\n")

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name, text):
        (self.env / name).write_text(text, encoding="utf-8", newline="\n")

    def run_script(self, *args):
        env = dict(os.environ)
        env.update({
            "FIT_AI_INIT_NOROOT": "1",
            "FIT_ENV_DIR": str(self.env),
            "FIT_REPO": str(ROOT),
            "FIT_HOME": self.tmp.name,
            "FIT_ENVSET": str(ROOT / "infra" / "host" / "envset.py"),
            "FIT_PYTHON": PYTHON,
            "FIT_ENSURE_DATABASES": str(self.ensure),
            "PYTHONUTF8": "1",
        })
        res = subprocess.run([BASH, str(SCRIPT), *args], env=env, capture_output=True, text=True, encoding="utf-8")
        return res.returncode, res.stdout + res.stderr

    def assertNoSecrets(self, text):
        data = parse(self.env / "data.env")
        secrets = [GMS_KEY, MODAL_KEY, MODAL_SECRET, data.get("FIT_DEV_AI_PASSWORD", "x" * 40), data.get("FIT_PROD_AI_PASSWORD", "x" * 40)]
        for s in secrets:
            self.assertNotIn(s, text, "비밀 값이 출력에 나왔다")

    def test_init_builds_the_ai_file_from_values_already_on_the_server(self):
        rc, out = self.run_script("dev")
        self.assertEqual(rc, 0, out)
        data = parse(self.env / "data.env")
        for k in ("FIT_DEV_AI_PASSWORD", "FIT_PROD_AI_PASSWORD"):
            self.assertRegex(data[k], r"^[0-9a-f]{32}$", k)
        self.assertNotEqual(data["FIT_DEV_AI_PASSWORD"], data["FIT_PROD_AI_PASSWORD"])
        self.assertTrue(self.ensure_marker.exists(), "ensure-databases.sh를 돌렸다")
        ai = parse(self.env / "ai-dev.env")
        self.assertEqual(ai["APP_ENV"], "dev")
        self.assertEqual(ai["GMS_BASE_URL"], "https://gms.example/gmsapi/api.openai.com/v1", "AI는 공급자 경로까지 있는 주소가 필요하다")
        self.assertEqual(ai["GMS_ENABLED"], "true")
        self.assertEqual(ai["GMS_API_KEY"], GMS_KEY)
        self.assertEqual(ai["EMBED_BASE_URL"], MODAL_URL)
        self.assertEqual(ai["EMBED_KEY"], MODAL_KEY)
        self.assertEqual(ai["EMBED_SECRET"], MODAL_SECRET)
        self.assertEqual(ai["DATABASE_URL"], f"postgresql://fit_dev_ai:{data['FIT_DEV_AI_PASSWORD']}@postgres:5432/fit_dev")
        self.assertNoSecrets(out)

    def test_the_gms_address_is_given_the_provider_path_the_ai_needs_unless_it_already_has_one(self):
        for source, want in (
            ("https://gms.example/gmsapi/", "https://gms.example/gmsapi/api.openai.com/v1"),
            ("https://gms.example/gmsapi/api.openai.com/v1", "https://gms.example/gmsapi/api.openai.com/v1"),
            ("https://gms.example/gmsapi/api.openai.com/v1/chat/completions", "https://gms.example/gmsapi/api.openai.com/v1/chat/completions"),
            ("https://other.example/llm", "https://other.example/llm"),
        ):
            with self.subTest(source=source):
                (self.env / "ai-dev.env").unlink(missing_ok=True)
                lines = [("GMS_BASE_URL=" + source) if l.startswith("GMS_BASE_URL=") else l for l in (self.env / "dev.env").read_text(encoding="utf-8").splitlines()]
                self.write("dev.env", chr(10).join(lines) + chr(10))
                rc, out = self.run_script("dev")
                self.assertEqual(rc, 0, out)
                self.assertEqual(parse(self.env / "ai-dev.env")["GMS_BASE_URL"], want)

    def test_running_again_changes_nothing(self):
        self.run_script("dev")
        before = {n: (self.env / n).read_text(encoding="utf-8") for n in ("data.env", "ai-dev.env", "dev.env")}
        rc, out = self.run_script("dev")
        self.assertEqual(rc, 0, out)
        after = {n: (self.env / n).read_text(encoding="utf-8") for n in before}
        self.assertEqual(before, after)
        self.assertNoSecrets(out)

    def test_existing_values_are_never_overwritten(self):
        self.run_script("dev")
        self.write("ai-dev.env", (self.env / "ai-dev.env").read_text(encoding="utf-8").replace(f"GMS_API_KEY={GMS_KEY}", "GMS_API_KEY=keptbytheoperator0"))
        rc, out = self.run_script("dev")
        self.assertEqual(rc, 0, out)
        self.assertEqual(parse(self.env / "ai-dev.env")["GMS_API_KEY"], "keptbytheoperator0")

    def test_a_missing_source_value_is_reported_by_name_and_fails_after_filling_the_rest(self):
        self.write("dev.env", (self.env / "dev.env").read_text(encoding="utf-8").replace(f"MODAL_SECRET={MODAL_SECRET}\n", ""))
        rc, out = self.run_script("dev")
        self.assertNotEqual(rc, 0)
        self.assertIn("EMBED_SECRET", out)
        ai = parse(self.env / "ai-dev.env")
        self.assertEqual(ai["EMBED_KEY"], MODAL_KEY)
        self.assertIn("REPLACE_ME", ai["EMBED_SECRET"])
        self.assertNoSecrets(out)

    def test_refuses_to_copy_when_be_already_points_at_the_ai_api_and_the_ai_file_has_no_modal_url(self):
        self.write("dev.env", (self.env / "dev.env").read_text(encoding="utf-8").replace(f"MODAL_BASE_URL={MODAL_URL}", "MODAL_BASE_URL=http://ai-dev:8000"))
        rc, out = self.run_script("dev")
        self.assertNotEqual(rc, 0)
        self.assertIn("이미 AI API 주소", out)

    def test_point_be_switches_the_be_to_the_ai_api_and_drops_the_modal_token_from_the_be(self):
        self.run_script("dev")
        rc, out = self.run_script("dev", "point-be")
        self.assertEqual(rc, 0, out)
        app = parse(self.env / "dev.env")
        self.assertEqual(app["MODAL_BASE_URL"], "http://ai-dev:8000")
        self.assertNotIn("MODAL_KEY", app)
        self.assertNotIn("MODAL_SECRET", app)
        ai = parse(self.env / "ai-dev.env")
        self.assertEqual(ai["EMBED_KEY"], MODAL_KEY, "토큰은 AI 쪽에 남아 있다")
        self.assertNoSecrets(out)

    def test_point_be_refuses_when_the_ai_file_would_lose_the_modal_values(self):
        rc, out = self.run_script("dev", "point-be")
        self.assertNotEqual(rc, 0)
        self.assertEqual(parse(self.env / "dev.env")["MODAL_KEY"], MODAL_KEY, "BE의 Modal 값은 그대로다")
        self.run_script("dev")
        self.write("ai-dev.env", (self.env / "ai-dev.env").read_text(encoding="utf-8").replace(f"EMBED_SECRET={MODAL_SECRET}", "EMBED_SECRET=REPLACE_ME"))
        rc, out = self.run_script("dev", "point-be")
        self.assertNotEqual(rc, 0)
        self.assertIn("EMBED_SECRET", out)
        self.assertEqual(parse(self.env / "dev.env")["MODAL_SECRET"], MODAL_SECRET)

    def test_only_dev_and_prod_and_known_actions_are_accepted(self):
        for args in (("staging",), ("dev", "nuke"), ()):
            rc, out = self.run_script(*args)
            self.assertNotEqual(rc, 0, args)


if __name__ == "__main__":
    unittest.main()
