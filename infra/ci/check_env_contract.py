#!/usr/bin/env python3
"""env 계약(docs/infra/contracts/env.md)과 예제 파일(*.env.example)의 키가 일치하는지 검사한다. 값은 읽어도 출력하지 않는다.

계약 문서의 표를 읽는다.
  파일 대응 표: 첫 칸이 `그룹`(소문자), 둘째 칸이 `예제 파일 경로`인 행
  키 목록 표:   첫 칸이 `KEY`(대문자), 둘째 칸이 그룹(쉼표로 여러 개), 셋째 칸이 필수 여부(O 또는 X)인 행

규칙(출력은 `FAIL <파일>[:줄] <규칙> <키·그룹·경로>` 형식이고 값은 싣지 않는다):
  unknown-key        예제 파일에 있는 키가 계약에 없다(그 그룹의 키가 아니어도 같다)
  missing-required   계약에서 필수인 키가 예제 파일에 없다
  missing-file       계약이 가리키는 예제 파일이 없다
  unknown-group      키 목록이 파일 대응 표에 없는 그룹을 쓴다
  duplicate-row      같은 키와 그룹이 두 번 나온다
  bad-required-flag  필수 칸이 O나 X가 아니다
  empty-contract     키 목록이 비어 있다
"""
from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import check_env_files

DEFAULT_CONTRACT = "docs/infra/contracts/env.md"
GROUP_RE = re.compile(r"^`([a-z][a-z0-9-]*)`$")
KEY_RE = re.compile(r"^`([A-Z][A-Z0-9_]*)`$")
PATH_RE = re.compile(r"^`([^`]+)`$")


@dataclass(frozen=True)
class Issue:
    path: str
    line: int  # 0이면 파일 전체
    rule: str
    detail: str

    def __str__(self) -> str:
        where = f"{self.path}:{self.line}" if self.line else self.path
        return f"FAIL {where} {self.rule} {self.detail}"


def split_cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def check_contract(text: str, root: Path, contract_path: str = "<contract>") -> list[Issue]:
    issues: list[Issue] = []
    files: dict[str, str] = {}
    rows: list[tuple[int, str, list[str], bool]] = []  # (줄, 키, 그룹들, 필수)
    seen: set[tuple[str, str]] = set()
    for n, line in enumerate(text.splitlines(), start=1):
        if not line.startswith("|"):
            continue
        cells = split_cells(line)
        if len(cells) < 2:
            continue
        group = GROUP_RE.match(cells[0])
        key = KEY_RE.match(cells[0])
        if group and PATH_RE.match(cells[1]):
            files[group.group(1)] = PATH_RE.match(cells[1]).group(1)
        elif key and len(cells) >= 3:
            groups = [g.strip() for g in cells[1].split(",") if g.strip()]
            if cells[2] not in ("O", "X"):
                issues.append(Issue(contract_path, n, "bad-required-flag", key.group(1)))
            for g in groups:
                if (key.group(1), g) in seen:
                    issues.append(Issue(contract_path, n, "duplicate-row", f"{key.group(1)}/{g}"))
                seen.add((key.group(1), g))
            rows.append((n, key.group(1), groups, cells[2] == "O"))
    if not rows:
        return [Issue(contract_path, 0, "empty-contract", "-")]

    for n, key, groups, _ in rows:
        for g in groups:
            if g not in files:
                issues.append(Issue(contract_path, n, "unknown-group", g))

    for group, rel in sorted(files.items()):
        example = root / rel
        if not example.is_file():
            issues.append(Issue(contract_path, 0, "missing-file", rel))
            continue
        _, present = check_env_files.check_text(example.read_bytes(), rel)
        allowed = {key for _, key, groups, _ in rows if group in groups}
        required = {key for _, key, groups, req in rows if group in groups and req}
        for key in sorted(present):
            if key not in allowed:
                issues.append(Issue(rel, 0, "unknown-key", key))
        for key in sorted(required - set(present)):
            issues.append(Issue(rel, 0, "missing-required", key))
    return issues


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--contract", default=DEFAULT_CONTRACT, help="계약 문서 경로")
    ap.add_argument("--root", default=".", help="예제 파일 경로의 기준 디렉터리(저장소 루트)")
    args = ap.parse_args(argv)
    contract = Path(args.contract)
    issues = check_contract(contract.read_text(encoding="utf-8"), Path(args.root), contract.as_posix())
    for i in issues:
        print(i)
    if issues:
        print(f"{len(issues)} issue(s). 계약 표와 예제 파일을 함께 고친다")
        return 1
    print("OK env-contract")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
