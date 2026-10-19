#!/usr/bin/env python3
"""MR 안에 병합 커밋(3-way merge)이 없는지 검사한다 (설계 10.8절).

base부터 HEAD까지의 커밋 중 부모가 둘 이상인 것을 실패로 본다. 병합 커밋이 들어오면 prod에 올라가는 이력이 한 줄이 아니게 된다.
브랜치는 `git rebase origin/master`로 최신화하고, 당겨받을 때는 `git pull --rebase`를 쓴다.
base는 MR의 병합 기준점(CI_MERGE_REQUEST_DIFF_BASE_SHA)이다. 그 커밋이 얕은 clone에 없으면 하나만 가져온다.
출력은 커밋 해시와 제목뿐이다.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys

from migration_immutability import ensure_commit


def git(args: list[str], cwd: str | None) -> str:
    r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        raise RuntimeError(f"git {args[0]} failed: " + r.stderr.strip())
    return r.stdout


def merge_commits(base: str, cwd: str | None = None) -> list[tuple[str, str]]:
    """base..HEAD의 병합 커밋 [(짧은 해시, 제목)]."""
    out = git(["log", "--merges", "--format=%h%x09%s", f"{base}..HEAD"], cwd)
    found = []
    for line in out.splitlines():
        sha, _, subject = line.partition("\t")
        found.append((sha, subject))
    return found


def default_base() -> str:
    return os.environ.get("CI_MERGE_REQUEST_DIFF_BASE_SHA") or "origin/master"


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", default=default_base(), help="비교 기준 ref (기본: MR diff base 또는 origin/master)")
    ap.add_argument("--repo", default=None, help="검사할 git 저장소 디렉터리(기본: 현재 디렉터리)")
    args = ap.parse_args(argv)
    try:
        ensure_commit(args.base, args.repo)
        found = merge_commits(args.base, args.repo)
    except RuntimeError as e:
        print(f"FAIL {e}")
        return 1
    for sha, subject in found:
        print(f"FAIL {sha} merge-commit {subject}")
    if found:
        print(
            "병합 커밋은 쓰지 않는다. 브랜치 최신화는 `git rebase origin/master`, 당겨받기는 `git pull --rebase`를 쓴다. "
            "이미 만들었다면 `git rebase origin/master`로 병합 커밋을 없앤 뒤 `git push --force-with-lease`로 올린다."
        )
        return 1
    print(f"OK history (base={args.base})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
