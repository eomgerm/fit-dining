import contextlib
import io
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

CI_DIR = Path(__file__).resolve().parents[1]
HOST_DIR = Path(__file__).resolve().parents[2] / "host"
REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(CI_DIR))
sys.path.insert(0, str(HOST_DIR))
import check_env_files as env  # noqa: E402
import envset  # noqa: E402

CONTRACT = """\
| 키 | 그룹 | 필수 | 설명 |
|---|---|---|---|
| `APP_ENV` | app, fe | O | 환경 |
| `JWT_SECRET` | app | O | 비밀 |
| `MODAL_KEY` | app | O | 비밀 |
| `MODAL_BASE_URL` | app | O | 기준 URL |
| `REVIEW_MOCK_ENABLED` | app | X | 스위치 |
| `NODE_ENV` | fe | O | production |
| `NAVER_MAP_CLIENT_ID` | fe | X | 공개 값 |
| `POSTHOG_KEY` | fe | X | 공개 키 |
"""

VALUE_ONE = "first-typed-value-aaaa"
VALUE_TWO = "second-typed-value-bbbb"


class EnvsetCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name) / "fit"
        self.dir.mkdir()
        contract = Path(self.tmp.name) / "env.md"
        contract.write_text(CONTRACT, encoding="utf-8")
        patcher = mock.patch.dict(os.environ, {"FIT_ENV_DIR": str(self.dir), "FIT_ENV_CONTRACT": str(contract)})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.write("prod", "APP_ENV=prod\nJWT_SECRET=REPLACE_ME\nMODAL_KEY=REPLACE_ME\nMODAL_BASE_URL=REPLACE_ME\nOTHER=keep\n")
        self.write("dev", "APP_ENV=dev\nJWT_SECRET=REPLACE_ME\nMODAL_KEY=REPLACE_ME\nMODAL_BASE_URL=REPLACE_ME\nOTHER=keep\n")
        self.write("fe-prod", "APP_ENV=prod\nNODE_ENV=production\n")
        self.write("fe-dev", "APP_ENV=dev\nNODE_ENV=production\n")

    def write(self, name, text):
        p = self.dir / f"{name}.env"
        p.write_text(text, encoding="utf-8", newline="\n")
        if os.name == "posix":
            p.chmod(0o640)

    def read(self, name):
        return (self.dir / f"{name}.env").read_text(encoding="utf-8")

    def run_cli(self, *argv, stdin=""):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), mock.patch("sys.stdin", io.StringIO(stdin)):
            rc = envset.main(list(argv))
        return rc, out.getvalue(), err.getvalue()


