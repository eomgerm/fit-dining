#!/usr/bin/env bash
# 배포(설계 6.4절). GitLab이 죽어도 서버에서 직접 실행할 수 있다.
#   bash infra/deploy/deploy.sh <prod|dev> <sha>
# prod는 BE와 FE를 차례로 반대 색으로 띄워 전환하고(Blue/Green) dev는 단일 색을 교체한다. 이미지는 be:<sha>, fe:<sha>로 이미 조립돼 있어야 한다.
# AI API는 선택이다. /etc/fit/ai-<환경>.env가 있는 환경에서만 BE보다 먼저 한 컨테이너(ai-prod, ai-dev)를 교체하고, 준비되지 않으면 직전 이미지로
# 돌리거나(없으면 치우고) BE·FE 배포는 계속한다(BE에 키워드 검색 폴백이 있다, 설계 11.4절). AI 이미지가 없으면 AI만 건너뛴다.
# CI가 아닌 곳(환경변수 CI가 없음)에서 직접 실행하려면 SKIP_VERIFY=<사유>를 줘야 한다(긴급 수동 배포, RB-02b). 사유는 이력에 남는다.
# 환경변수: FIT_DRAIN_SECONDS(30) FIT_BE_READY_TIMEOUT(150) FIT_FE_READY_TIMEOUT(60) FIT_POOL_KEEP_DAYS(14)
#          FIT_PREDEPLOY_DUMP(prod 마이그레이션 전 덤프 스크립트) FIT_FORCE_MIGRATE=1
# 실패하면 자동으로 이전 상태로 돌아가고 종료 코드 1이다. 마이그레이션은 되돌리지 않는다(forward-fix 원칙, 설계 6.5절).
set -euo pipefail
# shellcheck source=infra/deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ENVN="${1:-}"
SHA="${2:-}"
if ! valid_env "$ENVN" || ! printf '%s' "$SHA" | grep -Eq '^[0-9a-fA-F]{7,40}$'; then
  echo "사용: bash infra/deploy/deploy.sh <prod|dev> <sha(7~40자리 16진수)>" >&2
  exit 2
fi
if [ -z "${CI:-}" ] && [ -z "${SKIP_VERIFY:-}" ]; then
  die "CI 밖에서 직접 배포하려면 SKIP_VERIFY=<사유>를 준다. CI의 verify 단계를 건너뛰는 긴급 배포다(RB-02b)"
fi

bash "$DEPLOY_DIR/preflight.sh" "$ENVN" "$SHA" || die "사전 점검에 실패했다"

acquire_lock "$ENVN"
trap release_lock EXIT
state_init "$ENVN"
PREV="$(state_get "$ENVN" DEPLOYED_SHA none)"
START="$(date +%s)"
AI_NOTE=""
WHO="${GITLAB_USER_LOGIN:-$(id -un)}"
NOTE="${SKIP_VERIFY:+ skip-verify:$SKIP_VERIFY}"
history_add "$ENVN" deploy-start all "$SHA" "start$NOTE"

# AI role이 읽을 뷰와 테이블의 SELECT를 맞춘다(마이그레이션이 뷰를 만든 뒤에도 맞아야 한다). 실패해도 배포는 계속한다
grant_ai_read() {
  ai_enabled "$ENVN" || return 0
  local script="${FIT_GRANT_AI_READ:-$ROOT_DIR/infra/data/grant-ai-read.sh}" res
  if res="$(bash "$script" 2>&1)"; then
    log "AI 읽기 권한을 맞췄다"
  else
    log "경고: AI 읽기 권한을 맞추지 못했다(AI API가 DB를 읽지 못할 수 있다)"
    printf '%s\n' "$res" | tail -n 3
    AI_NOTE="$AI_NOTE (AI 읽기 권한 맞추기 실패)"
  fi
}

