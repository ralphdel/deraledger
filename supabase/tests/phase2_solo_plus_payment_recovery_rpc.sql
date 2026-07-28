BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(p_condition BOOLEAN, p_message TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(p_condition, false) THEN
    RAISE EXCEPTION '%', p_message;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_service_role_only_function_execute(
  p_function_name TEXT,
  p_type_args TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_function_oid oid;
  v_owner_name TEXT;
  v_explicit_grantees TEXT[];
  v_denied_role TEXT;
BEGIN
  SELECT p.oid, pg_get_userbyid(p.proowner)
  INTO v_function_oid, v_owner_name
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = p_function_name
    AND oidvectortypes(p.proargtypes) = p_type_args;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'expected public.% (%) to exist for function grant assertion', p_function_name, p_type_args;
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
  INTO v_explicit_grantees
  FROM information_schema.routine_privileges
  WHERE specific_schema = 'public'
    AND routine_name = p_function_name
    AND privilege_type = 'EXECUTE'
    AND grantee <> v_owner_name;

  IF v_explicit_grantees <> ARRAY['service_role'] THEN
    RAISE EXCEPTION '% grants are not owner-aware service_role-only: explicit_non_owner=% owner=%',
      p_function_name,
      v_explicit_grantees,
      v_owner_name;
  END IF;
END;
$$;

DO $$
DECLARE
  v_user_id UUID := '00000000-0000-4000-8000-000000013001'::uuid;
  v_merchant_id UUID := '00000000-0000-4000-8000-000000013101'::uuid;
  v_conflict_user_id UUID := '00000000-0000-4000-8000-000000013002'::uuid;
  v_conflict_merchant_id UUID := '00000000-0000-4000-8000-000000013102'::uuid;
  v_success_user_id UUID := '00000000-0000-4000-8000-000000013003'::uuid;
  v_success_merchant_id UUID := '00000000-0000-4000-8000-000000013103'::uuid;
  v_legacy_user_id UUID := '00000000-0000-4000-8000-000000013004'::uuid;
  v_legacy_merchant_id UUID := '00000000-0000-4000-8000-000000013104'::uuid;
  v_case_id UUID;
  v_old_payment_id UUID;
  v_new_payment_id UUID;
  v_legacy_case_id UUID;
  v_legacy_old_payment_id UUID;
  v_legacy_new_payment_id UUID;
  v_result JSONB;
  v_replay JSONB;
  v_legacy_result JSONB;
  v_old_payment JSONB;
  v_new_payment JSONB;
  v_case_payment_record_id UUID;
  v_old_status TEXT;
  v_new_status TEXT;
  v_pending_count INTEGER;
  v_total_case_payment_rows INTEGER;
  v_new_recovery JSONB;
  v_old_recovery JSONB;
  v_conflict_message TEXT;
  v_guard_message TEXT;
  v_success_case_id UUID;
  v_success_old_payment_id UUID;
  v_conflict_case_id UUID;
  v_conflict_old_payment_id UUID;
  v_conflict_newer_payment_id UUID;
  v_old_pending_predicate_count INTEGER;
BEGIN
  PERFORM pg_temp.assert_true(
    EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'recover_solo_plus_payment_attempt_v1'
        AND oidvectortypes(p.proargtypes) =
          'uuid, uuid, uuid, text, text, text, text, text'
    ),
    'expected public.recover_solo_plus_payment_attempt_v1(uuid, uuid, uuid, text, text, text, text, text)'
  );

  PERFORM pg_temp.assert_service_role_only_function_execute(
    'recover_solo_plus_payment_attempt_v1',
    'uuid, uuid, uuid, text, text, text, text, text'
  );

  INSERT INTO auth.users (id)
  VALUES
    (v_user_id),
    (v_conflict_user_id),
    (v_success_user_id),
    (v_legacy_user_id)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.merchants (
    id,
    user_id,
    business_name,
    email,
    subscription_plan,
    merchant_tier,
    verification_status
  )
  VALUES
    (
      v_merchant_id,
      v_user_id,
      'Solo Plus Recovery Merchant',
      'solo-plus-recovery@example.test',
      'starter',
      'starter',
      'pending'
    ),
    (
      v_conflict_merchant_id,
      v_conflict_user_id,
      'Solo Plus Recovery Conflict Merchant',
      'solo-plus-recovery-conflict@example.test',
      'starter',
      'starter',
      'pending'
    ),
    (
      v_success_merchant_id,
      v_success_user_id,
      'Solo Plus Recovery Success Guard Merchant',
      'solo-plus-recovery-success@example.test',
      'starter',
      'starter',
      'pending'
    ),
    (
      v_legacy_merchant_id,
      v_legacy_user_id,
      'Solo Plus Recovery Legacy Unlinked Merchant',
      'solo-plus-recovery-legacy@example.test',
      'starter',
      'starter',
      'pending'
    )
  ON CONFLICT (id) DO NOTHING;

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
    v_merchant_id,
    'upgrade',
    'solo_lite',
    'solo_plus',
    'awaiting_payment',
    'pending',
    'none',
    13000.00,
    'NGN',
    'solo-plus-payment-recovery-v1',
    '{}'::jsonb,
    'starter',
    'solo-plus-recovery-case',
    '{}'::jsonb
  )
  RETURNING id INTO v_case_id;

  INSERT INTO public.payment_records (
    id,
    user_id,
    merchant_id,
    solo_plus_case_id,
    payment_purpose,
    payment_method,
    provider_name,
    internal_reference,
    provider_reference,
    amount_paid,
    expected_amount,
    currency,
    payment_status,
    processing_status,
    account_setup_status,
    customer_email,
    plan_id,
    plan_name,
    metadata,
    raw_provider_payload
  )
  VALUES (
    '00000000-0000-4000-8000-000000013201'::uuid,
    v_user_id,
    v_merchant_id,
    v_case_id,
    'plan_upgrade',
    'card',
    'paystack',
    'SPL-UPG-OLD-RECOVERY-TEST',
    'SPL-UPG-OLD-RECOVERY-TEST',
    0,
    13000.00,
    'NGN',
    'pending',
    'pending_payment',
    'pending_payment',
    'solo-plus-recovery@example.test',
    'solo_plus',
    'solo_plus',
    jsonb_build_object(
      'payment_initialization',
      jsonb_build_object(
        'status', 'initialization_failed',
        'provider', 'paystack',
        'completionMode', 'paystack_resume',
        'providerReference', 'SPL-UPG-OLD-RECOVERY-TEST',
        'authorizationUrl', NULL,
        'accessCode', NULL,
        'checkoutUrl', NULL,
        'providerTransactionReference', NULL,
        'failureCode', 'duplicate_reference',
        'failureMessage', 'stale checkout reference',
        'initializedAt', NULL,
        'lastUpdatedAt', now()
      )
    ),
    '{}'::jsonb
  )
  RETURNING id INTO v_old_payment_id;

  UPDATE public.solo_plus_cases
  SET
    payment_record_id = v_old_payment_id,
    payment_provider = 'paystack',
    payment_reference = 'SPL-UPG-OLD-RECOVERY-TEST'
  WHERE id = v_case_id;

  BEGIN
    PERFORM public.recover_solo_plus_payment_attempt_v1(
      v_old_payment_id,
      v_case_id,
      v_merchant_id,
      'guard-key',
      'successful',
      'should-not-apply',
      'paystack',
      'card'
    );
    RAISE EXCEPTION 'expected provider verification guard to reject non-unpaid category';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_guard_message = MESSAGE_TEXT;
      IF position(
        'only after unpaid unrecoverable provider verification' IN COALESCE(v_guard_message, '')
      ) = 0 THEN
        RAISE;
      END IF;
  END;

  SELECT count(*)
  INTO v_old_pending_predicate_count
  FROM public.payment_records
  WHERE id = v_old_payment_id
    AND solo_plus_case_id = v_case_id
    AND payment_status = 'pending';

  PERFORM pg_temp.assert_true(
    v_old_pending_predicate_count = 1,
    'expected provider-verification guard to leave the original pending attempt unchanged'
  );

  v_result := public.recover_solo_plus_payment_attempt_v1(
    v_old_payment_id,
    v_case_id,
    v_merchant_id,
    'recovery-key-1',
    'unpaid_unrecoverable',
    'provider_checkout_duplicate_reference',
    'monnify',
    'bank_transfer'
  );

  PERFORM pg_temp.assert_true(v_result->>'kind' = 'applied', 'expected applied recovery result');
  v_old_payment := v_result->'old_payment';
  v_new_payment := v_result->'new_payment';
  v_new_payment_id := (v_new_payment->>'id')::uuid;

  PERFORM pg_temp.assert_true(
    v_new_payment_id IS NOT NULL AND v_new_payment_id <> v_old_payment_id,
    'expected replacement payment record with a new id'
  );
  PERFORM pg_temp.assert_true(
    v_new_payment->>'provider_name' = 'monnify',
    'expected replacement provider_name to match requested provider'
  );
  PERFORM pg_temp.assert_true(
    v_new_payment->>'payment_method' = 'bank_transfer',
    'expected replacement payment_method to match requested method'
  );
  PERFORM pg_temp.assert_true(
    COALESCE(v_new_payment->>'provider_reference', '') LIKE 'SPL-UPG-%',
    'expected replacement provider reference to use the Solo Plus upgrade prefix'
  );

  SELECT payment_status, metadata->'payment_recovery'
  INTO v_old_status, v_old_recovery
  FROM public.payment_records
  WHERE id = v_old_payment_id;

  SELECT payment_status, metadata->'payment_recovery'
  INTO v_new_status, v_new_recovery
  FROM public.payment_records
  WHERE id = v_new_payment_id;

  SELECT payment_record_id
  INTO v_case_payment_record_id
  FROM public.solo_plus_cases
  WHERE id = v_case_id;

  SELECT count(*)
  INTO v_pending_count
  FROM public.payment_records
  WHERE solo_plus_case_id = v_case_id
    AND payment_status = 'pending';

  SELECT count(*)
  INTO v_total_case_payment_rows
  FROM public.payment_records
  WHERE solo_plus_case_id = v_case_id;

  PERFORM pg_temp.assert_true(v_old_status = 'abandoned', 'expected old payment status to be abandoned');
  PERFORM pg_temp.assert_true(v_new_status = 'pending', 'expected replacement payment status to remain pending');
  PERFORM pg_temp.assert_true(v_case_payment_record_id = v_new_payment_id, 'expected case payment_record_id to point at replacement payment');
  PERFORM pg_temp.assert_true(v_pending_count = 1, 'expected exactly one active pending payment for the Solo Plus case');
  PERFORM pg_temp.assert_true(v_total_case_payment_rows = 2, 'expected exactly two case-linked payment records after recovery');

  SELECT count(*)
  INTO v_old_pending_predicate_count
  FROM public.payment_records
  WHERE id = v_old_payment_id
    AND solo_plus_case_id = v_case_id
    AND payment_status = 'pending';

  PERFORM pg_temp.assert_true(
    v_old_pending_predicate_count = 0,
    'expected old payment to exit idx_payment_records_solo_plus_pending_case before replacement remains pending'
  );
  PERFORM pg_temp.assert_true(
    COALESCE(v_new_recovery->>'recoveryOfPaymentRecordId', '') = v_old_payment_id::text,
    'expected replacement payment to preserve recoveryOfPaymentRecordId'
  );
  PERFORM pg_temp.assert_true(
    COALESCE(v_new_recovery->>'replacementPaymentRecordId', '') = '',
    'expected replacement payment to keep replacementPaymentRecordId null for audit clarity'
  );
  PERFORM pg_temp.assert_true(
    COALESCE(v_old_recovery->>'replacementPaymentRecordId', '') = v_new_payment_id::text,
    'expected superseded payment to point at its replacement payment record'
  );

  v_replay := public.recover_solo_plus_payment_attempt_v1(
    v_old_payment_id,
    v_case_id,
    v_merchant_id,
    'recovery-key-1',
    'unpaid_unrecoverable',
    'provider_checkout_duplicate_reference',
    'monnify',
    'bank_transfer'
  );

  PERFORM pg_temp.assert_true(v_replay->>'kind' = 'idempotent_replay', 'expected same recovery key to replay idempotently');
  PERFORM pg_temp.assert_true(
    (v_replay->'new_payment'->>'id')::uuid = v_new_payment_id,
    'expected replay to return the existing replacement payment record'
  );

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
    v_legacy_merchant_id,
    'upgrade',
    'solo_lite',
    'solo_plus',
    'awaiting_payment',
    'pending',
    'none',
    13000.00,
    'NGN',
    'solo-plus-payment-recovery-v1',
    '{}'::jsonb,
    'starter',
    'solo-plus-recovery-legacy-unlinked-case',
    '{}'::jsonb
  )
  RETURNING id INTO v_legacy_case_id;

  INSERT INTO public.payment_records (
    id,
    user_id,
    merchant_id,
    solo_plus_case_id,
    payment_purpose,
    payment_method,
    provider_name,
    internal_reference,
    provider_reference,
    amount_paid,
    expected_amount,
    currency,
    payment_status,
    processing_status,
    account_setup_status,
    customer_email,
    plan_id,
    plan_name,
    metadata,
    raw_provider_payload
  )
  VALUES (
    '00000000-0000-4000-8000-000000013214'::uuid,
    v_legacy_user_id,
    v_legacy_merchant_id,
    v_legacy_case_id,
    'plan_upgrade',
    'card',
    'paystack',
    'SPL-UPG-LEGACY-UNLINKED',
    'SPL-UPG-LEGACY-UNLINKED',
    0,
    13000.00,
    'NGN',
    'pending',
    'pending_payment',
    'pending_payment',
    'solo-plus-recovery-legacy@example.test',
    'solo_plus',
    'solo_plus',
    jsonb_build_object(
      'payment_initialization',
      jsonb_build_object(
        'status', 'initialization_failed',
        'provider', 'paystack',
        'completionMode', 'paystack_resume',
        'providerReference', 'SPL-UPG-LEGACY-UNLINKED',
        'authorizationUrl', NULL,
        'accessCode', NULL,
        'checkoutUrl', NULL,
        'providerTransactionReference', NULL,
        'failureCode', 'duplicate_reference',
        'failureMessage', 'legacy reverse pointers were not populated',
        'initializedAt', NULL,
        'lastUpdatedAt', now()
      )
    ),
    '{}'::jsonb
  )
  RETURNING id INTO v_legacy_old_payment_id;

  PERFORM pg_temp.assert_true(
    EXISTS (
      SELECT 1
      FROM public.solo_plus_cases
      WHERE id = v_legacy_case_id
        AND payment_record_id IS NULL
        AND payment_provider IS NULL
        AND payment_reference IS NULL
    ),
    'expected legacy fixture to start with fully null reverse payment pointers'
  );

  v_legacy_result := public.recover_solo_plus_payment_attempt_v1(
    v_legacy_old_payment_id,
    v_legacy_case_id,
    v_legacy_merchant_id,
    'recovery-key-legacy-unlinked',
    'unpaid_unrecoverable',
    'legacy_unlinked_case_pointer_recovery',
    'paystack',
    'card'
  );

  PERFORM pg_temp.assert_true(
    v_legacy_result->>'kind' = 'applied',
    'expected recovery to accept a fully null legacy case reverse-pointer state'
  );

  v_legacy_new_payment_id := (v_legacy_result->'new_payment'->>'id')::uuid;

  PERFORM pg_temp.assert_true(
    v_legacy_new_payment_id IS NOT NULL AND v_legacy_new_payment_id <> v_legacy_old_payment_id,
    'expected legacy-unlinked recovery to create a replacement payment'
  );

  SELECT payment_record_id
  INTO v_case_payment_record_id
  FROM public.solo_plus_cases
  WHERE id = v_legacy_case_id;

  PERFORM pg_temp.assert_true(
    v_case_payment_record_id = v_legacy_new_payment_id,
    'expected legacy-unlinked recovery to atomically point the case at the replacement payment'
  );

  SELECT count(*)
  INTO v_pending_count
  FROM public.payment_records
  WHERE solo_plus_case_id = v_legacy_case_id
    AND payment_status = 'pending';

  PERFORM pg_temp.assert_true(
    v_pending_count = 1,
    'expected legacy-unlinked recovery to leave exactly one pending payment'
  );

  BEGIN
    PERFORM public.recover_solo_plus_payment_attempt_v1(
      v_old_payment_id,
      v_case_id,
      v_merchant_id,
      'recovery-key-2',
      'unpaid_unrecoverable',
      'provider_checkout_duplicate_reference',
      'paystack',
      'card'
    );
    RAISE EXCEPTION 'expected conflicting recovery key to fail closed';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_conflict_message = MESSAGE_TEXT;
      IF position('already superseded' IN COALESCE(v_conflict_message, '')) = 0 THEN
        RAISE;
      END IF;
  END;

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
    v_conflict_merchant_id,
    'upgrade',
    'solo_lite',
    'solo_plus',
    'awaiting_payment',
    'pending',
    'none',
    13000.00,
    'NGN',
    'solo-plus-payment-recovery-v1',
    '{}'::jsonb,
    'starter',
    'solo-plus-recovery-active-conflict-case',
    '{}'::jsonb
  )
  RETURNING id INTO v_conflict_case_id;

  INSERT INTO public.payment_records (
    id,
    user_id,
    merchant_id,
    solo_plus_case_id,
    payment_purpose,
    payment_method,
    provider_name,
    internal_reference,
    provider_reference,
    amount_paid,
    expected_amount,
    currency,
    payment_status,
    processing_status,
    account_setup_status,
    customer_email,
    plan_id,
    plan_name,
    metadata,
    raw_provider_payload
  )
  VALUES (
    '00000000-0000-4000-8000-000000013204'::uuid,
    v_conflict_user_id,
    v_conflict_merchant_id,
    v_conflict_case_id,
    'plan_upgrade',
    'card',
    'paystack',
    'SPL-UPG-CONFLICT-OLD',
    'SPL-UPG-CONFLICT-OLD',
    0,
    13000.00,
    'NGN',
    'abandoned',
    'failed',
    'failed',
    'solo-plus-recovery-conflict@example.test',
    'solo_plus',
    'solo_plus',
    '{}'::jsonb,
    '{}'::jsonb
  )
  RETURNING id INTO v_conflict_old_payment_id;

  INSERT INTO public.payment_records (
    id,
    user_id,
    merchant_id,
    solo_plus_case_id,
    payment_purpose,
    payment_method,
    provider_name,
    internal_reference,
    provider_reference,
    amount_paid,
    expected_amount,
    currency,
    payment_status,
    processing_status,
    account_setup_status,
    customer_email,
    plan_id,
    plan_name,
    metadata,
    raw_provider_payload
  )
  VALUES (
    '00000000-0000-4000-8000-000000013205'::uuid,
    v_conflict_user_id,
    v_conflict_merchant_id,
    v_conflict_case_id,
    'plan_upgrade',
    'card',
    'paystack',
    'SPL-UPG-CONFLICT-NEWER',
    'SPL-UPG-CONFLICT-NEWER',
    0,
    13000.00,
    'NGN',
    'pending',
    'pending_payment',
    'pending_payment',
    'solo-plus-recovery-conflict@example.test',
    'solo_plus',
    'solo_plus',
    '{}'::jsonb,
    '{}'::jsonb
  )
  RETURNING id INTO v_conflict_newer_payment_id;

  UPDATE public.solo_plus_cases
  SET
    payment_record_id = v_conflict_newer_payment_id,
    payment_provider = 'paystack',
    payment_reference = 'SPL-UPG-CONFLICT-NEWER'
  WHERE id = v_conflict_case_id;

  BEGIN
    PERFORM public.recover_solo_plus_payment_attempt_v1(
      v_conflict_old_payment_id,
      v_conflict_case_id,
      v_conflict_merchant_id,
      'recovery-key-active-conflict',
      'unpaid_unrecoverable',
      'provider_checkout_duplicate_reference',
      'monnify',
      'bank_transfer'
    );
    RAISE EXCEPTION 'expected active pending conflict to fail closed';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_conflict_message = MESSAGE_TEXT;
      IF position(
        'newer active pending attempt already exists' IN COALESCE(v_conflict_message, '')
      ) = 0 THEN
        RAISE;
      END IF;
  END;

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
    v_success_merchant_id,
    'upgrade',
    'solo_lite',
    'solo_plus',
    'awaiting_payment',
    'pending',
    'none',
    13000.00,
    'NGN',
    'solo-plus-payment-recovery-v1',
    '{}'::jsonb,
    'starter',
    'solo-plus-recovery-success-case',
    '{}'::jsonb
  )
  RETURNING id INTO v_success_case_id;

  INSERT INTO public.payment_records (
    id,
    user_id,
    merchant_id,
    solo_plus_case_id,
    payment_purpose,
    payment_method,
    provider_name,
    internal_reference,
    provider_reference,
    amount_paid,
    expected_amount,
    currency,
    payment_status,
    processing_status,
    account_setup_status,
    customer_email,
    plan_id,
    plan_name,
    metadata,
    raw_provider_payload
  )
  VALUES (
    '00000000-0000-4000-8000-000000013202'::uuid,
    v_success_user_id,
    v_success_merchant_id,
    v_success_case_id,
    'plan_upgrade',
    'card',
    'paystack',
    'SPL-UPG-SUCCESS-GUARD',
    'SPL-UPG-SUCCESS-GUARD',
    0,
    13000.00,
    'NGN',
    'pending',
    'pending_payment',
    'pending_payment',
    'solo-plus-recovery-success@example.test',
    'solo_plus',
    'solo_plus',
    '{}'::jsonb,
    '{}'::jsonb
  )
  RETURNING id INTO v_success_old_payment_id;

  INSERT INTO public.payment_records (
    id,
    user_id,
    merchant_id,
    solo_plus_case_id,
    payment_purpose,
    payment_method,
    provider_name,
    internal_reference,
    provider_reference,
    amount_paid,
    expected_amount,
    currency,
    payment_status,
    processing_status,
    account_setup_status,
    customer_email,
    plan_id,
    plan_name,
    metadata,
    raw_provider_payload
  )
  VALUES (
    '00000000-0000-4000-8000-000000013203'::uuid,
    v_success_user_id,
    v_success_merchant_id,
    v_success_case_id,
    'plan_upgrade',
    'card',
    'paystack',
    'SPL-UPG-SUCCESS-SETTLED',
    'SPL-UPG-SUCCESS-SETTLED',
    13000.00,
    13000.00,
    'NGN',
    'successful',
    'processed',
    'active',
    'solo-plus-recovery-success@example.test',
    'solo_plus',
    'solo_plus',
    '{}'::jsonb,
    '{}'::jsonb
  );

  BEGIN
    PERFORM public.recover_solo_plus_payment_attempt_v1(
      v_success_old_payment_id,
      v_success_case_id,
      v_success_merchant_id,
      'recovery-key-success-guard',
      'unpaid_unrecoverable',
      'provider_checkout_duplicate_reference',
      'paystack',
      'card'
    );
    RAISE EXCEPTION 'expected successful-payment guard to block recovery';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_guard_message = MESSAGE_TEXT;
      IF position(
        'already has a successful payment' IN COALESCE(v_guard_message, '')
      ) = 0 THEN
        RAISE;
      END IF;
  END;
END;
$$;

ROLLBACK;
