BEGIN;

DO $$
DECLARE
  v_auth_user_columns TEXT[];
  v_auth_user_values TEXT[];
  v_auth_user_email TEXT;
  v_onboarding_merchant_id UUID;
  v_upgrade_merchant_id UUID;
  v_active_uniqueness_merchant_id UUID;
  v_historical_case_merchant_id UUID;
  v_duplicate_payment_record_second_merchant_id UUID;
  v_onboarding_session_id UUID;
  v_active_uniqueness_onboarding_session_id UUID;
  v_payment_record_id UUID;
  v_duplicate_payment_record_id UUID;
  v_verification_log_id UUID;
  v_admin_user_id UUID;
  v_onboarding_case_id UUID;
  v_upgrade_case_id UUID;
  v_active_uniqueness_case_id UUID;
  v_historical_case_one_id UUID;
  v_historical_case_two_id UUID;
  v_historical_case_three_id UUID;
  v_historical_case_four_id UUID;
  v_constraint_name TEXT;
  v_exception_detail TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'solo_plus_cases'
  ) THEN
    RAISE EXCEPTION 'solo_plus_cases table is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'solo_plus_case_requirements'
  ) THEN
    RAISE EXCEPTION 'solo_plus_case_requirements table is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'solo_plus_case_events'
  ) THEN
    RAISE EXCEPTION 'solo_plus_case_events table is missing';
  END IF;

  v_admin_user_id := gen_random_uuid();
  v_auth_user_email := format(
    'phase2-solo-plus-%s@example.test',
    replace(v_admin_user_id::text, '-', '')
  );

  v_auth_user_columns := ARRAY['id'];
  v_auth_user_values := ARRAY[quote_literal(v_admin_user_id::text) || '::uuid'];

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'instance_id'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'instance_id');
    v_auth_user_values := array_append(v_auth_user_values, quote_literal('00000000-0000-0000-0000-000000000000') || '::uuid');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'aud'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'aud');
    v_auth_user_values := array_append(v_auth_user_values, quote_literal('authenticated'));
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'role'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'role');
    v_auth_user_values := array_append(v_auth_user_values, quote_literal('authenticated'));
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'email'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'email');
    v_auth_user_values := array_append(v_auth_user_values, quote_literal(v_auth_user_email));
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'encrypted_password'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'encrypted_password');
    v_auth_user_values := array_append(v_auth_user_values, quote_literal('$2a$10$abcdefghijklmnopqrstuuJzM1rjQYDyS9mWGTH0I1GtIsfRSAxE6'));
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'email_confirmed_at'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'email_confirmed_at');
    v_auth_user_values := array_append(v_auth_user_values, 'now()');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'confirmation_token'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'confirmation_token');
    v_auth_user_values := array_append(v_auth_user_values, quote_literal(''));
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'recovery_token'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'recovery_token');
    v_auth_user_values := array_append(v_auth_user_values, quote_literal(''));
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'email_change_token_new'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'email_change_token_new');
    v_auth_user_values := array_append(v_auth_user_values, quote_literal(''));
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'email_change_token_current'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'email_change_token_current');
    v_auth_user_values := array_append(v_auth_user_values, quote_literal(''));
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'phone_change_token'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'phone_change_token');
    v_auth_user_values := array_append(v_auth_user_values, quote_literal(''));
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'reauthentication_token'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'reauthentication_token');
    v_auth_user_values := array_append(v_auth_user_values, quote_literal(''));
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'raw_app_meta_data'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'raw_app_meta_data');
    v_auth_user_values := array_append(v_auth_user_values, quote_literal('{}') || '::jsonb');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'raw_user_meta_data'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'raw_user_meta_data');
    v_auth_user_values := array_append(v_auth_user_values, quote_literal('{}') || '::jsonb');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'is_super_admin'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'is_super_admin');
    v_auth_user_values := array_append(v_auth_user_values, 'false');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'created_at'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'created_at');
    v_auth_user_values := array_append(v_auth_user_values, 'now()');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'updated_at'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'updated_at');
    v_auth_user_values := array_append(v_auth_user_values, 'now()');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'is_sso_user'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'is_sso_user');
    v_auth_user_values := array_append(v_auth_user_values, 'false');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'is_anonymous'
  ) THEN
    v_auth_user_columns := array_append(v_auth_user_columns, 'is_anonymous');
    v_auth_user_values := array_append(v_auth_user_values, 'false');
  END IF;

  EXECUTE format(
    'INSERT INTO auth.users (%s) VALUES (%s)',
    array_to_string(v_auth_user_columns, ', '),
    array_to_string(v_auth_user_values, ', ')
  );

  INSERT INTO public.merchants (
    user_id,
    business_name,
    email,
    subscription_plan,
    merchant_tier,
    verification_status
  ) VALUES (
    v_admin_user_id,
    'Solo Plus Onboarding Test Merchant',
    'solo-plus-onboarding@example.test',
    'individual',
    'individual',
    'unverified'
  ) RETURNING id INTO v_onboarding_merchant_id;

  INSERT INTO public.merchants (
    user_id,
    business_name,
    email,
    subscription_plan,
    merchant_tier,
    verification_status
  ) VALUES (
    v_admin_user_id,
    'Solo Plus Upgrade Test Merchant',
    'solo-plus-upgrade@example.test',
    'individual',
    'individual',
    'unverified'
  ) RETURNING id INTO v_upgrade_merchant_id;

  INSERT INTO public.merchants (
    user_id,
    business_name,
    email,
    subscription_plan,
    merchant_tier,
    verification_status
  ) VALUES (
    v_admin_user_id,
    'Solo Plus Active Uniqueness Merchant',
    'solo-plus-active-uniqueness@example.test',
    'individual',
    'individual',
    'unverified'
  ) RETURNING id INTO v_active_uniqueness_merchant_id;

  INSERT INTO public.merchants (
    user_id,
    business_name,
    email,
    subscription_plan,
    merchant_tier,
    verification_status
  ) VALUES (
    v_admin_user_id,
    'Solo Plus Historical Case Merchant',
    'solo-plus-historical@example.test',
    'individual',
    'individual',
    'unverified'
  ) RETURNING id INTO v_historical_case_merchant_id;

  INSERT INTO public.merchants (
    user_id,
    business_name,
    email,
    subscription_plan,
    merchant_tier,
    verification_status
  ) VALUES (
    v_admin_user_id,
    'Solo Plus Duplicate Payment Record Second Merchant',
    'solo-plus-duplicate-payment-record-second@example.test',
    'individual',
    'individual',
    'unverified'
  ) RETURNING id INTO v_duplicate_payment_record_second_merchant_id;

  INSERT INTO public.onboarding_sessions (
    email,
    business_name,
    plan,
    status,
    idempotency_key,
    expires_at
  ) VALUES (
    'solo-plus-onboarding@example.com',
    'Solo Plus Onboarding',
    'solo_plus',
    'awaiting_payment',
    'sp-onboarding-session-key',
    now() + interval '1 day'
  ) RETURNING id INTO v_onboarding_session_id;

  INSERT INTO public.onboarding_sessions (
    email,
    business_name,
    plan,
    status,
    idempotency_key,
    expires_at
  ) VALUES (
    'solo-plus-active-uniqueness@example.test',
    'Solo Plus Active Uniqueness Onboarding',
    'solo_plus',
    'awaiting_payment',
    'sp-active-uniqueness-session-key',
    now() + interval '1 day'
  ) RETURNING id INTO v_active_uniqueness_onboarding_session_id;

  INSERT INTO public.payment_records (
    merchant_id,
    payment_purpose,
    payment_method,
    provider_name,
    internal_reference,
    amount_paid,
    currency,
    payment_status,
    customer_email
  ) VALUES (
    v_upgrade_merchant_id,
    'plan_upgrade',
    'card',
    'paystack',
    'sp-payment-record-1',
    0,
    'NGN',
    'pending',
    'solo-plus-test@example.com'
  ) RETURNING id INTO v_payment_record_id;

  INSERT INTO public.payment_records (
    merchant_id,
    payment_purpose,
    payment_method,
    provider_name,
    internal_reference,
    amount_paid,
    currency,
    payment_status,
    customer_email
  ) VALUES (
    v_historical_case_merchant_id,
    'plan_upgrade',
    'card',
    'paystack',
    'sp-payment-record-duplicate-1',
    0,
    'NGN',
    'pending',
    'solo-plus-duplicate-payment-record@example.test'
  ) RETURNING id INTO v_duplicate_payment_record_id;

  IF v_duplicate_payment_record_id IS NULL THEN
    RAISE EXCEPTION 'duplicate payment_record_id fixture is null';
  END IF;

  INSERT INTO public.verification_logs (
    merchant_id,
    provider_name,
    verification_type,
    normalized_status
  ) VALUES (
    v_upgrade_merchant_id,
    'DOJAH',
    'bvn_selfie',
    'verified'
  ) RETURNING id INTO v_verification_log_id;

  INSERT INTO public.solo_plus_cases (
    merchant_id,
    onboarding_session_id,
    flow_origin,
    source_plan,
    expected_amount,
    requirements_policy_version,
    idempotency_key
  ) VALUES (
    NULL,
    v_onboarding_session_id,
    'onboarding',
    NULL,
    13000.00,
    'v1',
    'case-key-onboarding-1'
  ) RETURNING id INTO v_onboarding_case_id;

  UPDATE public.solo_plus_cases
  SET merchant_id = v_onboarding_merchant_id
  WHERE id = v_onboarding_case_id;

  BEGIN
    INSERT INTO public.solo_plus_cases (
      flow_origin,
      source_plan,
      expected_amount,
      requirements_policy_version,
      idempotency_key
    ) VALUES (
      'onboarding',
      'solo_lite',
      13000.00,
      'v1',
      'invalid-onboarding-1'
    );
    RAISE EXCEPTION 'invalid onboarding ownership unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation OR not_null_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.solo_plus_cases (
      merchant_id,
      flow_origin,
      source_plan,
      expected_amount,
      requirements_policy_version,
      idempotency_key
    ) VALUES (
      NULL,
      'upgrade',
      'solo_lite',
      13000.00,
      'v1',
      'invalid-upgrade-1'
    );
    RAISE EXCEPTION 'invalid upgrade ownership unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation OR not_null_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.solo_plus_cases (
      merchant_id,
      flow_origin,
      source_plan,
      expected_amount,
      requirements_policy_version,
      idempotency_key,
      payment_provider
    ) VALUES (
      v_historical_case_merchant_id,
      'upgrade',
      'solo_lite',
      13000.00,
      'v1',
      'invalid-provider-1',
      'breet'
    );
    RAISE EXCEPTION 'breet payment provider unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.solo_plus_cases (
      merchant_id,
      flow_origin,
      source_plan,
      expected_amount,
      requirements_policy_version,
      idempotency_key,
      payment_status
    ) VALUES (
      v_historical_case_merchant_id,
      'upgrade',
      'solo_lite',
      13000.00,
      'v1',
      'invalid-payment-status-1',
      'done'
    );
    RAISE EXCEPTION 'invalid payment status unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.solo_plus_cases (
      merchant_id,
      flow_origin,
      source_plan,
      expected_amount,
      requirements_policy_version,
      idempotency_key,
      refund_status
    ) VALUES (
      v_historical_case_merchant_id,
      'upgrade',
      'solo_lite',
      13000.00,
      'v1',
      'invalid-refund-status-1',
      'queued'
    );
    RAISE EXCEPTION 'invalid refund status unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.solo_plus_cases (
      merchant_id,
      flow_origin,
      source_plan,
      expected_amount,
      requirements_policy_version,
      idempotency_key
    ) VALUES (
      v_historical_case_merchant_id,
      'upgrade',
      'solo_lite',
      13000.00,
      '',
      'invalid-policy-version-1'
    );
    RAISE EXCEPTION 'empty requirements policy version unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  INSERT INTO public.solo_plus_cases (
    merchant_id,
    onboarding_session_id,
    flow_origin,
    source_plan,
    expected_amount,
    requirements_policy_version,
    idempotency_key,
    active_plan_snapshot
  ) VALUES (
    v_upgrade_merchant_id,
    NULL,
    'upgrade',
    'solo_lite',
    13000.00,
    'v1',
    'case-key-upgrade-1',
    'solo_lite'
  ) RETURNING id INTO v_upgrade_case_id;

  BEGIN
    UPDATE public.solo_plus_cases
    SET case_status = 'approved'
    WHERE id = v_upgrade_case_id;
    RAISE EXCEPTION 'invalid approval state unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.solo_plus_cases
    SET case_status = 'rejected'
    WHERE id = v_upgrade_case_id;
    RAISE EXCEPTION 'invalid rejection state unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.solo_plus_cases
    SET case_status = 'cancelled',
        payment_status = 'paid',
        refund_status = 'none'
    WHERE id = v_upgrade_case_id;
    RAISE EXCEPTION 'paid cancelled case without refund review unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  UPDATE public.solo_plus_cases
  SET payment_status = 'paid',
      rejected_at = now(),
      rejected_by_admin_id = NULL,
      rejection_reason = 'Declined'
  WHERE id = v_upgrade_case_id;

  BEGIN
    UPDATE public.solo_plus_cases
    SET case_status = 'rejected'
    WHERE id = v_upgrade_case_id;
    RAISE EXCEPTION 'rejected paid case without actor unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  INSERT INTO public.solo_plus_cases (
    merchant_id,
    flow_origin,
    source_plan,
    expected_amount,
    requirements_policy_version,
    idempotency_key
  ) VALUES (
    v_active_uniqueness_merchant_id,
    'upgrade',
    'solo_lite',
    13000.00,
    'v1',
    'active-upgrade-merchant-1'
  ) RETURNING id INTO v_active_uniqueness_case_id;

  BEGIN
    INSERT INTO public.solo_plus_cases (
      merchant_id,
      flow_origin,
      source_plan,
      expected_amount,
      requirements_policy_version,
      idempotency_key
    ) VALUES (
      v_active_uniqueness_merchant_id,
      'upgrade',
      'solo_lite',
      13000.00,
      'v1',
      'active-upgrade-merchant-2'
    );
    RAISE EXCEPTION 'same merchant with two active upgrade cases unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  UPDATE public.solo_plus_cases
  SET case_status = 'cancelled'
  WHERE id = v_active_uniqueness_case_id;

  INSERT INTO public.solo_plus_cases (
    merchant_id,
    onboarding_session_id,
    flow_origin,
    source_plan,
    expected_amount,
    requirements_policy_version,
    idempotency_key
  ) VALUES (
    v_active_uniqueness_merchant_id,
    v_active_uniqueness_onboarding_session_id,
    'onboarding',
    NULL,
    13000.00,
    'v1',
    'active-onboarding-merchant-1'
  ) RETURNING id INTO v_active_uniqueness_case_id;

  BEGIN
    INSERT INTO public.solo_plus_cases (
      merchant_id,
      flow_origin,
      source_plan,
      expected_amount,
      requirements_policy_version,
      idempotency_key
    ) VALUES (
      v_active_uniqueness_merchant_id,
      'upgrade',
      'solo_lite',
      13000.00,
      'v1',
      'active-cross-origin-merchant-2'
    );
    RAISE EXCEPTION 'same merchant with active onboarding then active upgrade unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.solo_plus_cases (
      onboarding_session_id,
      flow_origin,
      source_plan,
      expected_amount,
      requirements_policy_version,
      idempotency_key
    ) VALUES (
      v_onboarding_session_id,
      'onboarding',
      NULL,
      13000.00,
      'v1',
      'case-key-onboarding-dup'
    );
    RAISE EXCEPTION 'duplicate active onboarding session case unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.solo_plus_cases (
      merchant_id,
      flow_origin,
      source_plan,
      expected_amount,
      requirements_policy_version,
      idempotency_key
    ) VALUES (
      v_historical_case_merchant_id,
      'upgrade',
      'solo_lite',
      13000.00,
      'v1',
      'case-key-onboarding-1'
    );
    RAISE EXCEPTION 'duplicate idempotency key unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.solo_plus_cases
    SET payment_provider = 'paystack',
        payment_reference = 'shared-ref-1',
        payment_record_id = v_payment_record_id
    WHERE id = v_onboarding_case_id;

    INSERT INTO public.solo_plus_cases (
      merchant_id,
      flow_origin,
      source_plan,
      expected_amount,
      requirements_policy_version,
      idempotency_key,
      payment_provider,
      payment_reference
    ) VALUES (
      v_historical_case_merchant_id,
      'upgrade',
      'solo_lite',
      13000.00,
      'v1',
      'case-key-upgrade-4',
      'paystack',
      'shared-ref-1'
    );
    RAISE EXCEPTION 'duplicate provider reference unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  INSERT INTO public.solo_plus_cases (
    merchant_id,
    flow_origin,
    source_plan,
    expected_amount,
    requirements_policy_version,
    idempotency_key,
    payment_record_id,
    payment_status,
    refund_status,
    case_status
  ) VALUES (
    v_historical_case_merchant_id,
    'upgrade',
    'solo_lite',
    13000.00,
    'v1',
    'duplicate-payment-record-first-case',
    v_duplicate_payment_record_id,
    'paid',
    'review_required',
    'cancelled'
  ) RETURNING id INTO v_historical_case_one_id;

  BEGIN
    INSERT INTO public.solo_plus_cases (
      merchant_id,
      flow_origin,
      source_plan,
      expected_amount,
      requirements_policy_version,
      idempotency_key,
      payment_record_id
    ) VALUES (
      v_duplicate_payment_record_second_merchant_id,
      'upgrade',
      'solo_lite',
      13000.00,
      'v1',
      'duplicate-payment-record-second-case',
      v_duplicate_payment_record_id
    );
    RAISE EXCEPTION 'duplicate payment_record_id unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS
        v_constraint_name = CONSTRAINT_NAME,
        v_exception_detail = PG_EXCEPTION_DETAIL;

      IF v_constraint_name IS NOT NULL AND v_constraint_name <> '' THEN
        IF v_constraint_name <> 'idx_solo_plus_cases_payment_record_id' THEN
          RAISE EXCEPTION
            'expected idx_solo_plus_cases_payment_record_id, received %',
            v_constraint_name;
        END IF;
      ELSIF v_exception_detail IS NULL OR position('payment_record_id' in v_exception_detail) = 0 THEN
        RAISE EXCEPTION
          'expected payment_record_id duplicate detail, received %',
          coalesce(v_exception_detail, '<null>');
      END IF;
  END;

  INSERT INTO public.solo_plus_cases (
    merchant_id,
    flow_origin,
    source_plan,
    expected_amount,
    requirements_policy_version,
    idempotency_key,
    payment_status,
    refund_status,
    approved_at,
    approved_by_admin_id,
    case_status
  ) VALUES (
    v_historical_case_merchant_id,
    'upgrade',
    'solo_lite',
    13000.00,
    'v1',
    'historical-approved-1',
    'paid',
    'none',
    now(),
    v_admin_user_id,
    'approved'
  ) RETURNING id INTO v_historical_case_two_id;

  INSERT INTO public.solo_plus_cases (
    merchant_id,
    flow_origin,
    source_plan,
    expected_amount,
    requirements_policy_version,
    idempotency_key
  ) VALUES (
    v_historical_case_merchant_id,
    'upgrade',
    'solo_lite',
    13000.00,
    'v1',
    'historical-active-after-approved-1'
  ) RETURNING id INTO v_historical_case_three_id;

  UPDATE public.solo_plus_cases
  SET payment_status = 'paid',
      refund_status = 'review_required',
      rejected_at = now(),
      rejected_by_admin_id = v_admin_user_id,
      rejection_reason = 'Historical rejection test',
      case_status = 'rejected'
  WHERE id = v_historical_case_three_id;

  INSERT INTO public.solo_plus_cases (
    merchant_id,
    flow_origin,
    source_plan,
    expected_amount,
    requirements_policy_version,
    idempotency_key
  ) VALUES (
    v_historical_case_merchant_id,
    'upgrade',
    'solo_lite',
    13000.00,
    'v1',
    'historical-active-after-rejected-1'
  ) RETURNING id INTO v_historical_case_four_id;

  UPDATE public.solo_plus_cases
  SET payment_status = 'paid',
      refund_status = 'review_required',
      case_status = 'cancelled'
  WHERE id = v_historical_case_four_id;

  INSERT INTO public.solo_plus_cases (
    merchant_id,
    flow_origin,
    source_plan,
    expected_amount,
    requirements_policy_version,
    idempotency_key
  ) VALUES (
    v_historical_case_merchant_id,
    'upgrade',
    'solo_lite',
    13000.00,
    'v1',
    'historical-active-after-cancelled-1'
  ) RETURNING id INTO v_active_uniqueness_case_id;

  INSERT INTO public.solo_plus_case_requirements (
    case_id,
    requirement_code,
    requirement_state
  ) VALUES (
    v_upgrade_case_id,
    'bvn',
    'not_started'
  );

  BEGIN
    INSERT INTO public.solo_plus_case_requirements (
      case_id,
      requirement_code,
      requirement_state
    ) VALUES (
      v_upgrade_case_id,
      'bvn',
      'pending'
    );
    RAISE EXCEPTION 'duplicate requirement code unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.solo_plus_case_requirements (
      case_id,
      requirement_code,
      requirement_state
    ) VALUES (
      v_upgrade_case_id,
      'activity_profile',
      'reused'
    );
    RAISE EXCEPTION 'reused requirement without provenance unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.solo_plus_case_requirements (
      case_id,
      requirement_code,
      requirement_state
    ) VALUES (
      v_upgrade_case_id,
      'unknown_requirement',
      'not_started'
    );
    RAISE EXCEPTION 'invalid requirement code unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  INSERT INTO public.solo_plus_case_requirements (
    case_id,
    requirement_code,
    requirement_state,
    verification_log_id,
    original_completed_at,
    reuse_decision_at,
    reuse_reason,
    policy_rule_applied,
    completed_at
  ) VALUES (
    v_upgrade_case_id,
    'selfie_liveness',
    'reused',
    v_verification_log_id,
    now() - interval '1 day',
    now(),
    'same merchant evidence still valid',
    'solo_plus_policy_v1',
    now()
  );

  BEGIN
    INSERT INTO public.solo_plus_case_requirements (
      case_id,
      requirement_code,
      requirement_state,
      policy_rule_applied,
      completed_at
    ) VALUES (
      v_upgrade_case_id,
      'id_document',
      'waived',
      'manual waiver rule',
      now()
    );
    RAISE EXCEPTION 'waived requirement without admin review unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.solo_plus_case_requirements (
      case_id,
      requirement_code,
      requirement_state
    ) VALUES (
      v_upgrade_case_id,
      'settlement_account',
      'invalid_state'
    );
    RAISE EXCEPTION 'invalid requirement state unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.solo_plus_case_events (
      case_id,
      event_type,
      actor_type,
      policy_version
    ) VALUES (
      v_upgrade_case_id,
      ' ',
      'system',
      'v1'
    );
    RAISE EXCEPTION 'empty event type unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.solo_plus_case_events (
      case_id,
      event_type,
      actor_type,
      policy_version
    ) VALUES (
      v_upgrade_case_id,
      'case_created',
      'invalid_actor',
      'v1'
    );
    RAISE EXCEPTION 'invalid actor type unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  INSERT INTO public.solo_plus_case_events (
    case_id,
    event_type,
    actor_type,
    request_idempotency_key,
    policy_version
  ) VALUES (
    v_upgrade_case_id,
    'case_created',
    'system',
    'evt-key-1',
    'v1'
  );

  BEGIN
    INSERT INTO public.solo_plus_case_events (
      case_id,
      event_type,
      actor_type,
      request_idempotency_key,
      policy_version
    ) VALUES (
      v_upgrade_case_id,
      'case_created',
      'system',
      'evt-key-1',
      'v1'
    );
    RAISE EXCEPTION 'duplicate case event idempotency unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE relname = 'solo_plus_cases'
      AND relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on solo_plus_cases';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE relname = 'solo_plus_case_requirements'
      AND relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on solo_plus_case_requirements';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE relname = 'solo_plus_case_events'
      AND relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on solo_plus_case_events';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'solo_plus_cases'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'solo_plus_cases unexpectedly has direct write policies';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'solo_plus_case_requirements'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'solo_plus_case_requirements unexpectedly has direct write policies';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'solo_plus_case_events'
      AND cmd IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'solo_plus_case_events unexpectedly exposes direct policies';
  END IF;
END;
$$;

ROLLBACK;
