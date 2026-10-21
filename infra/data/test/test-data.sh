#!/usr/bin/env bash
# 데이터 스택을 노트북에서 시험한다(설계 10.5절). 실제 Postgres(pgvector), Redis 2개, Garage를 띄우고 초기화 스크립트를 돌린다.
#   bash infra/data/test/test-data.sh up     # 가짜 서버 디렉터리, 공유 망, 데이터 스택을 만든다
#   bash infra/data/test/test-data.sh run    # 초기화·멱등·권한·입력 검증·재시작 시나리오를 돌린다
#   bash infra/data/test/test-data.sh down   # 시험이 만든 컨테이너, 볼륨, 망, 디렉터리를 지운다
# 필요한 것: docker compose(2.24 이상). 시험용 이름은 접두사 fit-datatest로 시작한다.
# OpenSearch는 이미지를 빌드하고 메모리를 많이 쓰므로 기본으로는 띄우지 않는다. FIT_TEST_OPENSEARCH=1이면 함께 띄우고 nori까지 점검한다.
# 시험용 서버는 저장소 안의 .tmp-datatest/에 있다(data.env). 값은 매번 무작위로 만든다.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
case "$(uname -s)" in
  MINGW* | MSYS*) export MSYS_NO_PATHCONV=1 ;;
esac
W="$(pwd -W 2>/dev/null || pwd)"
T="$W/.tmp-datatest"
PREFIX=fit-datatest-
PROJECT=fit-datatest

export FIT_ENV_DIR="$T/etc" FIT_DATA_ENV="$T/etc/data.env" FIT_DATA_PROJECT="$PROJECT"
export FIT_NET_PREFIX="$PREFIX" FIT_NET_DATA="${PREFIX}net-data" FIT_NET_EDGE="${PREFIX}net-edge" FIT_NET_DBACCESS="${PREFIX}net-dbaccess"
export FIT_DATATEST_PG_PORT="${FIT_DATATEST_PG_PORT:-55432}"

dc() { docker compose -p "$PROJECT" -f "$W/infra/data/compose.data.yml" -f "$W/infra/data/test/compose.test.yml" --env-file "$T/etc/data.env" "$@"; }
hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

make_env() {
  mkdir -p "$T/etc"
  {
    echo "POSTGRES_PASSWORD=$(hex 12)"
    echo "FIT_MIGRATOR_PASSWORD=$(hex 12)"
    echo "FIT_PROD_APP_PASSWORD=$(hex 12)"
    echo "FIT_DEV_APP_PASSWORD=$(hex 12)"
    echo "REDIS_PROD_PASSWORD=$(hex 12)"
    echo "REDIS_DEV_PASSWORD=$(hex 12)"
    echo "GARAGE_RPC_SECRET=$(hex 32)"
    echo "GARAGE_ADMIN_TOKEN=$(hex 16)"
    echo "S3_PROD_ACCESS_KEY=GK$(hex 12)"
    echo "S3_PROD_SECRET_KEY=$(hex 32)"
    echo "S3_DEV_ACCESS_KEY=GK$(hex 12)"
    echo "S3_DEV_SECRET_KEY=$(hex 32)"
  } >"$T/etc/data.env"
}

up() {
  down >/dev/null 2>&1 || true
  mkdir -p "$T"
  make_env
  bash infra/host/networks.sh
  local -a services=(postgres redis-prod redis-dev garage)
  if [ "${FIT_TEST_OPENSEARCH:-0}" = 1 ]; then services+=(opensearch); fi
  dc up -d --build --wait --wait-timeout 300 "${services[@]}"
  echo "데이터 시험 환경이 떴다(프로젝트 $PROJECT)"
}

