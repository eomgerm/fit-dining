#!/usr/bin/env bash
# AI API용 읽기 전용 role(fit_prod_ai, fit_dev_ai)이 읽을 객체를 맞춘다(설계 11.2절). 몇 번 실행해도 같은 결과다(멱등).
#   bash infra/data/grant-ai-read.sh
# AI는 DB를 직접 읽지만 아래 객체의 SELECT만 받는다. 뷰는 소유자(fit_migrator) 권한으로 실행되므로 뷰 밑의 테이블(places 등)과
# 인증 테이블은 AI role이 읽지 못한다. 마이그레이션이 만든 새 객체에는 기본 권한을 주지 않으므로(앱 role과 다르다) 이 목록에 더해야 읽힌다.
# 아직 없는 객체는 건너뛴다(마이그레이션 전). 마이그레이션이 객체를 만든 뒤에 다시 돌려야 읽힌다(배포가 마이그레이션 뒤에 돌린다).
set -euo pipefail
# shellcheck source=infra/data/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# 이름을 늘릴 때는 BE·AI 팀과 정한 읽기 계약이다. 새 객체가 AI에게 필요하면 이 목록을 고치는 MR을 만든다.
AI_READ_OBJECTS="ai_place_search ai_place_personas user_preferences"

for env in prod dev; do
  granted="" skipped=""
  for obj in $AI_READ_OBJECTS; do
    if [ "$(psql_admin -d "fit_$env" -c "SELECT to_regclass('public.$obj') IS NOT NULL")" = t ]; then
      psql_admin -d "fit_$env" -c "GRANT SELECT ON public.$obj TO fit_${env}_ai" >/dev/null
      granted="$granted $obj"
    else
      skipped="$skipped $obj"
    fi
  done
  log "fit_${env}_ai 읽기 허용:${granted:- (없음)}"
  [ -z "$skipped" ] || log "fit_${env}_ai 아직 없는 객체(건너뜀):$skipped"
done
