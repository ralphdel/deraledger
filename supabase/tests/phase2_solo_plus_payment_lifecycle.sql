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

DO $$
DECLARE
  v_case_id UUID;
  v_payment_id UUID;
  v_crypto_session_id UUID;
  v_onboarding_session_id UUID;
  v_result JSONB;
  v_event_count BIGINT;
  v_payment_count BIGINT;
BEGIN
  IF to_regclass('public.payment_sessions') IS NULL THEN
    RAISE EXCEPTION 'expected Migration A prerequisite public.payment_sessions';
  END IF;

  IF to_regclass('public.crypto_payment_sessions') IS NULL THEN
    RAISE EXCEPTION 'expected Migration A prerequisite public.crypto_payment_sessions';
  END IF;

  IF to_regclass('public.settlement_records') IS NULL THEN
    RAISE EXCEPTION 'expected Migration A prerequisite public.settlement_records';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'crypto_payment_sessions'
      AND column_name = 'payment_record_id'
  ) THEN
    RAISE EXCEPTION 'expected public.crypto_payment_sessions.payment_record_id';
  END IF;

  IF to_regclass('public.onboarding_sessions') IS NULL THEN
    RAISE EXCEPTION 'expected public.onboarding_sessions to exist';
  END IF;

  IF to_regclass('public.solo_plus_case_events') IS NULL THEN
    RAISE EXCEPTION 'expected public.solo_plus_case_events to exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'solo_plus_assert_amount_v1'
  ) THEN
    RAISE EXCEPTION 'expected public.solo_plus_assert_amount_v1';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'solo_plus_case_bundle_payload_v1'
  ) THEN
    RAISE EXCEPTION 'expected public.solo_plus_case_bundle_payload_v1';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'solo_plus_case_events'
      AND indexname = 'idx_solo_plus_case_events_request_idempotency'
  ) THEN
    RAISE EXCEPTION 'expected idx_solo_plus_case_events_request_idempotency';
  END IF;

  PERFORM pg_temp.assert_service_role_only_function_execute('confirm_solo_plus_payment_v1');

  INSERT INTO public.onboarding_sessions (
    id,
    email,
    business_name,
    plan,
    status,
    idempotency_key,
    expires_at
  )
  VALUES (
    gen_random_uuid(),
    'solo-plus-payment-lifecycle@example.test',
    'Solo Plus Payment Lifecycle',
    'solo_plus',
    'awaiting_payment',
    'solo-plus-payment-lifecycle',
    now() + interval '7 days'
  )
  RETURNING id INTO v_onboarding_session_id;

  INSERT INTO public.solo_plus_cases (
    onboarding_session_id,
    flow_origin,
    source_plan,
    target_plan,
    case_status,
    payment_status,
    refund_status,
    expected_amount,
    payment_currency,
    requirements_policy_version,
    requirements_snapshot,
    active_plan_snapshot,
    idempotency_key,
    audit_metadata
  )
  VALUES (
    v_onboarding_session_id,
    'onboarding',
    NULL,
    'solo_plus',
    'awaiting_payment',
    'pending',
    'none',
    13000.00,
    'NGN',
    'solo-plus-payment-init-v1',
    '{"test":true}'::jsonb,
    NULL,
    'solo-plus-payment-lifecycle-case',
    '{}'::jsonb
  )
  RETURNING id INTO v_case_id;

  INSERT INTO public.payment_records (
    onboarding_session_id,
    solo_plus_case_id,
    payment_purpose,
    payment_method,
    provider_name,
    internal_reference,
    amount_paid,
    expected_amount,
    currency,
    payment_status,
    processing_status,
    account_setup_status,
    customer_email,
    metadata,
    raw_provider_payload
  )
  VALUES (
    v_onboarding_session_id,
    v_case_id,
    'plan_subscription',
    'card',
    'paystack',
    'SPL-SUB-TEST',
    0,
    13000.00,
    'NGN',
    'pending',
    'pending_payment',
    'pending_payment',
    'solo-plus-payment-lifecycle@example.test',
    '{}'::jsonb,
    '{}'::jsonb
  )
  RETURNING id INTO v_payment_id;

  INSERT INTO public.crypto_payment_sessions (
    id,
    merchant_id,
    user_id,
    business_id,
    plan_id,
    payment_record_id,
    payment_purpose,
    provider_name,
    internal_reference,
    provider_reference,
    payment_method,
    expected_ngn_amount,
    crypto_asset,
    crypto_network,
    crypto_amount_expected,
    settlement_mode,
    settlement_recipient_type,
    crypto_status,
    settlement_status,
    webhook_status,
    payment_status,
    payment_session_reference,
    expires_at,
    raw_payload,
    raw_webhook_payload,
    metadata
  )
  VALUES (
    gen_random_uuid(),
    NULL,
    NULL,
    NULL,
    'solo_plus',
    v_payment_id,
    'plan_subscription',
    'breet',
    'SPL-SUB-TEST-CRYPTO',
    'breet-session-ref-1',
    'crypto',
    13000.00,
    'USDT',
    'TRON',
    8.00000000,
    'platform_auto_settlement',
    'platform',
    'crypto_payment_initialized',
    'pending',
    'pending',
    'pending',
    v_onboarding_session_id::text,
    now() + interval '1 day',
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb
  )
  RETURNING id INTO v_crypto_session_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.crypto_payment_sessions
    WHERE id = v_crypto_session_id
      AND payment_record_id = v_payment_id
      AND settlement_recipient_type = 'platform'
      AND settlement_mode = 'platform_auto_settlement'
  ) THEN
    RAISE EXCEPTION 'crypto_payment_sessions did not preserve relational payment_record_id linkage';
  END IF;

  v_result := public.confirm_solo_plus_payment_v1(
    'SPL-SUB-TEST',
    'paystack',
    'paystack-ref-1',
    'plan_subscription',
    '13000.00',
    'NGN',
    NULL,
    v_onboarding_session_id,
    NULL,
    '{"provider":"paystack"}'::jsonb,
    'solo-plus-test-payment-confirmed'
  );

  IF v_result->>'kind' <> 'confirmed' THEN
    RAISE EXCEPTION 'expected confirmed result, got %', v_result;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.solo_plus_cases
    WHERE id = v_case_id
      AND case_status = 'verification_pending'
      AND payment_status = 'paid'
      AND payment_record_id = v_payment_id
      AND payment_provider = 'paystack'
      AND payment_reference = 'paystack-ref-1'
  ) THEN
    RAISE EXCEPTION 'solo_plus_cases was not updated to verification_pending/paid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.payment_records
    WHERE id = v_payment_id
      AND payment_status = 'successful'
      AND processing_status = 'paid_pending_verification'
      AND account_setup_status = 'verification_pending'
      AND provider_reference = 'paystack-ref-1'
  ) THEN
    RAISE EXCEPTION 'payment_records was not updated to successful verification-pending state';
  END IF;

  v_result := public.confirm_solo_plus_payment_v1(
    'SPL-SUB-TEST',
    'paystack',
    'paystack-ref-1',
    'plan_subscription',
    '13000.00',
    'NGN',
    NULL,
    v_onboarding_session_id,
    NULL,
    '{"provider":"paystack"}'::jsonb,
    'solo-plus-test-payment-confirmed'
  );

  IF v_result->>'kind' <> 'idempotent_replay' THEN
    RAISE EXCEPTION 'expected idempotent replay, got %', v_result;
  END IF;

  v_result := public.confirm_solo_plus_payment_v1(
    'SPL-SUB-TEST',
    'paystack',
    'paystack-ref-conflict',
    'plan_subscription',
    '13000.00',
    'NGN',
    NULL,
    v_onboarding_session_id,
    NULL,
    '{"provider":"paystack"}'::jsonb,
    'solo-plus-test-payment-conflict'
  );

  IF v_result->>'kind' <> 'conflicting_replay' THEN
    RAISE EXCEPTION 'expected conflicting_replay, got %', v_result;
  END IF;

  SELECT count(*)
  INTO v_event_count
  FROM public.solo_plus_case_events
  WHERE case_id = v_case_id
    AND event_type = 'payment_confirmed';

  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly one payment_confirmed event, got %', v_event_count;
  END IF;

  SELECT count(*)
  INTO v_payment_count
  FROM public.payment_records
  WHERE internal_reference = 'SPL-SUB-TEST';

  IF v_payment_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly one Solo Plus payment_record after replay checks, got %', v_payment_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.onboarding_sessions
    WHERE id = v_onboarding_session_id
      AND status <> 'awaiting_payment'
  ) THEN
    RAISE EXCEPTION 'onboarding session status unexpectedly changed during Solo Plus payment confirmation';
  END IF;
