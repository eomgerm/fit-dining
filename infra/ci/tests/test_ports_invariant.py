import contextlib
import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ports_invariant as pi  # noqa: E402


def svc(**kw):
    return {"services": {"s": kw}}


class ViolationsTest(unittest.TestCase):
    def test_short_syntax_without_host_ip_is_a_violation(self):
        cfg = svc(ports=[{"target": 80, "published": "8080", "protocol": "tcp"}])
        self.assertEqual(pi.violations(cfg), ["s: 0.0.0.0:8080 -> 80"])

    def test_loopback_binding_is_allowed(self):
        cfg = svc(ports=[{"host_ip": "127.0.0.1", "target": 80, "published": "3000"}])
        self.assertEqual(pi.violations(cfg), [])

    def test_explicit_all_interfaces_is_a_violation(self):
        cfg = svc(ports=[{"host_ip": "0.0.0.0", "target": 80, "published": "9000"}])
        self.assertEqual(pi.violations(cfg), ["s: 0.0.0.0:9000 -> 80"])

    def test_caddy_may_publish_80_443_8443(self):
        cfg = {"services": {"caddy": {"ports": [
            {"target": 80, "published": "80"},
            {"target": 443, "published": "443"},
            {"target": 8443, "published": "8443"},
        ]}}}
        self.assertEqual(pi.violations(cfg), [])

    def test_caddy_publishing_another_port_is_a_violation(self):
        cfg = {"services": {"caddy": {"ports": [{"target": 2019, "published": "2019"}]}}}
        self.assertEqual(pi.violations(cfg), ["caddy: 0.0.0.0:2019 -> 2019"])

    def test_caddy_publishing_udp_443_is_a_violation(self):
        cfg = {"services": {"caddy": {"ports": [{"target": 443, "published": "443", "protocol": "udp"}]}}}
        self.assertEqual(pi.violations(cfg), ["caddy: 0.0.0.0:443 -> 443"])

    def test_other_service_cannot_reuse_the_caddy_exception(self):
        cfg = {"services": {"be": {"ports": [{"target": 443, "published": "443"}]}}}
        self.assertEqual(pi.violations(cfg), ["be: 0.0.0.0:443 -> 443"])

    def test_port_range_and_random_host_port_are_violations(self):
        cfg = svc(ports=[{"target": 80, "published": "8000-8010"}, {"target": 81}])
        self.assertEqual(len(pi.violations(cfg)), 2)

    def test_host_network_is_a_violation_unless_allowed(self):
        cfg = svc(network_mode="host")
        self.assertEqual(pi.violations(cfg), ["s: network_mode host"])
        self.assertEqual(pi.violations(cfg, allow_host_network={"s"}), [])

    def test_service_without_ports_is_fine(self):
        self.assertEqual(pi.violations(svc(image="x")), [])

    def test_parse_allow_merges_with_defaults(self):
        allow = pi.parse_allow(["grafana=3000,3001"])
        self.assertEqual(allow["caddy"], {80, 443, 8443})
        self.assertEqual(allow["grafana"], {3000, 3001})


@unittest.skipUnless(shutil.which("docker"), "docker CLI 없음")
class ComposeIntegrationTest(unittest.TestCase):
    """docker compose config의 실제 JSON 형태로 검증한다(데몬 불필요)."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, name: str, text: str) -> str:
        p = self.dir / name
        p.write_text(text, encoding="utf-8")
        return str(p)

    def test_short_syntax_is_detected_through_real_compose(self):
        f = self.write(
            "c.yml",
            'services:\n  a:\n    image: x\n    ports: ["8080:80"]\n  b:\n    image: x\n    ports: ["127.0.0.1:3000:80"]\n',
        )
        bad = pi.violations(pi.load_config([f]))
        self.assertEqual(bad, ["a: 0.0.0.0:8080 -> 80"])

    def test_service_behind_a_profile_is_checked(self):
        f = self.write(
            "p.yml",
            'services:\n  a:\n    image: x\n    profiles: ["debug"]\n    ports: ["5005:5005"]\n',
        )
        self.assertEqual(pi.violations(pi.load_config([f])), ["a: 0.0.0.0:5005 -> 5005"])

    def test_env_file_satisfies_required_interpolation(self):
        f = self.write("c.yml", "services:\n  a:\n    image: ${IMG:?required}\n")
        e = self.write("t.env", "IMG=nginx:1\n")
        self.assertEqual(pi.violations(pi.load_config([f], [e])), [])

    def test_missing_required_variable_raises(self):
        f = self.write("c.yml", "services:\n  a:\n    image: ${IMG:?required}\n")
        with self.assertRaises(RuntimeError):
            pi.load_config([f])

    def test_main_exit_codes(self):
        bad = self.write("bad.yml", 'services:\n  a:\n    image: x\n    ports: ["8080:80"]\n')
        good = self.write("good.yml", 'services:\n  a:\n    image: x\n    ports: ["127.0.0.1:3000:80"]\n')
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(pi.main([bad]), 1)
            self.assertEqual(pi.main([good]), 0)


if __name__ == "__main__":
    unittest.main()
