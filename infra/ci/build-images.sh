#!/usr/bin/env bash
# be:<SHA>, fe:<SHA> 이미지를 조립한다(설계 6.3절 build:images). 서버 A의 deploy 러너에서 돈다.
#   bash infra/ci/build-images.sh <커밋 SHA>
# verify 단계(B)가 만든 jar와 FE 번들을 COPY만 한다(BE 계약 #20, FE 계약 #1). 레지스트리는 없고 A의 로컬 Docker에 만든다.
# 이미 있는 이미지는 다시 조립하지 않는다(MR을 fast-forward로 병합하므로 develop과 master의 SHA가 같다. prod는 dev에서 검증한 이미지를 쓴다).
# 입력(jar, 번들)은 조립 전에 모두 검사한다. 하나라도 잘못되면 어느 이미지도 만들지 않는다(한쪽만 새 SHA가 되는 상태를 막는다).
# 환경변수(선택): FIT_BE_JAR_DIR(be/build/libs) FIT_FE_BUNDLE_DIR(fe-bundle) FIT_BE_IMAGE(be) FIT_FE_IMAGE(fe)
#   이미지 이름은 compose.app.yml의 FIT_BE_IMAGE, FIT_FE_IMAGE와 같은 변수다.
# 출력에 시크릿은 없다. 베이스 이미지 핀은 tool-images.sh에서 읽는다.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=infra/ci/tool-images.sh
. "$HERE/tool-images.sh"

die() { printf 'FAIL %s\n' "$*" >&2; exit 1; }

SHA="${1:-}"
case "$SHA" in
  "" | *[!0-9a-f]*) die "커밋 SHA(소문자 16진수 7~64자)를 준다: build-images.sh <SHA>" ;;
esac
[ "${#SHA}" -ge 7 ] && [ "${#SHA}" -le 64 ] || die "커밋 SHA(소문자 16진수 7~64자)를 준다: build-images.sh <SHA>"

BE_IMAGE="${FIT_BE_IMAGE:-be}"
FE_IMAGE="${FIT_FE_IMAGE:-fe}"
JAR_DIR="${FIT_BE_JAR_DIR:-$ROOT/be/build/libs}"
BUNDLE_DIR="${FIT_FE_BUNDLE_DIR:-$ROOT/fe-bundle}"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
CTX=""
JAR=""
trap '[ -z "$CTX" ] || rm -rf "$CTX"' EXIT

exists() { docker image inspect "$1" >/dev/null 2>&1; }

# 조립이 필요한 것만 입력을 검사한다. 이미 있는 이미지는 입력이 없어도 된다
check_be_input() {
  local jars=() jar
  [ -d "$JAR_DIR" ] || die "jar가 없다($JAR_DIR가 없다). be:test의 아티팩트를 확인한다"
  while IFS= read -r jar; do jars+=("$jar"); done < <(find "$JAR_DIR" -maxdepth 1 -type f -name '*.jar' ! -name '*-plain.jar' | sort)
  [ "${#jars[@]}" -ge 1 ] || die "jar가 없다($JAR_DIR에 *.jar가 없다. *-plain.jar는 제외한다). be:test의 아티팩트를 확인한다"
  [ "${#jars[@]}" -eq 1 ] || die "jar가 둘 이상이다(${#jars[@]}개). bootJar 하나만 있어야 한다"
  JAR="${jars[0]}"
}

check_fe_input() {
  [ -f "$BUNDLE_DIR/standalone/server.js" ] || die "FE 번들이 아니다($BUNDLE_DIR/standalone/server.js가 없다). fe:build의 아티팩트를 확인한다"
  [ -d "$BUNDLE_DIR/static" ] || die "FE 번들에 static/이 없다($BUNDLE_DIR/static). fe:build의 아티팩트를 확인한다"
}

build_be() {
  CTX="$(mktemp -d)"
  cp "$JAR" "$CTX/app.jar"
  docker build -f "$ROOT/infra/app/Dockerfile.be" --build-arg "BASE_IMAGE=$JRE_IMAGE" --build-arg "SHA=$SHA" --build-arg "BUILT_AT=$BUILT_AT" -t "$BE_IMAGE:$SHA" "$CTX"
  rm -rf "$CTX"
  CTX=""
  echo "조립: $BE_IMAGE:$SHA"
}

build_fe() {
  # public/은 선택이다. Dockerfile의 COPY가 실패하지 않게 빈 디렉터리를 둔다
  mkdir -p "$BUNDLE_DIR/public"
  docker build -f "$ROOT/infra/app/Dockerfile.fe" --build-arg "BASE_IMAGE=$NODE_IMAGE" --build-arg "SHA=$SHA" -t "$FE_IMAGE:$SHA" "$BUNDLE_DIR"
  echo "조립: $FE_IMAGE:$SHA"
}

need_be=1
need_fe=1
if exists "$BE_IMAGE:$SHA"; then need_be=0; echo "재사용: $BE_IMAGE:$SHA"; fi
if exists "$FE_IMAGE:$SHA"; then need_fe=0; echo "재사용: $FE_IMAGE:$SHA"; fi
if [ "$need_be" = 1 ]; then check_be_input; fi
if [ "$need_fe" = 1 ]; then check_fe_input; fi
if [ "$need_be" = 1 ]; then build_be; fi
if [ "$need_fe" = 1 ]; then build_fe; fi
