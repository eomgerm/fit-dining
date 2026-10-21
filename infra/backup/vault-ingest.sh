#!/usr/bin/env bash
# B의 금고가 받은 백업을 검증해 보관소로 옮긴다(설계 8절 3번). root로 돌고 timer가 10분마다 부른다.
#   bash infra/backup/vault-ingest.sh                              # incoming/의 새 백업을 검증하고 보관 정책을 적용한다
#   bash infra/backup/vault-ingest.sh record-restore <epoch> <초>   # 복원 리허설 결과를 기록한다(사람이 sudo로 부른다)
# incoming/은 vault 계정(A가 접속하는 계정)이 쓰는 곳이라 신뢰하지 않는다. 이름 형식을 검사하고, 파일을 먼저 root만 쓰는 staging으로 옮긴 뒤
# 그 사본의 sha256과 크기를 .meta와 대조한다. 통과하면 store/<종류>/로, 아니면 store/quarantine/으로 옮긴다.
# 보관 정책(BACKUP_KEEP_HOURS 시간 단위 + BACKUP_KEEP_DAYS 일 단위)은 종류마다 적용한다. 마지막 수신 시각 등은 지표 파일로 쓴다.
# 경로: FIT_VAULT_DIR(/srv/vault), 지표 FIT_VAULT_METRICS_DIR($FIT_VAULT_DIR/metrics).
set -euo pipefail
# shellcheck source=infra/backup/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

VAULT="${FIT_VAULT_DIR:-/srv/vault}"
INCOMING="$VAULT/incoming"
STORE="$VAULT/store"
STAGING="$STORE/.staging"
QUARANTINE="$STORE/quarantine"
VAULT_METRICS_DIR="${FIT_VAULT_METRICS_DIR:-$VAULT/metrics}"
# 잠금과 상태 파일은 금고 디렉터리에 둔다(lib.sh의 state_get/state_set이 BACKUP_DIR/state를 쓴다)
BACKUP_DIR="$VAULT"
load_backup_env
ORPHAN_DATA_MINUTES=$((24 * 60))
ORPHAN_META_MINUTES=60

quarantine() { # quarantine 파일... : 이름이 겹치지 않게 시각을 붙여 격리한다
  local f
  mkdir -p "$QUARANTINE"
  for f in "$@"; do
    [ -e "$f" ] || [ -L "$f" ] || continue
    mv -- "$f" "$QUARANTINE/$(basename "$f").$(date +%s)"
  done
}

count_files() { find "$1" -maxdepth 1 -type f -name '*.age' 2>/dev/null | wc -l | tr -d ' '; }
dir_bytes() { find "$1" -maxdepth 1 -type f -printf '%s\n' 2>/dev/null | awk '{ s += $1 } END { print s + 0 }'; }

render_vault_metrics() {
  local kind
  {
    echo '# HELP fit_vault_last_received_timestamp_seconds 금고가 마지막으로 검증을 통과한 백업을 받은 시각(UTC epoch)'
    echo '# TYPE fit_vault_last_received_timestamp_seconds gauge'
    for kind in pg photos caddy; do echo "fit_vault_last_received_timestamp_seconds{kind=\"$kind\"} $(state_get "received.$kind")"; done
    echo '# HELP fit_vault_backups 보관 중인 백업 수'
    echo '# TYPE fit_vault_backups gauge'
    for kind in pg photos caddy; do echo "fit_vault_backups{kind=\"$kind\"} $(count_files "$STORE/$kind")"; done
    echo '# HELP fit_vault_store_bytes 보관 중인 백업의 전체 크기'
    echo '# TYPE fit_vault_store_bytes gauge'
    for kind in pg photos caddy; do echo "fit_vault_store_bytes{kind=\"$kind\"} $(dir_bytes "$STORE/$kind")"; done
    echo '# HELP fit_vault_quarantined_files 격리된 파일 수'
    echo '# TYPE fit_vault_quarantined_files gauge'
    echo "fit_vault_quarantined_files $(find "$QUARANTINE" -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')"
    echo '# HELP fit_vault_ingest_failures_total 검증에 실패해 격리한 백업 수(누적)'
    echo '# TYPE fit_vault_ingest_failures_total counter'
    echo "fit_vault_ingest_failures_total $(state_get ingest_failures)"
    echo '# HELP fit_vault_ingest_last_run_timestamp_seconds ingest가 마지막으로 끝까지 돈 시각'
    echo '# TYPE fit_vault_ingest_last_run_timestamp_seconds gauge'
    echo "fit_vault_ingest_last_run_timestamp_seconds $(state_get ingest_last_run)"
    echo '# HELP fit_vault_last_restore_check_timestamp_seconds 마지막 복원 리허설 시각'
    echo '# TYPE fit_vault_last_restore_check_timestamp_seconds gauge'
    echo "fit_vault_last_restore_check_timestamp_seconds $(state_get restore.last)"
    echo '# HELP fit_vault_last_restore_check_rto_seconds 마지막 복원 리허설에 걸린 시간(RTO 측정값)'
    echo '# TYPE fit_vault_last_restore_check_rto_seconds gauge'
    echo "fit_vault_last_restore_check_rto_seconds $(state_get restore.rto)"
  } | write_atomic "$VAULT_METRICS_DIR/fit_vault.prom"
}

