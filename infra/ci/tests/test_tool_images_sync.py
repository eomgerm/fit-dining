import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SH_RE = re.compile(r"^([A-Z][A-Z0-9_]*_IMAGE)=(\S+)\s*$", re.MULTILINE)
CI_VAR_RE = re.compile(r"^  ([A-Z][A-Z0-9_]*_IMAGE): (\S+)\s*$", re.MULTILINE)
# image: 값, services의 `- name: 값`, `image:` 바로 아래의 `name: 값`만 이미지 참조로 본다(environment·artifacts의 name:은 제외).
CI_IMAGE_REF_RE = re.compile(
    r"^\s+(?:image:|-\s+name:)[ \t]*(\S+)[ \t]*$|^\s+image:[ \t]*\n\s+name:[ \t]*(\S+)[ \t]*$", re.MULTILINE
)
USED_VAR_RE = re.compile(r"\$([A-Z][A-Z0-9_]*_IMAGE)")


class ToolImagesSyncTest(unittest.TestCase):
    def setUp(self):
        self.sh = dict(SH_RE.findall((ROOT / "infra/ci/tool-images.sh").read_text(encoding="utf-8")))
        self.ci_text = (ROOT / ".gitlab-ci.yml").read_text(encoding="utf-8")
        self.ci = dict(CI_VAR_RE.findall(self.ci_text))

    def test_pins_are_parsed(self):
        self.assertGreaterEqual(len(self.sh), 8)

    def test_gitlab_ci_variables_match_tool_images_sh(self):
        self.assertEqual(self.ci, self.sh)

    def test_every_job_image_uses_a_pinned_variable(self):
        refs = [a or b for a, b in CI_IMAGE_REF_RE.findall(self.ci_text)]
        self.assertTrue(refs, "image 참조를 찾지 못했다")
        literal = [r for r in refs if not r.startswith("$")]
        self.assertEqual(literal, [], "핀을 거치지 않은 image 리터럴이 있다")

    def test_regex_ignores_environment_and_artifact_names_but_catches_service_images(self):
        text = "deploy:\n  environment:\n    name: dev\n  artifacts:\n    name: x\n  services:\n    - name: postgres:16\n"
        self.assertEqual([a or b for a, b in CI_IMAGE_REF_RE.findall(text)], ["postgres:16"])

    def test_used_variables_are_defined(self):
        used = set(USED_VAR_RE.findall(self.ci_text))
        self.assertTrue(used <= set(self.ci), f"정의되지 않은 변수: {used - set(self.ci)}")


if __name__ == "__main__":
    unittest.main()