class SetTest(EnvsetCase):
    def test_adds_a_new_non_secret_key_to_several_files(self):
        rc, out, err = self.run_cli("set", "fe-prod,fe-dev", "NAVER_MAP_CLIENT_ID=abc123")
        self.assertEqual(rc, 0, out + err)
        for name in ("fe-prod", "fe-dev"):
            self.assertEqual(self.read(name).splitlines()[-1], "NAVER_MAP_CLIENT_ID=abc123")
            self.assertIn("NODE_ENV=production", self.read(name))
        self.assertIn("fe-prod.env: 추가 NAVER_MAP_CLIENT_ID (6자)", out)
        self.assertIn("적용(fe-prod.env)", out)
        self.assertNotIn("abc123", out + err)

    def test_key_missing_from_the_contract_warns_but_is_written(self):
        rc, out, _ = self.run_cli("set", "fe-prod", "NEW_THING=1")
        self.assertEqual(rc, 0)
        self.assertIn("NEW_THING=1", self.read("fe-prod"))
        self.assertIn("WARN  NEW_THING: 계약 표(그룹 fe)에 없다", out)

    def test_without_a_contract_there_is_no_warning(self):
        with mock.patch.object(envset, "load_contract", return_value=None):
            rc, out, _ = self.run_cli("set", "fe-prod", "NEW_THING=1")
        self.assertEqual(rc, 0)
        self.assertNotIn("WARN", out)

    def test_secret_value_on_the_command_line_is_refused(self):
        before = self.read("prod")
        rc, out, err = self.run_cli("set", "prod", f"JWT_SECRET={VALUE_ONE}")
        self.assertEqual(rc, 1)
        self.assertIn("비밀 값은 명령줄에 쓰지 않는다", out)
        self.assertEqual(self.read("prod"), before)
        self.assertNotIn(VALUE_ONE, out + err)

    def test_secret_comes_from_hidden_input_and_is_never_printed(self):
        rc, out, err = self.run_cli("set", "prod", "MODAL_KEY", stdin=VALUE_ONE + "\n")
        self.assertEqual(rc, 0, out + err)
        self.assertIn(f"MODAL_KEY={VALUE_ONE}", self.read("prod"))
        self.assertIn(f"({len(VALUE_ONE)}자)", out)
        self.assertNotIn(VALUE_ONE, out + err)

    def test_empty_hidden_input_skips_the_key(self):
        before = self.read("prod")
        rc, out, _ = self.run_cli("set", "prod", "MODAL_KEY", stdin="\n")
        self.assertEqual(rc, 0)
        self.assertEqual(self.read("prod"), before)
        self.assertIn("건너뜀  MODAL_KEY", out)

    def test_one_input_is_written_to_every_listed_file(self):
        rc, _, _ = self.run_cli("set", "prod,dev", "MODAL_KEY", stdin=VALUE_ONE + "\n")
        self.assertEqual(rc, 0)
        self.assertIn(f"MODAL_KEY={VALUE_ONE}", self.read("prod"))
        self.assertIn(f"MODAL_KEY={VALUE_ONE}", self.read("dev"))

    def test_replacing_a_real_value_asks_first(self):
        self.run_cli("set", "prod", "MODAL_KEY", stdin=VALUE_ONE + "\n")
        rc, out, err = self.run_cli("set", "prod", "MODAL_KEY", stdin=VALUE_TWO + "\nn\n")
        self.assertEqual(rc, 0)
        self.assertIn(f"MODAL_KEY={VALUE_ONE}", self.read("prod"))
        self.assertIn("그대로 둠 MODAL_KEY", out)
        self.assertIn("이미 값이 있다", err)
        rc, out, _ = self.run_cli("set", "prod", "MODAL_KEY", stdin=VALUE_TWO + "\ny\n")
        self.assertIn(f"MODAL_KEY={VALUE_TWO}", self.read("prod"))
        self.assertIn("바꿈 MODAL_KEY", out)
        self.assertNotIn(VALUE_ONE, self.read("prod"))

    def test_yes_flag_replaces_without_asking(self):
        self.run_cli("set", "prod", "MODAL_KEY", stdin=VALUE_ONE + "\n")
        rc, out, err = self.run_cli("set", "prod", "MODAL_KEY", "--yes", stdin=VALUE_TWO + "\n")
        self.assertEqual(rc, 0)
        self.assertIn(f"MODAL_KEY={VALUE_TWO}", self.read("prod"))
        self.assertNotIn("이미 값이 있다", err)

    def test_placeholder_or_empty_existing_value_is_replaced_without_asking(self):
        self.write("fe-prod", "APP_ENV=prod\nNODE_ENV=production\nPOSTHOG_KEY=\nNAVER_MAP_CLIENT_ID=REPLACE_ME\n")
        rc, out, err = self.run_cli("set", "fe-prod", "NAVER_MAP_CLIENT_ID=abc", "POSTHOG_KEY", stdin=VALUE_ONE + "\n")
        self.assertEqual(rc, 0, out + err)
        self.assertNotIn("이미 값이 있다", err)
        self.assertIn("NAVER_MAP_CLIENT_ID=abc", self.read("fe-prod"))

    def test_a_bad_value_writes_nothing_to_any_file(self):
        before = {n: self.read(n) for n in ("prod", "dev")}
        rc, out, _ = self.run_cli("set", "prod,dev", "GOOD_KEY=1", "BAD_KEY=a b")
        self.assertEqual(rc, 1)
        self.assertIn("아무것도 쓰지 않았다", out)
        self.assertEqual({n: self.read(n) for n in ("prod", "dev")}, before)

    def test_forbidden_characters_are_refused_without_echoing_the_value(self):
        for ch in [" ", '"', "'", "#", "$", "`", "\\", "　", "\t"]:
            with self.subTest(ch=repr(ch)):
                rc, out, err = self.run_cli("set", "fe-prod", f"X_VALUE=ab{ch}cd")
                self.assertEqual(rc, 1)
                self.assertNotIn("abcd", out + err)
                self.assertNotIn("X_VALUE", self.read("fe-prod"))

    def test_base_url_loses_its_trailing_slash(self):
        rc, _, _ = self.run_cli("set", "prod", "MODAL_BASE_URL=https://gms.example/gmsapi/")
        self.assertEqual(rc, 0)
        self.assertIn("MODAL_BASE_URL=https://gms.example/gmsapi\n", self.read("prod"))

    def test_base_url_needs_a_scheme_and_a_host(self):
        for bad in ("ftp://x.example", "gms.example/api", "https://", "https:///"):
            with self.subTest(bad=bad):
                rc, _, _ = self.run_cli("set", "prod", f"MODAL_BASE_URL={bad}")
                self.assertEqual(rc, 1)

    def test_placeholder_value_is_refused(self):
        rc, out, _ = self.run_cli("set", "fe-prod", "X_VALUE=REPLACE_ME")
        self.assertEqual(rc, 1)
        self.assertIn("REPLACE_ME", out)

    def test_empty_inline_value_is_refused(self):
        rc, _, _ = self.run_cli("set", "fe-prod", "X_VALUE=")
        self.assertEqual(rc, 1)

    def test_unknown_or_missing_files_are_refused_and_never_created(self):
        for spec in ("../etc/passwd", "staging", "prod,../x", "data"):
            with self.subTest(spec=spec):
                rc, _, err = self.run_cli("set", spec, "X_VALUE=1")
                self.assertEqual(rc, 2)
                self.assertIn("FAIL", err)
        self.assertFalse((self.dir / "data.env").exists())
        self.assertFalse((self.dir.parent / "x.env").exists())

    def test_files_that_exist_but_are_not_on_the_list_are_never_touched(self):
        outside = self.dir.parent / "outside.env"
        outside.write_text("A_B=1\n", encoding="utf-8")
        inside = self.dir / "random.env"
        inside.write_text("A_B=1\n", encoding="utf-8")
        for spec in ("../outside", "random", str(outside)):
            for cmd in (["set", spec, "NEW_KEY=2"], ["unset", spec, "A_B", "--yes"], ["status", spec]):
                with self.subTest(spec=spec, cmd=cmd[0]):
                    rc, _, err = self.run_cli(*cmd)
                    self.assertEqual(rc, 2)
                    self.assertIn("알 수 없는 파일", err)
        self.assertEqual(outside.read_text(encoding="utf-8"), "A_B=1\n")
        self.assertEqual(inside.read_text(encoding="utf-8"), "A_B=1\n")

    def test_bad_key_name_is_refused_without_echoing_it(self):
        rc, _, err = self.run_cli("set", "prod", f"{VALUE_ONE}")
        self.assertEqual(rc, 2)
        self.assertNotIn(VALUE_ONE, err)

    def test_duplicate_keys_in_the_arguments_are_refused(self):
        rc, _, err = self.run_cli("set", "fe-prod", "A_B=1", "A_B=2")
        self.assertEqual(rc, 2)
        self.assertIn("두 번", err)

    def test_replacing_collapses_duplicate_lines_and_keeps_the_rest(self):
        self.write("fe-prod", "APP_ENV=prod\nFOO=1\nNODE_ENV=production\nFOO=3\n")
        rc, _, _ = self.run_cli("set", "fe-prod", "FOO=9", "--yes")
        self.assertEqual(rc, 0)
        self.assertEqual(self.read("fe-prod"), "APP_ENV=prod\nFOO=9\nNODE_ENV=production\n")

    def test_file_without_trailing_newline_and_empty_file(self):
        self.write("fe-prod", "APP_ENV=prod")
        self.run_cli("set", "fe-prod", "A_B=1")
        self.assertEqual(self.read("fe-prod"), "APP_ENV=prod\nA_B=1\n")
        self.write("fe-dev", "")
        self.run_cli("set", "fe-dev", "A_B=1")
        self.assertEqual(self.read("fe-dev"), "A_B=1\n")

    @unittest.skipUnless(os.name == "posix", "파일 모드는 POSIX에서만 본다")
    def test_mode_is_kept_and_no_temp_file_is_left(self):
        (self.dir / "fe-prod.env").chmod(0o640)
        self.run_cli("set", "fe-prod", "A_B=1")
        self.assertEqual((self.dir / "fe-prod.env").stat().st_mode & 0o777, 0o640)
        self.assertEqual(sorted(p.name for p in self.dir.iterdir() if p.name.startswith(".envset")), [])

    @unittest.skipUnless(os.name == "posix" and hasattr(os, "geteuid") and os.geteuid() != 0, "root는 쓰기 권한 검사를 지나간다")
    def test_without_write_permission_it_says_to_use_sudo(self):
        self.dir.chmod(0o555)
        self.addCleanup(self.dir.chmod, 0o755)
        rc, _, err = self.run_cli("set", "fe-prod", "A_B=1")
        self.assertEqual(rc, 2)
        self.assertIn("sudo", err)


