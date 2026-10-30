#!/usr/bin/env bash
# 직전 배포로 즉시 되돌린다(설계 6.4절 6단계). 이전 색의 컨테이너와 이미지가 남아 있어서 빠르다.
#   bash infra/deploy/rollback.sh <prod|dev> [be|fe|ai|all]   # 기본은 all(AI는 켜진 환경에서만 포함한다)
# prod는 이전 색을 다시 띄워 확인한 뒤 엣지를 옮기고 지금 색을 멈춘다. dev는 직전 이미지로 교체한다.
# AI API는 한 컨테이너라 직전 이미지로 교체한다. all에서 AI를 되돌리지 못하면 경고만 하고(BE·FE 롤백을 막지 않는다) ai를 직접 지정하면 실패로 본다.
# DB 마이그레이션은 되돌리지 않는다. expand/contract 원칙이라 이전 버전이 새 스키마에서도 돌아야 한다(설계 6.5절).
# 되돌리기에 실패하면 지금 상태를 그대로 두고 종료 코드 1이다. 직접 실행에는 SKIP_VERIFY 같은 사유가 필요 없다(긴급 복구).
set -euo pipefail
# shellcheck source=infra/deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ENVN="${1:-}"
WHICH="${2:-all}"
case "$WHICH" in be | fe | ai | all) ;; *) WHICH="" ;; esac
if ! valid_env "$ENVN" || [ -z "$WHICH" ]; then
  echo "사용: bash infra/deploy/rollback.sh <prod|dev> [be|fe|ai|all]" >&2
  exit 2
fi
[ -f "$(state_file "$ENVN")" ] || die "$ENVN에는 배포 기록(상태 파일)이 없다"
if [ "$WHICH" = ai ] && ! ai_enabled "$ENVN"; then die "$ENVN에는 AI API가 켜져 있지 않다(/etc/fit/ai-$ENVN.env가 없다)"; fi

bash "$DEPLOY_DIR/preflight.sh" "$ENVN" - --rollback || die "사전 점검에 실패했다"

acquire_lock "$ENVN"
trap release_lock EXIT
WHO="${GITLAB_USER_LOGIN:-$(id -un)}"

rollback_color() { # rollback_color be|fe
  local svc="$1" S active prev name oldname prevtag activetag prevtagk origprevtag keep
  S="$(upper "$svc")"
  active="$(state_get prod "${S}_ACTIVE" green)"
  prev="$(other_color "$active")"
  name="$(svc_name "$svc" prod "$prev")"
  oldname="$(svc_name "$svc" prod "$active")"
  prevtagk="$(tag_key "$svc" prod "$prev")"
  prevtag="$(state_get prod "$prevtagk" none)"
  activetag="$(state_get prod "$(tag_key "$svc" prod "$active")" none)"
  [ "$prevtag" != none ] || {
    log "[$svc] 되돌릴 이전 색이 없다"
    return 1
  }
  # 같은 SHA를 다시 배포해 두 색이 같은 태그를 가리키면 deploy.sh가 따로 적어 둔 직전 릴리스로 돌아간다
  origprevtag="$prevtag"
  keep="$(state_get prod "${S}_PROD_PREV_TAG" none)"
  if [ "$prevtag" = "$activetag" ] && [ "$keep" != none ] && [ "$keep" != "$activetag" ]; then prevtag="$keep"; fi
  docker image inspect "$(image_of "$svc"):$prevtag" >/dev/null 2>&1 || {
    log "[$svc] 이전 이미지 $(image_of "$svc"):$prevtag 가 없다"
    return 1
  }
  log "[$svc] $active($activetag) → $prev($prevtag)"
  # 이전 색 컨테이너가 이 태그의 이미지로 뜨도록 상태의 태그를 맞춘다(실패하면 아래에서 되돌린다)
  state_set prod "$prevtagk=$prevtag"
  if ! compose prod up -d --no-deps "$name" || ! wait_ready "$svc" "$name" || ! smoke_idle "$svc" prod "$name" "$prevtag"; then
    log "[$svc] 이전 색($name)이 준비되지 않았다. 지금 상태를 그대로 둔다"
    compose prod stop -t 40 "$name" >/dev/null 2>&1 || true
    state_set prod "$prevtagk=$origprevtag"
    return 1
  fi
  write_upstream prod "$svc" "$name" "$(svc_port "$svc")"
  if ! reload_edge || ! bash "$DEPLOY_DIR/smoke.sh" prod --sha "$prevtag" --only "$svc"; then
    log "[$svc] 엣지를 옮긴 뒤 확인에 실패했다. 지금 색으로 다시 돌린다"
    write_upstream prod "$svc" "$oldname" "$(svc_port "$svc")"
    reload_edge || log "경고: 엣지를 되돌리는 reload에 실패했다. 수동으로 확인한다"
    compose prod stop -t 40 "$name" >/dev/null 2>&1 || true
    state_set prod "$prevtagk=$origprevtag"
    return 1
  fi
  state_set prod "${S}_ACTIVE=$prev" "${S}_PROD_PREV_TAG=none"
  history_add prod rollback "$svc" "$prevtag" "$prev"
  compose prod stop -t 40 "$oldname" >/dev/null
}

