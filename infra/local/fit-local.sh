#!/usr/bin/env bash
# 로컬 개발 스택(infra/local/compose.yml) 관리.
#   bash infra/local/fit-local.sh up [--search]  # 기동, 헬스 대기, DB·버킷 초기화, 점검
#   bash infra/local/fit-local.sh verify         # 떠 있는 스택 점검
#   bash infra/local/fit-local.sh down           # 중지(데이터 유지)
#   bash infra/local/fit-local.sh reset          # 중지하고 볼륨 삭제(데이터 초기화)
# 설정은 infra/local/.env다(infra/local/local.env.example을 복사한다). FIT_LOCAL_PROJECT로 프로젝트 이름을 바꿔 여러 벌을 띄울 수 있다.
# 필요한 것: docker compose, curl 7.75 이상(garage 점검). bash 3.2(macOS)에서도 돈다.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
ENV_FILE="${FIT_LOCAL_ENV:-infra/local/.env}"
PROJECT="${FIT_LOCAL_PROJECT:-fit-local}"
if [ ! -f "$ENV_FILE" ]; then
  echo "$ENV_FILE 이 없다. cp infra/local/local.env.example $ENV_FILE 로 만든다" >&2
  exit 2
fi
case "$(uname -s)" in
  MINGW* | MSYS*) export MSYS_NO_PATHCONV=1 ;;
esac

dc() { docker compose -p "$PROJECT" -f infra/local/compose.yml --env-file "$ENV_FILE" "$@"; }

# env 파일은 KEY=VALUE만 허용하는 보수적 형식(check_env_files.py)이라 셸에서 그대로 읽어도 안전하다.
set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

psql_admin() { dc exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

# 멱등이다. role 비밀번호는 매번 env 값으로 맞춘다. 서버의 ensure-databases.sh(계획 1D)와 같은 role 구조를 쓴다.
ensure_databases() {
  psql_admin -d postgres <<SQL
SELECT 'CREATE ROLE fit_migrator LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fit_migrator') \gexec
SELECT 'CREATE ROLE fit_dev_app LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fit_dev_app') \gexec
ALTER ROLE fit_migrator PASSWORD '${FIT_MIGRATOR_PASSWORD}';
ALTER ROLE fit_dev_app PASSWORD '${FIT_DEV_APP_PASSWORD}';
ALTER ROLE fit_dev_app SET statement_timeout = '30s';
SELECT 'CREATE DATABASE fit_dev OWNER fit_migrator' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'fit_dev') \gexec
SQL
  psql_admin -d fit_dev <<SQL
SET client_min_messages = warning;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
REVOKE ALL ON DATABASE fit_dev FROM PUBLIC;
GRANT CONNECT ON DATABASE fit_dev TO fit_dev_app;
GRANT USAGE ON SCHEMA public TO fit_dev_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fit_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fit_dev_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fit_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO fit_dev_app;
SQL
}

# RUST_LOG=warn: garage CLI가 매 호출마다 내는 INFO 로그를 줄인다.
garage() { dc exec -T -e RUST_LOG=warn garage /garage -c /etc/garage/garage.toml "$@"; }

# 멱등이다. 단일 노드라도 레이아웃을 한 번 적용해야 버킷을 만들 수 있다.
init_garage() {
  local node
  if garage status 2>/dev/null | grep -q "NO ROLE ASSIGNED"; then
    node="$(garage status 2>/dev/null | awk '/^[0-9a-f]{16}/ {print $1; exit}')"
    garage layout assign -z dc1 -c 1G "$node" >/dev/null
    garage layout apply --version 1 >/dev/null
  fi
  garage bucket info "$S3_BUCKET" >/dev/null 2>&1 || garage bucket create "$S3_BUCKET" >/dev/null
  garage key info "$S3_ACCESS_KEY" >/dev/null 2>&1 || garage key import --yes -n fit-local "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null
  garage bucket allow --read --write --owner "$S3_BUCKET" --key "$S3_ACCESS_KEY" >/dev/null
  garage bucket website --allow "$S3_BUCKET" >/dev/null
}

FAILED=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
skip() { printf 'SKIP  %s\n' "$1"; }
check() { # check NAME CMD ARGS... : 명령이 성공하면 통과
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then pass "$name"; else fail "$name"; fi
}

# 같은 컨테이너 안에서도 호스트 이름(postgres)으로 접속하면 pg_hba가 비밀번호를 요구한다(localhost는 trust).
pg_as() { # pg_as ROLE PASSWORD SQL
  dc exec -T -e "PGPASSWORD=$2" postgres psql -h postgres -U "$1" -d fit_dev -v ON_ERROR_STOP=1 -qAt -c "$3"
}

verify_postgres() {
  check "postgres: fit_migrator가 비밀번호로 접속" pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" "select 1"
  check "postgres: fit_dev_app이 비밀번호로 접속" pg_as fit_dev_app "$FIT_DEV_APP_PASSWORD" "select 1"
  check "postgres: pgvector 확장" pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" "select 1 from pg_extension where extname = 'vector'"
  check "postgres: fit_migrator가 DDL 가능" pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" "drop table if exists _verify_probe; create table _verify_probe (id int)"
  check "postgres: fit_dev_app이 migrator의 새 테이블에 DML 가능" pg_as fit_dev_app "$FIT_DEV_APP_PASSWORD" "insert into _verify_probe values (1); select id from _verify_probe; delete from _verify_probe"
  if pg_as fit_dev_app "$FIT_DEV_APP_PASSWORD" "create table _verify_denied (id int)" >/dev/null 2>&1; then
    fail "postgres: fit_dev_app의 DDL은 거부돼야 한다"
    pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" "drop table if exists _verify_denied" >/dev/null 2>&1 || true
  else
    pass "postgres: fit_dev_app의 DDL 거부"
  fi
  pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" "drop table if exists _verify_probe" >/dev/null 2>&1 || true
}

