#!/usr/bin/env bash
# 엣지를 노트북에서 시험한다(설계 10.5절). 목 BE·FE와 시험용 풀, 로컬 스택의 실제 garage를 쓴다.
#   bash infra/edge/test/test-edge.sh up      # 로컬 스택(garage)과 엣지 시험 환경을 켠다
#   bash infra/edge/test/test-edge.sh verify  # verify-edge.sh와 엣지 동작 시험을 돌린다
#   bash infra/edge/test/test-edge.sh down    # 두 프로젝트의 컨테이너와 볼륨을 지운다
# 필요한 것: docker compose(2.24 이상), curl 7.75 이상, python3, git. 프로젝트 이름은 fit-edge-test-local, fit-edge-test다.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
case "$(uname -s)" in
  MINGW* | MSYS*) export MSYS_NO_PATHCONV=1 ;;
esac
# shellcheck source=/dev/null
. infra/ci/tool-images.sh
PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  for c in python3 python; do
    # Windows의 python3 스토어 바로가기는 실행하면 설치 안내만 출력하므로 실제로 실행해 확인한다
    if "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then
      PY="$c"
      break
    fi
  done
fi
if [ -z "$PY" ]; then
  echo "python 3.9 이상이 필요하다 (PYTHON=경로 로 지정할 수 있다)" >&2
  exit 2
fi

LOCAL_PROJECT=fit-edge-test-local
EDGE_PROJECT=fit-edge-test
HTTP_PORT=18080 HTTPS_PORT=18443
# 시험용 값이다. 엔트로피가 낮은 값이라 시크릿 검사에 걸리지 않는다
KEY="local-test-dev-gate-key-aaaaaaaaaaaaaaaaaaaa"

# 로컬 스택(fit-local.sh)은 프로젝트 이름과 env 파일을 환경변수로 받는다
export FIT_LOCAL_PROJECT="$LOCAL_PROJECT" FIT_LOCAL_ENV=infra/local/local.env.example
# prod와 dev는 호스트로 나뉜다. dev.localhost도 Caddy가 내부 CA로 인증서를 발급한다
export PROD_HOST=localhost DEV_HOST=dev.localhost ACME_EMAIL=ops@example.test ACME_MODE=production HSTS_MODE=off DEV_GATE_KEY="$KEY"
export FIT_NET_EDGE="${LOCAL_PROJECT}_default"
# /_ops(설계 5.2절): B의 IP는 시험 망 net-obs(고정 부분망)의 고정 IP다. 비밀번호는 시험용 값이고 해시는 up에서 만든다(bcrypt는 매번 달라진다)
OPS_PW="edge-test-ops-password-aaaaaaaa"
OPS_B_IP=10.213.99.50
OPS_OTHER_IP=10.213.99.51
export B_IP="$OPS_B_IP" OPS_BASIC_AUTH_USER=opsuser OPS_BASIC_AUTH_HASH="${OPS_BASIC_AUTH_HASH:-placeholder}"
export FIT_EDGE_TEST_HTTP_PORT="$HTTP_PORT" FIT_EDGE_TEST_HTTPS_PORT="$HTTPS_PORT"
# edgectl.sh도 같은 인자로 compose를 부른다(서버에서 쓰는 reload 경로를 그대로 시험한다)
export FIT_EDGE_COMPOSE_ARGS="-p $EDGE_PROJECT -f infra/edge/compose.edge.yml -f infra/edge/test/compose.test.yml"

dc() { docker compose -p "$EDGE_PROJECT" -f infra/edge/compose.edge.yml -f infra/edge/test/compose.test.yml "$@"; }
dcl() { docker compose -p "$LOCAL_PROJECT" -f infra/local/compose.yml --env-file infra/local/local.env.example "$@"; }
garage() { dcl exec -T -e RUST_LOG=warn garage /garage -c /etc/garage/garage.toml "$@"; }
edgectl() { bash infra/edge/edgectl.sh "$@"; }