class UnsetTest(EnvsetCase):
    def test_removes_the_key_after_confirmation(self):
        rc, out, _ = self.run_cli("unset", "dev", "OTHER", stdin="y\n")
        self.assertEqual(rc, 0)
        self.assertNotIn("OTHER", self.read("dev"))
        self.assertIn("APP_ENV=dev", self.read("dev"))
        self.assertIn("삭제 OTHER", out)

    def test_keeps_the_key_when_the_answer_is_no(self):
        before = self.read("dev")
        rc, out, _ = self.run_cli("unset", "dev", "OTHER", stdin="n\n")
        self.assertEqual(rc, 0)
        self.assertEqual(self.read("dev"), before)
        self.assertIn("그대로 둠 OTHER", out)

    def test_required_key_prints_a_warning(self):
        rc, out, _ = self.run_cli("unset", "prod", "JWT_SECRET", "--yes")
        self.assertEqual(rc, 0)
        self.assertIn("필수 키다", out)
        self.assertNotIn("JWT_SECRET", self.read("prod"))

    def test_missing_key_is_reported_and_nothing_changes(self):
        before = self.read("prod")
        rc, out, _ = self.run_cli("unset", "prod", "NOPE_KEY", "--yes")
        self.assertEqual(rc, 0)
        self.assertIn("없음 NOPE_KEY", out)
        self.assertEqual(self.read("prod"), before)

    def test_a_value_argument_is_refused(self):
        rc, _, err = self.run_cli("unset", "prod", "OTHER=keep")
        self.assertEqual(rc, 2)
        self.assertIn("키 이름만", err)


