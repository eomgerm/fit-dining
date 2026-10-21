#!/usr/bin/env bash
# 배포 스크립트를 노트북에서 시험한다(설계 10.5절). 실제 Caddy와 목 BE·FE 이미지로 서버 A를 흉내 낸다.
#   bash infra/deploy/test/test-deploy.sh up     # 가짜 서버 디렉터리, 공유 망, 엣지, 시험용 저장소와 목 이미지를 만든다
#   bash infra/deploy/test/test-deploy.sh run    # 배포·롤백·실패 복구·기동 시나리오를 돌린다
#   bash infra/deploy/test/test-deploy.sh down   # 시험이 만든 컨테이너, 이미지, 망, 디렉터리를 지운다
# 필요한 것: docker compose(2.24 이상), curl, git, python 3.9 이상. 시험용 이름은 접두사 fit-deploytest로 시작한다.
# 시험용 서버는 저장소 안의 .tmp-deploytest/에 있다(env 파일, 상태, 정적 자산 풀, 시험용 git 저장소).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
case "$(uname -s)" in
  MINGW* | MSYS*) export MSYS_NO_PATHCONV=1 ;;
esac
W="$(pwd -W 2>/dev/null || pwd)"
T="$W/.tmp-deploytest"
PREFIX=fit-deploytest-
HTTPS_PORT=18443
# 시험용 값이다. 엔트로피가 낮은 값이라 시크릿 검사에 걸리지 않는다
KEY="local-test-dev-gate-key-aaaaaaaaaaaaaaaaaaaa"

# 서버에서는 기본값을 쓰는 경로와 이름을 시험용으로 바꾼다
export FIT_ENV_DIR="$T/etc" FIT_STATE_DIR="$T/state" FIT_WEB_DIR="$T/web" FIT_BACKUP_DIR="$T/backups" FIT_REPO_DIR="$T/repo"
export FIT_NET_PREFIX="$PREFIX" FIT_NET_EDGE="${PREFIX}net-edge" FIT_NET_PROD="${PREFIX}net-prod" FIT_NET_DEV="${PREFIX}net-dev"
export FIT_NET_DATA="${PREFIX}net-data" FIT_NET_OBS="${PREFIX}net-obs"
export FIT_BE_IMAGE=fit-deploytest/be FIT_FE_IMAGE=fit-deploytest/fe FIT_EDGE_PROJECT=fit-deploytest-edge
export FIT_EDGE_COMPOSE_ARGS="-p $FIT_EDGE_PROJECT -f $W/infra/edge/compose.edge.yml -f $W/infra/deploy/test/compose.sim-edge.yml"
export FIT_DEPLOY_TEST_HTTPS_PORT="$HTTPS_PORT"
export PROD_HOST=localhost DEV_HOST=dev.localhost ACME_EMAIL=ops@example.test ACME_MODE=production HSTS_MODE=off DEV_GATE_KEY="$KEY"
export FIT_EDGE_ENV="$T/etc/edge.env" FIT_SMOKE_PORT="$HTTPS_PORT" FIT_SMOKE_INSECURE=1 FIT_SMOKE_RETRIES=3
export FIT_SMOKE_SEARCH_PATH="/api/v1/search?q=a"
export FIT_DRAIN_SECONDS=1 FIT_BE_READY_TIMEOUT=40 FIT_FE_READY_TIMEOUT=30
export FIT_MEM_AVAILABLE_MB=8000 FIT_SKIP_PERM=1 FIT_PREDEPLOY_DUMP="$ROOT/infra/deploy/test/fake-dump.sh"
export FIT_NOTIFY_WEBHOOK=http://127.0.0.1:18099/hook

PY=""
for c in "${PYTHON:-}" python3 python; do
  [ -n "$c" ] || continue
  if "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then
    PY="$c"
    break
  fi
done
[ -n "$PY" ] || {
  echo "python 3.9 이상이 필요하다 (PYTHON=경로 로 지정할 수 있다)" >&2
  exit 2
}

dc_edge() {
  local -a args
  read -r -a args <<<"docker compose $FIT_EDGE_COMPOSE_ARGS"
  "${args[@]}" "$@"
}