up() {
  bash infra/local/fit-local.sh up
  # fit-local.sh는 dev 버킷만 만든다. prod 버킷도 같은 키로 쓸 수 있게 만든다
  # shellcheck source=/dev/null
  . infra/local/local.env.example
  garage bucket info fit-prod-photos >/dev/null 2>&1 || garage bucket create fit-prod-photos >/dev/null
  garage bucket allow --read --write --owner fit-prod-photos --key "$S3_ACCESS_KEY" >/dev/null
  garage bucket website --allow fit-prod-photos >/dev/null
  # caddy hash-password의 출력을 base64로 인코딩해 env에 둔다(원본의 $가 env 형식 규칙에 걸린다. Caddy는 base64 형태도 받는다)
  OPS_BASIC_AUTH_HASH="$(docker run --rm "$CADDY_IMAGE" caddy hash-password --plaintext "$OPS_PW" | tr -d '\r\n' | base64 | tr -d '\n')"
  export OPS_BASIC_AUTH_HASH
  # Windows의 Docker Desktop은 127.0.0.1 포트 게시가 가끔 실패한다(listen: The system detected an invalid pointer address).
  # 시작하지 못한 컨테이너만 다시 시도한다(이미 뜬 것은 건드리지 않는다)
  local try=1
  until dc up -d --wait; do
    [ "$try" -lt 8 ] || { echo "FAIL compose up이 ${try}번 모두 실패했다" >&2; return 1; }
    try=$((try + 1))
    sleep 3
  done
  echo "엣지 시험 환경이 떴다: https://$PROD_HOST:$HTTPS_PORT (prod), https://$DEV_HOST:$HTTPS_PORT (dev)"
}

FAILED=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
ok_if() { if [ "$2" = "1" ]; then pass "$1"; else fail "$1"; fi; }
is() { if [ "$1" = "$2" ]; then echo 1; else echo 0; fi; }
has() { case "$1" in *"$2"*) echo 1 ;; *) echo 0 ;; esac; }
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
PROD="https://$PROD_HOST:$HTTPS_PORT"
DEV="https://$DEV_HOST:$HTTPS_PORT"
RESOLVE=(--resolve "$PROD_HOST:$HTTPS_PORT:127.0.0.1" --resolve "$DEV_HOST:$HTTPS_PORT:127.0.0.1")
# 게이트 쿠키는 -b로 보낸다. curl의 --aws-sigv4는 -H로 준 헤더를 서명 대상에 넣어서, Caddy가 지운 Cookie 헤더와 서명이 어긋난다.
# 실제 클라이언트(브라우저의 presigned URL)는 Cookie를 서명하지 않는다
GATE=(-b "fit_dev=$KEY")
# Docker Desktop(Windows)의 포트 포워더는 새 연결을 간헐적으로 거부한다(200건에 1건 정도이고 Caddy 쪽 원인이 아니다).
# curl 자체의 --retry는 이 오류를 재시도하지 않아서, 연결 실패(종료 코드 7)만 다시 시도하는 래퍼를 쓴다.
# 재시도가 결과를 가리는 점검(reload 중 응답, 게시되지 않은 포트)은 재시도 없는 curl_once를 쓴다.
curl_once() { curl -sSk --max-time 60 "${RESOLVE[@]}" "$@"; }
curl_retry() {
  local rc=0
  for _ in 1 2 3; do
    curl_once "$@" 2>/dev/null && return 0
    rc=$?
    [ "$rc" = 7 ] || return "$rc"
    sleep 0.5
  done
  curl_once "$@"
}
# 상태 코드는 -w로 마지막 줄에 받는다(curl의 -o /dev/null은 Git Bash의 Windows용 curl에서 쓰기 오류가 난다)
http_code_once() { curl_once "$@" -w '\n%{http_code}' | tail -n 1; }
http_code() { curl_retry "$@" -w '\n%{http_code}' | tail -n 1; }
resp() { curl_retry -i "$@" | tr -d '\r'; }
body() { resp "$@" | awk 'f { print } /^$/ && !f { f = 1 }'; }
s3sign() { curl_retry --aws-sigv4 "aws:amz:garage:s3" --user "$S3_ACCESS_KEY:$S3_SECRET_KEY" "$@"; }

