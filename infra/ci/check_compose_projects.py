#!/usr/bin/env python3
"""compose-projects.txt의 각 프로젝트에 포트 불변식(ports_invariant.py)을 적용한다.

로컬 러너와 CI가 같은 코드로 프로젝트 목록을 순회하도록 셸 루프 대신 이 스크립트를 쓴다.
경로는 저장소 루트 기준이므로 루트에서 실행한다.
"""
from __future__ import annotations

import shlex
import sys
from pathlib import Path

import ports_invariant

MANIFEST = Path(__file__).with_name("compose-projects.txt")


def parse_manifest(text: str) -> list[tuple[str, list[str]]]:
    projects = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        label, *args = shlex.split(line)
        projects.append((label, args))
    return projects


def main(argv: list[str]) -> int:
    manifest = Path(argv[0]) if argv else MANIFEST
    projects = parse_manifest(manifest.read_text(encoding="utf-8"))
    if not projects:
        print("SKIP ports (compose 프로젝트 없음)")
        return 0
    failed = 0
    for label, args in projects:
        print(f"== {label}")
        if ports_invariant.main(args) != 0:
            failed += 1
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
