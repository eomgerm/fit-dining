#!/usr/bin/env bash
# 한 환경의 장소 데이터(장소 테이블 10개)를 다른 환경으로 한 번 복사한다. 첫 공개 때 dev의 장소를 prod로 옮기는 데 쓴다(prod DB는 마이그레이션 직후 비어 있다).
#   bash infra/data/copy-places.sh dev prod            # 점검만 한다(아무것도 쓰지 않는다)
#   bash infra/data/copy-places.sh dev prod --apply    # 복사한다
# 복사하는 것: places, place_profiles(요약 벡터), place_personas(페르소나 벡터), place_hours, place_menus, place_photos, place_subways,
#   place_bus_stops, place_seats, place_broadcasts. 복사하지 않는 것: 북마크, 리뷰, 사용자 데이터, 코드표(feature_codes는 마이그레이션이 넣는다).
#   사진은 외부 원본 URL이라 따로 옮길 객체가 없다. 벡터는 같은 모델로 만든 값이라 그대로 쓴다(AI가 prod에서 다시 계산하지 않는다).
# 복사 전에 막는 것: 원본과 대상 DB의 장소 테이블이 모두 있는지, 열 구성(마이그레이션 수준)이 같은지, 원본에 장소가 있는지, 대상 테이블 10개가 모두 비어 있는지.
#   대상에 데이터가 있으면 거부한다(덮어쓰지 않는다). 다시 하려면 사람이 대상 데이터를 확인하고 지운 뒤에 한다.
# 복사와 번호표(identity 시퀀스) 보정은 한 트랜잭션이라 도중에 실패하면 대상은 그대로다. 끝난 뒤 행 수, 값 해시, 번호표, AI 뷰의 행 수를 다시 대조한다.
#   시험(test/test-copy-places.sh, 변이 검사 10개 중 9개를 잡는다)이 확인하지 못하는 것: 행 수와 값 해시 대조가 어긋났을 때 알리는 부분(어긋남을 만들 방법이 없다). 마지막 안전망이다.
set -euo pipefail
# shellcheck source=infra/data/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

TABLES="places place_profiles place_personas place_hours place_menus place_photos place_subways place_bus_stops place_seats place_broadcasts"
# 번호표가 있는 테이블:번호 열. place_profiles와 place_personas는 place_id가 키라 번호표가 없다
IDENTITY="places:place_id place_hours:place_hour_id place_menus:place_menu_id place_photos:place_photo_id place_subways:place_subway_id place_bus_stops:place_bus_stop_id place_seats:place_seat_id place_broadcasts:place_broadcast_id"

usage() { die "사용: bash infra/data/copy-places.sh <dev|prod> <dev|prod> [--apply]  (원본 대상. 서로 달라야 한다)"; }

FROM="${1:-}"
TO="${2:-}"
APPLY=0
case "$FROM" in dev | prod) ;; *) usage ;; esac
case "$TO" in dev | prod) ;; *) usage ;; esac
[ "$FROM" != "$TO" ] || usage
case "${3:-}" in '') ;; --apply) APPLY=1 ;; *) usage ;; esac
[ "$#" -le 3 ] || usage
SRC="fit_$FROM"
DST="fit_$TO"

q() { psql_admin -d "$1" -c "$2"; } # q DB SQL → 결과 한 값
# 열 구성 지문: 열 이름, 타입, NOT NULL, identity를 열 이름순으로. 열 순서는 COPY가 열 이름을 적으므로 상관없다
schema_sig() { # schema_sig DB 테이블
  q "$1" "SELECT string_agg(attname || ' ' || format_type(atttypid, atttypmod) || CASE WHEN attnotnull THEN ' NOT NULL' ELSE '' END || CASE WHEN attidentity::text <> '' THEN ' identity=' || attidentity::text ELSE '' END, ', ' ORDER BY attname) FROM pg_attribute WHERE attrelid = 'public.$2'::regclass AND attnum > 0 AND NOT attisdropped"
}
rows() { q "$1" "SELECT count(*) FROM public.$2"; }
hash_of() { q "$1" "SELECT md5(coalesce(string_agg(t::text, E'\n' ORDER BY t::text), '')) FROM public.$2 t"; }

log "원본 $SRC → 대상 $DST ($([ "$APPLY" = 1 ] && echo 복사 || echo 점검만))"

# 1) 테이블이 모두 있는가
for db in "$SRC" "$DST"; do
  missing=""
  for t in $TABLES; do
    [ "$(q "$db" "SELECT to_regclass('public.$t') IS NOT NULL")" = t ] || missing="$missing $t"
  done
  [ -z "$missing" ] || die "$db에 테이블이 없다:$missing (마이그레이션이 끝났는지 본다)"
