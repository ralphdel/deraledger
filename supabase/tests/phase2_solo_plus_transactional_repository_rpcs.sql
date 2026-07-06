BEGIN;

DO $$
DECLARE
  v_auth_user_columns TEXT[];
  v_auth_user_values TEXT[];
  v_auth_user_email TEXT;
  v_admin_user_id UUID := gen_random_uuid();
  v_onboarding_merchant_id UUID;
  v_upgrade_merchant_id UUID;
  v_conflict_merchant_id UUID;
  v_attach_conflict_merchant_id UUID;
  v_stale_attach_merchant_id UUID;
  v_terminal_merchant_id UUID;
  v_onboarding_session_id UUID;
  v_second_onboarding_session_id UUID;
  v_attach_conflict_onboarding_session_id UUID := gen_random_uuid();
  v_terminal_attach_onboarding_session_id UUID := gen_random_uuid();
  v_stale_attach_onboarding_session_id UUID := gen_random_uuid();
  v_invalid_negative_onboarding_session_id UUID := gen_random_uuid();
  v_invalid_scale_onboarding_session_id UUID := gen_random_uuid();
  v_invalid_overflow_onboarding_session_id UUID := gen_random_uuid();
  v_invalid_snapshot_type_onboarding_session_id UUID := gen_random_uuid();
  v_invalid_snapshot_sensitive_onboarding_session_id UUID := gen_random_uuid();
  v_invalid_snapshot_nested_onboarding_session_id UUID := gen_random_uuid();
  v_normalized_amount_onboarding_session_id UUID := gen_random_uuid();
  v_max_boundary_onboarding_session_id UUID := gen_random_uuid();
  v_create_result JSONB;
  v_replay_result JSONB;
  v_case_id UUID;
  v_upgrade_case_id UUID;
  v_attach_case_id UUID;
  v_stale_attach_case_id UUID;
  v_transition_case_id UUID;
  v_normalized_amount_case_id UUID;
  v_max_boundary_case_id UUID;
  v_event_count INTEGER;
  v_requirement_count INTEGER;
  v_case_count INTEGER;
  v_procedure_oid OID;
  v_kind TEXT;
  v_stored_expected_amount NUMERIC(18,2);
  v_stored_expected_amount_text TEXT;
