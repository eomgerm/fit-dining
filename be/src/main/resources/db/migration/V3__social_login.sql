ALTER TABLE auth_users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE auth_users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE auth_users ADD CONSTRAINT auth_users_credentials_pair CHECK ((email IS NULL) = (password_hash IS NULL));
CREATE TABLE auth_social_accounts (
 provider text NOT NULL CHECK (provider IN ('google','kakao','naver')),
 provider_user_id text NOT NULL,
 user_id text NOT NULL UNIQUE REFERENCES auth_users(id),
 created_at timestamptz NOT NULL,
 PRIMARY KEY (provider, provider_user_id)
);
