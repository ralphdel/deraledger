BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_service_role_only_function_execute(
  p_function_name TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_function_oid oid;
  v_owner_name TEXT;
  v_grantees TEXT[];
  v_explicit_grantees TEXT[];
  v_denied_role TEXT;
BEGIN
  SELECT p.oid, pg_get_userbyid(p.proowner)
  INTO v_function_oid, v_owner_name
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = p_function_name
  ORDER BY p.oid
  LIMIT 1;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'expected public.% to exist for function grant assertion', p_function_name;
  END IF;

  IF NOT has_function_privilege('service_role', v_function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '% must grant EXECUTE to service_role', p_function_name;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    LEFT JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl ON TRUE
    WHERE p.oid = v_function_oid
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
      AND acl.is_grantable = false
  ) THEN
    RAISE EXCEPTION '% must not grant EXECUTE to PUBLIC', p_function_name;
  END IF;

  FOREACH v_denied_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF has_function_privilege(v_denied_role, v_function_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '% must not grant EXECUTE to %', p_function_name, v_denied_role;
    END IF;
  END LOOP;

  SELECT COALESCE(array_agg(grantee ORDER BY grantee), ARRAY[]::TEXT[])
  INTO v_grantees
  FROM information_schema.routine_privileges
  WHERE specific_schema = 'public'
    AND routine_name = p_function_name
    AND privilege_type = 'EXECUTE';

  SELECT COALESCE(array_agg(grantee ORDER BY grantee), ARRAY[]::TEXT[])
  INTO v_explicit_grantees
  FROM unnest(v_grantees) AS grantee
  WHERE grantee <> v_owner_name;

  IF v_explicit_grantees <> ARRAY['service_role'] THEN
    RAISE EXCEPTION '% grants are not owner-aware service_role-only: raw=% explicit_non_owner=% owner=%',
      p_function_name,
      v_grantees,
      v_explicit_grantees,
      v_owner_name;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_table_access_manifest(
  p_table_name TEXT,
  p_access_model TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = p_table_name
      AND grantee IN ('anon', 'PUBLIC')
      AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
  ) THEN
    RAISE EXCEPTION '% retains forbidden anon/PUBLIC table grants', p_table_name;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = p_table_name
      AND grantee = 'authenticated'
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
  ) THEN
    RAISE EXCEPTION '% retains forbidden authenticated browser write/ddl-adjacent grants', p_table_name;
  END IF;

  IF p_access_model = 'merchant_read_select' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = p_table_name
        AND grantee = 'authenticated'
        AND privilege_type = 'SELECT'
    ) THEN
      RAISE EXCEPTION '% must grant authenticated SELECT under the merchant-read manifest', p_table_name;
    END IF;
  ELSIF p_access_model = 'internal' THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = p_table_name
        AND grantee = 'authenticated'
        AND privilege_type = 'SELECT'
    ) THEN
      RAISE EXCEPTION '% unexpectedly grants authenticated SELECT under the internal manifest', p_table_name;
    END IF;
  ELSE
    RAISE EXCEPTION 'unknown table access manifest % for %', p_access_model, p_table_name;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.payment_sessions') IS NULL THEN
    RAISE EXCEPTION 'expected public.payment_sessions to exist';
  END IF;

  IF to_regclass('public.crypto_payment_sessions') IS NULL THEN
    RAISE EXCEPTION 'expected public.crypto_payment_sessions to exist';
  END IF;

  IF to_regclass('public.settlement_records') IS NULL THEN
    RAISE EXCEPTION 'expected public.settlement_records to exist';
  END IF;

  IF to_regclass('public.merchant_settlement_accounts') IS NULL THEN
    RAISE EXCEPTION 'expected public.merchant_settlement_accounts to exist';
  END IF;

  IF to_regclass('public.merchant_provider_settlement_accounts') IS NULL THEN
    RAISE EXCEPTION 'expected public.merchant_provider_settlement_accounts to exist';
  END IF;

  IF to_regclass('public.provider_settlement_batches') IS NULL THEN
    RAISE EXCEPTION 'expected public.provider_settlement_batches to exist';
  END IF;

  IF to_regclass('public.settlement_reconciliation_logs') IS NULL THEN
    RAISE EXCEPTION 'expected public.settlement_reconciliation_logs to exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payment_sessions'
      AND column_name = 'settlement_recipient_type'
  ) THEN
    RAISE EXCEPTION 'expected public.payment_sessions.settlement_recipient_type';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'crypto_payment_sessions'
      AND column_name = 'settlement_recipient_type'
  ) THEN
    RAISE EXCEPTION 'expected public.crypto_payment_sessions.settlement_recipient_type';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'settlement_records'
      AND column_name = 'settlement_account_snapshot'
  ) THEN
    RAISE EXCEPTION 'expected public.settlement_records.settlement_account_snapshot';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'process_breet_invoice_confirmation'
  ) THEN
    RAISE EXCEPTION 'expected public.process_breet_invoice_confirmation';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'queue_pending_crypto_settlements'
  ) THEN
    RAISE EXCEPTION 'expected public.queue_pending_crypto_settlements';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'update_settlement_batch_status'
  ) THEN
    RAISE EXCEPTION 'expected public.update_settlement_batch_status';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'crypto_payment_sessions'
      AND indexname = 'idx_crypto_payment_sessions_provider_reference_unique'
  ) THEN
    RAISE EXCEPTION 'expected idx_crypto_payment_sessions_provider_reference_unique';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'payment_records'
      AND indexname = 'idx_payment_records_plan_recovery'
  ) THEN
    RAISE EXCEPTION 'expected idx_payment_records_plan_recovery';
  END IF;
