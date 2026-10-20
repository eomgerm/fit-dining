#!/usr/bin/env bash
# 엣지의 라우팅·캐시·헤더·dev 게이트를 HTTP로 점검한다(설계 5.5절). 서버 안에서도, 노트북의 시험 환경(test/test-edge.sh)에서도 쓴다.
#   bash infra/edge/verify-edge.sh --prod https://호스트 [--dev https://dev호스트 --dev-key 키] [--http http://호스트]
#                                  [--resolve 호스트:포트:IP]... [--retry N] [--insecure]
# 각 점검은 PASS, FAIL, SKIP으로 출력하고 하나라도 FAIL이면 종료 코드 1이다. 키 값은 출력하지 않는다.
# --resolve는 curl의 같은 옵션이다. DNS를 바꾸기 전에 서버를 점검할 때 쓴다(예: --resolve fit.example.com:443:<서버 IP>).
# --retry N은 연결에 실패한 요청(curl 종료 코드 7)을 1초 간격으로 N번까지 다시 시도한다. 기본은 재시도 없음이다.
# 필요한 것: bash 3.2 이상, curl, 점검 대상에 배포된 FE(SSR 페이지, /config.json, /fe-healthz, /sw.js, /manifest.webmanifest)
set -u

PROD="" DEV="" DEV_KEY="" HTTP_URL="" INSECURE=0 RETRY=0
RESOLVE=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --prod) PROD="$2"; shift 2 ;;
    --dev) DEV="$2"; shift 2 ;;
    --dev-key) DEV_KEY="$2"; shift 2 ;;
    --http) HTTP_URL="$2"; shift 2 ;;
    --resolve) RESOLVE+=(--resolve "$2"); shift 2 ;;
    --retry) RETRY="$2"; shift 2 ;;
    --insecure) INSECURE=1; shift ;;
    *) echo "알 수 없는 인자: $1" >&2; exit 2 ;;
  esac
done
if [ -z "$PROD" ]; then
  echo "사용: bash infra/edge/verify-edge.sh --prod URL [--dev URL --dev-key 키] [--http URL] [--resolve 호스트:포트:IP]... [--retry N] [--insecure]" >&2
  exit 2
fi

CURL=(curl -sS --max-time 20)
if [ "$INSECURE" = "1" ]; then CURL+=(-k); fi
if [ "${#RESOLVE[@]}" -gt 0 ]; then CURL+=("${RESOLVE[@]}"); fi

FAILED=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
skip() { printf 'SKIP  %s\n' "$1"; }

# fetch URL [curl 인자...]: STATUS, HEADERS(소문자), BODY를 채운다. 리다이렉트는 따라가지 않는다.
STATUS="" HEADERS="" BODY=""
fetch() {
  local raw rc tries=0
  while :; do
    rc=0
    raw="$("${CURL[@]}" -i "$@")" || rc=$?
    if [ "$rc" = "7" ] && [ "$tries" -lt "$RETRY" ]; then tries=$((tries + 1)); sleep 1; continue; fi
    break
  done
  if [ "$rc" != "0" ]; then STATUS="000"; HEADERS=""; BODY=""; return; fi
  raw="$(printf '%s' "$raw" | tr -d '\r')"
  STATUS="$(printf '%s\n' "$raw" | head -n 1 | awk '{print $2}')"
  HEADERS="$(printf '%s\n' "$raw" | awk 'NR > 1 { if ($0 == "") exit; print }' | tr '[:upper:]' '[:lower:]')"
  BODY="$(printf '%s\n' "$raw" | awk 'f { print } /^$/ && !f { f = 1 }')"
}
header_value() { printf '%s\n' "$HEADERS" | awk -F': ' -v k="$1" 'tolower($1) == k { sub(/^[^:]*: /, ""); print; exit }'; }
expect() { # expect NAME 조건(참이면 통과)
  if [ "$2" = "1" ]; then pass "$1"; else fail "$1 (status=$STATUS)"; fi
}
is() { if [ "$1" = "$2" ]; then echo 1; else echo 0; fi; }
has() { case "$1" in *"$2"*) echo 1 ;; *) echo 0 ;; esac; }

