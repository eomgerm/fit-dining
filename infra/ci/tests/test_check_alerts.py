import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import check_alerts as ca  # noqa: E402

GOOD = """groups:
  - name: g
    rules:
      - alert: FitGood
        expr: up == 0
        for: 1m
        labels: {severity: critical}
        annotations:
          summary: 요약
          description: 설명
          runbook: RB-03
      - record: fit:thing
        expr: sum(up)
"""
TEST = "tests:\n  - alert_rule_test:\n      - alertname: FitGood\n"


class AlertRulesTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.prom = Path(self._tmp.name) / "prometheus"
        (self.prom / "rules").mkdir(parents=True)
        (self.prom / "tests").mkdir()

    def tearDown(self):
        self._tmp.cleanup()

    def put(self, rules: str = GOOD, tests: str = TEST):
        (self.prom / "rules" / "a.yml").write_text(rules, encoding="utf-8")
        (self.prom / "tests" / "a.test.yml").write_text(tests, encoding="utf-8")

    def test_good_rules_pass(self):
        self.put()
        self.assertEqual(ca.check_rules(self.prom), [])

    def test_record_rules_are_not_alerts(self):
        alerts = ca.parse_alerts(GOOD)
        self.assertEqual([a.name for a in alerts], ["FitGood"])

    def test_missing_runbook_is_flagged(self):
        self.put(GOOD.replace("          runbook: RB-03\n", ""))
        self.assertTrue(any("runbook 주석이 없다" in f for f in ca.check_rules(self.prom)))

    def test_unknown_runbook_id_is_flagged(self):
        self.put(GOOD.replace("RB-03", "RB-99"))
        self.assertTrue(any("RB-99" in f for f in ca.check_rules(self.prom)))

    def test_runbook_variant_rb02b_is_allowed(self):
        self.put(GOOD.replace("RB-03", "RB-02b"))
        self.assertEqual(ca.check_rules(self.prom), [])

    def test_missing_or_invalid_severity_is_flagged(self):
        self.put(GOOD.replace("severity: critical", "severity: urgent"))
        self.assertTrue(any("severity" in f for f in ca.check_rules(self.prom)))
        self.put(GOOD.replace("labels: {severity: critical}\n", ""))
        self.assertTrue(any("severity" in f for f in ca.check_rules(self.prom)))

    def test_missing_description_is_flagged(self):
        self.put(GOOD.replace("          description: 설명\n", ""))
        self.assertTrue(any("description 주석이 없다" in f for f in ca.check_rules(self.prom)))

    def test_alert_without_unit_test_is_flagged(self):
        self.put(tests="tests: []\n")
        self.assertTrue(any("단위 시험" in f and "FitGood" in f for f in ca.check_rules(self.prom)))

    def test_bad_name_is_flagged(self):
        self.put(GOOD.replace("FitGood", "badName"), TEST.replace("FitGood", "badName"))
        self.assertTrue(any("Fit으로 시작" in f for f in ca.check_rules(self.prom)))

    def test_duplicate_name_is_flagged(self):
        dup = GOOD + GOOD.split("rules:\n")[1].split("      - record")[0]
        self.put(dup)
        self.assertTrue(any("겹친다" in f for f in ca.check_rules(self.prom)))

    def test_empty_rules_dir_is_flagged(self):
        self.put("groups: []\n")
        self.assertTrue(any("하나도 없다" in f for f in ca.check_rules(self.prom)))

    def test_missing_expr_is_flagged(self):
        self.put(GOOD.replace("        expr: up == 0\n", ""))
        self.assertTrue(any("expr가 없다" in f for f in ca.check_rules(self.prom)))


class DashboardsTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.obs = Path(self._tmp.name)
        (self.obs / "grafana" / "dashboards").mkdir(parents=True)
        ds = self.obs / "grafana" / "provisioning" / "datasources"
        ds.mkdir(parents=True)
        (ds / "p.yml").write_text("datasources:\n  - name: P\n    uid: prom-a\n    type: prometheus\n", encoding="utf-8")

    def tearDown(self):
        self._tmp.cleanup()

    def dash(self, name: str, uid="u1", title="t1", panels=None):
        if panels is None:
            panels = [{"id": 1, "datasource": {"uid": "prom-a"}, "targets": [{"expr": "up", "datasource": {"uid": "prom-a"}}]}]
        (self.obs / "grafana" / "dashboards" / name).write_text(json.dumps({"uid": uid, "title": title, "panels": panels}), encoding="utf-8")

    def test_good_dashboard_passes(self):
        self.dash("a.json")
        self.assertEqual(ca.check_dashboards(self.obs), [])

    def test_invalid_json_is_flagged(self):
        (self.obs / "grafana" / "dashboards" / "a.json").write_text("{", encoding="utf-8")
        self.assertTrue(any("JSON이 아니다" in f for f in ca.check_dashboards(self.obs)))

    def test_duplicate_uid_and_title_are_flagged(self):
        self.dash("a.json")
        self.dash("b.json")
        failures = ca.check_dashboards(self.obs)
        self.assertTrue(any("uid" in f and "겹친다" in f for f in failures))
        self.assertTrue(any("title" in f and "겹친다" in f for f in failures))

    def test_unknown_datasource_is_flagged(self):
        self.dash("a.json", panels=[{"id": 1, "datasource": {"uid": "nope"}, "targets": [{"expr": "up"}]}])
        self.assertTrue(any("nope" in f for f in ca.check_dashboards(self.obs)))

    def test_empty_expr_is_flagged(self):
        self.dash("a.json", panels=[{"id": 1, "datasource": {"uid": "prom-a"}, "targets": [{"expr": ""}]}])
        self.assertTrue(any("expr" in f for f in ca.check_dashboards(self.obs)))

    def test_duplicate_panel_ids_are_flagged(self):
        p = {"id": 1, "datasource": {"uid": "prom-a"}, "targets": [{"expr": "up"}]}
        self.dash("a.json", panels=[p, p])
        self.assertTrue(any("패널 id" in f for f in ca.check_dashboards(self.obs)))

    def test_no_dashboards_is_flagged(self):
        for f in (self.obs / "grafana" / "dashboards").glob("*.json"):
            f.unlink()
        self.assertTrue(any("대시보드가 없다" in f for f in ca.check_dashboards(self.obs)))


class MainTest(unittest.TestCase):
    def test_skip_when_no_stacks(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(ca.main(["--root", d]), 0)

    def test_real_repo_passes(self):
        root = Path(__file__).resolve().parents[3]
        self.assertEqual(ca.main(["--root", str(root)]), 0)


if __name__ == "__main__":
    unittest.main()
