CREATE TABLE auth_users (
    id text PRIMARY KEY,
    email varchar(254) NOT NULL UNIQUE CHECK (email = lower(email)),
    nickname varchar(15) NOT NULL CHECK (char_length(nickname) BETWEEN 2 AND 15),
    age_confirmed_at timestamptz NOT NULL,
    terms_agreed_at timestamptz NOT NULL,
    privacy_agreed_at timestamptz NOT NULL,
    terms_version text NOT NULL,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX auth_users_nickname_idx ON auth_users(lower(nickname));
CREATE TABLE auth_refresh_tokens (
    jti text PRIMARY KEY,
    family_id text NOT NULL,
    user_id text NOT NULL REFERENCES auth_users(id),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
    used_at timestamptz,
    revoked_at timestamptz,
    revoke_reason text
);
CREATE INDEX auth_refresh_tokens_family_id_idx ON auth_refresh_tokens(family_id);
CREATE INDEX auth_refresh_tokens_expires_at_idx ON auth_refresh_tokens(expires_at);
CREATE TABLE auth_security_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    family_id text NOT NULL,
    created_at timestamptz NOT NULL,
    type text NOT NULL CHECK (type IN ('REFRESH_REUSE', 'ATTACK_DETECTED')),
    reuse_count integer NOT NULL CHECK (reuse_count >= 0)
);
CREATE INDEX auth_security_events_family_id_idx ON auth_security_events(family_id);
CREATE INDEX auth_security_events_created_at_idx ON auth_security_events(created_at);
CREATE TABLE auth_login_attempts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    address text NOT NULL,
    action text NOT NULL CHECK (action IN ('login','signup')),
    created_at timestamptz NOT NULL
);
CREATE INDEX auth_login_attempts_address_action_created_at_idx ON auth_login_attempts(address, action, created_at);
