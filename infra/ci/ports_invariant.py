#!/usr/bin/env python3
"""compose 포트 노출 불변식 검사 (스펙 13.1).

규칙
  1. 호스트에 게시하는 포트는 host_ip가 127.0.0.1이어야 한다. host_ip가 없는 짧은 문법(`8080:80`)은 0.0.0.0이다.
  2. 예외는 (서비스, 호스트 포트) 조합으로 명시한 것뿐이다. 기본값은 caddy=80,443이고 --allow로 더한다.
  3. network_mode: host는 모든 포트를 노출하므로 --allow-host-network로 명시한 서비스만 허용한다.

Docker가 게시한 포트는 ufw를 우회하므로 이 검사가 노출 사고(A603)를 막는 1차 방어선이다.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys

LOOPBACK = frozenset({"127.0.0.1", "::1", "localhost"})
DEFAULT_ALLOW: dict[str, set[int]] = {"caddy": {80, 443}}


def violations(
    config: dict,
    allow: dict[str, set[int]] | None = None,
    allow_host_network: set[str] | None = None,
) -> list[str]:
    allow = DEFAULT_ALLOW if allow is None else allow
    allow_host_network = allow_host_network or set()
    out: list[str] = []
    for name, svc in sorted((config.get("services") or {}).items()):
        if svc.get("network_mode") == "host" and name not in allow_host_network:
            out.append(f"{name}: network_mode host")
        for p in svc.get("ports") or []:
            host_ip = p.get("host_ip") or ""
            if host_ip in LOOPBACK:
                continue
            published = p.get("published")
            try:
                port = int(published) if published not in (None, "") else None
            except ValueError:  # "8000-8010" 같은 범위
                port = None
            if port is not None and port in allow.get(name, set()) and p.get("protocol", "tcp") == "tcp":
                continue
            out.append(f"{name}: {host_ip or '0.0.0.0'}:{published or '?'} -> {p.get('target')}")
    return out


def load_config(compose_files: list[str], env_files: list[str] | None = None) -> dict:
    cmd = ["docker", "compose"]
    for e in env_files or []:
        cmd += ["--env-file", e]
    for f in compose_files:
        cmd += ["-f", f]
    cmd += ["--profile", "*", "config", "--format", "json"]  # profile 뒤에 숨은 서비스도 검사한다
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError("docker compose config failed: " + r.stderr.decode(errors="replace").strip())
    return json.loads(r.stdout)


def parse_allow(items: list[str]) -> dict[str, set[int]]:
    allow = {k: set(v) for k, v in DEFAULT_ALLOW.items()}
    for item in items:
        name, _, ports = item.partition("=")
        allow.setdefault(name, set()).update(int(p) for p in ports.split(",") if p)
    return allow


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("compose_files", nargs="+", help="한 프로젝트를 이루는 compose 파일들(병합해서 검사)")
    ap.add_argument("--env-file", action="append", default=[])
    ap.add_argument("--allow", action="append", default=[], metavar="SERVICE=PORT[,PORT]")
    ap.add_argument("--allow-host-network", action="append", default=[], metavar="SERVICE")
    args = ap.parse_args(argv)
    try:
        config = load_config(args.compose_files, args.env_file)
    except RuntimeError as e:
        print(f"FAIL {e}")
        return 1
    bad = violations(config, parse_allow(args.allow), set(args.allow_host_network))
    for v in bad:
        print(f"FAIL {v}")
    if bad:
        print("호스트 게시 포트는 127.0.0.1:로 바인딩해야 한다(공개는 caddy만). 스펙 13.1절.")
        return 1
    print(f"OK ports ({len(config.get('services') or {})} service(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