# 시험용 git 저장소: c1~c8과 c1에서 갈라진 s1. c4는 마이그레이션 파일을 더한다
make_repo() {
  rm -rf "$T/repo"
  mkdir -p "$T/repo/be/src/main/resources/db/migration"
  git -C "$T/repo" init -q -b main
  git -C "$T/repo" config user.email t@t.t
  git -C "$T/repo" config user.name t
  git -C "$T/repo" config commit.gpgsign false
  git -C "$T/repo" config core.autocrlf false
  echo "create table a();" >"$T/repo/be/src/main/resources/db/migration/V1__init.sql"
  git -C "$T/repo" add -A
  git -C "$T/repo" commit -q -m c1
  local n
  for n in 2 3; do git -C "$T/repo" commit -q --allow-empty -m "c$n"; done
  echo "alter table a add column b int;" >"$T/repo/be/src/main/resources/db/migration/V2__b.sql"
  git -C "$T/repo" add -A
  git -C "$T/repo" commit -q -m c4
  for n in 5 6 7 8; do git -C "$T/repo" commit -q --allow-empty -m "c$n"; done
  git -C "$T/repo" checkout -q -b side "$(git -C "$T/repo" rev-list --max-parents=0 HEAD)"
  git -C "$T/repo" commit -q --allow-empty -m s1
  git -C "$T/repo" checkout -q main
  {
    for n in 1 2 3 4 5 6 7 8; do echo "C$n=$(git -C "$T/repo" rev-parse "main~$((8 - n))")"; done
    echo "S1=$(git -C "$T/repo" rev-parse side)"
  } >"$T/shas.env"
}

# 예제 env 파일에서 시험용 env 파일을 만든다. 자리표시자를 채우고 환경 이름을 맞춘다
make_envs() {
  mkdir -p "$T/etc"
  local env
  for env in prod dev; do
    sed -e 's/REPLACE_ME/test-value/' -e "s/dev/$env/g" infra/app/app.env.example >"$T/etc/$env.env"
    sed -e 's/REPLACE_ME/test-value/' -e "s/dev/$env/g" -e "s/8082/$([ "$env" = prod ] && echo 8081 || echo 8082)/" infra/app/fe.env.example >"$T/etc/fe-$env.env"
    sed -e 's/REPLACE_ME/test-value/' -e "s/dev/$env/g" infra/app/migrate.env.example >"$T/etc/migrate-$env.env"
    chmod 640 "$T/etc/$env.env" "$T/etc/fe-$env.env" "$T/etc/migrate-$env.env"
  done
  # migrate 프로필 이름은 환경과 상관없이 migrate다
  sed -i 's/^SPRING_PROFILES_ACTIVE=.*/SPRING_PROFILES_ACTIVE=migrate/' "$T/etc/migrate-prod.env" "$T/etc/migrate-dev.env"
  printf 'PROD_HOST=%s\nDEV_HOST=%s\nACME_EMAIL=%s\nACME_MODE=%s\nHSTS_MODE=%s\nDEV_GATE_KEY=%s\n' \
    "$PROD_HOST" "$DEV_HOST" "$ACME_EMAIL" "$ACME_MODE" "$HSTS_MODE" "$DEV_GATE_KEY" >"$T/etc/edge.env"
}

build_images() { # build_images sha BE모드 FE모드
  docker build -q -t "$FIT_BE_IMAGE:$1" --build-arg "SHA=$1" --build-arg "MODE=$2" infra/deploy/test/mock-be >/dev/null
  docker build -q -t "$FIT_FE_IMAGE:$1" --build-arg "SHA=$1" --build-arg "MODE=$3" infra/deploy/test/mock-fe >/dev/null
}

up() {
  down >/dev/null 2>&1 || true
  mkdir -p "$T/state" "$T/web" "$T/backups"
  make_repo
  make_envs
  # shellcheck source=/dev/null
  . "$T/shas.env"
  bash infra/host/networks.sh
  # 엣지의 첫 상태 파일은 견본 그대로다(prod는 blue, dev는 be-dev·fe-dev를 가리킨다)
  cp infra/edge/state-sample/upstream-*.caddy "$T/state/"
  dc_edge up -d --wait
  build_images "$C1" ok ok
  build_images "$C2" ok ok
  build_images "$C3" unready ok
  build_images "$C4" ok proxy-fail
  build_images "$C5" migrate-fail ok
  build_images "$C6" ok ok
  build_images "$C7" ok broken
  build_images "$C8" fallback ok
  build_images "$S1" ok ok
  echo "배포 시험 환경이 떴다: https://$PROD_HOST:$HTTPS_PORT (prod), https://$DEV_HOST:$HTTPS_PORT (dev)"
}

down() {
  local c n
  for c in be-prod-blue be-prod-green fe-prod-blue fe-prod-green be-dev fe-dev; do docker rm -f "$c" >/dev/null 2>&1 || true; done
  dc_edge down -v >/dev/null 2>&1 || true
  docker rm -f fit-migrate-prod fit-migrate-dev >/dev/null 2>&1 || true
  for r in "$FIT_BE_IMAGE" "$FIT_FE_IMAGE"; do
    docker image ls "$r" -q 2>/dev/null | sort -u | xargs -r docker image rm -f >/dev/null 2>&1 || true
  done
  for n in net-edge net-prod net-dev net-data net-obs net-dbaccess; do docker network rm "$PREFIX$n" >/dev/null 2>&1 || true; done
  if [ -f "$T/sink.pid" ]; then kill "$(cat "$T/sink.pid")" >/dev/null 2>&1 || true; fi
  rm -rf "$T"
  echo "정리했다"
}

