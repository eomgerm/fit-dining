import contextlib
import io
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import check_eol  # noqa: E402


class CheckEolTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, name: str, data: bytes) -> Path:
        p = self.dir / name
        p.write_bytes(data)
        return p

    def test_lf_file_passes(self):
        p = self.write("ok.sh", b"#!/bin/sh\necho hi\n")
        self.assertEqual(check_eol.files_with_crlf([p]), [])

    def test_crlf_shell_script_is_flagged(self):
        p = self.write("bad.sh", b"#!/bin/sh\r\necho hi\r\n")
        self.assertEqual(check_eol.files_with_crlf([p]), [p])

    def test_crlf_env_example_is_flagged(self):
        p = self.write("prod.env.example", b"A=1\r\n")
        self.assertEqual(check_eol.files_with_crlf([p]), [p])

    def test_dockerfile_variants_are_checked(self):
        p = self.write("Dockerfile.prod", b"FROM x\r\n")
        self.assertEqual(check_eol.files_with_crlf([p]), [p])

    def test_binary_suffix_is_ignored(self):
        p = self.write("img.png", b"\x89PNG\r\n")
        self.assertEqual(check_eol.files_with_crlf([p]), [])

    def test_main_with_paths_checks_actual_bytes(self):
        bad = self.write("bad.yml", b"a: 1\r\n")
        good = self.write("good.yml", b"a: 1\n")
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(check_eol.main([str(bad)]), 1)
            self.assertEqual(check_eol.main([str(good)]), 0)


@unittest.skipUnless(shutil.which("git"), "git 없음")
class IndexCheckTest(unittest.TestCase):
    """인덱스(커밋될 내용)의 EOL을 본다. 작업 트리만 CRLF인 Windows 체크아웃은 통과해야 한다."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "t@t.t")
        self.git("config", "user.name", "t")
        self.git("config", "core.autocrlf", "false")

    def tearDown(self):
        self._tmp.cleanup()

    def git(self, *args: str) -> None:
        subprocess.run(["git", *args], cwd=self.repo, check=True, capture_output=True)

    def test_crlf_in_index_without_attributes_is_flagged(self):
        (self.repo / "run.sh").write_bytes(b"#!/bin/sh\r\necho hi\r\n")
        self.git("add", "run.sh")
        self.assertEqual(check_eol.index_crlf_files(str(self.repo)), [Path("run.sh")])

    def test_crlf_in_file_without_a_known_suffix_is_flagged(self):
        (self.repo / "gradlew").write_bytes(b"#!/bin/sh\r\necho hi\r\n")
        self.git("add", "gradlew")
        self.assertEqual(check_eol.index_crlf_files(str(self.repo)), [Path("gradlew")])

    def test_crlf_allowed_by_eol_attribute_is_not_flagged(self):
        (self.repo / "run.bat").write_bytes(b"@echo off\r\n")
        self.git("add", "run.bat")  # 속성이 생기기 전에 커밋돼 인덱스에 CRLF가 남은 파일
        (self.repo / ".gitattributes").write_bytes(b"*.bat eol=crlf\n")
        self.git("add", ".gitattributes")
        self.assertEqual(check_eol.index_crlf_files(str(self.repo)), [])

    def test_gitattributes_normalizes_crlf_so_index_is_clean(self):
        (self.repo / ".gitattributes").write_bytes(b"* text=auto eol=lf\n")
        (self.repo / "run.sh").write_bytes(b"#!/bin/sh\r\necho hi\r\n")
        self.git("add", ".gitattributes", "run.sh")
        self.assertEqual(check_eol.index_crlf_files(str(self.repo)), [])


if __name__ == "__main__":
    unittest.main()