# AI API(선택): 한 컨테이너를 교체한다. 확인에 실패하면 직전 이미지로 돌리고, 직전 이미지가 없으면 치운다. 실패해도 1을 돌려줄 뿐 배포를 막지 않는다
deploy_ai() {
  local name tagk prevk oldtag oldprev newprev
  name="$(svc_name ai "$ENVN")"
  tagk="$(tag_key ai "$ENVN")"
  prevk="$(prev_key ai "$ENVN")"
  oldtag="$(state_get "$ENVN" "$tagk" none)"
  oldprev="$(state_get "$ENVN" "$prevk" none)"
  # 이미 떠 있는 SHA를 다시 배포하면 직전 태그를 그 SHA로 덮지 않는다(롤백 대상이 사라진다)
  newprev="$oldtag"
  if [ "$oldtag" = "$SHA" ]; then newprev="$oldprev"; fi
  log "[ai] $ENVN 교체 $oldtag → $SHA"
  state_set "$ENVN" "$tagk=$SHA" "$prevk=$newprev"
  if compose "$ENVN" up -d --no-deps --force-recreate "$name" && wait_ready ai "$name" && smoke_idle ai "$ENVN" "$name" "$SHA"; then
    history_add "$ENVN" deploy ai "$SHA" ok
    return 0
  fi
  state_set "$ENVN" "$tagk=$oldtag" "$prevk=$oldprev"
  history_add "$ENVN" deploy ai "$SHA" fail
  if [ "$oldtag" = none ]; then
    log "경고: [ai] $ENVN 확인에 실패했다. 직전 이미지가 없어 AI 컨테이너를 치운다"
    compose "$ENVN" rm -sf "$name" >/dev/null 2>&1 || true
  else
    log "경고: [ai] $ENVN 확인에 실패했다. 직전 이미지($oldtag)로 돌린다"
    if ! { compose "$ENVN" up -d --no-deps --force-recreate "$name" >/dev/null && wait_ready ai "$name"; }; then
      log "경고: [ai] 직전 이미지로 돌린 뒤에도 준비되지 않았다"
    fi
  fi
  return 1
}

deploy_ai_step() {
  ai_enabled "$ENVN" || return 0
  if ! docker image inspect "$AI_IMAGE:$SHA" >/dev/null 2>&1; then
    log "경고: [ai] 이미지 $AI_IMAGE:$SHA 가 없어 AI API 배포를 건너뛴다(AI 이미지 빌드가 실패했을 수 있다)"
    AI_NOTE="$AI_NOTE (AI API: 이미지가 없어 건너뜀)"
    return 0
  fi
  if ! deploy_ai; then AI_NOTE="$AI_NOTE (AI API: 확인 실패, 이전 상태로 돌림. 로그 확인)"; fi
  return 0
}

# 마이그레이션이 바뀌었으면 prod는 사전 덤프 뒤에, dev는 바로 일회성 컨테이너로 실행한다. 실패하면 트래픽을 건드리기 전에 멈춘다
run_migrations() {
  if ! migrations_changed "$PREV" "$SHA"; then
    log "마이그레이션 변경 없음"
    return 0
  fi
  if [ "$ENVN" = prod ]; then
    local dump="${FIT_PREDEPLOY_DUMP:-$ROOT_DIR/infra/backup/pg-backup.sh}"
    log "마이그레이션 전 덤프"
    "$dump" predeploy "$ENVN" "$SHA" || {
      log "사전 덤프에 실패했다"
      return 1
    }
  fi
  log "마이그레이션 실행(일회성 컨테이너)"
  docker rm -f "fit-migrate-$ENVN" >/dev/null 2>&1 || true
  docker run --rm --name "fit-migrate-$ENVN" --network "${FIT_NET_DATA:-net-data}" \
    --env-file "$ENV_DIR/migrate-$ENVN.env" "$BE_IMAGE:$SHA" || {
    log "마이그레이션에 실패했다"
    return 1
  }
}