class StatusTest(EnvsetCase):
    def test_reports_placeholders_and_missing_required_keys(self):
        self.write("prod", "APP_ENV=prod\nJWT_SECRET=REPLACE_ME\nMODAL_KEY=\nOTHER=keep\n")
        rc, out, _ = self.run_cli("status", "prod")
        self.assertEqual(rc, 1)
        self.assertIn("OK    APP_ENV (필수)", out)
        self.assertIn("FAIL  JWT_SECRET (필수): REPLACE_ME", out)
        self.assertIn("FAIL  MODAL_KEY (필수): 비어 있다", out)
        self.assertIn("FAIL  MODAL_BASE_URL (필수): 없다", out)
        self.assertIn("WARN  OTHER: 계약 표에 없다", out)
        self.assertIn("넣을 수 있는 선택 키: REVIEW_MOCK_ENABLED", out)
        self.assertNotIn("keep", out)

    def test_passes_when_everything_required_is_there(self):
        rc, out, _ = self.run_cli("status", "fe-prod")
        self.assertEqual(rc, 0, out)
        self.assertIn("점검 통과", out)
        self.assertIn("넣을 수 있는 선택 키: NAVER_MAP_CLIENT_ID, POSTHOG_KEY", out)

    def test_format_problems_are_failures(self):
        self.write("fe-prod", "# comment\nAPP_ENV=prod\nNODE_ENV=production\n")
        rc, out, _ = self.run_cli("status", "fe-prod")
        self.assertEqual(rc, 1)
        self.assertIn("FAIL  형식: 1줄 not-key-value", out)

    def test_optional_placeholder_is_a_failure_like_in_preflight(self):
        self.write("fe-prod", "APP_ENV=prod\nNODE_ENV=production\nNAVER_MAP_CLIENT_ID=REPLACE_ME\n")
        rc, out, _ = self.run_cli("status", "fe-prod")
        self.assertEqual(rc, 1)
        self.assertIn("FAIL  NAVER_MAP_CLIENT_ID (선택): REPLACE_ME", out)

    def test_without_a_contract_it_still_checks_format_and_placeholders(self):
        self.write("fe-prod", "APP_ENV=prod\nFOO=REPLACE_ME\n")
        with mock.patch.object(envset, "load_contract", return_value=None):
            rc, out, _ = self.run_cli("status", "fe-prod")
        self.assertEqual(rc, 1)
        self.assertIn("SKIP  계약 표를 찾지 못했거나", out)
        self.assertIn("FAIL  FOO: REPLACE_ME", out)

    def test_status_without_a_name_covers_every_file_on_the_server(self):
        rc, out, _ = self.run_cli("status")
        for name in ("prod", "dev", "fe-prod", "fe-dev"):
            self.assertIn(f"== {name} (그룹", out)
        self.assertNotIn("== data", out)

    def test_list_counts_keys_and_placeholders(self):
        rc, out, _ = self.run_cli("list")
        self.assertEqual(rc, 0)
        self.assertRegex(out, r"prod\s+키 5개, REPLACE_ME 3개")
        self.assertRegex(out, r"fe-prod\s+키 2개, REPLACE_ME 0개")

    def test_list_on_a_server_without_files(self):
        for p in self.dir.iterdir():
            p.unlink()
        rc, out, _ = self.run_cli("list")
        self.assertEqual(rc, 1)


