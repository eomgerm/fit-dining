#!/usr/bin/env python3
"""이미지가 대상 호스트 플랫폼(linux/amd64, linux/arm64)을 지원하는지 검사 (스펙 3절).

검사 대상: compose 설정의 services.*.image, Dockerfile의 FROM, tool-images.sh 같은 *_IMAGE=값 파일, --image로 직접 준 이미지.
변수로 치환되는 이미지(`FROM ${BASE}`)는 판정할 수 없어 SKIP으로 알린다.
이미지당 한 번만 조회한다(`docker buildx imagetools inspect`, 레지스트리 접근 필요. 익명 pull 한도를 아끼기 위해).
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Callable

Inspector = Callable[[str], "set[str]"]
PLATFORMS = ["linux/amd64", "linux/arm64"]


class InspectError(RuntimeError):
    pass


def platform_key(p: dict) -> str:
    return f"{p.get('os', '')}/{p.get('architecture', '')}"


def platforms_from_index(index: dict) -> set[str]:
    """이미지 인덱스의 manifests에서 platform을 모은다(attestation의 unknown/unknown은 제외)."""
    out = set()
    for m in index.get("manifests") or []:
        p = m.get("platform") or {}
        if p.get("architecture") and p.get("architecture") != "unknown":
            out.add(platform_key(p))
    return out


def inspect_platforms(image: str) -> set[str]:
    def run(*args: str) -> subprocess.CompletedProcess:
        return subprocess.run(["docker", "buildx", "imagetools", "inspect", *args, image], capture_output=True, timeout=90)

    raw = run("--raw")
    if raw.returncode != 0:
        raw = run("--raw")  # 레지스트리 일시 오류를 한 번 재시도
    if raw.returncode != 0:
        lines = raw.stderr.decode(errors="replace").strip().splitlines()
        raise InspectError(lines[-1][:200] if lines else "inspect failed")
    data = json.loads(raw.stdout)
    if "manifests" in data:
        return platforms_from_index(data)
    # 단일 매니페스트: platform 정보가 없으므로 이미지 설정에서 읽는다
    cfg = run("--format", "{{json .Image}}")
    if cfg.returncode != 0:
        raise InspectError("cannot read image config")
    img = json.loads(cfg.stdout)
    if "architecture" in img and "os" in img:
        return {platform_key(img)}
    return {k for k in img if "/" in k}


FROM_RE = re.compile(r"^\s*FROM\s+(?P<rest>.+?)\s*$", re.IGNORECASE)
SHELL_IMAGE_RE = re.compile(r"^[A-Z][A-Z0-9_]*_IMAGE=(\S+)\s*$", re.MULTILINE)


def images_from_dockerfile(text: str) -> tuple[set[str], set[str]]:
    """(판정 가능한 이미지, 변수라 판정 못 하는 이미지)를 돌려준다. 앞선 스테이지 이름과 scratch는 제외한다."""
    resolved: set[str] = set()
    unresolved: set[str] = set()
    stages: set[str] = set()
    for line in text.splitlines():
        m = FROM_RE.match(line)
        if not m:
            continue
        tokens = [t for t in m.group("rest").split() if not t.startswith("--")]
        if not tokens:
            continue
        image = tokens[0]
        alias = tokens[2].lower() if len(tokens) >= 3 and tokens[1].upper() == "AS" else None
        if image.lower() != "scratch" and image.lower() not in stages:
            (unresolved if "$" in image else resolved).add(image)
        if alias:
            stages.add(alias)
    return resolved, unresolved


def images_from_compose_config(config: dict) -> set[str]:
    """services.*.image. build가 있는 서비스의 image는 이 저장소의 Dockerfile이 만드는 이름이라 레지스트리에 없으므로 제외한다.
    그 Dockerfile의 FROM은 --dockerfile로 검사한다."""
    return {s["image"] for s in (config.get("services") or {}).values() if s.get("image") and not s.get("build")}


def images_from_shell_vars(text: str) -> set[str]:
    return set(SHELL_IMAGE_RE.findall(text))


def check(images: set[str], platforms: list[str], inspector: Inspector = inspect_platforms) -> list[str]:
    problems = []
    for image in sorted(images):
        try:
            have = inspector(image)
        except (InspectError, subprocess.TimeoutExpired, json.JSONDecodeError) as e:
            problems.append(f"{image}: inspect-error {e}")
            continue
        for platform in platforms:
            if platform not in have:
                problems.append(f"{image}: missing {platform} (has: {','.join(sorted(have)) or 'unknown'})")
    return problems


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--platform", action="append", required=True, choices=PLATFORMS)
    ap.add_argument("--image", action="append", default=[])
    ap.add_argument("--images-from-sh", action="append", default=[], metavar="FILE", help="*_IMAGE=값 형식의 셸 파일")
    ap.add_argument("--dockerfile", action="append", default=[])
    ap.add_argument("--compose", action="append", default=[], help="한 프로젝트의 compose 파일(병합). 여러 프로젝트면 따로 실행")
    ap.add_argument("--env-file", action="append", default=[])
    args = ap.parse_args(argv)

    images = set(args.image)
    for sh in args.images_from_sh:
        images |= images_from_shell_vars(Path(sh).read_text(encoding="utf-8"))
    for df in args.dockerfile:
        resolved, unresolved = images_from_dockerfile(Path(df).read_text(encoding="utf-8"))
        images |= resolved
        for u in sorted(unresolved):
            print(f"SKIP {df}: unresolved image {u}")
    if args.compose:
        import ports_invariant  # compose 로딩을 공유한다

        images |= images_from_compose_config(ports_invariant.load_config(args.compose, args.env_file))
    if not images:
        print("OK arch (no images)")
        return 0
    problems = check(images, args.platform)
    for p in problems:
        print(f"FAIL {p}")
    if problems:
        return 1
    print(f"OK arch {','.join(args.platform)} ({len(images)} image(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
