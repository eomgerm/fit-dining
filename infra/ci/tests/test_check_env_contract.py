import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import check_env_contract as ec  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]

CONTRACT = """\
## 파일 대응

| 그룹 | 예제 파일 | 소비자 |
|---|---|---|
| `app` | `infra/app/app.env.example` | BE |
| `local` | `infra/local/local.env.example` | 로컬 |

## 키 목록

| 키 | 그룹 | 필수 | 설명 |
|---|---|---|---|
| `APP_ENV` | app | O | 환경 |
| `DB_URL` | app, local | O | 연결 |
| `DEBUG_FLAG` | app | X | 선택 |
"""


class Workspace(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, rel: str, text: str) -> None:
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8", newline="\n")

    def issues(self, contract: str = CONTRACT) -> list[tuple[str, str]]:
        return [(i.rule, i.detail) for i in ec.check_contract(contract, self.root)]


class CheckContractTest(Workspace):
    def test_consistent_contract_and_examples_pass(self):
        self.write("infra/app/app.env.example", "APP_ENV=dev\nDB_URL=x\n")
        self.write("infra/local/local.env.example", "DB_URL=y\n")
        self.assertEqual(self.issues(), [])

    def test_optional_key_may_be_absent_or_present(self):
        self.write("infra/app/app.env.example", "APP_ENV=dev\nDB_URL=x\nDEBUG_FLAG=1\n")
        self.write("infra/local/local.env.example", "DB_URL=y\n")
        self.assertEqual(self.issues(), [])

    def test_key_missing_from_contract_is_unknown(self):
        self.write("infra/app/app.env.example", "APP_ENV=dev\nDB_URL=x\nNEW_KEY=1\n")
        self.write("infra/local/local.env.example", "DB_URL=y\n")
        self.assertEqual(self.issues(), [("unknown-key", "NEW_KEY")])

    def test_key_listed_only_for_another_group_is_unknown(self):
        self.write("infra/app/app.env.example", "APP_ENV=dev\nDB_URL=x\n")
        self.write("infra/local/local.env.example", "DB_URL=y\nAPP_ENV=dev\n")
        self.assertEqual(self.issues(), [("unknown-key", "APP_ENV")])

    def test_missing_required_key_is_reported_per_group(self):
        self.write("infra/app/app.env.example", "DEBUG_FLAG=1\n")
        self.write("infra/local/local.env.example", "\n")
        self.assertEqual(
            sorted(self.issues()),
            [("missing-required", "APP_ENV"), ("missing-required", "DB_URL"), ("missing-required", "DB_URL")],
        )

    def test_missing_example_file_is_reported(self):
        self.write("infra/app/app.env.example", "APP_ENV=dev\nDB_URL=x\n")
        self.assertEqual(self.issues(), [("missing-file", "infra/local/local.env.example")])

    def test_group_without_file_mapping_is_reported(self):
        contract = CONTRACT + "| `EXTRA` | ghost | X | 설명 |\n"
        self.write("infra/app/app.env.example", "APP_ENV=dev\nDB_URL=x\n")
        self.write("infra/local/local.env.example", "DB_URL=y\n")
        self.assertEqual(self.issues(contract), [("unknown-group", "ghost")])

    def test_duplicate_row_is_reported(self):
        contract = CONTRACT + "| `APP_ENV` | app | O | 또 |\n"
        self.write("infra/app/app.env.example", "APP_ENV=dev\nDB_URL=x\n")
        self.write("infra/local/local.env.example", "DB_URL=y\n")
        self.assertEqual(self.issues(contract), [("duplicate-row", "APP_ENV/app")])

    def test_bad_required_flag_is_reported(self):
        contract = CONTRACT.replace("| `DEBUG_FLAG` | app | X |", "| `DEBUG_FLAG` | app | maybe |")
        self.write("infra/app/app.env.example", "APP_ENV=dev\nDB_URL=x\n")
        self.write("infra/local/local.env.example", "DB_URL=y\n")
        self.assertEqual(self.issues(contract), [("bad-required-flag", "DEBUG_FLAG")])

    def test_contract_without_keys_is_an_error(self):
        self.assertEqual(self.issues("# 비어 있음\n"), [("empty-contract", "-")])


class MainTest(Workspace):
    def run_main(self, *argv: str) -> tuple[int, str]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = ec.main(list(argv))
        return code, out.getvalue()

    def test_main_ok_and_fail_exit_codes(self):
        self.write("docs/contract.md", CONTRACT)
        self.write("infra/app/app.env.example", "APP_ENV=dev\nDB_URL=x\n")
        self.write("infra/local/local.env.example", "DB_URL=y\n")
        code, out = self.run_main("--contract", str(self.root / "docs/contract.md"), "--root", str(self.root))
        self.assertEqual(code, 0)
        self.assertIn("OK env-contract", out)
        self.write("infra/app/app.env.example", "APP_ENV=dev\n")
        code, out = self.run_main("--contract", str(self.root / "docs/contract.md"), "--root", str(self.root))
        self.assertEqual(code, 1)
        self.assertIn("missing-required DB_URL", out)

    def test_output_never_contains_values(self):
        self.write("docs/contract.md", CONTRACT)
        self.write("infra/app/app.env.example", "APP_ENV=dev\nDB_URL=x\nSTRAY=super-secret-value\n")
        self.write("infra/local/local.env.example", "DB_URL=y\n")
        _, out = self.run_main("--contract", str(self.root / "docs/contract.md"), "--root", str(self.root))
        self.assertIn("unknown-key STRAY", out)
        self.assertNotIn("super-secret-value", out)


class RepositoryContractTest(unittest.TestCase):
    def test_real_contract_matches_real_examples(self):
        text = (ROOT / "docs/infra/contracts/env.md").read_text(encoding="utf-8")
        problems = [str(i) for i in ec.check_contract(text, ROOT, "docs/infra/contracts/env.md")]
        self.assertEqual(problems, [])


if __name__ == "__main__":
    unittest.main()