class RulesMatchTheCheckers(unittest.TestCase):
    """envset이 쓴 파일을 check_env_files(CI와 preflight)가 거부하는 일이 없도록 규칙을 같게 둔다."""

    def test_constants_are_the_same(self):
        self.assertEqual(envset.FORBIDDEN_VALUE_CHARS, env.FORBIDDEN_VALUE_CHARS)
        self.assertEqual(envset.KEY_RE.pattern, env.KEY_RE.pattern)

    def test_format_issues_equal_check_text_for_many_files(self):
        samples = [
            b"A=1\nB_2=hello\n\nC=\n",
            b"K=abc==\nU=https://x.y/z?a=b&c=d\n",
            b"# note\nA=1\n",
            b'A="x"\nB=\'y\'\n',
            b"A=a b\nB=c \n",
            b"A=1\nA=2\n",
            b"a=1\nNOEQUALS\n",
            b"\xef\xbb\xbfA=1\n",
            b"A=1\r\nB=2\r\n",
            "A=abc　\nB= \n".encode(),
            b"A=x$y\nB=x#y\nC=x\\y\nD=x`y\n",
        ]
        for raw in samples:
            with self.subTest(raw=raw):
                issues, _ = env.check_text(raw)
                self.assertEqual(envset.format_issues(raw.decode("utf-8")), [(i.line, i.rule) for i in issues])

    def test_a_value_envset_accepts_is_accepted_by_check_env_files(self):
        for value in ["abc123", "a-b_c.d", "dGVzdA==", "https://gms.example/gmsapi", "AbC+/=", "한글값"]:
            with self.subTest(value=value):
                cleaned, err = envset.check_value("X_VALUE", value)
                self.assertIsNone(err)
                issues, _ = env.check_text(f"X_VALUE={cleaned}\n".encode())
                self.assertEqual(issues, [])