BEGIN
  v_auth_user_email := format(
    'phase2-solo-plus-rpc-%s@example.test',
    replace(v_admin_user_id::text, '-', '')
  );

  v_auth_user_columns := ARRAY['id'];
  v_auth_user_values := ARRAY[quote_literal(v_admin_user_id::text) || '::uuid'];

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'instance_id'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'instance_id');
    v_auth_user_values := array_append(v_auth_user_values, quote_literal('00000000-0000-0000-0000-000000000000') || '::uuid');
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'users' AND column_name IN ('aud', 'role')
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'aud'
    ) THEN
      v_auth_user_columns := array_append(v_auth_user_columns, 'aud');
      v_auth_user_values := array_append(v_auth_user_values, quote_literal('authenticated'));
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'role'
    ) THEN
      v_auth_user_columns := array_append(v_auth_user_columns, 'role');
      v_auth_user_values := array_append(v_auth_user_values, quote_literal('authenticated'));
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'email');
    v_auth_user_values := array_append(v_auth_user_values, quote_literal(v_auth_user_email));
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'encrypted_password'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'encrypted_password');
    v_auth_user_values := array_append(v_auth_user_values, quote_literal('$2a$10$abcdefghijklmnopqrstuuJzM1rjQYDyS9mWGTH0I1GtIsfRSAxE6'));
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_confirmed_at'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'email_confirmed_at');
    v_auth_user_values := array_append(v_auth_user_values, 'now()');
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'raw_app_meta_data'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'raw_app_meta_data');
    v_auth_user_values := array_append(v_auth_user_values, quote_literal('{}') || '::jsonb');
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'raw_user_meta_data'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'raw_user_meta_data');
    v_auth_user_values := array_append(v_auth_user_values, quote_literal('{}') || '::jsonb');
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'created_at'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'created_at');
    v_auth_user_values := array_append(v_auth_user_values, 'now()');
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'updated_at'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'updated_at');
    v_auth_user_values := array_append(v_auth_user_values, 'now()');
  END IF;

  EXECUTE format(
    'INSERT INTO auth.users (%s) VALUES (%s)',
    array_to_string(v_auth_user_columns, ', '),
    array_to_string(v_auth_user_values, ', ')
  );

  INSERT INTO public.merchants (user_id, business_name, email, subscription_plan, merchant_tier, verification_status)
  VALUES (v_admin_user_id, 'Solo Plus RPC Onboarding Merchant', 'solo-plus-rpc-onboarding@example.test', 'individual', 'individual', 'unverified')
  RETURNING id INTO v_onboarding_merchant_id;

  INSERT INTO public.merchants (user_id, business_name, email, subscription_plan, merchant_tier, verification_status)
  VALUES (v_admin_user_id, 'Solo Plus RPC Upgrade Merchant', 'solo-plus-rpc-upgrade@example.test', 'individual', 'individual', 'unverified')
  RETURNING id INTO v_upgrade_merchant_id;

  INSERT INTO public.merchants (user_id, business_name, email, subscription_plan, merchant_tier, verification_status)
  VALUES (v_admin_user_id, 'Solo Plus RPC Conflict Merchant', 'solo-plus-rpc-conflict@example.test', 'individual', 'individual', 'unverified')
  RETURNING id INTO v_conflict_merchant_id;

  INSERT INTO public.merchants (user_id, business_name, email, subscription_plan, merchant_tier, verification_status)
  VALUES (v_admin_user_id, 'Solo Plus RPC Attach Conflict Merchant', 'solo-plus-rpc-attach-conflict@example.test', 'individual', 'individual', 'unverified')
  RETURNING id INTO v_attach_conflict_merchant_id;

  INSERT INTO public.merchants (user_id, business_name, email, subscription_plan, merchant_tier, verification_status)
  VALUES (v_admin_user_id, 'Solo Plus RPC Stale Attach Merchant', 'solo-plus-rpc-stale-attach@example.test', 'individual', 'individual', 'unverified')
  RETURNING id INTO v_stale_attach_merchant_id;

  INSERT INTO public.merchants (user_id, business_name, email, subscription_plan, merchant_tier, verification_status)
  VALUES (v_admin_user_id, 'Solo Plus RPC Terminal Merchant', 'solo-plus-rpc-terminal@example.test', 'individual', 'individual', 'unverified')
  RETURNING id INTO v_terminal_merchant_id;

  INSERT INTO public.onboarding_sessions (email, business_name, plan, status, idempotency_key, expires_at)
  VALUES ('solo-plus-rpc-session@example.test', 'Solo Plus RPC Session', 'solo_plus', 'pending_payment', 'solo-plus-rpc-session-1', now() + interval '7 days')
  RETURNING id INTO v_onboarding_session_id;

  INSERT INTO public.onboarding_sessions (email, business_name, plan, status, idempotency_key, expires_at)
  VALUES ('solo-plus-rpc-session-2@example.test', 'Solo Plus RPC Session Two', 'solo_plus', 'pending_payment', 'solo-plus-rpc-session-2', now() + interval '7 days')
  RETURNING id INTO v_second_onboarding_session_id;

  INSERT INTO public.onboarding_sessions (id, email, business_name, plan, status, idempotency_key, expires_at)
  VALUES (
    v_attach_conflict_onboarding_session_id,
    'solo-plus-rpc-attach-conflict-session@example.test',
    'Solo Plus RPC Attach Conflict Session',
    'solo_plus',
    'pending_payment',
    'solo-plus-rpc-attach-conflict-session-1',
    now() + interval '7 days'
  );

  INSERT INTO public.onboarding_sessions (id, email, business_name, plan, status, idempotency_key, expires_at)
  VALUES (
    v_terminal_attach_onboarding_session_id,
    'solo-plus-rpc-terminal-attach-session@example.test',
    'Solo Plus RPC Terminal Attach Session',
    'solo_plus',
    'pending_payment',
    'solo-plus-rpc-terminal-attach-session-1',
    now() + interval '7 days'
  );

  INSERT INTO public.onboarding_sessions (id, email, business_name, plan, status, idempotency_key, expires_at)
  VALUES (
    v_stale_attach_onboarding_session_id,
    'solo-plus-rpc-stale-attach-session@example.test',
    'Solo Plus RPC Stale Attach Session',
    'solo_plus',
    'pending_payment',
    'solo-plus-rpc-stale-attach-session-1',
    now() + interval '7 days'
  );

  INSERT INTO public.onboarding_sessions (id, email, business_name, plan, status, idempotency_key, expires_at)
  VALUES (
    v_invalid_negative_onboarding_session_id,
    'solo-plus-rpc-invalid-negative-session@example.test',
    'Solo Plus RPC Invalid Negative Session',
    'solo_plus',
    'pending_payment',
    'solo-plus-rpc-invalid-negative-session-1',
    now() + interval '7 days'
  );

  INSERT INTO public.onboarding_sessions (id, email, business_name, plan, status, idempotency_key, expires_at)
  VALUES (
    v_invalid_scale_onboarding_session_id,
    'solo-plus-rpc-invalid-scale-session@example.test',
    'Solo Plus RPC Invalid Scale Session',
    'solo_plus',
    'pending_payment',
    'solo-plus-rpc-invalid-scale-session-1',
    now() + interval '7 days'
  );

  INSERT INTO public.onboarding_sessions (id, email, business_name, plan, status, idempotency_key, expires_at)
  VALUES (
    v_invalid_overflow_onboarding_session_id,
    'solo-plus-rpc-invalid-overflow-session@example.test',
    'Solo Plus RPC Invalid Overflow Session',
    'solo_plus',
    'pending_payment',
    'solo-plus-rpc-invalid-overflow-session-1',
    now() + interval '7 days'
  );

  INSERT INTO public.onboarding_sessions (id, email, business_name, plan, status, idempotency_key, expires_at)
  VALUES (
    v_invalid_snapshot_type_onboarding_session_id,
    'solo-plus-rpc-invalid-snapshot-type-session@example.test',
    'Solo Plus RPC Invalid Snapshot Type Session',
    'solo_plus',
    'pending_payment',
    'solo-plus-rpc-invalid-snapshot-type-session-1',
    now() + interval '7 days'
  );

  INSERT INTO public.onboarding_sessions (id, email, business_name, plan, status, idempotency_key, expires_at)
  VALUES (
    v_invalid_snapshot_sensitive_onboarding_session_id,
    'solo-plus-rpc-invalid-snapshot-sensitive-session@example.test',
    'Solo Plus RPC Invalid Snapshot Sensitive Session',
    'solo_plus',
    'pending_payment',
    'solo-plus-rpc-invalid-snapshot-sensitive-session-1',
    now() + interval '7 days'
  );

  INSERT INTO public.onboarding_sessions (id, email, business_name, plan, status, idempotency_key, expires_at)
  VALUES (
    v_invalid_snapshot_nested_onboarding_session_id,
    'solo-plus-rpc-invalid-snapshot-nested-session@example.test',
    'Solo Plus RPC Invalid Snapshot Nested Session',
    'solo_plus',
    'pending_payment',
    'solo-plus-rpc-invalid-snapshot-nested-session-1',
    now() + interval '7 days'
  );

  INSERT INTO public.onboarding_sessions (id, email, business_name, plan, status, idempotency_key, expires_at)
  VALUES (
    v_normalized_amount_onboarding_session_id,
    'solo-plus-rpc-normalized-amount-session@example.test',
    'Solo Plus RPC Normalized Amount Session',
    'solo_plus',
    'pending_payment',
    'solo-plus-rpc-normalized-amount-session-1',
    now() + interval '7 days'
  );

  INSERT INTO public.onboarding_sessions (id, email, business_name, plan, status, idempotency_key, expires_at)
  VALUES (
    v_max_boundary_onboarding_session_id,
    'solo-plus-rpc-max-boundary-session@example.test',
    'Solo Plus RPC Max Boundary Session',
    'solo_plus',
    'pending_payment',
    'solo-plus-rpc-max-boundary-session-1',
    now() + interval '7 days'
  );

  v_create_result := public.create_solo_plus_case_bundle_v1(
    'onboarding',
    NULL,
    v_onboarding_session_id,
    NULL,
    'solo_plus',
    '0',
    'NGN',
    'solo-plus-policy-v1',
    '{"policy":"safe"}'::jsonb,
    NULL,
    'solo-plus-create-onboarding-1',
    'merchant',
    v_admin_user_id,
    'public'
  );

  IF v_create_result->>'kind' <> 'created' THEN
    RAISE EXCEPTION 'expected onboarding create kind=created, got %', v_create_result->>'kind';
  END IF;

  v_case_id := (v_create_result->'case'->>'id')::uuid;

  SELECT count(*) INTO v_requirement_count
  FROM public.solo_plus_case_requirements
  WHERE case_id = v_case_id;

  IF v_requirement_count <> 6 THEN
    RAISE EXCEPTION 'expected 6 requirements, got %', v_requirement_count;
  END IF;

  IF (
    SELECT array_agg(requirement_code ORDER BY requirement_code)
    FROM public.solo_plus_case_requirements
    WHERE case_id = v_case_id
  ) IS DISTINCT FROM ARRAY[
    'activity_profile',
    'bvn',
    'id_document',
    'proof_of_address',
    'selfie_liveness',
    'settlement_account'
  ] THEN
    RAISE EXCEPTION 'created onboarding case did not contain the exact six requirement codes';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.solo_plus_case_requirements
    WHERE case_id = v_case_id
      AND (requirement_state <> 'not_started' OR requirement_code = 'admin_review')
  ) THEN
    RAISE EXCEPTION 'new onboarding requirements were not initialized correctly';
  END IF;

  SELECT count(*) INTO v_event_count
  FROM public.solo_plus_case_events
  WHERE case_id = v_case_id
    AND event_type = 'case_created';

  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'expected one case_created event, got %', v_event_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.solo_plus_cases
    WHERE id = v_case_id
      AND (
        payment_status <> 'pending'
        OR payment_provider IS NOT NULL
        OR payment_reference IS NOT NULL
        OR payment_record_id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'new onboarding case populated payment fields unexpectedly';
  END IF;

  v_create_result := public.create_solo_plus_case_bundle_v1(
    'upgrade',
    v_upgrade_merchant_id,
    NULL,
    'solo_lite',
    'solo_plus',
    '13000.50',
    'NGN',
    'solo-plus-policy-v1',
    '{"policy":"safe","kind":"upgrade"}'::jsonb,
    'solo_lite',
    'solo-plus-create-upgrade-1',
    'merchant',
    v_admin_user_id,
    'public'
  );

  IF v_create_result->>'kind' <> 'created' THEN
    RAISE EXCEPTION 'expected upgrade create kind=created, got %', v_create_result->>'kind';
  END IF;

  v_upgrade_case_id := (v_create_result->'case'->>'id')::uuid;

  IF EXISTS (
    SELECT 1
    FROM public.merchants
    WHERE id = v_upgrade_merchant_id
      AND subscription_plan <> 'individual'
  ) THEN
    RAISE EXCEPTION 'upgrade create modified merchant active plan';
  END IF;

  v_replay_result := public.create_solo_plus_case_bundle_v1(
    'upgrade',
    v_upgrade_merchant_id,
    NULL,
    'solo_lite',
    'solo_plus',
    '13000.50',
    'NGN',
    'solo-plus-policy-v1',
    '{"policy":"safe","kind":"upgrade"}'::jsonb,
    'solo_lite',
    'solo-plus-create-upgrade-1',
    'merchant',
    v_admin_user_id,
    'public'
  );

  IF v_replay_result->>'kind' <> 'idempotent_replay' THEN
    RAISE EXCEPTION 'expected idempotent replay, got %', v_replay_result->>'kind';
  END IF;

  SELECT count(*) INTO v_case_count
  FROM public.solo_plus_cases
  WHERE id = v_upgrade_case_id;

  IF v_case_count <> 1 THEN
    RAISE EXCEPTION 'idempotent replay changed case count';
  END IF;

  SELECT count(*) INTO v_requirement_count
  FROM public.solo_plus_case_requirements
  WHERE case_id = v_upgrade_case_id;

  IF v_requirement_count <> 6 THEN
    RAISE EXCEPTION 'idempotent replay changed requirement count';
  END IF;

  SELECT count(*) INTO v_event_count
  FROM public.solo_plus_case_events
  WHERE case_id = v_upgrade_case_id
    AND event_type = 'case_created';

  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'idempotent replay changed event count';
  END IF;

  IF public.create_solo_plus_case_bundle_v1(
    'upgrade',
    v_upgrade_merchant_id,
    NULL,
    'solo_lite',
    'solo_plus',
    '13001.50',
    'NGN',
    'solo-plus-policy-v1',
    '{"policy":"safe","kind":"upgrade"}'::jsonb,
    'solo_lite',
    'solo-plus-create-upgrade-1',
    'merchant',
    v_admin_user_id,
    'public'
  )->>'kind' <> 'idempotency_conflict' THEN
    RAISE EXCEPTION 'changed amount did not return idempotency_conflict';
  END IF;

  IF public.create_solo_plus_case_bundle_v1(
    'upgrade',
    v_upgrade_merchant_id,
    NULL,
    'solo_lite',
    'solo_plus',
    '13000.50',
    'NGN',
    'solo-plus-policy-v2',
    '{"policy":"safe","kind":"upgrade"}'::jsonb,
    'solo_lite',
    'solo-plus-create-upgrade-1',
    'merchant',
    v_admin_user_id,
    'public'
  )->>'kind' <> 'idempotency_conflict' THEN
    RAISE EXCEPTION 'changed policy version did not return idempotency_conflict';
  END IF;

  IF public.create_solo_plus_case_bundle_v1(
    'upgrade',
    v_conflict_merchant_id,
    NULL,
    'solo_lite',
    'solo_plus',
    '13000.50',
    'NGN',
    'solo-plus-policy-v1',
    '{"policy":"safe","kind":"upgrade"}'::jsonb,
    'solo_lite',
    'solo-plus-create-upgrade-1',
    'merchant',
    v_admin_user_id,
    'public'
  )->>'kind' <> 'idempotency_conflict' THEN
    RAISE EXCEPTION 'changed merchant did not return idempotency_conflict';
  END IF;

  IF public.create_solo_plus_case_bundle_v1(
    'upgrade',
    v_upgrade_merchant_id,
    NULL,
    'solo_lite',
    'solo_plus',
    '13000.50',
    'NGN',
    'solo-plus-policy-v1',
    '{"policy":"safe","kind":"upgrade"}'::jsonb,
    'solo_lite',
    'solo-plus-create-upgrade-2',
    'merchant',
    v_admin_user_id,
    'public'
  )->>'kind' <> 'existing_active_case' THEN
    RAISE EXCEPTION 'equivalent active upgrade intent did not return existing_active_case';
  END IF;

  IF public.create_solo_plus_case_bundle_v1(
    'upgrade',
    v_upgrade_merchant_id,
    NULL,
    'solo_lite',
    'solo_plus',
    '13000.99',
    'NGN',
    'solo-plus-policy-v1',
    '{"policy":"safe","kind":"upgrade"}'::jsonb,
    'solo_lite',
    'solo-plus-create-upgrade-3',
    'merchant',
    v_admin_user_id,
    'public'
  )->>'kind' <> 'active_case_conflict' THEN
    RAISE EXCEPTION 'conflicting active upgrade did not return active_case_conflict';
  END IF;

  IF public.create_solo_plus_case_bundle_v1(
    'onboarding',
    NULL,
    v_onboarding_session_id,
    NULL,
    'solo_plus',
    '1.00',
    'NGN',
    'solo-plus-policy-v1',
    '{"policy":"safe"}'::jsonb,
    NULL,
    'solo-plus-create-onboarding-2',
    'merchant',
    v_admin_user_id,
    'public'
  )->>'kind' <> 'active_case_conflict' THEN
    RAISE EXCEPTION 'conflicting active onboarding did not return active_case_conflict';
  END IF;

  INSERT INTO public.solo_plus_cases (
    merchant_id,
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
    approved_at,
    approved_by_admin_id,
    idempotency_key
  ) VALUES (
    v_terminal_merchant_id,
    NULL,
    'upgrade',
    'solo_lite',
    'solo_plus',
    'approved',
    'paid',
    'none',
    13000.00,
    'NGN',
    'solo-plus-policy-v1',
    '{"policy":"terminal"}'::jsonb,
    'solo_lite',
    now(),
    v_admin_user_id,
    'solo-plus-terminal-approved'
  );

  IF public.create_solo_plus_case_bundle_v1(
    'upgrade',
    v_terminal_merchant_id,
    NULL,
    'solo_lite',
    'solo_plus',
    '13000.00',
    'NGN',
    'solo-plus-policy-v1',
    '{"policy":"new-after-terminal"}'::jsonb,
    'solo_lite',
    'solo-plus-create-after-terminal',
    'merchant',
    v_admin_user_id,
    'public'
  )->>'kind' <> 'created' THEN
    RAISE EXCEPTION 'terminal historical case incorrectly blocked new active case';
  END IF;

  PERFORM public.create_solo_plus_case_bundle_v1(
    'onboarding',
    NULL,
    v_second_onboarding_session_id,
    NULL,
    'solo_plus',
    '1.10',
    'NGN',
    'solo-plus-policy-v1',
    '{"policy":"attach"}'::jsonb,
    NULL,
    'solo-plus-attach-case',
    'merchant',
    v_admin_user_id,
    'public'
  );

  SELECT id INTO v_attach_case_id
  FROM public.solo_plus_cases
  WHERE idempotency_key = 'solo-plus-attach-case';

  IF public.attach_solo_plus_onboarding_merchant_v1(
    v_attach_case_id,
    v_second_onboarding_session_id,
    v_attach_conflict_merchant_id,
    0,
    'solo-plus-attach-1',
    'merchant',
    v_admin_user_id
  )->>'kind' <> 'updated' THEN
    RAISE EXCEPTION 'valid first attachment did not return updated';
  END IF;

  IF (SELECT row_version FROM public.solo_plus_cases WHERE id = v_attach_case_id) <> 1 THEN
    RAISE EXCEPTION 'attachment did not increment row_version exactly once';
  END IF;

  SELECT count(*) INTO v_event_count
  FROM public.solo_plus_case_events
  WHERE case_id = v_attach_case_id
    AND event_type = 'merchant_attached';

  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'attachment did not create exactly one merchant_attached event';
  END IF;

  IF public.attach_solo_plus_onboarding_merchant_v1(
    v_attach_case_id,
    v_second_onboarding_session_id,
    v_attach_conflict_merchant_id,
    0,
    'solo-plus-attach-1',
    'merchant',
    v_admin_user_id
  )->>'kind' <> 'idempotent_replay' THEN
    RAISE EXCEPTION 'exact attachment replay did not return idempotent_replay';
  END IF;

  IF (SELECT row_version FROM public.solo_plus_cases WHERE id = v_attach_case_id) <> 1 THEN
    RAISE EXCEPTION 'exact attachment replay changed row_version';
  END IF;

  SELECT count(*) INTO v_event_count
  FROM public.solo_plus_case_events
  WHERE case_id = v_attach_case_id
    AND event_type = 'merchant_attached';

  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'exact attachment replay duplicated merchant_attached event';
  END IF;

  IF public.attach_solo_plus_onboarding_merchant_v1(
    v_attach_case_id,
    v_second_onboarding_session_id,
    v_onboarding_merchant_id,
    1,
    'solo-plus-attach-2',
    'merchant',
    v_admin_user_id
  )->>'kind' <> 'ownership_conflict' THEN
    RAISE EXCEPTION 'different merchant attachment did not return ownership_conflict';
  END IF;

  IF public.attach_solo_plus_onboarding_merchant_v1(
    v_attach_case_id,
    v_onboarding_session_id,
    v_attach_conflict_merchant_id,
    1,
    'solo-plus-attach-3',
    'merchant',
    v_admin_user_id
  )->>'kind' <> 'ownership_conflict' THEN
    RAISE EXCEPTION 'incorrect onboarding session did not return ownership_conflict';
  END IF;

  IF public.attach_solo_plus_onboarding_merchant_v1(
    v_upgrade_case_id,
    v_second_onboarding_session_id,
    v_attach_conflict_merchant_id,
    0,
    'solo-plus-attach-4',
    'merchant',
    v_admin_user_id
  )->>'kind' <> 'ownership_conflict' THEN
    RAISE EXCEPTION 'upgrade attachment did not return ownership_conflict';
  END IF;

  PERFORM public.create_solo_plus_case_bundle_v1(
    'onboarding',
    NULL,
    v_stale_attach_onboarding_session_id,
    NULL,
    'solo_plus',
    '10.50',
    'NGN',
    'solo-plus-policy-v1',
    '{"policy":"stale-attach-version"}'::jsonb,
    NULL,
    'solo-plus-stale-attach-case',
    'merchant',
    v_admin_user_id,
    'public'
  );

  SELECT id INTO v_stale_attach_case_id
  FROM public.solo_plus_cases
  WHERE idempotency_key = 'solo-plus-stale-attach-case';

  IF public.mark_solo_plus_case_awaiting_payment_v1(
    v_stale_attach_case_id,
    0,
    'solo-plus-stale-attach-awaiting-payment',
    'merchant',
    v_admin_user_id
  )->>'kind' <> 'updated' THEN
    RAISE EXCEPTION 'stale attachment fixture failed to advance to awaiting_payment';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.solo_plus_cases
    WHERE id = v_stale_attach_case_id
      AND (
        case_status <> 'awaiting_payment'
        OR row_version <> 1
        OR merchant_id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'stale attachment fixture was not prepared as expected';
  END IF;

  IF public.attach_solo_plus_onboarding_merchant_v1(
    v_stale_attach_case_id,
    v_stale_attach_onboarding_session_id,
    v_stale_attach_merchant_id,
    0,
    'solo-plus-attach-5',
    'merchant',
    v_admin_user_id
  )->>'kind' <> 'version_conflict' THEN
    RAISE EXCEPTION 'stale attachment version did not return version_conflict';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.solo_plus_cases
    WHERE id = v_stale_attach_case_id
      AND (
        merchant_id IS NOT NULL
        OR row_version <> 1
        OR case_status <> 'awaiting_payment'
      )
  ) THEN
    RAISE EXCEPTION 'stale attachment version conflict mutated the case unexpectedly';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.solo_plus_case_events
    WHERE case_id = v_stale_attach_case_id
      AND event_type = 'merchant_attached'
      AND request_idempotency_key = 'solo-plus-attach-5'
  ) THEN
    RAISE EXCEPTION 'stale attachment version conflict unexpectedly inserted a merchant_attached event for the stale request key';
  END IF;

  SELECT count(*) INTO v_event_count
  FROM public.solo_plus_case_events
  WHERE case_id = v_stale_attach_case_id
    AND event_type = 'merchant_attached';

  IF v_event_count <> 0 THEN
    RAISE EXCEPTION 'stale attachment version conflict unexpectedly inserted merchant_attached events';
  END IF;

  PERFORM public.create_solo_plus_case_bundle_v1(
    'onboarding',
    NULL,
    v_attach_conflict_onboarding_session_id,
    NULL,
    'solo_plus',
    '10.00',
    'NGN',
    'solo-plus-policy-v1',
    '{"policy":"attach-conflict"}'::jsonb,
    NULL,
    'solo-plus-attach-conflict-case',
    'merchant',
    v_admin_user_id,
    'public'
  );

  IF public.attach_solo_plus_onboarding_merchant_v1(
    (SELECT id FROM public.solo_plus_cases WHERE idempotency_key = 'solo-plus-attach-conflict-case'),
    v_attach_conflict_onboarding_session_id,
    v_attach_conflict_merchant_id,
    0,
    'solo-plus-attach-conflict',
    'merchant',
    v_admin_user_id
  )->>'kind' <> 'active_case_conflict' THEN
    RAISE EXCEPTION 'active merchant attach conflict did not return active_case_conflict';
  END IF;

  UPDATE public.solo_plus_cases
  SET case_status = 'cancelled'
  WHERE id = v_attach_case_id;

  PERFORM public.create_solo_plus_case_bundle_v1(
    'onboarding',
    NULL,
    v_terminal_attach_onboarding_session_id,
    NULL,
    'solo_plus',
    '11.00',
    'NGN',
    'solo-plus-policy-v1',
    '{"policy":"terminal-attach"}'::jsonb,
    NULL,
    'solo-plus-terminal-attach-case',
    'merchant',
    v_admin_user_id,
    'public'
  );

  UPDATE public.solo_plus_cases
  SET case_status = 'cancelled'
  WHERE idempotency_key = 'solo-plus-terminal-attach-case';

  IF public.attach_solo_plus_onboarding_merchant_v1(
    (SELECT id FROM public.solo_plus_cases WHERE idempotency_key = 'solo-plus-terminal-attach-case'),
    v_terminal_attach_onboarding_session_id,
    v_onboarding_merchant_id,
    0,
    'solo-plus-terminal-attach',
    'merchant',
    v_admin_user_id
  )->>'kind' <> 'state_conflict' THEN
    RAISE EXCEPTION 'terminal first attachment did not return state_conflict';
  END IF;

  PERFORM public.create_solo_plus_case_bundle_v1(
    'upgrade',
    v_conflict_merchant_id,
    NULL,
    'solo_lite',
    'solo_plus',
    '12.00',
    'NGN',
    'solo-plus-policy-v1',
    '{"policy":"transition"}'::jsonb,
    'solo_lite',
    'solo-plus-transition-case',
    'merchant',
    v_admin_user_id,
    'public'
  );

  SELECT id INTO v_transition_case_id
  FROM public.solo_plus_cases
  WHERE idempotency_key = 'solo-plus-transition-case';

  IF public.mark_solo_plus_case_awaiting_payment_v1(
    v_transition_case_id,
    0,
    'solo-plus-awaiting-1',
    'merchant',
    v_admin_user_id
  )->>'kind' <> 'updated' THEN
    RAISE EXCEPTION 'draft to awaiting_payment did not return updated';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.solo_plus_cases
    WHERE id = v_transition_case_id
      AND (
        case_status <> 'awaiting_payment'
        OR payment_status <> 'pending'
        OR payment_provider IS NOT NULL
        OR payment_reference IS NOT NULL
        OR payment_record_id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'awaiting_payment transition changed payment fields incorrectly';
  END IF;

  SELECT count(*) INTO v_event_count
  FROM public.solo_plus_case_events
  WHERE case_id = v_transition_case_id
    AND event_type = 'case_marked_awaiting_payment';

  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'awaiting_payment transition did not create exactly one event';
  END IF;

  IF public.mark_solo_plus_case_awaiting_payment_v1(
    v_transition_case_id,
    0,
    'solo-plus-awaiting-1',
    'merchant',
    v_admin_user_id
  )->>'kind' <> 'idempotent_replay' THEN
    RAISE EXCEPTION 'awaiting_payment replay did not return idempotent_replay';
  END IF;

  IF (SELECT row_version FROM public.solo_plus_cases WHERE id = v_transition_case_id) <> 1 THEN
    RAISE EXCEPTION 'awaiting_payment replay changed row_version';
  END IF;

  PERFORM public.create_solo_plus_case_bundle_v1(
    'upgrade',
    v_onboarding_merchant_id,
    NULL,
    'solo_lite',
    'solo_plus',
    '12.50',
    'NGN',
    'solo-plus-policy-v1',
    '{"policy":"transition-stale"}'::jsonb,
    'solo_lite',
    'solo-plus-transition-stale-case',
    'merchant',
    v_admin_user_id,
    'public'
  );

  IF public.mark_solo_plus_case_awaiting_payment_v1(
    (SELECT id FROM public.solo_plus_cases WHERE idempotency_key = 'solo-plus-transition-stale-case'),
    1,
    'solo-plus-awaiting-stale',
    'merchant',
    v_admin_user_id
  )->>'kind' <> 'version_conflict' THEN
    RAISE EXCEPTION 'awaiting_payment stale version did not return version_conflict';
  END IF;

  UPDATE public.solo_plus_cases
  SET case_status = 'verification_pending'
  WHERE idempotency_key = 'solo-plus-transition-stale-case';

  IF public.mark_solo_plus_case_awaiting_payment_v1(
    (SELECT id FROM public.solo_plus_cases WHERE idempotency_key = 'solo-plus-transition-stale-case'),
    0,
    'solo-plus-awaiting-state',
    'merchant',
    v_admin_user_id
  )->>'kind' <> 'state_conflict' THEN
    RAISE EXCEPTION 'awaiting_payment non-draft did not return state_conflict';
  END IF;

  BEGIN
    PERFORM public.create_solo_plus_case_bundle_v1(
      'onboarding',
      NULL,
      v_invalid_negative_onboarding_session_id,
      NULL,
      'solo_plus',
      '-1',
      'NGN',
      'solo-plus-policy-v1',
      '{"policy":"invalid"}'::jsonb,
      NULL,
      'solo-plus-invalid-negative',
      'merchant',
      v_admin_user_id,
      'public'
    );
    RAISE EXCEPTION 'negative amount unexpectedly succeeded';
  EXCEPTION
    WHEN others THEN
      IF position('non-negative' in SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.create_solo_plus_case_bundle_v1(
      'onboarding',
      NULL,
      v_invalid_scale_onboarding_session_id,
      NULL,
      'solo_plus',
      '1.001',
      'NGN',
      'solo-plus-policy-v1',
      '{"policy":"invalid"}'::jsonb,
      NULL,
      'solo-plus-invalid-scale',
      'merchant',
      v_admin_user_id,
      'public'
    );
    RAISE EXCEPTION 'three-decimal amount unexpectedly succeeded';
  EXCEPTION
    WHEN others THEN
      IF position('two decimal places' in SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.create_solo_plus_case_bundle_v1(
      'onboarding',
      NULL,
      v_invalid_overflow_onboarding_session_id,
      NULL,
      'solo_plus',
      '10000000000000000.00',
      'NGN',
      'solo-plus-policy-v1',
      '{"policy":"invalid"}'::jsonb,
      NULL,
      'solo-plus-invalid-overflow',
      'merchant',
      v_admin_user_id,
      'public'
    );
    RAISE EXCEPTION 'overflow amount unexpectedly succeeded';
  EXCEPTION
    WHEN others THEN
      IF position('numeric(18,2)' in SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.create_solo_plus_case_bundle_v1(
      'onboarding',
      NULL,
      v_invalid_snapshot_type_onboarding_session_id,
      NULL,
      'solo_plus',
      '1.00',
      'NGN',
      'solo-plus-policy-v1',
      '[]'::jsonb,
      NULL,
      'solo-plus-invalid-snapshot-type',
      'merchant',
      v_admin_user_id,
      'public'
    );
    RAISE EXCEPTION 'non-object snapshot unexpectedly succeeded';
  EXCEPTION
    WHEN others THEN
      IF position('JSON object' in SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.create_solo_plus_case_bundle_v1(
      'onboarding',
      NULL,
      v_invalid_snapshot_sensitive_onboarding_session_id,
      NULL,
      'solo_plus',
      '1.00',
      'NGN',
      'solo-plus-policy-v1',
      '{"bvn":"12345678901"}'::jsonb,
      NULL,
      'solo-plus-invalid-snapshot-sensitive',
      'merchant',
      v_admin_user_id,
      'public'
    );
    RAISE EXCEPTION 'sensitive snapshot unexpectedly succeeded';
  EXCEPTION
    WHEN others THEN
      IF position('prohibited sensitive key' in SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.create_solo_plus_case_bundle_v1(
      'onboarding',
      NULL,
      v_invalid_snapshot_nested_onboarding_session_id,
      NULL,
      'solo_plus',
      '1.00',
      'NGN',
      'solo-plus-policy-v1',
      '{"nested":{"providerPayload":"unsafe"}}'::jsonb,
      NULL,
      'solo-plus-invalid-snapshot-nested',
      'merchant',
      v_admin_user_id,
      'public'
    );
    RAISE EXCEPTION 'nested sensitive snapshot unexpectedly succeeded';
  EXCEPTION
    WHEN others THEN
      IF position('prohibited sensitive key' in SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;

  IF public.create_solo_plus_case_bundle_v1(
    'onboarding',
    NULL,
    v_normalized_amount_onboarding_session_id,
    NULL,
    'solo_plus',
    '1',
    'NGN',
    'solo-plus-policy-v1',
    '{"policy":"normalized-amount"}'::jsonb,
    NULL,
    'solo-plus-normalized-amount-1',
    'merchant',
    v_admin_user_id,
    'public'
  )->>'kind' <> 'created' THEN
    RAISE EXCEPTION 'normalized amount create using 1 did not return created';
  END IF;

  SELECT id
  INTO v_normalized_amount_case_id
  FROM public.solo_plus_cases
  WHERE idempotency_key = 'solo-plus-normalized-amount-1';

  IF public.create_solo_plus_case_bundle_v1(
    'onboarding',
    NULL,
    v_normalized_amount_onboarding_session_id,
    NULL,
    'solo_plus',
    '1.0',
    'NGN',
    'solo-plus-policy-v1',
    '{"policy":"normalized-amount"}'::jsonb,
    NULL,
    'solo-plus-normalized-amount-1',
    'merchant',
    v_admin_user_id,
    'public'
  )->>'kind' <> 'idempotent_replay' THEN
    RAISE EXCEPTION 'normalized amount replay using 1.0 did not return idempotent_replay';
  END IF;

  IF public.create_solo_plus_case_bundle_v1(
    'onboarding',
    NULL,
    v_normalized_amount_onboarding_session_id,
    NULL,
    'solo_plus',
    '1.00',
    'NGN',
    'solo-plus-policy-v1',
    '{"policy":"normalized-amount"}'::jsonb,
    NULL,
    'solo-plus-normalized-amount-1',
    'merchant',
    v_admin_user_id,
    'public'
  )->>'kind' <> 'idempotent_replay' THEN
    RAISE EXCEPTION 'normalized amount replay using 1.00 did not return idempotent_replay';
  END IF;

  SELECT count(*) INTO v_case_count
  FROM public.solo_plus_cases
  WHERE id = v_normalized_amount_case_id;

  IF v_case_count <> 1 THEN
    RAISE EXCEPTION 'normalized amount replay changed case count for dedicated fixture';
  END IF;

  SELECT count(*) INTO v_requirement_count
  FROM public.solo_plus_case_requirements
  WHERE case_id = v_normalized_amount_case_id;

  IF v_requirement_count <> 6 THEN
    RAISE EXCEPTION 'normalized amount replay changed requirement count for dedicated fixture';
  END IF;

  SELECT count(*) INTO v_event_count
  FROM public.solo_plus_case_events
  WHERE case_id = v_normalized_amount_case_id
    AND event_type = 'case_created';

  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'normalized amount replay changed case_created event count for dedicated fixture';
  END IF;

  v_create_result := public.create_solo_plus_case_bundle_v1(
    'onboarding',
    NULL,
    v_max_boundary_onboarding_session_id,
    NULL,
    'solo_plus',
    '9999999999999999.99',
    'NGN',
    'solo-plus-policy-v1',
    '{"policy":"max-boundary"}'::jsonb,
    NULL,
    'solo-plus-max-boundary',
    'merchant',
    v_admin_user_id,
    'public'
  );

  IF v_create_result->>'kind' <> 'created' THEN
    RAISE EXCEPTION 'maximum valid amount boundary was not accepted';
  END IF;

  v_max_boundary_case_id := (v_create_result->'case'->>'id')::uuid;

  SELECT expected_amount, expected_amount::text
  INTO v_stored_expected_amount, v_stored_expected_amount_text
  FROM public.solo_plus_cases
  WHERE id = v_max_boundary_case_id;

  IF v_stored_expected_amount <> 9999999999999999.99::numeric THEN
    RAISE EXCEPTION 'maximum valid amount stored numeric value was %, expected 9999999999999999.99', v_stored_expected_amount;
  END IF;

  IF v_stored_expected_amount_text <> '9999999999999999.99' THEN
    RAISE EXCEPTION 'maximum valid amount stored text value was %, expected 9999999999999999.99', v_stored_expected_amount_text;
  END IF;

  FOR v_procedure_oid IN
    SELECT to_regprocedure(signature_text)::oid
    FROM (
      VALUES
        ('public.solo_plus_contains_prohibited_key_v1(jsonb)'),
        ('public.solo_plus_assert_safe_snapshot_v1(jsonb)'),
        ('public.solo_plus_assert_amount_v1(text)'),
        ('public.solo_plus_case_bundle_payload_v1(uuid)'),
        ('public.create_solo_plus_case_bundle_v1(text,uuid,uuid,text,text,text,text,text,jsonb,text,text,text,uuid,text)'),
        ('public.attach_solo_plus_onboarding_merchant_v1(uuid,uuid,uuid,integer,text,text,uuid)'),
        ('public.mark_solo_plus_case_awaiting_payment_v1(uuid,integer,text,text,uuid)')
    ) AS fn(signature_text)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS acl
      WHERE p.oid = v_procedure_oid
        AND acl.privilege_type = 'EXECUTE'
        AND acl.grantee IN (
          0,
          coalesce(to_regrole('anon')::oid, -1),
          coalesce(to_regrole('authenticated')::oid, -1)
        )
    ) THEN
      RAISE EXCEPTION 'unexpected execute privilege leaked to PUBLIC/anon/authenticated';
    END IF;

    IF to_regrole('service_role') IS NULL OR NOT has_function_privilege('service_role', v_procedure_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role is missing execute privilege on Solo Plus RPC oid %', v_procedure_oid;
    END IF;
  END LOOP;

  RAISE NOTICE 'phase2_solo_plus_transactional_repository_rpcs: PASS';
END
$$;

ROLLBACK;