verify_redis() {
  local out
  out="$(dc exec -T redis redis-cli ping 2>&1 || true)"
  if [ "$out" = "PONG" ]; then pass "redis: 비밀번호로 접속"; else fail "redis: 비밀번호로 접속"; fi
  out="$(dc exec -T -e REDISCLI_AUTH= redis redis-cli ping 2>&1 || true)"
  case "$out" in
    *NOAUTH*) pass "redis: 비밀번호 없이는 거부" ;;
    *) fail "redis: 비밀번호 없이는 거부" ;;
  esac
  out="$(dc exec -T redis redis-cli config get maxmemory-policy 2>&1 | tail -n 1 || true)"
  if [ "$out" = "noeviction" ]; then pass "redis: maxmemory-policy noeviction"; else fail "redis: maxmemory-policy noeviction"; fi
}

# 상태 코드는 -w로 마지막 줄에 받는다(curl의 `-o /dev/null`은 Git Bash의 Windows용 curl에서 쓰기 오류가 난다).
STATUS_FMT='\n%{http_code}'
http_code() { curl -sS "$@" -w "$STATUS_FMT" | tail -n 1; }
s3_code() { curl -sS --aws-sigv4 "aws:amz:garage:s3" --user "$S3_ACCESS_KEY:$S3_SECRET_KEY" "$@" -w "$STATUS_FMT" | tail -n 1; }

verify_garage() {
  local base="http://127.0.0.1:${FIT_LOCAL_S3_PORT}/${S3_BUCKET}/confirmed/_verify.txt" code body
  if ! curl --help all 2>/dev/null | grep -q -- --aws-sigv4; then
    skip "garage: curl이 --aws-sigv4를 지원하지 않아 건너뜀(curl 7.75 이상 필요)"
    return
  fi
  code="$(printf 'fit-local-ok' | s3_code -X PUT --data-binary @- "$base" || true)"
  if [ "$code" = "200" ]; then pass "garage: 서명한 S3 PUT"; else fail "garage: 서명한 S3 PUT (HTTP $code)"; fi
  code="$(http_code "$base" || true)"
  if [ "$code" = "403" ]; then pass "garage: 익명 S3 GET 거부"; else fail "garage: 익명 S3 GET 거부 (HTTP $code)"; fi
  body="$(curl -sS -H "Host: ${S3_BUCKET}.web.garage.localhost" "http://127.0.0.1:${FIT_LOCAL_S3_WEB_PORT}/confirmed/_verify.txt" || true)"
  if [ "$body" = "fit-local-ok" ]; then pass "garage: 웹 엔드포인트 공개 읽기"; else fail "garage: 웹 엔드포인트 공개 읽기"; fi
  code="$(s3_code -X DELETE "$base" || true)"
  if [ "$code" = "204" ]; then pass "garage: 서명한 S3 DELETE"; else fail "garage: 서명한 S3 DELETE (HTTP $code)"; fi
}

# 컨테이너 안의 curl로 호출한다. Windows용 curl은 인자의 한글을 ANSI 코드페이지로 보내 JSON이 깨진다.
os() { dc exec -T opensearch curl -fsS "$@"; }

verify_opensearch() {
  local out
  out="$(os 'http://localhost:9200/_cat/plugins?h=component' 2>&1 || true)"
  case "$out" in *analysis-nori*) pass "opensearch: analysis-nori 설치" ;; *) fail "opensearch: analysis-nori 설치" ;; esac
  case "$out" in *opensearch-knn*) pass "opensearch: k-NN 플러그인" ;; *) fail "opensearch: k-NN 플러그인" ;; esac
  out="$(os -H 'Content-Type: application/json' -d '{"analyzer":"nori","text":"맛집 추천"}' http://localhost:9200/_analyze 2>&1 || true)"
  case "$out" in *'"token"'*) pass "opensearch: nori 분석기 동작" ;; *) fail "opensearch: nori 분석기 동작" ;; esac
}

verify() {
  local running
  running="$(dc --profile '*' ps --services --status running 2>/dev/null || true)"
  FAILED=0
  case "$running" in *postgres*) verify_postgres ;; *) skip "postgres (실행 중 아님)" ;; esac
  case "$running" in *redis*) verify_redis ;; *) skip "redis (실행 중 아님)" ;; esac
  case "$running" in *garage*) verify_garage ;; *) skip "garage (실행 중 아님)" ;; esac
  case "$running" in *opensearch*) verify_opensearch ;; *) skip "opensearch (search 프로필 아님)" ;; esac
  if [ "$FAILED" -gt 0 ]; then
    printf '\n%d개 점검 실패\n' "$FAILED"
    return 1
  fi
  printf '\n로컬 스택 정상\n'
}

up() {
  local profiles=(--profile core)
  if [ "${1:-}" = "--search" ]; then profiles+=(--profile search); fi
  dc "${profiles[@]}" up -d --build --wait
  ensure_databases
  init_garage
  verify
}

case "${1:-}" in
  up) shift; up "$@" ;;
  verify) verify ;;
  down) dc --profile '*' down ;;
  reset) dc --profile '*' down -v ;;
  *)
    echo "사용: bash infra/local/fit-local.sh up [--search] | verify | down | reset" >&2
    exit 2
    ;;
esac
