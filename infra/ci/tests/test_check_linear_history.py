import contextlib
import io
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import check_linear_history as clh  # noqa: E402


@unittest.skipUnless(shutil.which("git"), "git 없음")
class LinearHistoryTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "t@t.t")
        self.git("config", "user.name", "t")
        self.git("config", "core.autocrlf", "false")
        self.commit("base")

    def tearDown(self):
        self._tmp.cleanup()

    def git(self, *args: str) -> str:
        r = subprocess.run(["git", *args], cwd=self.repo, capture_output=True, text=True, check=True)
        return r.stdout.strip()

    def commit(self, msg: str) -> None:
        self.git("commit", "-q", "--allow-empty", "-m", msg)

    def test_linear_branch_passes(self):
        base = self.git("rev-parse", "main")
        self.git("switch", "-q", "-c", "feature")
        self.commit("a")
        self.commit("b")
        self.assertEqual(clh.merge_commits(base, str(self.repo)), [])

    def test_branch_with_master_merged_in_is_flagged(self):
        base = self.git("rev-parse", "main")
        self.git("switch", "-q", "-c", "feature")
        self.commit("feature work")
        self.git("switch", "-q", "main")
        self.commit("main moved on")
        self.git("switch", "-q", "feature")
        self.git("merge", "-q", "--no-ff", "-m", "Merge branch 'main' into feature", "main")
        found = clh.merge_commits(base, str(self.repo))
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0][1], "Merge branch 'main' into feature")

    def test_merge_commit_before_base_is_not_flagged(self):
        self.git("switch", "-q", "-c", "old")
        self.commit("old work")
        self.git("switch", "-q", "main")
        self.git("merge", "-q", "--no-ff", "-m", "Merge branch 'old'", "old")
        base = self.git("rev-parse", "main")
        self.git("switch", "-q", "-c", "feature")
        self.commit("new work")
        self.assertEqual(clh.merge_commits(base, str(self.repo)), [])

    def test_empty_range_passes(self):
        self.assertEqual(clh.merge_commits("HEAD", str(self.repo)), [])

    def test_rebased_branch_passes_after_main_moved(self):
        self.git("switch", "-q", "-c", "feature")
        self.commit("feature work")
        self.git("switch", "-q", "main")
        self.commit("main moved on")
        self.git("switch", "-q", "feature")
        self.git("rebase", "-q", "main")
        base = self.git("merge-base", "main", "feature")
        self.assertEqual(clh.merge_commits(base, str(self.repo)), [])


@unittest.skipUnless(shutil.which("git"), "git 없음")
class MainTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name)
        for args in (["init", "-q", "-b", "main"], ["config", "user.email", "t@t.t"], ["config", "user.name", "t"]):
            subprocess.run(["git", *args], cwd=self.repo, check=True, capture_output=True)
        self.commit("base")

    def tearDown(self):
        self._tmp.cleanup()

    def commit(self, msg: str) -> None:
        subprocess.run(["git", "commit", "-q", "--allow-empty", "-m", msg], cwd=self.repo, check=True, capture_output=True)

    def git(self, *args: str) -> None:
        subprocess.run(["git", *args], cwd=self.repo, check=True, capture_output=True)

    def run_main(self, *argv: str) -> tuple[int, str]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = clh.main(list(argv))
        return code, out.getvalue()

    def test_main_ok_for_linear_history(self):
        self.git("tag", "start")
        self.commit("work")
        code, out = self.run_main("--repo", str(self.repo), "--base", "start")
        self.assertEqual(code, 0)
        self.assertIn("OK history", out)

    def test_main_fails_with_guidance_for_merge_commit(self):
        self.git("tag", "start")
        self.git("switch", "-q", "-c", "feature")
        self.commit("feature work")
        self.git("switch", "-q", "main")
        self.commit("main moved on")
        self.git("switch", "-q", "feature")
        self.git("merge", "-q", "--no-ff", "-m", "Merge branch 'main' into feature", "main")
        code, out = self.run_main("--repo", str(self.repo), "--base", "start")
        self.assertEqual(code, 1)
        self.assertIn("merge-commit", out)
        self.assertIn("Merge branch 'main' into feature", out)
        self.assertIn("git rebase", out)

    def test_main_fails_when_base_is_unknown(self):
        code, out = self.run_main("--repo", str(self.repo), "--base", "no-such-ref")
        self.assertEqual(code, 1)
        self.assertIn("FAIL", out)


if __name__ == "__main__":
    unittest.main()
