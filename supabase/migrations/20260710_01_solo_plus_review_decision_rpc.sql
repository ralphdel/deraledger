BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_table_exists_m011(p_table_name TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_regclass(format('public.%I', p_table_name)) IS NULL THEN
    RAISE EXCEPTION 'Commit 9 prerequisite missing: public.% does not exist', p_table_name;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_column_exists_m011(
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
    RAISE EXCEPTION 'Commit 9 prerequisite missing: public.%.% does not exist', p_table_name, p_column_name;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_index_exists_m011(
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
    RAISE EXCEPTION 'Commit 9 prerequisite missing: public.% index % does not exist', p_table_name, p_index_name;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_function_signature_m011(
  p_function_name TEXT,
  p_type_args TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = p_function_name
      AND oidvectortypes(p.proargtypes) = p_type_args
  ) THEN
    RAISE EXCEPTION 'Commit 9 function verification failed: public.% (%) is missing',
      p_function_name,
      p_type_args;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_function_search_path_m011(
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
    RAISE EXCEPTION 'Commit 9 function verification failed: public.% (%) missing %',
      p_function_name,
      p_type_args,
      p_expected_setting;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_service_role_only_function_execute_m011(
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
    RAISE EXCEPTION 'Commit 9 function verification failed: public.% (%) missing',
      p_function_name,
      p_type_args;
  END IF;

  IF NOT has_function_privilege('service_role', v_function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Commit 9 function verification failed: public.% (%) must grant EXECUTE to service_role',
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
    RAISE EXCEPTION 'Commit 9 function verification failed: public.% (%) must not grant EXECUTE to PUBLIC',
      p_function_name,
      p_type_args;
  END IF;

  FOREACH v_denied_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF has_function_privilege(v_denied_role, v_function_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Commit 9 function verification failed: public.% (%) must not grant EXECUTE to %',
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
    RAISE EXCEPTION 'Commit 9 function verification failed: public.% (%) grants are not owner-aware service_role-only: raw=% explicit_non_owner=% owner=%',
      p_function_name,
      p_type_args,
      v_grantees,
      v_explicit_grantees,
      v_owner_name;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.normalize_catalog_sql_m011(p_sql TEXT)
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

CREATE OR REPLACE FUNCTION pg_temp.assert_public_table_rls_state_m011(
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
    RAISE EXCEPTION 'Commit 9 compatibility failure: schema=public object=% expected=table actual=missing',
      p_table_name;
  END IF;

  IF v_enabled IS DISTINCT FROM p_expected_enabled THEN
    RAISE EXCEPTION 'Commit 9 compatibility failure: schema=public object=% expected=rls_enabled:% actual=rls_enabled:%',
      p_table_name,
      CASE WHEN p_expected_enabled THEN 't' ELSE 'f' END,
      CASE WHEN v_enabled THEN 't' ELSE 'f' END;
  END IF;

  IF v_forced IS DISTINCT FROM p_expected_forced THEN
    RAISE EXCEPTION 'Commit 9 compatibility failure: schema=public object=% expected=rls_forced:% actual=rls_forced:%',
      p_table_name,
      CASE WHEN p_expected_forced THEN 't' ELSE 'f' END,
      CASE WHEN v_forced THEN 't' ELSE 'f' END;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_table_privileges_absent_m011(
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
      AND lower(grantee) = ANY (
        ARRAY(
          SELECT lower(value)
          FROM unnest(p_roles) AS value
        )
      )
      AND lower(privilege_type) = ANY (
        ARRAY(
          SELECT lower(value)
          FROM unnest(p_privileges) AS value
        )
      )
    ORDER BY grantee, privilege_type
  LOOP
    RAISE EXCEPTION 'Commit 9 compatibility failure: schema=public object=table % expected=no browser grant actual=%:%',
      p_table_name,
      v_grant.grantee,
      v_grant.privilege_type;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_table_privileges_present_m011(
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
        RAISE EXCEPTION 'Commit 9 compatibility failure: schema=public object=table % expected=%:% actual=missing',
          p_table_name,
          lower(v_role),
          lower(v_privilege);
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.repair_public_table_access_manifest_m011(
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
    RAISE EXCEPTION 'Commit 9 compatibility failure: schema=public object=table % expected=known access model actual=%',
      p_table_name,
      p_access_model;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_table_access_manifest_m011(
  p_table_name TEXT,
  p_access_model TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_temp.assert_public_table_privileges_absent_m011(
    p_table_name,
    ARRAY['public', 'anon'],
    ARRAY['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']
  );

  PERFORM pg_temp.assert_public_table_privileges_absent_m011(
    p_table_name,
    ARRAY['authenticated'],
    ARRAY['insert', 'update', 'delete', 'truncate', 'references', 'trigger']
  );

  IF p_access_model = 'merchant_read_select' THEN
    PERFORM pg_temp.assert_public_table_privileges_present_m011(
      p_table_name,
      ARRAY['authenticated'],
      ARRAY['select']
    );
  ELSIF p_access_model = 'internal' THEN
    PERFORM pg_temp.assert_public_table_privileges_absent_m011(
      p_table_name,
      ARRAY['authenticated'],
      ARRAY['select']
    );
  ELSE
    RAISE EXCEPTION 'Commit 9 compatibility failure: schema=public object=table % expected=known access model actual=%',
      p_table_name,
      p_access_model;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_table_allowed_triggers_m011(
  p_table_name TEXT,
  p_expected_triggers TEXT[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_actual TEXT[];
BEGIN
  SELECT COALESCE(array_agg(t.tgname ORDER BY t.tgname), ARRAY[]::TEXT[])
  INTO v_actual
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = p_table_name
    AND t.tgisinternal = false;

  IF v_actual <> p_expected_triggers THEN
    RAISE EXCEPTION 'Commit 9 compatibility failure: schema=public object=table % expected=triggers:% actual=%',
      p_table_name,
      p_expected_triggers,
      v_actual;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_only_expected_policies_m011(
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
    RAISE EXCEPTION 'Commit 9 compatibility failure: schema=public object=table % expected=policies:% actual=%',
      p_table_name,
      p_expected_policy_names,
      v_actual;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_policy_fragments_m011(
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
  v_roles TEXT[];
  v_normalized_qual TEXT;
BEGIN
  SELECT cmd, roles::TEXT[] AS roles, qual
  INTO v_policy
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = p_table_name
    AND policyname = p_policy_name;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commit 9 compatibility failure: schema=public object=policy %.% expected=present actual=missing',
      p_table_name,
      p_policy_name;
  END IF;

  v_roles := COALESCE(v_policy.roles, ARRAY[]::TEXT[]);
  IF lower(v_policy.cmd) <> lower(p_command) THEN
    RAISE EXCEPTION 'Commit 9 compatibility failure: schema=public object=policy %.% expected=cmd:% actual=%',
      p_table_name,
      p_policy_name,
      lower(p_command),
      lower(v_policy.cmd);
  END IF;

  IF v_roles <> p_expected_roles THEN
    RAISE EXCEPTION 'Commit 9 compatibility failure: schema=public object=policy %.% expected=roles:% actual=%',
      p_table_name,
      p_policy_name,
      p_expected_roles,
      v_roles;
  END IF;

  v_normalized_qual := pg_temp.normalize_catalog_sql_m011(v_policy.qual);
  FOREACH v_fragment IN ARRAY p_using_fragments
  LOOP
    IF position(pg_temp.normalize_catalog_sql_m011(v_fragment) IN v_normalized_qual) = 0 THEN
      RAISE EXCEPTION 'Commit 9 compatibility failure: schema=public object=policy %.% expected=using fragment:% actual=%',
        p_table_name,
        p_policy_name,
        pg_temp.normalize_catalog_sql_m011(v_fragment),
        v_normalized_qual;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_named_index_definition_m011(
  p_table_name TEXT,
  p_index_name TEXT,
  p_expected_indexdef TEXT,
  p_expected_predicate TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_indexdef TEXT;
  v_predicate TEXT;
BEGIN
  SELECT pg_get_indexdef(i.indexrelid), pg_get_expr(i.indpred, i.indrelid)
  INTO v_indexdef, v_predicate
  FROM pg_index i
  JOIN pg_class idx ON idx.oid = i.indexrelid
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = tbl.relnamespace
  WHERE n.nspname = 'public'
    AND tbl.relname = p_table_name
    AND idx.relname = p_index_name;

  IF v_indexdef IS NULL THEN
    RAISE EXCEPTION 'Commit 9 compatibility failure: schema=public object=index % expected=present actual=missing',
      p_index_name;
  END IF;

  IF pg_temp.normalize_catalog_sql_m011(v_indexdef) <> pg_temp.normalize_catalog_sql_m011(p_expected_indexdef) THEN
    RAISE EXCEPTION 'Commit 9 compatibility failure: schema=public object=% expected=indexdef:% actual=%',
      p_index_name,
      pg_temp.normalize_catalog_sql_m011(p_expected_indexdef),
      pg_temp.normalize_catalog_sql_m011(v_indexdef);
  END IF;

  IF p_expected_predicate IS NULL THEN
    IF v_predicate IS NOT NULL THEN
      RAISE EXCEPTION 'Commit 9 compatibility failure: schema=public object=% expected=predicate:none actual=%',
        p_index_name,
        pg_temp.normalize_catalog_sql_m011(v_predicate);
    END IF;
  ELSIF pg_temp.normalize_catalog_sql_m011(COALESCE(v_predicate, '')) <> pg_temp.normalize_catalog_sql_m011(p_expected_predicate) THEN
    RAISE EXCEPTION 'Commit 9 compatibility failure: schema=public object=% expected=predicate:% actual=%',
      p_index_name,
      pg_temp.normalize_catalog_sql_m011(p_expected_predicate),
      pg_temp.normalize_catalog_sql_m011(COALESCE(v_predicate, ''));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_no_review_rpc_overloads_m011()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_actual TEXT[];
BEGIN
  SELECT COALESCE(array_agg(oidvectortypes(p.proargtypes) ORDER BY oidvectortypes(p.proargtypes)), ARRAY[]::TEXT[])
  INTO v_actual
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'review_solo_plus_case_v1';

  IF array_length(v_actual, 1) IS NOT NULL
     AND v_actual <> ARRAY['uuid, bigint, text, text, uuid, text, text'] THEN
    RAISE EXCEPTION 'Commit 9 prerequisite unsafe drift: unexpected review_solo_plus_case_v1 overloads %',
      v_actual;
  END IF;
END;
$$;

DO $$
BEGIN
  PERFORM pg_temp.assert_public_table_exists_m011('solo_plus_cases');
  PERFORM pg_temp.assert_public_table_exists_m011('solo_plus_case_requirements');
  PERFORM pg_temp.assert_public_table_exists_m011('solo_plus_case_events');

  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_cases', 'id');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_cases', 'case_status');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_cases', 'payment_status');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_cases', 'refund_status');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_cases', 'row_version');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_cases', 'rejection_reason');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_cases', 'approved_at');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_cases', 'approved_by_admin_id');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_cases', 'rejected_at');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_cases', 'rejected_by_admin_id');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_cases', 'reopened_at');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_cases', 'reopened_by_admin_id');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_cases', 'refund_idempotency_key');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_cases', 'requirements_policy_version');

  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_case_requirements', 'case_id');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_case_requirements', 'requirement_code');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_case_requirements', 'requirement_state');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_case_requirements', 'policy_rule_applied');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_case_requirements', 'metadata');

  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_case_events', 'case_id');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_case_events', 'event_type');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_case_events', 'previous_state');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_case_events', 'new_state');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_case_events', 'actor_type');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_case_events', 'actor_id');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_case_events', 'request_idempotency_key');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_case_events', 'reason');
  PERFORM pg_temp.assert_public_column_exists_m011('solo_plus_case_events', 'policy_version');

  PERFORM pg_temp.assert_public_named_index_definition_m011(
    'solo_plus_case_events',
    'idx_solo_plus_case_events_request_idempotency',
    'CREATE UNIQUE INDEX idx_solo_plus_case_events_request_idempotency ON public.solo_plus_case_events USING btree (case_id, event_type, request_idempotency_key) WHERE (request_idempotency_key IS NOT NULL)',
    'request_idempotency_key IS NOT NULL'
  );

  PERFORM pg_temp.assert_no_review_rpc_overloads_m011();
  PERFORM pg_temp.assert_public_only_expected_policies_m011(
    'solo_plus_cases',
    ARRAY['merchant_read_solo_plus_cases']
  );
  PERFORM pg_temp.assert_public_only_expected_policies_m011(
    'solo_plus_case_requirements',
    ARRAY['merchant_read_solo_plus_case_requirements']
  );
  PERFORM pg_temp.assert_public_only_expected_policies_m011(
    'solo_plus_case_events',
    ARRAY[]::TEXT[]
  );

  PERFORM pg_temp.assert_public_table_allowed_triggers_m011(
    'solo_plus_cases',
    ARRAY['trg_solo_plus_cases_updated_at']
  );
  PERFORM pg_temp.assert_public_table_allowed_triggers_m011(
    'solo_plus_case_requirements',
    ARRAY['trg_solo_plus_case_requirements_updated_at']
  );
  PERFORM pg_temp.assert_public_table_allowed_triggers_m011(
    'solo_plus_case_events',
    ARRAY[]::TEXT[]
  );
END
$$;

ALTER TABLE public.solo_plus_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solo_plus_case_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solo_plus_case_events ENABLE ROW LEVEL SECURITY;

SELECT pg_temp.repair_public_table_access_manifest_m011('solo_plus_cases', 'merchant_read_select');
SELECT pg_temp.repair_public_table_access_manifest_m011('solo_plus_case_requirements', 'merchant_read_select');
SELECT pg_temp.repair_public_table_access_manifest_m011('solo_plus_case_events', 'internal');

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

CREATE OR REPLACE FUNCTION public.review_solo_plus_case_v1(
  p_case_id UUID,
  p_expected_row_version BIGINT,
  p_request_idempotency_key TEXT,
  p_decision TEXT,
  p_reviewer_admin_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_policy_version TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_case public.solo_plus_cases%ROWTYPE;
  v_previous_case public.solo_plus_cases%ROWTYPE;
  v_existing_event public.solo_plus_case_events%ROWTYPE;
  v_inserted_event public.solo_plus_case_events%ROWTYPE;
  v_now TIMESTAMPTZ := now();
  v_decision TEXT;
  v_reason TEXT;
  v_effective_policy_version TEXT;
  v_event_type TEXT;
  v_target_status TEXT;
  v_target_refund_status TEXT;
  v_reason_required BOOLEAN := false;
BEGIN
  IF p_case_id IS NULL THEN
    RAISE EXCEPTION 'Solo Plus review case_id is required';
  END IF;

  IF p_expected_row_version IS NULL OR p_expected_row_version < 0 THEN
    RAISE EXCEPTION 'Solo Plus review expected_row_version must be a non-negative integer';
  END IF;

  IF p_request_idempotency_key IS NULL OR btrim(p_request_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Solo Plus review request idempotency key is required';
  END IF;

  IF p_reviewer_admin_id IS NULL THEN
    RAISE EXCEPTION 'Solo Plus reviewer_admin_id is required';
  END IF;

  v_decision := lower(btrim(COALESCE(p_decision, '')));
  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');

  CASE v_decision
    WHEN 'request_more_information' THEN
      v_event_type := 'case_review_requested_more_information';
      v_target_status := 'verification_pending';
      v_reason_required := true;
    WHEN 'approve' THEN
      v_event_type := 'case_approved';
      v_target_status := 'approved';
    WHEN 'reject' THEN
      v_event_type := 'case_rejected';
      v_target_status := 'rejected';
      v_reason_required := true;
    WHEN 'reopen' THEN
      v_event_type := 'case_reopened';
      v_target_status := 'verification_pending';
    ELSE
      RAISE EXCEPTION 'Solo Plus review decision must be one of request_more_information, approve, reject, or reopen';
  END CASE;

  IF v_reason_required AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Solo Plus review reason is required for %', v_decision;
  END IF;

  SELECT *
  INTO v_case
  FROM public.solo_plus_cases
  WHERE id = p_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'not_found');
  END IF;

  v_effective_policy_version := COALESCE(NULLIF(btrim(COALESCE(p_policy_version, '')), ''), v_case.requirements_policy_version);

  SELECT *
  INTO v_existing_event
  FROM public.solo_plus_case_events
  WHERE case_id = p_case_id
    AND request_idempotency_key = p_request_idempotency_key
  ORDER BY created_at ASC, id ASC
  LIMIT 1;

  IF FOUND THEN
    IF v_existing_event.event_type = v_event_type THEN
      RETURN jsonb_build_object(
        'kind', 'idempotent_replay',
        'case', to_jsonb(v_case),
        'event', to_jsonb(v_existing_event)
      );
    END IF;

    RETURN jsonb_build_object(
      'kind', 'idempotency_conflict',
      'case', to_jsonb(v_case)
    );
  END IF;

  IF v_case.row_version::BIGINT <> p_expected_row_version THEN
    RETURN jsonb_build_object(
      'kind', 'version_conflict',
      'case', to_jsonb(v_case)
    );
  END IF;

  IF (v_decision IN ('request_more_information', 'approve', 'reject') AND v_case.case_status <> 'manual_review')
     OR (v_decision = 'reopen' AND v_case.case_status <> 'rejected') THEN
    RETURN jsonb_build_object(
      'kind', 'state_conflict',
      'case', to_jsonb(v_case)
    );
  END IF;

  v_target_refund_status := CASE
    WHEN v_decision = 'request_more_information' THEN v_case.refund_status
    WHEN v_decision = 'approve' THEN 'none'
    WHEN v_decision = 'reject' THEN CASE WHEN v_case.payment_status = 'paid' THEN 'review_required' ELSE 'none' END
    WHEN v_decision = 'reopen' THEN 'none'
    ELSE v_case.refund_status
  END;

  v_previous_case := v_case;

  UPDATE public.solo_plus_cases
  SET
    case_status = v_target_status,
    refund_status = v_target_refund_status,
    approved_at = CASE WHEN v_decision = 'approve' THEN v_now ELSE approved_at END,
    approved_by_admin_id = CASE WHEN v_decision = 'approve' THEN p_reviewer_admin_id ELSE approved_by_admin_id END,
    rejected_at = CASE
      WHEN v_decision = 'reject' THEN v_now
      WHEN v_decision = 'reopen' THEN NULL
      ELSE rejected_at
    END,
    rejected_by_admin_id = CASE
      WHEN v_decision = 'reject' THEN p_reviewer_admin_id
      WHEN v_decision = 'reopen' THEN NULL
      ELSE rejected_by_admin_id
    END,
    reopened_at = CASE WHEN v_decision = 'reopen' THEN v_now ELSE reopened_at END,
    reopened_by_admin_id = CASE WHEN v_decision = 'reopen' THEN p_reviewer_admin_id ELSE reopened_by_admin_id END,
    rejection_reason = CASE
      WHEN v_decision = 'reject' THEN v_reason
      WHEN v_decision = 'reopen' THEN NULL
      ELSE rejection_reason
    END,
    refund_idempotency_key = CASE WHEN v_decision = 'reopen' THEN NULL ELSE refund_idempotency_key END,
    row_version = row_version + 1,
    updated_at = v_now
  WHERE id = p_case_id
  RETURNING * INTO v_case;

  INSERT INTO public.solo_plus_case_events (
    case_id,
    event_type,
    previous_state,
    new_state,
    actor_type,
    actor_id,
    request_idempotency_key,
    reason,
    policy_version,
    created_at
  )
  VALUES (
    p_case_id,
    v_event_type,
    jsonb_build_object(
      'caseStatus', CASE
        WHEN v_decision = 'request_more_information' THEN 'manual_review'
        WHEN v_decision = 'approve' THEN 'manual_review'
        WHEN v_decision = 'reject' THEN 'manual_review'
        WHEN v_decision = 'reopen' THEN 'rejected'
      END,
      'refundStatus', v_previous_case.refund_status,
      'approvedAt', v_previous_case.approved_at,
      'approvedByAdminId', v_previous_case.approved_by_admin_id,
      'rejectedAt', v_previous_case.rejected_at,
      'rejectedByAdminId', v_previous_case.rejected_by_admin_id,
      'reopenedAt', v_previous_case.reopened_at,
      'reopenedByAdminId', v_previous_case.reopened_by_admin_id,
      'rejectionReason', v_previous_case.rejection_reason,
      'rowVersion', p_expected_row_version
    ),
    jsonb_build_object(
      'caseStatus', v_case.case_status,
      'refundStatus', v_case.refund_status,
      'approvedAt', v_case.approved_at,
      'approvedByAdminId', v_case.approved_by_admin_id,
      'rejectedAt', v_case.rejected_at,
      'rejectedByAdminId', v_case.rejected_by_admin_id,
      'reopenedAt', v_case.reopened_at,
      'reopenedByAdminId', v_case.reopened_by_admin_id,
      'rejectionReason', v_case.rejection_reason,
      'rowVersion', v_case.row_version
    ),
    'admin',
    p_reviewer_admin_id,
    p_request_idempotency_key,
    v_reason,
    v_effective_policy_version,
    v_now
  )
  RETURNING * INTO v_inserted_event;

  RETURN jsonb_build_object(
    'kind', 'updated',
    'case', to_jsonb(v_case),
    'event', to_jsonb(v_inserted_event)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.review_solo_plus_case_v1(UUID, BIGINT, TEXT, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_solo_plus_case_v1(UUID, BIGINT, TEXT, TEXT, UUID, TEXT, TEXT) TO service_role;

DO $$
BEGIN
  PERFORM pg_temp.assert_public_table_rls_state_m011('solo_plus_cases', true, false);
  PERFORM pg_temp.assert_public_table_rls_state_m011('solo_plus_case_requirements', true, false);
  PERFORM pg_temp.assert_public_table_rls_state_m011('solo_plus_case_events', true, false);

  PERFORM pg_temp.assert_public_table_access_manifest_m011('solo_plus_cases', 'merchant_read_select');
  PERFORM pg_temp.assert_public_table_access_manifest_m011('solo_plus_case_requirements', 'merchant_read_select');
  PERFORM pg_temp.assert_public_table_access_manifest_m011('solo_plus_case_events', 'internal');

  PERFORM pg_temp.assert_public_only_expected_policies_m011(
    'solo_plus_cases',
    ARRAY['merchant_read_solo_plus_cases']
  );
  PERFORM pg_temp.assert_public_only_expected_policies_m011(
    'solo_plus_case_requirements',
    ARRAY['merchant_read_solo_plus_case_requirements']
  );
  PERFORM pg_temp.assert_public_only_expected_policies_m011(
    'solo_plus_case_events',
    ARRAY[]::TEXT[]
  );

  PERFORM pg_temp.assert_public_policy_fragments_m011(
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
  PERFORM pg_temp.assert_public_policy_fragments_m011(
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

  PERFORM pg_temp.assert_public_table_allowed_triggers_m011(
    'solo_plus_cases',
    ARRAY['trg_solo_plus_cases_updated_at']
  );
  PERFORM pg_temp.assert_public_table_allowed_triggers_m011(
    'solo_plus_case_requirements',
    ARRAY['trg_solo_plus_case_requirements_updated_at']
  );
  PERFORM pg_temp.assert_public_table_allowed_triggers_m011(
    'solo_plus_case_events',
    ARRAY[]::TEXT[]
  );

  PERFORM pg_temp.assert_no_review_rpc_overloads_m011();
  PERFORM pg_temp.assert_public_function_signature_m011(
    'review_solo_plus_case_v1',
    'uuid, bigint, text, text, uuid, text, text'
  );
  PERFORM pg_temp.assert_public_function_search_path_m011(
    'review_solo_plus_case_v1',
    'uuid, bigint, text, text, uuid, text, text',
    'search_path=public, pg_temp'
  );
  PERFORM pg_temp.assert_service_role_only_function_execute_m011(
    'review_solo_plus_case_v1',
    'uuid, bigint, text, text, uuid, text, text'
  );
END
$$;

COMMIT;
