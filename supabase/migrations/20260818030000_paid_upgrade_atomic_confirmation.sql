-- Migration 021: repair canonical merchant activation columns, bind paid upgrade
-- confirmation to payment_records, and activate atomically.
-- Applying this migration adds only nullable/default-compatible schema and the RPC;
-- it does not update existing business rows or provider configuration.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

DO $$
DECLARE
  v_table text;
  v_column text;
  v_overload_count integer;
  v_legacy_plan_type_oid oid;
  v_legacy_plan_type_kind "char";
  v_legacy_plan_labels text[];
  v_subscription_plan_column_oid oid;
  v_subscription_plan_column_type text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'Migration 021 prerequisite missing: service_role';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'payment_records', 'merchants', 'workspaces', 'workspace_subscriptions',
    'subscriptions', 'subscription_payments'
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'Migration 021 prerequisite missing: public.%', v_table;
    END IF;
  END LOOP;

  FOREACH v_column IN ARRAY ARRAY[
    'id', 'user_id', 'merchant_id', 'payment_purpose', 'provider_name',
    'internal_reference', 'provider_reference', 'expected_amount', 'amount_paid',
    'currency', 'payment_status', 'processing_status', 'account_setup_status',
    'customer_email', 'plan_id', 'plan_name', 'metadata', 'raw_provider_payload',
    'failure_reason', 'paid_at', 'updated_at'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = 'public.payment_records'::regclass
        AND attname = v_column AND attnum > 0 AND NOT attisdropped
    ) THEN
      RAISE EXCEPTION 'Migration 021 prerequisite missing: public.payment_records.%', v_column;
    END IF;
  END LOOP;

  FOR v_table, v_column IN
    SELECT required.table_name, required.column_name
    FROM (VALUES
      ('merchants', 'id'), ('merchants', 'user_id'), ('merchants', 'email'),
      ('merchants', 'business_name'),
      ('merchants', 'subscription_plan'), ('merchants', 'merchant_tier'),
      ('merchants', 'monthly_collection_limit'),
      ('merchants', 'relationship_claim'), ('merchants', 'workspace_id'),
      ('merchants', 'onboarding_status'), ('merchants', 'setup_mode'),
      ('merchants', 'live_features_enabled'), ('merchants', 'paid_setup_started_at'),
      ('merchants', 'updated_at'),
      ('workspaces', 'id'), ('workspaces', 'owner_user_id'), ('workspaces', 'merchant_id'),
      ('workspaces', 'workspace_type'), ('workspaces', 'display_name'),
      ('workspaces', 'plan_type'), ('workspaces', 'onboarding_status'),
      ('workspaces', 'setup_mode'), ('workspaces', 'live_features_enabled'),
      ('workspaces', 'created_at'), ('workspaces', 'updated_at'),
      ('workspace_subscriptions', 'id'), ('workspace_subscriptions', 'workspace_id'),
      ('workspace_subscriptions', 'merchant_id'), ('workspace_subscriptions', 'plan_type'),
      ('workspace_subscriptions', 'subscription_status'),
      ('workspace_subscriptions', 'payment_reference'),
      ('workspace_subscriptions', 'amount_paid'), ('workspace_subscriptions', 'period_start'),
      ('workspace_subscriptions', 'period_end'), ('workspace_subscriptions', 'created_at'),
      ('workspace_subscriptions', 'updated_at'),
      ('subscriptions', 'merchant_id'), ('subscriptions', 'plan_type'),
      ('subscriptions', 'amount_paid'), ('subscriptions', 'start_date'),
      ('subscriptions', 'expiry_date'), ('subscriptions', 'status'),
      ('subscriptions', 'last_notified_at'), ('subscriptions', 'is_banner_dismissed'),
      ('subscriptions', 'updated_at'),
      ('subscription_payments', 'merchant_id'), ('subscription_payments', 'plan'),
      ('subscription_payments', 'amount_ngn'), ('subscription_payments', 'period_start'),
      ('subscription_payments', 'period_end'), ('subscription_payments', 'paystack_ref'),
      ('subscription_payments', 'payment_type'), ('subscription_payments', 'status')
    ) AS required(table_name, column_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = to_regclass('public.' || v_table)
        AND attname = v_column AND attnum > 0 AND NOT attisdropped
    ) THEN
      RAISE EXCEPTION 'Migration 021 prerequisite missing: public.%.%', v_table, v_column;
    END IF;
  END LOOP;

  -- Both columns are canonical historical merchant schema. Missing columns are
  -- repairable below, but incompatible existing definitions are not rewritten.
  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d
      ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'public.merchants'::regclass
      AND a.attname = 'business_type'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND (
        format_type(a.atttypid, a.atttypmod) <> 'text'
        OR a.attnotnull
        OR d.oid IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Migration 021 prerequisite incompatible: merchants.business_type must be nullable text with no default';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d
      ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'public.merchants'::regclass
      AND a.attname = 'subscription_notifications_sent'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND (
        format_type(a.atttypid, a.atttypmod) <> 'jsonb'
        OR a.attnotnull
        OR (
          d.oid IS NOT NULL
          AND pg_get_expr(d.adbin, d.adrelid) <> '''{}''::jsonb'
        )
      )
  ) THEN
    RAISE EXCEPTION 'Migration 021 prerequisite incompatible: merchants.subscription_notifications_sent must be nullable jsonb with an empty-object default';
  END IF;

  -- The historical schema used public.subscription_plan_type, while the clean
  -- production compatibility schema may use text. Resolve catalog OIDs first;
  -- never cast a possibly absent named type to regtype.
  SELECT type_row.oid, type_row.typtype
  INTO v_legacy_plan_type_oid, v_legacy_plan_type_kind
  FROM pg_type type_row
  JOIN pg_namespace namespace_row ON namespace_row.oid = type_row.typnamespace
  WHERE namespace_row.nspname = 'public'
    AND type_row.typname = 'subscription_plan_type';

  IF v_legacy_plan_type_oid IS NOT NULL THEN
    IF v_legacy_plan_type_kind <> 'e' THEN
      RAISE EXCEPTION 'Migration 021 prerequisite incompatible: public.subscription_plan_type exists but is not an enum';
    END IF;

    SELECT array_agg(enum_row.enumlabel::text ORDER BY enum_row.enumsortorder)
    INTO v_legacy_plan_labels
    FROM pg_enum enum_row
    WHERE enum_row.enumtypid = v_legacy_plan_type_oid;

    IF NOT COALESCE(
      v_legacy_plan_labels @> ARRAY['individual', 'corporate', 'starter']::text[],
      false
    ) THEN
      RAISE EXCEPTION 'Migration 021 prerequisite incompatible: public.subscription_plan_type must include individual, corporate, and starter';
    END IF;
  END IF;

  SELECT attribute.atttypid,
         format_type(attribute.atttypid, attribute.atttypmod)
  INTO v_subscription_plan_column_oid, v_subscription_plan_column_type
  FROM pg_attribute attribute
  WHERE attribute.attrelid = 'public.subscriptions'::regclass
    AND attribute.attname = 'plan_type'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  IF v_subscription_plan_column_type <> 'text'
     AND (
       v_legacy_plan_type_oid IS NULL
       OR v_subscription_plan_column_oid <> v_legacy_plan_type_oid
     ) THEN
    RAISE EXCEPTION
      'Migration 021 prerequisite incompatible: subscriptions.plan_type is %, expected text or canonical public.subscription_plan_type',
      v_subscription_plan_column_type;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payment_records'::regclass
      AND contype = 'u'
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.payment_records'::regclass AND attname = 'internal_reference')]::smallint[]
  ) THEN
    RAISE EXCEPTION 'Migration 021 prerequisite incompatible: payment_records.internal_reference must be unique';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.subscription_payments'::regclass
      AND contype = 'u'
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.subscription_payments'::regclass AND attname = 'paystack_ref')]::smallint[]
  ) THEN
    RAISE EXCEPTION 'Migration 021 prerequisite incompatible: subscription_payments.paystack_ref must be unique';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.subscriptions'::regclass
      AND contype = 'u'
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.subscriptions'::regclass AND attname = 'merchant_id')]::smallint[]
  ) THEN
    RAISE EXCEPTION 'Migration 021 prerequisite incompatible: subscriptions.merchant_id must be unique';
  END IF;

  SELECT count(*) INTO v_overload_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'confirm_paid_upgrade_v1';

  IF v_overload_count > 0 AND NOT (
    v_overload_count = 1 AND to_regprocedure(
      'public.confirm_paid_upgrade_v1(uuid,text,text,text,bigint,text,text,jsonb,jsonb)'
    ) IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Migration 021 unsafe drift: unexpected confirm_paid_upgrade_v1 overload';
  END IF;
END;
$$;

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS business_type text,
  ADD COLUMN IF NOT EXISTS subscription_notifications_sent jsonb DEFAULT '{}'::jsonb;

-- Repair a compatible historical definition that exists without its canonical
-- default. SET DEFAULT affects future writes only and does not rewrite row data.
ALTER TABLE public.merchants
  ALTER COLUMN subscription_notifications_sent SET DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.merchants.subscription_notifications_sent IS
  'Stores which notification thresholds have fired for the current billing cycle (e.g. { "7_day": "2026-05-08T07:00:00Z" }).';

CREATE OR REPLACE FUNCTION public.confirm_paid_upgrade_v1(
  p_payment_record_id uuid,
  p_provider text,
  p_internal_reference text,
  p_provider_reference text,
  p_amount_kobo bigint,
  p_currency text,
  p_customer_email text,
  p_provider_metadata jsonb,
  p_raw_provider_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment public.payment_records%ROWTYPE;
  v_merchant public.merchants%ROWTYPE;
  v_workspace public.workspaces%ROWTYPE;
  v_current_subscription public.subscriptions%ROWTYPE;
  v_existing_payment public.subscription_payments%ROWTYPE;
  v_workspace_subscription public.workspace_subscriptions%ROWTYPE;
  v_now timestamptz := now();
  v_plan text;
  v_storage_plan text;
  v_subscription_plan public.subscriptions.plan_type%TYPE;
  v_expected_amount_ngn numeric(10,2);
  v_expected_amount_kobo bigint;
  v_current_plan text;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_remaining_value numeric := 0;
  v_daily_rate numeric;
  v_relationship_claim text;
  v_workspace_type text;
BEGIN
  IF p_payment_record_id IS NULL THEN
    RAISE EXCEPTION 'confirm_paid_upgrade_v1 requires p_payment_record_id';
  END IF;

  SELECT * INTO v_payment
  FROM public.payment_records
  WHERE id = p_payment_record_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'reason', 'payment_record_not_found');
  END IF;

  IF v_payment.payment_purpose <> 'plan_upgrade' THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'reason', 'payment_purpose_invalid');
  END IF;

  v_plan := CASE
    WHEN lower(btrim(COALESCE(v_payment.plan_id, ''))) IN ('individual', 'solo_lite')
     AND lower(btrim(COALESCE(v_payment.plan_name, ''))) IN ('individual', 'solo_lite')
      THEN 'solo_lite'
    WHEN lower(btrim(COALESCE(v_payment.plan_id, ''))) IN ('corporate', 'business')
     AND lower(btrim(COALESCE(v_payment.plan_name, ''))) IN ('corporate', 'business')
      THEN 'business'
    ELSE NULL
  END;

  IF v_plan IS NULL THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'reason', 'paid_upgrade_plan_invalid');
  END IF;

  v_storage_plan := CASE WHEN v_plan = 'solo_lite' THEN 'individual' ELSE 'corporate' END;
  v_subscription_plan := v_storage_plan;
  v_expected_amount_ngn := CASE WHEN v_plan = 'solo_lite' THEN 5000.00 ELSE 20000.00 END;
  v_expected_amount_kobo := (v_expected_amount_ngn * 100)::bigint;

  IF v_payment.expected_amount IS NULL
     OR v_payment.expected_amount <= 0
     OR v_payment.expected_amount <> v_expected_amount_ngn THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'reason', 'expected_amount_invalid');
  END IF;

  IF v_payment.user_id IS NULL OR v_payment.merchant_id IS NULL
     OR NULLIF(btrim(COALESCE(v_payment.customer_email, '')), '') IS NULL THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'reason', 'payment_identity_missing');
  END IF;

  IF lower(btrim(COALESCE(v_payment.provider_name, ''))) NOT IN ('paystack', 'monnify', 'breet')
     OR lower(btrim(COALESCE(p_provider, ''))) <> lower(btrim(v_payment.provider_name)) THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'reason', 'provider_mismatch');
  END IF;

  IF upper(btrim(COALESCE(v_payment.currency, ''))) <> 'NGN'
     OR upper(btrim(COALESCE(p_currency, ''))) <> 'NGN' THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'reason', 'currency_mismatch');
  END IF;

  IF btrim(COALESCE(p_internal_reference, '')) <> v_payment.internal_reference
     OR NULLIF(btrim(COALESCE(p_provider_reference, '')), '') IS NULL THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'reason', 'reference_mismatch');
  END IF;

  IF v_payment.provider_reference IS NOT NULL
     AND v_payment.provider_reference <> v_payment.internal_reference
     AND v_payment.provider_reference <> p_provider_reference THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'reason', 'provider_reference_mismatch');
  END IF;

  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 OR p_amount_kobo <> v_expected_amount_kobo THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'reason', 'amount_mismatch');
  END IF;

  IF lower(btrim(COALESCE(p_customer_email, ''))) <> lower(btrim(v_payment.customer_email)) THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'reason', 'email_mismatch');
  END IF;

  IF COALESCE(p_provider_metadata, '{}'::jsonb)->>'merchant_id' IS DISTINCT FROM v_payment.merchant_id::text
     OR lower(COALESCE(p_provider_metadata->>'type', '')) <> 'subscription_upgrade'
     OR lower(COALESCE(p_provider_metadata->>'payment_purpose', '')) <> 'plan_upgrade'
     OR lower(COALESCE(p_provider_metadata->>'resolved_provider', '')) <> lower(v_payment.provider_name)
     OR lower(COALESCE(p_provider_metadata->>'email', '')) <> lower(v_payment.customer_email)
     OR COALESCE(p_provider_metadata->>'amount_expected_kobo', '') !~ '^[0-9]+$' THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'reason', 'provider_metadata_mismatch');
  END IF;

  IF v_plan = 'solo_lite' THEN
    IF lower(COALESCE(p_provider_metadata->>'new_plan', '')) NOT IN ('individual', 'solo_lite') THEN
      RETURN jsonb_build_object('kind', 'state_conflict', 'reason', 'provider_metadata_mismatch');
    END IF;
  ELSIF v_plan = 'business' THEN
    IF lower(COALESCE(p_provider_metadata->>'new_plan', '')) NOT IN ('corporate', 'business') THEN
      RETURN jsonb_build_object('kind', 'state_conflict', 'reason', 'provider_metadata_mismatch');
    END IF;
  ELSE
    RETURN jsonb_build_object('kind', 'state_conflict', 'reason', 'paid_upgrade_plan_invalid');
  END IF;

  IF (p_provider_metadata->>'amount_expected_kobo')::bigint <> v_expected_amount_kobo THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'reason', 'provider_metadata_mismatch');
  END IF;

  IF v_payment.payment_status = 'successful'
     AND v_payment.processing_status = 'processed'
     AND v_payment.account_setup_status = 'paid_pending_setup' THEN
    SELECT * INTO v_existing_payment
    FROM public.subscription_payments
    WHERE paystack_ref = v_payment.internal_reference;

    IF FOUND
       AND v_existing_payment.merchant_id = v_payment.merchant_id
       AND v_existing_payment.amount_ngn = v_expected_amount_ngn
       AND lower(v_existing_payment.status) = 'paid' THEN
      RETURN jsonb_build_object('kind', 'idempotent_replay', 'payment_record_id', v_payment.id);
    END IF;

    RETURN jsonb_build_object('kind', 'state_conflict', 'reason', 'processed_ledger_inconsistent');
  END IF;

  IF v_payment.payment_status <> 'pending'
     OR v_payment.processing_status <> 'pending_payment'
     OR v_payment.account_setup_status <> 'pending_payment' THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'reason', 'payment_record_not_pending');
  END IF;

  SELECT * INTO v_merchant
  FROM public.merchants
  WHERE id = v_payment.merchant_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_merchant.user_id IS DISTINCT FROM v_payment.user_id
     OR lower(btrim(v_merchant.email)) <> lower(btrim(v_payment.customer_email)) THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'reason', 'merchant_identity_mismatch');
  END IF;

  v_current_plan := lower(btrim(COALESCE(v_merchant.subscription_plan, v_merchant.merchant_tier, 'starter')));
  IF (v_plan = 'solo_lite' AND v_current_plan <> 'starter')
     OR (v_plan = 'business' AND v_current_plan NOT IN ('starter', 'individual', 'solo_lite')) THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'reason', 'merchant_plan_not_upgradeable');
  END IF;

  SELECT * INTO v_workspace
  FROM public.workspaces
  WHERE merchant_id = v_merchant.id
  ORDER BY created_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;

  v_workspace_type := CASE WHEN v_plan = 'solo_lite' THEN 'personal' ELSE 'business' END;
  IF NOT FOUND THEN
    INSERT INTO public.workspaces (
      owner_user_id, merchant_id, workspace_type, display_name, plan_type,
      onboarding_status, setup_mode, live_features_enabled
    ) VALUES (
      v_merchant.user_id, v_merchant.id, v_workspace_type,
      COALESCE(NULLIF(btrim(v_merchant.business_name), ''), 'DeraLedger Workspace'),
      v_storage_plan, 'setup_mode', true, false
    ) RETURNING * INTO v_workspace;
  END IF;

  SELECT * INTO v_current_subscription
  FROM public.subscriptions
  WHERE merchant_id = v_merchant.id
  FOR UPDATE;

  v_period_start := v_now;
  IF FOUND AND v_current_subscription.expiry_date > v_now THEN
    v_period_start := v_current_subscription.expiry_date;
    IF lower(v_current_subscription.plan_type::text) = 'individual' THEN
      v_remaining_value := EXTRACT(EPOCH FROM (v_current_subscription.expiry_date - v_now)) / 86400 * (5000.0 / 30.0);
    ELSIF lower(v_current_subscription.plan_type::text) = 'corporate' THEN
      v_remaining_value := EXTRACT(EPOCH FROM (v_current_subscription.expiry_date - v_now)) / 86400 * (20000.0 / 30.0);
    END IF;
  END IF;

  v_daily_rate := CASE WHEN v_plan = 'solo_lite' THEN 5000.0 / 30.0 ELSE 20000.0 / 30.0 END;
  v_period_end := v_now + ((v_expected_amount_ngn + v_remaining_value) / v_daily_rate) * interval '1 day';
  v_relationship_claim := NULLIF(btrim(COALESCE(v_payment.metadata->>'relationship_claim', '')), '');
  IF v_relationship_claim NOT IN ('owner_affiliated_claim', 'representative_claim') THEN
    v_relationship_claim := NULL;
  END IF;

  PERFORM 1 FROM public.workspace_subscriptions
  WHERE merchant_id = v_merchant.id
    AND (workspace_id = v_workspace.id OR workspace_id IS NULL)
  FOR UPDATE;

  SELECT * INTO v_workspace_subscription
  FROM public.workspace_subscriptions
  WHERE merchant_id = v_merchant.id
    AND payment_reference = v_payment.internal_reference
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF EXISTS (
    SELECT 1 FROM public.subscription_payments
    WHERE paystack_ref = v_payment.internal_reference
  ) THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'reason', 'ledger_exists_before_activation');
  END IF;

  UPDATE public.merchants
  SET subscription_plan = v_storage_plan,
      merchant_tier = v_storage_plan,
      monthly_collection_limit = CASE WHEN v_plan = 'solo_lite' THEN 5000000 ELSE 0 END,
      subscription_notifications_sent = '{}'::jsonb,
      relationship_claim = COALESCE(v_relationship_claim, relationship_claim),
      workspace_id = v_workspace.id,
      onboarding_status = 'setup_mode',
      setup_mode = true,
      live_features_enabled = false,
      paid_setup_started_at = COALESCE(paid_setup_started_at, v_now),
      updated_at = v_now
  WHERE id = v_merchant.id;

  UPDATE public.workspaces
  SET owner_user_id = v_merchant.user_id,
      workspace_type = v_workspace_type,
      plan_type = v_storage_plan,
      onboarding_status = 'setup_mode',
      setup_mode = true,
      live_features_enabled = false,
      updated_at = v_now
  WHERE id = v_workspace.id;

  IF v_workspace_subscription.id IS NULL THEN
    INSERT INTO public.workspace_subscriptions (
      workspace_id, merchant_id, plan_type, subscription_status,
      payment_reference, amount_paid, period_start, period_end
    ) VALUES (
      v_workspace.id, v_merchant.id, v_storage_plan, 'paid_setup',
      v_payment.internal_reference, v_expected_amount_ngn, v_now, v_period_end
    );
  ELSE
    UPDATE public.workspace_subscriptions
    SET workspace_id = v_workspace.id,
        plan_type = v_storage_plan,
        subscription_status = 'paid_setup',
        amount_paid = v_expected_amount_ngn,
        period_start = v_now,
        period_end = v_period_end,
        updated_at = v_now
    WHERE id = v_workspace_subscription.id;
  END IF;

  INSERT INTO public.subscriptions (
    merchant_id, plan_type, amount_paid, start_date, expiry_date, status,
    last_notified_at, is_banner_dismissed, updated_at
  ) VALUES (
    v_merchant.id, v_subscription_plan,
    v_expected_amount_ngn, v_now, v_period_end, 'active', NULL, false, v_now
  )
  ON CONFLICT (merchant_id) DO UPDATE
  SET plan_type = EXCLUDED.plan_type,
      amount_paid = EXCLUDED.amount_paid,
      start_date = EXCLUDED.start_date,
      expiry_date = EXCLUDED.expiry_date,
      status = EXCLUDED.status,
      last_notified_at = NULL,
      is_banner_dismissed = false,
      updated_at = v_now;

  -- A ledger insert error is intentionally not caught: PostgreSQL rolls back
  -- every merchant/workspace/subscription change in this function call.
  INSERT INTO public.subscription_payments (
    merchant_id, plan, amount_ngn, period_start, period_end,
    paystack_ref, payment_type, status
  ) VALUES (
    v_merchant.id, v_storage_plan, v_expected_amount_ngn, v_period_start,
    v_period_end, v_payment.internal_reference, 'upgrade', 'paid'
  );

  UPDATE public.payment_records
  SET provider_reference = p_provider_reference,
      amount_paid = v_expected_amount_ngn,
      payment_status = 'successful',
      processing_status = 'processed',
      account_setup_status = 'paid_pending_setup',
      failure_reason = NULL,
      raw_provider_payload = COALESCE(p_raw_provider_payload, p_provider_metadata, '{}'::jsonb),
      paid_at = v_now,
      updated_at = v_now
  WHERE id = v_payment.id;

  RETURN jsonb_build_object(
    'kind', 'applied',
    'payment_record_id', v_payment.id,
    'merchant_id', v_merchant.id,
    'workspace_id', v_workspace.id,
    'plan', v_plan,
    'amount_ngn', v_expected_amount_ngn
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_paid_upgrade_v1(uuid,text,text,text,bigint,text,text,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_paid_upgrade_v1(uuid,text,text,text,bigint,text,text,jsonb,jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.confirm_paid_upgrade_v1(uuid,text,text,text,bigint,text,text,jsonb,jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_paid_upgrade_v1(uuid,text,text,text,bigint,text,text,jsonb,jsonb) TO service_role;

COMMIT;
