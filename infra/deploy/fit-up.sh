#!/usr/bin/env bash
# 호스트를 재부팅했거나 장애를 복구한 뒤 서비스를 순서대로 올린다(설계 10.2절).
#   bash infra/deploy/fit-up.sh
# 순서: 공유 망 → data(올린 뒤 DB·버킷 초기화 스크립트) → edge → app(prod·dev의 활성 색만. AI API가 BE보다 먼저) → obs → 스모크(실패는 알리기만 한다).
# compose 파일이 없는 프로젝트(obs)는 건너뛴다. data와 obs의 compose 파일은 FIT_DATA_COMPOSE, FIT_OBS_COMPOSE로 바꾼다(시험용).
# 이 스크립트는 상태를 바꾸지 않고 멈춘 컨테이너를 올리기만 한다(data 초기화 스크립트는 몇 번 실행해도 같은 결과다).
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

up_project() { # up_project 이름 compose파일 env파일: 파일이 없으면 건너뛴다. 올렸으면 0, 건너뛰거나 실패하면 1을 돌려준다
  local name="$1" file="$2" envfile="$3"
  if [ ! -f "$file" ]; then
    log "$name: 건너뜀($file 없음)"
    return 1
  fi
  log "$name: 올린다"
  if docker compose -p "fit-$name" -f "$file" --env-file "$envfile" up -d --wait --wait-timeout 600; then return 0; fi
  warn "$name를 올리지 못했다"
  return 1
}

log "== 공유 Docker 망"
bash "$ROOT_DIR/infra/host/networks.sh" || {
  echo "FAIL 공유 망이 설계와 다르다. 망을 먼저 바로잡는다" >&2
  exit 1
}

log "== data"
if up_project data "${FIT_DATA_COMPOSE:-$ROOT_DIR/infra/data/compose.data.yml}" "$ENV_DIR/data.env"; then
  bash "$ROOT_DIR/infra/data/init-data.sh" || warn "데이터 초기화(DB·버킷)에 실패했다"
fi

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
  for svc in ai be fe; do
    if [ "$svc" = ai ]; then
      # AI API는 색이 없고 켜지 않은 환경은 태그가 none이라 건너뛴다
      name="$(svc_name ai "$env")"
      tag="$(state_get "$env" "$(tag_key ai "$env")" none)"
    elif [ "$env" = prod ]; then
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
up_project obs "${FIT_OBS_COMPOSE:-$ROOT_DIR/infra/obs/compose.obs.yml}" "$ENV_DIR/obs.env" || true

log "== 스모크"
for env in prod dev; do
  if [ ! -f "$(state_file "$env")" ]; then continue; fi
  if bash "$DEPLOY_DIR/smoke.sh" "$env"; then log "$env: 스모크 통과"; else warn "$env 스모크가 실패했다"; fi
done

if [ "$WARN" = 0 ]; then log "모두 올라왔다"; else log "일부에 경고가 있다. 위 로그를 확인한다"; fi
