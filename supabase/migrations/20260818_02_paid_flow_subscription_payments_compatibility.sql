-- Migration 020: restore the canonical paid subscription payment ledger.
-- SQL-Editor compatible. This migration contains no business-row DML and does
-- not change provider configuration or payment-flow behavior.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

-- Fail closed on prerequisite or incompatible drift. A partially defined,
-- populated table is not repaired because missing required values cannot be
-- inferred without mutating business data.
DO $$
DECLARE
  v_relkind "char";
  v_row_count bigint := 0;
  v_missing_columns text[];
  v_expected record;
  v_actual_type text;
BEGIN
  IF to_regclass('public.merchants') IS NULL THEN
    RAISE EXCEPTION 'Migration 020 prerequisite missing: public.merchants';
  END IF;

  SELECT relkind INTO v_relkind
  FROM pg_class
  WHERE oid = 'public.merchants'::regclass;

  IF v_relkind <> 'r' THEN
    RAISE EXCEPTION
      'Migration 020 prerequisite incompatible: public.merchants is relkind %, expected ordinary table',
      v_relkind;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    RAISE EXCEPTION
      'Migration 020 prerequisite missing: service_role, authenticated, and anon roles are required';
  END IF;

  IF to_regclass('public.subscription_payments') IS NULL THEN
    RETURN;
  END IF;

  SELECT relkind INTO v_relkind
  FROM pg_class
  WHERE oid = 'public.subscription_payments'::regclass;

  IF v_relkind <> 'r' THEN
    RAISE EXCEPTION
      'Migration 020 compatibility failure: public.subscription_payments is relkind %, expected ordinary table',
      v_relkind;
  END IF;

  SELECT array_agg(expected.column_name ORDER BY expected.column_name)
  INTO v_missing_columns
  FROM (VALUES
    ('id'), ('merchant_id'), ('plan'), ('amount_ngn'), ('period_start'),
    ('period_end'), ('paystack_ref'), ('payment_type'), ('status'), ('created_at')
  ) AS expected(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_attribute attribute
    WHERE attribute.attrelid = 'public.subscription_payments'::regclass
      AND attribute.attname = expected.column_name
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  );

  IF v_missing_columns IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.subscription_payments' INTO v_row_count;
    IF v_row_count > 0 THEN
      RAISE EXCEPTION
        'Migration 020 compatibility failure: populated public.subscription_payments is missing columns %; no values will be invented',
        v_missing_columns;
    END IF;
  END IF;

  FOR v_expected IN
    SELECT *
    FROM (VALUES
      ('id'::text, 'uuid'::text),
      ('merchant_id', 'uuid'),
      ('plan', 'text'),
      ('amount_ngn', 'numeric(10,2)'),
      ('period_start', 'timestamp with time zone'),
      ('period_end', 'timestamp with time zone'),
      ('paystack_ref', 'text'),
      ('payment_type', 'text'),
      ('status', 'text'),
      ('created_at', 'timestamp with time zone')
    ) AS expected(column_name, formatted_type)
  LOOP
    SELECT format_type(attribute.atttypid, attribute.atttypmod)
    INTO v_actual_type
    FROM pg_attribute attribute
    WHERE attribute.attrelid = 'public.subscription_payments'::regclass
      AND attribute.attname = v_expected.column_name
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped;

    IF v_actual_type IS NOT NULL AND v_actual_type <> v_expected.formatted_type THEN
      RAISE EXCEPTION
        'Migration 020 compatibility failure: public.subscription_payments.% is %, expected %',
        v_expected.column_name,
        v_actual_type,
        v_expected.formatted_type;
    END IF;
  END LOOP;
END;
$$;

CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL,
  plan TEXT NOT NULL,
  amount_ngn NUMERIC(10,2) NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  paystack_ref TEXT NOT NULL,
  payment_type TEXT NOT NULL DEFAULT 'new',
  status TEXT NOT NULL DEFAULT 'paid',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT subscription_payments_paystack_ref_key UNIQUE (paystack_ref),
  CONSTRAINT subscription_payments_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE
);

-- These clauses make the migration idempotent for an empty partial table. The
-- preflight block above rejects a populated partial table before any DDL runs.
ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS merchant_id UUID,
  ADD COLUMN IF NOT EXISTS plan TEXT,
  ADD COLUMN IF NOT EXISTS amount_ngn NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS period_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paystack_ref TEXT,
  ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'paid',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.subscription_payments
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN payment_type SET DEFAULT 'new',
  ALTER COLUMN status SET DEFAULT 'paid',
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN merchant_id SET NOT NULL,
  ALTER COLUMN plan SET NOT NULL,
  ALTER COLUMN amount_ngn SET NOT NULL,
  ALTER COLUMN period_start SET NOT NULL,
  ALTER COLUMN period_end SET NOT NULL,
  ALTER COLUMN paystack_ref SET NOT NULL,
  ALTER COLUMN payment_type SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL;

DO $$
DECLARE
  v_constraint record;
  v_policy_count bigint;
  v_canonical_policy_count bigint;
