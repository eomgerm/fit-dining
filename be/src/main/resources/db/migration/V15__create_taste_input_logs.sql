-- 온보딩 직접 입력을 해석할 때마다 원문과 결과를 한 줄씩 남긴다(taste-profile "직접 입력 기록"). 해석 품질 확인과
-- 프롬프트를 바꾼 뒤 다시 해석하는 데 쓴다. 회원·비회원 모두 남기고, 누구의 입력인지 알 수 없게 회원 ID와 IP는 두지 않는다.
-- 90일이 지나면 AuthCleanup이 지운다
CREATE TABLE taste_input_logs (
    id bigint GENERATED ALWAYS AS IDENTITY CONSTRAINT pk_taste_input_logs PRIMARY KEY,
    text text NOT NULL,
    -- 해석된 칩 [{polarity, label, code}]. 해석에 실패하면 NULL
    tastes jsonb,
    -- 해석한 LLM. AI API가 알려 준 값이고 실패하면 NULL
    model text,
    succeeded boolean NOT NULL,
    created_at timestamptz NOT NULL,
    CONSTRAINT ck_taste_input_logs_tastes_by_succeeded CHECK (succeeded = (tastes IS NOT NULL))
);
CREATE INDEX idx_taste_input_logs_created_at ON taste_input_logs(created_at);
