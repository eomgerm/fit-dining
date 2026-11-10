-- Preserve legacy security evidence while moving new events to account login auditing.
ALTER TABLE auth_security_events ADD COLUMN user_id text;
ALTER TABLE auth_security_events ALTER COLUMN family_id DROP NOT NULL;
ALTER TABLE auth_security_events DROP CONSTRAINT auth_security_events_type_check;
ALTER TABLE auth_security_events ADD CONSTRAINT auth_security_events_type_check
    CHECK (type IN ('REFRESH_REUSE', 'ATTACK_DETECTED', 'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT', 'SESSIONS_REVOKED'));
CREATE INDEX auth_security_events_user_id_idx ON auth_security_events(user_id);
-- Keep auth_refresh_tokens for the 192 deployment and rollback window.
