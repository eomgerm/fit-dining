ALTER TABLE auth_users
    ADD COLUMN contact_email varchar(254),
    ADD COLUMN contact_email_verified_at timestamptz,
    ADD COLUMN marketing_agreed_at timestamptz,
    ADD CONSTRAINT auth_users_contact_email_lower CHECK (contact_email = lower(contact_email));

UPDATE auth_users SET contact_email = email, contact_email_verified_at = email_verified_at
WHERE email IS NOT NULL AND deleted_at IS NULL;
