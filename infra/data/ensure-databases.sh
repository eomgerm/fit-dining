#!/usr/bin/env bash
# 환경별 DB와 role을 만든다(설계 2.3절, 7.1절). 몇 번 실행해도 같은 결과다(멱등). init 스크립트가 아니라 이 스크립트를 쓰는 이유는
# init 스크립트가 빈 볼륨에서 한 번만 돌기 때문이다(A503 함정). role 비밀번호는 매번 data.env 값으로 맞춘다.
#   bash infra/data/ensure-databases.sh
# role: fit_migrator(DDL), fit_prod_app, fit_dev_app(DML만), fit_monitor(관측성: pg_monitor 권한으로 통계만 읽는다),
#       fit_prod_ai, fit_dev_ai(AI API용 읽기 전용. grant-ai-read.sh가 정한 객체만 SELECT한다).
# DB: fit_prod, fit_dev(소유자 fit_migrator). 각 app·ai role은 자기 DB에만 접속하고 fit_monitor는 앱 DB에 접속하지 못한다(postgres DB에서 통계를 읽는다).
# dev 앱 role에는 statement_timeout 30초를, ai role에는 10초와 접속 수 6개 상한, 읽기 전용 트랜잭션 기본값을 건다. 비밀번호는 표준 입력으로만 넘기고 서버의 통계·로그에 남지 않게 세션 설정을 끈다.
set -euo pipefail
# shellcheck source=infra/data/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_data_env

log "role과 DB를 맞춘다"
psql_admin -d postgres <<SQL
SET pg_stat_statements.track_utility = off;
SET log_statement = 'none';
SELECT 'CREATE ROLE fit_migrator LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fit_migrator') \gexec
SELECT 'CREATE ROLE fit_prod_app LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fit_prod_app') \gexec
SELECT 'CREATE ROLE fit_dev_app LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fit_dev_app') \gexec
SELECT 'CREATE ROLE fit_monitor LOGIN IN ROLE pg_monitor' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fit_monitor') \gexec
SELECT 'CREATE ROLE fit_prod_ai LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fit_prod_ai') \gexec
SELECT 'CREATE ROLE fit_dev_ai LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fit_dev_ai') \gexec
ALTER ROLE fit_migrator PASSWORD '${FIT_MIGRATOR_PASSWORD}';
ALTER ROLE fit_prod_app PASSWORD '${FIT_PROD_APP_PASSWORD}';
ALTER ROLE fit_dev_app PASSWORD '${FIT_DEV_APP_PASSWORD}';
ALTER ROLE fit_monitor PASSWORD '${FIT_MONITOR_PASSWORD}';
ALTER ROLE fit_prod_ai PASSWORD '${FIT_PROD_AI_PASSWORD}';
ALTER ROLE fit_dev_ai PASSWORD '${FIT_DEV_AI_PASSWORD}';
ALTER ROLE fit_dev_app SET statement_timeout = '30s';
ALTER ROLE fit_prod_ai CONNECTION LIMIT 6;
ALTER ROLE fit_dev_ai CONNECTION LIMIT 6;
ALTER ROLE fit_prod_ai SET statement_timeout = '10s';
ALTER ROLE fit_dev_ai SET statement_timeout = '10s';
ALTER ROLE fit_prod_ai SET default_transaction_read_only = on;
ALTER ROLE fit_dev_ai SET default_transaction_read_only = on;
SELECT 'CREATE DATABASE fit_prod OWNER fit_migrator' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'fit_prod') \gexec
SELECT 'CREATE DATABASE fit_dev OWNER fit_migrator' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'fit_dev') \gexec
SQL

for env in prod dev; do
  psql_admin -d "fit_$env" <<SQL
SET client_min_messages = warning;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
REVOKE ALL ON DATABASE fit_$env FROM PUBLIC;
GRANT CONNECT ON DATABASE fit_$env TO fit_${env}_app;
GRANT USAGE ON SCHEMA public TO fit_${env}_app;
GRANT CONNECT ON DATABASE fit_$env TO fit_${env}_ai;
GRANT USAGE ON SCHEMA public TO fit_${env}_ai;
ALTER DEFAULT PRIVILEGES FOR ROLE fit_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fit_${env}_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fit_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO fit_${env}_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fit_${env}_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fit_${env}_app;
SQL
done
# AI role이 읽을 객체(마이그레이션이 만든 뷰와 테이블)는 아래 스크립트가 맞춘다. 마이그레이션이 객체를 만든 뒤에도 배포가 다시 돌린다.
bash "$(dirname "${BASH_SOURCE[0]}")/grant-ai-read.sh"
log "role과 DB가 설계대로다"
