#!/usr/bin/env python3
"""FE 번들 산출물 검사(설계 6.8절 P0). fe:build가 만든 번들이 배포할 수 있는 모양인지 이미지를 조립하기 전에 확인한다.

  python3 infra/ci/check_fe_bundle.py <번들 디렉터리> --sha <커밋 SHA>

번들 디렉터리는 standalone/(Next가 만든 .next/standalone 그대로), static/(.next/static), 선택으로 public/을 가진다.
검사마다 PASS, FAIL, WARN, SKIP을 한 줄로 찍고 하나라도 FAIL이면 종료 코드 1이다. 파일 내용은 출력하지 않고 경로와 이유만 찍는다.
실제 Next 16 번들(2026-10-23)에서 확인한 모양을 따른다: standalone에는 images-manifest.json이 없고 required-server-files.json에 설정이 들어 있다.

  server.js            standalone/server.js가 있다
  static               static/에 파일이 있다(빈 번들 방지)
  build-id             standalone/.next/BUILD_ID가 커밋 SHA와 같다(generateBuildId, FE 계약 #1). 빈 값끼리는 같다고 보지 않는다
  deployment-id        required-server-files.json의 config.deploymentId가 커밋 SHA와 같다(FE 계약 #1)
  images-unoptimized   required-server-files.json의 config.images.unoptimized가 true다(FE 계약 #7)
  native-modules       node_modules의 *.node는 @img/sharp-* 뿐이다(B(Arm)의 산출물을 A(x86)에서 돌린다)
  no-local-urls        server.js, .next/server, static의 텍스트 파일에 http(s)://localhost, 127.0.0.1, 0.0.0.0 주소가 없다(node_modules는 보지 않는다).
                       Next 런타임이 쓰는 hostname 비교 같은 글자는 주소가 아니라 잡지 않는다
  mock-words           같은 범위에 mock이라는 글자가 있으면 WARN으로 드러낸다(막지 않는다. 개발용 mock 스위치가 배포 번들에 들어갔는지 FE 팀이 본다)
  pwa-files            public/sw.js와 public/manifest.webmanifest가 있다(없으면 SKIP. FE 팀 몫이라 막지 않는다)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

Result = tuple[str, str, str]  # (PASS | FAIL | WARN | SKIP, 검사 이름, 설명)

LOCAL_URL_RE = re.compile(rb"https?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0)", re.IGNORECASE)
MOCK_RE = re.compile(rb"mock", re.IGNORECASE)
SHOW_AT_MOST = 5


def _rel(root: Path, p: Path) -> str:
    return p.relative_to(root).as_posix()


def _files(base: Path):
    if base.is_file():
        yield base
    elif base.is_dir():
        yield from (p for p in sorted(base.rglob("*")) if p.is_file())


def _list(items: list[str]) -> str:
    shown = ", ".join(items[:SHOW_AT_MOST])
    return shown + (f" 외 {len(items) - SHOW_AT_MOST}개" if len(items) > SHOW_AT_MOST else "")


def _server_files_config(root: Path) -> dict | None:
    """standalone/.next/required-server-files.json의 config. 없거나 깨졌으면 None."""
    p = root / "standalone/.next/required-server-files.json"
    try:
        config = json.loads(p.read_text(encoding="utf-8")).get("config")
    except (OSError, ValueError, AttributeError):
        return None
    return config if isinstance(config, dict) else None


def check_server_js(root: Path, sha: str) -> Result:
    ok = (root / "standalone/server.js").is_file()
    return ("PASS" if ok else "FAIL", "server.js", "standalone/server.js가 있다" if ok else "standalone/server.js가 없다")


def check_static(root: Path, sha: str) -> Result:
    n = sum(1 for _ in _files(root / "static"))
    if n:
        return "PASS", "static", f"static/에 파일 {n}개"
    return "FAIL", "static", "static/이 없거나 비어 있다(빈 번들)"


def check_build_id(root: Path, sha: str) -> Result:
    p = root / "standalone/.next/BUILD_ID"
    if not p.is_file():
        return "FAIL", "build-id", "standalone/.next/BUILD_ID가 없다"
    got = p.read_text(encoding="utf-8", errors="replace").strip()
    if not got or not sha:
        return "FAIL", "build-id", "BUILD_ID나 커밋 SHA가 비어 있다(DEPLOYMENT_VERSION이 비어 빌드됐는지 확인)"
    if got == sha:
        return "PASS", "build-id", "BUILD_ID가 커밋 SHA와 같다"
    return "FAIL", "build-id", "BUILD_ID가 커밋 SHA와 다르다(generateBuildId가 DEPLOYMENT_VERSION을 쓰는지 확인)"


def check_deployment_id(root: Path, sha: str) -> Result:
    config = _server_files_config(root)
    if config is None:
        return "FAIL", "deployment-id", "standalone/.next/required-server-files.json을 읽지 못했다"
    got = config.get("deploymentId")
    if not got or not sha:
        return "FAIL", "deployment-id", "config.deploymentId나 커밋 SHA가 비어 있다(next.config의 deploymentId가 DEPLOYMENT_VERSION을 쓰는지 확인)"
    if got == sha:
        return "PASS", "deployment-id", "deploymentId가 커밋 SHA와 같다"
    return "FAIL", "deployment-id", "deploymentId가 커밋 SHA와 다르다"


def check_images_unoptimized(root: Path, sha: str) -> Result:
    config = _server_files_config(root)
    if config is None:
        return "FAIL", "images-unoptimized", "standalone/.next/required-server-files.json을 읽지 못했다"
    value = config.get("images", {}).get("unoptimized") if isinstance(config.get("images"), dict) else None
    if value is True:
        return "PASS", "images-unoptimized", "images.unoptimized가 true다"
    return "FAIL", "images-unoptimized", f"images.unoptimized가 true가 아니다(값: {value!r}). 기본 이미지 로더의 sharp는 플랫폼 전용이다(FE 계약 #7)"


def check_native_modules(root: Path, sha: str) -> Result:
    bad = [_rel(root, p) for p in _files(root / "standalone/node_modules") if p.suffix == ".node" and "/@img/sharp-" not in "/" + _rel(root, p)]
    if not bad:
        return "PASS", "native-modules", "sharp 외의 네이티브 모듈이 없다"
    return "FAIL", "native-modules", f"허용하지 않는 네이티브 모듈(*.node): {_list(bad)}"


def _scan(root: Path, pattern: re.Pattern[bytes]) -> list[str]:
    """server.js, .next/server, static의 텍스트 파일에서 패턴이 나오는 곳(경로(찾은 글자))."""
    found: list[str] = []
    for target in (root / "standalone/server.js", root / "standalone/.next/server", root / "static"):
        for p in _files(target):
            data = p.read_bytes()
            if b"\x00" in data[:4096]:
                continue  # 바이너리
            m = pattern.search(data)
            if m:
                found.append(f"{_rel(root, p)}({m.group(0).decode('ascii', 'replace').lower()})")
    return found


def check_no_local_urls(root: Path, sha: str) -> Result:
    found = _scan(root, LOCAL_URL_RE)
    if not found:
        return "PASS", "no-local-urls", "http(s)://localhost, 127.0.0.1, 0.0.0.0 주소가 없다"
    return "FAIL", "no-local-urls", f"빌드 때 박힌 로컬 주소가 있다: {_list(found)}"


def check_mock_words(root: Path, sha: str) -> Result:
    found = _scan(root, MOCK_RE)
    if not found:
        return "PASS", "mock-words", "mock이라는 글자가 없다"
    return "WARN", "mock-words", f"mock이라는 글자가 있다(막지 않는다. 개발용 mock 스위치가 배포 번들에 들어간 것인지 FE 팀이 확인한다): {_list(found)}"


def check_pwa_files(root: Path, sha: str) -> Result:
    missing = [n for n in ("sw.js", "manifest.webmanifest") if not (root / "public" / n).is_file()]
    if not missing:
        return "PASS", "pwa-files", "public/sw.js와 manifest.webmanifest가 있다"
    return "SKIP", "pwa-files", f"public/에 {', '.join(missing)}이(가) 없다(FE 계약 #4. 막지는 않는다)"


CHECKS = (
    check_server_js,
    check_static,
    check_build_id,
    check_deployment_id,
    check_images_unoptimized,
    check_native_modules,
    check_no_local_urls,
    check_mock_words,
    check_pwa_files,
)


def check_bundle(root: Path, sha: str) -> list[Result]:
    return [check(root, sha) for check in CHECKS]


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("bundle", help="번들 디렉터리(standalone/, static/, public/)")
    ap.add_argument("--sha", required=True, help="빌드한 커밋 SHA(BUILD_ID, deploymentId와 비교한다)")
    args = ap.parse_args(argv)
    if not args.sha.strip():
        print("FAIL  --sha가 비어 있다(CI_COMMIT_SHA가 비었는지 확인)")
        return 1
    root = Path(args.bundle)
    if not root.is_dir():
        print(f"FAIL  번들 디렉터리가 없다: {root}")
        return 1
    results = check_bundle(root, args.sha.strip())
    for status, name, detail in results:
        print(f"{status:<4}  {name}: {detail}")
    failed = sum(1 for r in results if r[0] == "FAIL")
    print("FE 번들이 배포할 수 있는 모양이다" if not failed else f"{failed}개 검사 실패")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
