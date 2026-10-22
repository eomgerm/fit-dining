#!/usr/bin/env python3
"""알림 규칙과 Grafana 대시보드의 규칙 검사(설계 9.4절). 표준 라이브러리만 쓴다(YAML 파서가 없어 줄 단위로 읽는다).

알림 규칙(infra/obs/prometheus, infra/ops/prometheus의 rules/*.yml)
  - 이름은 Fit으로 시작하고 중복이 없다.
  - severity(critical, warning, info), summary, description, runbook이 있다. runbook은 설계 10.2절의 런북 ID(RB-01 ~ RB-13, RB-02b)다.
  - 같은 prometheus 디렉터리의 tests/*.yml에 그 이름의 단위 시험(alertname)이 있다.
대시보드(grafana/dashboards/*.json)
  - JSON이고 uid와 title이 파일 사이에 겹치지 않으며 패널 id가 겹치지 않는다.
  - 패널과 대상의 데이터소스 uid가 grafana/provisioning/datasources의 uid 중 하나다. 대상(target)마다 expr가 있다.
규칙의 PromQL 문법과 단위 시험의 통과는 promtool이 본다(infra/ci/check-prometheus.sh).

사용: python infra/ci/check_alerts.py [--root 저장소 루트]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

RUNBOOKS = {f"RB-{n:02d}" for n in range(1, 14)} | {"RB-02b"}
SEVERITIES = {"critical", "warning", "info"}
ALERT_LINE = re.compile(r"^(?P<indent>\s*)-\s+alert:\s*(?P<name>\S+)\s*$")
RULE_START = re.compile(r"^\s*-\s+(alert|record):")


@dataclass
class Alert:
    name: str
    file: str
    line: int
    block: str


def parse_alerts(text: str, file: str = "") -> list[Alert]:
    """`- alert: 이름` 줄부터 다음 규칙(`- alert:`나 `- record:`) 직전까지를 한 알림으로 본다."""
    lines = text.split("\n")
    alerts: list[Alert] = []
    start = None
    name = ""
    for i, ln in enumerate(lines + ["- record: __end__"]):
        if RULE_START.match(ln):
            if start is not None:
                alerts.append(Alert(name, file, start + 1, "\n".join(lines[start:i])))
                start = None
            m = ALERT_LINE.match(ln)
            if m:
                start, name = i, m.group("name")
    return alerts


def alert_problems(a: Alert) -> list[str]:
    """알림 하나의 빠진 항목."""
    problems = []
    if not re.fullmatch(r"Fit[A-Z][A-Za-z0-9]*", a.name):
        problems.append("이름은 Fit으로 시작하는 파스칼 케이스여야 한다")
    sev = re.search(r"severity:\s*(\w+)", a.block)
    if not sev or sev.group(1) not in SEVERITIES:
        problems.append("severity 라벨(critical, warning, info)이 없다")
    for key in ("summary", "description"):
        if not re.search(rf"^\s*{key}:\s*\S", a.block, re.M):
            problems.append(f"{key} 주석이 없다")
    rb = re.search(r"^\s*runbook:\s*(\S+)", a.block, re.M)
    if not rb:
        problems.append("runbook 주석이 없다")
    elif rb.group(1) not in RUNBOOKS:
        problems.append(f"runbook {rb.group(1)}은(는) 설계 10.2절의 런북 ID가 아니다")
    if not re.search(r"^\s*expr:", a.block, re.M):
        problems.append("expr가 없다")
    return problems


def tested_names(tests_dir: Path) -> set[str]:
    names: set[str] = set()
    for f in sorted(tests_dir.glob("*.yml")):
        names.update(re.findall(r"alertname:\s*(\S+)", f.read_text(encoding="utf-8")))
    return names


def check_rules(prom_dir: Path) -> list[str]:
    """prometheus 디렉터리 하나의 알림 규칙 문제 목록."""
    failures = []
    alerts: list[Alert] = []
    for f in sorted((prom_dir / "rules").glob("*.yml")):
        alerts += parse_alerts(f.read_text(encoding="utf-8"), f"{f.parent.parent.name}/{f.name}")
    seen: dict[str, Alert] = {}
    tested = tested_names(prom_dir / "tests") if (prom_dir / "tests").is_dir() else set()
    for a in alerts:
        where = f"{a.file}:{a.line} {a.name}"
        if a.name in seen:
            failures.append(f"{where}: 이름이 {seen[a.name].file}:{seen[a.name].line}과 겹친다")
        seen[a.name] = a
        failures += [f"{where}: {p}" for p in alert_problems(a)]
        if a.name not in tested:
            failures.append(f"{where}: tests/에 단위 시험(alertname: {a.name})이 없다")
    if not alerts:
        failures.append(f"{prom_dir}/rules: 알림 규칙이 하나도 없다")
    return failures


def datasource_uids(obs_dir: Path) -> set[str]:
    uids: set[str] = set()
    for f in (obs_dir / "grafana" / "provisioning" / "datasources").glob("*.yml"):
        uids.update(re.findall(r"^\s*uid:\s*(\S+)", f.read_text(encoding="utf-8"), re.M))
    return uids


def check_dashboards(obs_dir: Path) -> list[str]:
    failures = []
    uids = datasource_uids(obs_dir)
    seen_uid: dict[str, str] = {}
    seen_title: dict[str, str] = {}
    files = sorted((obs_dir / "grafana" / "dashboards").glob("*.json"))
    if not files:
        return [f"{obs_dir}/grafana/dashboards: 대시보드가 없다"]
    for f in files:
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except ValueError as e:
            failures.append(f"{f.name}: JSON이 아니다({e})")
            continue
        for key, seen in (("uid", seen_uid), ("title", seen_title)):
            v = d.get(key)
            if not v:
                failures.append(f"{f.name}: {key}가 없다")
            elif v in seen:
                failures.append(f"{f.name}: {key} {v!r}이(가) {seen[v]}와 겹친다")
            else:
                seen[v] = f.name
        ids = [p.get("id") for p in d.get("panels", [])]
        if len(ids) != len(set(ids)):
            failures.append(f"{f.name}: 패널 id가 겹친다")
        for p in d.get("panels", []):
            ds = (p.get("datasource") or {}).get("uid")
            if ds not in uids:
                failures.append(f"{f.name} 패널 {p.get('id')}: 데이터소스 uid {ds!r}가 프로비저닝에 없다({sorted(uids)})")
            for t in p.get("targets", []):
                if not t.get("expr"):
                    failures.append(f"{f.name} 패널 {p.get('id')}: 쿼리(expr)가 비었다")
                tds = (t.get("datasource") or {}).get("uid")
                if tds is not None and tds not in uids:
                    failures.append(f"{f.name} 패널 {p.get('id')}: 쿼리의 데이터소스 uid {tds!r}가 프로비저닝에 없다")
    return failures


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=".", help="저장소 루트")
    args = ap.parse_args(argv)
    root = Path(args.root)
    failures: list[str] = []
    checked = 0
    for obs in (root / "infra" / "obs", root / "infra" / "ops"):
        prom = obs / "prometheus"
        if (prom / "rules").is_dir():
            checked += 1
            failures += check_rules(prom)
        if (obs / "grafana" / "dashboards").is_dir():
            failures += check_dashboards(obs)
    if not checked:
        print("SKIP alerts (알림 규칙 없음)")
        return 0
    for f in failures:
        print(f"FAIL {f}")
    if failures:
        return 1
    print(f"OK alerts ({checked}개 스택)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
