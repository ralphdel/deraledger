BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_table_exists_m012(p_table_name TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_regclass(format('public.%I', p_table_name)) IS NULL THEN
    RAISE EXCEPTION 'Commit 10 prerequisite missing: public.% does not exist', p_table_name;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_column_exists_m012(
  p_table_name TEXT,
  p_column_name TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = p_table_name
      AND column_name = p_column_name
  ) THEN
    RAISE EXCEPTION 'Commit 10 prerequisite missing: public.%.% does not exist', p_table_name, p_column_name;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_index_exists_m012(
  p_table_name TEXT,
  p_index_name TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = p_table_name
      AND indexname = p_index_name
  ) THEN
    RAISE EXCEPTION 'Commit 10 prerequisite missing: public.% index % does not exist', p_table_name, p_index_name;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_no_unexpected_function_overloads_m012(
  p_function_name TEXT,
  p_exact_signature TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_exact_oid oid;
BEGIN
  v_exact_oid := to_regprocedure(p_exact_signature);

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = p_function_name
      AND (v_exact_oid IS NULL OR p.oid <> v_exact_oid)
  ) THEN
    RAISE EXCEPTION 'Commit 10 compatibility failure: schema=public object=function % expected=no unexpected overload actual=present',
      p_function_name;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.normalize_catalog_sql_m012(p_sql TEXT)
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

CREATE OR REPLACE FUNCTION pg_temp.assert_public_table_rls_state_m012(
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

  IF v_enabled IS NULL THEN
    RAISE EXCEPTION 'Commit 10 compatibility failure: schema=public object=% expected=table actual=missing',
      p_table_name;
  END IF;

  IF v_enabled IS DISTINCT FROM p_expected_enabled THEN
    RAISE EXCEPTION 'Commit 10 compatibility failure: schema=public object=% expected=rls_enabled:% actual=rls_enabled:%',
      p_table_name,
      CASE WHEN p_expected_enabled THEN 't' ELSE 'f' END,
      CASE WHEN v_enabled THEN 't' ELSE 'f' END;
  END IF;

  IF v_forced IS DISTINCT FROM p_expected_forced THEN
    RAISE EXCEPTION 'Commit 10 compatibility failure: schema=public object=% expected=rls_forced:% actual=rls_forced:%',
      p_table_name,
      CASE WHEN p_expected_forced THEN 't' ELSE 'f' END,
      CASE WHEN v_forced THEN 't' ELSE 'f' END;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_table_privileges_absent_m012(
  p_table_name TEXT,
  p_roles TEXT[],
  p_privileges TEXT[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_grant RECORD;
BEGIN
  FOR v_grant IN
    SELECT lower(grantee) AS grantee, lower(privilege_type) AS privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = p_table_name
      AND lower(grantee) = ANY (ARRAY(SELECT lower(value) FROM unnest(p_roles) AS value))
      AND lower(privilege_type) = ANY (ARRAY(SELECT lower(value) FROM unnest(p_privileges) AS value))
    ORDER BY grantee, privilege_type
  LOOP
    RAISE EXCEPTION 'Commit 10 compatibility failure: schema=public object=table % expected=no browser grant actual=%:%',
      p_table_name,
      v_grant.grantee,
      v_grant.privilege_type;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_table_privileges_present_m012(
  p_table_name TEXT,
  p_roles TEXT[],
  p_privileges TEXT[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_role TEXT;
  v_privilege TEXT;
BEGIN
  FOREACH v_role IN ARRAY p_roles
  LOOP
    FOREACH v_privilege IN ARRAY p_privileges
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = p_table_name
          AND lower(grantee) = lower(v_role)
          AND lower(privilege_type) = lower(v_privilege)
      ) THEN
        RAISE EXCEPTION 'Commit 10 compatibility failure: schema=public object=table % expected=%:% actual=missing',
          p_table_name,
          lower(v_role),
          lower(v_privilege);
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.repair_public_table_access_manifest_m012(
  p_table_name TEXT,
  p_access_model TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', p_table_name);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', p_table_name);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', p_table_name);

  IF p_access_model = 'merchant_read_select' THEN
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', p_table_name);
  ELSIF p_access_model <> 'internal' THEN
    RAISE EXCEPTION 'Commit 10 compatibility failure: schema=public object=table % expected=known access model actual=%',
      p_table_name,
      p_access_model;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_table_access_manifest_m012(
  p_table_name TEXT,
  p_access_model TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_temp.assert_public_table_privileges_absent_m012(
    p_table_name,
    ARRAY['public', 'anon'],
    ARRAY['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']
  );

  PERFORM pg_temp.assert_public_table_privileges_absent_m012(
    p_table_name,
    ARRAY['authenticated'],
    ARRAY['insert', 'update', 'delete', 'truncate', 'references', 'trigger']
  );

  IF p_access_model = 'merchant_read_select' THEN
    PERFORM pg_temp.assert_public_table_privileges_present_m012(
      p_table_name,
      ARRAY['authenticated'],
      ARRAY['select']
    );
  ELSIF p_access_model = 'internal' THEN
    PERFORM pg_temp.assert_public_table_privileges_absent_m012(
      p_table_name,
      ARRAY['authenticated'],
      ARRAY['select']
    );
  ELSE
    RAISE EXCEPTION 'Commit 10 compatibility failure: schema=public object=table % expected=known access model actual=%',
      p_table_name,
      p_access_model;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_table_allowed_triggers_m012(
  p_table_name TEXT,
  p_expected_triggers TEXT[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_actual TEXT[];
BEGIN
  SELECT COALESCE(array_agg(t.tgname::text ORDER BY t.tgname::text), ARRAY[]::TEXT[])
  INTO v_actual
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = p_table_name
    AND t.tgisinternal = false;

  IF v_actual <> p_expected_triggers THEN
    RAISE EXCEPTION 'Commit 10 compatibility failure: schema=public object=table % expected=triggers:% actual=%',
      p_table_name,
      p_expected_triggers,
      v_actual;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_only_expected_policies_m012(
  p_table_name TEXT,
  p_expected_policy_names TEXT[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_actual TEXT[];
BEGIN
  SELECT COALESCE(array_agg(policyname::text ORDER BY policyname::text), ARRAY[]::TEXT[])
  INTO v_actual
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = p_table_name;

  IF v_actual <> p_expected_policy_names THEN
    RAISE EXCEPTION 'Commit 10 compatibility failure: schema=public object=table % expected=policies:% actual=%',
      p_table_name,
      p_expected_policy_names,
      v_actual;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_policy_fragments_m012(
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
    RAISE EXCEPTION 'Commit 10 compatibility failure: schema=public object=policy %.% expected=present actual=missing',
      p_table_name,
      p_policy_name;
  END IF;

  IF lower(v_policy.cmd) <> lower(p_command) THEN
    RAISE EXCEPTION 'Commit 10 compatibility failure: schema=public object=policy %.% expected=command:% actual=%',
      p_table_name,
      p_policy_name,
      lower(p_command),
      lower(v_policy.cmd);
  END IF;

  IF COALESCE(v_policy.roles, ARRAY[]::TEXT[]) <> p_expected_roles THEN
    RAISE EXCEPTION 'Commit 10 compatibility failure: schema=public object=policy %.% expected=roles:% actual=%',
      p_table_name,
      p_policy_name,
      p_expected_roles,
      v_policy.roles;
  END IF;

  v_normalized_qual := pg_temp.normalize_catalog_sql_m012(v_policy.qual);

  FOREACH v_fragment IN ARRAY p_using_fragments
  LOOP
    IF position(pg_temp.normalize_catalog_sql_m012(v_fragment) IN v_normalized_qual) = 0 THEN
      RAISE EXCEPTION 'Commit 10 compatibility failure: schema=public object=policy %.% expected=fragment:% actual=%',
        p_table_name,
        p_policy_name,
        pg_temp.normalize_catalog_sql_m012(v_fragment),
        v_normalized_qual;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_function_search_path_m012(
  p_function_name TEXT,
  p_type_args TEXT,
  p_expected_setting TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_matches BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN unnest(COALESCE(p.proconfig, ARRAY[]::TEXT[])) AS config(setting) ON TRUE
    WHERE n.nspname = 'public'
      AND p.proname = p_function_name
      AND oidvectortypes(p.proargtypes) = p_type_args
      AND config.setting = p_expected_setting
  )
  INTO v_matches;

  IF v_matches IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Commit 10 function verification failed: public.% (%) missing %',
      p_function_name,
      p_type_args,
      p_expected_setting;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_service_role_only_function_execute_m012(
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
    RAISE EXCEPTION 'Commit 10 function verification failed: public.% (%) missing',
      p_function_name,
      p_type_args;
  END IF;

  IF NOT has_function_privilege('service_role', v_function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Commit 10 function verification failed: public.% (%) must grant EXECUTE to service_role',
      p_function_name,
      p_type_args;
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
    RAISE EXCEPTION 'Commit 10 function verification failed: public.% (%) must not grant EXECUTE to PUBLIC',
      p_function_name,
      p_type_args;
  END IF;

  FOREACH v_denied_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF has_function_privilege(v_denied_role, v_function_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Commit 10 function verification failed: public.% (%) must not grant EXECUTE to %',
        p_function_name,
        p_type_args,
        v_denied_role;
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
    RAISE EXCEPTION 'Commit 10 function verification failed: public.% (%) grants are not owner-aware service_role-only: raw=% explicit_non_owner=% owner=%',
      p_function_name,
      p_type_args,
      v_grantees,
      v_explicit_grantees,
      v_owner_name;
  END IF;
END;
$$;

DO $$
BEGIN
  PERFORM pg_temp.assert_public_table_exists_m012('solo_plus_cases');
  PERFORM pg_temp.assert_public_table_exists_m012('solo_plus_case_requirements');
  PERFORM pg_temp.assert_public_table_exists_m012('solo_plus_case_events');
  PERFORM pg_temp.assert_public_table_exists_m012('merchants');
  PERFORM pg_temp.assert_public_table_exists_m012('workspaces');
  PERFORM pg_temp.assert_public_table_exists_m012('workspace_subscriptions');
  PERFORM pg_temp.assert_public_table_exists_m012('platform_settings');

  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_cases', 'merchant_id');
  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_cases', 'flow_origin');
  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_cases', 'source_plan');
  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_cases', 'target_plan');
  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_cases', 'case_status');
  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_cases', 'payment_status');
  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_cases', 'refund_status');
  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_cases', 'payment_reference');
  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_cases', 'expected_amount');
  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_cases', 'requirements_policy_version');
  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_cases', 'activation_idempotency_key');
  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_cases', 'row_version');
  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_cases', 'approved_at');
  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_cases', 'approved_by_admin_id');

  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_case_requirements', 'case_id');
  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_case_requirements', 'requirement_code');
  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_case_requirements', 'requirement_state');

  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_case_events', 'case_id');
  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_case_events', 'event_type');
  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_case_events', 'previous_state');
  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_case_events', 'new_state');
  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_case_events', 'actor_type');
  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_case_events', 'actor_id');
  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_case_events', 'request_idempotency_key');
  PERFORM pg_temp.assert_public_column_exists_m012('solo_plus_case_events', 'policy_version');

  PERFORM pg_temp.assert_public_column_exists_m012('merchants', 'user_id');
  PERFORM pg_temp.assert_public_column_exists_m012('merchants', 'business_name');
  PERFORM pg_temp.assert_public_column_exists_m012('merchants', 'subscription_plan');
  PERFORM pg_temp.assert_public_column_exists_m012('merchants', 'merchant_tier');
  PERFORM pg_temp.assert_public_column_exists_m012('merchants', 'monthly_collection_limit');
  PERFORM pg_temp.assert_public_column_exists_m012('merchants', 'workspace_id');
  PERFORM pg_temp.assert_public_column_exists_m012('merchants', 'onboarding_status');
  PERFORM pg_temp.assert_public_column_exists_m012('merchants', 'setup_mode');
  PERFORM pg_temp.assert_public_column_exists_m012('merchants', 'live_features_enabled');
  PERFORM pg_temp.assert_public_column_exists_m012('merchants', 'live_features_activated_at');
  PERFORM pg_temp.assert_public_column_exists_m012('merchants', 'verification_status');

  PERFORM pg_temp.assert_public_column_exists_m012('workspaces', 'owner_user_id');
  PERFORM pg_temp.assert_public_column_exists_m012('workspaces', 'merchant_id');
  PERFORM pg_temp.assert_public_column_exists_m012('workspaces', 'workspace_type');
  PERFORM pg_temp.assert_public_column_exists_m012('workspaces', 'display_name');
  PERFORM pg_temp.assert_public_column_exists_m012('workspaces', 'plan_type');
  PERFORM pg_temp.assert_public_column_exists_m012('workspaces', 'onboarding_status');
  PERFORM pg_temp.assert_public_column_exists_m012('workspaces', 'setup_mode');
  PERFORM pg_temp.assert_public_column_exists_m012('workspaces', 'live_features_enabled');

  PERFORM pg_temp.assert_public_column_exists_m012('workspace_subscriptions', 'workspace_id');
  PERFORM pg_temp.assert_public_column_exists_m012('workspace_subscriptions', 'merchant_id');
  PERFORM pg_temp.assert_public_column_exists_m012('workspace_subscriptions', 'plan_type');
  PERFORM pg_temp.assert_public_column_exists_m012('workspace_subscriptions', 'subscription_status');
  PERFORM pg_temp.assert_public_column_exists_m012('workspace_subscriptions', 'payment_reference');
  PERFORM pg_temp.assert_public_column_exists_m012('workspace_subscriptions', 'amount_paid');
  PERFORM pg_temp.assert_public_column_exists_m012('workspace_subscriptions', 'period_start');
  PERFORM pg_temp.assert_public_column_exists_m012('workspace_subscriptions', 'period_end');

  PERFORM pg_temp.assert_public_column_exists_m012('platform_settings', 'key');
  PERFORM pg_temp.assert_public_column_exists_m012('platform_settings', 'value');

  PERFORM pg_temp.assert_public_index_exists_m012('solo_plus_cases', 'idx_solo_plus_cases_activation_idempotency_key');
  PERFORM pg_temp.assert_public_index_exists_m012('solo_plus_case_events', 'idx_solo_plus_case_events_request_idempotency');

  PERFORM pg_temp.assert_public_table_allowed_triggers_m012(
    'solo_plus_cases',
    ARRAY['trg_solo_plus_cases_updated_at']
  );
  PERFORM pg_temp.assert_public_table_allowed_triggers_m012(
    'solo_plus_case_requirements',
    ARRAY['trg_solo_plus_case_requirements_updated_at']
  );
  PERFORM pg_temp.assert_public_table_allowed_triggers_m012(
    'solo_plus_case_events',
    ARRAY[]::TEXT[]
  );

  PERFORM pg_temp.assert_public_only_expected_policies_m012(
    'solo_plus_cases',
    ARRAY['merchant_read_solo_plus_cases']
  );
  PERFORM pg_temp.assert_public_only_expected_policies_m012(
    'solo_plus_case_requirements',
    ARRAY['merchant_read_solo_plus_case_requirements']
  );
  PERFORM pg_temp.assert_public_only_expected_policies_m012(
    'solo_plus_case_events',
    ARRAY[]::TEXT[]
  );

  PERFORM pg_temp.assert_public_policy_fragments_m012(
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
  PERFORM pg_temp.assert_public_policy_fragments_m012(
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

  PERFORM pg_temp.assert_no_unexpected_function_overloads_m012(
    'activate_solo_plus_case_v1',
    'public.activate_solo_plus_case_v1(uuid,bigint,text,uuid,text)'
  );
END;
$$;

ALTER TABLE public.solo_plus_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solo_plus_case_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solo_plus_case_events ENABLE ROW LEVEL SECURITY;

SELECT pg_temp.repair_public_table_access_manifest_m012('solo_plus_cases', 'merchant_read_select');
SELECT pg_temp.repair_public_table_access_manifest_m012('solo_plus_case_requirements', 'merchant_read_select');
SELECT pg_temp.repair_public_table_access_manifest_m012('solo_plus_case_events', 'internal');

DROP POLICY IF EXISTS "merchant_read_solo_plus_cases" ON public.solo_plus_cases;
CREATE POLICY "merchant_read_solo_plus_cases"
  ON public.solo_plus_cases
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND merchant_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.merchants m
      WHERE m.id = public.solo_plus_cases.merchant_id
        AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "merchant_read_solo_plus_case_requirements" ON public.solo_plus_case_requirements;
CREATE POLICY "merchant_read_solo_plus_case_requirements"
  ON public.solo_plus_case_requirements
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1
      FROM public.solo_plus_cases c
      JOIN public.merchants m ON m.id = c.merchant_id
      WHERE c.id = public.solo_plus_case_requirements.case_id
        AND m.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.activate_solo_plus_case_v1(
  p_case_id uuid,
  p_expected_row_version bigint,
  p_request_idempotency_key text,
  p_activator_admin_id uuid,
  p_policy_version text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_case public.solo_plus_cases%ROWTYPE;
  v_merchant public.merchants%ROWTYPE;
  v_workspace public.workspaces%ROWTYPE;
  v_workspace_subscription public.workspace_subscriptions%ROWTYPE;
  v_existing_event public.solo_plus_case_events%ROWTYPE;
  v_inserted_event public.solo_plus_case_events%ROWTYPE;
  v_now timestamptz := now();
  v_policy_version text;
  v_requirement_count integer := 0;
  v_requirement_distinct_count integer := 0;
  v_requirement_codes text[] := ARRAY[]::TEXT[];
  v_all_requirements_accepted boolean := false;
  v_feature_enabled boolean := false;
  v_current_plan text := 'starter';
  v_workspace_display_name text := 'DeraLedger Workspace';
  v_previous_state jsonb := '{}'::jsonb;
  v_new_state jsonb := '{}'::jsonb;
BEGIN
  IF p_case_id IS NULL THEN
    RAISE EXCEPTION 'activate_solo_plus_case_v1 requires p_case_id';
  END IF;

  IF p_expected_row_version IS NULL OR p_expected_row_version < 0 THEN
    RAISE EXCEPTION 'activate_solo_plus_case_v1 requires non-negative p_expected_row_version';
  END IF;

  IF p_request_idempotency_key IS NULL OR btrim(p_request_idempotency_key) = '' THEN
    RAISE EXCEPTION 'activate_solo_plus_case_v1 requires non-empty p_request_idempotency_key';
  END IF;

  IF p_activator_admin_id IS NULL THEN
    RAISE EXCEPTION 'activate_solo_plus_case_v1 requires p_activator_admin_id';
  END IF;

  p_request_idempotency_key := btrim(p_request_idempotency_key);
  p_policy_version := NULLIF(btrim(COALESCE(p_policy_version, '')), '');

  SELECT *
  INTO v_case
  FROM public.solo_plus_cases
  WHERE id = p_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'not_found');
  END IF;

  IF v_case.activation_idempotency_key IS NOT NULL THEN
    IF v_case.activation_idempotency_key = p_request_idempotency_key THEN
      SELECT *
      INTO v_existing_event
      FROM public.solo_plus_case_events
      WHERE case_id = v_case.id
        AND event_type = 'case_activated'
        AND request_idempotency_key = p_request_idempotency_key
      ORDER BY created_at DESC, id DESC
      LIMIT 1;

      IF FOUND THEN
        SELECT *
        INTO v_merchant
        FROM public.merchants
        WHERE id = v_case.merchant_id
        FOR UPDATE;

        IF FOUND THEN
          SELECT *
          INTO v_workspace
          FROM public.workspaces
          WHERE merchant_id = v_merchant.id
          ORDER BY created_at DESC, id DESC
          LIMIT 1
          FOR UPDATE;

          IF FOUND THEN
            PERFORM 1
            FROM public.workspace_subscriptions
            WHERE merchant_id = v_merchant.id
              AND workspace_id = v_workspace.id
            FOR UPDATE;

            SELECT *
            INTO v_workspace_subscription
            FROM public.workspace_subscriptions
            WHERE merchant_id = v_merchant.id
              AND workspace_id = v_workspace.id
              AND plan_type = 'solo_plus'
            ORDER BY
              CASE WHEN subscription_status = 'active' THEN 0 ELSE 1 END,
              updated_at DESC,
              created_at DESC,
              id DESC
            LIMIT 1;
          END IF;
        END IF;

        RETURN jsonb_build_object(
          'kind', 'idempotent_replay',
          'case', to_jsonb(v_case),
          'event', to_jsonb(v_existing_event),
          'merchant', CASE WHEN v_merchant.id IS NULL THEN NULL ELSE to_jsonb(v_merchant) END,
          'workspace', CASE WHEN v_workspace.id IS NULL THEN NULL ELSE to_jsonb(v_workspace) END,
          'workspace_subscription', CASE WHEN v_workspace_subscription.id IS NULL THEN NULL ELSE to_jsonb(v_workspace_subscription) END
        );
      END IF;

      RETURN jsonb_build_object(
        'kind', 'state_conflict',
        'case', to_jsonb(v_case)
      );
    END IF;

    RETURN jsonb_build_object(
      'kind', 'idempotency_conflict',
      'case', to_jsonb(v_case)
    );
  END IF;

  IF v_case.row_version::bigint <> p_expected_row_version THEN
    RETURN jsonb_build_object(
      'kind', 'version_conflict',
      'case', to_jsonb(v_case)
    );
  END IF;

  IF v_case.case_status <> 'approved' THEN
    RETURN jsonb_build_object(
      'kind', 'state_conflict',
      'case', to_jsonb(v_case)
    );
  END IF;

  IF v_case.payment_status <> 'paid' THEN
    RETURN jsonb_build_object(
      'kind', 'prerequisite_conflict',
      'case', to_jsonb(v_case),
      'reason', 'payment_not_paid'
    );
  END IF;

  IF v_case.refund_status <> 'none' THEN
    RETURN jsonb_build_object(
      'kind', 'prerequisite_conflict',
      'case', to_jsonb(v_case),
      'reason', 'refund_status_not_none'
    );
  END IF;

  IF v_case.merchant_id IS NULL THEN
    RETURN jsonb_build_object(
      'kind', 'prerequisite_conflict',
      'case', to_jsonb(v_case),
      'reason', 'merchant_missing'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE id = p_activator_admin_id
  ) THEN
    RETURN jsonb_build_object(
      'kind', 'prerequisite_conflict',
      'case', to_jsonb(v_case),
      'reason', 'activator_not_found'
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.platform_settings
    WHERE key = 'solo_plus_kyc_enabled'
      AND lower(btrim(value)) IN ('1', 'true', 'yes', 'on')
    FOR SHARE
  )
  INTO v_feature_enabled;

  IF v_feature_enabled IS DISTINCT FROM TRUE THEN
    RETURN jsonb_build_object(
      'kind', 'feature_disabled',
      'case', to_jsonb(v_case)
    );
  END IF;

  PERFORM 1
  FROM public.solo_plus_case_requirements
  WHERE case_id = v_case.id
  FOR UPDATE;

  SELECT
    count(*)::integer,
    count(DISTINCT requirement_code)::integer,
    COALESCE(array_agg(requirement_code ORDER BY requirement_code), ARRAY[]::TEXT[]),
    COALESCE(bool_and(requirement_state IN ('passed', 'reused', 'waived')), false)
  INTO
    v_requirement_count,
    v_requirement_distinct_count,
    v_requirement_codes,
    v_all_requirements_accepted
  FROM public.solo_plus_case_requirements
  WHERE case_id = v_case.id;

  IF v_requirement_count <> 6 OR v_requirement_distinct_count <> 6 THEN
    RETURN jsonb_build_object(
      'kind', 'prerequisite_conflict',
      'case', to_jsonb(v_case),
      'reason', 'requirements_missing_or_duplicate'
    );
  END IF;

  IF v_requirement_codes <> ARRAY[
    'activity_profile',
    'bvn',
    'id_document',
    'proof_of_address',
    'selfie_liveness',
    'settlement_account'
  ]::TEXT[] THEN
    RETURN jsonb_build_object(
      'kind', 'prerequisite_conflict',
      'case', to_jsonb(v_case),
      'reason', 'requirements_set_invalid'
    );
  END IF;

  IF v_all_requirements_accepted IS DISTINCT FROM TRUE THEN
    RETURN jsonb_build_object(
      'kind', 'prerequisite_conflict',
      'case', to_jsonb(v_case),
      'reason', 'requirements_not_satisfied'
    );
  END IF;

  SELECT *
  INTO v_merchant
  FROM public.merchants
  WHERE id = v_case.merchant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'kind', 'prerequisite_conflict',
      'case', to_jsonb(v_case),
      'reason', 'merchant_not_found'
    );
  END IF;

  v_current_plan := lower(btrim(COALESCE(v_merchant.subscription_plan, v_merchant.merchant_tier, 'starter')));

  IF v_case.flow_origin = 'upgrade' THEN
    IF v_case.source_plan <> 'solo_lite' THEN
      RETURN jsonb_build_object(
        'kind', 'prerequisite_conflict',
        'case', to_jsonb(v_case),
        'reason', 'upgrade_source_plan_invalid'
      );
    END IF;

    IF v_current_plan NOT IN ('individual', 'solo_lite') THEN
      RETURN jsonb_build_object(
        'kind', 'prerequisite_conflict',
        'case', to_jsonb(v_case),
        'reason', 'merchant_not_eligible_for_upgrade'
      );
    END IF;
  ELSIF v_case.flow_origin = 'onboarding' THEN
    IF v_current_plan <> 'starter' THEN
      RETURN jsonb_build_object(
        'kind', 'prerequisite_conflict',
        'case', to_jsonb(v_case),
        'reason', 'merchant_not_eligible_for_onboarding_activation'
      );
    END IF;
  ELSE
    RETURN jsonb_build_object(
      'kind', 'prerequisite_conflict',
      'case', to_jsonb(v_case),
      'reason', 'unsupported_flow_origin'
    );
  END IF;

  SELECT *
  INTO v_workspace
  FROM public.workspaces
  WHERE merchant_id = v_merchant.id
  ORDER BY created_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;

  v_workspace_display_name := COALESCE(NULLIF(btrim(v_merchant.business_name), ''), 'DeraLedger Workspace');

  IF NOT FOUND THEN
    INSERT INTO public.workspaces (
      owner_user_id,
      merchant_id,
      workspace_type,
      display_name,
      plan_type,
      onboarding_status,
      setup_mode,
      live_features_enabled
    )
    VALUES (
      v_merchant.user_id,
      v_merchant.id,
      'personal',
      v_workspace_display_name,
      'solo_plus',
      'active',
      false,
      true
    )
    RETURNING *
    INTO v_workspace;
  END IF;

  PERFORM 1
  FROM public.workspace_subscriptions
  WHERE merchant_id = v_merchant.id
    AND (workspace_id = v_workspace.id OR workspace_id IS NULL)
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.workspace_subscriptions ws
    WHERE ws.merchant_id = v_merchant.id
      AND (ws.workspace_id = v_workspace.id OR ws.workspace_id IS NULL)
      AND ws.subscription_status = 'active'
      AND (
        (v_case.flow_origin = 'onboarding' AND ws.plan_type <> 'solo_plus')
        OR (
          v_case.flow_origin = 'upgrade'
          AND ws.plan_type NOT IN ('individual', 'solo_lite', 'solo_plus')
        )
      )
  ) THEN
    RETURN jsonb_build_object(
      'kind', 'prerequisite_conflict',
      'case', to_jsonb(v_case),
      'reason', 'conflicting_active_subscription'
    );
  END IF;

  v_previous_state := jsonb_build_object(
    'caseStatus', v_case.case_status,
    'activationIdempotencyKey', v_case.activation_idempotency_key,
    'merchantPlan', COALESCE(v_merchant.subscription_plan, v_merchant.merchant_tier),
    'merchantSetupMode', v_merchant.setup_mode,
    'merchantLiveFeaturesEnabled', v_merchant.live_features_enabled,
    'workspacePlan', v_workspace.plan_type,
    'workspaceSetupMode', v_workspace.setup_mode,
    'workspaceLiveFeaturesEnabled', v_workspace.live_features_enabled
  );

  IF v_case.flow_origin = 'upgrade' THEN
    UPDATE public.workspace_subscriptions
    SET subscription_status = 'cancelled',
        updated_at = v_now
    WHERE merchant_id = v_merchant.id
      AND workspace_id = v_workspace.id
      AND subscription_status = 'active'
      AND plan_type IN ('individual', 'solo_lite');
  END IF;

  SELECT *
  INTO v_workspace_subscription
  FROM public.workspace_subscriptions
  WHERE merchant_id = v_merchant.id
    AND (workspace_id = v_workspace.id OR workspace_id IS NULL)
    AND (
      (v_case.payment_reference IS NOT NULL AND payment_reference = v_case.payment_reference)
      OR plan_type = 'solo_plus'
    )
  ORDER BY
    CASE
      WHEN v_case.payment_reference IS NOT NULL AND payment_reference = v_case.payment_reference THEN 0
      WHEN subscription_status = 'paid_setup' THEN 1
      WHEN subscription_status = 'active' THEN 2
      ELSE 3
    END,
    updated_at DESC,
    created_at DESC,
    id DESC
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.workspace_subscriptions
    SET workspace_id = v_workspace.id,
        merchant_id = v_merchant.id,
        plan_type = 'solo_plus',
        subscription_status = 'active',
        payment_reference = COALESCE(v_case.payment_reference, payment_reference),
        amount_paid = COALESCE(amount_paid, v_case.expected_amount),
        period_start = COALESCE(period_start, v_now),
        updated_at = v_now
    WHERE id = v_workspace_subscription.id
    RETURNING *
    INTO v_workspace_subscription;
  ELSE
    INSERT INTO public.workspace_subscriptions (
      workspace_id,
      merchant_id,
      plan_type,
      subscription_status,
      payment_reference,
      amount_paid,
      period_start,
      period_end
    )
    VALUES (
      v_workspace.id,
      v_merchant.id,
      'solo_plus',
      'active',
      v_case.payment_reference,
      v_case.expected_amount,
      v_now,
      NULL
    )
    RETURNING *
    INTO v_workspace_subscription;
  END IF;

  UPDATE public.workspaces
  SET owner_user_id = COALESCE(v_workspace.owner_user_id, v_merchant.user_id),
      workspace_type = 'personal',
      display_name = COALESCE(NULLIF(btrim(v_workspace.display_name), ''), v_workspace_display_name),
      plan_type = 'solo_plus',
      onboarding_status = 'active',
      setup_mode = false,
      live_features_enabled = true,
      updated_at = v_now
  WHERE id = v_workspace.id
  RETURNING *
  INTO v_workspace;

  UPDATE public.merchants
  SET subscription_plan = 'solo_plus',
      merchant_tier = 'individual',
      monthly_collection_limit = 5000000,
      workspace_id = v_workspace.id,
      onboarding_status = 'active',
      setup_mode = false,
      live_features_enabled = true,
      verification_status = 'verified',
      live_features_activated_at = COALESCE(live_features_activated_at, v_now),
      updated_at = v_now
  WHERE id = v_merchant.id
  RETURNING *
  INTO v_merchant;

  UPDATE public.solo_plus_cases
  SET activation_idempotency_key = p_request_idempotency_key,
      row_version = row_version + 1,
      updated_at = v_now
  WHERE id = v_case.id
  RETURNING *
  INTO v_case;

  v_policy_version := COALESCE(p_policy_version, NULLIF(btrim(v_case.requirements_policy_version), ''), 'solo_plus_activation_v1');
  v_new_state := jsonb_build_object(
    'caseStatus', v_case.case_status,
    'activationIdempotencyKey', v_case.activation_idempotency_key,
    'merchantPlan', COALESCE(v_merchant.subscription_plan, v_merchant.merchant_tier),
    'merchantSetupMode', v_merchant.setup_mode,
    'merchantLiveFeaturesEnabled', v_merchant.live_features_enabled,
    'workspacePlan', v_workspace.plan_type,
    'workspaceSetupMode', v_workspace.setup_mode,
    'workspaceLiveFeaturesEnabled', v_workspace.live_features_enabled,
    'workspaceSubscriptionPlan', v_workspace_subscription.plan_type,
    'workspaceSubscriptionStatus', v_workspace_subscription.subscription_status
  );

  INSERT INTO public.solo_plus_case_events (
    case_id,
    event_type,
    previous_state,
    new_state,
    actor_type,
    actor_id,
    request_idempotency_key,
    reason,
    policy_version
  )
  VALUES (
    v_case.id,
    'case_activated',
    v_previous_state,
    v_new_state,
    'admin',
    p_activator_admin_id,
    p_request_idempotency_key,
    'Solo Plus activation completed.',
    v_policy_version
  )
  RETURNING *
  INTO v_inserted_event;

  RETURN jsonb_build_object(
    'kind', 'applied',
    'case', to_jsonb(v_case),
    'event', to_jsonb(v_inserted_event),
    'merchant', to_jsonb(v_merchant),
    'workspace', to_jsonb(v_workspace),
    'workspace_subscription', to_jsonb(v_workspace_subscription)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.activate_solo_plus_case_v1(uuid, bigint, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_solo_plus_case_v1(uuid, bigint, text, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.activate_solo_plus_case_v1(uuid, bigint, text, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.activate_solo_plus_case_v1(uuid, bigint, text, uuid, text) TO service_role;

DO $$
BEGIN
  PERFORM pg_temp.assert_no_unexpected_function_overloads_m012(
    'activate_solo_plus_case_v1',
    'public.activate_solo_plus_case_v1(uuid,bigint,text,uuid,text)'
  );

  PERFORM pg_temp.assert_public_table_rls_state_m012('solo_plus_cases', true, false);
  PERFORM pg_temp.assert_public_table_rls_state_m012('solo_plus_case_requirements', true, false);
  PERFORM pg_temp.assert_public_table_rls_state_m012('solo_plus_case_events', true, false);

  PERFORM pg_temp.assert_public_table_access_manifest_m012('solo_plus_cases', 'merchant_read_select');
  PERFORM pg_temp.assert_public_table_access_manifest_m012('solo_plus_case_requirements', 'merchant_read_select');
  PERFORM pg_temp.assert_public_table_access_manifest_m012('solo_plus_case_events', 'internal');

  PERFORM pg_temp.assert_public_only_expected_policies_m012(
    'solo_plus_cases',
    ARRAY['merchant_read_solo_plus_cases']
  );
  PERFORM pg_temp.assert_public_only_expected_policies_m012(
    'solo_plus_case_requirements',
    ARRAY['merchant_read_solo_plus_case_requirements']
  );
  PERFORM pg_temp.assert_public_only_expected_policies_m012(
    'solo_plus_case_events',
    ARRAY[]::TEXT[]
  );

  PERFORM pg_temp.assert_public_table_allowed_triggers_m012(
    'solo_plus_cases',
    ARRAY['trg_solo_plus_cases_updated_at']
  );
  PERFORM pg_temp.assert_public_table_allowed_triggers_m012(
    'solo_plus_case_requirements',
    ARRAY['trg_solo_plus_case_requirements_updated_at']
  );
  PERFORM pg_temp.assert_public_table_allowed_triggers_m012(
    'solo_plus_case_events',
    ARRAY[]::TEXT[]
  );

  PERFORM pg_temp.assert_public_policy_fragments_m012(
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
  PERFORM pg_temp.assert_public_policy_fragments_m012(
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

  PERFORM pg_temp.assert_public_function_search_path_m012(
    'activate_solo_plus_case_v1',
    'uuid, bigint, text, uuid, text',
    'search_path=public, pg_temp'
  );
  PERFORM pg_temp.assert_service_role_only_function_execute_m012(
    'activate_solo_plus_case_v1',
    'uuid, bigint, text, uuid, text'
  );
END;
$$;

COMMIT;