check_proxy_headers_and_cookies() {
  local out
  for path in /api/echo /echo; do
    out="$(resp "$PROD$path" -H "X-Forwarded-For: 6.6.6.6")"
    ok_if "프록시($path): 외부에서 온 X-Forwarded-For는 무시한다" "$(is "$(has "$out" "xff=6.6.6.6")" 0)"
    ok_if "프록시($path): X-Forwarded-Proto는 https다" "$(has "$out" "proto=https")"
    ok_if "프록시($path): Host는 원본(포트 포함)을 유지한다" "$(has "$out" "host=$PROD_HOST:$HTTPS_PORT")"
  done
  out="$(resp "$PROD/echo" -H "Cookie: fit_prod_session=xyz; other=1")"
  ok_if "prod: 쿠키는 그대로 FE로 전달한다" "$(is "$(has "$out" "fit_prod_session=xyz")$(has "$out" "other=1")" 11)"
  for path in /api/echo /echo; do
    out="$(resp "$DEV$path" -H "Cookie: fit_dev=$KEY; other=1")"
    ok_if "dev($path): 게이트 쿠키는 통과하고 다른 쿠키는 전달한다" "$(is "$(has "$out" "other=1")$(has "$out" "name=dev")" 11)"
    ok_if "dev($path): 게이트 키는 앱 컨테이너로 보내지 않는다" "$(is "$(has "$out" "fit_dev")$(has "$out" "$KEY")" 00)"
  done
  out="$(resp "$PROD/")"
  ok_if "FE 응답의 Cache-Control은 Caddy가 바꾸지 않는다" "$(has "$(lower "$out")" "cache-control: private, no-cache, no-store, max-age=0, must-revalidate")"
  ok_if "Server·X-Powered-By 헤더는 upstream이 보내도 지운다" "$(is "$(has "$(lower "$out")" "server:")$(has "$(lower "$out")" "x-powered-by:")" 00)"
}

check_body_limits() {
  local code
  head -c 1000000 /dev/zero > .tmp-edge-1mb.bin
  head -c 3000000 /dev/zero > .tmp-edge-3mb.bin
  head -c 11000000 /dev/zero > .tmp-edge-11mb.bin
  # 목 BE는 본문을 끝까지 읽는다. 본문을 읽지 않는 upstream은 한도를 넘기 전에 응답을 먼저 돌려줘 한도가 드러나지 않는다
  code="$(http_code -X POST --data-binary @.tmp-edge-3mb.bin "$PROD/api/upload")"
  ok_if "본문 한도: /api 는 2MB 초과를 413으로 거부" "$(is "$code" 413)"
  code="$(http_code -X POST --data-binary @.tmp-edge-1mb.bin "$PROD/api/upload")"
  ok_if "본문 한도: /api 는 2MB 이하(1MB)를 통과" "$(is "$code" 200)"
  code="$(s3sign -X PUT --data-binary @.tmp-edge-11mb.bin "${GATE[@]}" -w '\n%{http_code}' "$DEV/fit-dev-photos/confirmed/too-big.bin" | tail -n 1)"
  ok_if "본문 한도: 사진 경로는 10MB 초과를 413으로 거부" "$(is "$code" 413)"
  rm -f .tmp-edge-1mb.bin .tmp-edge-3mb.bin .tmp-edge-11mb.bin
}

