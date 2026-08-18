-- ============================================================
-- payment_events legacy merchant compatibility
-- Preserves historical ownerless audit rows while keeping
-- merchant-owned writes tied to real merchants by foreign key.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_relkind "char";
  v_udt_name TEXT;
  v_not_null BOOLEAN;
  v_actual_columns TEXT[];
  v_actual_ref_schema TEXT;
  v_actual_ref_table TEXT;
  v_actual_ref_columns TEXT[];
  v_actual_delete_action TEXT;
BEGIN
  SELECT c.relkind
  INTO v_relkind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'payment_events';

  IF v_relkind IS NULL THEN
    RAISE EXCEPTION 'payment_events legacy compatibility requires public.payment_events to exist';
  END IF;

  IF v_relkind <> 'r' THEN
    RAISE EXCEPTION 'payment_events legacy compatibility expected public.payment_events to be an ordinary table, got relkind %',
      v_relkind;
  END IF;

  SELECT t.typname, a.attnotnull
  INTO v_udt_name, v_not_null
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_type t ON t.oid = a.atttypid
  WHERE n.nspname = 'public'
    AND c.relname = 'payment_events'
    AND a.attname = 'merchant_id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_udt_name IS NULL THEN
    RAISE EXCEPTION 'payment_events legacy compatibility expected public.payment_events.merchant_id to exist';
  END IF;

  IF v_udt_name <> 'uuid' THEN
    RAISE EXCEPTION 'payment_events legacy compatibility expected public.payment_events.merchant_id uuid, got %',
      v_udt_name;
  END IF;

  IF v_not_null THEN
    ALTER TABLE public.payment_events
      ALTER COLUMN merchant_id DROP NOT NULL;
  END IF;

  SELECT
    array_agg(src.attname ORDER BY src_ord.ordinality),
    ref_ns.nspname,
    ref_cls.relname,
    array_agg(ref.attname ORDER BY ref_ord.ordinality),
    CASE con.confdeltype
      WHEN 'a' THEN 'NO ACTION'
      WHEN 'r' THEN 'RESTRICT'
      WHEN 'c' THEN 'CASCADE'
      WHEN 'n' THEN 'SET NULL'
      WHEN 'd' THEN 'SET DEFAULT'
    END
  INTO
    v_actual_columns,
    v_actual_ref_schema,
    v_actual_ref_table,
    v_actual_ref_columns,
    v_actual_delete_action
  FROM pg_constraint con
  JOIN pg_class ref_cls ON ref_cls.oid = con.confrelid
  JOIN pg_namespace ref_ns ON ref_ns.oid = ref_cls.relnamespace
  CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS src_ord(attnum, ordinality)
  JOIN pg_attribute src
    ON src.attrelid = con.conrelid
   AND src.attnum = src_ord.attnum
  CROSS JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS ref_ord(attnum, ordinality)
  JOIN pg_attribute ref
    ON ref.attrelid = con.confrelid
   AND ref.attnum = ref_ord.attnum
   AND ref_ord.ordinality = src_ord.ordinality
  WHERE con.conrelid = 'public.payment_events'::regclass
    AND con.conname = 'payment_events_merchant_id_fkey'
    AND con.contype = 'f'
  GROUP BY ref_ns.nspname, ref_cls.relname, con.confdeltype;

  IF v_actual_columns IS NOT NULL
     AND (
       v_actual_columns <> ARRAY['merchant_id']
       OR v_actual_ref_schema <> 'public'
       OR v_actual_ref_table <> 'merchants'
       OR v_actual_ref_columns <> ARRAY['id']
     ) THEN
    RAISE EXCEPTION 'payment_events legacy compatibility found incompatible payment_events_merchant_id_fkey';
  END IF;

  IF v_actual_columns IS NULL THEN
    ALTER TABLE public.payment_events
      ADD CONSTRAINT payment_events_merchant_id_fkey
      FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;
  ELSIF v_actual_delete_action <> 'CASCADE' THEN
    ALTER TABLE public.payment_events
      DROP CONSTRAINT payment_events_merchant_id_fkey;
    ALTER TABLE public.payment_events
      ADD CONSTRAINT payment_events_merchant_id_fkey
      FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;
  END IF;

  ALTER TABLE public.payment_events DISABLE ROW LEVEL SECURITY;
END;
$$;

DO $$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'payment_events'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.payment_events', v_policy.policyname);
  END LOOP;
END;
$$;

REVOKE ALL ON TABLE public.payment_events FROM PUBLIC;
REVOKE ALL ON TABLE public.payment_events FROM anon;
REVOKE ALL ON TABLE public.payment_events FROM authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payment_events'
      AND column_name = 'merchant_id'
      AND udt_name = 'uuid'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'payment_events legacy compatibility verification failed: merchant_id is not nullable uuid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
    JOIN pg_class ref_cls ON ref_cls.oid = con.confrelid
    JOIN pg_namespace ref_nsp ON ref_nsp.oid = ref_cls.relnamespace
    WHERE nsp.nspname = 'public'
      AND cls.relname = 'payment_events'
      AND con.conname = 'payment_events_merchant_id_fkey'
      AND con.contype = 'f'
      AND ref_nsp.nspname = 'public'
      AND ref_cls.relname = 'merchants'
      AND con.confdeltype = 'c'
  ) THEN
    RAISE EXCEPTION 'payment_events legacy compatibility verification failed: merchant FK is not ON DELETE CASCADE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'payment_events'
  ) THEN
    RAISE EXCEPTION 'payment_events legacy compatibility verification failed: payment_events has browser-facing RLS policies';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'payment_events'
      AND grantee IN ('PUBLIC', 'anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'payment_events legacy compatibility verification failed: payment_events has browser role grants';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'payment_events' AND indexname = 'idx_payment_events_created_at')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'payment_events' AND indexname = 'idx_payment_events_payment_reference')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'payment_events' AND indexname = 'idx_payment_events_processor_ref')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'payment_events' AND indexname = 'idx_payment_events_idempotency') THEN
    RAISE EXCEPTION 'payment_events legacy compatibility verification failed: expected payment_events indexes are missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.platform_settings
    WHERE key IN (
      'solo_plus_enabled',
      'solo_plus_kyc_enabled',
      'breet_live_enabled',
      'breet_invoice_crypto_enabled',
      'breet_subscription_crypto_enabled',
      'breet_development_checkout_enabled',
      'breet_merchant_auto_settlement_enabled',
      'breet_platform_auto_settlement_enabled'
    )
      AND value <> 'false'
  ) THEN
    RAISE EXCEPTION 'payment_events legacy compatibility verification failed: protected feature controls changed';
  END IF;
END;
$$;

COMMIT;