END;
$$;

DO $$
DECLARE
  v_function_def TEXT;
  v_payment_records_policy TEXT;
  v_processor_default TEXT;
  v_processed_at_default TEXT;
  v_invoice_fk_count INTEGER;
  v_invoice_fk_delete_action TEXT;
  v_table TEXT;
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
    RAISE EXCEPTION 'payment_events.merchant_id must remain intentionally nullable for historical ownerless audit rows';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payment_events'
      AND column_name = 'invoice_id'
      AND udt_name = 'uuid'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'payment_events.invoice_id must be nullable uuid';
  END IF;

  SELECT
    count(*)::integer,
    max(CASE con.confdeltype::text
      WHEN 'a' THEN 'NO ACTION'
      WHEN 'r' THEN 'RESTRICT'
      WHEN 'c' THEN 'CASCADE'
      WHEN 'n' THEN 'SET NULL'
      WHEN 'd' THEN 'SET DEFAULT'
      ELSE 'UNKNOWN:' || con.confdeltype::text
    END)
  INTO
    v_invoice_fk_count,
    v_invoice_fk_delete_action
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
    AND con.conname = 'payment_events_invoice_id_fkey'
    AND con.contype::text = 'f'
    AND con.convalidated
    AND ref_ns.nspname::text = 'public'
    AND ref_cls.relname::text = 'invoices'
  GROUP BY con.conname, con.confdeltype
  HAVING array_agg(src.attname::text ORDER BY src_ord.ordinality) = ARRAY['invoice_id']::text[]
     AND array_agg(ref.attname::text ORDER BY ref_ord.ordinality) = ARRAY['id']::text[];

  IF COALESCE(v_invoice_fk_count, 0) <> 1 THEN
    RAISE EXCEPTION 'payment_events_invoice_id_fkey must be the single validated FK from payment_events(invoice_id) to public.invoices(id)';
  END IF;

  IF v_invoice_fk_delete_action <> 'SET NULL' THEN
    RAISE EXCEPTION 'payment_events_invoice_id_fkey must be canonical ON DELETE SET NULL after reconciliation, got %',
      v_invoice_fk_delete_action;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payment_events'
      AND column_name = 'processor'
      AND udt_name = 'text'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'payment_events.processor must remain text not null';
  END IF;

  SELECT pg_get_expr(d.adbin, d.adrelid)
  INTO v_processor_default
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef d
    ON d.adrelid = a.attrelid
   AND d.adnum = a.attnum
  WHERE n.nspname = 'public'
    AND c.relname = 'payment_events'
    AND a.attname = 'processor'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_processor_default IS NOT NULL
     AND trim(regexp_replace(lower(v_processor_default), '\s+', ' ', 'g')) <> '''paystack''::text' THEN
    RAISE EXCEPTION 'payment_events.processor must have no default or the accepted legacy paystack default, got %',
      v_processor_default;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payment_events'
      AND column_name = 'processed_at'
      AND udt_name = 'timestamptz'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'payment_events.processed_at must remain nullable timestamptz';
  END IF;

  SELECT pg_get_expr(d.adbin, d.adrelid)
  INTO v_processed_at_default
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef d
    ON d.adrelid = a.attrelid
   AND d.adnum = a.attnum
  WHERE n.nspname = 'public'
    AND c.relname = 'payment_events'
    AND a.attname = 'processed_at'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_processed_at_default IS NOT NULL THEN
    RAISE EXCEPTION 'payment_events.processed_at must not have a default after reconciliation, got %',
      v_processed_at_default;
  END IF;

  INSERT INTO public.payment_events (
    id,
    merchant_id,
    event_type,
    processor,
    processed_at,
    raw_payload,
    idempotency_key,
    payment_purpose
  )
  VALUES (
    'aaaaaaaa-0000-4000-8000-000000000009',
    NULL,
    'historical.ownerless',
    'paystack',
    now(),
    '{"fixture":"historical_ownerless"}'::jsonb,
    'phase2-breet-payment-substrate:historical-ownerless',
    NULL
  )
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
    FROM public.payment_events
    WHERE id = 'aaaaaaaa-0000-4000-8000-000000000009'
      AND merchant_id IS NULL
      AND processed_at IS NOT NULL
      AND raw_payload = '{"fixture":"historical_ownerless"}'::jsonb
  ) THEN
    RAISE EXCEPTION 'historical ownerless payment_events rows must be accepted and preserved';
  END IF;

  INSERT INTO public.payment_events (
    id,
    merchant_id,
    event_type,
    processor,
    processed_at,
    raw_payload,
    idempotency_key,
    payment_purpose
  )
  VALUES (
    'aaaaaaaa-0000-4000-8000-000000000019',
    NULL,
    'historical.ownerless.null_processed_at',
    'paystack',
    NULL,
    '{"fixture":"historical_ownerless_null_processed_at"}'::jsonb,
    'phase2-breet-payment-substrate:historical-ownerless-null-processed-at',
    NULL
  )
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
    FROM public.payment_events
    WHERE id = 'aaaaaaaa-0000-4000-8000-000000000019'
      AND merchant_id IS NULL
      AND processed_at IS NULL
      AND raw_payload = '{"fixture":"historical_ownerless_null_processed_at"}'::jsonb
  ) THEN
    RAISE EXCEPTION 'historical ownerless payment_events rows with NULL processed_at must be accepted and preserved';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payment_events'
      AND column_name = 'amount_kobo'
      AND udt_name = 'int8'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'payment_events.amount_kobo is missing or has an unexpected definition';
  END IF;

  FOR v_function_def IN
    SELECT pg_get_functiondef(p.oid)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'process_breet_invoice_confirmation',
        'queue_pending_crypto_settlements',
        'update_settlement_batch_status'
      )
  LOOP
    IF position('SET search_path TO ''public'', ''pg_temp''' in v_function_def) = 0 THEN
      RAISE EXCEPTION 'expected hardened search_path in Breet write function definition';
    END IF;
  END LOOP;

  PERFORM pg_temp.assert_service_role_only_function_execute('process_breet_invoice_confirmation');
  PERFORM pg_temp.assert_service_role_only_function_execute('queue_pending_crypto_settlements');
  PERFORM pg_temp.assert_service_role_only_function_execute('update_settlement_batch_status');

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'payment_records',
        'settlement_records',
        'merchant_settlement_accounts',
        'merchant_provider_settlement_accounts',
        'provider_settlement_batches'
      )
      AND NOT c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'expected RLS to be enabled on canonical settlement/payment tables';
  END IF;

  SELECT pg_get_expr(pol.polqual, pol.polrelid)
  INTO v_payment_records_policy
  FROM pg_policy pol
  JOIN pg_class cls ON cls.oid = pol.polrelid
  JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
  WHERE nsp.nspname = 'public'
    AND cls.relname = 'payment_records'
    AND pol.polname = 'merchant_read_payment_records';

  IF v_payment_records_policy IS NULL THEN
    RAISE EXCEPTION 'expected merchant_read_payment_records policy on public.payment_records';
  END IF;

  IF position('auth.role() = ''authenticated''::text' in v_payment_records_policy) = 0
     OR position('m.id = payment_records.merchant_id' in v_payment_records_policy) = 0
     OR position('m.user_id = auth.uid()' in v_payment_records_policy) = 0 THEN
    RAISE EXCEPTION 'merchant_read_payment_records policy is not merchant-scoped authenticated read access: %', v_payment_records_policy;
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'payment_events',
    'payment_providers',
    'payment_method_configs',
    'payment_provider_routes',
    'merchant_wallets',
    'payment_sessions',
    'treasury_transactions',
    'settlement_batches',
    'treasury_webhook_logs',
    'crypto_payment_sessions',
    'settlement_reconciliation_logs',
    'provider_settlement_batch_items'
  ]
  LOOP
    PERFORM pg_temp.assert_table_access_manifest(v_table, 'internal');
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY[
    'payment_records',
    'settlement_records',
    'merchant_settlement_accounts',
    'merchant_provider_settlement_accounts',
    'provider_settlement_batches'
  ]
  LOOP
    PERFORM pg_temp.assert_table_access_manifest(v_table, 'merchant_read_select');
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_setting RECORD;
BEGIN
  FOR v_setting IN
    SELECT key, value
    FROM public.platform_settings
    WHERE key IN (
      'breet_settlement_mode',
      'breet_auto_settlement_enabled',
      'breet_merchant_auto_settlement_enabled',
      'breet_invoice_crypto_enabled',
      'breet_subscription_crypto_enabled',
      'breet_live_enabled'
    )
  LOOP
    IF v_setting.key = 'breet_settlement_mode' AND v_setting.value NOT IN ('disabled', 'breet_auto_settlement', 'platform_auto_settlement', 'treasury_manual') THEN
      RAISE EXCEPTION 'unexpected breet_settlement_mode value %', v_setting.value;
    END IF;

    IF v_setting.key <> 'breet_settlement_mode' AND v_setting.value NOT IN ('true', 'false') THEN
      RAISE EXCEPTION 'unexpected boolean setting %=%', v_setting.key, v_setting.value;
    END IF;
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_payment_sessions_mode TEXT;
  v_crypto_sessions_purpose TEXT;
  v_crypto_sessions_mode TEXT;
  v_settlement_mode TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO v_payment_sessions_mode
  FROM pg_constraint
  WHERE conrelid = 'public.payment_sessions'::regclass
    AND conname = 'payment_sessions_settlement_mode_check';

  IF v_payment_sessions_mode IS NULL
     OR position('breet_auto_settlement' in v_payment_sessions_mode) = 0
     OR position('platform_auto_settlement' in v_payment_sessions_mode) = 0
     OR position('treasury_manual' in v_payment_sessions_mode) = 0
     OR position('disabled' in v_payment_sessions_mode) = 0 THEN
    RAISE EXCEPTION 'payment_sessions_settlement_mode_check is not the final canonical definition';
  END IF;

  SELECT pg_get_constraintdef(oid)
  INTO v_crypto_sessions_purpose
  FROM pg_constraint
  WHERE conrelid = 'public.crypto_payment_sessions'::regclass
    AND conname = 'crypto_payment_sessions_payment_purpose_check';

  IF v_crypto_sessions_purpose IS NULL
     OR position('plan_subscription' in v_crypto_sessions_purpose) = 0
     OR position('plan_upgrade' in v_crypto_sessions_purpose) = 0
     OR position('plan_renewal' in v_crypto_sessions_purpose) = 0 THEN
    RAISE EXCEPTION 'crypto_payment_sessions_payment_purpose_check is not the final canonical definition';
  END IF;

  SELECT pg_get_constraintdef(oid)
  INTO v_crypto_sessions_mode
  FROM pg_constraint
  WHERE conrelid = 'public.crypto_payment_sessions'::regclass
    AND conname = 'crypto_payment_sessions_settlement_mode_check';

  IF v_crypto_sessions_mode IS NULL
     OR position('breet_auto_settlement' in v_crypto_sessions_mode) = 0
     OR position('platform_auto_settlement' in v_crypto_sessions_mode) = 0
     OR position('treasury_manual' in v_crypto_sessions_mode) = 0
     OR position('disabled' in v_crypto_sessions_mode) = 0 THEN
    RAISE EXCEPTION 'crypto_payment_sessions_settlement_mode_check is not the final canonical definition';
  END IF;

  SELECT pg_get_constraintdef(oid)
  INTO v_settlement_mode
  FROM pg_constraint
  WHERE conrelid = 'public.settlement_records'::regclass
    AND conname = 'settlement_records_settlement_mode_check';

  IF v_settlement_mode IS NULL
     OR position('provider_direct' in v_settlement_mode) = 0
     OR position('breet_auto_settlement' in v_settlement_mode) = 0
     OR position('platform_auto_settlement' in v_settlement_mode) = 0
     OR position('treasury_manual' in v_settlement_mode) = 0
     OR position('treasury_payout_required' in v_settlement_mode) = 0
     OR position('disabled' in v_settlement_mode) = 0 THEN
    RAISE EXCEPTION 'settlement_records_settlement_mode_check is not the final canonical definition';
  END IF;
END;
$$;

ROLLBACK;
