#!/usr/bin/env python3
"""env 파일 형식과 필수 키 검사. 값은 절대 출력하지 않는다.

규칙(스펙 12.4): KEY=VALUE 한 줄씩만 쓴다. 주석, 공백, 따옴표, CRLF, BOM, '#', '$', 백슬래시, 백틱을 금지한다.
소비자가 셋(compose --env-file 보간, 서비스 env_file:, docker run --env-file)이라 가장 보수적인 형식을 쓴다.
출력은 파일:줄과 규칙 이름뿐이며, 필수 키가 없을 때만 키 이름(비밀이 아님)을 적는다.
"""
from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]*$")
FORBIDDEN_VALUE_CHARS = frozenset(" \t\"'#$`\\")
BOM = b"\xef\xbb\xbf"


@dataclass(frozen=True)
class Issue:
    path: str
    line: int  # 0이면 파일 전체
    rule: str

    def __str__(self) -> str:
        where = f"{self.path}:{self.line}" if self.line else self.path
        return f"FAIL {where} {self.rule}"


def check_text(raw: bytes, path: str = "<memory>") -> tuple[list[Issue], dict[str, bool]]:
    """내용을 검사해 (이슈 목록, {키: 값이 비어 있지 않은가})를 돌려준다."""
    issues: list[Issue] = []
    keys: dict[str, bool] = {}
    if raw.startswith(BOM):
        issues.append(Issue(path, 1, "bom"))
        raw = raw[len(BOM):]
    if b"\r" in raw:
        issues.append(Issue(path, 0, "crlf"))
    text = raw.decode("utf-8", errors="replace").replace("\r", "")
    for n, line in enumerate(text.split("\n"), start=1):
        if line == "":
            continue
        if "=" not in line:
            issues.append(Issue(path, n, "not-key-value"))
            continue
        key, value = line.split("=", 1)
        if not KEY_RE.match(key):
            issues.append(Issue(path, n, "bad-key"))
            continue
        if key in keys:
            issues.append(Issue(path, n, "duplicate-key"))
        if any(c in FORBIDDEN_VALUE_CHARS or not c.isprintable() for c in value):  # 전각·NBSP 같은 공백 포함
            issues.append(Issue(path, n, "forbidden-char-in-value"))
        keys[key] = value != ""
    return issues, keys


def check_file(path: Path, required: set[str] | None = None) -> list[Issue]:
    issues, keys = check_text(path.read_bytes(), path.as_posix())
    for k in sorted(required or ()):
        if k not in keys:
            issues.append(Issue(path.as_posix(), 0, f"missing-required:{k}"))
        elif not keys[k]:
            issues.append(Issue(path.as_posix(), 0, f"empty-required:{k}"))
    return issues


def read_required(path: Path) -> set[str]:
    """필수 키 목록 파일: 한 줄에 키 하나, '#'로 시작하는 줄과 빈 줄은 무시."""
    lines = (l.strip() for l in path.read_text(encoding="utf-8").splitlines())
    return {l for l in lines if l and not l.startswith("#")}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("files", nargs="+")
    ap.add_argument("--required", help="필수 키 목록 파일(한 줄에 키 하나)")
    args = ap.parse_args(argv)
    required = read_required(Path(args.required)) if args.required else None
    issues: list[Issue] = []
    for f in args.files:
        issues += check_file(Path(f), required)
    for i in issues:
        print(i)
    if issues:
        print(f"{len(issues)} issue(s). 값은 출력하지 않는다. 형식 규칙은 docs/infra/design.md 12.4절.")
        return 1
    print(f"OK env ({len(args.files)} file(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
