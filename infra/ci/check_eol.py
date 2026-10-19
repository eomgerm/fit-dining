#!/usr/bin/env python3
"""CRLF 검사.

  인자 없음: 커밋될 내용(git 인덱스)에 CRLF가 있는 파일을 확장자와 무관하게 찾는다. `git ls-files --eol`의 i/ 값을 본다.
             Windows의 core.autocrlf=true는 작업 트리만 CRLF로 바꾸고 인덱스는 LF라서 통과한다.
             .gitattributes(`* text=auto eol=lf`)가 없거나 -text로 빠진 파일이 있으면 인덱스에 CRLF가 남아 실패한다.
  경로 지정: 그 파일의 실제 바이트에 CR이 있으면 실패한다(인덱스 밖 파일, 서버에 올릴 env 파일 등).

env 파일의 CRLF는 값을 깨뜨리고(A603), 셸 스크립트는 줄 끝에 \\r이 붙어 실행이 실패한다.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

TEXT_SUFFIXES = {
    ".sh", ".py", ".yml", ".yaml", ".toml", ".md", ".json", ".sql", ".conf",
    ".env", ".example", ".caddy", ".txt", ".cfg", ".ini",
}
TEXT_NAMES = {"Caddyfile", ".gitattributes", ".gitignore", ".editorconfig"}


def is_text_candidate(path: Path) -> bool:
    return (
        path.suffix in TEXT_SUFFIXES
        or path.name in TEXT_NAMES
        or path.name.startswith("Dockerfile")
    )


def files_with_crlf(paths: list[Path]) -> list[Path]:
    """작업 트리의 실제 바이트에 CR이 있는 텍스트 파일."""
    bad = []
    for p in paths:
        if p.is_file() and is_text_candidate(p) and b"\r" in p.read_bytes():
            bad.append(p)
    return bad


def index_crlf_files(cwd: str | None = None) -> list[Path]:
    """git 인덱스(커밋될 내용)에 CRLF가 있는 파일. 확장자와 무관하게 본다(gradlew, application.properties 등).

    CR을 일부러 허용한 파일(`eol=crlf`나 `-text` 속성)은 제외한다. 바이너리는 git이 i/-text로 분류해 걸리지 않는다.
    """
    out = subprocess.run(
        ["git", "ls-files", "--eol", "-z"], cwd=cwd, capture_output=True, check=True
    ).stdout
    bad = []
    for rec in out.split(b"\0"):
        if not rec:
            continue
        meta, _, path = rec.partition(b"\t")
        info = meta.decode()
        index_eol = info.split()[0]  # 예: i/lf, i/crlf, i/mixed
        if index_eol in ("i/crlf", "i/mixed") and "eol=crlf" not in info and "-text" not in info:
            bad.append(Path(path.decode()))
    return bad


def main(argv: list[str]) -> int:
    if argv:
        bad = files_with_crlf([Path(a) for a in argv])
        scope = f"{len(argv)} file(s) checked"
    else:
        bad = index_crlf_files()
        scope = "index"
    for p in bad:
        print(f"FAIL {p.as_posix()} crlf")
    if bad:
        print(f"{len(bad)} file(s) contain CR. Fix: sed -i 's/\\r$//' <file> (인덱스라면 .gitattributes 확인)")
        return 1
    print(f"OK eol ({scope})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