down() {
  docker compose -p "$PROJECT" down -v --remove-orphans >/dev/null 2>&1 || true
  local n
  for n in net-edge net-prod net-dev net-data net-obs net-dbaccess; do docker network rm "$PREFIX$n" >/dev/null 2>&1 || true; done
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
succeeds() { if "$@" >/dev/null 2>&1; then echo 1; else echo 0; fi; }
fails() { if "$@" >/dev/null 2>&1; then echo 0; else echo 1; fi; }
OUT_ALL=""
rc=0
out=""

# 시험이 쓰는 함수(psql_admin, pg_as, s3run, svc_container 등)는 스크립트와 같은 lib.sh에서 온다
# shellcheck source=infra/data/lib.sh
. infra/data/lib.sh

run_script() { # run_script 스크립트 [환경 파일]: out, rc를 채운다. 모든 출력을 OUT_ALL에 모은다
  out="$(FIT_DATA_ENV="${2:-$T/etc/data.env}" bash "infra/data/$1" 2>&1)" && rc=0 || rc=$?
  printf '%s\n' "$out" >>"$OUT_ALL"
}
mod_env() { # mod_env 이름 sed식 → 이름.env 파일 경로를 돌려준다
  sed -e "$2" "$T/etc/data.env" >"$T/etc/$1.env"
  printf '%s' "$T/etc/$1.env"
}
val() { sed -n "s/^$1=//p" "$T/etc/data.env"; }
rcli() { # rcli prod|dev 인자...
  local pw
  if [ "$1" = prod ]; then pw="$REDIS_PROD_PASSWORD"; else pw="$REDIS_DEV_PASSWORD"; fi
  docker exec -e "REDISCLI_AUTH=$pw" "$(svc_container "redis-$1")" redis-cli "${@:2}"
}
prod_s3() { s3run "$S3_PROD_ACCESS_KEY" "$S3_PROD_SECRET_KEY" "$@" 2>&1; }
dev_s3() { s3run "$S3_DEV_ACCESS_KEY" "$S3_DEV_SECRET_KEY" "$@" 2>&1; }
first_line() { head -n 1 <<<"$1"; }
restart_svc() { # restart_svc 서비스: 컨테이너를 재시작하고 healthy를 기다린다
  docker restart "$(svc_container "$1")" >/dev/null
  wait_healthy "$1" 90
}

run_init_checks() {
  echo "--- 초기화"
  run_script init-data.sh
  ok_if "init-data.sh가 성공한다" "$(is "$rc" 0)"
  ok_if "첫 실행은 Garage 레이아웃을 적용한다" "$(has "$out" '레이아웃을 적용했다')"
  local skip_os=1
  if [ "${FIT_TEST_OPENSEARCH:-0}" = 1 ]; then skip_os=0; fi
  out="$(FIT_VERIFY_SKIP_OPENSEARCH=$skip_os bash infra/data/verify-data.sh 2>&1)" && rc=0 || rc=$?
  printf '%s\n' "$out" >>"$OUT_ALL"
  ok_if "verify-data.sh가 모두 통과한다" "$(is "$rc" 0)"
  if [ "$rc" != 0 ]; then out="$(grep '^FAIL' <<<"$out" || true)"; fi
  ok_if "net-data는 internal 망이다" "$(is "$(docker network inspect -f '{{.Internal}}' "${PREFIX}net-data")" true)"
}

run_idempotent_checks() {
  echo "--- 멱등"
  prod_s3 put fit-prod-photos keep.txt keep-me >/dev/null
  pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_prod 'CREATE TABLE keep_rows (id int)' >/dev/null
  pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_prod 'INSERT INTO keep_rows VALUES (7)' >/dev/null
  run_script init-data.sh
  ok_if "다시 실행해도 성공한다" "$(is "$rc" 0)"
  ok_if "두 번째 실행은 Garage 레이아웃을 다시 적용하지 않는다" "$(is "$(has "$out" '레이아웃을 적용했다')" 0)"
  ok_if "role은 3개뿐이다" "$(is "$(psql_admin -d postgres -c "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'fit\\_%'")" 3)"
  ok_if "DB는 2개뿐이다" "$(is "$(psql_admin -d postgres -c "SELECT count(*) FROM pg_database WHERE datname LIKE 'fit\\_%'")" 2)"
  ok_if "재실행이 기존 데이터를 건드리지 않는다(Postgres)" "$(is "$(pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_prod 'SELECT id FROM keep_rows')" 7)"
  out="$(prod_s3 get fit-prod-photos keep.txt)"
  ok_if "재실행이 기존 객체를 건드리지 않는다(Garage)" "$(has "$out" keep-me)"
  pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_prod 'DROP TABLE keep_rows' >/dev/null
  prod_s3 delete fit-prod-photos keep.txt >/dev/null
}

run_rotation_checks() {
  echo "--- 비밀번호 교체"
  local newpw rotated
  newpw="$(hex 12)rotated"
  rotated="$(mod_env rotated "s/^FIT_PROD_APP_PASSWORD=.*/FIT_PROD_APP_PASSWORD=$newpw/")"
  run_script ensure-databases.sh "$rotated"
  ok_if "data.env의 새 비밀번호로 ensure-databases.sh가 성공한다" "$(is "$rc" 0)"
  ok_if "옛 비밀번호는 더 이상 통하지 않는다" "$(fails pg_as fit_prod_app "$FIT_PROD_APP_PASSWORD" fit_prod 'SELECT 1')"
  ok_if "새 비밀번호로 접속한다" "$(succeeds pg_as fit_prod_app "$newpw" fit_prod 'SELECT 1')"
  run_script ensure-databases.sh
  ok_if "원래 값으로 되돌릴 수 있다" "$(succeeds pg_as fit_prod_app "$FIT_PROD_APP_PASSWORD" fit_prod 'SELECT 1')"
}

run_privilege_checks() {
  echo "--- 권한"
  local m="$FIT_MIGRATOR_PASSWORD" p="$FIT_PROD_APP_PASSWORD" d="$FIT_DEV_APP_PASSWORD"
  pg_as fit_migrator "$m" fit_prod 'CREATE TABLE t_flow (id serial PRIMARY KEY, name text)' >/dev/null
  ok_if "마이그레이터가 만든 테이블에 prod 앱 role이 INSERT한다(시퀀스 포함)" "$(succeeds pg_as fit_prod_app "$p" fit_prod "INSERT INTO t_flow (name) VALUES ('a')")"
  ok_if "prod 앱 role이 SELECT·UPDATE·DELETE한다" \
    "$(succeeds pg_as fit_prod_app "$p" fit_prod "UPDATE t_flow SET name = 'b'; SELECT * FROM t_flow; DELETE FROM t_flow")"
  ok_if "앱 role은 테이블을 지우지 못한다" "$(fails pg_as fit_prod_app "$p" fit_prod 'DROP TABLE t_flow')"
  ok_if "앱 role은 컬럼을 바꾸지 못한다" "$(fails pg_as fit_prod_app "$p" fit_prod 'ALTER TABLE t_flow ADD COLUMN x int')"
  ok_if "앱 role은 TRUNCATE하지 못한다" "$(fails pg_as fit_prod_app "$p" fit_prod 'TRUNCATE t_flow')"
  ok_if "dev 앱 role은 prod DB에 접속하지 못한다" "$(fails pg_as fit_dev_app "$d" fit_prod 'SELECT 1')"
  ok_if "prod 앱 role은 dev DB에 접속하지 못한다" "$(fails pg_as fit_prod_app "$p" fit_dev 'SELECT 1')"
  psql_admin -d fit_prod -c 'CREATE TABLE t_super (id int)' >/dev/null
  ok_if "슈퍼유저가 만든 테이블은 재실행 전까지 앱 role이 못 읽는다" "$(fails pg_as fit_prod_app "$p" fit_prod 'SELECT * FROM t_super')"
  run_script ensure-databases.sh
  ok_if "ensure-databases.sh 재실행이 기존 테이블에도 권한을 준다" "$(succeeds pg_as fit_prod_app "$p" fit_prod 'SELECT * FROM t_super')"
  psql_admin -d fit_prod -c 'DROP TABLE t_super; DROP TABLE t_flow' >/dev/null
}

run_input_checks() {
  echo "--- 입력 검증"
  local f secret
  f="$(mod_env badkey 's/^S3_PROD_ACCESS_KEY=.*/S3_PROD_ACCESS_KEY=short/')"
  run_script init-garage.sh "$f"
  ok_if "형식이 틀린 S3 키 ID는 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'GK')" = 1 ] && echo 1 || echo 0)"
  f="$(mod_env badsecret 's/^S3_DEV_SECRET_KEY=.*/S3_DEV_SECRET_KEY=nothex/')"
  run_script init-garage.sh "$f"
  ok_if "형식이 틀린 S3 비밀 키는 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '64자리')" = 1 ] && echo 1 || echo 0)"
  f="$(mod_env placeholder 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=REPLACE_ME/')"
  run_script ensure-databases.sh "$f"
  ok_if "자리표시자(REPLACE_ME)가 남아 있으면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'REPLACE_ME')" = 1 ] && echo 1 || echo 0)"
  f="$(mod_env missing '/^REDIS_DEV_PASSWORD=/d')"
  run_script ensure-databases.sh "$f"
  ok_if "필수 키가 없으면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'REDIS_DEV_PASSWORD')" = 1 ] && echo 1 || echo 0)"
  f="$(mod_env sqlinject "s/^FIT_DEV_APP_PASSWORD=.*/FIT_DEV_APP_PASSWORD=aaaaaaaaaaaaaaaa'; CREATE ROLE fit_injected; --/")"
  run_script ensure-databases.sh "$f"
  ok_if "따옴표가 든 비밀번호는 거부한다" "$(is "$([ "$rc" != 0 ] && echo 1 || echo 0)" 1)"
  ok_if "거부된 값이 SQL로 실행되지 않는다" "$(is "$(psql_admin -d postgres -c "SELECT count(*) FROM pg_roles WHERE rolname = 'fit_injected'")" 0)"
  f="$(mod_env shellsyntax "s|^FIT_DEV_APP_PASSWORD=.*|FIT_DEV_APP_PASSWORD=\$(touch $T/pwned)aaaaaaaaaaaaaaaa|")"
  run_script ensure-databases.sh "$f"
  ok_if "비밀번호 값 안의 셸 문법은 거부한다" "$(is "$([ "$rc" != 0 ] && echo 1 || echo 0)" 1)"
  ok_if "값 안의 셸 문법이 실행되지 않는다" "$([ ! -e "$T/pwned" ] && echo 1 || echo 0)"
  f="$(mod_env short 's/^FIT_DEV_APP_PASSWORD=.*/FIT_DEV_APP_PASSWORD=tooshort/')"
  run_script ensure-databases.sh "$f"
  ok_if "16자 미만 비밀번호는 거부한다" "$(is "$([ "$rc" != 0 ] && echo 1 || echo 0)" 1)"
  run_script ensure-databases.sh "$T/etc/none.env"
  ok_if "env 파일이 없으면 거부한다" "$(is "$([ "$rc" != 0 ] && echo 1 || echo 0)" 1)"
  for secret in POSTGRES_PASSWORD FIT_DEV_APP_PASSWORD S3_PROD_SECRET_KEY; do
    ok_if "거부 메시지에 $secret 값이 찍히지 않는다" "$(is "$(has "$OUT_ALL" "$(val "$secret")")" 0)"
  done
}