# ingest_pair 이름(.age): 짝 파일과 함께 검증하고 보관소나 격리 구역으로 옮긴다
ingest_pair() {
  local data="$1" meta="$1.meta" kind want_sum want_size got_sum got_size
  mkdir -p "$STAGING"
  # incoming/은 신뢰하지 않으므로 먼저 root만 쓰는 곳으로 옮기고 그 사본을 검사한다
  mv -- "$INCOMING/$data" "$STAGING/$data"
  mv -- "$INCOMING/$meta" "$STAGING/$meta"
  if [ -L "$STAGING/$data" ] || [ ! -f "$STAGING/$data" ] || [ -L "$STAGING/$meta" ] || [ ! -f "$STAGING/$meta" ]; then
    log "일반 파일이 아니다: $data"
    quarantine "$STAGING/$data" "$STAGING/$meta"
    state_set ingest_failures $(($(state_get ingest_failures) + 1))
    return 0
  fi
  kind="${data%%-*}"
  want_sum="$(meta_get "$STAGING/$meta" sha256)"
  want_size="$(meta_get "$STAGING/$meta" size)"
  if ! [[ "$want_sum" =~ ^[0-9a-f]{64}$ ]] || ! [[ "$want_size" =~ ^[0-9]+$ ]] \
    || [ "$(meta_get "$STAGING/$meta" name)" != "$data" ] || [ "$(meta_get "$STAGING/$meta" kind)" != "$kind" ]; then
    log ".meta 내용이 형식에 맞지 않는다: $data"
    quarantine "$STAGING/$data" "$STAGING/$meta"
    state_set ingest_failures $(($(state_get ingest_failures) + 1))
    return 0
  fi
  got_sum="$(sha256sum "$STAGING/$data" | cut -d' ' -f1)"
  got_size="$(wc -c <"$STAGING/$data" | tr -d ' ')"
  if [ "$got_sum" != "$want_sum" ] || [ "$got_size" != "$want_size" ]; then
    log "sha256 또는 크기가 다르다: $data"
    quarantine "$STAGING/$data" "$STAGING/$meta"
    state_set ingest_failures $(($(state_get ingest_failures) + 1))
    return 0
  fi
  mkdir -p "$STORE/$kind"
  mv -- "$STAGING/$data" "$STORE/$kind/$data"
  mv -- "$STAGING/$meta" "$STORE/$kind/$meta"
  state_set "received.$kind" "$(date +%s)"
  log "받았다: $kind/$data ($got_size 바이트)"
}

ingest() {
  acquire_lock ingest
  umask 077
  mkdir -p "$STORE" "$QUARANTINE" "$STAGING" "$VAULT/state"
  local f name base
  # 짝이 완성된(.meta가 있는) 파일부터 처리한다
  while IFS= read -r f; do
    name="$(basename "$f")"
    base="${name%.meta}"
    backup_name_ok "$base" || continue
    if [ -f "$INCOMING/$base" ] || [ -L "$INCOMING/$base" ]; then
      ingest_pair "$base"
    fi
  done < <(find "$INCOMING" -maxdepth 1 -name '*.meta' -type f | sort)
  # 짝이 맞지 않거나 이름이 이상한 파일은 시간이 지나면 격리한다(진행 중인 전송은 건드리지 않는다)
  while IFS= read -r f; do
    log "짝이 없거나 이름이 이상해서 격리한다: $(basename "$f")"
    quarantine "$f"
  done < <(find "$INCOMING" -maxdepth 1 \( -type f -o -type l \) \( -name '*.meta' -mmin +"$ORPHAN_META_MINUTES" -o ! -name '*.meta' -mmin +"$ORPHAN_DATA_MINUTES" \) | sort)
  for f in pg photos caddy; do
    [ -d "$STORE/$f" ] && prune_dir "$STORE/$f" "$f"
  done
  find "$QUARANTINE" -maxdepth 1 -type f -mtime +30 -delete 2>/dev/null || true
  state_set ingest_last_run "$(date +%s)"
  render_vault_metrics
}

record_restore() {
  local epoch="${2:-}" rto="${3:-}"
  [[ "$epoch" =~ ^[0-9]{9,11}$ ]] && [[ "$rto" =~ ^[0-9]{1,7}$ ]] || die "사용: vault-ingest.sh record-restore <epoch 초> <RTO 초>"
  acquire_lock ingest
  mkdir -p "$VAULT/state"
  state_set restore.last "$epoch"
  state_set restore.rto "$rto"
  printf '%s %s\n' "$epoch" "$rto" >>"$VAULT/state/restore-checks.log"
  render_vault_metrics
  log "복원 리허설 결과를 기록했다(RTO ${rto}초)"
}

case "${1:-ingest}" in
  ingest) ingest ;;
  record-restore) record_restore "$@" ;;
  *)
    echo "사용: bash infra/backup/vault-ingest.sh [ingest | record-restore <epoch> <초>]" >&2
    exit 2
    ;;
esac