END $$;

DO $$
DECLARE
  v_case_id UUID;
  v_payment_id UUID;
  v_onboarding_session_id UUID;
  v_upgrade_case_id UUID;
  v_upgrade_payment_id UUID;
  v_upgrade_merchant_id UUID;
  v_wrong_session_id UUID;
  v_result JSONB;
  v_upgrade_live_features_enabled BOOLEAN;
  v_upgrade_setup_mode BOOLEAN;
  v_upgrade_subscriptions_before BIGINT := 0;
  v_upgrade_subscriptions_after BIGINT := 0;
  v_upgrade_subscriptions_before_state TEXT[] := ARRAY[]::TEXT[];
  v_upgrade_subscriptions_after_state TEXT[] := ARRAY[]::TEXT[];
  v_upgrade_workspace_subscriptions_before BIGINT := 0;
  v_upgrade_workspace_subscriptions_after BIGINT := 0;
  v_upgrade_workspace_subscriptions_before_state TEXT[] := ARRAY[]::TEXT[];
  v_upgrade_workspace_subscriptions_after_state TEXT[] := ARRAY[]::TEXT[];
  v_protected_flag_state_before TEXT[] := ARRAY[]::TEXT[];
  v_protected_flag_state_after TEXT[] := ARRAY[]::TEXT[];
  v_upgrade_user_id UUID := '00000000-0000-4000-8000-000000000901'::uuid;