run_redis_checks() {
  echo "--- Redis"
  rcli prod set keep-me 1 >/dev/null
  rcli prod config set maxmemory 2mb >/dev/null
  rcli prod eval "for i=1,6 do redis.call('set','fill'..i,string.rep('x',1024*1024)) end" 0 >/dev/null 2>&1 || true
  out="$(rcli prod set another x 2>&1 || true)"
  ok_if "maxmemory를 넘으면 쫓아내지 않고 쓰기를 거절한다(noeviction)" "$(has "$out" OOM)"
  ok_if "넘친 뒤에도 기존 키가 남아 있다" "$(is "$(rcli prod get keep-me)" 1)"
  rcli prod eval "for i=1,6 do redis.call('del','fill'..i) end" 0 >/dev/null 2>&1 || true
  rcli prod config set maxmemory 96mb >/dev/null
  rcli prod set persist-me yes >/dev/null
  rcli dev set dev-only 1 >/dev/null
  ok_if "prod와 dev Redis는 데이터가 따로다" "$(is "$(rcli prod get dev-only)" '')"
  sleep 2
  restart_svc redis-prod
  ok_if "재시작해도 AOF로 데이터가 돌아온다" "$(is "$(rcli prod get persist-me)" yes)"
  rcli prod del keep-me persist-me >/dev/null
  rcli dev del dev-only >/dev/null
}

