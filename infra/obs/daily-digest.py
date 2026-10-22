#!/usr/bin/env python3
"""상태 요약(설계 10.1절). 서버 A에서 하루 두 번(09:00, 18:00 KST) 서버의 전체 상태를 Mattermost에 한 메시지로 올린다. 표준 라이브러리와 openssl 명령만 쓴다.

일반 글(제목 `#### Fit Dining · 전체 상태 · 월-일 시:분`과 표 셋)로 올린다. 알림 메시지와 달리 첨부(색 막대)가 아닌 것은 표가 어디서나 그대로 그려지게 하려는 것이다.
  1. 확인 필요: 울리는 알림과 요약만 아는 문제(디스크, CPU, 배포 실패, 인증서 만료 임박 등)를 구분(장애·주의), 내용, 런북 번호로 보여 준다. 없으면 없다고 적는다.
  2. 서비스: prod BE, dev BE, 엣지, DB, 검색, 금고(B)가 떠 있는지(✅, ❌, 값이 없으면 ❔).
  3. 백업: pg, photos, caddy의 마지막 성공과 복원 검증 결과.
정상인 값(디스크, 메모리, CPU, 배포, 인증서 등)은 문제가 생겼을 때만 확인 필요에 나온다. 알림 채널이 한 번 놓쳐져도 하루 두 번은 상태를 본다.
Prometheus에 닿지 못해도 그 사실을 올리고 종료 코드 1로 끝한다.

  python3 infra/obs/daily-digest.py [--dry-run]
옵션(기본값은 서버의 경로다. 시험이 바꾼다): --prom URL(http://127.0.0.1:9090) --state-dir(/srv/fit/state) --obs-env(/etc/fit/obs.env, 웹훅 주소를 읽는다)
  --edge-env(/etc/fit/edge.env, PROD_HOST와 DEV_HOST만 읽는다) --tls-connect 주소(127.0.0.1, 인증서를 읽을 곳) --dry-run(올리지 않고 출력만 한다)
웹훅 주소와 비밀 값은 출력하지 않는다.
"""
from __future__ import annotations

import argparse
import datetime
import json
import pathlib
import re
import subprocess
import sys
import urllib.parse
import urllib.request

OK, WARN, BAD, NONE = "✅", "⚠️", "❌", "❔"
CRIT_CELL, WARN_CELL = "🔴 장애", "🟡 주의"
KST = datetime.timezone(datetime.timedelta(hours=9))
# 알림 규칙의 기준과 같다(infra/obs/prometheus/rules)
DISK_WARN, MEM_WARN, SWAP_WARN, CPU_WARN, CERT_WARN_DAYS = 0.8, 0.08, 0.5, 0.4, 14
BACKUP_LIMITS = {"pg": 8 * 3600, "photos": 36 * 3600, "caddy": 9 * 86400}
# 이 점검에 해당하는 알림이 이미 울리고 있으면 같은 문제를 확인 필요에 두 번 적지 않는다(알림 이름 접두사)
COVERED_BY = {
    "disk": ("FitDisk",), "memory": ("FitMemory",), "swap": ("FitSwap",), "cpu": ("FitCpu",),
    "backup": ("FitBackup",), "verify": ("FitBackupVerify",), "app": ("FitHttp", "FitBatch", "FitBe"),
}

Problem = tuple[str, str, str]  # (구분 칸, 내용, 런북)


def read_env(path: str, keys: set[str]) -> dict[str, str]:
    """KEY=VALUE 파일에서 지정한 키만 읽는다(값을 쓰지 않는 다른 키는 메모리에도 담지 않는다)."""
    found: dict[str, str] = {}
    p = pathlib.Path(path)
    if not p.is_file():
        return found
    for line in p.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.partition("=")
        if sep and key in keys:
            found[key] = value
    return found


class Prom:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")

    def get(self, path: str) -> dict:
        with urllib.request.urlopen(f"{self.base}{path}", timeout=15) as resp:
            body = json.load(resp)
        if body.get("status") != "success":
            raise RuntimeError(f"Prometheus가 요청을 거부했다: {path}")
        return body["data"]

    def query(self, expr: str) -> list[tuple[dict[str, str], float]]:
        data = self.get(f"/api/v1/query?query={urllib.parse.quote(expr)}")
        return [(r["metric"], float(r["value"][1])) for r in data["result"]]

    def scalar(self, expr: str) -> float | None:
        rows = self.query(expr)
        return rows[0][1] if rows else None

    def firing_alerts(self) -> list[dict]:
        return [a for a in self.get("/api/v1/alerts")["alerts"] if a.get("state") == "firing"]