rollback_ai() { # 한 컨테이너를 직전 이미지로 교체한다(prod와 dev가 같다)
  local name tagk prevk cur prev
  name="$(svc_name ai "$ENVN")"
  tagk="$(tag_key ai "$ENVN")"
  prevk="$(prev_key ai "$ENVN")"
  cur="$(state_get "$ENVN" "$tagk" none)"
  prev="$(state_get "$ENVN" "$prevk" none)"
  [ "$prev" != none ] || {
    log "[ai] 되돌릴 이전 이미지가 없다"
    return 1
  }
  docker image inspect "$(image_of ai):$prev" >/dev/null 2>&1 || {
    log "[ai] 이전 이미지 $(image_of ai):$prev 가 없다"
    return 1
  }
  log "[ai] $ENVN $cur → $prev"
  state_set "$ENVN" "$tagk=$prev" "$prevk=$cur"
  if compose "$ENVN" up -d --no-deps --force-recreate "$name" && wait_ready ai "$name" && smoke_idle ai "$ENVN" "$name" "$prev"; then
    history_add "$ENVN" rollback ai "$prev" ok
    return 0
  fi
  log "[ai] 되돌린 이미지가 준비되지 않았다. 원래 이미지로 복구한다"
  state_set "$ENVN" "$tagk=$cur" "$prevk=$prev"
  if ! { compose "$ENVN" up -d --no-deps --force-recreate "$name" >/dev/null && wait_ready ai "$name"; }; then
    log "경고: [ai] 복구한 뒤에도 준비되지 않았다"
  fi
  return 1
}

rollback_dev() { # rollback_dev be|fe
  local svc="$1" S name tagk cur prev
  S="$(upper "$svc")"
  name="$(svc_name "$svc" dev)"
  tagk="$(tag_key "$svc" dev)"
  cur="$(state_get dev "$tagk" none)"
  prev="$(state_get dev "${S}_DEV_PREV_TAG" none)"
  [ "$prev" != none ] || {
    log "[$svc] 되돌릴 이전 이미지가 없다"
    return 1
  }
  docker image inspect "$(image_of "$svc"):$prev" >/dev/null 2>&1 || {
    log "[$svc] 이전 이미지 $(image_of "$svc"):$prev 가 없다"
    return 1
  }
  log "[$svc] dev $cur → $prev"
  state_set dev "$tagk=$prev" "${S}_DEV_PREV_TAG=$cur"
  if compose dev up -d --no-deps --force-recreate "$name" && wait_ready "$svc" "$name" && smoke_idle "$svc" dev "$name" "$prev"; then
    history_add dev rollback "$svc" "$prev" ok
    return 0
  fi
  log "[$svc] 되돌린 이미지가 준비되지 않았다. 원래 이미지로 복구한다"
  state_set dev "$tagk=$cur" "${S}_DEV_PREV_TAG=$prev"
  if ! { compose dev up -d --no-deps --force-recreate "$name" >/dev/null && wait_ready "$svc" "$name"; }; then
    log "경고: 복구한 뒤에도 준비되지 않았다"
  fi
  return 1
}

services="be fe"
if ai_enabled "$ENVN"; then services="be fe ai"; fi
if [ "$WHICH" != all ]; then services="$WHICH"; fi
failed=0
for svc in $services; do
  if [ "$svc" = ai ]; then
    if rollback_ai; then
      :
    elif [ "$WHICH" = ai ]; then
      failed=1
    else
      log "경고: [ai] 되돌리지 못했다. AI API는 지금 상태 그대로다(BE에 키워드 검색 폴백이 있다)"
    fi
  elif [ "$ENVN" = prod ]; then
    rollback_color "$svc" || failed=1
  else
    rollback_dev "$svc" || failed=1
  fi
done

if [ "$failed" = 0 ]; then
  if [ "$WHICH" = all ]; then
    cur="$(state_get "$ENVN" DEPLOYED_SHA none)"
    prev="$(state_get "$ENVN" PREVIOUS_SHA none)"
    state_set "$ENVN" "DEPLOYED_SHA=$prev" "PREVIOUS_SHA=$cur"
  fi
  notify ok "롤백 완료: $ENVN $WHICH (실행 $WHO). DB 마이그레이션은 되돌리지 않았다"
  log "롤백 완료"
else
  notify fail "롤백 실패: $ENVN $WHICH (실행 $WHO). 지금 상태를 확인한다"
  die "롤백에 실패했다. 실패한 서비스는 지금 상태 그대로다"
fi