run_postgres_checks() {
  echo "--- Postgres"
  ok_if "shared_buffers가 256MB다" "$(is "$(psql_admin -d postgres -c 'SHOW shared_buffers')" 256MB)"
  ok_if "max_connections가 60이다" "$(is "$(psql_admin -d postgres -c 'SHOW max_connections')" 60)"
  ok_if "idle_in_transaction_session_timeout이 1분이다" "$(is "$(psql_admin -d postgres -c 'SHOW idle_in_transaction_session_timeout')" 1min)"
  ok_if "pgvector가 동작한다" "$(is "$(pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_dev "SELECT '[1,2,3]'::vector <-> '[1,2,4]'::vector")" 1)"
  local k bad=0
  for k in FIT_MIGRATOR_PASSWORD FIT_PROD_APP_PASSWORD FIT_DEV_APP_PASSWORD; do
    if docker logs "$(svc_container postgres)" 2>&1 | grep -qF "$(val "$k")"; then bad=1; fi
  done
  ok_if "role 비밀번호가 Postgres 로그에 남지 않는다" "$(is "$bad" 0)"
  ok_if "role 비밀번호가 pg_stat_statements에 남지 않는다" \
    "$(is "$(psql_admin -d fit_prod -c "SELECT count(*) FROM pg_stat_statements WHERE query ILIKE '%alter role%' OR query ILIKE '%create role%'")" 0)"
  pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_prod 'CREATE TABLE persist_rows (id int)' >/dev/null
  pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_prod 'INSERT INTO persist_rows VALUES (42)' >/dev/null
  restart_svc postgres
  ok_if "재시작해도 데이터가 남는다" "$(is "$(pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_prod 'SELECT id FROM persist_rows')" 42)"
  pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_prod 'DROP TABLE persist_rows' >/dev/null
  run_script init-data.sh
  ok_if "재시작 뒤 init-data.sh가 그대로 성공한다" "$(is "$rc" 0)"
}