BEGIN
  SELECT constraint_row.oid, constraint_row.contype, constraint_row.convalidated,
         constraint_row.conkey, constraint_row.confkey,
         constraint_row.confrelid, constraint_row.confdeltype
  INTO v_constraint
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.subscription_payments'::regclass
    AND constraint_row.conname = 'subscription_payments_pkey';

  IF FOUND THEN
    IF v_constraint.contype <> 'p'
       OR NOT v_constraint.convalidated
       OR v_constraint.conkey <> ARRAY[
         (SELECT attnum FROM pg_attribute
          WHERE attrelid = 'public.subscription_payments'::regclass AND attname = 'id')
       ]::smallint[] THEN
      RAISE EXCEPTION 'Migration 020 compatibility failure: subscription_payments_pkey is incompatible';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.subscription_payments'::regclass AND contype = 'p'
    ) THEN
      RAISE EXCEPTION 'Migration 020 compatibility failure: public.subscription_payments has an unexpected primary key';
    END IF;
    ALTER TABLE public.subscription_payments
      ADD CONSTRAINT subscription_payments_pkey PRIMARY KEY (id);
  END IF;

  SELECT constraint_row.oid, constraint_row.contype, constraint_row.convalidated,
         constraint_row.conkey, constraint_row.confkey,
         constraint_row.confrelid, constraint_row.confdeltype
  INTO v_constraint
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.subscription_payments'::regclass
    AND constraint_row.conname = 'subscription_payments_paystack_ref_key';

  IF FOUND THEN
    IF v_constraint.contype <> 'u'
       OR NOT v_constraint.convalidated
       OR v_constraint.conkey <> ARRAY[
         (SELECT attnum FROM pg_attribute
          WHERE attrelid = 'public.subscription_payments'::regclass AND attname = 'paystack_ref')
       ]::smallint[] THEN
      RAISE EXCEPTION 'Migration 020 compatibility failure: subscription_payments_paystack_ref_key is incompatible';
    END IF;
  ELSE
    ALTER TABLE public.subscription_payments
      ADD CONSTRAINT subscription_payments_paystack_ref_key UNIQUE (paystack_ref);
  END IF;

  SELECT constraint_row.oid, constraint_row.contype, constraint_row.convalidated,
         constraint_row.conkey, constraint_row.confkey,
         constraint_row.confrelid, constraint_row.confdeltype
  INTO v_constraint
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.subscription_payments'::regclass
    AND constraint_row.conname = 'subscription_payments_merchant_id_fkey';

  IF FOUND THEN
    IF v_constraint.contype <> 'f'
       OR NOT v_constraint.convalidated
       OR v_constraint.confrelid <> 'public.merchants'::regclass
       OR v_constraint.confdeltype <> 'c'
       OR v_constraint.conkey <> ARRAY[
         (SELECT attnum FROM pg_attribute
          WHERE attrelid = 'public.subscription_payments'::regclass AND attname = 'merchant_id')
       ]::smallint[]
       OR v_constraint.confkey <> ARRAY[
         (SELECT attnum FROM pg_attribute
          WHERE attrelid = 'public.merchants'::regclass AND attname = 'id')
       ]::smallint[] THEN
      RAISE EXCEPTION 'Migration 020 compatibility failure: subscription_payments_merchant_id_fkey is incompatible';
    END IF;
  ELSE
    ALTER TABLE public.subscription_payments
      ADD CONSTRAINT subscription_payments_merchant_id_fkey
      FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (
      WHERE policy.policyname = 'sub_payments_merchant'
        AND policy.permissive = 'PERMISSIVE'
        AND policy.cmd = 'SELECT'
        AND policy.roles::text[] IN (
          ARRAY['public']::text[],
          ARRAY['authenticated']::text[]
        )
        AND policy.qual LIKE '%merchant_id%'
        AND policy.qual LIKE '%merchants.user_id%'
        AND policy.qual LIKE '%auth.uid()%'
        AND policy.with_check IS NULL
    )
  INTO v_policy_count, v_canonical_policy_count
  FROM pg_policies policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename = 'subscription_payments';

  IF v_policy_count > 0
     AND NOT (v_policy_count = 1 AND v_canonical_policy_count = 1) THEN
    RAISE EXCEPTION
      'Migration 020 compatibility failure: public.subscription_payments has unexpected policies (total=%, canonical=%)',
      v_policy_count,
      v_canonical_policy_count;
  END IF;

  IF v_policy_count = 0 THEN
    CREATE POLICY sub_payments_merchant
      ON public.subscription_payments
      FOR SELECT
      TO authenticated
      USING (
        merchant_id IN (
          SELECT merchants.id
          FROM public.merchants
          WHERE merchants.user_id = auth.uid()
        )
      );
  END IF;
END;
$$;

ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

-- Billing history is browser-readable only through the owner-scoped policy.
-- All writes remain server/service-role only.
REVOKE ALL ON TABLE public.subscription_payments FROM PUBLIC;
REVOKE ALL ON TABLE public.subscription_payments FROM anon;
REVOKE ALL ON TABLE public.subscription_payments FROM authenticated;
GRANT SELECT ON TABLE public.subscription_payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.subscription_payments TO service_role;

-- public.payment_events is intentionally unchanged. Migration 017 established
-- its service-only contract: RLS disabled, zero policies, and no browser grants.
-- Migration 020 contains no INSERT, UPDATE, DELETE, TRUNCATE, DROP, provider
-- configuration change, role seed change, or feature activation.

COMMIT;