done

# 2) 열 구성이 같은가
for t in $TABLES; do
  a="$(schema_sig "$SRC" "$t")"
  b="$(schema_sig "$DST" "$t")"
  [ "$a" = "$b" ] || die "$t 스키마가 다르다(두 DB의 마이그레이션 수준이 다르다). 원본: $a / 대상: $b"
done
log "테이블 10개가 모두 있고 열 구성이 같다"

# 3) 원본에 장소가 있는가, 대상이 비어 있는가
SRC_PLACES="$(rows "$SRC" places)"
[ "$SRC_PLACES" -gt 0 ] || die "원본에 장소가 없다($SRC.places 0행)"
nonempty=""
for t in $TABLES; do
  n="$(rows "$DST" "$t")"
  [ "$n" = 0 ] || nonempty="$nonempty $t=${n}행"
done
[ -z "$nonempty" ] || die "대상이 비어 있지 않다:$nonempty (덮어쓰지 않는다. 다시 하려면 사람이 대상 데이터를 확인하고 지운 뒤에 한다)"

log "원본의 행 수:"
for t in $TABLES; do printf '    %-16s %s\n' "$t" "$(rows "$SRC" "$t")"; done

if [ "$APPLY" = 0 ]; then
  log "점검 통과(쓰지 않았다). 복사하려면 같은 명령에 --apply를 붙인다"
  exit 0
fi

# 4) 복사: 덤프를 컨테이너 안 임시 파일에 받고(pg_dump가 실패하면 여기서 멈춘다), 번호표 보정을 덧붙여 한 트랜잭션으로 넣는다
seq_sql=""
for pair in $IDENTITY; do
  t="${pair%%:*}"
  c="${pair##*:}"
  seq_sql="$seq_sql
SELECT pg_catalog.setval(pg_catalog.pg_get_serial_sequence('public.$t', '$c'), COALESCE((SELECT max($c) FROM public.$t), 1), (SELECT max($c) IS NOT NULL FROM public.$t));"
done
tflags=""
for t in $TABLES; do tflags="$tflags -t public.$t"; done

read -r -d '' INNER <<'EOF' || true
set -euo pipefail
src="$1"; dst="$2"; shift 2
f="$(mktemp)"
trap 'rm -f "$f"' EXIT
pg_dump -U postgres -d "$src" --data-only --no-owner "$@" >"$f"
printf '%s\n' "$SEQ_SQL" >>"$f"
psql -U postgres -d "$dst" -v ON_ERROR_STOP=1 -q --single-transaction -f "$f" >/dev/null
EOF
ctr="$(require_container postgres)"
log "복사하는 중(한 트랜잭션)"
# shellcheck disable=SC2086
docker exec -e "SEQ_SQL=$seq_sql" "$ctr" bash -c "$INNER" _ "$SRC" "$DST" $tflags || die "복사에 실패했다. 한 트랜잭션이라 대상 $DST는 그대로다"

# 5) 대조
bad=""
for t in $TABLES; do
  [ "$(rows "$SRC" "$t")" = "$(rows "$DST" "$t")" ] || bad="$bad $t(행 수)"
  [ "$(hash_of "$SRC" "$t")" = "$(hash_of "$DST" "$t")" ] || bad="$bad $t(값)"
done
for pair in $IDENTITY; do
  t="${pair%%:*}"
  c="${pair##*:}"
  [ "$(q "$DST" "SELECT coalesce(pg_sequence_last_value(pg_get_serial_sequence('public.$t', '$c')::regclass), 0) >= coalesce((SELECT max($c) FROM public.$t), 0)")" = t ] || bad="$bad $t(번호표)"
done
if [ "$(q "$SRC" "SELECT to_regclass('public.ai_place_search') IS NOT NULL")" = t ] && [ "$(q "$DST" "SELECT to_regclass('public.ai_place_search') IS NOT NULL")" = t ]; then
  [ "$(rows "$SRC" ai_place_search)" = "$(rows "$DST" ai_place_search)" ] || bad="$bad ai_place_search(행 수)"
fi
[ -z "$bad" ] || die "복사한 뒤 대조에서 어긋났다:$bad. 데이터는 이미 들어갔다. 사람이 대상 $DST를 확인한다(복사 스크립트로는 되돌리지 않는다)"

log "복사를 마쳤다: 장소 ${SRC_PLACES}곳과 딸린 데이터 9개 테이블. 행 수, 값 해시, 번호표, AI 뷰의 행 수가 원본과 같다"
log "다음: AI가 prod 장소를 읽는지 본다(grant는 배포가 맞춘다). 이 스크립트는 한 번만 쓴다"
