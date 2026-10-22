#!/usr/bin/env python3
"""일일 점검 요약(설계 10.1절). 서버 A에서 매일 09:00 KST에 돌아 Mattermost에 한 건을 올린다. 표준 라이브러리와 openssl 명령만 쓴다.

항목: 디스크·메모리·스왑, CPU 24시간 평균(40% 기준선 대비), 백업 나이, 마지막 배포, 인증서 잔여일, 5xx 건수, 배치 결과, 지금 울리는 알림.
알림이 한 번 놓쳐져도(알림 채널 중단) 하루에 한 번은 상태를 본다. Prometheus에 닿지 못해도 그 사실을 올리고 종료 코드 1로 끝난다.

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

OK, WARN, NONE = "✅", "⚠️", "❔"
KST = datetime.timezone(datetime.timedelta(hours=9))


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

    def query(self, expr: str) -> list[tuple[dict[str, str], float]]:
        url = f"{self.base}/api/v1/query?query={urllib.parse.quote(expr)}"
        with urllib.request.urlopen(url, timeout=15) as resp:
            body = json.load(resp)
        if body.get("status") != "success":
            raise RuntimeError(f"Prometheus가 질의를 거부했다: {expr}")
        return [(r["metric"], float(r["value"][1])) for r in body["data"]["result"]]

    def scalar(self, expr: str) -> float | None:
        rows = self.query(expr)
        return rows[0][1] if rows else None


def human_age(seconds: float) -> str:
    seconds = max(0, int(seconds))
    if seconds < 3600:
        return f"{seconds // 60}분 전"
    if seconds < 86400:
        return f"{seconds // 3600}시간 {seconds % 3600 // 60}분 전"
    return f"{seconds // 86400}일 {seconds % 86400 // 3600}시간 전"


def pct(value: float) -> str:
    return f"{value * 100:.0f}%"


def host_rows(prom: Prom) -> list[tuple[str, str, str]]:
    rows: list[tuple[str, str, str]] = []
    fs = '{mountpoint="/", fstype!~"tmpfs|overlay"}'
    disk = prom.scalar(f"1 - node_filesystem_avail_bytes{fs} / node_filesystem_size_bytes{fs}")
    rows.append(("디스크(/)", f"{pct(disk)} 사용 (경고 80%)", OK if disk < 0.8 else WARN) if disk is not None else ("디스크(/)", "지표 없음", NONE))
    mem = prom.scalar("node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes")
    rows.append(("메모리", f"가용 {pct(mem)} (경고 8% 미만)", OK if mem >= 0.08 else WARN) if mem is not None else ("메모리", "지표 없음", NONE))
    swap_total = prom.scalar("node_memory_SwapTotal_bytes")
    if swap_total is None:
        rows.append(("스왑", "지표 없음", NONE))
    elif swap_total == 0:
        rows.append(("스왑", "스왑이 없다", OK))
    else:
        swap = prom.scalar("1 - node_memory_SwapFree_bytes / node_memory_SwapTotal_bytes")
        rows.append(("스왑", f"{pct(swap)} 사용 (경고 50%)", OK if swap <= 0.5 else WARN) if swap is not None else ("스왑", "지표 없음", NONE))
    # 24시간 창을 rate로 보면 데이터가 24시간보다 짧을 때 사용률이 부풀려진다. 5분 사용률의 평균을 쌓인 데이터만으로 낸다
    cpu = prom.scalar('avg_over_time((1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])))[24h:5m])')
    full = prom.scalar('count(node_cpu_seconds_total{mode="idle"} offset 24h)') is not None
    note = "기준선 40%" if full else "기준선 40%, 쌓인 데이터만"
    rows.append(("CPU 24시간 평균", f"{pct(cpu)} ({note})", OK if cpu <= 0.4 else WARN) if cpu is not None else ("CPU 24시간 평균", "지표 없음", NONE))
    return rows


def backup_rows(prom: Prom) -> list[tuple[str, str, str]]:
    limits = {"pg": 8 * 3600, "photos": 36 * 3600, "caddy": 9 * 86400}
    rows: list[tuple[str, str, str]] = []
    ages = {m["kind"]: v for m, v in prom.query("time() - fit_backup_last_success_timestamp_seconds")}
    never = {m["kind"] for m, _ in prom.query("fit_backup_last_success_timestamp_seconds == 0")}  # 0은 한 번도 성공한 적이 없다는 뜻이다
    for kind, limit in limits.items():
        if kind in never:
            rows.append((f"백업 {kind}", "아직 성공한 적이 없다", WARN))
        elif kind in ages:
            rows.append((f"백업 {kind}", f"마지막 성공 {human_age(ages[kind])} (경고 {human_age(limit).replace(' 전', '')} 초과)", OK if ages[kind] <= limit else WARN))
        else:
            rows.append((f"백업 {kind}", "지표 없음", NONE))
    verify = prom.scalar("fit_backup_last_verify_ok")
    rows.append(("백업 복원 검증", "마지막 검증 통과" if verify == 1 else "마지막 검증 실패", OK if verify == 1 else WARN) if verify is not None else ("백업 복원 검증", "지표 없음", NONE))
    return rows


def deploy_rows(state_dir: str) -> list[tuple[str, str, str]]:
    rows: list[tuple[str, str, str]] = []
    for env in ("prod", "dev"):
        log = pathlib.Path(state_dir) / f"history-{env}.log"
        last = ""
        if log.is_file():
            for line in log.read_text(encoding="utf-8").splitlines():
                parts = line.split()
                if len(parts) >= 5 and parts[1] in ("deploy-end", "rollback"):
                    last = line
        if not last:
            rows.append((f"마지막 배포({env})", "기록 없음", NONE))
            continue
        ts, action, _svc, sha, result = last.split()[:5]
        who = last.split()[5] if len(last.split()) > 5 else "?"
        when = datetime.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc).astimezone(KST)
        what = "배포" if action == "deploy-end" else "롤백"
        rows.append((f"마지막 배포({env})", f"{when:%m-%d %H:%M} KST {what} {result} {sha[:12]} ({who})", OK if result.startswith("ok") or action == "rollback" else WARN))
    return rows


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


def cert_rows(hosts: list[tuple[str, str]], connect: str) -> list[tuple[str, str, str]]:
    rows: list[tuple[str, str, str]] = []
    for label, host in hosts:
        try:
            days = cert_days(host, connect)
        except (OSError, subprocess.SubprocessError, ValueError):
            rows.append((f"인증서({label})", "읽지 못했다", WARN))
            continue
        rows.append((f"인증서({label})", f"만료까지 {days:.0f}일 (경고 14일)", OK if days >= 14 else WARN))
    return rows


def app_rows(prom: Prom) -> list[tuple[str, str, str]]:
    rows: list[tuple[str, str, str]] = []
    n5xx = prom.scalar('sum(increase(http_server_requests_seconds_count{env="prod", status=~"5.."}[24h]))')
    total = prom.scalar('sum(increase(http_server_requests_seconds_count{env="prod"}[24h]))')
    if total is None:
        rows.append(("5xx(24시간)", "지표 없음", NONE))
    else:
        count = n5xx or 0
        rows.append(("5xx(24시간)", f"{count:.0f}건 / 전체 {total:.0f}건", OK if count == 0 else WARN))
    age = prom.scalar('time() - max(batch_last_success_timestamp_seconds{env="prod"})')
    rows.append(("새벽 배치", f"마지막 성공 {human_age(age)} (경고 26시간 초과)", OK if age <= 26 * 3600 else WARN) if age is not None else ("새벽 배치", "지표 없음", NONE))
    return rows


def alert_rows(prom: Prom) -> list[tuple[str, str, str]]:
    firing = sorted({m["alertname"] for m, _ in prom.query('ALERTS{alertstate="firing"}')})
    if not firing:
        return [("지금 울리는 알림", "없음", OK)]
    return [("지금 울리는 알림", f"{len(firing)}종: " + ", ".join(firing), WARN)]


def render(now: datetime.datetime, rows: list[tuple[str, str, str]], notes: list[str]) -> str:
    lines = [f"#### Fit Dining 일일 점검 ({now.astimezone(KST):%Y-%m-%d %H:%M} KST)", "", "| 항목 | 상태 | 값 |", "|---|---|---|"]
    lines += [f"| {name} | {mark} | {value} |" for name, value, mark in rows]
    warn = sum(1 for r in rows if r[2] == WARN)
    lines += ["", f"주의 {warn}건." if warn else "모든 항목이 정상 범위다."]
    lines += notes
    return "\n".join(lines)


def post(url: str, text: str) -> None:
    data = json.dumps({"text": text}, ensure_ascii=False).encode("utf-8")
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
    rows: list[tuple[str, str, str]] = []
    notes: list[str] = []
    status = 0
    prom = Prom(args.prom)
    try:
        rows += host_rows(prom)
        rows += backup_rows(prom)
        rows += app_rows(prom)
        rows += alert_rows(prom)
    except (OSError, RuntimeError, KeyError, ValueError) as e:
        notes.append(f"Prometheus에서 값을 읽지 못했다({type(e).__name__}). 관측 스택을 먼저 본다(bash infra/obs/verify-obs.sh).")
        status = 1
    rows += deploy_rows(args.state_dir)
    rows += cert_rows(hosts, args.tls_connect)
    text = render(now, rows, notes)
    print(text)
    if args.dry_run:
        return status
    try:
        post(webhook, text)
    except (OSError, RuntimeError) as e:
        print(f"FAIL 웹훅으로 보내지 못했다({type(e).__name__})", file=sys.stderr)
        return 1
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
