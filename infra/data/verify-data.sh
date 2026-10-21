#!/usr/bin/env bash
# 데이터 스택이 설계대로 떠 있는지 점검한다(설계 7절). 값을 바꾸지 않는다(사진 점검용 객체 하나를 올리고 바로 지운다).
#   bash infra/data/verify-data.sh
# 점검마다 PASS 또는 FAIL만 출력하고 비밀 값은 찍지 않는다. 하나라도 FAIL이면 종료 코드 1이다.
# 시험에서 OpenSearch를 띄우지 않을 때는 FIT_VERIFY_SKIP_OPENSEARCH=1로 그 점검을 건너뛴다.
set -uo pipefail
# shellcheck source=infra/data/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_data_env

FAILED=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
ok_if() { if [ "$2" = 1 ]; then pass "$1"; else fail "$1"; fi; }
succeeds() { if "$@" >/dev/null 2>&1; then echo 1; else echo 0; fi; }
fails() { if "$@" >/dev/null 2>&1; then echo 0; else echo 1; fi; }

health() { # health 서비스 → healthy 여부(0/1)
  local c
  c="$(svc_container "$1")"
  if [ -n "$c" ] && [ "$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null)" = healthy ]; then echo 1; else echo 0; fi
}

for svc in postgres opensearch redis-prod redis-dev garage; do
  if [ "$svc" = opensearch ] && [ "${FIT_VERIFY_SKIP_OPENSEARCH:-0}" = 1 ]; then continue; fi
  ok_if "$svc가 healthy다" "$(health "$svc")"
done

# --- Postgres: 환경별 DB와 role, 접속 범위 ---
ok_if "DB fit_prod와 fit_dev가 있다" "$([ "$(psql_admin -d postgres -c "SELECT count(*) FROM pg_database WHERE datname IN ('fit_prod','fit_dev')" 2>/dev/null)" = 2 ] && echo 1 || echo 0)"
for env in prod dev; do
  pw_var="FIT_$(printf '%s' "$env" | tr '[:lower:]' '[:upper:]')_APP_PASSWORD"
  other=dev
  if [ "$env" = dev ]; then other=prod; fi
  ok_if "fit_${env}_app이 fit_$env에 접속한다" "$(succeeds pg_as "fit_${env}_app" "${!pw_var}" "fit_$env" 'SELECT 1')"
  ok_if "fit_${env}_app은 fit_$other에 접속하지 못한다" "$(fails pg_as "fit_${env}_app" "${!pw_var}" "fit_$other" 'SELECT 1')"
  ok_if "fit_$env에 vector와 pg_stat_statements가 있다" \
    "$([ "$(psql_admin -d "fit_$env" -c "SELECT count(*) FROM pg_extension WHERE extname IN ('vector','pg_stat_statements')" 2>/dev/null)" = 2 ] && echo 1 || echo 0)"
  ok_if "fit_${env}_app은 테이블을 만들지 못한다(DDL은 fit_migrator만)" "$(fails pg_as "fit_${env}_app" "${!pw_var}" "fit_$env" 'CREATE TABLE verify_denied (id int)')"
done
ok_if "fit_migrator가 fit_prod에서 테이블을 만들 수 있다" "$(succeeds pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_prod 'CREATE TEMP TABLE verify_ddl (id int)')"
ok_if "dev 앱 role에 쿼리 시간 제한 30초가 걸려 있다" "$(succeeds pg_as fit_dev_app "$FIT_DEV_APP_PASSWORD" fit_dev "SELECT 1 WHERE current_setting('statement_timeout') = '30s'")"
pg_super() { docker exec -e "PGPASSWORD=$1" "$(svc_container postgres)" psql -h postgres -U postgres -d postgres -c 'SELECT 1'; }
ok_if "슈퍼유저 postgres는 네트워크로 접속할 때 비밀번호를 쓴다" "$(succeeds pg_super "$POSTGRES_PASSWORD")"
ok_if "틀린 비밀번호는 거부한다" "$(fails pg_super "wrong-$POSTGRES_PASSWORD")"

