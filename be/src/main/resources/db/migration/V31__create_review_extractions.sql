-- 앱 리뷰 본문 추출 결과(taste-profile spec 2단계 "본문 추출"). 04:00 취향 갱신 배치가 새 리뷰와 고친 리뷰의 본문을
-- AI 추출 API로 읽어 리뷰마다 한 행을 둔다. 취향 갱신은 이유 태그와 이 결과를 함께 근거로 센다.
-- profile-storage D-6의 "앱 리뷰 추출 결과는 저장하지 않는다"를 바꾼다. 저장하지 않으면 매일 모든 리뷰를 다시 추출해야 한다.
-- 지운 리뷰(soft delete)의 결과는 남기되 근거로 읽지 않고, 리뷰 행이 지워지면 함께 지운다.
CREATE TABLE review_extractions (
    review_id bigint CONSTRAINT pk_review_extractions PRIMARY KEY
        CONSTRAINT fk_review_extractions_review REFERENCES reviews(review_id) ON DELETE CASCADE,
    items jsonb NOT NULL CONSTRAINT ck_review_extractions_items CHECK (jsonb_typeof(items) = 'array'),
    model text NOT NULL,
    prompt_version integer NOT NULL,
    extracted_at timestamptz NOT NULL
);
COMMENT ON TABLE review_extractions IS '앱 리뷰 본문 추출 결과. 리뷰 하나에 행 하나. 04:00 취향 갱신 배치가 채운다';
COMMENT ON COLUMN review_extractions.items IS '추출 항목 [{slot, quote, code, direction, liked, kind, text}]. code는 코드표 코드 또는 null, liked는 맛 코드만(1, -1, null), kind는 taste·facility·quality·budget. 특징이 없는 리뷰는 []';
COMMENT ON COLUMN review_extractions.model IS '추출한 LLM. AI API가 알려 준 값';
COMMENT ON COLUMN review_extractions.prompt_version IS '추출 프롬프트 버전. 프롬프트가 바뀌면 옛 버전 결과를 다시 추출할 수 있게 둔다';
COMMENT ON COLUMN review_extractions.extracted_at IS '추출하려고 리뷰를 읽은 시각(DB 시각). 리뷰 updated_at이 이보다 늦으면 다시 추출한다';
