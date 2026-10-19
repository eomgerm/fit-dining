import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import migration_immutability as mi  # noqa: E402

DIR = "be/src/main/resources/db/migration"


@unittest.skipUnless(shutil.which("git"), "git 없음")
class MigrationImmutabilityTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "t@t.t")
        self.git("config", "user.name", "t")
        self.git("config", "commit.gpgsign", "false")
        self.put(f"{DIR}/V1__init.sql", "create table a(id int);\n")
        self.put(f"{DIR}/V3__third.sql", "create table c(id int);\n")
        self.put(f"{DIR}/R__views.sql", "create or replace view v as select 1;\n")
        self.put("README.md", "x\n")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "base")
        self.git("checkout", "-q", "-b", "feature")

    def tearDown(self):
        self._tmp.cleanup()

    def git(self, *args: str) -> None:
        subprocess.run(["git", *args], cwd=self.repo, check=True, capture_output=True)

    def put(self, rel: str, text: str) -> None:
        p = self.repo / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8", newline="\n")

    def commit(self) -> None:
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "change")

    def changed(self) -> list[str]:
        return mi.changed_migrations("main", DIR, cwd=str(self.repo))

    def problems(self) -> list[str]:
        return mi.version_problems("main", DIR, cwd=str(self.repo))

    def test_adding_a_new_migration_is_allowed(self):
        self.put(f"{DIR}/V4__add_b.sql", "create table b(id int);\n")
        self.commit()
        self.assertEqual(self.changed(), [])
        self.assertEqual(self.problems(), [])

    def test_modifying_an_existing_migration_is_flagged(self):
        self.put(f"{DIR}/V1__init.sql", "create table a(id bigint);\n")
        self.commit()
        self.assertEqual(self.changed(), [f"M\t{DIR}/V1__init.sql"])

    def test_editing_a_repeatable_migration_is_allowed(self):
        self.put(f"{DIR}/R__views.sql", "create or replace view v as select 2;\n")
        self.commit()
        self.assertEqual(self.changed(), [])

    def test_deleting_an_existing_migration_is_flagged(self):
        (self.repo / DIR / "V1__init.sql").unlink()
        self.commit()
        self.assertEqual(self.changed(), [f"D\t{DIR}/V1__init.sql"])

    def test_renaming_an_existing_migration_is_flagged_as_a_delete(self):
        self.git("mv", f"{DIR}/V1__init.sql", f"{DIR}/V1__renamed.sql")
        self.commit()
        self.assertEqual(self.changed(), [f"D\t{DIR}/V1__init.sql"])

    def test_changes_outside_the_directory_are_ignored(self):
        self.put("README.md", "changed\n")
        self.commit()
        self.assertEqual(self.changed(), [])

    def test_duplicate_version_is_flagged(self):
        self.put(f"{DIR}/V4__one.sql", "select 1;\n")
        self.put(f"{DIR}/V4__two.sql", "select 2;\n")
        self.commit()
        self.assertTrue(any(p.startswith("duplicate-version") for p in self.problems()), self.problems())

    def test_version_below_the_applied_maximum_is_flagged(self):
        self.put(f"{DIR}/V2__late.sql", "select 2;\n")
        self.commit()
        self.assertEqual(self.problems(), [f"out-of-order\t{DIR}/V2__late.sql"])

    def test_unknown_base_raises(self):
        with self.assertRaises(RuntimeError):
            mi.changed_migrations("nope", DIR, cwd=str(self.repo))

    def test_ensure_commit_is_a_noop_for_refs_and_present_commits(self):
        mi.ensure_commit("main", cwd=str(self.repo))
        head = subprocess.run(["git", "rev-parse", "main"], cwd=self.repo, capture_output=True, text=True).stdout.strip()
        mi.ensure_commit(head, cwd=str(self.repo))


if __name__ == "__main__":
    unittest.main()
