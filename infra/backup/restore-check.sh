#!/usr/bin/env bash
# 복원 리허설(설계 8절 5번). 사람이 노트북(Docker Desktop)에서 B의 백업 사본을 복호화하고 복원해 보고 걸린 시간(RTO)을 잰다.
#   bash infra/backup/restore-check.sh -i <개인키 파일> [--fetch-seconds N] [--allow-empty] [--sql '<조회문>'] [--record <ssh 대상>] <백업 파일.age>
# pg-*.dump.age는 임시 Postgres 컨테이너에 복원하고 테이블 수를 확인한다. photos-*, caddy-*(.tar.age)는 복호화해 목록을 확인한다.
# --fetch-seconds는 B에서 내려받는 데 걸린 시간이다(RTO에 더한다). --record user@host를 주면 그 서버에서 `sudo vault-ingest.sh record-restore`로
# 결과를 기록해 지표(fit_vault_last_restore_check_*)로 보이게 한다. 개인키는 수신자가 오프라인으로 보관하는 파일이고 서버에는 없다.
# 필요한 것: docker, age(https://github.com/FiloSottile/age), 이 저장소.
set -euo pipefail
# shellcheck source=infra/backup/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

IDENTITY="" FETCH=0 ALLOW_EMPTY="" RECORD="" FILE="" SQL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --sql)
      SQL="${2:-}"
      shift 2
      ;;
    -i)
      IDENTITY="${2:-}"
      shift 2
      ;;
    --fetch-seconds)
      FETCH="${2:-}"
      shift 2
      ;;
    --allow-empty)
      ALLOW_EMPTY="--allow-empty"
      shift
      ;;
    --record)
      RECORD="${2:-}"
      shift 2
      ;;
    -*)
      die "알 수 없는 옵션: $1"
      ;;
    *)
      FILE="$1"
      shift
      ;;
  esac
done
[ -n "$FILE" ] && [ -s "$FILE" ] || die "사용: restore-check.sh -i <개인키> [옵션] <백업 파일.age>"
[ -n "$IDENTITY" ] && [ -s "$IDENTITY" ] || die "개인키 파일(-i)이 필요하다"
[[ "$FETCH" =~ ^[0-9]+$ ]] || die "--fetch-seconds에는 숫자를 준다"
command -v age >/dev/null 2>&1 || die "age가 없다(https://github.com/FiloSottile/age 에서 설치한다)"
command -v docker >/dev/null 2>&1 || die "docker가 없다(Docker Desktop을 켠다)"

NAME="$(basename "$FILE")"
backup_name_ok "$NAME" || die "백업 파일 이름 형식이 아니다: $NAME"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
START="$(date +%s)"

log "복호화한다: $NAME"
age -d -i "$IDENTITY" -o "$WORK/plain" "$FILE" || die "복호화에 실패했다(개인키가 수신자 중 하나가 아니다)"

case "$NAME" in
  pg-*)
    log "임시 Postgres에 복원한다"
    bash "$BACKUP_LIB_DIR/verify-dump.sh" "$WORK/plain" ${ALLOW_EMPTY:+"$ALLOW_EMPTY"} ${SQL:+--sql "$SQL"} | tail -n 4
    ;;
  *)
    entries="$(tar -tf "$WORK/plain" | wc -l | tr -d ' ')"
    log "tar 목록을 읽었다(항목 $entries개)"
    ;;
esac

END="$(date +%s)"
RTO=$((END - START + FETCH))
echo "RTO: ${RTO}초 (내려받기 ${FETCH}초 + 복호화·복원 $((END - START))초). 목표는 7200초(2시간)다"
if [ -n "$RECORD" ]; then
  [[ "$RECORD" =~ ^[A-Za-z0-9._@-]+$ ]] || die "--record 대상 형식이 틀렸다"
  # END와 RTO는 위에서 만든 숫자라 클라이언트에서 펼쳐도 안전하다
  # shellcheck disable=SC2029
  ssh -t "$RECORD" "sudo /usr/local/lib/fit/repo/infra/backup/vault-ingest.sh record-restore $END $RTO"
else
  echo "B에 기록하려면 B에서: sudo /usr/local/lib/fit/repo/infra/backup/vault-ingest.sh record-restore $END $RTO"
fi
