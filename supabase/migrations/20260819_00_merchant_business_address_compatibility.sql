-- Migration 022: add the canonical merchant business-address fields used by
-- the paid-plan Business Profile gate and settings form.
-- Canonical source: business_address_migration.sql (historical root SQL).
-- This migration is additive only and does not update existing merchant rows.

BEGIN;

SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

DO $$
DECLARE
  v_column text;
  v_actual_type text;
  v_not_null boolean;
  v_default text;
BEGIN
  IF to_regclass('public.merchants') IS NULL THEN
    RAISE EXCEPTION 'Migration 022 prerequisite missing: public.merchants';
  END IF;

  IF (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.merchants')) <> 'r' THEN
    RAISE EXCEPTION 'Migration 022 prerequisite incompatible: public.merchants is not an ordinary table';
  END IF;

  FOREACH v_column IN ARRAY ARRAY[
    'business_street',
    'business_city',
    'business_state',
    'business_country'
  ]
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
      AND attribute.attname = v_column
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped;

    IF FOUND AND (
      v_actual_type <> 'text'
      OR v_not_null
      OR v_default IS NOT NULL
    ) THEN
      RAISE EXCEPTION
        'Migration 022 compatibility failure: public.merchants.% expected nullable text without a default; actual type=%, not_null=%, default=%',
        v_column,
        v_actual_type,
        v_not_null,
        COALESCE(v_default, '<NULL>');
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS business_street text,
  ADD COLUMN IF NOT EXISTS business_city text,
  ADD COLUMN IF NOT EXISTS business_state text,
  ADD COLUMN IF NOT EXISTS business_country text;

DO $$
DECLARE
  v_column text;
  v_actual_type text;
  v_not_null boolean;
  v_default text;
BEGIN
  FOREACH v_column IN ARRAY ARRAY[
    'business_street',
    'business_city',
    'business_state',
    'business_country'
  ]
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
      AND attribute.attname = v_column
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped;

    IF NOT FOUND
       OR v_actual_type <> 'text'
       OR v_not_null
       OR v_default IS NOT NULL THEN
      RAISE EXCEPTION
        'Migration 022 postcondition failure: public.merchants.% is not canonical nullable text',
        v_column;
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
