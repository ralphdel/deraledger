\set ON_ERROR_STOP on
-- Disposable parity with 20260728000000_authorization_hardening.sql.
-- B1's narrow bootstrap predates the durable DB-backed reviewer flag.
ALTER TABLE public.merchants
  ADD COLUMN is_super_admin boolean NOT NULL DEFAULT false;
-- Model the real auth metadata field solely to prove that it grants no authority.
ALTER TABLE auth.users ADD COLUMN raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $assert_b2_prerequisite$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.merchants'::regclass AND attname = 'is_super_admin'
      AND atttypid = 'boolean'::regtype AND attnotnull AND NOT attisdropped
  ) THEN RAISE EXCEPTION 'B2_REVIEWER_AUTHORITY_PREREQUISITE_MISSING'; END IF;
END;
$assert_b2_prerequisite$;
