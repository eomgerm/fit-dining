-- 회원의 검색 기록(thread)과 그 요청(turn). thread id와 turn id는 FE가 만든다(search-thread D-3, D-17).
-- id 비교와 정렬이 collation에 흔들리지 않게 C로 둔다
CREATE TABLE search_threads (
    user_id text NOT NULL CONSTRAINT fk_search_threads_user_id REFERENCES auth_users(id) ON DELETE CASCADE,
    thread_id text COLLATE "C" NOT NULL,
    -- thread를 만든 turn의 질문. 바뀌지 않는다
    title text NOT NULL,
    -- 서버 순서가 가장 늦은 turn의 요청 시각(가장 큰 값이 아니다)
    last_requested_at timestamptz NOT NULL,
    turn_count integer NOT NULL CONSTRAINT ck_search_threads_turn_count CHECK (turn_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_search_threads PRIMARY KEY (user_id, thread_id)
);
CREATE INDEX idx_search_threads_user_id_last_requested_at_thread_id
    ON search_threads(user_id, last_requested_at DESC, thread_id DESC);

CREATE TABLE search_thread_turns (
    user_id text NOT NULL,
    thread_id text COLLATE "C" NOT NULL,
    turn_id text COLLATE "C" NOT NULL,
    -- 서버가 처음 저장할 때 thread를 잠근 채 매긴 순서. 1부터
    seq integer NOT NULL CONSTRAINT ck_search_thread_turns_seq CHECK (seq > 0),
    kind text NOT NULL CONSTRAINT ck_search_thread_turns_kind CHECK (kind IN ('new', 'followUp', 'region')),
    base_turn_id text COLLATE "C",
    -- FE가 첫 페이지를 받아 기록한 기기 시각(at)
    requested_at timestamptz NOT NULL,
    request jsonb NOT NULL,
    response jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_search_thread_turns PRIMARY KEY (user_id, thread_id, turn_id),
    CONSTRAINT uk_search_thread_turns_seq UNIQUE (user_id, thread_id, seq),
    CONSTRAINT fk_search_thread_turns_thread FOREIGN KEY (user_id, thread_id)
        REFERENCES search_threads(user_id, thread_id) ON DELETE CASCADE,
    -- 기준 turn은 같은 회원, 같은 thread의 turn이다. 없으면(new) 검사하지 않는다
    CONSTRAINT fk_search_thread_turns_base FOREIGN KEY (user_id, thread_id, base_turn_id)
        REFERENCES search_thread_turns(user_id, thread_id, turn_id),
    CONSTRAINT ck_search_thread_turns_base_not_self CHECK (base_turn_id <> turn_id),
    CONSTRAINT ck_search_thread_turns_base_by_kind CHECK ((kind = 'new') = (base_turn_id IS NULL))
);