# ---- 시나리오 ----------------------------------------------------------------
FAILED=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); if [ -n "${out:-}" ]; then printf '%s\n' "$out" | tail -n 8 | sed 's/^/FAIL  > /'; fi; }
ok_if() { if [ "$2" = 1 ]; then pass "$1"; else fail "$1"; fi; }
is() { if [ "$1" = "$2" ]; then echo 1; else echo 0; fi; }
has() { case "$1" in *"$2"*) echo 1 ;; *) echo 0 ;; esac; }

PROD="https://$PROD_HOST:$HTTPS_PORT"
DEVU="https://$DEV_HOST:$HTTPS_PORT"
RESOLVE=(--resolve "$PROD_HOST:$HTTPS_PORT:127.0.0.1" --resolve "$DEV_HOST:$HTTPS_PORT:127.0.0.1")
# Docker Desktop(Windows)의 포트 포워더는 새 연결을 간헐적으로 거부한다(Caddy 쪽 원인이 아니다). 연결 실패(종료 코드 7)만 다시 시도한다
curl_retry() {
  local rc=0 _
  for _ in 1 2 3 4; do
    curl -sk --max-time 30 "${RESOLVE[@]}" "$@" && return 0
    rc=$?
    [ "$rc" = 7 ] || return "$rc"
    sleep 1
  done
  return "$rc"
}
sha_of() { sed -n 's/.*"sha"[[:space:]]*:[[:space:]]*"\([0-9a-f]*\)".*/\1/p'; }
be_sha() { curl_retry "$PROD/api/v1/version" | sha_of; }
fe_sha() { curl_retry "$PROD/" | sed -n 's/.*mock-fe \([0-9a-f]*\) prod.*/\1/p'; }
dev_be_sha() { curl_retry -b "fit_dev=$KEY" "$DEVU/api/v1/version" | sha_of; }
dev_fe_sha() { curl_retry -b "fit_dev=$KEY" "$DEVU/" | sed -n 's/.*mock-fe \([0-9a-f]*\) dev.*/\1/p'; }
# 상태 코드만 본다(Git Bash의 Windows용 curl은 -o /dev/null이 쓰기 오류를 낸다)
code_of() { curl_retry -o "$T/code.out" -w '%{http_code}' "$@" 2>/dev/null || true; }
# 컨테이너 상태: true, false 또는 없으면 missing(Windows의 docker inspect는 없는 컨테이너에도 빈 줄을 출력한다)
running() {
  local r
  r="$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null | tr -d '\r\n')"
  echo "${r:-missing}"
}
st() { state_get "$@"; } # st 환경 키
OUT_ALL=""

run_deploy() { # run_deploy 인자...: out, rc를 채운다. CI=true로 돌린다
  out="$(CI=true bash infra/deploy/deploy.sh "$@" 2>&1)" && rc=0 || rc=$?
  printf '%s\n' "$out" >>"$OUT_ALL"
}

