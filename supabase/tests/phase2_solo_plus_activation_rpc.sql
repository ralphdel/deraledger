BEGIN;

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

CREATE OR REPLACE FUNCTION pg_temp.assert_table_rls_state(
  p_table_name TEXT,
  p_expected_enabled BOOLEAN,
  p_expected_forced BOOLEAN
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_enabled BOOLEAN;
  v_forced BOOLEAN;
BEGIN
  SELECT c.relrowsecurity, c.relforcerowsecurity
  INTO v_enabled, v_forced
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = p_table_name
    AND c.relkind = 'r';

  IF v_enabled IS DISTINCT FROM p_expected_enabled THEN
    RAISE EXCEPTION '% has unexpected relrowsecurity state %', p_table_name, v_enabled;
  END IF;

  IF v_forced IS DISTINCT FROM p_expected_forced THEN
    RAISE EXCEPTION '% has unexpected relforcerowsecurity state %', p_table_name, v_forced;
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

CREATE OR REPLACE FUNCTION pg_temp.seed_activation_case(
  p_case_id uuid,
  p_merchant_id uuid,
  p_flow_origin text,
  p_source_plan text,
  p_case_status text,
  p_payment_status text,
  p_refund_status text,
  p_row_version integer,
  p_payment_reference text,
  p_requirements_state text DEFAULT 'passed'
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_requirement_code text;
  v_onboarding_session_id uuid;
BEGIN
  IF p_flow_origin = 'onboarding' THEN
    v_onboarding_session_id := ('00000000-0000-4000-8000-' || right(replace(p_case_id::text, '-', ''), 12))::uuid;

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
      v_onboarding_session_id,
      'activation-' || right(replace(p_case_id::text, '-', ''), 12) || '@example.test',
      'Activation Seed ' || right(replace(p_case_id::text, '-', ''), 12),
      'solo_plus',
      'under_review',
      'activation-seed-session-' || right(replace(p_case_id::text, '-', ''), 12),
      now() + interval '7 days'
    )
    ON CONFLICT (id) DO NOTHING;
  ELSE
    v_onboarding_session_id := NULL;
  END IF;

  INSERT INTO public.solo_plus_cases (
    id,
    merchant_id,
    onboarding_session_id,
    flow_origin,
    source_plan,
    target_plan,
    case_status,
    payment_status,
    refund_status,
    payment_reference,
    expected_amount,
    payment_currency,
    requirements_policy_version,
    requirements_snapshot,
    active_plan_snapshot,
    approved_at,
    approved_by_admin_id,
    idempotency_key,
    row_version,
    audit_metadata
  )
  VALUES (
    p_case_id,
    p_merchant_id,
    v_onboarding_session_id,
    p_flow_origin,
    p_source_plan,
    'solo_plus',
    p_case_status,
    p_payment_status,
    p_refund_status,
    p_payment_reference,
    '13000.00'::numeric,
    'NGN',
    'solo-plus-policy-v1',
    '{"phase":"commit10"}'::jsonb,
    CASE
      WHEN p_flow_origin = 'upgrade' THEN 'solo_lite'
      ELSE 'starter'
    END,
    CASE WHEN p_case_status = 'approved' THEN now() ELSE NULL END,
    CASE WHEN p_case_status = 'approved' THEN '00000000-0000-4000-8000-000000010001'::uuid ELSE NULL END,
    'case-seed-' || right(replace(p_case_id::text, '-', ''), 12),
    p_row_version,
    '{}'::jsonb
  );

  FOREACH v_requirement_code IN ARRAY ARRAY[
    'bvn',
    'selfie_liveness',
    'id_document',
    'proof_of_address',
    'settlement_account',
    'activity_profile'
  ]
  LOOP
    INSERT INTO public.solo_plus_case_requirements (
      id,
      case_id,
      requirement_code,
      requirement_state,
      evidence_source_type,
      evidence_source_id,
      evidence_reference,
      original_completed_at,
      reuse_decision_at,
      reuse_reason,
      policy_rule_applied,
      reviewed_by_admin_id,
      review_note,
      provider_name,
      provider_reference,
      completed_at,
      metadata
    )
    VALUES (
      gen_random_uuid(),
      p_case_id,
      v_requirement_code,
      p_requirements_state,
      CASE WHEN v_requirement_code IN ('id_document', 'proof_of_address') THEN 'merchant_document' ELSE 'verification_log' END,
      gen_random_uuid(),
      'safe-ref-' || v_requirement_code,
      now() - interval '2 days',
      CASE WHEN p_requirements_state = 'reused' THEN now() - interval '1 day' ELSE NULL END,
      CASE WHEN p_requirements_state = 'reused' THEN 'trusted reuse' ELSE NULL END,
      CASE WHEN p_requirements_state IN ('reused', 'waived') THEN 'solo-plus-policy-v1' ELSE NULL END,
      CASE WHEN p_requirements_state = 'waived' THEN '00000000-0000-4000-8000-000000010001'::uuid ELSE NULL END,
      CASE WHEN p_requirements_state = 'waived' THEN 'manual waiver' ELSE NULL END,
      'provider-' || v_requirement_code,
      'provider-ref-' || v_requirement_code,
      now() - interval '1 day',
      jsonb_build_object('safe', true, 'requirement', v_requirement_code)
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_admin_id uuid := '00000000-0000-4000-8000-000000010001'::uuid;
  v_upgrade_user_id uuid := '00000000-0000-4000-8000-000000010002'::uuid;
  v_onboarding_user_id uuid := '00000000-0000-4000-8000-000000010003'::uuid;
  v_upgrade_merchant_id uuid := '00000000-0000-4000-8000-000000010011'::uuid;
  v_onboarding_merchant_id uuid := '00000000-0000-4000-8000-000000010012'::uuid;
  v_missing_merchant_case_id uuid := '00000000-0000-4000-8000-000000010101'::uuid;
  v_upgrade_case_id uuid := '00000000-0000-4000-8000-000000010102'::uuid;
  v_onboarding_case_id uuid := '00000000-0000-4000-8000-000000010103'::uuid;
  v_unpaid_case_id uuid := '00000000-0000-4000-8000-000000010104'::uuid;
  v_refund_case_id uuid := '00000000-0000-4000-8000-000000010105'::uuid;
  v_pending_case_id uuid := '00000000-0000-4000-8000-000000010106'::uuid;
  v_missing_req_case_id uuid := '00000000-0000-4000-8000-000000010107'::uuid;
  v_failed_req_case_id uuid := '00000000-0000-4000-8000-000000010108'::uuid;
  v_upgrade_conflict_case_id uuid := '00000000-0000-4000-8000-000000010109'::uuid;
  v_feature_disabled_case_id uuid := '00000000-0000-4000-8000-000000010110'::uuid;
  v_duplicate_req_case_id uuid := '00000000-0000-4000-8000-000000010111'::uuid;
  v_atomic_case_id uuid := '00000000-0000-4000-8000-000000010112'::uuid;
  v_result jsonb;
  v_event_count bigint;
  v_row_version integer;
  v_flag_state_before text[];
  v_flag_state_after text[];
  v_event_payload jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'activate_solo_plus_case_v1'
      AND oidvectortypes(p.proargtypes) = 'uuid, bigint, text, uuid, text'
  ) THEN
    RAISE EXCEPTION 'expected public.activate_solo_plus_case_v1(uuid, bigint, text, uuid, text)';
  END IF;

  PERFORM pg_temp.assert_service_role_only_function_execute(
    'activate_solo_plus_case_v1',
    'uuid, bigint, text, uuid, text'
  );

  PERFORM pg_temp.assert_table_rls_state('solo_plus_cases', true, false);
  PERFORM pg_temp.assert_table_rls_state('solo_plus_case_requirements', true, false);
  PERFORM pg_temp.assert_table_rls_state('solo_plus_case_events', true, false);

  PERFORM pg_temp.assert_table_access_manifest('solo_plus_cases', 'merchant_read_select');
  PERFORM pg_temp.assert_table_access_manifest('solo_plus_case_requirements', 'merchant_read_select');
  PERFORM pg_temp.assert_table_access_manifest('solo_plus_case_events', 'internal');

  SELECT COALESCE(array_agg(key || '=' || value ORDER BY key), ARRAY[]::text[])
  INTO v_flag_state_before
  FROM public.platform_settings
  WHERE key IN ('plan_migration_solo_lite_enabled', 'solo_plus_enabled', 'solo_plus_kyc_enabled');

  UPDATE public.platform_settings
  SET value = 'true'
  WHERE key = 'solo_plus_kyc_enabled';

  INSERT INTO auth.users (id)
  VALUES
    (v_admin_id),
    (v_upgrade_user_id),
    (v_onboarding_user_id)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.onboarding_sessions (id, email, business_name, plan, status, expires_at)
  VALUES
    ('00000000-0000-4000-8000-000000010301'::uuid, 'missing-merchant@example.test', 'Missing Merchant', 'solo_plus', 'payment_confirmed', now() + interval '7 days'),
    ('00000000-0000-4000-8000-000000010302'::uuid, 'onboarding-user@example.test', 'Solo Plus Onboarding', 'solo_plus', 'payment_confirmed', now() + interval '7 days'),
    ('00000000-0000-4000-8000-000000010303'::uuid, 'feature-disabled@example.test', 'Solo Plus Disabled', 'solo_plus', 'payment_confirmed', now() + interval '7 days')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.merchants (
    id,
    user_id,
    business_name,
    email,
    verification_status,
    subscription_plan,
    merchant_tier,
    monthly_collection_limit,
    workspace_type,
    onboarding_status,
    setup_mode,
    live_features_enabled
  )
  VALUES
    (
      v_upgrade_merchant_id,
      v_upgrade_user_id,
      'Solo Lite Upgrade Merchant',
      'upgrade-merchant@example.test',
      'pending',
      'individual',
      'individual',
      5000000,
      'personal',
      'setup_mode',
      true,
      false
    ),
    (
      v_onboarding_merchant_id,
      v_onboarding_user_id,
      'Starter Onboarding Merchant',
      'onboarding-merchant@example.test',
      'pending',
      'starter',
      'starter',
      0,
      'personal',
      'setup_mode',
      true,
      false
    )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.workspaces (
    id,
    owner_user_id,
    merchant_id,
    workspace_type,
    display_name,
    plan_type,
    onboarding_status,
    setup_mode,
    live_features_enabled
  )
  VALUES
    (
      '00000000-0000-4000-8000-000000010401'::uuid,
      v_upgrade_user_id,
      v_upgrade_merchant_id,
      'personal',
      'Upgrade Workspace',
      'individual',
      'setup_mode',
      true,
      false
    ),
    (
      '00000000-0000-4000-8000-000000010402'::uuid,
      v_onboarding_user_id,
      v_onboarding_merchant_id,
      'personal',
      'Onboarding Workspace',
      'starter',
      'setup_mode',
      true,
      false
    )
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.merchants
  SET workspace_id = CASE
    WHEN id = v_upgrade_merchant_id THEN '00000000-0000-4000-8000-000000010401'::uuid
    WHEN id = v_onboarding_merchant_id THEN '00000000-0000-4000-8000-000000010402'::uuid
    ELSE workspace_id
  END
  WHERE id IN (v_upgrade_merchant_id, v_onboarding_merchant_id);

  INSERT INTO public.workspace_subscriptions (
    id,
    workspace_id,
    merchant_id,
    plan_type,
    subscription_status,
    payment_reference,
    amount_paid,
    period_start
  )
  VALUES
    (
      '00000000-0000-4000-8000-000000010501'::uuid,
      '00000000-0000-4000-8000-000000010401'::uuid,
      v_upgrade_merchant_id,
      'individual',
      'active',
      'old-individual-sub',
      '5000.00'::numeric,
      now() - interval '30 days'
    ),
    (
      '00000000-0000-4000-8000-000000010502'::uuid,
      '00000000-0000-4000-8000-000000010401'::uuid,
      v_upgrade_merchant_id,
      'solo_plus',
      'paid_setup',
      'upgrade-payment-ref',
      '13000.00'::numeric,
      now() - interval '1 day'
    ),
    (
      '00000000-0000-4000-8000-000000010503'::uuid,
      '00000000-0000-4000-8000-000000010402'::uuid,
      v_onboarding_merchant_id,
      'solo_plus',
      'paid_setup',
      'onboarding-payment-ref',
      '13000.00'::numeric,
      now() - interval '1 day'
    )
  ON CONFLICT (id) DO NOTHING;

  PERFORM pg_temp.seed_activation_case(
    v_missing_merchant_case_id,
    NULL,
    'onboarding',
    NULL,
    'approved',
    'paid',
    'none',
    4,
    'missing-merchant-payment-ref'
  );
  UPDATE public.solo_plus_cases
  SET onboarding_session_id = '00000000-0000-4000-8000-000000010301'::uuid
  WHERE id = v_missing_merchant_case_id;

  PERFORM pg_temp.seed_activation_case(
    v_upgrade_case_id,
    v_upgrade_merchant_id,
    'upgrade',
    'solo_lite',
    'approved',
    'paid',
    'none',
    7,
    'upgrade-payment-ref'
  );

  PERFORM pg_temp.seed_activation_case(
    v_onboarding_case_id,
    v_onboarding_merchant_id,
    'onboarding',
    NULL,
    'approved',
    'paid',
    'none',
    2,
    'onboarding-payment-ref'
  );
  UPDATE public.solo_plus_cases
  SET onboarding_session_id = '00000000-0000-4000-8000-000000010302'::uuid
  WHERE id = v_onboarding_case_id;

  ALTER TABLE public.solo_plus_cases
    DROP CONSTRAINT solo_plus_cases_approved_consistency_chk;

  PERFORM pg_temp.seed_activation_case(
    v_unpaid_case_id,
    v_upgrade_merchant_id,
    'upgrade',
    'solo_lite',
    'approved',
    'pending',
    'none',
    0,
    'unpaid-payment-ref'
  );

  PERFORM pg_temp.seed_activation_case(
    v_refund_case_id,
    v_upgrade_merchant_id,
    'upgrade',
    'solo_lite',
    'approved',
    'paid',
    'review_required',
    0,
    'refund-payment-ref'
  );

  ALTER TABLE public.solo_plus_cases
    ADD CONSTRAINT solo_plus_cases_approved_consistency_chk CHECK (
      case_status <> 'approved'
      OR (
        payment_status = 'paid'
        AND approved_at IS NOT NULL
        AND approved_by_admin_id IS NOT NULL
        AND refund_status = 'none'
      )
    ) NOT VALID;

  PERFORM pg_temp.seed_activation_case(
    v_pending_case_id,
    v_upgrade_merchant_id,
    'upgrade',
    'solo_lite',
    'manual_review',
    'paid',
    'none',
    0,
    'pending-payment-ref'
  );

  PERFORM pg_temp.seed_activation_case(
    v_missing_req_case_id,
    v_upgrade_merchant_id,
    'upgrade',
    'solo_lite',
    'approved',
    'paid',
    'none',
    0,
    'missing-req-payment-ref'
  );
  DELETE FROM public.solo_plus_case_requirements
  WHERE case_id = v_missing_req_case_id
    AND requirement_code = 'activity_profile';

  PERFORM pg_temp.seed_activation_case(
    v_failed_req_case_id,
    v_upgrade_merchant_id,
    'upgrade',
    'solo_lite',
    'approved',
    'paid',
    'none',
    0,
    'failed-req-payment-ref'
  );
  UPDATE public.solo_plus_case_requirements
  SET requirement_state = 'needs_review',
      completed_at = NULL
  WHERE case_id = v_failed_req_case_id
    AND requirement_code = 'proof_of_address';

  PERFORM pg_temp.seed_activation_case(
    v_upgrade_conflict_case_id,
    v_upgrade_merchant_id,
    'upgrade',
    'solo_lite',
    'approved',
    'paid',
    'none',
    1,
    'conflict-payment-ref'
  );
  INSERT INTO public.workspace_subscriptions (
    id,
    workspace_id,
    merchant_id,
    plan_type,
    subscription_status,
    payment_reference,
    amount_paid,
    period_start
  )
  VALUES (
    '00000000-0000-4000-8000-000000010504'::uuid,
    '00000000-0000-4000-8000-000000010401'::uuid,
    v_upgrade_merchant_id,
    'business',
    'active',
    'business-conflict',
    '20000.00'::numeric,
    now() - interval '30 days'
  );

  PERFORM pg_temp.seed_activation_case(
    v_feature_disabled_case_id,
    v_onboarding_merchant_id,
    'onboarding',
    NULL,
    'approved',
    'paid',
    'none',
    1,
    'feature-disabled-payment-ref'
  );
  UPDATE public.solo_plus_cases
  SET onboarding_session_id = '00000000-0000-4000-8000-000000010303'::uuid
  WHERE id = v_feature_disabled_case_id;

  PERFORM pg_temp.seed_activation_case(
    v_atomic_case_id,
    v_onboarding_merchant_id,
    'onboarding',
    NULL,
    'approved',
    'paid',
    'none',
    6,
    'atomic-payment-ref'
  );

  v_result := public.activate_solo_plus_case_v1(
    '00000000-0000-4000-8000-999999999999'::uuid,
    0,
    'unknown-case-activation',
    v_admin_id,
    'solo-plus-activation-policy-v1'
  );
  IF v_result->>'kind' <> 'not_found' THEN
    RAISE EXCEPTION 'unknown case should return not_found, got %', v_result;
  END IF;

  v_result := public.activate_solo_plus_case_v1(
    v_missing_merchant_case_id,
    4,
    'missing-merchant-activation',
    v_admin_id,
    'solo-plus-activation-policy-v1'
  );
  IF v_result->>'kind' <> 'prerequisite_conflict' OR v_result->>'reason' <> 'merchant_missing' THEN
    RAISE EXCEPTION 'onboarding case without merchant should fail closed, got %', v_result;
  END IF;

  v_result := public.activate_solo_plus_case_v1(
    v_pending_case_id,
    0,
    'pending-state-activation',
    v_admin_id,
    'solo-plus-activation-policy-v1'
  );
  IF v_result->>'kind' <> 'state_conflict' THEN
    RAISE EXCEPTION 'non-approved case should return state_conflict, got %', v_result;
  END IF;

  v_result := public.activate_solo_plus_case_v1(
    v_unpaid_case_id,
    0,
    'unpaid-activation',
    v_admin_id,
    'solo-plus-activation-policy-v1'
  );
  IF v_result->>'kind' <> 'prerequisite_conflict' OR v_result->>'reason' <> 'payment_not_paid' THEN
    RAISE EXCEPTION 'unpaid case should fail with payment_not_paid, got %', v_result;
  END IF;

  v_result := public.activate_solo_plus_case_v1(
    v_refund_case_id,
    0,
    'refund-blocked-activation',
    v_admin_id,
    'solo-plus-activation-policy-v1'
  );
  IF v_result->>'kind' <> 'prerequisite_conflict' OR v_result->>'reason' <> 'refund_status_not_none' THEN
    RAISE EXCEPTION 'refund-blocked case should fail closed, got %', v_result;
  END IF;

  v_result := public.activate_solo_plus_case_v1(
    v_missing_req_case_id,
    0,
    'missing-req-activation',
    v_admin_id,
    'solo-plus-activation-policy-v1'
  );
  IF v_result->>'kind' <> 'prerequisite_conflict' OR v_result->>'reason' <> 'requirements_missing_or_duplicate' THEN
    RAISE EXCEPTION 'missing requirement should fail closed, got %', v_result;
  END IF;

  v_result := public.activate_solo_plus_case_v1(
    v_failed_req_case_id,
    0,
    'failed-req-activation',
    v_admin_id,
    'solo-plus-activation-policy-v1'
  );
  IF v_result->>'kind' <> 'prerequisite_conflict' OR v_result->>'reason' <> 'requirements_not_satisfied' THEN
    RAISE EXCEPTION 'unsatisfied requirement should fail closed, got %', v_result;
  END IF;

  v_result := public.activate_solo_plus_case_v1(
    v_upgrade_conflict_case_id,
    1,
    'subscription-conflict-activation',
    v_admin_id,
    'solo-plus-activation-policy-v1'
  );
  IF v_result->>'kind' <> 'prerequisite_conflict' OR v_result->>'reason' <> 'conflicting_active_subscription' THEN
    RAISE EXCEPTION 'conflicting active subscription should fail closed, got %', v_result;
  END IF;

  DELETE FROM public.workspace_subscriptions
  WHERE id = '00000000-0000-4000-8000-000000010504'::uuid;

  UPDATE public.platform_settings
  SET value = 'false'
  WHERE key = 'solo_plus_kyc_enabled';

  v_result := public.activate_solo_plus_case_v1(
    v_feature_disabled_case_id,
    1,
    'feature-disabled-activation',
    v_admin_id,
    'solo-plus-activation-policy-v1'
  );
  IF v_result->>'kind' <> 'feature_disabled' THEN
    RAISE EXCEPTION 'feature-disabled activation should return feature_disabled, got %', v_result;
  END IF;

  UPDATE public.platform_settings
  SET value = split_part(flag_state.entry, '=', 2)
  FROM (
    SELECT unnest(v_flag_state_before) AS entry
  ) AS flag_state
  WHERE key = split_part(flag_state.entry, '=', 1)
    AND key = 'solo_plus_kyc_enabled';

  UPDATE public.platform_settings
  SET value = 'true'
  WHERE key = 'solo_plus_kyc_enabled';

  v_result := public.activate_solo_plus_case_v1(
    v_upgrade_case_id,
    999,
    'upgrade-stale-version',
    v_admin_id,
    'solo-plus-activation-policy-v1'
  );
  IF v_result->>'kind' <> 'version_conflict' THEN
    RAISE EXCEPTION 'stale activation should return version_conflict, got %', v_result;
  END IF;

  v_result := public.activate_solo_plus_case_v1(
    v_upgrade_case_id,
    7,
    'upgrade-activation-1',
    '00000000-0000-4000-8000-000000010099'::uuid,
    'solo-plus-activation-policy-v1'
  );
  IF v_result->>'kind' <> 'prerequisite_conflict' OR v_result->>'reason' <> 'activator_not_found' THEN
    RAISE EXCEPTION 'invalid actor should fail closed, got %', v_result;
  END IF;

  v_result := public.activate_solo_plus_case_v1(
    v_upgrade_case_id,
    7,
    'upgrade-activation-1',
    v_admin_id,
    'solo-plus-activation-policy-v1'
  );
  IF v_result->>'kind' <> 'applied' THEN
    RAISE EXCEPTION 'expected successful upgrade activation, got %', v_result;
  END IF;

  IF (v_result->'case'->>'case_status') <> 'approved' THEN
    RAISE EXCEPTION 'activation must keep case approved, got %', v_result->'case';
  END IF;

  IF (v_result->'case'->>'row_version')::integer <> 8 THEN
    RAISE EXCEPTION 'activation should increment row_version exactly once, got %', v_result->'case';
  END IF;

  IF (v_result->'case'->>'activation_idempotency_key') <> 'upgrade-activation-1' THEN
    RAISE EXCEPTION 'activation idempotency key was not persisted, got %', v_result->'case';
  END IF;

  IF (v_result->'merchant'->>'subscription_plan') <> 'solo_plus' OR (v_result->'merchant'->>'merchant_tier') <> 'individual' THEN
    RAISE EXCEPTION 'merchant plan was not upgraded canonically, got %', v_result->'merchant';
  END IF;

  IF (v_result->'merchant'->>'setup_mode')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'merchant setup_mode should clear only on success, got %', v_result->'merchant';
  END IF;

  IF (v_result->'merchant'->>'live_features_enabled')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'merchant live features should enable on success, got %', v_result->'merchant';
  END IF;

  IF (v_result->'workspace'->>'plan_type') <> 'solo_plus' THEN
    RAISE EXCEPTION 'workspace plan_type should reflect solo_plus, got %', v_result->'workspace';
  END IF;

  IF (v_result->'workspace_subscription'->>'plan_type') <> 'solo_plus'
     OR (v_result->'workspace_subscription'->>'subscription_status') <> 'active' THEN
    RAISE EXCEPTION 'workspace subscription reflection is not canonical, got %', v_result->'workspace_subscription';
  END IF;

  IF (v_result->'event'->>'event_type') <> 'case_activated' THEN
    RAISE EXCEPTION 'expected case_activated event, got %', v_result->'event';
  END IF;

  IF (v_result->'event'->>'policy_version') <> 'solo-plus-activation-policy-v1' THEN
    RAISE EXCEPTION 'activation event should persist policy version, got %', v_result->'event';
  END IF;

  v_event_payload := COALESCE(v_result->'event'->'new_state', '{}'::jsonb);
  IF position('evidence_reference' IN v_event_payload::text) > 0
     OR position('verification_log' IN v_event_payload::text) > 0
     OR position('provider-ref-proof_of_address' IN v_event_payload::text) > 0 THEN
    RAISE EXCEPTION 'activation event leaked verification evidence payloads: %', v_event_payload;
  END IF;

  SELECT count(*)
  INTO v_event_count
  FROM public.solo_plus_case_events
  WHERE case_id = v_upgrade_case_id
    AND event_type = 'case_activated';

  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'upgrade activation should create exactly one activation event, got %', v_event_count;
  END IF;

  v_result := public.activate_solo_plus_case_v1(
    v_upgrade_case_id,
    7,
    'upgrade-activation-1',
    v_admin_id,
    'solo-plus-activation-policy-v1'
  );
  IF v_result->>'kind' <> 'idempotent_replay' THEN
    RAISE EXCEPTION 'same-key replay should return idempotent_replay, got %', v_result;
  END IF;

  IF (v_result->'case'->>'row_version')::integer <> 8 THEN
    RAISE EXCEPTION 'same-key replay must not increment row_version, got %', v_result->'case';
  END IF;

  SELECT count(*)
  INTO v_event_count
  FROM public.solo_plus_case_events
  WHERE case_id = v_upgrade_case_id
    AND event_type = 'case_activated';

  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'same-key replay must not insert another activation event, got %', v_event_count;
  END IF;

  v_result := public.activate_solo_plus_case_v1(
    v_upgrade_case_id,
    8,
    'upgrade-activation-2',
    v_admin_id,
    'solo-plus-activation-policy-v1'
  );
  IF v_result->>'kind' <> 'idempotency_conflict' THEN
    RAISE EXCEPTION 'different-key replay should return idempotency_conflict, got %', v_result;
  END IF;

  v_result := public.activate_solo_plus_case_v1(
    v_onboarding_case_id,
    2,
    'onboarding-activation-1',
    v_admin_id,
    'solo-plus-activation-policy-v1'
  );
  IF v_result->>'kind' <> 'applied' THEN
    RAISE EXCEPTION 'expected successful onboarding activation, got %', v_result;
  END IF;

  IF (v_result->'merchant'->>'subscription_plan') <> 'solo_plus' THEN
    RAISE EXCEPTION 'onboarding activation should set merchant plan solo_plus, got %', v_result->'merchant';
  END IF;

  IF (SELECT subscription_status FROM public.workspace_subscriptions WHERE id = '00000000-0000-4000-8000-000000010503'::uuid) <> 'active' THEN
    RAISE EXCEPTION 'onboarding paid_setup subscription should become active';
  END IF;

  CREATE OR REPLACE FUNCTION pg_temp.raise_activation_test_failure()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $trigger$
  BEGIN
    IF NEW.request_idempotency_key = 'activation-late-failure' THEN
      RAISE EXCEPTION 'forced activation late failure';
    END IF;
    RETURN NEW;
  END;
  $trigger$;

  CREATE TRIGGER trg_activation_test_late_failure
  BEFORE INSERT ON public.solo_plus_case_events
  FOR EACH ROW
  EXECUTE FUNCTION pg_temp.raise_activation_test_failure();

  v_result := NULL;
  BEGIN
    PERFORM public.activate_solo_plus_case_v1(
      v_atomic_case_id,
      6,
      'activation-late-failure',
      v_admin_id,
      'solo-plus-activation-policy-v1'
    );
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  DROP TRIGGER trg_activation_test_late_failure ON public.solo_plus_case_events;

  SELECT row_version
  INTO v_row_version
  FROM public.solo_plus_cases
  WHERE id = v_atomic_case_id;

  IF v_row_version <> 6 THEN
    RAISE EXCEPTION 'late failure should roll back case row_version, got %', v_row_version;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.solo_plus_cases
    WHERE id = v_atomic_case_id
      AND activation_idempotency_key IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'late failure should roll back activation idempotency key';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.solo_plus_case_events
    WHERE case_id = v_atomic_case_id
      AND event_type = 'case_activated'
  ) THEN
    RAISE EXCEPTION 'late failure should roll back activation event insertion';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.workspace_subscriptions
    WHERE merchant_id = v_onboarding_merchant_id
      AND payment_reference = 'atomic-payment-ref'
      AND subscription_status = 'active'
  ) THEN
    RAISE EXCEPTION 'late failure should roll back workspace subscription activation';
  END IF;

  ALTER TABLE public.solo_plus_case_requirements
    DROP CONSTRAINT solo_plus_case_requirements_unique_case_code;

  PERFORM pg_temp.seed_activation_case(
    v_duplicate_req_case_id,
    v_upgrade_merchant_id,
    'upgrade',
    'solo_lite',
    'approved',
    'paid',
    'none',
    0,
    'duplicate-req-payment-ref'
  );

  INSERT INTO public.solo_plus_case_requirements (
    id,
    case_id,
    requirement_code,
    requirement_state,
    completed_at,
    metadata
  )
  VALUES (
    gen_random_uuid(),
    v_duplicate_req_case_id,
    'bvn',
    'passed',
    now(),
    '{}'::jsonb
  );

  v_result := public.activate_solo_plus_case_v1(
    v_duplicate_req_case_id,
    0,
    'duplicate-requirement-activation',
    v_admin_id,
    'solo-plus-activation-policy-v1'
  );
  IF v_result->>'kind' <> 'prerequisite_conflict' OR v_result->>'reason' <> 'requirements_missing_or_duplicate' THEN
    RAISE EXCEPTION 'duplicate requirement should fail closed, got %', v_result;
  END IF;

  UPDATE public.platform_settings
  SET value = split_part(flag_state.entry, '=', 2)
  FROM (
    SELECT unnest(v_flag_state_before) AS entry
  ) AS flag_state
  WHERE key = split_part(flag_state.entry, '=', 1);

  SELECT COALESCE(array_agg(key || '=' || value ORDER BY key), ARRAY[]::text[])
  INTO v_flag_state_after
  FROM public.platform_settings
  WHERE key IN ('plan_migration_solo_lite_enabled', 'solo_plus_enabled', 'solo_plus_kyc_enabled');

  IF v_flag_state_after <> v_flag_state_before THEN
    RAISE EXCEPTION 'activation unexpectedly changed protected Solo Plus feature flags';
  END IF;

  RAISE NOTICE 'phase2_solo_plus_activation_rpc: PASS';
END
$$;

ROLLBACK;