# --- Redis: 인증과 메모리 정책 ---
for env in prod dev; do
  pw_var="REDIS_$(printf '%s' "$env" | tr '[:lower:]' '[:upper:]')_PASSWORD"
  c="$(svc_container "redis-$env")"
  ok_if "redis-$env는 인증 없이는 명령을 받지 않는다" "$([ "$(docker exec "$c" env -u REDISCLI_AUTH redis-cli ping 2>&1 | grep -c NOAUTH)" = 1 ] && echo 1 || echo 0)"
  ok_if "redis-$env는 비밀번호로 PONG을 돌려준다" "$([ "$(docker exec -e "REDISCLI_AUTH=${!pw_var}" "$c" redis-cli ping 2>/dev/null)" = PONG ] && echo 1 || echo 0)"
  ok_if "redis-$env의 maxmemory-policy가 noeviction이다" \
    "$([ "$(docker exec -e "REDISCLI_AUTH=${!pw_var}" "$c" redis-cli config get maxmemory-policy 2>/dev/null | tail -n 1)" = noeviction ] && echo 1 || echo 0)"
  ok_if "redis-$env의 AOF가 켜져 있다" \
    "$([ "$(docker exec -e "REDISCLI_AUTH=${!pw_var}" "$c" redis-cli config get appendonly 2>/dev/null | tail -n 1)" = yes ] && echo 1 || echo 0)"
done
ok_if "dev 비밀번호로는 prod Redis에 들어가지 못한다" \
  "$(succeeds grep -q -E 'WRONGPASS|NOAUTH' <<<"$(docker exec -e "REDISCLI_AUTH=$REDIS_DEV_PASSWORD" "$(svc_container redis-prod)" redis-cli ping 2>&1)")"

# --- Garage: 버킷 분리, 공개 읽기, 수명주기 ---
if [ "$(health garage)" = 1 ]; then
  probe="verify-$$.txt"
  prod() { s3run "$S3_PROD_ACCESS_KEY" "$S3_PROD_SECRET_KEY" "$@" 2>&1; }
  dev() { s3run "$S3_DEV_ACCESS_KEY" "$S3_DEV_SECRET_KEY" "$@" 2>&1; }
  first_line() { head -n 1 <<<"$1"; }
  out="$(prod put fit-prod-photos "$probe" hello-prod)"
  ok_if "prod 키로 fit-prod-photos에 올릴 수 있다" "$([ "$(first_line "$out")" = 'HTTP 200' ] && echo 1 || echo 0)"
  out="$(prod get fit-prod-photos "$probe")"
  ok_if "prod 키로 올린 객체를 읽을 수 있다" "$(succeeds grep -q hello-prod <<<"$out")"
  out="$(dev put fit-prod-photos "$probe-dev" nope)"
  ok_if "dev 키는 fit-prod-photos에 쓸 수 없다" "$([ "$(first_line "$out")" = 'HTTP 403' ] && echo 1 || echo 0)"
  out="$(prod anon-get "http://garage:3900/fit-prod-photos/$probe")"
  ok_if "서명 없이는 S3 API로 읽을 수 없다" "$([ "$(first_line "$out")" = 'HTTP 403' ] && echo 1 || echo 0)"
  out="$(prod anon-get "http://garage:3902/$probe" fit-prod-photos.web.garage.localhost)"
  ok_if "웹 엔드포인트로는 서명 없이 읽을 수 있다" "$([ "$(first_line "$out")" = 'HTTP 200' ] && echo 1 || echo 0)"
  out="$(prod lifecycle-get fit-prod-photos)"
  ok_if "수명주기(pending/ 1일)가 걸려 있다" "$(succeeds grep -q 'pending/' <<<"$out")"
  prod delete fit-prod-photos "$probe" >/dev/null
fi

# --- OpenSearch: nori 분석기 ---
if [ "${FIT_VERIFY_SKIP_OPENSEARCH:-0}" != 1 ]; then
  ok_if "OpenSearch에 nori 분석기가 있다" \
    "$([ "$(docker exec "$(svc_container opensearch)" curl -s -X POST 'localhost:9200/_analyze' -H 'Content-Type: application/json' -d '{"analyzer":"nori","text":"닭가슴살"}' 2>/dev/null | grep -c '"token"')" -ge 1 ] && echo 1 || echo 0)"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "실패 $FAILED건"
  exit 1
fi
echo "데이터 스택이 설계대로다"
