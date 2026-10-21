#!/usr/bin/env bash
# 호스트를 재부팅했거나 장애를 복구한 뒤 서비스를 순서대로 올린다(설계 10.2절).
#   bash infra/deploy/fit-up.sh
# 순서: 공유 망 → data → edge → app(prod·dev의 활성 색만) → obs → 스모크(실패는 알리기만 한다).
# 아직 없는 프로젝트(data, obs)는 건너뛴다. 이 스크립트는 상태를 바꾸지 않고 멈춘 컨테이너를 올리기만 한다.
# 활성이 아닌 색(이전 배포)은 올리지 않는다. 롤백이 필요하면 rollback.sh를 쓴다.
# 시험 환경은 FIT_EDGE_COMPOSE_ARGS(edgectl.sh와 같다), FIT_NET_PREFIX(networks.sh와 같다), lib.sh의 환경변수를 쓴다.
set -uo pipefail
# shellcheck source=infra/deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

WARN=0
warn() {
  log "경고: $*"
  WARN=1
}

up_project() { # up_project 이름 compose파일 env파일: 파일이 없으면 건너뛴다
  local name="$1" file="$2" envfile="$3"
  if [ ! -f "$file" ]; then
    log "$name: 건너뜀($file 없음)"
    return 0
  fi
  log "$name: 올린다"
  docker compose -p "fit-$name" -f "$file" --env-file "$envfile" up -d --wait || warn "$name를 올리지 못했다"
}

log "== 공유 Docker 망"
bash "$ROOT_DIR/infra/host/networks.sh" || {
  echo "FAIL 공유 망이 설계와 다르다. 망을 먼저 바로잡는다" >&2
  exit 1
}

log "== data"
up_project data "$ROOT_DIR/infra/data/compose.data.yml" "$ENV_DIR/data.env"

log "== edge"
if [ -n "${FIT_EDGE_COMPOSE_ARGS:-}" ]; then
  read -r -a EDGE_DC <<<"docker compose $FIT_EDGE_COMPOSE_ARGS"
else
  EDGE_DC=(docker compose --env-file "$ENV_DIR/edge.env" -f "$ROOT_DIR/infra/edge/compose.edge.yml")
fi
"${EDGE_DC[@]}" up -d --wait || {
  echo "FAIL 엣지를 올리지 못했다(app은 엣지가 있어야 확인할 수 있다)" >&2
  exit 1
}

log "== app"
for env in prod dev; do
  if [ ! -f "$(state_file "$env")" ]; then
    log "$env: 건너뜀(배포한 적이 없다)"
    continue
  fi
  for svc in be fe; do
    if [ "$env" = prod ]; then
      name="$(svc_name "$svc" prod "$(state_get prod "$(upper "$svc")_ACTIVE" green)")"
      tag="$(state_get prod "$(tag_key "$svc" prod "$(state_get prod "$(upper "$svc")_ACTIVE" green)")" none)"
    else
      name="$(svc_name "$svc" dev)"
      tag="$(state_get dev "$(tag_key "$svc" dev)" none)"
    fi
    if [ "$tag" = none ]; then
      log "$name: 건너뜀(배포한 적이 없다)"
      continue
    fi
    log "$name: 올린다($tag)"
    if compose "$env" up -d --no-deps "$name" >/dev/null && wait_ready "$svc" "$name"; then
      log "$name: 준비됨"
    else
      warn "$name가 준비되지 않았다"
    fi
  done
done

log "== obs"
up_project obs "$ROOT_DIR/infra/obs/compose.obs.yml" "$ENV_DIR/obs.env"

log "== 스모크"
for env in prod dev; do
  if [ ! -f "$(state_file "$env")" ]; then continue; fi
  if bash "$DEPLOY_DIR/smoke.sh" "$env"; then log "$env: 스모크 통과"; else warn "$env 스모크가 실패했다"; fi
done

if [ "$WARN" = 0 ]; then log "모두 올라왔다"; else log "일부에 경고가 있다. 위 로그를 확인한다"; fi
