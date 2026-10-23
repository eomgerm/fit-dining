CREATE TABLE auth_users (
    id text PRIMARY KEY,
    username varchar(100) NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL
);
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
    created_at timestamptz NOT NULL
);
CREATE INDEX auth_login_attempts_address_created_at_idx ON auth_login_attempts(address, created_at);
