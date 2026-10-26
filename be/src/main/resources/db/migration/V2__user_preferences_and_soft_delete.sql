ALTER TABLE auth_users ADD COLUMN deleted_at timestamptz;
ALTER TABLE auth_users ADD CONSTRAINT auth_users_deleted_after_created CHECK (deleted_at IS NULL OR deleted_at >= created_at);
ALTER TABLE auth_users DROP CONSTRAINT auth_users_email_key;
CREATE UNIQUE INDEX auth_users_email_active_idx ON auth_users(email) WHERE deleted_at IS NULL;
DROP INDEX auth_users_nickname_idx;
CREATE UNIQUE INDEX auth_users_nickname_active_idx ON auth_users(lower(nickname)) WHERE deleted_at IS NULL;
CREATE TABLE user_preferences (
    user_id text PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
    mood text CHECK (mood IN ('QUIET', 'LIVELY')),
    priorities text[] NOT NULL DEFAULT '{}',
    purposes text[] NOT NULL DEFAULT '{}',
    tastes jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(tastes) = 'array'),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