check_photos() {
  local obj="confirmed/edge-test.txt" out
  for env in prod dev; do
    local base="$PROD" extra=()
    if [ "$env" = "dev" ]; then base="$DEV"; extra=("${GATE[@]}"); fi
    ok_if "사진($env): 서명한 S3 PUT이 엣지를 거쳐 통과한다(Host 보존)" \
      "$(is "$(s3sign -X PUT --data-binary "photo-$env" ${extra[@]+"${extra[@]}"} -w '\n%{http_code}' "$base/fit-$env-photos/$obj" | tail -n 1)" 200)"
    ok_if "사진($env): 서명 없는 S3 GET은 403이다" "$(is "$(http_code ${extra[@]+"${extra[@]}"} "$base/fit-$env-photos/$obj")" 403)"
    out="$(resp ${extra[@]+"${extra[@]}"} "$base/photos/$env/confirmed/edge-test.txt")"
    ok_if "사진($env): 웹 엔드포인트로 공개 읽기(200, 본문 일치)" "$(is "$(has "$out" "HTTP/")$(has "$out" "photo-$env")" 11)"
    ok_if "사진($env): 읽기 응답은 Cache-Control: public" "$(has "$(lower "$out")" "cache-control: public, max-age=86400")"
    ok_if "사진($env): pending/은 공개하지 않는다" "$(is "$(http_code ${extra[@]+"${extra[@]}"} "$base/photos/$env/pending/edge-test.txt")" 404)"
    ok_if "사진($env): 서명한 S3 DELETE" \
      "$(is "$(s3sign -X DELETE ${extra[@]+"${extra[@]}"} -w '\n%{http_code}' "$base/fit-$env-photos/$obj" | tail -n 1)" 204)"
  done
  # 호스트마다 자기 환경의 버킷 경로만 프록시한다. 다른 환경의 경로는 FE가 받는다(실제 FE는 404를 낸다)
  ok_if "사진: dev 호스트는 prod 버킷 경로를 garage로 보내지 않는다" "$(has "$(body "${GATE[@]}" "$DEV/fit-prod-photos/confirmed/edge-test.txt")" "mock-fe dev")"
  ok_if "사진: prod 호스트는 dev 버킷 경로를 garage로 보내지 않는다" "$(has "$(body "$PROD/fit-dev-photos/confirmed/edge-test.txt")" "mock-fe blue")"
}

check_static_pool() {
  local out
  out="$(resp "$PROD/_next/static/chunks/old-9f8e7d6c.js")"
  ok_if "풀: 현재 릴리스에 없는 이전 해시 자산을 풀에서 준다(200, immutable)" \
    "$(is "$(has "$out" "pool-old prod")$(has "$(lower "$out")" "cache-control: public, max-age=31536000, immutable")" 11)"
  ok_if "풀: 풀에 있는 자산은 FE를 거치지 않고 Caddy가 준다" "$(has "$(body "$PROD/_next/static/chunks/app-1a2b3c4d.js")" "pool-app prod")"
  ok_if "풀: 풀에 없는 자산은 FE가 대신 응답한다" "$(has "$(body "$PROD/_next/static/chunks/fe-only.js")" "fe-only blue")"
  ok_if "풀: 어디에도 없는 자산은 404다" "$(is "$(http_code "$PROD/_next/static/chunks/nope.js")" 404)"
  ok_if "풀: dev 풀은 prod 풀과 분리돼 있다" "$(has "$(body "${GATE[@]}" "$DEV/_next/static/chunks/old-9f8e7d6c.js")" "pool-old dev")"
  out="$(body --path-as-is "$PROD/_next/static/../../../../etc/passwd")"
  ok_if "풀: 상위 경로(..)로 풀 밖의 파일을 읽을 수 없다" "$(is "$(has "$out" "root:")" 0)"
}

check_streaming() {
  local out first total
  out="$("$PY" infra/edge/test/probe.py "$HTTPS_PORT" "$PROD_HOST" /stream)"
  first="$(printf '%s' "$out" | sed -E 's/.*first=([0-9.]+).*/\1/')"
  total="$(printf '%s' "$out" | sed -E 's/.*total=([0-9.]+).*/\1/')"
  ok_if "스트리밍: 첫 덩어리가 마지막 덩어리(1.5초 뒤)를 기다리지 않고 도착한다(first=$first total=$total)" \
    "$(awk -v f="$first" -v t="$total" 'BEGIN { print (f < 1.0 && t >= 1.4) ? 1 : 0 }')"
}

# set_state 환경 서비스 호스트 포트: 상태 파일을 임시 이름으로 쓴 뒤 mv로 바꾼다(배포 스크립트가 할 일)
set_state() {
  docker run --rm -v "${EDGE_PROJECT}_state:/srv/fit/state" "$CADDY_IMAGE" sh -c \
    "printf 'reverse_proxy $3:$4 {\n\tlb_try_duration 5s\n\tlb_try_interval 250ms\n}\n' > /srv/fit/state/upstream-$1-$2.caddy.new && mv /srv/fit/state/upstream-$1-$2.caddy.new /srv/fit/state/upstream-$1-$2.caddy"
}
active_be() { resp "$PROD/api/v1/version" | tr '[:upper:]' '[:lower:]' | awk -F': ' '$1 == "x-app-version" { print $2 }'; }
active_fe() { body "$PROD/" | sed -nE 's/.*mock-fe ([a-z]+) prod.*/\1/p'; }
ssr_be() { body "$PROD/ssr-probe" | sed -nE 's/^be=(.*)$/\1/p'; }