run_garage_checks() {
  echo "--- Garage"
  prod_s3 put fit-prod-photos shared.txt prod-secret >/dev/null
  out="$(dev_s3 get fit-prod-photos shared.txt)"
  ok_if "dev 키는 prod 버킷의 객체를 읽지 못한다" "$(is "$(first_line "$out")" 'HTTP 403')"
  dev_s3 put fit-dev-photos mine.txt dev-data >/dev/null
  out="$(prod_s3 get fit-dev-photos mine.txt)"
  ok_if "prod 키는 dev 버킷의 객체를 읽지 못한다" "$(is "$(first_line "$out")" 'HTTP 403')"
  out="$(dev_s3 lifecycle-get fit-dev-photos)"
  ok_if "dev 버킷에도 수명주기가 걸려 있다" "$(has "$out" 'pending/')"
  restart_svc garage
  out="$(prod_s3 get fit-prod-photos shared.txt)"
  ok_if "재시작해도 객체가 남는다" "$(has "$out" prod-secret)"
  run_script init-garage.sh
  ok_if "재시작 뒤 init-garage.sh가 그대로 성공하고 레이아웃을 다시 적용하지 않는다" "$([ "$rc" = 0 ] && [ "$(has "$out" '레이아웃을 적용했다')" = 0 ] && echo 1 || echo 0)"
  tarlist="$(s3run "$S3_PROD_ACCESS_KEY" "$S3_PROD_SECRET_KEY" tar-stdout fit-prod-photos '' 2>/dev/null | tar -t 2>/dev/null || true)"
  ok_if "tar-stdout이 버킷의 객체를 tar로 낸다" "$(has "$tarlist" shared.txt)"
  prod_s3 delete fit-prod-photos shared.txt >/dev/null
  dev_s3 delete fit-dev-photos mine.txt >/dev/null
}

run_port_checks() {
  echo "--- 포트"
  local svc published
  for svc in redis-prod redis-dev garage; do
    published="$(docker port "$(svc_container "$svc")" 2>/dev/null | tr -d '\r\n' || true)"
    ok_if "$svc는 호스트에 포트를 게시하지 않는다" "$(is "$published" '')"
  done
  published="$(docker port "$(svc_container postgres)" 2>/dev/null | tr -d '\r' || true)"
  ok_if "postgres는 127.0.0.1에만 게시한다" "$([ "$(has "$published" '127.0.0.1:')" = 1 ] && [ "$(has "$published" '0.0.0.0')" = 0 ] && echo 1 || echo 0)"
}

run_hygiene_checks() {
  echo "--- 비밀 값 노출"
  local k bad=0
  for k in POSTGRES_PASSWORD FIT_MIGRATOR_PASSWORD FIT_PROD_APP_PASSWORD FIT_DEV_APP_PASSWORD REDIS_PROD_PASSWORD REDIS_DEV_PASSWORD GARAGE_RPC_SECRET GARAGE_ADMIN_TOKEN S3_PROD_SECRET_KEY S3_DEV_SECRET_KEY; do
    if [ "$(has "$(cat "$OUT_ALL")" "$(val "$k")")" = 1 ]; then
      bad=1
      echo "FAIL  $k 값이 스크립트 출력에 찍혔다"
    fi
  done
  ok_if "스크립트 출력에 비밀 값이 없다" "$(is "$bad" 0)"
}

run() { # run [구역...]: 구역을 주지 않으면 전부 돌린다. 구역은 앞의 점검 함수 이름에서 run_ 과 _checks를 뗀 것이다
  OUT_ALL="$T/output.log"
  : >"$OUT_ALL"
  load_data_env
  local section
  local -a sections=("$@")
  if [ "${#sections[@]}" = 0 ]; then sections=(init idempotent rotation privilege input redis postgres garage port hygiene); fi
  set +e
  for section in "${sections[@]}"; do "run_${section}_checks"; done
  set -e
  if [ "$FAILED" -gt 0 ]; then
    printf '\n%d개 점검 실패\n' "$FAILED"
    return 1
  fi
  printf '\n데이터 스택 시험 통과\n'
}

case "${1:-}" in
  up) up ;;
  run) shift && run "$@" ;;
  down) down ;;
  *)
    echo "사용: bash infra/data/test/test-data.sh up | run | down" >&2
    exit 2
    ;;
esac
