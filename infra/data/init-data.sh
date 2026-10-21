#!/usr/bin/env bash
# 데이터 스택이 뜬 뒤 DB와 버킷을 맞춘다. fit-up.sh와 사람이 부른다. 몇 번 실행해도 같은 결과다(멱등).
#   bash infra/data/init-data.sh
# postgres와 garage가 healthy가 될 때까지 기다린 뒤 ensure-databases.sh와 init-garage.sh를 차례로 돌린다.
set -euo pipefail
# shellcheck source=infra/data/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

wait_healthy postgres
wait_healthy garage
bash "$DATA_DIR/ensure-databases.sh"
bash "$DATA_DIR/init-garage.sh"
log "데이터 초기화 완료"