check_blue_green() {
  local failures server_errors out
  ok_if "전환: 처음 활성 색은 BE blue, FE blue다" "$(is "$(active_be)$(active_fe)" blueblue)"
  ok_if "전환: FE 서버가 내부 리스너로 읽은 BE도 blue다" "$(is "$(ssr_be)" blue)"
  out="$(edgectl status)"
  ok_if "edgectl status: 활성 색 네 줄을 보여 준다" \
    "$(is "$(has "$out" "prod  be  be-prod-blue:8080")$(has "$out" "prod  fe  fe-prod-blue:3000")$(has "$out" "dev   be  be-dev:8080")$(has "$out" "dev   fe  fe-dev:3000")" 1111)"
  set_state prod be be-prod-green 8080
  set_state prod fe fe-prod-green 3000
  ok_if "전환: 상태 파일만 바꾸고 reload하기 전에는 그대로다" "$(is "$(active_be)$(active_fe)" blueblue)"
  # reload하는 동안 요청이 계속 성공해야 한다. 호스트 경로(포트 포워더)와 compose 망 안쪽 경로를 함께 본다
  (for _ in $(seq 1 40); do http_code_once "$PROD/"; sleep 0.1; done) > .tmp-edge-reload.log &
  local bg=$!
  dc exec -T fe-prod-blue python /mock/inner.py http://caddy:8081/api/v1/version 150 > .tmp-edge-inner.log &
  local bg2=$!
  sleep 0.5
  out="$(edgectl reload 2>&1 || true)"
  wait "$bg" "$bg2" || true
  server_errors="$(grep -cE '^(4|5)[0-9][0-9]$' .tmp-edge-reload.log || true)"
  failures="$(tr -d '\r\n' < .tmp-edge-inner.log)"
  rm -f .tmp-edge-reload.log .tmp-edge-inner.log
  ok_if "edgectl reload: 성공 메시지를 낸다" "$(has "$out" "OK reload 완료")"
  ok_if "전환: reload 후 활성 색은 BE green, FE green이다" "$(is "$(active_be)$(active_fe)" greengreen)"
  ok_if "전환: FE는 재시작 없이 BE의 새 색을 본다(내부 리스너 한 곳이 색을 고른다)" "$(is "$(ssr_be)" green)"
  ok_if "전환: reload 중 호스트 경로에서 4xx·5xx 응답이 없다(발견 ${server_errors}건)" "$(is "$server_errors" 0)"
  ok_if "전환: reload 중 compose 망 안의 요청 150건이 모두 성공한다(실패 ${failures}건)" "$(is "$failures" 0)"
  # BE와 FE는 따로 전환된다
  set_state prod be be-prod-blue 8080
  edgectl reload >/dev/null
  ok_if "전환: BE만 blue로 되돌리면 FE는 green 그대로이고 FE가 보는 BE는 blue다" "$(is "$(active_be)$(active_fe)$(ssr_be)" bluegreenblue)"
  # 문법이 틀린 상태 파일은 check와 reload가 거부하고 현재 설정이 유지된다
  docker run --rm -v "${EDGE_PROJECT}_state:/srv/fit/state" "$CADDY_IMAGE" sh -c "printf 'reverse_proxy be-prod-green:8080 {\n' > /srv/fit/state/upstream-prod-be.caddy"
  if edgectl check >/dev/null 2>&1; then fail "안전: 문법이 틀린 상태 파일을 check가 통과시켰다"; else pass "안전: 문법이 틀린 상태 파일은 edgectl check가 거부한다"; fi
  if edgectl reload >/dev/null 2>&1; then fail "안전: 문법이 틀린 상태 파일을 reload가 받아들였다"; else pass "안전: 문법이 틀린 상태 파일은 edgectl reload가 거부한다"; fi
  ok_if "안전: reload가 거부된 뒤에도 서비스는 직전 설정(BE blue)으로 계속 응답한다" "$(is "$(active_be)" blue)"
  set_state prod be be-prod-blue 8080
  # 문법은 맞지만 없는 호스트를 가리키는 upstream은 check와 reload를 통과한다. 그래서 reload 뒤 스모크가 필요하다
  set_state prod be be-prod-nowhere 8080
  edgectl reload >/dev/null || true
  ok_if "스모크 필요: 없는 upstream은 reload를 통과하고 요청은 502다" "$(is "$(http_code "$PROD/healthz")" 502)"
  set_state prod be be-prod-blue 8080
  set_state prod fe fe-prod-blue 3000
  edgectl reload >/dev/null
  ok_if "전환: 모두 blue로 되돌렸다" "$(is "$(active_be)$(active_fe)" blueblue)"
}

