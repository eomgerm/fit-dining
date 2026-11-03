-- 이메일 가입 전 소유 확인(S15P31A302-157). 인증번호와 인증 토큰은 원문 없이 해시만 저장한다.
CREATE TABLE auth_email_verifications (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email varchar(254) NOT NULL CHECK (email = lower(email)),
    code_hash text NOT NULL,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    verified_at timestamptz,
    token_hash text UNIQUE,
    token_expires_at timestamptz,
    consumed_at timestamptz,
    CONSTRAINT auth_email_verifications_token_pair CHECK ((token_hash IS NULL) = (token_expires_at IS NULL)),
    CONSTRAINT auth_email_verifications_token_after_verify CHECK (token_hash IS NULL OR verified_at IS NOT NULL),
    CONSTRAINT auth_email_verifications_consumed_after_token CHECK (consumed_at IS NULL OR token_hash IS NOT NULL)
);
CREATE INDEX auth_email_verifications_email_created_at_idx ON auth_email_verifications(email, created_at);
CREATE INDEX auth_email_verifications_created_at_idx ON auth_email_verifications(created_at);

-- 기존 가입자는 인증 없이 그대로 둔다(D4). NULL은 확인하지 않은 이메일이라는 표시일 뿐 기능을 막지 않는다.
ALTER TABLE auth_users ADD COLUMN email_verified_at timestamptz;

ALTER TABLE auth_login_attempts DROP CONSTRAINT auth_login_attempts_action_check;
ALTER TABLE auth_login_attempts ADD CONSTRAINT auth_login_attempts_action_check
    CHECK (action IN ('login', 'signup', 'verify_send', 'verify_confirm'));
