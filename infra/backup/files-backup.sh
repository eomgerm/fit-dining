#!/usr/bin/env bash
# 사진과 Caddy 인증서 볼륨을 백업한다(설계 8절 7번). 사진은 하루 1회, 인증서 볼륨은 주 1회(timer)다.
#   bash infra/backup/files-backup.sh photos|caddy
# 결과는 pg와 같다: $FIT_BACKUP_DIR/<종류>/<종류>-<UTC 시각>.tar.age(+ .meta)이고 같은 파일이 outbox/에도 놓인다.
# photos: fit-prod-photos 버킷 전체를 S3 API로 읽어 tar로 묶는다(infra/data/s3tool.py tar-stdout). dev 버킷은 백업하지 않는다.
# caddy: Caddy 데이터 볼륨(<FIT_EDGE_PROJECT>_caddy_data)을 읽기 전용으로 tar로 묶는다. 인증서는 다시 발급되지만 발급 한도에 걸릴 때를 위한 사본이다.
set -euo pipefail
# shellcheck source=infra/backup/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

KIND="${1:-}"
case "$KIND" in
  photos | caddy) ;;
  *)
    echo "사용: bash infra/backup/files-backup.sh photos|caddy" >&2
    exit 2
    ;;
esac

load_backup_env
require_recipients
acquire_lock "files-$KIND"
umask 077
mkdir -p "$BACKUP_DIR/$KIND" "$BACKUP_DIR/outbox" "$BACKUP_DIR/state"
OUT="$BACKUP_DIR/$KIND/$KIND-$(backup_ts).tar.age"
trap 'rm -f "$OUT.part"; release_lock' EXIT

case "$KIND" in
  photos)
    load_data_env
    log "fit-prod-photos 버킷을 묶는다"
    s3run "$S3_PROD_ACCESS_KEY" "$S3_PROD_SECRET_KEY" tar-stdout fit-prod-photos '' | age -R "$RECIPIENTS" -o "$OUT.part"
    ;;
  caddy)
    VOLUME="${EDGE_PROJECT}_caddy_data"
    docker volume inspect "$VOLUME" >/dev/null 2>&1 || die "볼륨 $VOLUME이 없다"
    log "$VOLUME 볼륨을 묶는다"
    docker run --rm -v "$VOLUME:/d:ro" "$PYTHON_IMAGE" tar -C /d -c . | age -R "$RECIPIENTS" -o "$OUT.part"
    ;;
esac

[ -s "$OUT.part" ] || die "백업 파일이 비었다"
mv "$OUT.part" "$OUT"
write_meta "$OUT" "$KIND"
ln -f "$OUT" "$BACKUP_DIR/outbox/$(basename "$OUT")"
ln -f "$OUT.meta" "$BACKUP_DIR/outbox/$(basename "$OUT").meta"
state_set "$KIND.last_success" "$(date +%s)"
prune_dir "$BACKUP_DIR/$KIND" "$KIND"
render_backup_metrics
log "백업 완료: $(basename "$OUT") ($(meta_get "$OUT.meta" size) 바이트)"
