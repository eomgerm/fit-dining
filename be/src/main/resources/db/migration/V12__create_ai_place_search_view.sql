-- AI 검색이 읽는 장소 뷰(place-ai-search D-15). AI 계정은 이 뷰와 user_preferences만 읽는다(infra/data/grant-ai-read.sh).
-- 모양은 지금 AI 코드(ai/src/fit_ai/match/pg_store.py)가 읽는 모양이다. AI가 BE 컬럼을 그대로 읽게 바뀌면 다시 만든다.
-- 이 뷰가 쓰는 places·place_profiles 컬럼의 이름이나 타입을 바꾸려면 같은 마이그레이션에서 뷰를 지우고 다시 만든다
CREATE VIEW ai_place_search AS
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
       pp.summary_vector
FROM places p
JOIN place_profiles pp ON pp.place_id = p.place_id;