run_unit_checks() {
  echo "--- 공통 함수"
  ok_if "sha_match: 앞부분이 같으면 같은 커밋이다" "$(sha_match abc1234 abc1234567 && echo 1 || echo 0)"
  ok_if "sha_match: 다르면 다르다" "$(sha_match abc1234 def1234567 && echo 0 || echo 1)"
  ok_if "sha_match: 7자 미만은 거부한다" "$(sha_match abc123 abc1234567 && echo 0 || echo 1)"
  ok_if "json_string: 키의 값을 뽑는다" "$(is "$(json_string sha '{"sha": "ab12", "x": "y"}')" ab12)"
  state_set prod DEMO_KEY=one OTHER=2
  state_set prod DEMO_KEY=two
  ok_if "state_set: 같은 키는 나중 값이 이기고 다른 키는 남는다" "$(is "$(st prod DEMO_KEY)$(st prod OTHER)" two2)"
  rm -f "$FIT_STATE_DIR/deploy-prod.env"
  ok_if "migrations_changed: 마이그레이션 파일이 바뀐 구간과 첫 배포만 참이다" \
    "$(is "$(migrations_changed "$C1" "$C2" && echo 0 || echo 1)$(migrations_changed "$C2" "$C4" && echo 1 || echo 0)$(migrations_changed none "$C1" && echo 1 || echo 0)" 111)"
  echo "--- 잠금"
  mkdir -p "$FIT_STATE_DIR/deploy-prod.lock"
  sleep 60 &
  local live=$!
  echo "$live" >"$FIT_STATE_DIR/deploy-prod.lock/pid"
  out="$(bash -c ". infra/deploy/lib.sh; acquire_lock prod" 2>&1)" && rc=0 || rc=$?
  ok_if "살아 있는 프로세스가 쥔 잠금이 있으면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '다른 배포가 돌고 있다')" = 1 ] && echo 1 || echo 0)"
  kill "$live" 2>/dev/null || true
  echo 99999999 >"$FIT_STATE_DIR/deploy-prod.lock/pid"
  out="$(bash -c ". infra/deploy/lib.sh; acquire_lock prod; echo got" 2>&1)" && rc=0 || rc=$?
  ok_if "프로세스가 죽어 남은 잠금은 지우고 새로 잡는다" "$([ "$rc" = 0 ] && [ "$(has "$out" got)" = 1 ] && echo 1 || echo 0)"
  rm -rf "$FIT_STATE_DIR/deploy-prod.lock"
  echo "--- 파일 권한 점검(Linux 컨테이너에서 실제 권한 비트로 확인한다)"
  out="$(docker run --rm -v "$W/infra/deploy:/d:ro" ubuntu:24.04 bash -c '
    . /d/lib.sh
    cp /d/lib.sh /tmp/a; chmod 640 /tmp/a; mode_is_private /tmp/a && echo "640:private"
    chmod 600 /tmp/a; mode_is_private /tmp/a && echo "600:private"
    chmod 644 /tmp/a; mode_is_private /tmp/a || echo "644:open"
    chmod 660 /tmp/a; mode_is_private /tmp/a && echo "660:private"
    chmod 604 /tmp/a; mode_is_private /tmp/a || echo "604:open"' 2>&1)"
  ok_if "mode_is_private: 640·600·660은 통과하고 644·604는 거부한다" \
    "$([ "$(has "$out" 640:private)$(has "$out" 600:private)$(has "$out" 660:private)$(has "$out" 644:open)$(has "$out" 604:open)" = 11111 ] && echo 1 || echo 0)"
}

run_guard_checks() {
  echo "--- 입력과 사전 점검"
  # shellcheck source=/dev/null
  . "$T/shas.env"
  out="$(bash infra/deploy/deploy.sh prod 2>&1)" && rc=0 || rc=$?
  ok_if "인자가 모자라면 종료 코드 2다" "$(is "$rc" 2)"
  out="$(bash infra/deploy/deploy.sh prod "$C1" 2>&1)" && rc=0 || rc=$?
  ok_if "CI 밖에서 SKIP_VERIFY 없이 직접 배포하면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" SKIP_VERIFY)" = 1 ] && echo 1 || echo 0)"
  out="$(bash infra/deploy/preflight.sh prod "$C1" 2>&1)" && rc=0 || rc=$?
  ok_if "정상 상태에서 사전 점검이 통과한다" "$(is "$rc" 0)"
  mv "$T/etc/prod.env" "$T/prod.env.bak"
  out="$(bash infra/deploy/preflight.sh prod "$C1" 2>&1)" && rc=0 || rc=$?
  ok_if "env 파일이 없으면 사전 점검이 실패한다" "$([ "$rc" = 1 ] && [ "$(has "$out" 'FAIL  prod.env: 파일이 없다')" = 1 ] && echo 1 || echo 0)"
  mv "$T/prod.env.bak" "$T/etc/prod.env"
  cp "$T/etc/prod.env" "$T/prod.env.bak"
  sed -i 's/^JWT_SECRET=.*/JWT_SECRET=REPLACE_ME/' "$T/etc/prod.env"
  out="$(bash infra/deploy/preflight.sh prod "$C1" 2>&1)" && rc=0 || rc=$?
  ok_if "자리표시자(REPLACE_ME)가 남아 있으면 사전 점검이 실패한다" "$([ "$rc" = 1 ] && [ "$(has "$out" '자리표시자')" = 1 ] && echo 1 || echo 0)"
  cp "$T/prod.env.bak" "$T/etc/prod.env"
  sed -i 's/^APP_ENV=.*/APP_ENV=dev/' "$T/etc/prod.env"
  out="$(bash infra/deploy/preflight.sh prod "$C1" 2>&1)" && rc=0 || rc=$?
  ok_if "prod 파일에 APP_ENV=dev가 있으면 사전 점검이 실패한다(환경이 섞이지 않게)" "$([ "$rc" = 1 ] && [ "$(has "$out" 'FAIL  prod.env: APP_ENV가 prod이다')" = 1 ] && echo 1 || echo 0)"
  cp "$T/prod.env.bak" "$T/etc/prod.env"
  sed -i '/^JWT_SECRET=/d' "$T/etc/prod.env"
  out="$(bash infra/deploy/preflight.sh prod "$C1" 2>&1)" && rc=0 || rc=$?
  ok_if "필수 키가 빠지면 사전 점검이 실패한다" "$([ "$rc" = 1 ] && [ "$(has "$out" 'FAIL  prod.env: 형식과 필수 키')" = 1 ] && echo 1 || echo 0)"
  cp "$T/prod.env.bak" "$T/etc/prod.env"
  rm -f "$T/prod.env.bak"
  cp "$T/etc/fe-prod.env" "$T/fe-prod.env.bak"
  sed -i 's/^BE_INTERNAL_URL=.*/BE_INTERNAL_URL=http:\/\/caddy:8082/' "$T/etc/fe-prod.env"
  out="$(bash infra/deploy/preflight.sh prod "$C1" 2>&1)" && rc=0 || rc=$?
  ok_if "prod의 FE가 dev 내부 리스너(8082)를 가리키면 사전 점검이 실패한다(환경이 섞이지 않게)" "$([ "$rc" = 1 ] && [ "$(has "$out" 'FAIL  fe-prod.env: BE_INTERNAL_URL')" = 1 ] && echo 1 || echo 0)"
  cp "$T/fe-prod.env.bak" "$T/etc/fe-prod.env"
  rm -f "$T/fe-prod.env.bak"
  out="$(FIT_MEM_AVAILABLE_MB=100 bash infra/deploy/preflight.sh prod "$C1" 2>&1)" && rc=0 || rc=$?
  ok_if "메모리 여유가 모자라면 사전 점검이 실패한다" "$([ "$rc" = 1 ] && [ "$(has "$out" 'FAIL  메모리 여유')" = 1 ] && echo 1 || echo 0)"
  out="$(bash infra/deploy/preflight.sh prod aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 2>&1)" && rc=0 || rc=$?
  ok_if "이미지나 커밋이 없는 SHA는 사전 점검이 실패한다" "$([ "$rc" = 1 ] && [ "$(has "$out" 'FAIL  이미지')" = 1 ] && [ "$(has "$out" 'FAIL  저장소에 커밋')" = 1 ] && echo 1 || echo 0)"
}