# FE 이미지의 정적 자산(/app/.next/static)을 누적 풀에 쌓는다. 열려 있는 탭이 이전 릴리스의 해시 자산을 요청해도 404가 나지 않게 한다(설계 5.3절).
# 이미 있는 파일은 덮어쓰지 않고(해시 이름은 내용이 같다) 이번 릴리스가 가진 파일의 수정 시각을 갱신한다. 오래 안 쓰인 파일은 지운다
sync_pool() {
  local sha="$1" dest id tmp f days
  dest="$WEB_DIR/$ENVN/pool/_next/static"
  days="${FIT_POOL_KEEP_DAYS:-14}"
  mkdir -p "$dest" "$STATE_DIR"
  tmp="$(mktemp -d "$STATE_DIR/pool.XXXXXX")"
  id="$(docker create "$FE_IMAGE:$sha")" || {
    rm -rf "$tmp"
    return 1
  }
  if ! docker cp "$id:/app/.next/static/." "$(native_path "$tmp")"; then
    docker rm "$id" >/dev/null 2>&1 || true
    rm -rf "$tmp"
    log "FE 이미지에 /app/.next/static이 없다"
    return 1
  fi
  docker rm "$id" >/dev/null 2>&1 || true
  if [ -z "$(find "$tmp" -type f | head -n 1)" ]; then
    rm -rf "$tmp"
    log "FE 이미지의 정적 자산이 비어 있다"
    return 1
  fi
  while IFS= read -r -d '' f; do
    if [ ! -e "$dest/$f" ]; then
      mkdir -p "$dest/$(dirname "$f")"
      cp "$tmp/$f" "$dest/$f"
    fi
    touch "$dest/$f"
  done < <(cd "$tmp" && find . -type f -print0)
  chmod -R a+rX "$dest"
  find "$dest" -type f -mtime +"$days" -delete
  find "$dest" -mindepth 1 -type d -empty -delete
  rm -rf "$tmp"
  log "정적 자산 풀 갱신($dest)"
}

# prod: 반대 색을 띄우고 확인한 뒤 엣지를 전환한다. 어느 단계든 실패하면 새 색을 치우고 엣지를 원래대로 돌린다
deploy_color() { # deploy_color be|fe
  local svc="$1" S active new name oldname tagk oldtag activetag oldkeep keepprev
  S="$(upper "$svc")"
  active="$(state_get prod "${S}_ACTIVE" green)"
  new="$(other_color "$active")"
  name="$(svc_name "$svc" prod "$new")"
  oldname="$(svc_name "$svc" prod "$active")"
  tagk="$(tag_key "$svc" prod "$new")"
  oldtag="$(state_get prod "$tagk" none)"
  activetag="$(state_get prod "$(tag_key "$svc" prod "$active")" none)"
  oldkeep="$(state_get prod "${S}_PROD_PREV_TAG" none)"
  # 이미 활성인 SHA를 다시 배포하면 새 색의 태그(직전 릴리스)가 SHA로 덮여 두 색이 같은 태그가 된다.
  # 롤백이 그 직전 릴리스로 돌아갈 수 있게 따로 적어 둔다(rollback.sh가 두 색의 태그가 같을 때 쓴다)
  keepprev=none
  if [ "$activetag" = "$SHA" ]; then
    if [ "$oldtag" != none ] && [ "$oldtag" != "$SHA" ]; then keepprev="$oldtag"; else keepprev="$oldkeep"; fi
  fi
  log "[$svc] $active → $new ($name)"
  if [ "$svc" = fe ]; then sync_pool "$SHA" || return 1; fi
  state_set prod "$tagk=$SHA" "${S}_PROD_PREV_TAG=$keepprev"
  discard_new() {
    compose prod rm -sf "$name" >/dev/null 2>&1 || true
    state_set prod "$tagk=$oldtag" "${S}_PROD_PREV_TAG=$oldkeep"
  }
  if ! compose prod up -d --no-deps --force-recreate "$name"; then
    discard_new
    return 1
  fi
  if ! wait_ready "$svc" "$name" || ! smoke_idle "$svc" prod "$name" "$SHA"; then
    log "[$svc] 새 색($name) 확인에 실패했다. 트래픽은 옮기지 않았다"
    discard_new
    return 1
  fi
  write_upstream prod "$svc" "$name" "$(svc_port "$svc")"
  if ! reload_edge || ! bash "$DEPLOY_DIR/smoke.sh" prod --sha "$SHA" --only "$svc"; then
    log "[$svc] 엣지 전환 뒤 확인에 실패했다. 이전 색으로 돌린다"
    if [ "$activetag" != none ]; then
      write_upstream prod "$svc" "$oldname" "$(svc_port "$svc")"
      reload_edge || log "경고: 엣지를 되돌리는 reload에 실패했다. 수동으로 확인한다"
    fi
    discard_new
    return 1
  fi
  state_set prod "${S}_ACTIVE=$new"
  history_add prod switch "$svc" "$SHA" "$new"
  if [ "$activetag" != none ]; then
    log "[$svc] 드레인 ${DRAIN_SECONDS}초 뒤 이전 색($oldname)을 멈춘다"
    sleep "$DRAIN_SECONDS"
    compose prod stop -t 40 "$oldname" >/dev/null
  fi
}

