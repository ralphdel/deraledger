-- Migration 023: complete the canonical merchant Settings/Profile/Verification
-- column contract omitted from the clean-production migration chain.
--
-- Canonical sources include supabase_migration_trading_name.sql,
-- verification_status_migration.sql, supabase/20260514_phase2_migration.sql,
-- supabase/20260514_kyc_references_collections.sql,
-- supabase/20260527_onboarding_verification_upgrade_flow.sql,
-- supabase/20260608_add_verification_step_state.sql, and the Merchant runtime
-- contract in src/lib/types.ts.
--
-- The additions are nullable and have no defaults. Existing historical
-- canonical columns with safe defaults are accepted without being rewritten.
-- No merchant rows, verification decisions, or setup/live flags are changed.

BEGIN;

SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

DO $$
DECLARE
  v_expected record;
  v_actual_type text;
  v_not_null boolean;
  v_default text;
BEGIN
  IF to_regclass('public.merchants') IS NULL THEN
    RAISE EXCEPTION 'Migration 023 prerequisite missing: public.merchants';
  END IF;

  IF (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.merchants')) <> 'r' THEN
    RAISE EXCEPTION 'Migration 023 prerequisite incompatible: public.merchants is not an ordinary table';
  END IF;

  FOR v_expected IN
    SELECT *
    FROM (VALUES
      ('trading_name', 'text', false, ARRAY['<NULL>']::text[]),
      ('owner_name', 'text', false, ARRAY['<NULL>']::text[]),
      ('platform_version', 'integer', false, ARRAY['<NULL>', '0', '0::integer', '''0''::integer']::text[]),
      ('cac_number', 'text', false, ARRAY['<NULL>']::text[]),
      ('bvn', 'text', false, ARRAY['<NULL>']::text[]),
      ('cac_document_url', 'text', false, ARRAY['<NULL>']::text[]),
      ('utility_document_url', 'text', false, ARRAY['<NULL>']::text[]),
      ('cac_status', 'text', false, ARRAY['<NULL>', '''unverified''::text']::text[]),
      ('utility_status', 'text', false, ARRAY['<NULL>', '''unverified''::text']::text[]),
      ('bvn_status', 'text', false, ARRAY['<NULL>', '''unverified''::text']::text[]),
      ('selfie_url', 'text', false, ARRAY['<NULL>']::text[]),
      ('selfie_status', 'text', true, ARRAY['<NULL>', '''unverified''::text']::text[]),
      ('dojah_reference', 'text', false, ARRAY['<NULL>']::text[]),
      ('dojah_match_score', 'numeric(5,2)', false, ARRAY['<NULL>']::text[]),
      ('kyc_attempt_count', 'integer', true, ARRAY['<NULL>', '0', '0::integer', '''0''::integer']::text[]),
      ('kyc_last_attempt_at', 'timestamp with time zone', false, ARRAY['<NULL>']::text[]),
      ('kyc_provider_metadata', 'jsonb', true, ARRAY['<NULL>', '''{}''::jsonb']::text[]),
      ('kyc_locked_until', 'timestamp with time zone', false, ARRAY['<NULL>']::text[]),
      ('kyc_rejection_reason', 'text', false, ARRAY['<NULL>']::text[]),
      ('kyc_reviewed_at', 'timestamp with time zone', false, ARRAY['<NULL>']::text[]),
      ('kyc_reset_at', 'timestamp with time zone', false, ARRAY['<NULL>']::text[]),
      ('verification_step_state', 'jsonb', true, ARRAY['<NULL>', '''{}''::jsonb']::text[]),
      ('business_registry_snapshot_id', 'uuid', false, ARRAY['<NULL>']::text[]),
      ('business_affiliation_status', 'text', false, ARRAY['<NULL>', '''not_started''::text']::text[]),
      ('settlement_bank_name', 'text', false, ARRAY['<NULL>']::text[]),
      ('settlement_account_number', 'text', false, ARRAY['<NULL>']::text[]),
      ('settlement_account_name', 'text', false, ARRAY['<NULL>']::text[])
    ) AS expected(column_name, formatted_type, allow_not_null, allowed_defaults)
  LOOP
    SELECT
      format_type(attribute.atttypid, attribute.atttypmod),
      attribute.attnotnull,
      pg_get_expr(default_value.adbin, default_value.adrelid, true)
    INTO v_actual_type, v_not_null, v_default
    FROM pg_attribute attribute
    LEFT JOIN pg_attrdef default_value
      ON default_value.adrelid = attribute.attrelid
     AND default_value.adnum = attribute.attnum
    WHERE attribute.attrelid = to_regclass('public.merchants')
      AND attribute.attname = v_expected.column_name
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF v_actual_type <> v_expected.formatted_type THEN
      RAISE EXCEPTION
        'Migration 023 compatibility failure: public.merchants.% expected type %, actual %',
        v_expected.column_name,
        v_expected.formatted_type,
        v_actual_type;
    END IF;

    IF v_not_null AND NOT v_expected.allow_not_null THEN
      RAISE EXCEPTION
        'Migration 023 compatibility failure: public.merchants.% must remain nullable',
        v_expected.column_name;
    END IF;

    IF v_not_null AND v_default IS NULL THEN
      RAISE EXCEPTION
        'Migration 023 compatibility failure: public.merchants.% is NOT NULL without a safe default',
        v_expected.column_name;
    END IF;

    IF NOT (COALESCE(v_default, '<NULL>') = ANY (v_expected.allowed_defaults)) THEN
      RAISE EXCEPTION
        'Migration 023 compatibility failure: public.merchants.% has unsafe default %',
        v_expected.column_name,
        COALESCE(v_default, '<NULL>');
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS trading_name text,
  ADD COLUMN IF NOT EXISTS owner_name text,
  ADD COLUMN IF NOT EXISTS platform_version integer,
  ADD COLUMN IF NOT EXISTS cac_number text,
  ADD COLUMN IF NOT EXISTS bvn text,
  ADD COLUMN IF NOT EXISTS cac_document_url text,
  ADD COLUMN IF NOT EXISTS utility_document_url text,
  ADD COLUMN IF NOT EXISTS cac_status text,
  ADD COLUMN IF NOT EXISTS utility_status text,
  ADD COLUMN IF NOT EXISTS bvn_status text,
  ADD COLUMN IF NOT EXISTS selfie_url text,
  ADD COLUMN IF NOT EXISTS selfie_status text,
  ADD COLUMN IF NOT EXISTS dojah_reference text,
  ADD COLUMN IF NOT EXISTS dojah_match_score numeric(5,2),
  ADD COLUMN IF NOT EXISTS kyc_attempt_count integer,
  ADD COLUMN IF NOT EXISTS kyc_last_attempt_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS kyc_provider_metadata jsonb,
  ADD COLUMN IF NOT EXISTS kyc_locked_until timestamp with time zone,
  ADD COLUMN IF NOT EXISTS kyc_rejection_reason text,
  ADD COLUMN IF NOT EXISTS kyc_reviewed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS kyc_reset_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS verification_step_state jsonb,
  ADD COLUMN IF NOT EXISTS business_registry_snapshot_id uuid,
  ADD COLUMN IF NOT EXISTS business_affiliation_status text,
  ADD COLUMN IF NOT EXISTS settlement_bank_name text,
  ADD COLUMN IF NOT EXISTS settlement_account_number text,
  ADD COLUMN IF NOT EXISTS settlement_account_name text;

DO $$
DECLARE
  v_expected record;
  v_actual_type text;
  v_not_null boolean;
  v_default text;
BEGIN
  FOR v_expected IN
    SELECT *
    FROM (VALUES
      ('trading_name', 'text', false, ARRAY['<NULL>']::text[]),
      ('owner_name', 'text', false, ARRAY['<NULL>']::text[]),
      ('platform_version', 'integer', false, ARRAY['<NULL>', '0', '0::integer', '''0''::integer']::text[]),
      ('cac_number', 'text', false, ARRAY['<NULL>']::text[]),
      ('bvn', 'text', false, ARRAY['<NULL>']::text[]),
      ('cac_document_url', 'text', false, ARRAY['<NULL>']::text[]),
      ('utility_document_url', 'text', false, ARRAY['<NULL>']::text[]),
      ('cac_status', 'text', false, ARRAY['<NULL>', '''unverified''::text']::text[]),
      ('utility_status', 'text', false, ARRAY['<NULL>', '''unverified''::text']::text[]),
      ('bvn_status', 'text', false, ARRAY['<NULL>', '''unverified''::text']::text[]),
      ('selfie_url', 'text', false, ARRAY['<NULL>']::text[]),
      ('selfie_status', 'text', true, ARRAY['<NULL>', '''unverified''::text']::text[]),
      ('dojah_reference', 'text', false, ARRAY['<NULL>']::text[]),
      ('dojah_match_score', 'numeric(5,2)', false, ARRAY['<NULL>']::text[]),
      ('kyc_attempt_count', 'integer', true, ARRAY['<NULL>', '0', '0::integer', '''0''::integer']::text[]),
      ('kyc_last_attempt_at', 'timestamp with time zone', false, ARRAY['<NULL>']::text[]),
      ('kyc_provider_metadata', 'jsonb', true, ARRAY['<NULL>', '''{}''::jsonb']::text[]),
      ('kyc_locked_until', 'timestamp with time zone', false, ARRAY['<NULL>']::text[]),
      ('kyc_rejection_reason', 'text', false, ARRAY['<NULL>']::text[]),
      ('kyc_reviewed_at', 'timestamp with time zone', false, ARRAY['<NULL>']::text[]),
      ('kyc_reset_at', 'timestamp with time zone', false, ARRAY['<NULL>']::text[]),
      ('verification_step_state', 'jsonb', true, ARRAY['<NULL>', '''{}''::jsonb']::text[]),
      ('business_registry_snapshot_id', 'uuid', false, ARRAY['<NULL>']::text[]),
      ('business_affiliation_status', 'text', false, ARRAY['<NULL>', '''not_started''::text']::text[]),
      ('settlement_bank_name', 'text', false, ARRAY['<NULL>']::text[]),
      ('settlement_account_number', 'text', false, ARRAY['<NULL>']::text[]),
      ('settlement_account_name', 'text', false, ARRAY['<NULL>']::text[])
    ) AS expected(column_name, formatted_type, allow_not_null, allowed_defaults)
  LOOP
    SELECT
      format_type(attribute.atttypid, attribute.atttypmod),
      attribute.attnotnull,
      pg_get_expr(default_value.adbin, default_value.adrelid, true)
    INTO v_actual_type, v_not_null, v_default
    FROM pg_attribute attribute
    LEFT JOIN pg_attrdef default_value
      ON default_value.adrelid = attribute.attrelid
     AND default_value.adnum = attribute.attnum
    WHERE attribute.attrelid = to_regclass('public.merchants')
      AND attribute.attname = v_expected.column_name
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped;

    IF NOT FOUND
       OR v_actual_type <> v_expected.formatted_type
       OR (v_not_null AND NOT v_expected.allow_not_null)
       OR (v_not_null AND v_default IS NULL)
       OR NOT (COALESCE(v_default, '<NULL>') = ANY (v_expected.allowed_defaults)) THEN
      RAISE EXCEPTION
        'Migration 023 postcondition failure: public.merchants.% is missing or incompatible',
        v_expected.column_name;
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