run_prod_checks() {
  echo "--- prod 첫 배포(c1)"
  # shellcheck source=/dev/null
  . "$T/shas.env"
  run_deploy prod "$C1"
  ok_if "첫 배포가 성공한다" "$(is "$rc" 0)"
  ok_if "엣지 경유 BE 버전과 FE 페이지가 c1이다" "$(is "$(be_sha)$(fe_sha)" "$C1$C1")"
  ok_if "blue만 떠 있고 green은 만들어지지 않았다" "$(is "$(running be-prod-blue)$(running fe-prod-blue)$(running be-prod-green)" truetruemissing)"
  ok_if "상태: 활성 blue, 배포한 SHA c1" "$(is "$(st prod BE_ACTIVE)$(st prod FE_ACTIVE)$(st prod DEPLOYED_SHA)" "blueblue$C1")"
  ok_if "마이그레이션 전 사전 덤프가 실행됐다(첫 배포)" "$([ -f "$FIT_BACKUP_DIR/predeploy-prod-$C1.dump" ] && echo 1 || echo 0)"
  ok_if "정적 자산 풀에 c1의 자산과 공용 자산이 쌓였다" \
    "$([ -f "$FIT_WEB_DIR/prod/pool/_next/static/chunks/app-${C1:0:7}.js" ] && [ -f "$FIT_WEB_DIR/prod/pool/_next/static/chunks/shared.js" ] && echo 1 || echo 0)"
  ok_if "이력에 배포 시작·전환·끝이 남았다" \
    "$([ "$(grep -c "deploy-start all $C1" "$FIT_STATE_DIR/history-prod.log")" = 1 ] && [ "$(grep -c "switch be $C1 blue" "$FIT_STATE_DIR/history-prod.log")" = 1 ] && [ "$(grep -c "deploy-end all $C1 ok" "$FIT_STATE_DIR/history-prod.log")" = 1 ] && echo 1 || echo 0)"

  echo "--- prod 두 번째 배포(c2): 반대 색으로 전환"
  # 정리 시험: 오래된 풀 파일은 지워지고 이번 릴리스가 가진 공용 자산은 남는다
  echo "// stale" >"$FIT_WEB_DIR/prod/pool/_next/static/chunks/stale.js"
  touch -d '40 days ago' "$FIT_WEB_DIR/prod/pool/_next/static/chunks/stale.js"
  run_deploy prod "$C2"
  ok_if "두 번째 배포가 성공한다" "$(is "$rc" 0)"
  ok_if "엣지 경유 BE와 FE가 c2다" "$(is "$(be_sha)$(fe_sha)" "$C2$C2")"
  ok_if "green이 새 색이고 blue(c1)는 멈췄다(컨테이너는 남아 있다)" \
    "$(is "$(running be-prod-green)$(running fe-prod-green)$(running be-prod-blue)$(running fe-prod-blue)" truetruefalsefalse)"
  ok_if "상태: 활성 green, 이전 SHA c1" "$(is "$(st prod BE_ACTIVE)$(st prod FE_ACTIVE)$(st prod DEPLOYED_SHA)$(st prod PREVIOUS_SHA)" "greengreen$C2$C1")"
  ok_if "마이그레이션 변경이 없으면 사전 덤프를 만들지 않는다" "$([ ! -e "$FIT_BACKUP_DIR/predeploy-prod-$C2.dump" ] && echo 1 || echo 0)"
  ok_if "누적 풀: 이전 릴리스(c1)의 해시 자산을 Caddy가 계속 준다(열려 있는 탭이 404를 만나지 않는다)" \
    "$(is "$(code_of "$PROD/_next/static/chunks/app-${C1:0:7}.js")$(code_of "$PROD/_next/static/chunks/app-${C2:0:7}.js")" 200200)"
  ok_if "풀 정리: 오래된 파일은 지우고 공용 자산(shared.js)은 남긴다" \
    "$([ ! -e "$FIT_WEB_DIR/prod/pool/_next/static/chunks/stale.js" ] && [ -f "$FIT_WEB_DIR/prod/pool/_next/static/chunks/shared.js" ] && echo 1 || echo 0)"
  ok_if "알림: 배포 완료 메시지가 웹훅으로 갔다" "$(has "$(cat "$T/webhook.log" 2>/dev/null)" '배포 완료: prod')"

  echo "--- BE가 준비되지 않는 배포(c3): 트래픽을 옮기지 않고 치운다"
  run_deploy prod "$C3"
  ok_if "배포가 실패한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '새 색')" = 1 ] && echo 1 || echo 0)"
  ok_if "서비스는 c2 그대로다" "$(is "$(be_sha)$(fe_sha)" "$C2$C2")"
  ok_if "새 색 컨테이너를 치웠고 상태의 태그를 되돌렸다" "$(is "$(running be-prod-blue)$(st prod BE_BLUE_TAG)$(st prod BE_ACTIVE)" "missing${C1}green")"
  ok_if "알림: 배포 실패 메시지가 웹훅으로 갔다" "$(has "$(cat "$T/webhook.log" 2>/dev/null)" '배포 실패: prod')"

  echo "--- 엣지 전환 뒤 FE 확인이 실패하는 배포(c4): FE는 이전 색으로 돌아간다"
  run_deploy prod "$C4"
  ok_if "배포가 실패한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '엣지 전환 뒤 확인에 실패')" = 1 ] && echo 1 || echo 0)"
  ok_if "마이그레이션이 있어 사전 덤프와 마이그레이션을 먼저 실행했다" "$([ -f "$FIT_BACKUP_DIR/predeploy-prod-$C4.dump" ] && [ "$(has "$out" '마이그레이션 실행')" = 1 ] && echo 1 || echo 0)"
  ok_if "BE는 c4로 전환됐고 FE는 c2로 돌아왔다(새 BE는 이전 FE와 호환돼야 한다)" "$(is "$(be_sha)$(fe_sha)" "$C4$C2")"
  ok_if "상태: BE blue, FE green, 마지막 완전한 배포 SHA는 c2" "$(is "$(st prod BE_ACTIVE)$(st prod FE_ACTIVE)$(st prod DEPLOYED_SHA)" "bluegreen$C2")"
  ok_if "실패한 FE 새 색 컨테이너를 치웠다" "$(is "$(running fe-prod-blue)" missing)"

  echo "--- 롤백: BE만 이전 색으로"
  out="$(bash infra/deploy/rollback.sh prod be 2>&1)" && rc=0 || rc=$?
  printf '%s\n' "$out" >>"$OUT_ALL"
  ok_if "롤백이 성공한다" "$(is "$rc" 0)"
  ok_if "BE가 c2로 돌아왔고 FE는 그대로다" "$(is "$(be_sha)$(fe_sha)" "$C2$C2")"
  ok_if "상태: BE green, 이력에 롤백이 남았다" "$([ "$(st prod BE_ACTIVE)" = green ] && [ "$(grep -c "rollback be $C2 green" "$FIT_STATE_DIR/history-prod.log")" = 1 ] && echo 1 || echo 0)"

  echo "--- 사전 덤프 실패와 마이그레이션 실패(c5): 트래픽을 건드리기 전에 멈춘다"
  out="$(FAKE_DUMP_FAIL=1 CI=true bash infra/deploy/deploy.sh prod "$C5" 2>&1)" && rc=0 || rc=$?
  printf '%s\n' "$out" >>"$OUT_ALL"
  ok_if "사전 덤프가 실패하면 배포가 멈춘다" "$([ "$rc" != 0 ] && [ "$(has "$out" '사전 덤프에 실패')" = 1 ] && echo 1 || echo 0)"
  run_deploy prod "$C5"
  ok_if "마이그레이션이 실패하면 배포가 멈춘다" "$([ "$rc" != 0 ] && [ "$(has "$out" '마이그레이션에 실패')" = 1 ] && echo 1 || echo 0)"
  ok_if "두 경우 모두 서비스는 c2 그대로다" "$(is "$(be_sha)$(fe_sha)" "$C2$C2")"
  ok_if "배포 잠금이 남지 않았다" "$([ ! -e "$FIT_STATE_DIR/deploy-prod.lock" ] && echo 1 || echo 0)"

  echo "--- 정상 배포(c6)와 전체 롤백"
  run_deploy prod "$C6"
  ok_if "배포가 성공한다" "$(is "$rc" 0)"
  ok_if "엣지 경유 BE와 FE가 c6이고 상태의 이전 SHA는 c2다" "$(is "$(be_sha)$(fe_sha)$(st prod DEPLOYED_SHA)$(st prod PREVIOUS_SHA)" "$C6$C6$C6$C2")"
  ok_if "검색 폴백 점검이 통과했다(X-Fallback 없음)" "$(has "$out" 'BE: 검색이 폴백으로 처리되지 않았다')"
  out="$(bash infra/deploy/rollback.sh prod 2>&1)" && rc=0 || rc=$?
  printf '%s\n' "$out" >>"$OUT_ALL"
  ok_if "rollback.sh prod가 성공한다" "$(is "$rc" 0)"
  ok_if "BE와 FE가 c2로 돌아오고 상태의 배포 SHA도 c2다" "$(is "$(be_sha)$(fe_sha)$(st prod DEPLOYED_SHA)" "$C2$C2$C2")"

  echo "--- 다운그레이드 가드와 재배포"
  run_deploy prod "$C1"
  ok_if "현재(c2)보다 오래된 커밋은 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '다운그레이드가 아니다')" = 1 ] && [ "$(has "$out" 'FAIL')" = 1 ] && echo 1 || echo 0)"
  run_deploy prod "$S1"
  ok_if "현재의 후손이 아닌 커밋(다른 갈래)도 거부한다" "$(is "$([ "$rc" != 0 ] && echo 1 || echo 0)" 1)"
  ok_if "거부한 배포는 서비스를 건드리지 않았다" "$(is "$(be_sha)$(fe_sha)" "$C2$C2")"
  out="$(env -u CI SKIP_VERIFY='시험용 긴급 배포' bash infra/deploy/deploy.sh prod "$C6" 2>&1)" && rc=0 || rc=$?
  printf '%s\n' "$out" >>"$OUT_ALL"
  ok_if "SKIP_VERIFY 사유를 주면 CI 밖에서도 배포하고 이력에 사유가 남는다" \
    "$([ "$rc" = 0 ] && [ "$(be_sha)$(fe_sha)" = "$C6$C6" ] && grep -q 'skip-verify:시험용 긴급 배포' "$FIT_STATE_DIR/history-prod.log" && echo 1 || echo 0)"
}

