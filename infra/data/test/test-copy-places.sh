#!/usr/bin/env bash
# copy-places.sh를 노트북에서 시험한다. 실제 Postgres(pgvector)에 BE의 Flyway 마이그레이션(V1~V14, R__)으로 fit_dev와 fit_prod 스키마를 만들고
# 비정형 값(따옴표·줄바꿈·배열·jsonb·1024차원 벡터)과 ID 공백이 있는 장소 데이터를 넣은 뒤, 복사가 정확하고 안전한지 본다.
#   bash infra/data/test/test-copy-places.sh
# 필요한 것: docker. 컨테이너 하나(fit-copytest-postgres)를 띄우고 끝나면 지운다.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
case "$(uname -s)" in
  MINGW* | MSYS*) export MSYS_NO_PATHCONV=1 ;;
esac
# shellcheck source=infra/ci/tool-images.sh
. infra/ci/tool-images.sh

PROJECT=fit-copytest
C=fit-copytest-postgres
export FIT_DATA_PROJECT="$PROJECT"
MIGRATIONS=be/src/main/resources/db/migration
TABLES="places place_profiles place_personas place_hours place_menus place_photos place_subways place_bus_stops place_seats place_broadcasts"

cleanup() { docker rm -f "$C" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

FAILED=0
out=""
rc=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); if [ -n "$out" ]; then printf '%s\n' "$out" | tail -n 8 | sed 's/^/FAIL  > /'; fi; }
ok_if() { if [ "$2" = 1 ]; then pass "$1"; else fail "$1"; fi; }
is() { if [ "$1" = "$2" ]; then echo 1; else echo 0; fi; }
has() { case "$1" in *"$2"*) echo 1 ;; *) echo 0 ;; esac; }