def short_age(seconds: float) -> str:
    seconds = max(0, int(seconds))
    if seconds < 60:
        return "방금"
    if seconds < 3600:
        return f"{seconds // 60}분 전"
    if seconds < 2 * 86400:
        return f"{seconds // 3600}시간 전"
    return f"{seconds // 86400}일 전"


def pct(value: float) -> str:
    return f"{value * 100:.0f}%"


def alert_problems(prom: Prom) -> tuple[list[Problem], list[str]]:
    """울리는 알림(critical 먼저)과 그 알림 이름들."""
    alerts = prom.firing_alerts()
    alerts.sort(key=lambda a: (a["labels"].get("severity") != "critical", a["labels"].get("alertname", "")))
    problems = []
    for a in alerts:
        ann = a.get("annotations", {})
        cell = CRIT_CELL if a["labels"].get("severity") == "critical" else WARN_CELL
        problems.append((cell, ann.get("summary", a["labels"].get("alertname", "?")), ann.get("runbook", "-")))
    return problems, [a["labels"].get("alertname", "") for a in alerts]


def service_cells(prom: Prom) -> list[tuple[str, str]]:
    """서비스 표의 (이름, 표시). 값이 없으면 ❔."""
    items = (
        ("prod BE", 'max(up{job="be", env="prod"})'),
        ("dev BE", 'max(up{job="be", env="dev"})'),
        ("엣지", 'max(up{job="caddy"})'),
        ("DB", "max(pg_up)"),
        ("검색", "max(elasticsearch_clusterinfo_up)"),
        ("금고(B)", 'max(probe_success{job="vault-ssh"})'),
    )
    cells = []
    for label, expr in items:
        v = prom.scalar(expr)
        cells.append((label, NONE if v is None else (OK if v >= 1 else BAD)))
    return cells


def metric_problems(prom: Prom) -> list[tuple[str, str]]:
    """알림이 없어도 요약이 알려야 하는 호스트·앱의 문제. (점검 이름, 내용)."""
    out: list[tuple[str, str]] = []
    fs = '{mountpoint="/", fstype!~"tmpfs|overlay"}'
    disk = prom.scalar(f"1 - node_filesystem_avail_bytes{fs} / node_filesystem_size_bytes{fs}")
    if disk is not None and disk >= DISK_WARN:
        out.append(("disk", f"디스크 사용률 {pct(disk)}(경고 {pct(DISK_WARN)})"))
    mem = prom.scalar("node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes")
    if mem is not None and mem < MEM_WARN:
        out.append(("memory", f"가용 메모리 {pct(mem)}(경고 {pct(MEM_WARN)} 미만)"))
    if prom.scalar("node_memory_SwapTotal_bytes"):
        swap = prom.scalar("1 - node_memory_SwapFree_bytes / node_memory_SwapTotal_bytes")
        if swap is not None and swap > SWAP_WARN:
            out.append(("swap", f"스왑 사용률 {pct(swap)}(경고 {pct(SWAP_WARN)})"))
    # 24시간 창을 rate로 보면 데이터가 24시간보다 짧을 때 사용률이 부풀려진다. 5분 사용률의 평균을 쌓인 데이터만으로 낸다
    cpu = prom.scalar('avg_over_time((1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])))[24h:5m])')
    if cpu is not None and cpu > CPU_WARN:
        full = prom.scalar('count(node_cpu_seconds_total{mode="idle"} offset 24h)') is not None
        out.append(("cpu", f"CPU 24시간 평균 {pct(cpu)}{'' if full else '(쌓인 기간)'}(기준선 {pct(CPU_WARN)})"))
    n5xx = prom.scalar('sum(increase(http_server_requests_seconds_count{env="prod", status=~"5.."}[24h]))')
    if n5xx and n5xx > 0:
        out.append(("app", f"prod 5xx {n5xx:.0f}건(24시간)"))
    age = prom.scalar('time() - max(batch_last_success_timestamp_seconds{env="prod"})')
    if age is not None and age > 26 * 3600:
        out.append(("app", f"새벽 배치 마지막 성공 {short_age(age)}(경고 26시간 초과)"))
    return out


