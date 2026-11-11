-- AI 검색이 코드 없는 조건("책 읽기 좋은 곳")을 장소 페르소나와 견주도록 만족한 손님 페르소나의 벡터를 내준다(ai/docs/comparison/spec.md 4.2, 4.3).
-- 근거 리뷰 3개 이상인 페르소나만 적재되므로(V6 place_personas 주석) 여기서는 만족한 손님(liked)만 고른다. 장소 프로필이 없는 장소는 검색에서 빠지므로(ai_place_search) 같이 뺀다.
-- AI 읽기 전용 role은 infra/data/grant-ai-read.sh가 SELECT를 준다. 이 뷰가 쓰는 place_personas·places 컬럼의 이름이나 타입을 바꾸려면 같은 마이그레이션에서 뷰를 지우고 다시 만든다
CREATE VIEW ai_place_personas AS
SELECT pe.place_id, p.category_group, pe.vector
FROM place_personas pe
JOIN places p ON p.place_id = pe.place_id
JOIN place_profiles pp ON pp.place_id = pe.place_id
WHERE pe.liked;
COMMENT ON VIEW ai_place_personas IS 'AI 검색이 읽는 만족한 손님 페르소나. 페르소나마다 한 행(장소 id, 업종, 벡터). AI가 코드 없는 조건 문구와 견줘 후보를 더 뽑고(페르소나 경로) 페르소나 항목 점수를 낸다';