# sql DB 'SQL' → 결과(psql -At)
sql() { printf '%s' "$2" | docker exec -i "$C" psql -U postgres -d "$1" -v ON_ERROR_STOP=1 -qAt; }
run_copy() { out="$(bash infra/data/copy-places.sh "$@" 2>&1)" && rc=0 || rc=$?; }
count() { sql "$1" "SELECT count(*) FROM $2"; }
sum() { sql "$1" "SELECT md5(coalesce(string_agg(t::text, E'\n' ORDER BY t::text), '')) FROM $2 t"; }
# 코드표는 마이그레이션이 넣는다. created_at·updated_at은 적용한 시각이라 환경마다 다르므로 빼고 비교한다
fc_sum() { sql "$1" "SELECT md5(string_agg(code || '|' || layer || '|' || phrase || '|' || vector::text, E'
' ORDER BY code)) FROM feature_codes"; }
# 원본의 번호표 마지막 값이 최댓값보다 큰가(8개 테이블 모두). 아니면 번호표 보정이 없어도 결과가 같아서 보정을 시험하지 못한다
seq_ahead() {
  local spec t c ok=1
  for spec in places:place_id place_hours:place_hour_id place_menus:place_menu_id place_photos:place_photo_id place_subways:place_subway_id place_bus_stops:place_bus_stop_id place_seats:place_seat_id place_broadcasts:place_broadcast_id; do
    t="${spec%%:*}"
    c="${spec##*:}"
    [ "$(sql fit_dev "SELECT pg_sequence_last_value(pg_get_serial_sequence('$t', '$c')::regclass) > (SELECT max($c) FROM $t)")" = t ] || ok=0
  done
  echo "$ok"
}
counts_of() { local t r=""; for t in $TABLES; do r="$r$(count "$1" "$t"),"; done; printf '%s' "$r"; }
sums_of() { local t r=""; for t in $TABLES; do r="$r$(sum "$1" "$t")"; done; printf '%s' "$r" | md5sum | cut -c1-32; }

echo "=== 시험용 Postgres와 스키마(실제 마이그레이션)"
docker run -d --name "$C" --label "com.docker.compose.project=$PROJECT" --label "com.docker.compose.service=postgres" \
  -e POSTGRES_HOST_AUTH_METHOD=trust "$PGVECTOR_IMAGE" >/dev/null
until docker exec "$C" pg_isready -U postgres -q 2>/dev/null; do sleep 1; done
sleep 2
for db in fit_dev fit_prod; do
  sql postgres "CREATE DATABASE $db" >/dev/null
  sql "$db" "CREATE EXTENSION vector" >/dev/null
  for f in $(printf '%s
' "$MIGRATIONS"/V*.sql | sort -V) "$MIGRATIONS"/R__*.sql; do
    docker exec -i "$C" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -q <"$f" >/dev/null 2>&1 || { echo "FAIL 마이그레이션 적용 실패: $db $f" >&2; exit 1; }
  done
done

echo "=== fit_dev에 시험 데이터"
sql fit_dev "
INSERT INTO places (naver_place_id, name, category_group, food_type, station, lat, lng, address, facilities, keywords, extra_links, parking_free, menu_updated_on)
SELECT 'np' || g, '장소' || g, (ARRAY['RESTAURANT','CAFE','BAR'])[1 + g % 3],
       CASE WHEN g % 3 = 0 THEN 'FOOD_KOREAN' END, (ARRAY['GANGNAM','YEOKSAM','SEOLLEUNG'])[1 + g % 3],
       37.5 + g / 1000.0, 127.0 + g / 1000.0, '서울 강남구 ' || g, ARRAY['주차','예약'], ARRAY['조용한','회식'], ARRAY['https://a.example/' || g],
       g % 2 = 0, DATE '2026-10-01' + g
FROM generate_series(1, 25) g;
UPDATE places SET name = E'따옴표 \\' \" 와 역슬래시 \\\\ 줄바꿈\n탭\t끝', description = E'소개\n둘째 줄 (한글)' WHERE place_id = 5;
INSERT INTO place_hours (place_id, day_of_week, open_time, close_time, closed, breaks, last_orders)
SELECT p, d, '11:00', '22:00', false, '[{\"start\":\"15:00\",\"end\":\"17:00\"}]', ARRAY['21:00'::time] FROM generate_series(1, 25) p, unnest(ARRAY['MON','TUE','WED']) d;
INSERT INTO place_menus (place_id, sort_order, category, name, price, price_text, price_type, representative, labels, photo_urls)
SELECT p, s, '대표', '메뉴' || p || '-' || s, 10000 + s, '10,000원', 'FIXED', s = 0, ARRAY['사전예약'], ARRAY['https://img.example/' || p || '/' || s] FROM generate_series(1, 25) p, generate_series(0, 2) s;
INSERT INTO place_photos (place_id, source, sort_order, url) SELECT p, 'business', s, 'https://img.example/b/' || p || '/' || s FROM generate_series(1, 25) p, generate_series(0, 1) s;
INSERT INTO place_subways (place_id, station, line, exit, walk_minutes, walk_meters) SELECT p, '강남', '2', '1번', 3, 200 FROM generate_series(1, 25) p;
INSERT INTO place_bus_stops (place_id, name, code, walk_minutes, walk_meters) SELECT p, '정류장' || p, '1234', 2, 100 FROM generate_series(1, 25) p;
INSERT INTO place_seats (place_id, name, description) SELECT p, '테라스', '야외' FROM generate_series(1, 25) p;
INSERT INTO place_broadcasts (place_id, channel, program, episode, aired_on, menu) SELECT p, 'TV', '프로그램', '1회', DATE '2025-01-01', '메뉴' FROM generate_series(1, 4) p;
INSERT INTO place_profiles (place_id, summary_text, summary_vector, features, analyzed_review_count)
SELECT p, '요약 ' || p, (SELECT array_agg(random()::real) FROM generate_series(1, 1024))::vector, '[{\"code\":\"QUIET\",\"like\":true,\"weight\":2}]', 10 + p FROM generate_series(1, 25) p;
INSERT INTO place_personas (place_id, persona_id, name, description, reason, liked, review_ids, vector)
SELECT p, 'P1', '페르소나', '설명', '이유', true, ARRAY[1,2,3]::bigint[], (SELECT array_agg(random()::real) FROM generate_series(1, 1024))::vector FROM generate_series(1, 25) p;
DELETE FROM places WHERE place_id IN (3, 7, 24);   -- ID에 공백이 있어도 복사 뒤 다음 번호가 겹치지 않아야 한다
-- 맨 끝에 행을 넣었다가 지운다. 원본의 번호표(마지막 값)가 최댓값보다 앞선 상태가 되어도 복사 뒤 새 번호는 최댓값 바로 다음이어야 한다
INSERT INTO places (naver_place_id, name, category_group, station, lat, lng) VALUES ('np-tail', '끝', 'CAFE', 'GANGNAM', 37.5, 127.0);
INSERT INTO place_hours (place_id, day_of_week, closed) SELECT place_id, 'SUN', true FROM places WHERE naver_place_id = 'np-tail';
INSERT INTO place_menus (place_id, sort_order, name) SELECT place_id, 0, 'm' FROM places WHERE naver_place_id = 'np-tail';
INSERT INTO place_photos (place_id, source, sort_order, url) SELECT place_id, 'business', 0, 'u' FROM places WHERE naver_place_id = 'np-tail';
INSERT INTO place_subways (place_id, station) SELECT place_id, 's' FROM places WHERE naver_place_id = 'np-tail';
INSERT INTO place_bus_stops (place_id, name) SELECT place_id, 'b' FROM places WHERE naver_place_id = 'np-tail';
INSERT INTO place_seats (place_id, name) SELECT place_id, 'x' FROM places WHERE naver_place_id = 'np-tail';
INSERT INTO place_broadcasts (place_id) SELECT place_id FROM places WHERE naver_place_id = 'np-tail';
DELETE FROM places WHERE naver_place_id = 'np-tail';
" >/dev/null
SRC_PLACES="$(count fit_dev places)"
SRC_SUM="$(sums_of fit_dev)"
ok_if "시험 데이터가 있다(장소 22곳, ID 공백 3개)" "$(is "$SRC_PLACES" 22)"
ok_if "원본의 번호표(마지막 값)가 최댓값보다 앞서 있다(8개 테이블 모두)" "$(seq_ahead)"
ok_if "원본의 장소 테이블 10개에 모두 행이 있다" "$(is "$(counts_of fit_dev | tr ',' '\n' | grep -c '^0$' || true)" 0)"
EMPTY_PROD="$(counts_of fit_prod)"

echo "=== 입력 검사"
run_copy
ok_if "인자가 없으면 사용법을 알리고 실패한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '사용:')" = 1 ] && echo 1 || echo 0)"
run_copy dev dev
ok_if "원본과 대상이 같으면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '사용:')" = 1 ] && echo 1 || echo 0)"
run_copy dev staging
ok_if "모르는 환경 이름은 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '사용:')" = 1 ] && echo 1 || echo 0)"
run_copy dev prod --bogus
ok_if "모르는 옵션은 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '사용:')" = 1 ] && echo 1 || echo 0)"

