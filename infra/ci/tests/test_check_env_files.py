import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import check_env_files as env  # noqa: E402


def rules(raw: bytes) -> list[tuple[int, str]]:
    issues, _ = env.check_text(raw)
    return [(i.line, i.rule) for i in issues]


class CheckTextTest(unittest.TestCase):
    def test_valid_file_has_no_issues(self):
        self.assertEqual(rules(b"A=1\nB_2=hello\n\nC=\n"), [])

    def test_base64_padding_and_url_values_are_allowed(self):
        self.assertEqual(rules(b"K=abc==\nU=https://x.y/z?a=b&c=d\n"), [])

    def test_comment_line_is_rejected(self):
        self.assertEqual(rules(b"# note\nA=1\n"), [(1, "not-key-value")])

    def test_quotes_are_rejected(self):
        self.assertEqual(rules(b'A="x"\nB=\'y\'\n'), [(1, "forbidden-char-in-value"), (2, "forbidden-char-in-value")])

    def test_space_and_trailing_space_are_rejected(self):
        self.assertEqual(rules(b"A=a b\nB=c \n"), [(1, "forbidden-char-in-value"), (2, "forbidden-char-in-value")])

    def test_dollar_hash_backslash_backtick_are_rejected(self):
        for ch in ("$", "#", "\\", "`"):
            with self.subTest(ch=ch):
                self.assertEqual(rules(f"A=x{ch}y\n".encode()), [(1, "forbidden-char-in-value")])

    def test_unicode_whitespace_is_rejected(self):
        # 한글 IME의 전각 공백과 NBSP는 compose(env_file)가 잘라내고 docker run --env-file은 남긴다
        self.assertEqual(rules("A=abc\u3000\n".encode()), [(1, "forbidden-char-in-value")])
        self.assertEqual(rules("A=x\u00a0\n".encode()), [(1, "forbidden-char-in-value")])
        self.assertEqual(rules("A=한글\n".encode()), [])

    def test_lowercase_key_is_rejected(self):
        self.assertEqual(rules(b"abc=1\n"), [(1, "bad-key")])

    def test_duplicate_key_is_rejected_on_second_occurrence(self):
        self.assertEqual(rules(b"A=1\nB=2\nA=3\n"), [(3, "duplicate-key")])

    def test_crlf_is_reported_once_without_noise(self):
        self.assertEqual(rules(b"A=1\r\nB=2\r\n"), [(0, "crlf")])

    def test_bom_is_reported_without_breaking_first_key(self):
        self.assertEqual(rules(b"\xef\xbb\xbfA=1\n"), [(1, "bom")])

    def test_issue_text_never_contains_the_value(self):
        issues, _ = env.check_text(b"PASSWORD=super secret value\n", "x.env")
        self.assertEqual(len(issues), 1)
        self.assertNotIn("super", str(issues[0]))
        self.assertNotIn("secret", str(issues[0]))


class RequiredKeysTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_missing_and_empty_required_keys(self):
        f = self.dir / "prod.env"
        f.write_bytes(b"A=1\nB=\n")
        issues = env.check_file(f, {"A", "B", "C"})
        self.assertEqual(sorted(i.rule for i in issues), ["empty-required:B", "missing-required:C"])

    def test_read_required_ignores_comments_and_blanks(self):
        f = self.dir / "env.required"
        f.write_text("# 필수 키\nA\n\n  B  \n", encoding="utf-8")
        self.assertEqual(env.read_required(f), {"A", "B"})

    def test_main_exit_codes(self):
        good = self.dir / "good.env"
        good.write_bytes(b"A=1\n")
        bad = self.dir / "bad.env"
        bad.write_bytes(b'A="1"\n')
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(env.main([str(good)]), 0)
            self.assertEqual(env.main([str(bad)]), 1)


if __name__ == "__main__":
    unittest.main()
