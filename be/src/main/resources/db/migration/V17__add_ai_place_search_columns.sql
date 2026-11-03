-- AI 검색 2차가 지역·영업시간·가격으로 거르고 메뉴·편의 정보로 판정하려고 읽는 컬럼을 뷰 뒤에 더한다(place-ai-search D-15).
-- CREATE OR REPLACE는 V12의 컬럼 이름·순서·타입이 같고 새 컬럼이 뒤에 붙을 때만 된다. 뷰를 지우지 않으므로 AI 계정의 SELECT 권한이 남는다.
-- 이 뷰가 쓰는 places·place_profiles·place_subways·place_hours·place_menus 컬럼의 이름이나 타입을 바꾸려면 같은 마이그레이션에서 뷰를 지우고 다시 만든다
CREATE OR REPLACE VIEW ai_place_search AS
SELECT p.place_id, p.category_group, p.station, p.lat, p.lng,
       -- 네이버 시설 이름을 AI 시설 코드로. 이름이 없는 코드는 "없음"이 아니라 "모름"이라 키를 두지 않는다
       jsonb_strip_nulls(jsonb_build_object(
           'PARKING',     CASE WHEN p.facilities && ARRAY['주차', '발렛파킹'] THEN true END,
           'WIFI',        CASE WHEN '무선 인터넷' = ANY(p.facilities) THEN true END,
           'GROUP',       CASE WHEN '단체 이용 가능' = ANY(p.facilities) THEN true END,
           'RESERVATION', CASE WHEN '예약' = ANY(p.facilities) THEN true END
       )) AS facilities,
       -- embedding은 DB에 없는 값이라 AI 인코더 상수(ai/src/fit_ai/embedding)를 적는다. 다르면 AI가 장소를 읽지 않는다
       jsonb_build_object(
           'schema', 'place-profile/v0',
           'summary', jsonb_build_object('text', pp.summary_text),
           'features', pp.features,
           'embedding', jsonb_build_object(
               'model', 'dragonkue/snowflake-arctic-embed-l-v2.0-ko',
               'revision', '55ec6e9358a56d56af759bc8372e970caf8c305f',
               'prompt', 'document')
       ) AS profile,
       pp.summary_vector,
       p.name, p.food_type, p.dong, p.district,
       -- 가까운 역. 원본 순서(PK 순서)다
       coalesce((
           SELECT jsonb_agg(jsonb_build_object(
                      'station', s.station, 'exit', s.exit, 'walk_minutes', s.walk_minutes)
                  ORDER BY s.place_subway_id)
           FROM place_subways s WHERE s.place_id = p.place_id), '[]') AS subways,
       -- 요일별 영업시간. 시각은 "HH:MM"이고 닫는 시각이 여는 시각 이하면 다음 날 닫는다(24:00은 적재 때 00:00, place-catalog D-10)
       coalesce((
           SELECT jsonb_agg(jsonb_build_object(
                      'day', h.day_of_week,
                      'open', to_char(h.open_time, 'HH24:MI'),
                      'close', to_char(h.close_time, 'HH24:MI'),
                      'closed', h.closed,
                      'breaks', h.breaks)
                  ORDER BY array_position(ARRAY['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], h.day_of_week))
           FROM place_hours h WHERE h.place_id = p.place_id), '[]') AS hours,
       -- 메뉴판. price는 정가일 때만 있다
       coalesce((
           SELECT jsonb_agg(jsonb_build_object(
                      'name', m.name, 'category', m.category, 'price', m.price, 'representative', m.representative)
                  ORDER BY m.sort_order)
           FROM place_menus m WHERE m.place_id = p.place_id), '[]') AS menus,
       p.pet_allowed, p.parking_free, p.corkage_allowed,
       -- 가게 가격. 네이버 리뷰 메뉴로 계산하는 값이라 장소 분석 적재가 채우기 전까지 모름(NULL)이다(place-catalog D-4)
       NULL::integer AS price
FROM places p
JOIN place_profiles pp ON pp.place_id = p.place_id;