check_site() { # check_site 라벨 URL [curl 인자...]
  local label="$1" base="$2" asset
  shift 2
  fetch "$base/" "$@"
  expect "$label: / 는 200 + text/html(SSR 페이지)" "$(is "$STATUS$(has "$(header_value content-type)" text/html)" 2001)"
  expect "$label: nosniff 헤더" "$(is "$(header_value x-content-type-options)" nosniff)"
  expect "$label: Server 헤더 없음" "$(is "$(header_value server)" "")"
  expect "$label: X-Powered-By 헤더 없음" "$(is "$(header_value x-powered-by)" "")"
  expect "$label: h3(Alt-Svc) 광고 없음" "$(is "$(header_value alt-svc)" "")"
  asset="$(printf '%s\n' "$BODY" | grep -oE '/_next/static/[A-Za-z0-9_./%-]+\.js' | head -n 1)"
  for f in /fe-healthz /sw.js /manifest.webmanifest /healthz; do
    fetch "$base$f" "$@"
    expect "$label: $f 는 200" "$(is "$STATUS" 200)"
  done
  fetch "$base/config.json" "$@"
  expect "$label: /config.json 은 200 + env 키" "$(is "$STATUS$(has "$BODY" '"env"')" 2001)"
  if [ -n "$asset" ]; then
    fetch "$base$asset" "$@"
    expect "$label: 정적 자산 $asset 는 immutable" "$(is "$STATUS$(has "$(header_value cache-control)" immutable)" 2001)"
  else
    fail "$label: 첫 화면에서 /_next/static/ 아래의 .js를 찾지 못했다"
  fi
  fetch "$base/_next/static/chunks/no-such-file.0123abcd.js" "$@"
  expect "$label: 없는 정적 자산은 404" "$(is "$STATUS" 404)"
  expect "$label: 404 응답은 immutable이 아니다" "$(is "$(has "$(header_value cache-control)" immutable)" 0)"
  fetch "$base/photos/x/pending/a.jpg" "$@"
  expect "$label: /photos/ 아래 그 외 경로는 404" "$(is "$STATUS" 404)"
}

check_site prod "$PROD"

if [ -n "$HTTP_URL" ]; then
  fetch "$HTTP_URL/"
  expect "http→https 리다이렉트(3xx)" "$(has "301 302 307 308" "$STATUS")"
else
  skip "http→https 리다이렉트 (--http 없음)"
fi

if [ -n "$DEV" ] && [ -n "$DEV_KEY" ]; then
  for p in / /healthz /fe-healthz /api/v1/version /config.json /_next/static/chunks/app-1a2b3c4d.js; do
    fetch "$DEV$p"
    expect "dev: 쿠키 없이 $p 는 404" "$(is "$STATUS" 404)"
  done
  fetch "$DEV/manifest.webmanifest"
  expect "dev: /manifest.webmanifest 는 쿠키 없이 200(게이트 밖)" "$(is "$STATUS" 200)"
  fetch "$DEV/?k=wrong-key"
  expect "dev: 틀린 키는 404" "$(is "$STATUS" 404)"
  fetch "$DEV/?k=$DEV_KEY"
  cookie="$(header_value set-cookie)"
  expect "dev: 올바른 키는 302로 / 이동" "$(is "$STATUS$(header_value location)" 302/)"
  expect "dev: 쿠키 속성(Secure, HttpOnly, SameSite=Lax, Max-Age=1209600)" \
    "$(is "$(has "$cookie" secure)$(has "$cookie" httponly)$(has "$cookie" samesite=lax)$(has "$cookie" max-age=1209600)" 1111)"
  expect "dev: 쿠키 이름은 fit_dev" "$(has "$cookie" "fit_dev=")"
  expect "dev: 쿠키에 Domain 속성이 없다(호스트 전용)" "$(is "$(has "$cookie" "domain=")" 0)"
  check_site dev "$DEV" -H "Cookie: fit_dev=$DEV_KEY"
  fetch "$DEV/" -H "Cookie: fit_dev=wrong-key"
  expect "dev: 틀린 쿠키는 404" "$(is "$STATUS" 404)"
else
  skip "dev 게이트 (--dev, --dev-key 없음)"
fi

if [ "$FAILED" -gt 0 ]; then
  printf '\n%d개 점검 실패\n' "$FAILED"
  exit 1
fi
printf '\n엣지 정상\n'