# ops_get 클라이언트IP SNI호스트 경로 [사용자:비밀번호]: net-obs의 고정 IP를 가진 컨테이너에서 엣지의 /_ops를 부른다(B를 흉내 낸다)
ops_get() {
  local cip="$1" w ccaddy
  shift
  w="$(pwd -W 2>/dev/null || pwd)"
  ccaddy="$(docker inspect -f "{{(index .NetworkSettings.Networks \"${EDGE_PROJECT}_net-obs\").IPAddress}}" "$(dc ps -q caddy)" | tr -d '\r\n')"
  docker run --rm --network "${EDGE_PROJECT}_net-obs" --ip "$cip" -v "$w/infra/edge/test/ops_probe.py:/p.py:ro" "$PYTHON_IMAGE" python /p.py "$ccaddy" "$@"
}

check_ops_routes() {
  local out svc p good="opsuser:$OPS_PW"
  for svc in prometheus alertmanager; do
    out="$(ops_get "$OPS_B_IP" "$PROD_HOST" "/_ops/$svc/healthy" "$good")"
    ok_if "/_ops($svc): B의 IP와 올바른 자격이면 200이고 upstream의 /-/healthy 응답이다" "$(is "$(has "$out" '200 ')$(has "$out" 'is Healthy')" 11)"
  done
  out="$(ops_get "$OPS_B_IP" "$PROD_HOST" /_ops/prometheus/healthy "opsuser:wrong-password-aaaaaaaa")"
  ok_if "/_ops: 틀린 비밀번호는 404이고 WWW-Authenticate가 없다" "$(has "$out" "404 www-authenticate=no body=''")"
  out="$(ops_get "$OPS_B_IP" "$PROD_HOST" /_ops/prometheus/healthy "wrong:$OPS_PW")"
  ok_if "/_ops: 틀린 사용자 이름은 404이고 WWW-Authenticate가 없다" "$(has "$out" "404 www-authenticate=no body=''")"
  out="$(ops_get "$OPS_B_IP" "$PROD_HOST" /_ops/prometheus/healthy)"
  ok_if "/_ops: 자격이 없으면 401이 아니라 404이고 WWW-Authenticate가 없다" "$(has "$out" "404 www-authenticate=no body=''")"
  out="$(ops_get "$OPS_OTHER_IP" "$PROD_HOST" /_ops/prometheus/healthy "$good")"
  ok_if "/_ops: 올바른 자격이어도 B의 IP가 아니면 404다" "$(has "$out" "404 www-authenticate=no body=''")"
  ok_if "/_ops: 호스트(B의 IP가 아닌 곳)에서도 자격을 줘도 404다" "$(is "$(http_code -u "$good" "$PROD/_ops/prometheus/healthy")" 404)"
  for p in /_ops /_ops/ /_ops/prometheus/ /_ops/prometheus/healthy/x /_ops/prometheus/-/healthy /_ops/prometheus/api/v1/targets /_ops/prometheus/metrics /_ops/alertmanager/api/v2/status; do
    out="$(ops_get "$OPS_B_IP" "$PROD_HOST" "$p" "$good")"
    ok_if "/_ops: B의 IP와 올바른 자격이어도 $p 는 없다(404, upstream에 닿지 않는다)" "$(has "$out" "404 www-authenticate=no body=''")"
  done
  out="$(ops_get "$OPS_B_IP" "$DEV_HOST" /_ops/prometheus/healthy "$good")"
  ok_if "/_ops: dev 호스트에는 없다(404)" "$(has "$out" "404 www-authenticate=no body=''")"
  if (unset B_IP; dc config >/dev/null 2>&1); then fail "/_ops: B_IP 없이도 compose가 설정을 만들었다"; else pass "/_ops: B_IP가 없으면 compose가 거부한다(조용히 열리지 않는다)"; fi
  if (unset OPS_BASIC_AUTH_HASH; dc config >/dev/null 2>&1); then fail "/_ops: OPS_BASIC_AUTH_HASH 없이도 compose가 설정을 만들었다"; else pass "/_ops: OPS_BASIC_AUTH_HASH가 없으면 compose가 거부한다"; fi
}

check_internal_and_logs() {
  local logs
  ok_if "내부 리스너: dev의 FE 서버는 dev BE를 본다" "$(is "$(body "${GATE[@]}" "$DEV/ssr-probe" | sed -nE 's/^be=(.*)$/\1/p')" dev)"
  ok_if "내부 리스너: 호스트에는 게시되지 않는다(8081, 8082)" \
    "$(is "$(http_code_once --max-time 3 http://127.0.0.1:8081/healthz 2>/dev/null || true)$(http_code_once --max-time 3 http://127.0.0.1:8082/healthz 2>/dev/null || true)" 000000)"
  http_code "$DEV/?k=$KEY" >/dev/null
  http_code "${GATE[@]}" "$DEV/" >/dev/null
  logs="$(dc logs caddy 2>&1)"
  ok_if "로그: dev 키(쿼리 k와 쿠키)가 로그에 남지 않는다" "$(is "$(has "$logs" "$KEY")" 0)"
  ok_if "로그: 접근 로그는 JSON이다" "$(has "$logs" '"request":{')"
  ok_if "메트릭: compose 망 안에서 caddy:9180/metrics 가 응답한다" \
    "$(has "$(dc exec -T be-dev python -c "import urllib.request; print(urllib.request.urlopen('http://caddy:9180/metrics').read(200000).decode())" 2>/dev/null)" "caddy_http_requests_total")"
  ok_if "메트릭: 호스트에는 게시되지 않는다" "$(is "$(http_code_once --max-time 3 http://127.0.0.1:9180/metrics 2>/dev/null || true)" 000)"
  ok_if "관리 API(2019)는 호스트에 게시되지 않는다" "$(is "$(http_code_once --max-time 3 http://127.0.0.1:2019/config/ 2>/dev/null || true)" 000)"
  ok_if "http→https 리다이렉트는 엣지의 80이 한다" "$(has "301 302 307 308" "$(http_code "http://$PROD_HOST:$HTTP_PORT/")")"
}

verify() {
  # shellcheck source=/dev/null
  . infra/local/local.env.example
  FAILED=0
  bash infra/edge/verify-edge.sh --prod "$PROD" --dev "$DEV" --dev-key "$KEY" --http "http://$PROD_HOST:$HTTP_PORT" \
    --resolve "$PROD_HOST:$HTTPS_PORT:127.0.0.1" --resolve "$DEV_HOST:$HTTPS_PORT:127.0.0.1" --retry 3 --insecure || FAILED=$((FAILED + 1))
  echo "--- 엣지 동작 시험"
  check_proxy_headers_and_cookies
  check_body_limits
  check_photos
  check_static_pool
  check_streaming
  check_ops_routes
  check_blue_green
  check_internal_and_logs
  if [ "$FAILED" -gt 0 ]; then
    printf '\n%d개 점검 실패\n' "$FAILED"
    return 1
  fi
  printf '\n엣지 시험 통과\n'
}

down() {
  dc down -v
  bash infra/local/fit-local.sh reset
}

case "${1:-}" in
  up) up ;;
  verify) verify ;;
  down) down ;;
  *) echo "사용: bash infra/edge/test/test-edge.sh up | verify | down" >&2; exit 2 ;;
esac
