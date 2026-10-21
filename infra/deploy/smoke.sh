#!/usr/bin/env bash
# 배포한 서비스를 엣지(Caddy)를 거쳐 확인한다(설계 6.3절 smoke:public, 6.4절 5단계). 서버 안에서 돌린다.
#   bash infra/deploy/smoke.sh <prod|dev> [--sha SHA] [--only be|fe]
# 점검마다 PASS, FAIL, SKIP만 출력하고 dev 게이트 키는 출력하지 않는다. 하나라도 FAIL이면 종료 코드 1이다.
# 주소는 /etc/fit/edge.env의 PROD_HOST·DEV_HOST로 만들고(https://<호스트>) 서버 자신(127.0.0.1)으로 연결한다.
# 시험이나 다른 곳에서는 환경변수로 바꾼다: FIT_EDGE_ENV(edge.env 경로), FIT_SMOKE_PORT(443), FIT_SMOKE_ADDR(연결할 IP, 기본 127.0.0.1.
# 빈 값이면 DNS를 쓴다), FIT_SMOKE_INSECURE=1(인증서를 검증하지 않는다. 시험용 내부 CA)
# 검색 폴백 점검은 FIT_SMOKE_SEARCH_PATH(예: "/api/v1/search?q=김치")를 줄 때만 한다(없으면 SKIP).
set -uo pipefail
# shellcheck source=infra/deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ENVN="${1:-}"
shift || true
SHA="" ONLY=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --sha) SHA="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    *) echo "알 수 없는 인자: $1" >&2; exit 2 ;;
  esac
done
valid_env "$ENVN" || {
  echo "사용: bash infra/deploy/smoke.sh <prod|dev> [--sha SHA] [--only be|fe]" >&2
  exit 2
}

EDGE_ENV="${FIT_EDGE_ENV:-$ENV_DIR/edge.env}"
edge_value() { sed -n "s/^$1=//p" "$EDGE_ENV" 2>/dev/null | head -n 1; }
host="$(edge_value PROD_HOST)"
if [ "$ENVN" = dev ]; then host="$(edge_value DEV_HOST)"; fi
[ -n "$host" ] || die "$EDGE_ENV에서 ${ENVN}의 호스트를 읽지 못했다"
port="${FIT_SMOKE_PORT:-443}"
addr="${FIT_SMOKE_ADDR-127.0.0.1}"
BASE="https://$host"
if [ "$port" != 443 ]; then BASE="$BASE:$port"; fi
CURL=(-sS --max-time 20)
if [ -n "$addr" ]; then CURL+=(--resolve "$host:$port:$addr"); fi
if [ "${FIT_SMOKE_INSECURE:-0}" = 1 ]; then CURL+=(-k); fi
if [ "$ENVN" = dev ]; then
  key="$(edge_value DEV_GATE_KEY)"
  [ -n "$key" ] && CURL+=(-b "fit_dev=$key")
fi

FAILED=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
skip() { printf 'SKIP  %s\n' "$1"; }
ok_if() { if [ "$2" = 1 ]; then pass "$1"; else fail "$1"; fi; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# get 경로: STATUS, HEADERS(소문자), BODY를 채운다. 연결 실패(종료 코드 7)는 다시 시도한다
STATUS="" HEADERS="" BODY=""
get() {
  local rc=0 n=0
  while :; do
    # curl.exe(Windows)가 쓸 파일은 native_path로 넘긴다
    STATUS="$(curl "${CURL[@]}" -D "$(native_path "$TMP/h")" -o "$(native_path "$TMP/b")" -w '%{http_code}' "$BASE$1" 2>/dev/null)" && break
    rc=$?
    if [ "$rc" = 7 ] && [ "$n" -lt "${FIT_SMOKE_RETRIES:-2}" ]; then
      n=$((n + 1))
      sleep 1
      continue
    fi
    STATUS="000"
    HEADERS=""
    BODY=""
    return 0
  done
  HEADERS="$(tr -d '\r' <"$TMP/h" | tr '[:upper:]' '[:lower:]')"
  BODY="$(cat "$TMP/b")"
}
header_value() { printf '%s\n' "$HEADERS" | awk -F': ' -v k="$1" '$1 == k { print $2; exit }'; }

check_be() {
  local got
  get /healthz
  ok_if "BE: /healthz 가 200이다" "$([ "$STATUS" = 200 ] && echo 1 || echo 0)"
  get /api/v1/version
  got="$(json_string sha "$BODY")"
  [ -n "$got" ] || got="$(header_value x-app-version)"
  if [ -n "$SHA" ]; then
    ok_if "BE: 엣지 경유 버전이 배포한 SHA다" "$([ "$STATUS" = 200 ] && sha_match "$got" "$SHA" && echo 1 || echo 0)"
  else
    ok_if "BE: /api/v1/version 이 200이고 SHA를 준다" "$([ "$STATUS" = 200 ] && [ -n "$got" ] && echo 1 || echo 0)"
  fi
  if [ -n "${FIT_SMOKE_SEARCH_PATH:-}" ]; then
    get "$FIT_SMOKE_SEARCH_PATH"
    ok_if "BE: 검색 1건이 200이다" "$([ "$STATUS" = 200 ] && echo 1 || echo 0)"
    fb="$(header_value x-fallback)"
    ok_if "BE: 검색이 폴백으로 처리되지 않았다(Modal 연동 확인)${fb:+. X-Fallback: $fb}" "$([ -z "$fb" ] && echo 1 || echo 0)"
  else
    skip "BE: 검색 폴백 점검 (FIT_SMOKE_SEARCH_PATH 없음)"
  fi
}

check_fe() {
  get /
  ok_if "FE: / 가 200이고 HTML이다(SSR 페이지)" "$([ "$STATUS" = 200 ] && printf '%s' "$HEADERS" | grep -q 'content-type: text/html' && echo 1 || echo 0)"
  get /fe-healthz
  ok_if "FE: /fe-healthz 가 200이다" "$([ "$STATUS" = 200 ] && echo 1 || echo 0)"
  get /config.json
  ok_if "FE: /config.json 이 200이고 env가 $ENVN이다" \
    "$([ "$STATUS" = 200 ] && printf '%s' "$BODY" | grep -Eq "\"env\"[[:space:]]*:[[:space:]]*\"$ENVN\"" && echo 1 || echo 0)"
}

case "$ONLY" in
  be) check_be ;;
  fe) check_fe ;;
  "")
    check_be
    check_fe
    ;;
  *)
    echo "--only는 be 또는 fe다" >&2
    exit 2
    ;;
esac

if [ "$FAILED" -gt 0 ]; then
  printf '\n%d개 점검 실패\n' "$FAILED"
  exit 1
fi
printf '\n스모크 통과\n'