echo "=== 점검만(쓰지 않는다)"
run_copy dev prod
ok_if "옵션 없이 돌리면 점검만 하고 성공한다" "$([ "$rc" = 0 ] && [ "$(has "$out" '점검 통과(쓰지 않았다)')" = 1 ] && echo 1 || echo 0)"
ok_if "점검만 한 뒤 prod는 그대로 비어 있다" "$(is "$(counts_of fit_prod)" "$EMPTY_PROD")"

echo "=== 안전 장치(복사 전에 막는다)"
sql fit_prod "ALTER TABLE places ADD COLUMN extra_col integer" >/dev/null
run_copy dev prod --apply
ok_if "열 구성이 다르면(마이그레이션 수준이 다르면) 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '스키마가 다르다')" = 1 ] && echo 1 || echo 0)"
ok_if "거부된 뒤 prod는 그대로 비어 있다" "$(is "$(counts_of fit_prod)" "$EMPTY_PROD")"
sql fit_prod "ALTER TABLE places DROP COLUMN extra_col" >/dev/null
sql fit_prod "ALTER TABLE place_seats RENAME TO place_seats_x" >/dev/null
run_copy dev prod --apply
ok_if "대상에 테이블이 없으면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '테이블이 없다')" = 1 ] && echo 1 || echo 0)"
sql fit_prod "ALTER TABLE place_seats_x RENAME TO place_seats" >/dev/null

echo "=== 복사 도중 실패하면 통째로 되돌린다(원자성)"
sql fit_prod "ALTER TABLE place_seats ADD CONSTRAINT ck_test_fail CHECK (false)" >/dev/null
run_copy dev prod --apply
ok_if "복사 도중(place_seats 제약 위반)에 실패하면 복사가 실패로 끝난다" "$([ "$rc" != 0 ] && [ "$(has "$out" ck_test_fail)" = 1 ] && echo 1 || echo 0)"
ok_if "그래도 prod에는 아무 행도 남지 않는다(앞서 복사된 장소까지 되돌려진다)" "$(is "$(counts_of fit_prod)" "$EMPTY_PROD")"
sql fit_prod "ALTER TABLE place_seats DROP CONSTRAINT ck_test_fail" >/dev/null