def backup_table(prom: Prom) -> tuple[list[str], list[str], bool, str | None]:
    """백업 표의 머리글과 값, 표시(⚠️)가 있는지, 복원 검증이 실패했으면 그 내용."""
    ages = {m["kind"]: v for m, v in prom.query("time() - fit_backup_last_success_timestamp_seconds")}
    never = {m["kind"] for m, _ in prom.query("fit_backup_last_success_timestamp_seconds == 0")}  # 0은 한 번도 성공한 적이 없다는 뜻이다
    heads, cells, flagged = [], [], False
    for kind, limit in BACKUP_LIMITS.items():
        heads.append(kind)
        if kind in never:
            cells.append(f"없음 {WARN}")
            flagged = True
        elif kind in ages:
            bad = ages[kind] > limit
            cells.append(short_age(ages[kind]) + (f" {WARN}" if bad else ""))
            flagged |= bad
        else:
            cells.append(NONE)
    verify = prom.scalar("fit_backup_last_verify_ok")
    heads.append("복원 검증")
    failed = None
    if verify is None:
        cells.append(NONE)
    elif verify == 1:
        cells.append("통과")
    else:
        cells.append(f"실패 {WARN}")
        flagged = True
        failed = "마지막 덤프 복원 검증이 실패했다"
    return heads, cells, flagged, failed


def deploy_problems(state_dir: str) -> list[str]:
    """마지막 배포가 실패한 환경."""
    problems = []
    for env in ("prod", "dev"):
        log = pathlib.Path(state_dir) / f"history-{env}.log"
        last = ""
        if log.is_file():
            for line in log.read_text(encoding="utf-8").splitlines():
                fields = line.split()
                if len(fields) >= 5 and fields[1] in ("deploy-end", "rollback"):
                    last = line
        if not last:
            continue
        ts, action, _svc, _sha, result = last.split()[:5]
        if action == "deploy-end" and not result.startswith("ok"):
            when = datetime.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc).astimezone(KST)
            problems.append(f"{env} 배포가 실패했다({when:%m-%d %H:%M})")
    return problems


def cert_days(host: str, connect: str) -> float:
    """host의 인증서 만료까지 남은 일수. 서버 자신(connect)의 443에서 SNI로 읽는다."""
    s_client = subprocess.run(
        ["openssl", "s_client", "-connect", f"{connect}:443", "-servername", host],
        input=b"", capture_output=True, timeout=20, check=True,
    )
    end = subprocess.run(["openssl", "x509", "-noout", "-enddate"], input=s_client.stdout, capture_output=True, timeout=10, check=True)
    text = end.stdout.decode().strip().removeprefix("notAfter=")
    expires = datetime.datetime.strptime(text, "%b %d %H:%M:%S %Y GMT").replace(tzinfo=datetime.timezone.utc)
    return (expires - datetime.datetime.now(datetime.timezone.utc)).total_seconds() / 86400


def cert_problems(hosts: list[tuple[str, str]], connect: str) -> list[str]:
    """곧 만료되거나 읽지 못한 인증서."""
    problems = []
    for label, host in hosts:
        try:
            days = cert_days(host, connect)
        except (OSError, subprocess.SubprocessError, ValueError):
            problems.append(f"{label} 인증서를 읽지 못했다")
            continue
        if days < CERT_WARN_DAYS:
            problems.append(f"{label} 인증서가 {days:.0f}일 뒤 만료된다(경고 {CERT_WARN_DAYS}일)")
    return problems


def table(heads: list[str], cells: list[str]) -> list[str]:
    """머리글 한 줄과 값 한 줄짜리 가운데 정렬 표."""
    return ["| " + " | ".join(heads) + " |", "|" + ":-:|" * len(heads), "| " + " | ".join(cells) + " |"]


