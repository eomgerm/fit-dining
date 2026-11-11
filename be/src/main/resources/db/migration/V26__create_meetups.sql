-- 모임 추천(meetup spec D-5). 테이블은 넷이고 자식 행은 모임 행을 지우면 따라 지워진다(D-6).
-- 회원 FK는 따라 지우지 않는다. 탈퇴는 회원 행을 지우지 않고 서비스가 모임을 정리한다(D-23).
-- 장소 id에는 FK를 걸지 않는다. 장소 Mock 모드의 장소는 장소 테이블에 없다(D-11).

CREATE TABLE meetups (
    meetup_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code varchar(22) NOT NULL CONSTRAINT uk_meetups_code UNIQUE
        CONSTRAINT ck_meetups_code CHECK (code ~ '^[A-Za-z0-9_-]{22}$'),
    host_user_id text NOT NULL CONSTRAINT fk_meetups_host_user_id REFERENCES auth_users(id),
    phase text NOT NULL CONSTRAINT ck_meetups_phase CHECK (phase IN ('WAITING', 'RESULT', 'VOTING', 'DECIDED')),
    area_kind text NOT NULL CONSTRAINT ck_meetups_area_kind CHECK (area_kind IN ('STATION', 'DONG', 'POINT')),
    area_name text,
    point_lat double precision,
    point_lng double precision,
    radius_m integer CONSTRAINT ck_meetups_radius_m CHECK (radius_m IN (500, 1000, 2000, 5000)),
    category text NOT NULL CONSTRAINT ck_meetups_category CHECK (category IN ('RESTAURANT', 'CAFE', 'BAR', 'ANY')),
    meet_date date,
    meet_time time,
    headcount integer CONSTRAINT ck_meetups_headcount CHECK (headcount BETWEEN 2 AND 8),
    description varchar(100),
    parsed_conditions jsonb,
    poll_state text CONSTRAINT ck_meetups_poll_state CHECK (poll_state IN ('OPEN', 'CLOSED')),
    poll_anonymous boolean,
    poll_place_ids bigint[],
    poll_tie_votes integer,
    decided_place_id bigint,
    decided_how text CONSTRAINT ck_meetups_decided_how CHECK (decided_how IN ('VOTE', 'PICK', 'DIRECT')),
    decided_at timestamptz,
    expires_at timestamptz NOT NULL,
    info_updated_at timestamptz NOT NULL,
    CONSTRAINT ck_meetups_area CHECK (
        (area_kind = 'POINT' AND point_lat IS NOT NULL AND point_lng IS NOT NULL AND radius_m IS NOT NULL)
        OR (area_kind <> 'POINT' AND area_name IS NOT NULL AND point_lat IS NULL AND point_lng IS NULL
            AND radius_m IS NULL)),
    CONSTRAINT ck_meetups_meet_time CHECK (meet_time IS NULL OR meet_date IS NOT NULL),
    CONSTRAINT ck_meetups_poll CHECK (poll_state IS NULL OR (poll_anonymous IS NOT NULL AND poll_place_ids IS NOT NULL)),
    CONSTRAINT ck_meetups_decision CHECK ((decided_place_id IS NULL) = (decided_how IS NULL)
        AND (decided_place_id IS NULL) = (decided_at IS NULL))
);
CREATE INDEX idx_meetups_host_user_id ON meetups(host_user_id);
CREATE INDEX idx_meetups_expires_at ON meetups(expires_at);
COMMENT ON COLUMN meetups.expires_at IS '모임을 지울 시각. 모임 날짜(없으면 만든 날) + 8일 0시 KST';
COMMENT ON COLUMN meetups.poll_state IS '투표 상태. 한 번 열면 비우지 않는다(D-5)';
COMMENT ON COLUMN meetups.poll_tie_votes IS '동점으로 마감했을 때 고정한 표 수. 다시 열면 비운다(D-5)';