BEGIN
  -- Current canonical capability state does not use a separate entitlement table in
  -- this schema fixture. Capability immutability is represented by merchant plan,
  -- setup_mode, live_features_enabled, subscription rows, workspace subscription
  -- rows, and protected Solo Plus feature flags.
  INSERT INTO public.onboarding_sessions (
    id,
    email,
    business_name,
    plan,
    status,
    idempotency_key,
    expires_at
  )
  VALUES (
    gen_random_uuid(),
    'solo-plus-negative@example.test',
    'Solo Plus Negative Case',
    'solo_plus',
    'awaiting_payment',
    'solo-plus-negative',
    now() + interval '7 days'
  )
  RETURNING id INTO v_onboarding_session_id;

  INSERT INTO public.onboarding_sessions (
    id,
    email,
    business_name,
    plan,
    status,
    idempotency_key,
    expires_at
  )
  VALUES (
    gen_random_uuid(),
    'solo-plus-negative-other@example.test',
    'Solo Plus Negative Other',
    'solo_plus',
    'awaiting_payment',
    'solo-plus-negative-other',
    now() + interval '7 days'
  )
  RETURNING id INTO v_wrong_session_id;

  INSERT INTO public.solo_plus_cases (
    onboarding_session_id,
    flow_origin,
    source_plan,
    target_plan,
    case_status,
    payment_status,
    refund_status,
    expected_amount,
    payment_currency,
    requirements_policy_version,
    requirements_snapshot,
    active_plan_snapshot,
    idempotency_key,
    audit_metadata
  )
  VALUES (
    v_onboarding_session_id,
    'onboarding',
    NULL,
    'solo_plus',
    'awaiting_payment',
    'pending',
    'none',
    13000.00,
    'NGN',
    'solo-plus-payment-init-v1',
    '{"test":true}'::jsonb,
    NULL,
    'solo-plus-negative-case',
    '{}'::jsonb
  )
  RETURNING id INTO v_case_id;

  INSERT INTO public.payment_records (
    onboarding_session_id,
    solo_plus_case_id,
    payment_purpose,
    payment_method,
    provider_name,
    internal_reference,
    amount_paid,
    expected_amount,
    currency,
    payment_status,
    processing_status,
    account_setup_status,
    customer_email,
    metadata,
    raw_provider_payload
  )
  VALUES (
    v_onboarding_session_id,
    v_case_id,
    'plan_subscription',
    'card',
    'paystack',
    'SPL-NEG-TEST',
    0,
    13000.00,
    'NGN',
    'pending',
    'pending_payment',
    'pending_payment',
    'solo-plus-negative@example.test',
    '{}'::jsonb,
    '{}'::jsonb
  )
  RETURNING id INTO v_payment_id;

  v_result := public.confirm_solo_plus_payment_v1(
    'SPL-NEG-TEST',
    'monnify',
    'monnify-ref-neg',
    'plan_subscription',
    '13000.00',
    'NGN',
    NULL,
    v_onboarding_session_id,
    NULL,
    '{}'::jsonb,
    'solo-plus-negative-provider'
  );
  IF v_result->>'kind' <> 'provider_conflict' THEN
    RAISE EXCEPTION 'expected provider_conflict, got %', v_result;
  END IF;

  v_result := public.confirm_solo_plus_payment_v1(
    'SPL-NEG-TEST',
    'paystack',
    'paystack-ref-neg',
    'plan_subscription',
    '13000.00',
    'USD',
    NULL,
    v_onboarding_session_id,
    NULL,
    '{}'::jsonb,
    'solo-plus-negative-currency'
  );
  IF v_result->>'kind' <> 'currency_conflict' THEN
    RAISE EXCEPTION 'expected currency_conflict, got %', v_result;
  END IF;

  v_result := public.confirm_solo_plus_payment_v1(
    'SPL-NEG-TEST',
    'paystack',
    'paystack-ref-neg',
    'plan_subscription',
    '12000.00',
    'NGN',
    NULL,
    v_onboarding_session_id,
    NULL,
    '{}'::jsonb,
    'solo-plus-negative-amount'
  );
  IF v_result->>'kind' <> 'amount_mismatch' THEN
    RAISE EXCEPTION 'expected amount_mismatch, got %', v_result;
  END IF;

  v_result := public.confirm_solo_plus_payment_v1(
    'SPL-NEG-TEST',
    'paystack',
    'paystack-ref-neg',
    'plan_renewal',
    '13000.00',
    'NGN',
    NULL,
    v_onboarding_session_id,
    NULL,
    '{}'::jsonb,
    'solo-plus-negative-renewal'
  );
  IF v_result->>'kind' <> 'purpose_conflict' THEN
    RAISE EXCEPTION 'expected purpose_conflict for renewal, got %', v_result;
  END IF;

  v_result := public.confirm_solo_plus_payment_v1(
    'SPL-NEG-TEST',
    'paystack',
    'paystack-ref-neg',
    'plan_subscription',
    '13000.00',
    'NGN',
    NULL,
    v_wrong_session_id,
    NULL,
    '{}'::jsonb,
    'solo-plus-negative-ownership'
  );
  IF v_result->>'kind' <> 'ownership_conflict' THEN
    RAISE EXCEPTION 'expected ownership_conflict, got %', v_result;
  END IF;

  INSERT INTO auth.users (id)
  VALUES (v_upgrade_user_id)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.merchants (
    user_id,
    business_name,
    email,
    subscription_plan,
    merchant_tier,
    verification_status
  )
  VALUES (
    v_upgrade_user_id,
    'Solo Plus Upgrade Negative Merchant',
    'solo-plus-upgrade-negative@example.test',
    'solo_lite',
    'individual',
    'unverified'
  )
  RETURNING id INTO v_upgrade_merchant_id;

  SELECT live_features_enabled, setup_mode
  INTO v_upgrade_live_features_enabled, v_upgrade_setup_mode
  FROM public.merchants
  WHERE id = v_upgrade_merchant_id;

  IF to_regclass('public.platform_settings') IS NOT NULL THEN
    SELECT COALESCE(array_agg(key || '=' || value ORDER BY key), ARRAY[]::TEXT[])
    INTO v_protected_flag_state_before
    FROM public.platform_settings
    WHERE key IN (
      'plan_migration_solo_lite_enabled',
      'solo_plus_enabled',
      'solo_plus_kyc_enabled'
    );
  END IF;

  IF to_regclass('public.subscriptions') IS NOT NULL THEN
    SELECT count(*)
    INTO v_upgrade_subscriptions_before
    FROM public.subscriptions
    WHERE merchant_id = v_upgrade_merchant_id;

    SELECT COALESCE(array_agg(md5(to_jsonb(s)::text) ORDER BY md5(to_jsonb(s)::text)), ARRAY[]::TEXT[])
    INTO v_upgrade_subscriptions_before_state
    FROM public.subscriptions s
    WHERE merchant_id = v_upgrade_merchant_id;
  END IF;

  IF to_regclass('public.workspace_subscriptions') IS NOT NULL THEN
    SELECT count(*)
    INTO v_upgrade_workspace_subscriptions_before
    FROM public.workspace_subscriptions
    WHERE merchant_id = v_upgrade_merchant_id;

    SELECT COALESCE(array_agg(md5(to_jsonb(ws)::text) ORDER BY md5(to_jsonb(ws)::text)), ARRAY[]::TEXT[])
    INTO v_upgrade_workspace_subscriptions_before_state
    FROM public.workspace_subscriptions ws
    WHERE merchant_id = v_upgrade_merchant_id;
  END IF;

  INSERT INTO public.solo_plus_cases (
    merchant_id,
    flow_origin,
    source_plan,
    target_plan,
    case_status,
    payment_status,
    refund_status,
    expected_amount,
    payment_currency,
    requirements_policy_version,
    requirements_snapshot,
    active_plan_snapshot,
    idempotency_key,
    audit_metadata
  )
  VALUES (
    v_upgrade_merchant_id,
    'upgrade',
    'solo_lite',
    'solo_plus',
    'awaiting_payment',
    'pending',
    'none',
    13000.00,
    'NGN',
    'solo-plus-payment-init-v1',
    '{"test":true}'::jsonb,
    'solo_lite',
    'solo-plus-upgrade-negative-case',
    '{}'::jsonb
  )
  RETURNING id INTO v_upgrade_case_id;

  INSERT INTO public.payment_records (
    merchant_id,
    solo_plus_case_id,
    payment_purpose,
    payment_method,
    provider_name,
    internal_reference,
    amount_paid,
    expected_amount,
    currency,
    payment_status,
    processing_status,
    account_setup_status,
    customer_email,
    metadata,
    raw_provider_payload
  )
  VALUES (
    v_upgrade_merchant_id,
    v_upgrade_case_id,
    'plan_upgrade',
    'card',
    'paystack',
    'SPL-UPG-NEG-TEST',
    0,
    13000.00,
    'NGN',
    'pending',
    'pending_payment',
    'pending_payment',
    'solo-plus-upgrade-negative@example.test',
    '{}'::jsonb,
    '{}'::jsonb
  )
  RETURNING id INTO v_upgrade_payment_id;

  v_result := public.confirm_solo_plus_payment_v1(
    'SPL-UPG-NEG-TEST',
    'paystack',
    'paystack-ref-upg-neg',
    'plan_upgrade',
    '13000.00',
    'NGN',
    gen_random_uuid(),
    NULL,
    NULL,
    '{}'::jsonb,
    'solo-plus-upgrade-negative-owner'
  );
  IF v_result->>'kind' <> 'ownership_conflict' THEN
    RAISE EXCEPTION 'expected upgrade ownership_conflict, got %', v_result;
  END IF;

  v_result := public.confirm_solo_plus_payment_v1(
    'SPL-UPG-NEG-TEST',
    'paystack',
    'paystack-ref-upg-neg',
    'plan_upgrade',
    '13000.00',
    'NGN',
    v_upgrade_merchant_id,
    NULL,
    NULL,
    '{}'::jsonb,
    'solo-plus-upgrade-negative-confirmed'
  );
  IF v_result->>'kind' <> 'confirmed' THEN
    RAISE EXCEPTION 'expected upgrade confirmed result, got %', v_result;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.merchants
    WHERE id = v_upgrade_merchant_id
      AND subscription_plan <> 'solo_lite'
  ) THEN
    RAISE EXCEPTION 'upgrade confirmation unexpectedly changed merchant subscription_plan';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.merchants
    WHERE id = v_upgrade_merchant_id
      AND live_features_enabled IS DISTINCT FROM v_upgrade_live_features_enabled
  ) THEN
    RAISE EXCEPTION 'upgrade confirmation unexpectedly changed merchant live_features_enabled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.merchants
    WHERE id = v_upgrade_merchant_id
      AND setup_mode IS DISTINCT FROM v_upgrade_setup_mode
  ) THEN
    RAISE EXCEPTION 'upgrade confirmation unexpectedly changed merchant setup_mode';
  END IF;

  IF to_regclass('public.subscriptions') IS NOT NULL THEN
    SELECT count(*)
    INTO v_upgrade_subscriptions_after
    FROM public.subscriptions
    WHERE merchant_id = v_upgrade_merchant_id;

    SELECT COALESCE(array_agg(md5(to_jsonb(s)::text) ORDER BY md5(to_jsonb(s)::text)), ARRAY[]::TEXT[])
    INTO v_upgrade_subscriptions_after_state
    FROM public.subscriptions s
    WHERE merchant_id = v_upgrade_merchant_id;

    IF v_upgrade_subscriptions_after <> v_upgrade_subscriptions_before THEN
      RAISE EXCEPTION 'upgrade confirmation unexpectedly changed subscriptions rows for merchant';
    END IF;

    IF v_upgrade_subscriptions_after_state <> v_upgrade_subscriptions_before_state THEN
      RAISE EXCEPTION 'upgrade confirmation unexpectedly changed subscriptions row state for merchant';
    END IF;
  END IF;

  IF to_regclass('public.workspace_subscriptions') IS NOT NULL THEN
    SELECT count(*)
    INTO v_upgrade_workspace_subscriptions_after
    FROM public.workspace_subscriptions
    WHERE merchant_id = v_upgrade_merchant_id;

    SELECT COALESCE(array_agg(md5(to_jsonb(ws)::text) ORDER BY md5(to_jsonb(ws)::text)), ARRAY[]::TEXT[])
    INTO v_upgrade_workspace_subscriptions_after_state
    FROM public.workspace_subscriptions ws
    WHERE merchant_id = v_upgrade_merchant_id;

    IF v_upgrade_workspace_subscriptions_after <> v_upgrade_workspace_subscriptions_before THEN
      RAISE EXCEPTION 'upgrade confirmation unexpectedly changed workspace_subscriptions rows for merchant';
    END IF;

    IF v_upgrade_workspace_subscriptions_after_state <> v_upgrade_workspace_subscriptions_before_state THEN
      RAISE EXCEPTION 'upgrade confirmation unexpectedly changed workspace_subscriptions row state for merchant';
    END IF;
  END IF;

  IF to_regclass('public.platform_settings') IS NOT NULL THEN
    SELECT COALESCE(array_agg(key || '=' || value ORDER BY key), ARRAY[]::TEXT[])
    INTO v_protected_flag_state_after
    FROM public.platform_settings
    WHERE key IN (
      'plan_migration_solo_lite_enabled',
      'solo_plus_enabled',
      'solo_plus_kyc_enabled'
    );

    IF v_protected_flag_state_after <> v_protected_flag_state_before THEN
      RAISE EXCEPTION 'upgrade confirmation unexpectedly changed protected Solo Plus feature flags';
    END IF;
  END IF;
END $$;

ROLLBACK;