run_dev_checks() {
  echo "--- dev: 단일 색 교체와 직전 이미지 복귀"
  # shellcheck source=/dev/null
  . "$T/shas.env"
  run_deploy dev "$C1"
  ok_if "dev 첫 배포가 성공한다(게이트 쿠키로 접속)" "$([ "$rc" = 0 ] && [ "$(dev_be_sha)$(dev_fe_sha)" = "$C1$C1" ] && echo 1 || echo 0)"
  ok_if "dev 엣지는 쿠키가 없으면 404다(게이트가 살아 있다)" "$(is "$(code_of "$DEVU/api/v1/version")" 404)"
  run_deploy dev "$C2"
  ok_if "dev 교체가 성공하고 직전 태그가 c1로 남는다" \
    "$([ "$rc" = 0 ] && [ "$(dev_be_sha)$(dev_fe_sha)" = "$C2$C2" ] && [ "$(st dev BE_DEV_PREV_TAG)$(st dev FE_DEV_PREV_TAG)" = "$C1$C1" ] && echo 1 || echo 0)"
  run_deploy dev "$C7"
  ok_if "FE가 망가진 배포(c7)는 실패한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'dev 확인에 실패했다')" = 1 ] && echo 1 || echo 0)"
  ok_if "BE는 c7로 갔고 FE는 직전 이미지(c2)로 복귀해 응답한다" "$(is "$(dev_be_sha)$(dev_fe_sha)" "$C7$C2")"
  run_deploy dev "$C8"
  ok_if "검색이 폴백으로 처리되는 BE(c8)는 스모크가 잡아 실패한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'FAIL  BE: 검색이 폴백으로 처리되지 않았다')" = 1 ] && echo 1 || echo 0)"
  ok_if "BE는 직전 이미지(c7)로 복귀했고 FE는 c2다" "$(is "$(dev_be_sha)$(dev_fe_sha)" "$C7$C2")"
  out="$(bash infra/deploy/rollback.sh dev 2>&1)" && rc=0 || rc=$?
  printf '%s\n' "$out" >>"$OUT_ALL"
  ok_if "rollback.sh dev가 직전 이미지로 되돌린다(BE c2, FE c1)" "$([ "$rc" = 0 ] && [ "$(dev_be_sha)$(dev_fe_sha)" = "$C2$C1" ] && echo 1 || echo 0)"
}