-- 프로필은 색(0~7)이 모임 안에서 유일해 모임당 8개를 넘지 않는다(D-4).
-- 이름은 앞뒤 공백을 지우고 NFC로 정규화해 저장하고, 그 값 그대로 겹침을 본다(D-5).
CREATE TABLE meetup_profiles (
    profile_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    meetup_id bigint NOT NULL CONSTRAINT fk_meetup_profiles_meetup_id REFERENCES meetups(meetup_id) ON DELETE CASCADE,
    name varchar(10) NOT NULL,
    color integer NOT NULL CONSTRAINT ck_meetup_profiles_color CHECK (color BETWEEN 0 AND 7),
    user_id text CONSTRAINT fk_meetup_profiles_user_id REFERENCES auth_users(id),
    mood text CONSTRAINT ck_meetup_profiles_mood CHECK (mood IN ('QUIET', 'LIVELY', 'ANY')),
    like_foods text[],
    avoid_foods text[],
    no_spicy boolean,
    -- 범위(시작값)는 코드 상수와 요청 검증이 본다(D-5)
    price_cap integer CONSTRAINT ck_meetup_profiles_price_cap CHECK (price_cap > 0),
    want_menu varchar(20),
    taste_updated_at timestamptz NOT NULL,
    vote_place_id bigint,
    vote_session_id bigint,
    CONSTRAINT uk_meetup_profiles_name UNIQUE (meetup_id, name),
    CONSTRAINT uk_meetup_profiles_color UNIQUE (meetup_id, color),
    CONSTRAINT uk_meetup_profiles_user_id UNIQUE (meetup_id, user_id)
);
CREATE INDEX idx_meetup_profiles_user_id ON meetup_profiles(user_id) WHERE user_id IS NOT NULL;

CREATE TABLE meetup_profile_sessions (
    session_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    profile_id bigint NOT NULL
        CONSTRAINT fk_meetup_profile_sessions_profile_id REFERENCES meetup_profiles(profile_id) ON DELETE CASCADE,
    token_hash bytea NOT NULL CONSTRAINT uk_meetup_profile_sessions_token_hash UNIQUE
        CONSTRAINT ck_meetup_profile_sessions_token_hash CHECK (octet_length(token_hash) = 32)
);
CREATE INDEX idx_meetup_profile_sessions_profile_id ON meetup_profile_sessions(profile_id);
COMMENT ON COLUMN meetup_profile_sessions.token_hash IS '모임 쿠키 값의 SHA-256. 쿠키 값은 저장하지 않는다(D-7)';

-- 회원이 로그인으로 던진 표는 세션이 없다. 세션 행이 지워지면 비운다(D-5).
ALTER TABLE meetup_profiles ADD CONSTRAINT fk_meetup_profiles_vote_session_id
    FOREIGN KEY (vote_session_id) REFERENCES meetup_profile_sessions(session_id) ON DELETE SET NULL;

-- 계산 행은 마지막 성공 하나와 그 뒤의 실행 중이거나 실패한 하나까지만 남긴다(D-5, D-10).
CREATE TABLE meetup_calculations (
    calc_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    meetup_id bigint NOT NULL
        CONSTRAINT fk_meetup_calculations_meetup_id REFERENCES meetups(meetup_id) ON DELETE CASCADE,
    state text NOT NULL CONSTRAINT ck_meetup_calculations_state CHECK (state IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
    started_at timestamptz NOT NULL,
    finished_at timestamptz,
    taste_count integer NOT NULL CONSTRAINT ck_meetup_calculations_taste_count CHECK (taste_count BETWEEN 0 AND 8),
    profile_ids bigint[] NOT NULL,
    result jsonb,
    applied jsonb,
    empty_reason jsonb
);
CREATE INDEX idx_meetup_calculations_meetup_id ON meetup_calculations(meetup_id);
CREATE UNIQUE INDEX uk_meetup_calculations_running ON meetup_calculations(meetup_id) WHERE state = 'RUNNING';