class ContractParsingTest(unittest.TestCase):
    def test_reads_groups_and_required_flags(self):
        table = envset.parse_contract(CONTRACT)
        self.assertEqual(table["app"]["JWT_SECRET"], True)
        self.assertEqual(table["app"]["REVIEW_MOCK_ENABLED"], False)
        self.assertEqual(sorted(k for k, req in table["fe"].items() if req), ["APP_ENV", "NODE_ENV"])

    def test_the_real_contract_parses_and_has_the_known_groups(self):
        text = (REPO / "docs/infra/contracts/env.md").read_text(encoding="utf-8")
        table = envset.parse_contract(text)
        for group in ("app", "migrate", "fe", "edge", "data", "backup", "obs", "ops"):
            self.assertIn(group, table)
        self.assertTrue(table["app"]["JWT_SECRET"])
        self.assertTrue(table["fe"]["BE_INTERNAL_URL"])
        rows = re.findall(r"^\| `[A-Z][A-Z0-9_]*` \|", text, flags=re.M)
        self.assertEqual(sum(len(v) for v in table.values()) >= len(rows), True)

    def test_every_file_name_maps_to_a_group_in_the_contract(self):
        text = (REPO / "docs/infra/contracts/env.md").read_text(encoding="utf-8")
        table = envset.parse_contract(text)
        for name, group in envset.FILES.items():
            self.assertIn(group, table, name)
            self.assertIn(group, envset.APPLY, name)


class SecretDetectionTest(unittest.TestCase):
    def test_secret_words(self):
        for key in ("JWT_SECRET", "S3_ACCESS_KEY", "MATTERMOST_WEBHOOK_URL", "OPS_BASIC_AUTH_HASH", "GRAFANA_ADMIN_PASSWORD", "GARAGE_ADMIN_TOKEN"):
            self.assertTrue(envset.is_secret(key), key)
        for key in ("NAVER_MAP_CLIENT_ID", "MODAL_BASE_URL", "APP_ENV", "BE_INTERNAL_URL", "KEYCLOAK_URL"):
            self.assertFalse(envset.is_secret(key), key)

    def test_every_contract_key_described_as_a_secret_is_treated_as_one(self):
        text = (REPO / "docs/infra/contracts/env.md").read_text(encoding="utf-8")
        missed = []
        for line in text.splitlines():
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            m = envset.CONTRACT_KEY_RE.match(cells[0]) if len(cells) >= 4 else None
            # "공개 값이라 비밀이 아니고"처럼 부정하는 설명은 비밀로 보지 않는다(NAVER_MAP_CLIENT_ID)
            if m and "비밀" in cells[3] and "비밀이 아니" not in cells[3] and not envset.is_secret(m.group(1)):
                missed.append(m.group(1))
        self.assertEqual(missed, [], "계약이 비밀이라고 적은 키를 envset이 비밀로 보지 않는다. SECRET_WORDS를 고친다")


if __name__ == "__main__":
    unittest.main()