run_fit_up_checks() {
  echo "--- fit-up: 전부 멈춘 뒤 순서대로 올린다"
  local ids
  ids="$(docker ps -q --filter label=com.fit.service)"
  # shellcheck disable=SC2086 # 컨테이너 ID를 단어로 나눠 넘긴다
  docker stop -t 5 $ids >/dev/null
  docker stop -t 5 "$(docker ps -q --filter "label=com.docker.compose.project=$FIT_EDGE_PROJECT")" >/dev/null
  out="$(bash infra/deploy/fit-up.sh 2>&1)" && rc=0 || rc=$?
  printf '%s\n' "$out" >>"$OUT_ALL"
  ok_if "fit-up이 끝나고 경고가 없다" "$([ "$rc" = 0 ] && [ "$(has "$out" '모두 올라왔다')" = 1 ] && echo 1 || echo 0)"
  ok_if "엣지가 다시 떴고 prod·dev 서비스가 전과 같은 버전으로 응답한다" \
    "$(is "$(be_sha)$(fe_sha)$(dev_be_sha)$(dev_fe_sha)" "$C6$C6$C2$C1")"
  ok_if "활성이 아닌 prod 색은 올리지 않는다(green은 멈춘 채)" "$(is "$(running be-prod-green)$(running fe-prod-green)" falsefalse)"
  ok_if "data·obs 프로젝트는 아직 없어서 건너뛴다고 알린다" "$([ "$(has "$out" 'data: 건너뜀')$(has "$out" 'obs: 건너뜀')" = 11 ] && echo 1 || echo 0)"
}

