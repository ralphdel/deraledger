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
  v_user_id UUID := '00000000-0000-4000-8000-000000014001'::uuid;
  v_other_user_id UUID := '00000000-0000-4000-8000-000000014002'::uuid;
  v_merchant_id UUID := '00000000-0000-4000-8000-000000014101'::uuid;
  v_session_id UUID := '00000000-0000-4000-8000-000000014201'::uuid;
  v_historical_merchant_id UUID := '00000000-0000-4000-8000-000000014104'::uuid;
  v_cross_mode_merchant_id UUID := '00000000-0000-4000-8000-000000014105'::uuid;
  v_cross_mode_session_id UUID := '00000000-0000-4000-8000-000000014202'::uuid;
  v_cross_mode_alt_session_id UUID := '00000000-0000-4000-8000-000000014203'::uuid;
  v_insert_fail_merchant_id UUID := '00000000-0000-4000-8000-000000014102'::uuid;
  v_update_fail_merchant_id UUID := '00000000-0000-4000-8000-000000014103'::uuid;
  v_result JSONB;
  v_replay JSONB;
  v_count INTEGER;
  v_before_payment_records INTEGER;
  v_before_solo_plus_cases INTEGER;
  v_before_workspace_subscriptions INTEGER;
  v_lock_null BIGINT;
  v_lock_session BIGINT;
  v_error_seen BOOLEAN;
