ALTER TABLE user_preferences
    ADD COLUMN features jsonb NOT NULL DEFAULT '[]' CONSTRAINT ck_user_preferences_features CHECK (jsonb_typeof(features) = 'array');
COMMENT ON COLUMN user_preferences.tastes IS '온보딩 원본 칩. [{polarity, label, code, vector}]. code는 코드표 코드 또는 null, vector는 code가 null이고 LIKE인 칩만(그 외 null)';
COMMENT ON COLUMN user_preferences.features IS '취향 프로필(taste-profile/v0) 계산 결과. [{code, layer, like, weight}], weight는 1~3. 온보딩 때 만들고 04:00 배치가 원본과 앱 리뷰로 다시 계산한다. 온보딩 때 AI 호출이 실패하면 []로 두고 04:00 배치가 채운다';

CREATE TABLE places (
    place_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL,
    category_group text NOT NULL CONSTRAINT ck_places_category_group CHECK (category_group IN ('RESTAURANT', 'CAFE', 'BAR')),
    food_type text CONSTRAINT ck_places_food_type CHECK (food_type IN ('FOOD_KOREAN', 'FOOD_CHINESE', 'FOOD_JAPANESE', 'FOOD_WESTERN', 'FOOD_ASIAN')),
    summary_text text NOT NULL,
    summary_vector vector(1024) NOT NULL,
    features jsonb NOT NULL DEFAULT '[]' CONSTRAINT ck_places_features CHECK (jsonb_typeof(features) = 'array'),
    analyzed_review_count integer NOT NULL CONSTRAINT ck_places_analyzed_review_count CHECK (analyzed_review_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE places IS '장소. 최소 구성이며 나머지 수집 컬럼은 장소 수집 담당이 더한다. 분석 컬럼(place-profile/v0)은 릴리즈 전에 네이버 리뷰로 한 번 채우고, 이후 04:00 배치가 앱 리뷰로만 갱신한다. 네이버 장소 ID, 리뷰 원문, 리뷰별 추출 결과는 저장하지 않는다';
COMMENT ON COLUMN places.place_id IS '서비스 자체 장소 ID';
COMMENT ON COLUMN places.category_group IS '업종 그룹. is_label 업종 그룹 평균의 단위';
COMMENT ON COLUMN places.food_type IS '음식 종류 코드. 네이버 업종 코드로 정한다. 카페·술집·뷔페·처음 보는 코드는 null';
COMMENT ON COLUMN places.summary_text IS '장소 요약 문장. 이름, 업종, 메뉴, 시설, 가까운 역. 가격 제외';
COMMENT ON COLUMN places.summary_vector IS '장소 요약 임베딩(문서 인코딩, L2 정규화)';
COMMENT ON COLUMN places.features IS '근거가 있는 특징만. [{code, layer, like_count, dislike_count, is_label}], 카드 노출 순서로 정렬. is_label은 PRD의 태그 라벨 여부(40 출력의 label)';
COMMENT ON COLUMN places.analyzed_review_count IS '분석한 리뷰 수(화면의 리뷰 수 아님). 첫 값은 네이버 리뷰 수, 이후 앱 리뷰만큼 더하고 뺀다. is_label 업종 그룹 평균 조건(40 제안)의 분모이며 이 조건이 빠지면 삭제';

CREATE TABLE place_personas (
    place_id bigint NOT NULL CONSTRAINT fk_place_personas_place_id REFERENCES places(place_id) ON DELETE CASCADE,
    persona_id text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    reason text NOT NULL,
    liked boolean NOT NULL,
    review_ids bigint[] NOT NULL DEFAULT '{}',
    vector vector(1024) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (place_id, persona_id)
);
COMMENT ON TABLE place_personas IS '장소 페르소나. 이 장소를 좋아하거나 아쉬워할 손님 설명. 근거 리뷰 3개 이상인 페르소나만 넣는다. 벡터 인덱스는 41이 거리 연산자를 정한 뒤 만든다';
COMMENT ON COLUMN place_personas.persona_id IS '장소 안 페르소나 번호(p1, p2 …)';
COMMENT ON COLUMN place_personas.name IS '페르소나 이름(2~4단어)';
COMMENT ON COLUMN place_personas.description IS '어떤 손님인지 3문장';
COMMENT ON COLUMN place_personas.reason IS '좋아하거나 아쉬워하는 이유 3문장. 추천 이유로 화면에 노출되며 리뷰 원문 인용 금지';
COMMENT ON COLUMN place_personas.liked IS '만족한 손님이면 true, 아쉬워한 손님이면 false(40 출력의 like. like는 SQL 예약어)';
COMMENT ON COLUMN place_personas.review_ids IS '근거 앱 리뷰 ID(reviews.review_id). 처음엔 비어 있고 04:00 배치가 앱 리뷰 추가·삭제에 따라 넣고 뺀다. 네이버 근거는 저장하지 않는다';
COMMENT ON COLUMN place_personas.vector IS '이름. 설명. 이유를 이어 붙인 문장의 임베딩(문서 인코딩)';
