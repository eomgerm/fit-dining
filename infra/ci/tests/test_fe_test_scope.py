"""infra/ci/fe-test-scope.sh: MR에서 FE 시험을 어디까지 돌릴지 정한다. 진짜 git 저장소를 임시 폴더에 만들어 돌린다.

판단이 서지 않으면 전체 시험이어야 한다(관련 시험만 돌리다가 놓치는 쪽이 더 나쁘다).
"""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "infra" / "ci" / "fe-test-scope.sh"
SH = shutil.which("sh")
GIT = shutil.which("git")


def git(cwd, *args):
    subprocess.run(
        [GIT, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", *args],
        cwd=cwd, check=True, capture_output=True, text=True,
    )


@unittest.skipUnless(SH and GIT, "sh와 git이 필요하다")
class FeTestScopeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        git(self.repo, "init", "-q", "-b", "main")
        self.write("fe/src/a.ts", "export const a = 1\n")
        self.write("fe/src/a.test.ts", "// test\n")
        self.write("fe/package.json", "{}\n")
        self.write("fe/pnpm-lock.yaml", "lock\n")
        self.write("fe/next.config.ts", "export default {}\n")
        self.write("fe/public/sw.js", "// sw\n")
        self.write("fe/README.md", "x\n")
        self.write(".gitlab-ci.yml", "stages: []\n")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "base")
        self.base = subprocess.run([GIT, "rev-parse", "HEAD"], cwd=self.repo, capture_output=True, text=True, check=True).stdout.strip()

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, rel, text):
        p = self.repo / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8", newline="\n")

    def commit(self):
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "head")

    def run_scope(self, base="default"):
        env = {k: v for k, v in os.environ.items() if k != "CI_MERGE_REQUEST_DIFF_BASE_SHA"}
        if base == "default":
            env["CI_MERGE_REQUEST_DIFF_BASE_SHA"] = self.base
        elif base is not None:
            env["CI_MERGE_REQUEST_DIFF_BASE_SHA"] = base
        res = subprocess.run([SH, str(SCRIPT), "scope.env"], cwd=self.repo, env=env, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stderr)
        out = {}
        for line in (self.repo / "scope.env").read_text(encoding="utf-8").splitlines():
            k, _, v = line.partition("=")
            out[k] = v
        return out

    def assertFull(self, out):
        self.assertEqual(out, {"FE_TEST_FULL": "true", "FE_TEST_FILES": ""})

    def test_a_changed_source_file_selects_only_its_related_tests(self):
        self.write("fe/src/a.ts", "export const a = 2\n")
        self.commit()
        self.assertEqual(self.run_scope(), {"FE_TEST_FULL": "false", "FE_TEST_FILES": "src/a.ts"})

    def test_paths_with_brackets_and_several_files_come_through_unchanged(self):
        self.write("fe/src/app/photos/[env]/route.ts", "x\n")
        self.write("fe/src/b.tsx", "x\n")
        self.commit()
        got = self.run_scope()
        self.assertEqual(got["FE_TEST_FULL"], "false")
        self.assertEqual(sorted(got["FE_TEST_FILES"].split(" ")), ["src/app/photos/[env]/route.ts", "src/b.tsx"])

    def test_a_changed_test_file_is_itself_selected(self):
        self.write("fe/src/a.test.ts", "// changed\n")
        self.commit()
        self.assertEqual(self.run_scope()["FE_TEST_FILES"], "src/a.test.ts")

    def test_config_dependency_public_and_ci_changes_run_everything(self):
        for rel in ("fe/package.json", "fe/pnpm-lock.yaml", "fe/next.config.ts", "fe/public/sw.js", ".gitlab-ci.yml"):
            with self.subTest(rel=rel):
                git(self.repo, "reset", "-q", "--hard", self.base)
                self.write(rel, "changed\n")
                self.write("fe/src/a.ts", "export const a = 3\n")
                self.commit()
                self.assertFull(self.run_scope())

    def test_a_global_change_hidden_among_source_changes_still_runs_everything(self):
        self.write("fe/src/a.ts", "export const a = 4\n")
        self.write("fe/pnpm-lock.yaml", "other\n")
        self.commit()
        self.assertFull(self.run_scope())

    def test_changes_outside_fe_src_select_no_tests_and_skip_them(self):
        self.write("fe/README.md", "changed\n")
        self.write("docs/a.md", "x\n")
        self.commit()
        self.assertEqual(self.run_scope(), {"FE_TEST_FULL": "false", "FE_TEST_FILES": ""})

    def test_non_code_files_under_src_do_not_select_tests(self):
        self.write("fe/src/notes.md", "x\n")
        self.commit()
        self.assertEqual(self.run_scope(), {"FE_TEST_FULL": "false", "FE_TEST_FILES": ""})

    def test_a_deleted_file_is_not_passed_to_the_test_runner(self):
        git(self.repo, "rm", "-q", "fe/src/a.ts")
        self.commit()
        self.assertEqual(self.run_scope(), {"FE_TEST_FULL": "false", "FE_TEST_FILES": ""})

    def test_a_renamed_file_is_selected_under_its_new_name(self):
        git(self.repo, "mv", "fe/src/a.ts", "fe/src/renamed.ts")
        self.commit()
        self.assertEqual(self.run_scope()["FE_TEST_FILES"], "src/renamed.ts")

    def test_without_a_base_commit_or_with_one_the_clone_does_not_have_it_runs_everything(self):
        self.write("fe/src/a.ts", "export const a = 5\n")
        self.commit()
        self.assertFull(self.run_scope(base=None))
        self.assertFull(self.run_scope(base="0123456789abcdef0123456789abcdef01234567"))

    def test_too_many_changed_files_run_everything(self):
        for i in range(61):
            self.write(f"fe/src/gen/f{i}.ts", "x\n")
        self.commit()
        self.assertFull(self.run_scope())

    def test_exactly_the_limit_still_selects(self):
        for i in range(60):
            self.write(f"fe/src/gen/f{i}.ts", "x\n")
        self.commit()
        got = self.run_scope()
        self.assertEqual(got["FE_TEST_FULL"], "false")
        self.assertEqual(len(got["FE_TEST_FILES"].split(" ")), 60)

    def test_a_file_name_with_a_space_runs_everything(self):
        self.write("fe/src/has space.ts", "x\n")
        self.commit()
        self.assertFull(self.run_scope())


if __name__ == "__main__":
    unittest.main()
