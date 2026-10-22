#!/usr/bin/env python3
"""포트 노출 감사(설계 9.3절). B가 A를 밖에서 TCP로 두드려 22·80·443 말고 열린 포트가 있는지 본다. 표준 라이브러리만 쓴다.

  python3 infra/ops/port-audit.py --target <A의 호스트> --mode quick|full [--expected 22,80,443] [--out /srv/vault/metrics]

quick은 잘 알려진 포트(1~1024와 자주 쓰는 서비스 포트)를 15분마다, full은 1~65535 전체를 매일 본다. 결과는 Prometheus textfile 형식
(`fit_portaudit_<mode>.prom`)으로 쓰고 node-exporter가 읽는다. 예상 밖 포트가 열려 있어도 종료 코드는 0이다(알림은 지표가 건다).
이름을 풀지 못하는 등 감사를 하지 못하면 종료 코드 1이고 지표를 갱신하지 않는다(오래된 지표는 FitPortAuditStale이 잡는다).
이 스캔은 우리 서버(A)에만 건다. 다른 호스트에 쓰지 않는다.
"""
from __future__ import annotations

import argparse
import asyncio
import pathlib
import re
import socket
import sys
import time

# quick 스캔에 1~1024와 함께 보는 서비스 포트(DB, 캐시, 관리 UI, 이 프로젝트가 쓰는 내부 포트 등)
EXTRA = [
    1433, 1521, 2049, 2375, 2376, 2379, 3000, 3306, 3389, 4222, 5000, 5432, 5601, 5672, 5900, 6379, 6443, 7000,
    8000, 8008, 8080, 8081, 8082, 8086, 8443, 8500, 8888, 9000, 9042, 9090, 9093, 9100, 9115, 9180, 9200, 9300,
    9411, 11211, 15432, 15672, 16379, 19200, 27017, 50000,
]
HOST = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$")


def ports_for(mode: str) -> list[int]:
    if mode == "full":
        return list(range(1, 65536))
    return sorted(set(range(1, 1025)) | set(EXTRA))


async def probe(host: str, port: int, timeout: float, sem: asyncio.Semaphore) -> int | None:
    async with sem:
        try:
            _, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout)
        except (OSError, asyncio.TimeoutError):
            return None
        writer.close()
        try:
            await writer.wait_closed()
        except OSError:
            pass
        return port


async def scan(host: str, ports: list[int], timeout: float, concurrency: int) -> list[int]:
    sem = asyncio.Semaphore(concurrency)
    found = await asyncio.gather(*(probe(host, p, timeout, sem) for p in ports))
    return sorted(p for p in found if p is not None)


def render(mode: str, started: float, duration: float, open_ports: list[int], expected: set[int]) -> str:
    unexpected = [p for p in open_ports if p not in expected]
    lines = [
        "# HELP fit_portaudit_last_scan_timestamp_seconds 마지막으로 스캔을 끝낸 시각(UTC epoch)",
        "# TYPE fit_portaudit_last_scan_timestamp_seconds gauge",
        f'fit_portaudit_last_scan_timestamp_seconds{{mode="{mode}"}} {int(started + duration)}',
        "# HELP fit_portaudit_scan_duration_seconds 스캔에 걸린 시간",
        "# TYPE fit_portaudit_scan_duration_seconds gauge",
        f'fit_portaudit_scan_duration_seconds{{mode="{mode}"}} {duration:.1f}',
        "# HELP fit_portaudit_open_ports 밖에서 열려 있는 포트 수",
        "# TYPE fit_portaudit_open_ports gauge",
        f'fit_portaudit_open_ports{{mode="{mode}"}} {len(open_ports)}',
        "# HELP fit_portaudit_unexpected_ports 예상(22, 80, 443) 밖에서 열려 있는 포트 수",
        "# TYPE fit_portaudit_unexpected_ports gauge",
        f'fit_portaudit_unexpected_ports{{mode="{mode}"}} {len(unexpected)}',
        "# HELP fit_portaudit_port_open 예상 밖에서 열려 있는 포트(값은 항상 1)",
        "# TYPE fit_portaudit_port_open gauge",
    ]
    lines += [f'fit_portaudit_port_open{{mode="{mode}",port="{p}"}} 1' for p in unexpected]
    return "\n".join(lines) + "\n"


def write_atomic(path: pathlib.Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    tmp.chmod(0o644)
    tmp.replace(path)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", required=True, help="스캔할 호스트(A의 공개 호스트 이름이나 IP)")
    ap.add_argument("--mode", choices=["quick", "full"], required=True)
    ap.add_argument("--expected", default="22,80,443", help="열려 있어야 하는 포트(쉼표)")
    ap.add_argument("--out", default="/srv/vault/metrics", help="지표 파일을 쓸 디렉터리")
    ap.add_argument("--timeout", type=float, default=None, help="포트마다 기다리는 초(기본 quick 3, full 1.5)")
    ap.add_argument("--concurrency", type=int, default=500)
    args = ap.parse_args(argv)
    if not HOST.match(args.target) and not re.match(r"^\d{1,3}(\.\d{1,3}){3}$", args.target):
        print("FAIL --target은 호스트 이름이나 IPv4 주소여야 한다", file=sys.stderr)
        return 1
    try:
        expected = {int(p) for p in args.expected.split(",") if p}
    except ValueError:
        print("FAIL --expected는 쉼표로 구분한 포트 번호다", file=sys.stderr)
        return 1
    try:
        ip = socket.getaddrinfo(args.target, None, socket.AF_INET)[0][4][0]
    except OSError as e:
        print(f"FAIL {args.target}의 주소를 찾지 못했다({e})", file=sys.stderr)
        return 1
    timeout = args.timeout if args.timeout is not None else (3.0 if args.mode == "quick" else 1.5)
    started = time.time()
    open_ports = asyncio.run(scan(ip, ports_for(args.mode), timeout, args.concurrency))
    duration = time.time() - started
    unexpected = [p for p in open_ports if p not in expected]
    write_atomic(pathlib.Path(args.out) / f"fit_portaudit_{args.mode}.prom", render(args.mode, started, duration, open_ports, expected))
    print(f"{args.mode} 스캔 {duration:.1f}초: 열린 포트 {open_ports}, 예상 밖 {unexpected}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
