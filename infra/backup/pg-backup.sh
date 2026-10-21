#!/usr/bin/env bash
# Postgres 덤프를 뜬다(설계 8절). 두 가지 모드가 있다.
#   bash infra/backup/pg-backup.sh scheduled            # 4시간마다(timer). 덤프 → 검증(하루 1회 이상) → age 암호화 → 보관 → 금고 전송 대기열
#   bash infra/backup/pg-backup.sh predeploy <환경> <sha>  # 배포 스크립트가 마이그레이션 전에 부른다. 평문 덤프를 A에만 둔다
# scheduled는 fit_prod를 덤프한다. 결과는 $FIT_BACKUP_DIR/pg/pg-<UTC 시각>.dump.age(+ .meta)이고 같은 파일이 outbox/에도 놓인다(push-vault.sh가 B로 보낸다).
# predeploy는 $FIT_PREDEPLOY_DIR(기본 /srv/fit/predeploy)/predeploy-<환경>-<sha>.dump 로 두고 환경별 최근 5개만 남긴다. 암호화하지 않는 이유는
# 개인키가 A에 없어서 급할 때 바로 복원할 수 없기 때문이다. 이 덤프는 A의 DB 볼륨과 같은 신뢰 범위에 있고 B로 보내지 않는다.
# 환경변수: FIT_VERIFY_EVERY_HOURS(24) 마지막 검증 뒤 이 시간이 지났으면 이번 덤프를 복원해 검증한다. FIT_BACKUP_DB(fit_prod).
set -euo pipefail
# shellcheck source=infra/backup/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

MODE="${1:-}"
PG_DB="${FIT_BACKUP_DB:-fit_prod}"
TMP_FILE=""
OUT_FILE=""

# dump_to 대상 DB 파일: 덤프를 파일로 뜨고 크기와 목차를 확인한다. 실패하면 중간 파일을 지운다
dump_to() {
  local db="$1" dest="$2" pg
  pg="$(require_container postgres)"
  docker exec "$pg" pg_dump -U postgres -Fc -d "$db" >"$dest" || {
    rm -f "$dest"
    die "pg_dump에 실패했다($db)"
  }
  [ -s "$dest" ] || {
    rm -f "$dest"
    die "덤프 파일이 비었다($db)"
  }
  docker exec -i "$pg" pg_restore -l <"$dest" >/dev/null || {
    rm -f "$dest"
    die "덤프의 목차를 읽을 수 없다($db)"
  }
}

table_count() { # table_count DB: public 스키마의 테이블 수
  psql_admin -d "$1" -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"
}

scheduled() {
  load_backup_env
  require_recipients
  acquire_lock pg
  umask 077
  mkdir -p "$BACKUP_DIR/pg" "$BACKUP_DIR/outbox" "$BACKUP_DIR/state"
  local ts tmp out tables now last
  ts="$(backup_ts)"
  tmp="$BACKUP_DIR/pg/.tmp-$ts.dump"
  out="$BACKUP_DIR/pg/pg-$ts.dump.age"
  tables="$(table_count "$PG_DB")"
  log "$PG_DB 덤프를 뜬다(테이블 $tables개)"
  TMP_FILE="$tmp"
  OUT_FILE="$out"
  trap 'rm -f "${TMP_FILE:-}" "${OUT_FILE:-}.part"; release_lock' EXIT
  dump_to "$PG_DB" "$tmp"

  now="$(date +%s)"
  last="$(state_get pg.last_verify)"
  if [ $((now - last)) -ge $((${FIT_VERIFY_EVERY_HOURS:-24} * 3600)) ]; then
    log "덤프를 임시 DB에 복원해 검증한다"
    if bash "$BACKUP_LIB_DIR/verify-dump.sh" "$tmp" --expect-tables "$tables"; then
      state_set pg.last_verify "$now"
      state_set pg.last_verify_ok 1
    else
      state_set pg.last_verify "$now"
      state_set pg.last_verify_ok 0
      mv "$tmp" "$BACKUP_DIR/pg/failed-verify-$ts.dump"
      render_backup_metrics
      die "덤프 검증에 실패했다. 이번 덤프는 보내지 않고 failed-verify-$ts.dump 로 남겼다"
    fi
  fi

  age_encrypt "$tmp" "$out"
  write_meta "$out" pg
  rm -f "$tmp"
  mkdir -p "$BACKUP_DIR/outbox"
  ln -f "$out" "$BACKUP_DIR/outbox/$(basename "$out")"
  ln -f "$out.meta" "$BACKUP_DIR/outbox/$(basename "$out").meta"
  state_set pg.last_success "$(date +%s)"
  prune_dir "$BACKUP_DIR/pg" pg
  render_backup_metrics
  log "백업 완료: $(basename "$out") ($(meta_get "$out.meta" size) 바이트)"
}

predeploy() {
  local env="${2:-}" sha="${3:-}" dir dest keep=5 f
  case "$env" in prod | dev) ;; *) die "사용: pg-backup.sh predeploy <prod|dev> <sha>" ;; esac
  [[ "$sha" =~ ^[0-9a-f]{7,40}$ ]] || die "sha 형식이 틀렸다: $sha"
  dir="$PREDEPLOY_DIR"
  mkdir -p "$dir"
  umask 027
  dest="$dir/predeploy-$env-$sha.dump"
  log "fit_$env를 배포 전에 덤프한다"
  dump_to "fit_$env" "$dest.part"
  mv "$dest.part" "$dest"
  # 환경별 최근 keep개만 남긴다(수정 시각 순)
  while IFS= read -r f; do
    rm -f -- "$f"
  done < <(find "$dir" -maxdepth 1 -type f -name "predeploy-$env-*.dump" -printf '%T@ %p\n' | sort -rn | tail -n +$((keep + 1)) | cut -d' ' -f2-)
  log "사전 덤프 완료: $(basename "$dest")"
}

case "$MODE" in
  scheduled) scheduled ;;
  predeploy) predeploy "$@" ;;
  *)
    echo "사용: bash infra/backup/pg-backup.sh scheduled | predeploy <prod|dev> <sha>" >&2
    exit 2
    ;;
esac
