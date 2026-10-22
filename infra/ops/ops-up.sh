#!/usr/bin/env bash
# 서버 B의 감시 스택(프로젝트 fit-ops)을 올린다. 몇 번 실행해도 같은 결과다(이미 떠 있으면 설정이 바뀐 서비스만 다시 만든다).
#   sudo bash infra/ops/ops-up.sh
# 값은 $FIT_ENV_DIR/ops.env(기본 /etc/fit/ops.env)에서 읽는다. REPLACE_ME가 남아 있으면 올리지 않는다.
# 환경변수(선택): FIT_ENV_DIR, FIT_OPS_PROJECT(fit-ops), FIT_OPS_COMPOSE(compose 파일. 시험용)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${FIT_ENV_DIR:-/etc/fit}/ops.env"
COMPOSE="${FIT_OPS_COMPOSE:-$HERE/compose.ops.yml}"
PROJECT="${FIT_OPS_PROJECT:-fit-ops}"

[ -f "$ENV_FILE" ] || {
  echo "FAIL $ENV_FILE가 없다. 먼저 sudo bash infra/ops/install.sh 를 실행한다" >&2
  exit 1
}
if grep -q 'REPLACE_ME' "$ENV_FILE"; then
  echo "FAIL $ENV_FILE에 자리표시자(REPLACE_ME)가 남아 있다. 값을 채운다" >&2
  exit 1
fi
if [ "$(stat -c %a "$ENV_FILE")" != 600 ] && [ "$(stat -c %a "$ENV_FILE")" != 640 ]; then
  echo "FAIL $ENV_FILE의 권한이 600이나 640이 아니다(비밀이 들어 있다)" >&2
  exit 1
fi
docker compose -p "$PROJECT" -f "$COMPOSE" --env-file "$ENV_FILE" up -d --wait --wait-timeout 300
echo "$PROJECT가 올라왔다. 점검: bash infra/ops/verify-ops.sh"