def render(now: datetime.datetime, problems: list[Problem], services: list[tuple[str, str]], backup: tuple[list[str], list[str]] | None,
           warn_flag: bool = False) -> tuple[str, str]:
    """제목과 본문(표 셋)."""
    crit = sum(1 for p in problems if p[0] == CRIT_CELL)
    warn = len(problems) - crit
    down = any(mark == BAD for _, mark in services)
    if crit:
        summary = f"장애 {crit}건" + (f" · 주의 {warn}건" if warn else "")
    elif warn or down or warn_flag:
        summary = f"주의 {warn}건" if warn else "주의"
    else:
        summary = "정상"
    title = f"Fit Dining · {summary} · {now.astimezone(KST):%m-%d %H:%M}"
    body: list[str] = []
    if problems:
        body += ["| 구분 | 확인 필요 | 런북 |", "|:-:|:--|:-:|", *[f"| {c} | {text} | {rb} |" for c, text, rb in problems]]
    else:
        body += ["확인 필요한 항목이 없다."]
    body += ["", *table([n for n, _ in services], [m for _, m in services])]
    if backup:
        heads, cells = backup
        body += ["", "| 백업 | " + " | ".join(heads) + " |", "|:--" + "|:-:" * len(heads) + "|", "| 마지막 성공 | " + " | ".join(cells) + " |"]
    return title, "\n".join(body)


def post(url: str, title: str, body: str) -> None:
    """일반 글로 올린다(제목은 #### 제목, 본문은 표 셋). 채팅에 직접 쳐서 확인한 것과 같은 모양이다."""
    data = json.dumps({"text": f"#### {title}\n\n{body}"}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json; charset=utf-8"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        if resp.status >= 300:
            raise RuntimeError(f"웹훅이 {resp.status}를 돌려줬다")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prom", default="http://127.0.0.1:9090")
    ap.add_argument("--state-dir", default="/srv/fit/state")
    ap.add_argument("--obs-env", default="/etc/fit/obs.env")
    ap.add_argument("--edge-env", default="/etc/fit/edge.env")
    ap.add_argument("--tls-connect", default="127.0.0.1")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    webhook = read_env(args.obs_env, {"MATTERMOST_WEBHOOK_URL"}).get("MATTERMOST_WEBHOOK_URL", "")
    if not args.dry_run and not re.match(r"^https?://\S+$", webhook):
        print(f"FAIL {args.obs_env}에서 MATTERMOST_WEBHOOK_URL을 읽지 못했다", file=sys.stderr)
        return 1
    hosts_env = read_env(args.edge_env, {"PROD_HOST", "DEV_HOST"})
    hosts = [(label, hosts_env[key]) for label, key in (("prod", "PROD_HOST"), ("dev", "DEV_HOST")) if hosts_env.get(key)]

    now = datetime.datetime.now(datetime.timezone.utc)
    prom = Prom(args.prom)
    status = 0
    problems: list[Problem] = []
    services: list[tuple[str, str]] = []
    backup = None
    backup_flag = False
    try:
        problems, alert_names = alert_problems(prom)
        services = service_cells(prom)
        for key, text in metric_problems(prom):
            if not any(n.startswith(COVERED_BY[key]) for n in alert_names):
                problems.append((WARN_CELL, text, "-"))
        heads, cells, backup_flag, verify_failed = backup_table(prom)
        backup = (heads, cells)
        if verify_failed and not any(n.startswith(COVERED_BY["verify"]) for n in alert_names):
            problems.append((WARN_CELL, verify_failed, "-"))
    except (OSError, RuntimeError, KeyError, ValueError, TypeError) as e:
        problems = [(CRIT_CELL, f"Prometheus에서 값을 읽지 못했다({type(e).__name__}). 관측 스택을 먼저 본다(bash infra/obs/verify-obs.sh)", "-")]
        services, backup = [], None
        status = 1
    for text in deploy_problems(args.state_dir) + cert_problems(hosts, args.tls_connect):
        problems.append((WARN_CELL, text, "-"))
    title, body = render(now, problems, services, backup, backup_flag)
    print(f"#### {title}\n\n{body}")
    if args.dry_run:
        return status
    try:
        post(webhook, title, body)
    except (OSError, RuntimeError) as e:
        print(f"FAIL 웹훅으로 보내지 못했다({type(e).__name__})", file=sys.stderr)
        return 1
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