# dev: 단일 색을 교체한다. 확인에 실패하면 직전 이미지로 돌아간다
deploy_dev() { # deploy_dev be|fe
  local svc="$1" S name tagk oldtag oldprev newprev
  S="$(upper "$svc")"
  name="$(svc_name "$svc" dev)"
  tagk="$(tag_key "$svc" dev)"
  oldtag="$(state_get dev "$tagk" none)"
  oldprev="$(state_get dev "${S}_DEV_PREV_TAG" none)"
  # 이미 떠 있는 SHA를 다시 배포하면 직전 태그를 그 SHA로 덮지 않는다(롤백 대상이 사라진다)
  newprev="$oldtag"
  if [ "$oldtag" = "$SHA" ]; then newprev="$oldprev"; fi
  log "[$svc] dev 교체 $oldtag → $SHA"
  if [ "$svc" = fe ]; then sync_pool "$SHA" || return 1; fi
  state_set dev "$tagk=$SHA" "${S}_DEV_PREV_TAG=$newprev"
  if compose dev up -d --no-deps --force-recreate "$name" && wait_ready "$svc" "$name" &&
    smoke_idle "$svc" dev "$name" "$SHA" && bash "$DEPLOY_DIR/smoke.sh" dev --sha "$SHA" --only "$svc"; then
    return 0
  fi
  log "[$svc] dev 확인에 실패했다. 직전 이미지로 돌린다"
  state_set dev "$tagk=$oldtag" "${S}_DEV_PREV_TAG=$oldprev"
  if [ "$oldtag" = none ]; then
    compose dev rm -sf "$name" >/dev/null 2>&1 || true
  elif ! { compose dev up -d --no-deps --force-recreate "$name" >/dev/null && wait_ready "$svc" "$name"; }; then
    log "경고: 직전 이미지로 돌린 뒤에도 준비되지 않았다"
  fi
  return 1
}

main() {
  run_migrations || return 1
  grant_ai_read
  deploy_ai_step
  local svc
  for svc in be fe; do
    if [ "$ENVN" = prod ]; then deploy_color "$svc" || return 1; else deploy_dev "$svc" || return 1; fi
  done
  # 같은 SHA를 다시 배포한 것이면 이전 SHA를 그대로 둔다(PREV가 지금 SHA라 덮으면 롤백 대상이 사라진다)
  local prevsha="$PREV"
  if sha_match "$PREV" "$SHA"; then prevsha="$(state_get "$ENVN" PREVIOUS_SHA none)"; fi
  state_set "$ENVN" "DEPLOYED_SHA=$SHA" "PREVIOUS_SHA=$prevsha"
}

if main; then
  elapsed=$(($(date +%s) - START))
  history_add "$ENVN" deploy-end all "$SHA" "ok$NOTE"
  notify ok "배포 완료: $ENVN ${SHA:0:12} (작성자 $WHO, ${elapsed}초)$AI_NOTE"
  log "배포 완료: $ENVN $SHA"
else
  history_add "$ENVN" deploy-end all "$SHA" "fail$NOTE"
  notify fail "배포 실패: $ENVN ${SHA:0:12} (작성자 $WHO). 실패한 서비스는 이전 상태로 돌렸다. 상태는 'bash infra/edge/edgectl.sh status'와 이력($STATE_DIR/history-$ENVN.log)을 본다"
  die "배포에 실패했다. 실패한 서비스는 이전 상태로 돌렸다(BE만 성공하고 FE가 실패했다면 BE는 새 버전으로 남는다)"
fi
