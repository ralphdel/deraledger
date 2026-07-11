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

CREATE OR REPLACE FUNCTION pg_temp.normalize_catalog_sql(p_sql TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  WITH normalized AS (
    SELECT lower(
      regexp_replace(
        regexp_replace(
          regexp_replace(btrim(COALESCE(p_sql, '')), '\s+', ' ', 'g'),
          '\(\s+',
          '(',
          'g'
        ),
        '\s+\)',
        ')',
        'g'
      )
    ) AS value
  )
  SELECT CASE
    WHEN value ~ '^\(.*\)$'
      THEN regexp_replace(value, '^\((.*)\)$', '\1')
    ELSE value
  END
  FROM normalized;
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

CREATE OR REPLACE FUNCTION pg_temp.assert_only_expected_policies(
  p_table_name TEXT,
  p_expected_policy_names TEXT[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_actual TEXT[];
BEGIN
  SELECT COALESCE(array_agg(policyname ORDER BY policyname), ARRAY[]::TEXT[])
  INTO v_actual
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = p_table_name;

  IF v_actual <> p_expected_policy_names THEN
    RAISE EXCEPTION '% has unexpected policies: expected %, actual %', p_table_name, p_expected_policy_names, v_actual;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_policy_fragments(
  p_table_name TEXT,
  p_policy_name TEXT,
  p_command TEXT,
  p_expected_roles TEXT[],
  p_using_fragments TEXT[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_policy RECORD;
  v_fragment TEXT;
  v_normalized_qual TEXT;
BEGIN
  SELECT cmd, roles::TEXT[] AS roles, qual
  INTO v_policy
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = p_table_name
    AND policyname = p_policy_name;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'expected %.% policy to exist', p_table_name, p_policy_name;
  END IF;

  IF lower(v_policy.cmd) <> lower(p_command) THEN
    RAISE EXCEPTION 'policy %.% command mismatch: expected %, actual %',
      p_table_name,
      p_policy_name,
      lower(p_command),
      lower(v_policy.cmd);
  END IF;

  IF COALESCE(v_policy.roles, ARRAY[]::TEXT[]) <> p_expected_roles THEN
    RAISE EXCEPTION 'policy %.% roles mismatch: expected %, actual %',
      p_table_name,
      p_policy_name,
      p_expected_roles,
      v_policy.roles;
  END IF;

  v_normalized_qual := pg_temp.normalize_catalog_sql(v_policy.qual);
  FOREACH v_fragment IN ARRAY p_using_fragments
  LOOP
    IF position(pg_temp.normalize_catalog_sql(v_fragment) IN v_normalized_qual) = 0 THEN
      RAISE EXCEPTION 'policy %.% missing normalized fragment % in %',
        p_table_name,
        p_policy_name,
        pg_temp.normalize_catalog_sql(v_fragment),
        v_normalized_qual;
    END IF;
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_admin_id UUID := '00000000-0000-4000-8000-000000009001'::uuid;
  v_merchant_user_id UUID := '00000000-0000-4000-8000-000000009002'::uuid;
  v_merchant_id UUID;
  v_paid_reject_session_id UUID;
  v_unpaid_reject_session_id UUID;
  v_more_info_session_id UUID;
  v_reopen_session_id UUID;
  v_invalid_state_session_id UUID;
  v_version_session_id UUID;
  v_atomic_session_id UUID;
  v_manual_review_case_id UUID;
  v_paid_reject_case_id UUID;
  v_unpaid_reject_case_id UUID;
  v_more_info_case_id UUID;
  v_reopen_case_id UUID;
  v_invalid_state_case_id UUID;
  v_version_case_id UUID;
  v_atomic_case_id UUID;
  v_result JSONB;
  v_live_features_before BOOLEAN;
  v_setup_mode_before BOOLEAN;
  v_subscriptions_before BIGINT := 0;
  v_subscriptions_after BIGINT := 0;
  v_subscriptions_before_state TEXT[] := ARRAY[]::TEXT[];
  v_subscriptions_after_state TEXT[] := ARRAY[]::TEXT[];
  v_workspace_subscriptions_before BIGINT := 0;
  v_workspace_subscriptions_after BIGINT := 0;
  v_workspace_subscriptions_before_state TEXT[] := ARRAY[]::TEXT[];
  v_workspace_subscriptions_after_state TEXT[] := ARRAY[]::TEXT[];
  v_flag_state_before TEXT[] := ARRAY[]::TEXT[];
  v_flag_state_after TEXT[] := ARRAY[]::TEXT[];
  v_event_count BIGINT := 0;
  v_review_function_def TEXT := '';
  v_review_update_targets TEXT[] := ARRAY[]::TEXT[];
  v_review_insert_targets TEXT[] := ARRAY[]::TEXT[];
  v_review_delete_targets TEXT[] := ARRAY[]::TEXT[];
  v_created_refund_requests_sentinel BOOLEAN := false;
  v_refund_requests_mode TEXT := 'canonical';
  v_refund_requests_before BIGINT := 0;
  v_refund_requests_after BIGINT := 0;
  v_more_info_requirement_count_before BIGINT := 0;
  v_more_info_requirement_count_after BIGINT := 0;
  v_reopen_requirement_count_before BIGINT := 0;
  v_reopen_requirement_count_after BIGINT := 0;
  v_more_info_requirements_before JSONB := '[]'::jsonb;
  v_more_info_requirements_after JSONB := '[]'::jsonb;
  v_reopen_requirements_before JSONB := '[]'::jsonb;
  v_reopen_requirements_after JSONB := '[]'::jsonb;
  v_more_info_payment_before JSONB := '{}'::jsonb;
  v_more_info_payment_after JSONB := '{}'::jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'review_solo_plus_case_v1'
      AND oidvectortypes(p.proargtypes) = 'uuid, bigint, text, text, uuid, text, text'
  ) THEN
    RAISE EXCEPTION 'expected public.review_solo_plus_case_v1(uuid, bigint, text, text, uuid, text, text)';
  END IF;

  PERFORM pg_temp.assert_service_role_only_function_execute(
    'review_solo_plus_case_v1',
    'uuid, bigint, text, text, uuid, text, text'
  );

  PERFORM pg_temp.assert_table_rls_state('solo_plus_cases', true, false);
  PERFORM pg_temp.assert_table_rls_state('solo_plus_case_requirements', true, false);
  PERFORM pg_temp.assert_table_rls_state('solo_plus_case_events', true, false);

  PERFORM pg_temp.assert_table_access_manifest('solo_plus_cases', 'merchant_read_select');
  PERFORM pg_temp.assert_table_access_manifest('solo_plus_case_requirements', 'merchant_read_select');
  PERFORM pg_temp.assert_table_access_manifest('solo_plus_case_events', 'internal');

  PERFORM pg_temp.assert_only_expected_policies(
    'solo_plus_cases',
    ARRAY['merchant_read_solo_plus_cases']
  );
  PERFORM pg_temp.assert_only_expected_policies(
    'solo_plus_case_requirements',
    ARRAY['merchant_read_solo_plus_case_requirements']
  );
  PERFORM pg_temp.assert_only_expected_policies(
    'solo_plus_case_events',
    ARRAY[]::TEXT[]
  );

  PERFORM pg_temp.assert_policy_fragments(
    'solo_plus_cases',
    'merchant_read_solo_plus_cases',
    'SELECT',
    ARRAY['public'],
    ARRAY[
      'auth.role() = ''authenticated''',
      'merchant_id IS NOT NULL',
      'FROM merchants m',
      'm.id = solo_plus_cases.merchant_id',
      'm.user_id = auth.uid()'
    ]
  );
  PERFORM pg_temp.assert_policy_fragments(
    'solo_plus_case_requirements',
    'merchant_read_solo_plus_case_requirements',
    'SELECT',
    ARRAY['public'],
    ARRAY[
      'auth.role() = ''authenticated''',
      'from (solo_plus_cases c join merchants m on ((m.id = c.merchant_id)))',
      'c.id = solo_plus_case_requirements.case_id',
      'm.user_id = auth.uid()'
    ]
  );

  SELECT pg_get_functiondef(p.oid)
  INTO v_review_function_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'review_solo_plus_case_v1'
    AND oidvectortypes(p.proargtypes) = 'uuid, bigint, text, text, uuid, text, text';

  IF v_review_function_def IS NULL OR btrim(v_review_function_def) = '' THEN
    RAISE EXCEPTION 'expected non-empty pg_get_functiondef for public.review_solo_plus_case_v1';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT match[1] ORDER BY match[1]), ARRAY[]::TEXT[])
  INTO v_review_update_targets
  FROM regexp_matches(
    v_review_function_def,
    'UPDATE\s+public\.([a-zA-Z0-9_]+)',
    'g'
  ) AS match;

  SELECT COALESCE(array_agg(DISTINCT match[1] ORDER BY match[1]), ARRAY[]::TEXT[])
  INTO v_review_insert_targets
  FROM regexp_matches(
    v_review_function_def,
    'INSERT\s+INTO\s+public\.([a-zA-Z0-9_]+)',
    'g'
  ) AS match;

  SELECT COALESCE(array_agg(DISTINCT match[1] ORDER BY match[1]), ARRAY[]::TEXT[])
  INTO v_review_delete_targets
  FROM regexp_matches(
    v_review_function_def,
    'DELETE\s+FROM\s+public\.([a-zA-Z0-9_]+)',
    'g'
  ) AS match;

  IF v_review_update_targets <> ARRAY['solo_plus_cases'] THEN
    RAISE EXCEPTION 'review RPC update write set drifted: %', v_review_update_targets;
  END IF;

  IF v_review_insert_targets <> ARRAY['solo_plus_case_events'] THEN
    RAISE EXCEPTION 'review RPC insert write set drifted: %', v_review_insert_targets;
  END IF;

  IF v_review_delete_targets <> ARRAY[]::TEXT[] THEN
    RAISE EXCEPTION 'review RPC unexpectedly performs DELETEs: %', v_review_delete_targets;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN unnest(COALESCE(p.proconfig, ARRAY[]::TEXT[])) AS config(setting) ON TRUE
    WHERE n.nspname = 'public'
      AND p.proname = 'review_solo_plus_case_v1'
      AND oidvectortypes(p.proargtypes) = 'uuid, bigint, text, text, uuid, text, text'
      AND config.setting = 'search_path=public, pg_temp'
  ) THEN
    RAISE EXCEPTION 'expected hardened search_path in review_solo_plus_case_v1 definition';
  END IF;

  INSERT INTO auth.users (id)
  VALUES (v_admin_id), (v_merchant_user_id)
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
    v_merchant_user_id,
    'Solo Plus Review Merchant',
    'solo-plus-review@example.test',
    'solo_lite',
    'individual',
    'unverified'
  )
  RETURNING id INTO v_merchant_id;

  SELECT live_features_enabled, setup_mode
  INTO v_live_features_before, v_setup_mode_before
  FROM public.merchants
  WHERE id = v_merchant_id;

  INSERT INTO public.onboarding_sessions (
    id,
    email,
    business_name,
    plan,
    status,
    idempotency_key,
    expires_at
  )
  VALUES
    (
      gen_random_uuid(),
      'solo-plus-review-reject-paid@example.test',
      'Solo Plus Review Reject Paid',
      'solo_plus',
      'under_review',
      'solo-plus-review-reject-paid-session',
      now() + interval '7 days'
    ),
    (
      gen_random_uuid(),
      'solo-plus-review-reject-unpaid@example.test',
      'Solo Plus Review Reject Unpaid',
      'solo_plus',
      'under_review',
      'solo-plus-review-reject-unpaid-session',
      now() + interval '7 days'
    ),
    (
      gen_random_uuid(),
      'solo-plus-review-more-info@example.test',
      'Solo Plus Review More Info',
      'solo_plus',
      'under_review',
      'solo-plus-review-more-info-session',
      now() + interval '7 days'
    ),
    (
      gen_random_uuid(),
      'solo-plus-review-reopen@example.test',
      'Solo Plus Review Reopen',
      'solo_plus',
      'under_review',
      'solo-plus-review-reopen-session',
      now() + interval '7 days'
    ),
    (
      gen_random_uuid(),
      'solo-plus-review-invalid-state@example.test',
      'Solo Plus Review Invalid State',
      'solo_plus',
      'under_review',
      'solo-plus-review-invalid-state-session',
      now() + interval '7 days'
    ),
    (
      gen_random_uuid(),
      'solo-plus-review-version@example.test',
      'Solo Plus Review Version',
      'solo_plus',
      'under_review',
      'solo-plus-review-version-session',
      now() + interval '7 days'
    ),
    (
      gen_random_uuid(),
      'solo-plus-review-atomic@example.test',
      'Solo Plus Review Atomic',
      'solo_plus',
      'under_review',
      'solo-plus-review-atomic-session',
      now() + interval '7 days'
    );

  SELECT id INTO v_paid_reject_session_id FROM public.onboarding_sessions WHERE idempotency_key = 'solo-plus-review-reject-paid-session';
  SELECT id INTO v_unpaid_reject_session_id FROM public.onboarding_sessions WHERE idempotency_key = 'solo-plus-review-reject-unpaid-session';
  SELECT id INTO v_more_info_session_id FROM public.onboarding_sessions WHERE idempotency_key = 'solo-plus-review-more-info-session';
  SELECT id INTO v_reopen_session_id FROM public.onboarding_sessions WHERE idempotency_key = 'solo-plus-review-reopen-session';
  SELECT id INTO v_invalid_state_session_id FROM public.onboarding_sessions WHERE idempotency_key = 'solo-plus-review-invalid-state-session';
  SELECT id INTO v_version_session_id FROM public.onboarding_sessions WHERE idempotency_key = 'solo-plus-review-version-session';
  SELECT id INTO v_atomic_session_id FROM public.onboarding_sessions WHERE idempotency_key = 'solo-plus-review-atomic-session';

  IF to_regclass('public.platform_settings') IS NOT NULL THEN
    SELECT COALESCE(array_agg(key || '=' || value ORDER BY key), ARRAY[]::TEXT[])
    INTO v_flag_state_before
    FROM public.platform_settings
    WHERE key IN (
      'plan_migration_solo_lite_enabled',
      'solo_plus_enabled',
      'solo_plus_kyc_enabled'
    );
  END IF;

  IF to_regclass('public.subscriptions') IS NOT NULL THEN
    SELECT count(*)
    INTO v_subscriptions_before
    FROM public.subscriptions
    WHERE merchant_id = v_merchant_id;

    SELECT COALESCE(array_agg(md5(to_jsonb(s)::text) ORDER BY md5(to_jsonb(s)::text)), ARRAY[]::TEXT[])
    INTO v_subscriptions_before_state
    FROM public.subscriptions s
    WHERE merchant_id = v_merchant_id;
  END IF;

  IF to_regclass('public.workspace_subscriptions') IS NOT NULL THEN
    SELECT count(*)
    INTO v_workspace_subscriptions_before
    FROM public.workspace_subscriptions
    WHERE merchant_id = v_merchant_id;

    SELECT COALESCE(array_agg(md5(to_jsonb(ws)::text) ORDER BY md5(to_jsonb(ws)::text)), ARRAY[]::TEXT[])
    INTO v_workspace_subscriptions_before_state
    FROM public.workspace_subscriptions ws
    WHERE merchant_id = v_merchant_id;
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
    idempotency_key,
    audit_metadata
  )
  VALUES
    (
      v_merchant_id,
      NULL,
      'upgrade',
      'solo_lite',
      'solo_plus',
      'manual_review',
      'paid',
      'none',
      13000.00,
      'NGN',
      'solo-plus-review-policy-v1',
      '{"test":"approve"}'::jsonb,
      'solo_lite',
      'solo-plus-approve-case',
      '{}'::jsonb
    ),
    (
      NULL,
      v_paid_reject_session_id,
      'onboarding',
      NULL,
      'solo_plus',
      'manual_review',
      'paid',
      'none',
      13000.00,
      'NGN',
      'solo-plus-review-policy-v1',
      '{"test":"reject-paid"}'::jsonb,
      NULL,
      'solo-plus-reject-paid-case',
      '{}'::jsonb
    ),
    (
      NULL,
      v_unpaid_reject_session_id,
      'onboarding',
      NULL,
      'solo_plus',
      'manual_review',
      'pending',
      'none',
      13000.00,
      'NGN',
      'solo-plus-review-policy-v1',
      '{"test":"reject-unpaid"}'::jsonb,
      NULL,
      'solo-plus-reject-unpaid-case',
      '{}'::jsonb
    ),
    (
      NULL,
      v_more_info_session_id,
      'onboarding',
      NULL,
      'solo_plus',
      'manual_review',
      'paid',
      'none',
      13000.00,
      'NGN',
      'solo-plus-review-policy-v1',
      '{"test":"more-info"}'::jsonb,
      NULL,
      'solo-plus-more-info-case',
      '{}'::jsonb
    ),
    (
      NULL,
      v_reopen_session_id,
      'onboarding',
      NULL,
      'solo_plus',
      'manual_review',
      'paid',
      'none',
      13000.00,
      'NGN',
      'solo-plus-review-policy-v1',
      '{"test":"reopen"}'::jsonb,
      NULL,
      'solo-plus-reopen-case',
      '{}'::jsonb
    ),
    (
      NULL,
      v_invalid_state_session_id,
      'onboarding',
      NULL,
      'solo_plus',
      'verification_pending',
      'paid',
      'none',
      13000.00,
      'NGN',
      'solo-plus-review-policy-v1',
      '{"test":"invalid-state"}'::jsonb,
      NULL,
      'solo-plus-invalid-state-case',
      '{}'::jsonb
    ),
    (
      NULL,
      v_version_session_id,
      'onboarding',
      NULL,
      'solo_plus',
      'manual_review',
      'paid',
      'none',
      13000.00,
      'NGN',
      'solo-plus-review-policy-v1',
      '{"test":"version"}'::jsonb,
      NULL,
      'solo-plus-version-case',
      '{}'::jsonb
    ),
    (
      NULL,
      v_atomic_session_id,
      'onboarding',
      NULL,
      'solo_plus',
      'manual_review',
      'paid',
      'none',
      13000.00,
      'NGN',
      'solo-plus-review-policy-v1',
      '{"test":"atomic"}'::jsonb,
      NULL,
      'solo-plus-atomic-case',
      '{}'::jsonb
    );

  SELECT id INTO v_manual_review_case_id FROM public.solo_plus_cases WHERE idempotency_key = 'solo-plus-approve-case';
  SELECT id INTO v_paid_reject_case_id FROM public.solo_plus_cases WHERE idempotency_key = 'solo-plus-reject-paid-case';
  SELECT id INTO v_unpaid_reject_case_id FROM public.solo_plus_cases WHERE idempotency_key = 'solo-plus-reject-unpaid-case';
  SELECT id INTO v_more_info_case_id FROM public.solo_plus_cases WHERE idempotency_key = 'solo-plus-more-info-case';
  SELECT id INTO v_reopen_case_id FROM public.solo_plus_cases WHERE idempotency_key = 'solo-plus-reopen-case';
  SELECT id INTO v_invalid_state_case_id FROM public.solo_plus_cases WHERE idempotency_key = 'solo-plus-invalid-state-case';
  SELECT id INTO v_version_case_id FROM public.solo_plus_cases WHERE idempotency_key = 'solo-plus-version-case';
  SELECT id INTO v_atomic_case_id FROM public.solo_plus_cases WHERE idempotency_key = 'solo-plus-atomic-case';

  INSERT INTO public.solo_plus_case_requirements (
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
    provider_name,
    provider_reference,
    completed_at,
    metadata,
    created_at,
    updated_at
  )
  VALUES
    (
      v_more_info_case_id,
      'proof_of_address',
      'reused',
      'manual_submission',
      '55555555-5555-4555-8555-555555555555'::uuid,
      'storage://proof-address/reuse-1',
      '2026-07-01T00:00:00.000Z'::timestamptz,
      '2026-07-02T00:00:00.000Z'::timestamptz,
      'reused_from_prior_verification',
      'solo-plus-reuse-policy-v1',
      'safe-storage',
      'proof-address-provider-ref-1',
      '2026-07-01T00:00:00.000Z'::timestamptz,
      '{"storageKey":"proof-address/reuse-1","checksumSha256":"proof-checksum-1"}'::jsonb,
      '2026-07-02T00:00:00.000Z'::timestamptz,
      '2026-07-02T00:00:00.000Z'::timestamptz
    ),
    (
      v_more_info_case_id,
      'activity_profile',
      'passed',
      'manual_submission',
      '66666666-6666-4666-8666-666666666666'::uuid,
      'activity-profile-1',
      NULL,
      NULL,
      NULL,
      'solo-plus-activity-policy-v1',
      'self_declared',
      'activity-profile-ref-1',
      '2026-07-03T00:00:00.000Z'::timestamptz,
      '{"businessType":"retail","expectedMonthlyTransactionValue":"500000"}'::jsonb,
      '2026-07-03T00:00:00.000Z'::timestamptz,
      '2026-07-03T00:00:00.000Z'::timestamptz
    ),
    (
      v_reopen_case_id,
      'settlement_account',
      'reused',
      'settlement_account',
      '77777777-7777-4777-8777-777777777777'::uuid,
      'settlement-account-ref-1',
      '2026-07-04T00:00:00.000Z'::timestamptz,
      '2026-07-05T00:00:00.000Z'::timestamptz,
      'reused_verified_settlement_account',
      'solo-plus-reuse-policy-v1',
      'paystack',
      'settlement-provider-ref-1',
      '2026-07-04T00:00:00.000Z'::timestamptz,
      '{"maskedAccountNumber":"****1234"}'::jsonb,
      '2026-07-05T00:00:00.000Z'::timestamptz,
      '2026-07-05T00:00:00.000Z'::timestamptz
    )
  ON CONFLICT (case_id, requirement_code) DO NOTHING;

  IF to_regclass('public.refund_requests') IS NULL THEN
    EXECUTE '
      CREATE TABLE public.refund_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )';

    CREATE OR REPLACE FUNCTION pg_temp.raise_unexpected_refund_requests_write()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $trigger$
    BEGIN
      RAISE EXCEPTION 'review RPC unexpectedly wrote to public.refund_requests';
    END;
    $trigger$;

    CREATE TRIGGER trg_fail_refund_requests_write
    BEFORE INSERT OR UPDATE OR DELETE ON public.refund_requests
    FOR EACH ROW
    EXECUTE FUNCTION pg_temp.raise_unexpected_refund_requests_write();

    v_created_refund_requests_sentinel := true;
    v_refund_requests_mode := 'sentinel';
    RAISE NOTICE 'refund_requests assertion mode: transaction-scoped sentinel table';
  ELSE
    v_refund_requests_mode := 'canonical';
    RAISE NOTICE 'refund_requests assertion mode: canonical committed table';
  END IF;

  SELECT count(*)
  INTO v_refund_requests_before
  FROM public.refund_requests;

  SELECT count(*)
  INTO v_more_info_requirement_count_before
  FROM public.solo_plus_case_requirements
  WHERE case_id = v_more_info_case_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'requirement_code', requirement_code,
        'requirement_state', requirement_state,
        'verification_log_id', verification_log_id,
        'evidence_source_type', evidence_source_type,
        'evidence_source_id', evidence_source_id,
        'evidence_reference', evidence_reference,
        'original_completed_at', original_completed_at,
        'reuse_decision_at', reuse_decision_at,
        'reuse_reason', reuse_reason,
        'policy_rule_applied', policy_rule_applied,
        'reviewed_by_admin_id', reviewed_by_admin_id,
        'review_note', review_note,
        'provider_name', provider_name,
        'provider_reference', provider_reference,
        'failure_reason', failure_reason,
        'completed_at', completed_at,
        'metadata', metadata,
        'created_at', created_at,
        'updated_at', updated_at
      )
      ORDER BY requirement_code
    ),
    '[]'::jsonb
  )
  INTO v_more_info_requirements_before
  FROM public.solo_plus_case_requirements
  WHERE case_id = v_more_info_case_id;

  SELECT jsonb_build_object(
    'payment_status', payment_status,
    'refund_status', refund_status,
    'payment_provider', payment_provider,
    'payment_reference', payment_reference,
    'payment_record_id', payment_record_id
  )
  INTO v_more_info_payment_before
  FROM public.solo_plus_cases
  WHERE id = v_more_info_case_id;

  SELECT count(*)
  INTO v_reopen_requirement_count_before
  FROM public.solo_plus_case_requirements
  WHERE case_id = v_reopen_case_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'requirement_code', requirement_code,
        'requirement_state', requirement_state,
        'verification_log_id', verification_log_id,
        'evidence_source_type', evidence_source_type,
        'evidence_source_id', evidence_source_id,
        'evidence_reference', evidence_reference,
        'original_completed_at', original_completed_at,
        'reuse_decision_at', reuse_decision_at,
        'reuse_reason', reuse_reason,
        'policy_rule_applied', policy_rule_applied,
        'reviewed_by_admin_id', reviewed_by_admin_id,
        'review_note', review_note,
        'provider_name', provider_name,
        'provider_reference', provider_reference,
        'failure_reason', failure_reason,
        'completed_at', completed_at,
        'metadata', metadata,
        'created_at', created_at,
        'updated_at', updated_at
      )
      ORDER BY requirement_code
    ),
    '[]'::jsonb
  )
  INTO v_reopen_requirements_before
  FROM public.solo_plus_case_requirements
  WHERE case_id = v_reopen_case_id;

  UPDATE public.solo_plus_cases
  SET
    case_status = 'rejected',
    refund_status = 'review_required',
    row_version = 1,
    rejected_at = now() - interval '1 day',
    rejected_by_admin_id = v_admin_id,
    rejection_reason = 'initial reject'
  WHERE id = v_reopen_case_id;

  v_result := public.review_solo_plus_case_v1(
    v_manual_review_case_id,
    0,
    'solo-plus-approve-1',
    'approve',
    v_admin_id,
    'Approved after manual review.',
    NULL
  );

  IF v_result->>'kind' <> 'updated' THEN
    RAISE EXCEPTION 'expected approve updated, got %', v_result;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.solo_plus_cases
    WHERE id = v_manual_review_case_id
      AND case_status = 'approved'
      AND approved_by_admin_id = v_admin_id
      AND refund_status = 'none'
  ) THEN
    RAISE EXCEPTION 'approve did not persist approved case state';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.solo_plus_case_events
    WHERE case_id = v_manual_review_case_id
      AND event_type = 'case_approved'
      AND request_idempotency_key = 'solo-plus-approve-1'
  ) THEN
    RAISE EXCEPTION 'approve did not persist case_approved event';
  END IF;

  v_result := public.review_solo_plus_case_v1(
    v_manual_review_case_id,
    0,
    'solo-plus-approve-1',
    'approve',
    v_admin_id,
    'Approved after manual review.',
    NULL
  );

  IF v_result->>'kind' <> 'idempotent_replay' THEN
    RAISE EXCEPTION 'expected approve idempotent_replay, got %', v_result;
  END IF;

  v_result := public.review_solo_plus_case_v1(
    v_manual_review_case_id,
    1,
    'solo-plus-approve-1',
    'reject',
    v_admin_id,
    'conflict',
    NULL
  );

  IF v_result->>'kind' <> 'idempotency_conflict' THEN
    RAISE EXCEPTION 'expected approve conflicting replay, got %', v_result;
  END IF;

  v_result := public.review_solo_plus_case_v1(
    v_paid_reject_case_id,
    0,
    'solo-plus-reject-paid-1',
    'reject',
    v_admin_id,
    'Paid rejection.',
    NULL
  );

  IF v_result->>'kind' <> 'updated' THEN
    RAISE EXCEPTION 'expected paid reject updated, got %', v_result;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.solo_plus_cases
    WHERE id = v_paid_reject_case_id
      AND case_status = 'rejected'
      AND refund_status = 'review_required'
      AND rejected_by_admin_id = v_admin_id
      AND rejection_reason = 'Paid rejection.'
  ) THEN
    RAISE EXCEPTION 'paid rejection did not set review_required refund state';
  END IF;

  SELECT count(*)
  INTO v_refund_requests_after
  FROM public.refund_requests;

  IF v_refund_requests_after <> v_refund_requests_before THEN
    RAISE EXCEPTION 'paid rejection unexpectedly changed refund_requests row count using % mode',
      v_refund_requests_mode;
  END IF;

  IF v_created_refund_requests_sentinel THEN
    DROP TRIGGER IF EXISTS trg_fail_refund_requests_write ON public.refund_requests;
    DROP TABLE IF EXISTS public.refund_requests;
  END IF;

  v_result := public.review_solo_plus_case_v1(
    v_unpaid_reject_case_id,
    0,
    'solo-plus-reject-unpaid-1',
    'reject',
    v_admin_id,
    'Unpaid rejection.',
    NULL
  );

  IF v_result->>'kind' <> 'updated' THEN
    RAISE EXCEPTION 'expected unpaid reject updated, got %', v_result;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.solo_plus_cases
    WHERE id = v_unpaid_reject_case_id
      AND case_status = 'rejected'
      AND refund_status = 'none'
  ) THEN
    RAISE EXCEPTION 'unpaid rejection did not preserve refund_status = none';
  END IF;

  v_result := public.review_solo_plus_case_v1(
    v_more_info_case_id,
    0,
    'solo-plus-more-info-1',
    'request_more_information',
    v_admin_id,
    'Need clearer proof of address.',
    NULL
  );

  IF v_result->>'kind' <> 'updated' THEN
    RAISE EXCEPTION 'expected request_more_information updated, got %', v_result;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.solo_plus_cases
    WHERE id = v_more_info_case_id
      AND case_status = 'verification_pending'
      AND payment_status = 'paid'
  ) THEN
    RAISE EXCEPTION 'request_more_information did not move case to verification_pending';
  END IF;

  SELECT count(*)
  INTO v_more_info_requirement_count_after
  FROM public.solo_plus_case_requirements
  WHERE case_id = v_more_info_case_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'requirement_code', requirement_code,
        'requirement_state', requirement_state,
        'verification_log_id', verification_log_id,
        'evidence_source_type', evidence_source_type,
        'evidence_source_id', evidence_source_id,
        'evidence_reference', evidence_reference,
        'original_completed_at', original_completed_at,
        'reuse_decision_at', reuse_decision_at,
        'reuse_reason', reuse_reason,
        'policy_rule_applied', policy_rule_applied,
        'reviewed_by_admin_id', reviewed_by_admin_id,
        'review_note', review_note,
        'provider_name', provider_name,
        'provider_reference', provider_reference,
        'failure_reason', failure_reason,
        'completed_at', completed_at,
        'metadata', metadata,
        'created_at', created_at,
        'updated_at', updated_at
      )
      ORDER BY requirement_code
    ),
    '[]'::jsonb
  )
  INTO v_more_info_requirements_after
  FROM public.solo_plus_case_requirements
  WHERE case_id = v_more_info_case_id;

  SELECT jsonb_build_object(
    'payment_status', payment_status,
    'refund_status', refund_status,
    'payment_provider', payment_provider,
    'payment_reference', payment_reference,
    'payment_record_id', payment_record_id
  )
  INTO v_more_info_payment_after
  FROM public.solo_plus_cases
  WHERE id = v_more_info_case_id;

  IF v_more_info_requirement_count_after <> v_more_info_requirement_count_before THEN
    RAISE EXCEPTION 'request_more_information changed the requirement row count';
  END IF;

  IF v_more_info_requirements_after <> v_more_info_requirements_before THEN
    RAISE EXCEPTION 'request_more_information changed requirement provenance';
  END IF;

  IF v_more_info_payment_after <> v_more_info_payment_before THEN
    RAISE EXCEPTION 'request_more_information unexpectedly changed payment fields';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.solo_plus_case_events
    WHERE case_id = v_more_info_case_id
      AND event_type = 'case_review_requested_more_information'
      AND request_idempotency_key = 'solo-plus-more-info-1'
      AND actor_type = 'admin'
      AND actor_id = v_admin_id
  ) THEN
    RAISE EXCEPTION 'request_more_information did not persist the expected review event';
  END IF;

  v_result := public.review_solo_plus_case_v1(
    v_reopen_case_id,
    1,
    'solo-plus-reopen-1',
    'reopen',
    v_admin_id,
    'Reopened for another review pass.',
    NULL
  );

  IF v_result->>'kind' <> 'updated' THEN
    RAISE EXCEPTION 'expected reopen updated, got %', v_result;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.solo_plus_cases
    WHERE id = v_reopen_case_id
      AND case_status = 'verification_pending'
      AND refund_status = 'none'
      AND rejection_reason IS NULL
      AND rejected_at IS NULL
      AND rejected_by_admin_id IS NULL
      AND reopened_by_admin_id = v_admin_id
  ) THEN
    RAISE EXCEPTION 'reopen did not clear rejected-state fields and move to verification_pending';
  END IF;

  SELECT count(*)
  INTO v_reopen_requirement_count_after
  FROM public.solo_plus_case_requirements
  WHERE case_id = v_reopen_case_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'requirement_code', requirement_code,
        'requirement_state', requirement_state,
        'verification_log_id', verification_log_id,
        'evidence_source_type', evidence_source_type,
        'evidence_source_id', evidence_source_id,
        'evidence_reference', evidence_reference,
        'original_completed_at', original_completed_at,
        'reuse_decision_at', reuse_decision_at,
        'reuse_reason', reuse_reason,
        'policy_rule_applied', policy_rule_applied,
        'reviewed_by_admin_id', reviewed_by_admin_id,
        'review_note', review_note,
        'provider_name', provider_name,
        'provider_reference', provider_reference,
        'failure_reason', failure_reason,
        'completed_at', completed_at,
        'metadata', metadata,
        'created_at', created_at,
        'updated_at', updated_at
      )
      ORDER BY requirement_code
    ),
    '[]'::jsonb
  )
  INTO v_reopen_requirements_after
  FROM public.solo_plus_case_requirements
  WHERE case_id = v_reopen_case_id;

  IF v_reopen_requirement_count_after <> v_reopen_requirement_count_before THEN
    RAISE EXCEPTION 'reopen changed the requirement row count';
  END IF;

  IF v_reopen_requirements_after <> v_reopen_requirements_before THEN
    RAISE EXCEPTION 'reopen changed requirement provenance';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.solo_plus_case_events
    WHERE case_id = v_reopen_case_id
      AND event_type = 'case_reopened'
      AND request_idempotency_key = 'solo-plus-reopen-1'
      AND actor_type = 'admin'
      AND actor_id = v_admin_id
  ) THEN
    RAISE EXCEPTION 'reopen did not persist the expected review event';
  END IF;

  v_result := public.review_solo_plus_case_v1(
    v_invalid_state_case_id,
    0,
    'solo-plus-invalid-state-1',
    'approve',
    v_admin_id,
    'invalid source state',
    NULL
  );

  IF v_result->>'kind' <> 'state_conflict' THEN
    RAISE EXCEPTION 'expected state_conflict, got %', v_result;
  END IF;

  v_result := public.review_solo_plus_case_v1(
    v_version_case_id,
    9,
    'solo-plus-version-1',
    'approve',
    v_admin_id,
    'stale version',
    NULL
  );

  IF v_result->>'kind' <> 'version_conflict' THEN
    RAISE EXCEPTION 'expected version_conflict, got %', v_result;
  END IF;

  CREATE OR REPLACE FUNCTION pg_temp.raise_review_event_failure()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $trigger$
  BEGIN
    IF NEW.request_idempotency_key = 'force-review-fail' THEN
      RAISE EXCEPTION 'forced review event insert failure';
    END IF;
    RETURN NEW;
  END;
  $trigger$;

  CREATE TRIGGER trg_force_review_event_failure
  BEFORE INSERT ON public.solo_plus_case_events
  FOR EACH ROW
  EXECUTE FUNCTION pg_temp.raise_review_event_failure();

  BEGIN
    PERFORM public.review_solo_plus_case_v1(
      v_atomic_case_id,
      0,
      'force-review-fail',
      'approve',
      v_admin_id,
      'Forced failure.',
      NULL
    );
    RAISE EXCEPTION 'expected forced review event failure';
  EXCEPTION
    WHEN others THEN
      IF position('forced review event insert failure' in SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;

  DROP TRIGGER trg_force_review_event_failure ON public.solo_plus_case_events;

  IF EXISTS (
    SELECT 1
    FROM public.solo_plus_cases
    WHERE id = v_atomic_case_id
      AND case_status <> 'manual_review'
  ) THEN
    RAISE EXCEPTION 'forced late failure did not roll back the case mutation';
  END IF;

  SELECT count(*)
  INTO v_event_count
  FROM public.solo_plus_case_events
  WHERE case_id = v_atomic_case_id
    AND request_idempotency_key = 'force-review-fail';

  IF v_event_count <> 0 THEN
    RAISE EXCEPTION 'forced late failure did not roll back event persistence';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.merchants
    WHERE id = v_merchant_id
      AND subscription_plan <> 'solo_lite'
  ) THEN
    RAISE EXCEPTION 'approval unexpectedly changed merchant subscription_plan';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.merchants
    WHERE id = v_merchant_id
      AND live_features_enabled IS DISTINCT FROM v_live_features_before
  ) THEN
    RAISE EXCEPTION 'approval unexpectedly changed merchant live_features_enabled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.merchants
    WHERE id = v_merchant_id
      AND setup_mode IS DISTINCT FROM v_setup_mode_before
  ) THEN
    RAISE EXCEPTION 'approval unexpectedly changed merchant setup_mode';
  END IF;

  IF to_regclass('public.subscriptions') IS NOT NULL THEN
    SELECT count(*)
    INTO v_subscriptions_after
    FROM public.subscriptions
    WHERE merchant_id = v_merchant_id;

    SELECT COALESCE(array_agg(md5(to_jsonb(s)::text) ORDER BY md5(to_jsonb(s)::text)), ARRAY[]::TEXT[])
    INTO v_subscriptions_after_state
    FROM public.subscriptions s
    WHERE merchant_id = v_merchant_id;

    IF v_subscriptions_after <> v_subscriptions_before THEN
      RAISE EXCEPTION 'approval unexpectedly changed subscriptions row count';
    END IF;

    IF v_subscriptions_after_state <> v_subscriptions_before_state THEN
      RAISE EXCEPTION 'approval unexpectedly changed subscriptions row state';
    END IF;
  END IF;

  IF to_regclass('public.workspace_subscriptions') IS NOT NULL THEN
    SELECT count(*)
    INTO v_workspace_subscriptions_after
    FROM public.workspace_subscriptions
    WHERE merchant_id = v_merchant_id;

    SELECT COALESCE(array_agg(md5(to_jsonb(ws)::text) ORDER BY md5(to_jsonb(ws)::text)), ARRAY[]::TEXT[])
    INTO v_workspace_subscriptions_after_state
    FROM public.workspace_subscriptions ws
    WHERE merchant_id = v_merchant_id;

    IF v_workspace_subscriptions_after <> v_workspace_subscriptions_before THEN
      RAISE EXCEPTION 'approval unexpectedly changed workspace_subscriptions row count';
    END IF;

    IF v_workspace_subscriptions_after_state <> v_workspace_subscriptions_before_state THEN
      RAISE EXCEPTION 'approval unexpectedly changed workspace_subscriptions row state';
    END IF;
  END IF;

  IF to_regclass('public.platform_settings') IS NOT NULL THEN
    SELECT COALESCE(array_agg(key || '=' || value ORDER BY key), ARRAY[]::TEXT[])
    INTO v_flag_state_after
    FROM public.platform_settings
    WHERE key IN (
      'plan_migration_solo_lite_enabled',
      'solo_plus_enabled',
      'solo_plus_kyc_enabled'
    );

    IF v_flag_state_after <> v_flag_state_before THEN
      RAISE EXCEPTION 'approval unexpectedly changed protected Solo Plus feature flags';
    END IF;
  END IF;
END
$$;

ROLLBACK;
