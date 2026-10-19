import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import images_arch as ia  # noqa: E402


class PlatformsFromIndexTest(unittest.TestCase):
    def test_collects_platforms_and_skips_attestation_entries(self):
        index = {"manifests": [
            {"platform": {"architecture": "amd64", "os": "linux"}},
            {"platform": {"architecture": "arm64", "os": "linux", "variant": "v8"}},
            {"platform": {"architecture": "unknown", "os": "unknown"}},
        ]}
        self.assertEqual(ia.platforms_from_index(index), {"linux/amd64", "linux/arm64"})

    def test_empty_index_gives_no_platforms(self):
        self.assertEqual(ia.platforms_from_index({}), set())


class DockerfileParsingTest(unittest.TestCase):
    def test_multistage_platform_flag_alias_and_scratch(self):
        text = (
            "FROM --platform=$BUILDPLATFORM golang:1.22 AS build\n"
            "RUN go build\n"
            "FROM build AS test\n"
            "FROM scratch\n"
            "FROM gcr.io/distroless/static:nonroot AS final\n"
        )
        resolved, unresolved = ia.images_from_dockerfile(text)
        self.assertEqual(resolved, {"golang:1.22", "gcr.io/distroless/static:nonroot"})
        self.assertEqual(unresolved, set())

    def test_variable_image_is_reported_as_unresolved(self):
        resolved, unresolved = ia.images_from_dockerfile("ARG BASE=x\nFROM ${BASE}\nfrom alpine:3.20\n")
        self.assertEqual(resolved, {"alpine:3.20"})
        self.assertEqual(unresolved, {"${BASE}"})


class SourcesTest(unittest.TestCase):
    def test_compose_config_images(self):
        cfg = {"services": {"a": {"image": "x:1"}, "b": {"build": {"context": "."}}, "c": {"image": "y:2"}}}
        self.assertEqual(ia.images_from_compose_config(cfg), {"x:1", "y:2"})

    def test_shell_vars_images_ignore_comments_and_other_variables(self):
        text = "# comment\nFOO_IMAGE=a/b:1\nBAR=not-an-image\nBAZ_IMAGE=c:2\n"
        self.assertEqual(ia.images_from_shell_vars(text), {"a/b:1", "c:2"})


class CheckTest(unittest.TestCase):
    def fake(self, table, calls=None):
        def inspector(image):
            if calls is not None:
                calls.append(image)
            v = table[image]
            if isinstance(v, Exception):
                raise v
            return v
        return inspector

    def test_all_images_support_all_platforms(self):
        table = {"a": {"linux/amd64", "linux/arm64"}, "b": {"linux/arm64", "linux/amd64"}}
        self.assertEqual(ia.check({"a", "b"}, ["linux/arm64", "linux/amd64"], self.fake(table)), [])

    def test_missing_platform_is_reported_with_what_exists(self):
        table = {"a": {"linux/amd64"}}
        self.assertEqual(
            ia.check({"a"}, ["linux/arm64"], self.fake(table)),
            ["a: missing linux/arm64 (has: linux/amd64)"],
        )

    def test_each_image_is_inspected_once_even_for_several_platforms(self):
        calls = []
        table = {"a": {"linux/amd64", "linux/arm64"}}
        ia.check({"a"}, ["linux/arm64", "linux/amd64"], self.fake(table, calls))
        self.assertEqual(calls, ["a"])

    def test_inspect_error_is_reported_once(self):
        table = {"a": ia.InspectError("denied")}
        self.assertEqual(
            ia.check({"a"}, ["linux/amd64", "linux/arm64"], self.fake(table)),
            ["a: inspect-error denied"],
        )


if __name__ == "__main__":
    unittest.main()