BEGIN
  PERFORM pg_temp.assert_true(
    EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'record_verification_disclosure_acceptance_v1'
        AND oidvectortypes(p.proargtypes) =
          'uuid, uuid, uuid, text, text, text, text, text, jsonb'
        AND pg_get_function_result(p.oid) = 'jsonb'
        AND p.prosecdef
        AND array_to_string(p.proconfig, ' ') ILIKE '%search_path=public, pg_temp%'
    ),
    'verification disclosure RPC signature/security shape is incorrect'
  );

  PERFORM pg_temp.assert_service_role_only_function_execute(
    'record_verification_disclosure_acceptance_v1',
    'uuid, uuid, uuid, text, text, text, text, text, jsonb'
  );

  PERFORM pg_temp.assert_true(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = 'verification_disclosures'
        AND grantee IN ('PUBLIC', 'anon', 'authenticated')
        AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
    ),
    'verification_disclosures must not expose broad browser writes'
  );

  PERFORM pg_temp.assert_true(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = 'merchants'
        AND grantee IN ('PUBLIC', 'anon', 'authenticated')
        AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
    ),
    'merchants must not expose broad browser acknowledgement updates'
  );

  INSERT INTO auth.users(id)
  VALUES (v_user_id), (v_other_user_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.merchants(id, user_id, business_name, email)
  VALUES
    (v_merchant_id, v_user_id, 'Disclosure Merchant', 'disclosure@example.test'),
    (v_historical_merchant_id, v_user_id, 'Historical Disclosure Merchant', 'historical-disclosure@example.test'),
    (v_cross_mode_merchant_id, v_user_id, 'Cross Mode Merchant', 'cross-mode@example.test'),
    (v_insert_fail_merchant_id, v_user_id, 'Insert Failure Merchant', 'insert-failure@example.test'),
    (v_update_fail_merchant_id, v_user_id, 'Update Failure Merchant', 'update-failure@example.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.onboarding_sessions(id, email, business_name, plan)
  VALUES
    (v_session_id, 'disclosure@example.test', 'Disclosure Merchant', 'solo_plus'),
    (v_cross_mode_session_id, 'cross-mode@example.test', 'Cross Mode Merchant', 'solo_plus'),
    (v_cross_mode_alt_session_id, 'cross-mode@example.test', 'Cross Mode Merchant', 'solo_plus')
  ON CONFLICT (id) DO NOTHING;

  SELECT count(*) INTO v_before_payment_records FROM public.payment_records;
  SELECT count(*) INTO v_before_solo_plus_cases FROM public.solo_plus_cases;
  SELECT count(*) INTO v_before_workspace_subscriptions FROM public.workspace_subscriptions;

  v_result := public.record_verification_disclosure_acceptance_v1(
    v_user_id,
    v_merchant_id,
    NULL,
    'solo_plus',
    'upgrade',
    '1.0',
    '127.0.0.1',
    'contract-test',
    '{"source":"sql-test"}'::jsonb
  );

  PERFORM pg_temp.assert_true(v_result ->> 'kind' = 'created', 'merchant-scoped acceptance should be created');

  SELECT count(*) INTO v_count
  FROM public.verification_disclosures
  WHERE merchant_id = v_merchant_id
    AND user_id = v_user_id
    AND plan_type = 'solo_plus'
    AND context = 'upgrade'
    AND disclosure_version = '1.0';

  PERFORM pg_temp.assert_true(v_count = 1, 'merchant-scoped acceptance should insert exactly one audit row');
  PERFORM pg_temp.assert_true(
    EXISTS (
      SELECT 1
      FROM public.merchants
      WHERE id = v_merchant_id
        AND verification_disclosure_acknowledged_at IS NOT NULL
        AND verification_disclosure_version = '1.0'
    ),
    'merchant acknowledgement summary should update atomically with disclosure insert'
  );

  v_replay := public.record_verification_disclosure_acceptance_v1(
    v_user_id,
    v_merchant_id,
    NULL,
    'solo_plus',
    'upgrade',
    '1.0',
    '127.0.0.1',
    'contract-test',
    '{"source":"sql-test-replay"}'::jsonb
  );

  PERFORM pg_temp.assert_true(v_replay ->> 'kind' = 'replayed', 'identical merchant-scoped acceptance should replay');

  SELECT count(*) INTO v_count
  FROM public.verification_disclosures
  WHERE merchant_id = v_merchant_id
    AND user_id = v_user_id
    AND plan_type = 'solo_plus'
    AND context = 'upgrade'
    AND disclosure_version = '1.0';

  PERFORM pg_temp.assert_true(v_count = 1, 'merchant-scoped replay should not duplicate audit rows');

  v_result := public.record_verification_disclosure_acceptance_v1(
    NULL,
    NULL,
    v_session_id,
    'solo_plus',
    'onboarding',
    '1.0',
    NULL,
    NULL,
    '{}'::jsonb
  );

  PERFORM pg_temp.assert_true(v_result ->> 'kind' = 'created', 'onboarding-session-only acceptance should be supported');

  v_replay := public.record_verification_disclosure_acceptance_v1(
    v_user_id,
    v_merchant_id,
    v_session_id,
    'solo_plus',
    'onboarding',
    '1.0',
    NULL,
    NULL,
    '{}'::jsonb
  );

  PERFORM pg_temp.assert_true(
    v_replay ->> 'kind' = 'replayed',
    'later merchant-scoped onboarding replay should reuse the session acceptance'
  );

  SELECT count(*) INTO v_count
  FROM public.verification_disclosures
  WHERE onboarding_session_id = v_session_id
    AND plan_type = 'solo_plus'
    AND context = 'onboarding'
    AND disclosure_version = '1.0';

  PERFORM pg_temp.assert_true(v_count = 1, 'onboarding replay should not duplicate session audit rows');

  DELETE FROM public.verification_disclosures
  WHERE merchant_id = v_historical_merchant_id
    AND user_id = v_user_id
    AND onboarding_session_id IS NULL
    AND plan_type = 'solo_plus'
    AND context = 'upgrade'
    AND disclosure_version = '1.0';

  UPDATE public.merchants
  SET
    verification_disclosure_acknowledged_at = NULL,
    verification_disclosure_version = NULL
  WHERE id = v_historical_merchant_id;

  INSERT INTO public.verification_disclosures(
    id,
    user_id,
    merchant_id,
    onboarding_session_id,
    plan_type,
    disclosure_version,
    acknowledged_at,
    ip_address,
    user_agent,
    device_metadata,
    context,
    created_at,
    is_canonical,
    superseded_by_disclosure_id
  )
  VALUES (
    '30000000-0000-4000-8000-000000000001'::uuid,
    v_user_id,
    v_historical_merchant_id,
    NULL,
    'solo_plus',
    '1.0',
    TIMESTAMPTZ '2026-07-17 19:48:33+00',
    '127.0.0.1',
    'historical-duplicate-test',
    '{"seed":1}'::jsonb,
    'upgrade',
    TIMESTAMPTZ '2026-07-17 19:48:33+00',
    true,
    NULL
  );

  INSERT INTO public.verification_disclosures(
    id,
    user_id,
    merchant_id,
    onboarding_session_id,
    plan_type,
    disclosure_version,
    acknowledged_at,
    ip_address,
    user_agent,
    device_metadata,
    context,
    created_at,
    is_canonical,
    superseded_by_disclosure_id
  )
  SELECT
    ('30000000-0000-4000-8000-' || lpad(gs::text, 12, '0'))::uuid,
    v_user_id,
    v_historical_merchant_id,
    NULL,
    'solo_plus',
    '1.0',
    TIMESTAMPTZ '2026-07-17 19:48:33+00' + make_interval(mins => gs - 1),
    '127.0.0.1',
    'historical-duplicate-test',
    jsonb_build_object('seed', gs),
    'upgrade',
    TIMESTAMPTZ '2026-07-17 19:48:33+00' + make_interval(mins => gs - 1),
    false,
    '30000000-0000-4000-8000-000000000001'::uuid
  FROM generate_series(2, 5) AS gs;

  SELECT count(*) INTO v_count
  FROM public.verification_disclosures
  WHERE merchant_id = v_historical_merchant_id
    AND user_id IS NOT DISTINCT FROM v_user_id
    AND onboarding_session_id IS NULL
    AND plan_type = 'solo_plus'
    AND context = 'upgrade'
    AND disclosure_version = '1.0';

  PERFORM pg_temp.assert_true(v_count = 5, 'historical duplicate seed should create five rows');
  PERFORM pg_temp.assert_true(
    (
      SELECT count(*)
      FROM public.verification_disclosures
      WHERE merchant_id = v_historical_merchant_id
        AND user_id IS NOT DISTINCT FROM v_user_id
        AND onboarding_session_id IS NULL
        AND plan_type = 'solo_plus'
        AND context = 'upgrade'
        AND disclosure_version = '1.0'
        AND is_canonical = true
    ) = 1,
    'historical duplicate group should have exactly one canonical row'
  );
  PERFORM pg_temp.assert_true(
    (
      SELECT count(*)
      FROM public.verification_disclosures
      WHERE merchant_id = v_historical_merchant_id
        AND user_id IS NOT DISTINCT FROM v_user_id
        AND onboarding_session_id IS NULL
        AND plan_type = 'solo_plus'
        AND context = 'upgrade'
        AND disclosure_version = '1.0'
        AND is_canonical = false
        AND superseded_by_disclosure_id = '30000000-0000-4000-8000-000000000001'::uuid
    ) = 4,
    'historical duplicate group should retain four non-canonical evidence rows'
  );

  v_result := public.record_verification_disclosure_acceptance_v1(
    v_user_id,
    v_historical_merchant_id,
    NULL,
    'solo_plus',
    'upgrade',
    '1.0',
    '127.0.0.1',
    'historical-duplicate-replay-1',
    '{"source":"historical-duplicate-replay-1"}'::jsonb
  );

  PERFORM pg_temp.assert_true(
    v_result ->> 'kind' = 'replayed',
    'historical duplicate replay should return replayed on first retry'
  );
  PERFORM pg_temp.assert_true(
    v_result ->> 'disclosureId' = '30000000-0000-4000-8000-000000000001',
    'historical duplicate replay should return the canonical disclosure id'
  );

  v_replay := public.record_verification_disclosure_acceptance_v1(
    v_user_id,
    v_historical_merchant_id,
    NULL,
    'solo_plus',
    'upgrade',
    '1.0',
    '127.0.0.1',
    'historical-duplicate-replay-2',
    '{"source":"historical-duplicate-replay-2"}'::jsonb
  );

  PERFORM pg_temp.assert_true(
    v_replay ->> 'kind' = 'replayed',
    'historical duplicate replay should return replayed on second retry'
  );

  SELECT count(*) INTO v_count
  FROM public.verification_disclosures
  WHERE merchant_id = v_historical_merchant_id
    AND user_id IS NOT DISTINCT FROM v_user_id
    AND onboarding_session_id IS NULL
    AND plan_type = 'solo_plus'
    AND context = 'upgrade'
    AND disclosure_version = '1.0';

  PERFORM pg_temp.assert_true(v_count = 5, 'historical duplicate replay should not create a sixth row');
  PERFORM pg_temp.assert_true(
    EXISTS (
      SELECT 1
      FROM public.merchants
      WHERE id = v_historical_merchant_id
        AND verification_disclosure_acknowledged_at IS NOT NULL
        AND verification_disclosure_version = '1.0'
    ),
    'historical duplicate replay should keep merchant acknowledgement fields correct'
  );

  DELETE FROM public.verification_disclosures
  WHERE merchant_id = v_cross_mode_merchant_id
     OR onboarding_session_id IN (v_cross_mode_session_id, v_cross_mode_alt_session_id);

  INSERT INTO public.verification_disclosures(
    id,
    user_id,
    merchant_id,
    onboarding_session_id,
    plan_type,
    disclosure_version,
    acknowledged_at,
    ip_address,
    user_agent,
    device_metadata,
    context,
    created_at
  )
  VALUES (
    '40000000-0000-4000-8000-000000000001'::uuid,
    v_user_id,
    v_cross_mode_merchant_id,
    v_cross_mode_session_id,
    'solo_plus',
    '1.0',
    TIMESTAMPTZ '2026-07-18 06:05:15+00',
    '127.0.0.1',
    'cross-mode-test',
    '{"seed":"nonnull-first"}'::jsonb,
    'upgrade',
    TIMESTAMPTZ '2026-07-18 06:05:15+00'
  );

  v_result := public.record_verification_disclosure_acceptance_v1(
    v_user_id,
    v_cross_mode_merchant_id,
    NULL,
    'solo_plus',
    'upgrade',
    '1.0',
    NULL,
    NULL,
    '{}'::jsonb
  );

  PERFORM pg_temp.assert_true(
    v_result ->> 'kind' = 'created',
    'null-session call should create a distinct upgrade disclosure when only a non-null session row exists'
  );

  v_replay := public.record_verification_disclosure_acceptance_v1(
    v_user_id,
    v_cross_mode_merchant_id,
    NULL,
    'solo_plus',
    'upgrade',
    '1.0',
    NULL,
    NULL,
    '{}'::jsonb
  );

  PERFORM pg_temp.assert_true(
    v_replay ->> 'kind' = 'replayed',
    'null-session retry should replay its own upgrade disclosure'
  );

  DELETE FROM public.verification_disclosures
  WHERE merchant_id = v_cross_mode_merchant_id
     OR onboarding_session_id IN (v_cross_mode_session_id, v_cross_mode_alt_session_id);

  INSERT INTO public.verification_disclosures(
    id,
    user_id,
    merchant_id,
    onboarding_session_id,
    plan_type,
    disclosure_version,
    acknowledged_at,
    ip_address,
    user_agent,
    device_metadata,
    context,
    created_at
  )
  VALUES (
    '40000000-0000-4000-8000-000000000002'::uuid,
    v_user_id,
    v_cross_mode_merchant_id,
    NULL,
    'solo_plus',
    '1.0',
    TIMESTAMPTZ '2026-07-18 06:10:11+00',
    '127.0.0.1',
    'cross-mode-test',
    '{"seed":"null-first"}'::jsonb,
    'upgrade',
    TIMESTAMPTZ '2026-07-18 06:10:11+00'
  );

  v_result := public.record_verification_disclosure_acceptance_v1(
    v_user_id,
    v_cross_mode_merchant_id,
    v_cross_mode_alt_session_id,
    'solo_plus',
    'upgrade',
    '1.0',
    NULL,
    NULL,
    '{}'::jsonb
  );

  PERFORM pg_temp.assert_true(
    v_result ->> 'kind' = 'created',
    'non-null session call should create a distinct onboarding disclosure when only a null-session row exists'
  );

  v_replay := public.record_verification_disclosure_acceptance_v1(
    v_user_id,
    v_cross_mode_merchant_id,
    v_cross_mode_alt_session_id,
    'solo_plus',
    'upgrade',
    '1.0',
    NULL,
    NULL,
    '{}'::jsonb
  );

  PERFORM pg_temp.assert_true(
    v_replay ->> 'kind' = 'replayed',
    'non-null session retry should replay its own onboarding disclosure'
  );

  SELECT count(*) INTO v_count
  FROM public.verification_disclosures
  WHERE merchant_id = v_cross_mode_merchant_id
    AND user_id IS NOT DISTINCT FROM v_user_id
    AND plan_type = 'solo_plus'
    AND context = 'upgrade'
    AND disclosure_version = '1.0';

  PERFORM pg_temp.assert_true(v_count = 2, 'cross-mode replay characterization should leave one null and one non-null row');

  SELECT hashtextextended(
      'verification-disclosure:' ||
      COALESCE(v_cross_mode_merchant_id::text, 'no-merchant') || ':' ||
      COALESCE(NULL::uuid::text, 'no-session') || ':' ||
      COALESCE(v_user_id::text, 'no-user') || ':' ||
      'solo_plus' || ':' ||
      'upgrade' || ':' ||
      '1.0',
      0
    )
  INTO v_lock_null;

  SELECT hashtextextended(
      'verification-disclosure:' ||
      COALESCE(v_cross_mode_merchant_id::text, 'no-merchant') || ':' ||
      COALESCE(v_cross_mode_alt_session_id::text, 'no-session') || ':' ||
      COALESCE(v_user_id::text, 'no-user') || ':' ||
      'solo_plus' || ':' ||
      'upgrade' || ':' ||
      '1.0',
      0
    )
  INTO v_lock_session;

  PERFORM pg_temp.assert_true(
    v_lock_null <> v_lock_session,
    'cross-mode null-session and non-null-session calls should use different advisory lock keys'
  );

  v_error_seen := false;
  BEGIN
    INSERT INTO public.verification_disclosures(
      user_id,
      merchant_id,
      onboarding_session_id,
      plan_type,
      disclosure_version,
      acknowledged_at,
      context
    )
    VALUES (
      v_user_id,
      v_cross_mode_merchant_id,
      v_cross_mode_alt_session_id,
      'solo_plus',
      '1.0',
      now(),
      'upgrade'
    );
  EXCEPTION WHEN unique_violation THEN
    v_error_seen := true;
  END;
  PERFORM pg_temp.assert_true(v_error_seen, 'duplicate canonical onboarding identity should be rejected');

  v_error_seen := false;
  BEGIN
    INSERT INTO public.verification_disclosures(
      user_id,
      merchant_id,
      onboarding_session_id,
      plan_type,
      disclosure_version,
      acknowledged_at,
      context
    )
    VALUES (
      v_user_id,
      v_cross_mode_merchant_id,
      NULL,
      'solo_plus',
      '1.0',
      now(),
      'upgrade'
    );
  EXCEPTION WHEN unique_violation THEN
    v_error_seen := true;
  END;
  PERFORM pg_temp.assert_true(v_error_seen, 'duplicate canonical upgrade identity should be rejected');

  v_error_seen := false;
  BEGIN
    INSERT INTO public.verification_disclosures(
      id,
      user_id,
      merchant_id,
      onboarding_session_id,
      plan_type,
      disclosure_version,
      acknowledged_at,
      context,
      is_canonical,
      superseded_by_disclosure_id
    )
    VALUES (
      '40000000-0000-4000-8000-000000000003'::uuid,
      v_user_id,
      v_cross_mode_merchant_id,
      NULL,
      'solo_plus',
      '1.0',
      now(),
      'upgrade',
      false,
      NULL
    );
  EXCEPTION WHEN check_violation THEN
    v_error_seen := true;
  END;
  PERFORM pg_temp.assert_true(v_error_seen, 'non-canonical row without canonical reference should fail');

  v_error_seen := false;
  BEGIN
    INSERT INTO public.verification_disclosures(
      id,
      user_id,
      merchant_id,
      onboarding_session_id,
      plan_type,
      disclosure_version,
      acknowledged_at,
      context,
      is_canonical,
      superseded_by_disclosure_id
    )
    VALUES (
      '40000000-0000-4000-8000-000000000004'::uuid,
      v_user_id,
      v_cross_mode_merchant_id,
      NULL,
      'solo_plus',
      '1.0',
      now(),
      'upgrade',
      false,
      '40000000-0000-4000-8000-000000000004'::uuid
    );
  EXCEPTION WHEN check_violation THEN
    v_error_seen := true;
  END;
  PERFORM pg_temp.assert_true(v_error_seen, 'self-superseded non-canonical row should fail');

  v_error_seen := false;
  BEGIN
    INSERT INTO public.verification_disclosures(
      id,
      user_id,
      merchant_id,
      onboarding_session_id,
      plan_type,
      disclosure_version,
      acknowledged_at,
      context
    )
    VALUES (
      '40000000-0000-4000-8000-000000000005'::uuid,
      NULL,
      v_cross_mode_merchant_id,
      NULL,
      'solo_plus',
      '1.0-null-user',
      now(),
      'upgrade'
    );

    INSERT INTO public.verification_disclosures(
      id,
      user_id,
      merchant_id,
      onboarding_session_id,
      plan_type,
      disclosure_version,
      acknowledged_at,
      context
    )
    VALUES (
      '40000000-0000-4000-8000-000000000006'::uuid,
      NULL,
      v_cross_mode_merchant_id,
      NULL,
      'solo_plus',
      '1.0-null-user',
      now(),
      'upgrade'
    );
  EXCEPTION WHEN unique_violation THEN
    v_error_seen := true;
  END;
  PERFORM pg_temp.assert_true(v_error_seen, 'duplicate canonical upgrade identity should be rejected when user_id is null');

  v_result := public.record_verification_disclosure_acceptance_v1(
    v_user_id,
    '00000000-0000-4000-8000-000000019999'::uuid,
    NULL,
    'solo_plus',
    'upgrade',
    '1.0',
    NULL,
    NULL,
    '{}'::jsonb
  );

  PERFORM pg_temp.assert_true(v_result ->> 'kind' = 'merchant_not_found', 'missing merchant should fail closed');

  v_result := public.record_verification_disclosure_acceptance_v1(
    v_other_user_id,
    v_merchant_id,
    NULL,
    'solo_plus',
    'upgrade',
    '1.0',
    NULL,
    NULL,
    '{}'::jsonb
  );

  PERFORM pg_temp.assert_true(v_result ->> 'kind' = 'merchant_user_mismatch', 'cross-user merchant input should fail closed');

  v_result := public.record_verification_disclosure_acceptance_v1(
    v_user_id,
    v_merchant_id,
    NULL,
    '',
    'upgrade',
    '1.0',
    NULL,
    NULL,
    '{}'::jsonb
  );

  PERFORM pg_temp.assert_true(v_result ->> 'kind' = 'invalid_input', 'malformed plan input should fail closed');

  v_result := public.record_verification_disclosure_acceptance_v1(
    v_user_id,
    v_merchant_id,
    NULL,
    'solo_plus',
    'upgrade',
    '1.1',
    NULL,
    NULL,
    '{}'::jsonb
  );

  PERFORM pg_temp.assert_true(v_result ->> 'kind' = 'version_conflict', 'conflicting disclosure version should fail closed');

  PERFORM pg_temp.assert_true(
    EXISTS (
      SELECT 1
      FROM public.merchants
      WHERE id = v_merchant_id
        AND verification_disclosure_version = '1.0'
    ),
    'older/newer unknown version conflicts must not overwrite merchant acknowledgement'
  );

  CREATE OR REPLACE FUNCTION pg_temp.fail_disclosure_insert()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $trigger$
  BEGIN
    IF NEW.merchant_id = '00000000-0000-4000-8000-000000014102'::uuid THEN
      RAISE EXCEPTION 'forced disclosure insert failure';
    END IF;
    RETURN NEW;
  END;
  $trigger$;

  CREATE TRIGGER trg_fail_disclosure_insert
  BEFORE INSERT ON public.verification_disclosures
  FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_disclosure_insert();

  v_error_seen := false;
  BEGIN
    PERFORM public.record_verification_disclosure_acceptance_v1(
      v_user_id,
      v_insert_fail_merchant_id,
      NULL,
      'solo_plus',
      'upgrade',
      '1.0',
      NULL,
      NULL,
      '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    v_error_seen := true;
  END;

  PERFORM pg_temp.assert_true(v_error_seen, 'forced disclosure insert failure should raise');
  PERFORM pg_temp.assert_true(
    NOT EXISTS (
      SELECT 1
      FROM public.merchants
      WHERE id = v_insert_fail_merchant_id
        AND verification_disclosure_acknowledged_at IS NOT NULL
    ),
    'disclosure insert failure should leave merchant acknowledgement unchanged'
  );

  DROP TRIGGER trg_fail_disclosure_insert ON public.verification_disclosures;

  CREATE OR REPLACE FUNCTION pg_temp.fail_merchant_ack_update()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $trigger$
  BEGIN
    IF NEW.id = '00000000-0000-4000-8000-000000014103'::uuid THEN
      RAISE EXCEPTION 'forced merchant acknowledgement update failure';
    END IF;
    RETURN NEW;
  END;
  $trigger$;

  CREATE TRIGGER trg_fail_merchant_ack_update
  BEFORE UPDATE ON public.merchants
  FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_merchant_ack_update();

  v_error_seen := false;
  BEGIN
    PERFORM public.record_verification_disclosure_acceptance_v1(
      v_user_id,
      v_update_fail_merchant_id,
      NULL,
      'solo_plus',
      'upgrade',
      '1.0',
      NULL,
      NULL,
      '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    v_error_seen := true;
  END;

  PERFORM pg_temp.assert_true(v_error_seen, 'forced merchant update failure should raise');
  PERFORM pg_temp.assert_true(
    NOT EXISTS (
      SELECT 1
      FROM public.verification_disclosures
      WHERE merchant_id = v_update_fail_merchant_id
        AND plan_type = 'solo_plus'
        AND context = 'upgrade'
        AND disclosure_version = '1.0'
    ),
    'merchant update failure should roll back the disclosure insert'
  );

  DROP TRIGGER trg_fail_merchant_ack_update ON public.merchants;

  PERFORM pg_temp.assert_true(
    (SELECT count(*) FROM public.payment_records) = v_before_payment_records,
    'verification disclosure RPC must not mutate payment_records'
  );
  PERFORM pg_temp.assert_true(
    (SELECT count(*) FROM public.solo_plus_cases) = v_before_solo_plus_cases,
    'verification disclosure RPC must not mutate solo_plus_cases'
  );
  PERFORM pg_temp.assert_true(
    (SELECT count(*) FROM public.workspace_subscriptions) = v_before_workspace_subscriptions,
    'verification disclosure RPC must not mutate workspace_subscriptions'
  );
END;
$$;

ROLLBACK;

SELECT 'phase2_verification_disclosure_acknowledgement_rpc.sql passed' AS result;