echo "=== 복사"
FC_BEFORE="$(fc_sum fit_prod)"
run_copy dev prod --apply
ok_if "복사가 성공한다" "$([ "$rc" = 0 ] && [ "$(has "$out" '복사를 마쳤다')" = 1 ] && echo 1 || echo 0)"
ok_if "테이블 10개의 행 수가 원본과 같다" "$(is "$(counts_of fit_prod)" "$(counts_of fit_dev)")"
ok_if "모든 값이 원본과 같다(따옴표·줄바꿈·배열·jsonb·벡터 포함)" "$(is "$(sums_of fit_prod)" "$(sums_of fit_dev)")"
ok_if "특수 문자가 든 장소 이름이 그대로다" "$(is "$(sql fit_prod "SELECT name FROM places WHERE place_id = 5")" "$(sql fit_dev "SELECT name FROM places WHERE place_id = 5")")"
ok_if "AI가 읽는 뷰(ai_place_search)의 행 수가 같다" "$(is "$(count fit_prod ai_place_search)" "$(count fit_dev ai_place_search)")"
ok_if "코드표(feature_codes)는 복사 전후로 바뀌지 않고 원본과 같다(마이그레이션 값)" "$([ -n "$FC_BEFORE" ] && [ "$(fc_sum fit_prod)" = "$FC_BEFORE" ] && [ "$FC_BEFORE" = "$(fc_sum fit_dev)" ] && echo 1 || echo 0)"
# 새 행의 번호가 복사된 최댓값 바로 다음이어야 한다. 최댓값이 없으면(복사가 안 됐으면) 실패다. 빈 테이블이면 새 번호가 1이라 우연히 맞는 일을 막는다
seq_ok() { # seq_ok 테이블 번호열 "(열) VALUES (값)"
  local mx new
  mx="$(sql fit_prod "SELECT max($2) FROM $1")"
  case "$mx" in '' | *[!0-9]*) echo 0; return ;; esac
  new="$(sql fit_prod "INSERT INTO $1 $3 RETURNING $2" | head -n 1)"
  is "$new" "$((mx + 1))"
}
ok_if "복사 뒤 새 장소가 복사된 최댓값 다음 번호를 받는다(places)" "$(seq_ok places place_id "(naver_place_id, name, category_group, station, lat, lng) VALUES ('np-new', '새 장소', 'CAFE', 'GANGNAM', 37.5, 127.0)")"
ok_if "place_hours도 복사된 최댓값 다음 번호를 받는다" "$(seq_ok place_hours place_hour_id "(place_id, day_of_week, closed) VALUES (1, 'SUN', true)")"
ok_if "place_menus도 복사된 최댓값 다음 번호를 받는다" "$(seq_ok place_menus place_menu_id "(place_id, sort_order, name) VALUES (1, 99, 'm')")"
ok_if "place_photos도 복사된 최댓값 다음 번호를 받는다" "$(seq_ok place_photos place_photo_id "(place_id, source, sort_order, url) VALUES (1, 'business', 99, 'u')")"
ok_if "place_subways도 복사된 최댓값 다음 번호를 받는다" "$(seq_ok place_subways place_subway_id "(place_id, station) VALUES (1, 's')")"
ok_if "place_bus_stops도 복사된 최댓값 다음 번호를 받는다" "$(seq_ok place_bus_stops place_bus_stop_id "(place_id, name) VALUES (1, 'b')")"
ok_if "place_seats도 복사된 최댓값 다음 번호를 받는다" "$(seq_ok place_seats place_seat_id "(place_id, name) VALUES (1, 'x')")"
ok_if "place_broadcasts도 복사된 최댓값 다음 번호를 받는다" "$(seq_ok place_broadcasts place_broadcast_id "(place_id) VALUES (1)")"
ok_if "원본(fit_dev)은 바뀌지 않았다(10개 테이블의 모든 값)" "$(is "$(sums_of fit_dev)" "$SRC_SUM")"

echo "=== 대상에 이미 데이터가 있으면 거부한다"
BEFORE="$(sums_of fit_prod)"
run_copy dev prod --apply
ok_if "다시 돌리면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '비어 있지 않다')" = 1 ] && echo 1 || echo 0)"
ok_if "거부된 뒤 prod 값은 그대로다" "$(is "$(sums_of fit_prod)" "$BEFORE")"

echo "=== 원본이 비어 있으면 거부한다"
sql fit_prod "TRUNCATE places RESTART IDENTITY CASCADE" >/dev/null
sql fit_dev "TRUNCATE places RESTART IDENTITY CASCADE" >/dev/null
run_copy dev prod --apply
ok_if "원본에 장소가 없으면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '원본에 장소가 없다')" = 1 ] && echo 1 || echo 0)"

echo
if [ "$FAILED" = 0 ]; then echo "copy-places 시험 통과"; else echo "$FAILED개 실패"; exit 1; fi
