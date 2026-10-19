#!/usr/bin/env python3
"""적용된 Flyway 마이그레이션 수정 금지와 버전 충돌 검사 (스펙 6.5).

base와 HEAD를 비교해 아래를 실패로 본다. 새 버전 파일의 추가만 정상이다.
  - 버전 마이그레이션(V*)의 수정(M), 삭제(D), 이름 변경(D로 보인다). 반복 마이그레이션(R__*)의 수정은 정상이다.
  - HEAD에서 같은 버전이 둘 이상(duplicate-version)
  - base의 최대 버전 이하인 새 버전(out-of-order). 이미 적용된 DB에서 Flyway validate가 기동을 막는다(A603 사고).
base는 MR의 병합 기준점(CI_MERGE_REQUEST_DIFF_BASE_SHA)이라 3점 diff가 필요 없다. 그 커밋이 얕은 clone에 없으면 하나만 가져온다.
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import PurePosixPath

DEFAULT_DIR = "be/src/main/resources/db/migration"
VERSIONED_RE = re.compile(r"^V(\d+(?:[._]\d+)*)__")
SHA_RE = re.compile(r"^[0-9a-f]{7,40}$")


def git(args: list[str], cwd: str | None) -> str:
    r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"git {args[0]} failed: " + r.stderr.strip())
    return r.stdout


def ensure_commit(base: str, cwd: str | None = None) -> None:
    """base가 커밋 해시이고 로컬에 없으면(얕은 clone) 그 커밋 하나만 가져온다."""
    if not SHA_RE.match(base):
        return
    have = subprocess.run(["git", "cat-file", "-e", f"{base}^{{commit}}"], cwd=cwd, capture_output=True)
    if have.returncode != 0:
        git(["fetch", "--quiet", "--depth=1", "origin", base], cwd)


def version_of(path: str) -> tuple[int, ...] | None:
    m = VERSIONED_RE.match(PurePosixPath(path).name)
    return tuple(int(x) for x in re.split(r"[._]", m.group(1))) if m else None


def changed_migrations(base: str, directory: str, cwd: str | None = None) -> list[str]:
    """base 대비 수정·삭제·이름 변경된 마이그레이션(git diff --name-status 줄). 반복 마이그레이션의 수정은 뺀다."""
    out = git(["diff", "--name-status", "--no-renames", "--diff-filter=a", base, "HEAD", "--", directory], cwd)
    lines = [ln for ln in out.splitlines() if ln.strip()]
    return [ln for ln in lines if not (ln[0] == "M" and PurePosixPath(ln.split("\t")[-1]).name.startswith("R__"))]


def version_problems(base: str, directory: str, cwd: str | None = None) -> list[str]:
    """HEAD의 중복 버전과, base의 최대 버전 이하인 새 버전."""

    def versions(ref: str) -> dict[str, tuple[int, ...]]:
        names = git(["ls-tree", "-r", "--name-only", ref, "--", directory], cwd).splitlines()
        return {n: v for n in names if (v := version_of(n)) is not None}

    head, old = versions("HEAD"), versions(base)
    problems: list[str] = []
    seen: dict[tuple[int, ...], str] = {}
    for name, v in sorted(head.items()):
        if v in seen:
            problems.append(f"duplicate-version\t{name} = {seen[v]}")
        seen.setdefault(v, name)
    top = max(old.values(), default=())
    for name in sorted(set(head) - set(old)):
        if head[name] <= top:
            problems.append(f"out-of-order\t{name}")
    return problems


def default_base() -> str:
    return os.environ.get("CI_MERGE_REQUEST_DIFF_BASE_SHA") or "origin/develop"


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", default=default_base(), help="비교 기준 ref (기본: MR diff base 또는 origin/develop)")
    ap.add_argument("--dir", default=os.environ.get("MIGRATION_DIR", DEFAULT_DIR), dest="directory")
    args = ap.parse_args(argv)
    try:
        ensure_commit(args.base)
        problems = changed_migrations(args.base, args.directory) + version_problems(args.base, args.directory)
    except RuntimeError as e:
        print(f"FAIL {e}")
        return 1
    for line in problems:
        print(f"FAIL {line}")
    if problems:
        print("적용된 마이그레이션은 고치지 않는다. 새 파일을 추가하세요(V<다음 번호>__설명.sql). 번호는 기존 최대값보다 커야 하고 겹치면 안 된다.")
        return 1
    print(f"OK migrations (base={args.base}, dir={args.directory})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