run_hygiene_checks() {
  echo "--- 출력과 알림"
  ok_if "스크립트 출력 어디에도 dev 게이트 키가 없다" "$([ "$(grep -c "$KEY" "$OUT_ALL")" = 0 ] && echo 1 || echo 0)"
  ok_if "알림 웹훅 본문에도 dev 게이트 키가 없다" "$([ "$(grep -c "$KEY" "$T/webhook.log")" = 0 ] && echo 1 || echo 0)"
  ok_if "메모리와 CPU 한도가 compose대로 걸려 있다(be-prod 1536m, fe-prod 512m, be-dev 1024m)" \
    "$(is "$(docker inspect -f '{{.HostConfig.Memory}}' be-prod-green)$(docker inspect -f '{{.HostConfig.Memory}}' fe-prod-green)$(docker inspect -f '{{.HostConfig.Memory}}' be-dev)" "$((1536 * 1048576))$((512 * 1048576))$((1024 * 1048576))")"
  ok_if "FE는 읽기 전용 루트 파일시스템이다" "$(is "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' fe-prod-green)" true)"
  ok_if "호스트에 게시한 포트가 없다(앱 컨테이너)" "$([ -z "$(docker ps -q --filter label=com.fit.service | xargs -r -n1 docker port)" ] && echo 1 || echo 0)"
}

run() {
  # shellcheck source=infra/deploy/lib.sh
  . infra/deploy/lib.sh
  # shellcheck source=/dev/null
  . "$T/shas.env"
  OUT_ALL="$T/all-output.log"
  : >"$OUT_ALL"
  : >"$T/webhook.log"
  "$PY" infra/deploy/test/webhook-sink.py 18099 "$T/webhook.log" &
  echo $! >"$T/sink.pid"
  sleep 1
  set +e
  run_unit_checks
  run_guard_checks
  run_prod_checks
  run_dev_checks
  run_fit_up_checks
  run_hygiene_checks
  set -e
  kill "$(cat "$T/sink.pid")" >/dev/null 2>&1 || true
  if [ "$FAILED" -gt 0 ]; then
    printf '\n%d개 점검 실패\n' "$FAILED"
    return 1
  fi
  printf '\n배포 시험 통과\n'
}

case "${1:-}" in
  up) up ;;
  run) run ;;
  down) down ;;
  *)
    echo "사용: bash infra/deploy/test/test-deploy.sh up | run | down" >&2
    exit 2
    ;;
esac
