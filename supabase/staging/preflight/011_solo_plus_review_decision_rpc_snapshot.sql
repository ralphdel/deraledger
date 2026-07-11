BEGIN READ ONLY;

SELECT
  'PASS' AS status,
  'database_identity' AS check_name,
  format(
    'db=%s user=%s version=%s search_path=%s',
    current_database(),
    current_user,
    regexp_replace(version(), '\s+', ' ', 'g'),
    current_setting('search_path')
  ) AS details;

WITH
  expected_cases_columns AS (
    SELECT *
    FROM (
      VALUES
        ('id', 'uuid', 'NO', 'gen_random_uuid()'),
        ('merchant_id', 'uuid', 'YES', NULL),
        ('onboarding_session_id', 'uuid', 'YES', NULL),
        ('flow_origin', 'text', 'NO', NULL),
        ('source_plan', 'text', 'YES', NULL),
        ('target_plan', 'text', 'NO', '''solo_plus''::text'),
        ('case_status', 'text', 'NO', '''draft''::text'),
        ('payment_status', 'text', 'NO', '''pending''::text'),
        ('refund_status', 'text', 'NO', '''none''::text'),
        ('payment_record_id', 'uuid', 'YES', NULL),
        ('payment_provider', 'text', 'YES', NULL),
        ('payment_reference', 'text', 'YES', NULL),
        ('expected_amount', 'numeric', 'NO', NULL),
        ('payment_currency', 'varchar', 'NO', '''ngn''::character varying'),
        ('requirements_policy_version', 'text', 'NO', NULL),
        ('requirements_snapshot', 'jsonb', 'NO', '''{}''::jsonb'),
        ('active_plan_snapshot', 'text', 'YES', NULL),
        ('rejection_reason', 'text', 'YES', NULL),
        ('approved_at', 'timestamptz', 'YES', NULL),
        ('approved_by_admin_id', 'uuid', 'YES', NULL),
        ('rejected_at', 'timestamptz', 'YES', NULL),
        ('rejected_by_admin_id', 'uuid', 'YES', NULL),
        ('reopened_at', 'timestamptz', 'YES', NULL),
        ('reopened_by_admin_id', 'uuid', 'YES', NULL),
        ('idempotency_key', 'text', 'NO', NULL),
        ('activation_idempotency_key', 'text', 'YES', NULL),
        ('refund_idempotency_key', 'text', 'YES', NULL),
        ('row_version', 'int4', 'NO', '0'),
        ('audit_metadata', 'jsonb', 'NO', '''{}''::jsonb'),
        ('created_at', 'timestamptz', 'NO', 'now()'),
        ('updated_at', 'timestamptz', 'NO', 'now()')
    ) AS t(column_name, expected_type, expected_nullable, expected_default)
  ),
  actual_cases_columns AS (
    SELECT
      c.column_name,
      c.udt_name AS actual_type,
      c.is_nullable AS actual_nullable,
      NULLIF(
        lower(
          regexp_replace(
            COALESCE(pg_get_expr(ad.adbin, ad.adrelid), ''),
            '\s+',
            ' ',
            'g'
          )
        ),
        ''
      ) AS actual_default
    FROM information_schema.columns c
    JOIN pg_class cls
      ON cls.relname = c.table_name
    JOIN pg_namespace ns
      ON ns.oid = cls.relnamespace
     AND ns.nspname = c.table_schema
    LEFT JOIN pg_attribute attr
      ON attr.attrelid = cls.oid
     AND attr.attname = c.column_name
     AND attr.attnum > 0
     AND NOT attr.attisdropped
    LEFT JOIN pg_attrdef ad
      ON ad.adrelid = cls.oid
     AND ad.adnum = attr.attnum
    WHERE c.table_schema = 'public'
      AND c.table_name = 'solo_plus_cases'
  ),
  cases_column_diffs AS (
    SELECT
      e.column_name,
      e.expected_type,
      a.actual_type,
      e.expected_nullable,
      a.actual_nullable,
      e.expected_default,
      a.actual_default,
      a.column_name IS NULL AS is_missing,
      a.column_name IS NOT NULL AND a.actual_type <> e.expected_type AS type_mismatch,
      a.column_name IS NOT NULL AND a.actual_nullable <> e.expected_nullable AS nullability_mismatch,
      a.column_name IS NOT NULL
        AND COALESCE(a.actual_default, '<none>') <> COALESCE(e.expected_default, '<none>') AS default_mismatch
    FROM expected_cases_columns e
    LEFT JOIN actual_cases_columns a
      ON a.column_name = e.column_name
  ),
  cases_column_summary AS (
    SELECT
      NOT EXISTS (
        SELECT 1
        FROM cases_column_diffs
        WHERE is_missing
           OR type_mismatch
           OR nullability_mismatch
           OR default_mismatch
      ) AS columns_ok,
      format(
        'classification=UNSAFE_SCHEMA_DRIFT; missing=[%s]; incompatible=[%s]; nullability=[%s]; defaults=[%s]',
        COALESCE((
          SELECT string_agg(column_name, ',' ORDER BY column_name)
          FROM cases_column_diffs
          WHERE is_missing
        ), ''),
        COALESCE((
          SELECT string_agg(
            format('%s:%s/%s', column_name, expected_type, actual_type),
            ',' ORDER BY column_name
          )
          FROM cases_column_diffs
          WHERE type_mismatch
        ), ''),
        COALESCE((
          SELECT string_agg(
            format('%s:%s/%s', column_name, expected_nullable, actual_nullable),
            ',' ORDER BY column_name
          )
          FROM cases_column_diffs
          WHERE nullability_mismatch
        ), ''),
        COALESCE((
          SELECT string_agg(
            format(
              '%s:%s/%s',
              column_name,
              COALESCE(expected_default, '<none>'),
              COALESCE(actual_default, '<none>')
            ),
            ',' ORDER BY column_name
          )
          FROM cases_column_diffs
          WHERE default_mismatch
        ), '')
      ) AS diff_details
  ),
  expected_table_grants AS (
    SELECT *
    FROM (
      VALUES
        ('solo_plus_cases', 'PUBLIC', NULL),
        ('solo_plus_cases', 'anon', NULL),
        ('solo_plus_cases', 'authenticated', 'SELECT'),
        ('solo_plus_case_requirements', 'PUBLIC', NULL),
        ('solo_plus_case_requirements', 'anon', NULL),
        ('solo_plus_case_requirements', 'authenticated', 'SELECT'),
        ('solo_plus_case_events', 'PUBLIC', NULL),
        ('solo_plus_case_events', 'anon', NULL),
        ('solo_plus_case_events', 'authenticated', NULL)
    ) AS t(table_name, grantee, privilege_type)
  ),
  expected_grant_arrays AS (
    SELECT
      table_name,
      grantee,
      COALESCE(
        array_agg(privilege_type::text ORDER BY privilege_type::text)
          FILTER (WHERE privilege_type IS NOT NULL),
        ARRAY[]::text[]
      ) AS expected_privileges
    FROM expected_table_grants
    GROUP BY table_name, grantee
  ),
  actual_grant_arrays AS (
    SELECT
      table_name,
      grantee,
      COALESCE(array_agg(privilege_type::text ORDER BY privilege_type::text), ARRAY[]::text[]) AS actual_privileges
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN ('solo_plus_cases', 'solo_plus_case_requirements', 'solo_plus_case_events')
      AND grantee IN ('PUBLIC', 'anon', 'authenticated')
    GROUP BY table_name, grantee
  ),
  grant_arrays AS (
    SELECT
      e.table_name,
      e.grantee,
      e.expected_privileges,
      COALESCE(a.actual_privileges, ARRAY[]::text[]) AS actual_privileges
    FROM expected_grant_arrays e
    LEFT JOIN actual_grant_arrays a
      ON a.table_name = e.table_name
     AND a.grantee = e.grantee
  ),
  grant_diffs AS (
    SELECT
      table_name,
      grantee,
      expected_privileges,
      actual_privileges,
      COALESCE((
        SELECT array_agg(privilege ORDER BY privilege)
        FROM (
          SELECT privilege
          FROM unnest(actual_privileges) AS privilege
          EXCEPT
          SELECT privilege
          FROM unnest(expected_privileges) AS privilege
        ) unexpected
      ), ARRAY[]::text[]) AS unexpected_privileges,
      COALESCE((
        SELECT array_agg(privilege ORDER BY privilege)
        FROM (
          SELECT privilege
          FROM unnest(expected_privileges) AS privilege
          EXCEPT
          SELECT privilege
          FROM unnest(actual_privileges) AS privilege
        ) missing
      ), ARRAY[]::text[]) AS missing_privileges
    FROM grant_arrays
  ),
  cases_grants_summary AS (
    SELECT
      bool_and(cardinality(unexpected_privileges) = 0 AND cardinality(missing_privileges) = 0) AS grants_ok,
      format(
        'classification=SAFE_REPAIRABLE_DRIFT; unexpected_public=[%s]; unexpected_anon=[%s]; unexpected_authenticated=[%s]; missing_authenticated=[%s]',
        COALESCE((SELECT array_to_string(unexpected_privileges, ',') FROM grant_diffs WHERE table_name = 'solo_plus_cases' AND grantee = 'PUBLIC'), ''),
        COALESCE((SELECT array_to_string(unexpected_privileges, ',') FROM grant_diffs WHERE table_name = 'solo_plus_cases' AND grantee = 'anon'), ''),
        COALESCE((SELECT array_to_string(unexpected_privileges, ',') FROM grant_diffs WHERE table_name = 'solo_plus_cases' AND grantee = 'authenticated'), ''),
        COALESCE((SELECT array_to_string(missing_privileges, ',') FROM grant_diffs WHERE table_name = 'solo_plus_cases' AND grantee = 'authenticated'), '')
      ) AS diff_details
    FROM grant_diffs
    WHERE table_name = 'solo_plus_cases'
  ),
  requirements_grants_summary AS (
    SELECT
      bool_and(cardinality(unexpected_privileges) = 0 AND cardinality(missing_privileges) = 0) AS grants_ok,
      format(
        'classification=SAFE_REPAIRABLE_DRIFT; unexpected_public=[%s]; unexpected_anon=[%s]; unexpected_authenticated=[%s]; missing_authenticated=[%s]',
        COALESCE((SELECT array_to_string(unexpected_privileges, ',') FROM grant_diffs WHERE table_name = 'solo_plus_case_requirements' AND grantee = 'PUBLIC'), ''),
        COALESCE((SELECT array_to_string(unexpected_privileges, ',') FROM grant_diffs WHERE table_name = 'solo_plus_case_requirements' AND grantee = 'anon'), ''),
        COALESCE((SELECT array_to_string(unexpected_privileges, ',') FROM grant_diffs WHERE table_name = 'solo_plus_case_requirements' AND grantee = 'authenticated'), ''),
        COALESCE((SELECT array_to_string(missing_privileges, ',') FROM grant_diffs WHERE table_name = 'solo_plus_case_requirements' AND grantee = 'authenticated'), '')
      ) AS diff_details
    FROM grant_diffs
    WHERE table_name = 'solo_plus_case_requirements'
  ),
  events_grants_summary AS (
    SELECT
      bool_and(cardinality(unexpected_privileges) = 0 AND cardinality(missing_privileges) = 0) AS grants_ok,
      format(
        'classification=SAFE_REPAIRABLE_DRIFT; unexpected_public=[%s]; unexpected_anon=[%s]; unexpected_authenticated=[%s]; missing_authenticated=[%s]',
        COALESCE((SELECT array_to_string(unexpected_privileges, ',') FROM grant_diffs WHERE table_name = 'solo_plus_case_events' AND grantee = 'PUBLIC'), ''),
        COALESCE((SELECT array_to_string(unexpected_privileges, ',') FROM grant_diffs WHERE table_name = 'solo_plus_case_events' AND grantee = 'anon'), ''),
        COALESCE((SELECT array_to_string(unexpected_privileges, ',') FROM grant_diffs WHERE table_name = 'solo_plus_case_events' AND grantee = 'authenticated'), ''),
        COALESCE((SELECT array_to_string(missing_privileges, ',') FROM grant_diffs WHERE table_name = 'solo_plus_case_events' AND grantee = 'authenticated'), '')
      ) AS diff_details
    FROM grant_diffs
    WHERE table_name = 'solo_plus_case_events'
  ),
  browser_default_acls AS (
    SELECT
      coalesce(n.nspname, 'public') AS schema_name,
      coalesce(r.rolname, current_user)::text AS owner_name,
      d.defaclobjtype::text AS object_type,
      coalesce(grantee.rolname, 'PUBLIC')::text AS grantee_name,
      acl.privilege_type::text AS privilege_type
    FROM pg_default_acl d
    LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
    LEFT JOIN pg_roles r ON r.oid = d.defaclrole
    JOIN LATERAL aclexplode(d.defaclacl) acl ON TRUE
    LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
    WHERE coalesce(n.nspname, 'public') = 'public'
      AND coalesce(grantee.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated')
      AND d.defaclobjtype IN ('r', 'S', 'f')
  ),
  cases_table AS (
    SELECT
      to_regclass('public.solo_plus_cases') IS NOT NULL AS exists_ok,
      (SELECT columns_ok FROM cases_column_summary) AS columns_ok,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'solo_plus_cases'
          AND column_name = 'case_status'
          AND column_default LIKE '%draft%'
      )
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'solo_plus_cases'
          AND column_name = 'payment_status'
          AND column_default LIKE '%pending%'
      )
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'solo_plus_cases'
          AND column_name = 'refund_status'
          AND column_default LIKE '%none%'
      )
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'solo_plus_cases'
          AND column_name = 'row_version'
          AND column_default = '0'
      ) AS defaults_ok,
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.solo_plus_cases'::regclass
          AND conname = 'solo_plus_cases_rejected_consistency_chk'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.solo_plus_cases'::regclass
          AND conname = 'solo_plus_cases_paid_terminal_refund_chk'
      ) AS constraints_ok,
      EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'solo_plus_cases'
          AND c.relrowsecurity = true
          AND c.relforcerowsecurity = false
      ) AS rls_ok,
      (
        SELECT COALESCE(array_agg(policyname::text ORDER BY policyname::text), ARRAY[]::text[])
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'solo_plus_cases'
      ) = ARRAY['merchant_read_solo_plus_cases']::text[] AS policies_ok,
      (SELECT grants_ok FROM cases_grants_summary) AS grants_ok,
      (
        SELECT COALESCE(array_agg(tgname::text ORDER BY tgname::text), ARRAY[]::text[])
        FROM pg_trigger
        WHERE tgrelid = 'public.solo_plus_cases'::regclass
          AND NOT tgisinternal
      ) = ARRAY['trg_solo_plus_cases_updated_at']::text[] AS triggers_ok
  ),
  requirements_table AS (
    SELECT
      to_regclass('public.solo_plus_case_requirements') IS NOT NULL AS exists_ok,
      (
        SELECT count(*) = 10
        FROM (
          VALUES
            ('case_id', 'uuid'),
            ('requirement_code', 'text'),
            ('requirement_state', 'text'),
            ('verification_log_id', 'uuid'),
            ('evidence_source_type', 'text'),
            ('evidence_source_id', 'uuid'),
            ('evidence_reference', 'text'),
            ('policy_rule_applied', 'text'),
            ('metadata', 'jsonb'),
            ('reviewed_by_admin_id', 'uuid')
        ) AS expected(column_name, data_type)
        JOIN information_schema.columns c
          ON c.table_schema = 'public'
         AND c.table_name = 'solo_plus_case_requirements'
         AND c.column_name = expected.column_name
         AND c.udt_name = expected.data_type
      ) AS columns_ok,
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.solo_plus_case_requirements'::regclass
          AND conname = 'solo_plus_case_requirements_unique_case_code'
      ) AS constraints_ok,
      EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'solo_plus_case_requirements'
          AND c.relrowsecurity = true
          AND c.relforcerowsecurity = false
      ) AS rls_ok,
      (
        SELECT COALESCE(array_agg(policyname::text ORDER BY policyname::text), ARRAY[]::text[])
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'solo_plus_case_requirements'
      ) = ARRAY['merchant_read_solo_plus_case_requirements']::text[] AS policies_ok,
      (SELECT grants_ok FROM requirements_grants_summary) AS grants_ok,
      (
        SELECT COALESCE(array_agg(tgname::text ORDER BY tgname::text), ARRAY[]::text[])
        FROM pg_trigger
        WHERE tgrelid = 'public.solo_plus_case_requirements'::regclass
          AND NOT tgisinternal
      ) = ARRAY['trg_solo_plus_case_requirements_updated_at']::text[] AS triggers_ok
  ),
  events_table AS (
    SELECT
      to_regclass('public.solo_plus_case_events') IS NOT NULL AS exists_ok,
      (
        SELECT count(*) = 8
        FROM (
          VALUES
            ('case_id', 'uuid'),
            ('event_type', 'text'),
            ('previous_state', 'jsonb'),
            ('new_state', 'jsonb'),
            ('actor_type', 'text'),
            ('actor_id', 'uuid'),
            ('request_idempotency_key', 'text'),
            ('policy_version', 'text')
        ) AS expected(column_name, data_type)
        JOIN information_schema.columns c
          ON c.table_schema = 'public'
         AND c.table_name = 'solo_plus_case_events'
         AND c.column_name = expected.column_name
         AND c.udt_name = expected.data_type
      ) AS columns_ok,
      EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'solo_plus_case_events'
          AND indexname = 'idx_solo_plus_case_events_request_idempotency'
          AND lower(
            regexp_replace(
              regexp_replace(
                regexp_replace(indexdef, '\s+', ' ', 'g'),
                '\(\s+',
                '(',
                'g'
              ),
              '\s+\)',
              ')',
              'g'
            )
          ) = lower(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  'CREATE UNIQUE INDEX idx_solo_plus_case_events_request_idempotency ON public.solo_plus_case_events USING btree (case_id, event_type, request_idempotency_key) WHERE (request_idempotency_key IS NOT NULL)',
                  '\s+',
                  ' ',
                  'g'
                ),
                '\(\s+',
                '(',
                'g'
              ),
              '\s+\)',
              ')',
              'g'
            )
          )
      ) AS index_ok,
      EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'solo_plus_case_events'
          AND c.relrowsecurity = true
          AND c.relforcerowsecurity = false
      ) AS rls_ok,
      (
        SELECT COALESCE(array_agg(policyname::text ORDER BY policyname::text), ARRAY[]::text[])
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'solo_plus_case_events'
      ) = ARRAY[]::text[] AS policies_ok,
      (SELECT grants_ok FROM events_grants_summary) AS grants_ok,
      (
        SELECT COALESCE(array_agg(tgname::text ORDER BY tgname::text), ARRAY[]::text[])
        FROM pg_trigger
        WHERE tgrelid = 'public.solo_plus_case_events'::regclass
          AND NOT tgisinternal
      ) = ARRAY[]::text[] AS triggers_ok
  ),
  rpc_exact AS (
    SELECT
      count(*) FILTER (WHERE identity_args = 'uuid, bigint, text, text, uuid, text, text') = 1 AS exact_exists,
      count(*) FILTER (WHERE identity_args <> 'uuid, bigint, text, text, uuid, text, text') = 0 AS no_unexpected_overloads,
      bool_or(identity_args = 'uuid, bigint, text, text, uuid, text, text' AND return_type = 'jsonb') AS return_type_ok,
      bool_or(identity_args = 'uuid, bigint, text, text, uuid, text, text' AND security_type = 'INVOKER') AS security_ok,
      bool_or(identity_args = 'uuid, bigint, text, text, uuid, text, text' AND has_hardened_search_path) AS search_path_ok,
      bool_or(identity_args = 'uuid, bigint, text, text, uuid, text, text' AND service_role_can_execute) AS service_role_ok,
      bool_or(identity_args = 'uuid, bigint, text, text, uuid, text, text' AND NOT public_can_execute) AS public_ok,
      bool_or(identity_args = 'uuid, bigint, text, text, uuid, text, text' AND NOT anon_can_execute) AS anon_ok,
      bool_or(identity_args = 'uuid, bigint, text, text, uuid, text, text' AND NOT authenticated_can_execute) AS authenticated_ok,
      max(CASE WHEN identity_args = 'uuid, bigint, text, text, uuid, text, text' THEN md5(pg_get_functiondef(oid)) END) AS definition_hash
    FROM (
      SELECT
        p.oid,
        pg_get_function_identity_arguments(p.oid) AS identity_args,
        pg_get_function_result(p.oid) AS return_type,
        CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS security_type,
        EXISTS (
          SELECT 1
          FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg(setting)
          WHERE cfg.setting = 'search_path=public, pg_temp'
        ) AS has_hardened_search_path,
        has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute,
        has_function_privilege('PUBLIC', p.oid, 'EXECUTE') AS public_can_execute,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'review_solo_plus_case_v1'
    ) f
  ),
  refund_discovery AS (
    SELECT
      to_regclass('public.refund_requests') IS NOT NULL AS refund_requests_exists,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name <> 'refund_requests'
          AND table_name ~* 'refund'
      ) AS other_refund_tables_exist,
      EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname ~* '(refund|credit|ledger)'
      ) AS refund_credit_functions_exist
  ),
  component_checks AS (
    SELECT
      'solo_plus_cases_exists'::text AS check_name,
      'prerequisite'::text AS category,
      CASE WHEN exists_ok THEN 'PASS' ELSE 'FAIL' END AS status,
      'classification=UNSAFE_SCHEMA_DRIFT; expected public.solo_plus_cases to exist'::text AS details
    FROM cases_table

    UNION ALL

    SELECT
      'solo_plus_cases_columns',
      'prerequisite',
      CASE WHEN columns_ok THEN 'PASS' ELSE 'FAIL' END,
      CASE
        WHEN columns_ok THEN 'classification=PASS'
        ELSE (SELECT diff_details FROM cases_column_summary)
      END
    FROM cases_table

    UNION ALL

    SELECT
      'solo_plus_cases_defaults',
      'prerequisite',
      CASE WHEN defaults_ok THEN 'PASS' ELSE 'FAIL' END,
      'classification=UNSAFE_SCHEMA_DRIFT; expected canonical solo_plus_cases defaults'
    FROM cases_table

    UNION ALL

    SELECT
      'solo_plus_cases_constraints',
      'prerequisite',
      CASE WHEN constraints_ok THEN 'PASS' ELSE 'FAIL' END,
      'classification=UNSAFE_SCHEMA_DRIFT; expected canonical solo_plus_cases constraints'
    FROM cases_table

    UNION ALL

    SELECT
      'solo_plus_case_requirements_exists',
      'prerequisite',
      CASE WHEN exists_ok THEN 'PASS' ELSE 'FAIL' END,
      'classification=UNSAFE_SCHEMA_DRIFT; expected public.solo_plus_case_requirements to exist'
    FROM requirements_table

    UNION ALL

    SELECT
      'solo_plus_case_requirements_columns',
      'prerequisite',
      CASE WHEN columns_ok THEN 'PASS' ELSE 'FAIL' END,
      'classification=UNSAFE_SCHEMA_DRIFT; expected canonical solo_plus_case_requirements columns'
    FROM requirements_table

    UNION ALL

    SELECT
      'solo_plus_case_requirements_constraints',
      'prerequisite',
      CASE WHEN constraints_ok THEN 'PASS' ELSE 'FAIL' END,
      'classification=UNSAFE_SCHEMA_DRIFT; expected canonical solo_plus_case_requirements constraints'
    FROM requirements_table

    UNION ALL

    SELECT
      'solo_plus_case_events_exists',
      'prerequisite',
      CASE WHEN exists_ok THEN 'PASS' ELSE 'FAIL' END,
      'classification=UNSAFE_SCHEMA_DRIFT; expected public.solo_plus_case_events to exist'
    FROM events_table

    UNION ALL

    SELECT
      'solo_plus_case_events_columns',
      'prerequisite',
      CASE WHEN columns_ok THEN 'PASS' ELSE 'FAIL' END,
      'classification=UNSAFE_SCHEMA_DRIFT; expected canonical solo_plus_case_events columns'
    FROM events_table

    UNION ALL

    SELECT
      'solo_plus_case_events_idempotency_index',
      'prerequisite',
      CASE WHEN index_ok THEN 'PASS' ELSE 'FAIL' END,
      'classification=UNSAFE_SCHEMA_DRIFT; expected canonical idx_solo_plus_case_events_request_idempotency'
    FROM events_table

    UNION ALL

    SELECT
      'solo_plus_cases_rls',
      'security',
      CASE WHEN rls_ok THEN 'PASS' ELSE 'FAIL' END,
      'classification=SAFE_REPAIRABLE_DRIFT; expected canonical solo_plus_cases RLS state'
    FROM cases_table

    UNION ALL

    SELECT
      'solo_plus_cases_policies',
      'security',
      CASE WHEN policies_ok THEN 'PASS' ELSE 'FAIL' END,
      'classification=SAFE_REPAIRABLE_DRIFT; expected canonical solo_plus_cases policies'
    FROM cases_table

    UNION ALL

    SELECT
      'solo_plus_cases_grants',
      'security',
      CASE WHEN grants_ok THEN 'PASS' ELSE 'FAIL' END,
      CASE
        WHEN grants_ok THEN 'classification=PASS'
        ELSE (SELECT diff_details FROM cases_grants_summary)
      END
    FROM cases_table

    UNION ALL

    SELECT
      'solo_plus_cases_triggers',
      'security',
      CASE WHEN triggers_ok THEN 'PASS' ELSE 'FAIL' END,
      'classification=SAFE_REPAIRABLE_DRIFT; expected canonical solo_plus_cases triggers'
    FROM cases_table

    UNION ALL

    SELECT
      'solo_plus_case_requirements_rls',
      'security',
      CASE WHEN rls_ok THEN 'PASS' ELSE 'FAIL' END,
      'classification=SAFE_REPAIRABLE_DRIFT; expected canonical solo_plus_case_requirements RLS state'
    FROM requirements_table

    UNION ALL

    SELECT
      'solo_plus_case_requirements_policies',
      'security',
      CASE WHEN policies_ok THEN 'PASS' ELSE 'FAIL' END,
      'classification=SAFE_REPAIRABLE_DRIFT; expected canonical solo_plus_case_requirements policies'
    FROM requirements_table

    UNION ALL

    SELECT
      'solo_plus_case_requirements_grants',
      'security',
      CASE WHEN grants_ok THEN 'PASS' ELSE 'FAIL' END,
      CASE
        WHEN grants_ok THEN 'classification=PASS'
        ELSE (SELECT diff_details FROM requirements_grants_summary)
      END
    FROM requirements_table

    UNION ALL

    SELECT
      'solo_plus_case_requirements_triggers',
      'security',
      CASE WHEN triggers_ok THEN 'PASS' ELSE 'FAIL' END,
      'classification=SAFE_REPAIRABLE_DRIFT; expected canonical solo_plus_case_requirements triggers'
    FROM requirements_table

    UNION ALL

    SELECT
      'solo_plus_case_events_rls',
      'security',
      CASE WHEN rls_ok THEN 'PASS' ELSE 'FAIL' END,
      'classification=SAFE_REPAIRABLE_DRIFT; expected canonical solo_plus_case_events RLS state'
    FROM events_table

    UNION ALL

    SELECT
      'solo_plus_case_events_policies',
      'security',
      CASE WHEN policies_ok THEN 'PASS' ELSE 'FAIL' END,
      'classification=SAFE_REPAIRABLE_DRIFT; expected canonical solo_plus_case_events policies'
    FROM events_table

    UNION ALL

    SELECT
      'solo_plus_case_events_grants',
      'security',
      CASE WHEN grants_ok THEN 'PASS' ELSE 'FAIL' END,
      CASE
        WHEN grants_ok THEN 'classification=PASS'
        ELSE (SELECT diff_details FROM events_grants_summary)
      END
    FROM events_table

    UNION ALL

    SELECT
      'solo_plus_case_events_triggers',
      'security',
      CASE WHEN triggers_ok THEN 'PASS' ELSE 'FAIL' END,
      'classification=SAFE_REPAIRABLE_DRIFT; expected canonical solo_plus_case_events triggers'
    FROM events_table

    UNION ALL

    SELECT
      'review_solo_plus_case_v1',
      'rpc',
      CASE
        WHEN no_unexpected_overloads
         AND exact_exists
         AND return_type_ok
         AND security_ok
         AND search_path_ok
         AND service_role_ok
         AND public_ok
         AND anon_ok
         AND authenticated_ok
        THEN 'PASS'
        WHEN no_unexpected_overloads
         AND NOT exact_exists
        THEN 'WARN'
        WHEN no_unexpected_overloads
        THEN 'FAIL'
        ELSE 'FAIL'
      END,
      format(
        'classification=%s; exact_exists=%s; no_unexpected_overloads=%s; return_type_ok=%s; security_ok=%s; search_path_ok=%s; service_role_ok=%s; public_ok=%s; anon_ok=%s; authenticated_ok=%s; definition_hash=%s',
        CASE
          WHEN no_unexpected_overloads AND NOT exact_exists THEN 'EXPECTED_PRE_APPLY_STATE'
          WHEN NOT no_unexpected_overloads THEN 'UNSAFE_SCHEMA_DRIFT'
          WHEN exact_exists
           AND NOT (return_type_ok AND security_ok AND search_path_ok AND service_role_ok AND public_ok AND anon_ok AND authenticated_ok)
          THEN 'SAFE_REPAIRABLE_DRIFT'
          ELSE 'PASS'
        END,
        exact_exists,
        no_unexpected_overloads,
        return_type_ok,
        security_ok,
        search_path_ok,
        service_role_ok,
        public_ok,
        anon_ok,
        authenticated_ok,
        coalesce(definition_hash, 'missing')
      )
    FROM rpc_exact

    UNION ALL

    SELECT
      'default_privileges',
      'default_privilege',
      CASE WHEN EXISTS (SELECT 1 FROM browser_default_acls) THEN 'WARN' ELSE 'PASS' END,
      CASE
        WHEN EXISTS (SELECT 1 FROM browser_default_acls) THEN
          'broad default privileges detected; explicit post-DDL revokes/grants are mandatory; postflight must verify final object privileges; '
          || COALESCE((
            SELECT string_agg(
              format('%s:%s:%s:%s', owner_name, object_type, grantee_name, privilege_type),
              ', '
              ORDER BY owner_name, object_type, grantee_name, privilege_type
            )
            FROM browser_default_acls
          ), '')
        ELSE
          'no PUBLIC/anon/authenticated default ACL drift detected'
      END

    UNION ALL

    SELECT
      'refund_schema_discovery',
      'refund',
      CASE
        WHEN refund_requests_exists
          OR other_refund_tables_exist
          OR refund_credit_functions_exist
        THEN 'WARN'
        ELSE 'PASS'
      END,
      format(
        'refund_requests_exists=%s other_refund_tables_exist=%s refund_credit_functions_exist=%s',
        refund_requests_exists,
        other_refund_tables_exist,
        refund_credit_functions_exist
      )
    FROM refund_discovery
  ),
  object_summary_rows AS (
    SELECT
      CASE
        WHEN exists_ok
         AND columns_ok
         AND defaults_ok
         AND constraints_ok
         AND rls_ok
         AND policies_ok
         AND grants_ok
         AND triggers_ok
        THEN 'PASS' ELSE 'FAIL'
      END AS status,
      'solo_plus_cases'::text AS check_name,
      format(
        'exists=%s columns=%s defaults=%s constraints=%s rls=%s policies=%s grants=%s triggers=%s',
        exists_ok, columns_ok, defaults_ok, constraints_ok, rls_ok, policies_ok, grants_ok, triggers_ok
      ) AS details
    FROM cases_table

    UNION ALL

    SELECT
      CASE
        WHEN exists_ok
         AND columns_ok
         AND constraints_ok
         AND rls_ok
         AND policies_ok
         AND grants_ok
         AND triggers_ok
        THEN 'PASS' ELSE 'FAIL'
      END,
      'solo_plus_case_requirements',
      format(
        'exists=%s columns=%s constraints=%s rls=%s policies=%s grants=%s triggers=%s',
        exists_ok, columns_ok, constraints_ok, rls_ok, policies_ok, grants_ok, triggers_ok
      )
    FROM requirements_table

    UNION ALL

    SELECT
      CASE
        WHEN exists_ok
         AND columns_ok
         AND index_ok
         AND rls_ok
         AND policies_ok
         AND grants_ok
         AND triggers_ok
        THEN 'PASS' ELSE 'FAIL'
      END,
      'solo_plus_case_events',
      format(
        'exists=%s columns=%s idempotency_index=%s rls=%s policies=%s grants=%s triggers=%s',
        exists_ok, columns_ok, index_ok, rls_ok, policies_ok, grants_ok, triggers_ok
      )
    FROM events_table
  ),
  summary_statuses AS (
    SELECT
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM component_checks
          WHERE category = 'prerequisite'
            AND status = 'FAIL'
        ) THEN 'FAIL'
        WHEN EXISTS (
          SELECT 1
          FROM component_checks
          WHERE category = 'prerequisite'
            AND status = 'WARN'
        ) THEN 'WARN'
        ELSE 'PASS'
      END AS prerequisite_schema_status,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM component_checks
          WHERE category = 'security'
            AND status = 'FAIL'
        ) THEN 'FAIL'
        WHEN EXISTS (
          SELECT 1
          FROM component_checks
          WHERE category = 'security'
            AND status = 'WARN'
        ) THEN 'WARN'
        ELSE 'PASS'
      END AS security_manifest_status,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM component_checks
          WHERE category = 'rpc'
            AND status = 'FAIL'
        ) THEN 'FAIL'
        WHEN EXISTS (
          SELECT 1
          FROM component_checks
          WHERE category = 'rpc'
            AND status = 'WARN'
        ) THEN 'WARN'
        ELSE 'PASS'
      END AS rpc_status,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM component_checks
          WHERE category = 'default_privilege'
            AND status = 'FAIL'
        ) THEN 'FAIL'
        WHEN EXISTS (
          SELECT 1
          FROM component_checks
          WHERE category = 'default_privilege'
            AND status = 'WARN'
        ) THEN 'WARN'
        ELSE 'PASS'
      END AS default_privilege_status,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM component_checks
          WHERE category = 'refund'
            AND status = 'FAIL'
        ) THEN 'FAIL'
        WHEN EXISTS (
          SELECT 1
          FROM component_checks
          WHERE category = 'refund'
            AND status = 'WARN'
        ) THEN 'WARN'
        ELSE 'PASS'
      END AS refund_schema_status,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM component_checks
          WHERE status = 'FAIL'
        ) THEN 'FAIL'
        WHEN EXISTS (
          SELECT 1
          FROM component_checks
          WHERE status = 'WARN'
        ) THEN 'WARN'
        ELSE 'PASS'
      END AS overall_preflight_status
  )
SELECT *
FROM (
  SELECT status, check_name, details
  FROM object_summary_rows

  UNION ALL

  SELECT status, check_name, details
  FROM component_checks
  WHERE status <> 'PASS'
     OR check_name IN ('review_solo_plus_case_v1', 'default_privileges', 'refund_schema_discovery')
) lines
ORDER BY check_name;

WITH
  expected_cases_columns AS (
    SELECT *
    FROM (
      VALUES
        ('id', 'uuid', 'NO', 'gen_random_uuid()'),
        ('merchant_id', 'uuid', 'YES', NULL),
        ('onboarding_session_id', 'uuid', 'YES', NULL),
        ('flow_origin', 'text', 'NO', NULL),
        ('source_plan', 'text', 'YES', NULL),
        ('target_plan', 'text', 'NO', '''solo_plus''::text'),
        ('case_status', 'text', 'NO', '''draft''::text'),
        ('payment_status', 'text', 'NO', '''pending''::text'),
        ('refund_status', 'text', 'NO', '''none''::text'),
        ('payment_record_id', 'uuid', 'YES', NULL),
        ('payment_provider', 'text', 'YES', NULL),
        ('payment_reference', 'text', 'YES', NULL),
        ('expected_amount', 'numeric', 'NO', NULL),
        ('payment_currency', 'varchar', 'NO', '''ngn''::character varying'),
        ('requirements_policy_version', 'text', 'NO', NULL),
        ('requirements_snapshot', 'jsonb', 'NO', '''{}''::jsonb'),
        ('active_plan_snapshot', 'text', 'YES', NULL),
        ('rejection_reason', 'text', 'YES', NULL),
        ('approved_at', 'timestamptz', 'YES', NULL),
        ('approved_by_admin_id', 'uuid', 'YES', NULL),
        ('rejected_at', 'timestamptz', 'YES', NULL),
        ('rejected_by_admin_id', 'uuid', 'YES', NULL),
        ('reopened_at', 'timestamptz', 'YES', NULL),
        ('reopened_by_admin_id', 'uuid', 'YES', NULL),
        ('idempotency_key', 'text', 'NO', NULL),
        ('activation_idempotency_key', 'text', 'YES', NULL),
        ('refund_idempotency_key', 'text', 'YES', NULL),
        ('row_version', 'int4', 'NO', '0'),
        ('audit_metadata', 'jsonb', 'NO', '''{}''::jsonb'),
        ('created_at', 'timestamptz', 'NO', 'now()'),
        ('updated_at', 'timestamptz', 'NO', 'now()')
    ) AS t(column_name, expected_type, expected_nullable, expected_default)
  ),
  actual_cases_columns AS (
    SELECT
      c.column_name,
      c.udt_name AS actual_type,
      c.is_nullable AS actual_nullable,
      NULLIF(
        lower(
          regexp_replace(
            COALESCE(pg_get_expr(ad.adbin, ad.adrelid), ''),
            '\s+',
            ' ',
            'g'
          )
        ),
        ''
      ) AS actual_default
    FROM information_schema.columns c
    JOIN pg_class cls
      ON cls.relname = c.table_name
    JOIN pg_namespace ns
      ON ns.oid = cls.relnamespace
     AND ns.nspname = c.table_schema
    LEFT JOIN pg_attribute attr
      ON attr.attrelid = cls.oid
     AND attr.attname = c.column_name
     AND attr.attnum > 0
     AND NOT attr.attisdropped
    LEFT JOIN pg_attrdef ad
      ON ad.adrelid = cls.oid
     AND ad.adnum = attr.attnum
    WHERE c.table_schema = 'public'
      AND c.table_name = 'solo_plus_cases'
  ),
  cases_column_diffs AS (
    SELECT
      e.column_name,
      e.expected_type,
      a.actual_type,
      e.expected_nullable,
      a.actual_nullable,
      e.expected_default,
      a.actual_default,
      a.column_name IS NULL AS is_missing,
      a.column_name IS NOT NULL AND a.actual_type <> e.expected_type AS type_mismatch,
      a.column_name IS NOT NULL AND a.actual_nullable <> e.expected_nullable AS nullability_mismatch,
      a.column_name IS NOT NULL
        AND COALESCE(a.actual_default, '<none>') <> COALESCE(e.expected_default, '<none>') AS default_mismatch
    FROM expected_cases_columns e
    LEFT JOIN actual_cases_columns a
      ON a.column_name = e.column_name
  ),
  expected_table_grants AS (
    SELECT *
    FROM (
      VALUES
        ('solo_plus_cases', 'PUBLIC', NULL),
        ('solo_plus_cases', 'anon', NULL),
        ('solo_plus_cases', 'authenticated', 'SELECT'),
        ('solo_plus_case_requirements', 'PUBLIC', NULL),
        ('solo_plus_case_requirements', 'anon', NULL),
        ('solo_plus_case_requirements', 'authenticated', 'SELECT'),
        ('solo_plus_case_events', 'PUBLIC', NULL),
        ('solo_plus_case_events', 'anon', NULL),
        ('solo_plus_case_events', 'authenticated', NULL)
    ) AS t(table_name, grantee, privilege_type)
  ),
  expected_grant_arrays AS (
    SELECT
      table_name,
      grantee,
      COALESCE(
        array_agg(privilege_type::text ORDER BY privilege_type::text)
          FILTER (WHERE privilege_type IS NOT NULL),
        ARRAY[]::text[]
      ) AS expected_privileges
    FROM expected_table_grants
    GROUP BY table_name, grantee
  ),
  actual_grant_arrays AS (
    SELECT
      table_name,
      grantee,
      COALESCE(array_agg(privilege_type::text ORDER BY privilege_type::text), ARRAY[]::text[]) AS actual_privileges
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN ('solo_plus_cases', 'solo_plus_case_requirements', 'solo_plus_case_events')
      AND grantee IN ('PUBLIC', 'anon', 'authenticated')
    GROUP BY table_name, grantee
  ),
  grant_arrays AS (
    SELECT
      e.table_name,
      e.grantee,
      e.expected_privileges,
      COALESCE(a.actual_privileges, ARRAY[]::text[]) AS actual_privileges
    FROM expected_grant_arrays e
    LEFT JOIN actual_grant_arrays a
      ON a.table_name = e.table_name
     AND a.grantee = e.grantee
  ),
  grant_diffs AS (
    SELECT
      table_name,
      grantee,
      COALESCE((
        SELECT array_agg(privilege ORDER BY privilege)
        FROM (
          SELECT privilege
          FROM unnest(actual_privileges) AS privilege
          EXCEPT
          SELECT privilege
          FROM unnest(expected_privileges) AS privilege
        ) unexpected
      ), ARRAY[]::text[]) AS unexpected_privileges,
      COALESCE((
        SELECT array_agg(privilege ORDER BY privilege)
        FROM (
          SELECT privilege
          FROM unnest(expected_privileges) AS privilege
          EXCEPT
          SELECT privilege
          FROM unnest(actual_privileges) AS privilege
        ) missing
      ), ARRAY[]::text[]) AS missing_privileges
    FROM grant_arrays
  ),
  cases_table AS (
    SELECT
      to_regclass('public.solo_plus_cases') IS NOT NULL AS exists_ok,
      NOT EXISTS (
        SELECT 1
        FROM cases_column_diffs
        WHERE is_missing
           OR type_mismatch
           OR nullability_mismatch
           OR default_mismatch
      ) AS columns_ok,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'solo_plus_cases'
          AND column_name = 'case_status'
          AND column_default LIKE '%draft%'
      )
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'solo_plus_cases'
          AND column_name = 'payment_status'
          AND column_default LIKE '%pending%'
      )
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'solo_plus_cases'
          AND column_name = 'refund_status'
          AND column_default LIKE '%none%'
      )
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'solo_plus_cases'
          AND column_name = 'row_version'
          AND column_default = '0'
      ) AS defaults_ok,
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.solo_plus_cases'::regclass
          AND conname = 'solo_plus_cases_rejected_consistency_chk'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.solo_plus_cases'::regclass
          AND conname = 'solo_plus_cases_paid_terminal_refund_chk'
      ) AS constraints_ok,
      EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'solo_plus_cases'
          AND c.relrowsecurity = true
          AND c.relforcerowsecurity = false
      ) AS rls_ok,
      (
        SELECT COALESCE(array_agg(policyname::text ORDER BY policyname::text), ARRAY[]::text[])
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'solo_plus_cases'
      ) = ARRAY['merchant_read_solo_plus_cases']::text[] AS policies_ok,
      bool_and(cardinality(unexpected_privileges) = 0 AND cardinality(missing_privileges) = 0)
        FILTER (WHERE table_name = 'solo_plus_cases') AS grants_ok,
      (
        SELECT COALESCE(array_agg(tgname::text ORDER BY tgname::text), ARRAY[]::text[])
        FROM pg_trigger
        WHERE tgrelid = 'public.solo_plus_cases'::regclass
          AND NOT tgisinternal
      ) = ARRAY['trg_solo_plus_cases_updated_at']::text[] AS triggers_ok
    FROM grant_diffs
  ),
  requirements_table AS (
    SELECT
      to_regclass('public.solo_plus_case_requirements') IS NOT NULL AS exists_ok,
      (
        SELECT count(*) = 10
        FROM (
          VALUES
            ('case_id', 'uuid'),
            ('requirement_code', 'text'),
            ('requirement_state', 'text'),
            ('verification_log_id', 'uuid'),
            ('evidence_source_type', 'text'),
            ('evidence_source_id', 'uuid'),
            ('evidence_reference', 'text'),
            ('policy_rule_applied', 'text'),
            ('metadata', 'jsonb'),
            ('reviewed_by_admin_id', 'uuid')
        ) AS expected(column_name, data_type)
        JOIN information_schema.columns c
          ON c.table_schema = 'public'
         AND c.table_name = 'solo_plus_case_requirements'
         AND c.column_name = expected.column_name
         AND c.udt_name = expected.data_type
      ) AS columns_ok,
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.solo_plus_case_requirements'::regclass
          AND conname = 'solo_plus_case_requirements_unique_case_code'
      ) AS constraints_ok,
      EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'solo_plus_case_requirements'
          AND c.relrowsecurity = true
          AND c.relforcerowsecurity = false
      ) AS rls_ok,
      (
        SELECT COALESCE(array_agg(policyname::text ORDER BY policyname::text), ARRAY[]::text[])
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'solo_plus_case_requirements'
      ) = ARRAY['merchant_read_solo_plus_case_requirements']::text[] AS policies_ok,
      bool_and(cardinality(unexpected_privileges) = 0 AND cardinality(missing_privileges) = 0)
        FILTER (WHERE table_name = 'solo_plus_case_requirements') AS grants_ok,
      (
        SELECT COALESCE(array_agg(tgname::text ORDER BY tgname::text), ARRAY[]::text[])
        FROM pg_trigger
        WHERE tgrelid = 'public.solo_plus_case_requirements'::regclass
          AND NOT tgisinternal
      ) = ARRAY['trg_solo_plus_case_requirements_updated_at']::text[] AS triggers_ok
    FROM grant_diffs
  ),
  events_table AS (
    SELECT
      to_regclass('public.solo_plus_case_events') IS NOT NULL AS exists_ok,
      (
        SELECT count(*) = 8
        FROM (
          VALUES
            ('case_id', 'uuid'),
            ('event_type', 'text'),
            ('previous_state', 'jsonb'),
            ('new_state', 'jsonb'),
            ('actor_type', 'text'),
            ('actor_id', 'uuid'),
            ('request_idempotency_key', 'text'),
            ('policy_version', 'text')
        ) AS expected(column_name, data_type)
        JOIN information_schema.columns c
          ON c.table_schema = 'public'
         AND c.table_name = 'solo_plus_case_events'
         AND c.column_name = expected.column_name
         AND c.udt_name = expected.data_type
      ) AS columns_ok,
      EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'solo_plus_case_events'
          AND indexname = 'idx_solo_plus_case_events_request_idempotency'
          AND lower(
            regexp_replace(
              regexp_replace(
                regexp_replace(indexdef, '\s+', ' ', 'g'),
                '\(\s+',
                '(',
                'g'
              ),
              '\s+\)',
              ')',
              'g'
            )
          ) = lower(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  'CREATE UNIQUE INDEX idx_solo_plus_case_events_request_idempotency ON public.solo_plus_case_events USING btree (case_id, event_type, request_idempotency_key) WHERE (request_idempotency_key IS NOT NULL)',
                  '\s+',
                  ' ',
                  'g'
                ),
                '\(\s+',
                '(',
                'g'
              ),
              '\s+\)',
              ')',
              'g'
            )
          )
      ) AS index_ok,
      EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'solo_plus_case_events'
          AND c.relrowsecurity = true
          AND c.relforcerowsecurity = false
      ) AS rls_ok,
      (
        SELECT COALESCE(array_agg(policyname::text ORDER BY policyname::text), ARRAY[]::text[])
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'solo_plus_case_events'
      ) = ARRAY[]::text[] AS policies_ok,
      bool_and(cardinality(unexpected_privileges) = 0 AND cardinality(missing_privileges) = 0)
        FILTER (WHERE table_name = 'solo_plus_case_events') AS grants_ok,
      (
        SELECT COALESCE(array_agg(tgname::text ORDER BY tgname::text), ARRAY[]::text[])
        FROM pg_trigger
        WHERE tgrelid = 'public.solo_plus_case_events'::regclass
          AND NOT tgisinternal
      ) = ARRAY[]::text[] AS triggers_ok
    FROM grant_diffs
  ),
  rpc_exact AS (
    SELECT
      count(*) FILTER (WHERE identity_args = 'uuid, bigint, text, text, uuid, text, text') = 1 AS exact_exists,
      count(*) FILTER (WHERE identity_args <> 'uuid, bigint, text, text, uuid, text, text') = 0 AS no_unexpected_overloads
    FROM (
      SELECT pg_get_function_identity_arguments(p.oid) AS identity_args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'review_solo_plus_case_v1'
    ) f
  ),
  component_checks AS (
    SELECT 'solo_plus_cases_columns'::text AS check_name, 'prerequisite'::text AS category, CASE WHEN cases_table.columns_ok THEN 'PASS' ELSE 'FAIL' END AS status FROM cases_table
    UNION ALL
    SELECT 'solo_plus_cases_grants', 'security', CASE WHEN cases_table.grants_ok THEN 'PASS' ELSE 'FAIL' END FROM cases_table
    UNION ALL
    SELECT 'review_solo_plus_case_v1', 'rpc', CASE WHEN rpc_exact.no_unexpected_overloads AND NOT rpc_exact.exact_exists THEN 'WARN' WHEN rpc_exact.no_unexpected_overloads THEN 'PASS' ELSE 'FAIL' END FROM rpc_exact
  ),
  summary_statuses AS (
    SELECT
      CASE
        WHEN EXISTS (SELECT 1 FROM component_checks WHERE category = 'prerequisite' AND status = 'FAIL') THEN 'FAIL'
        WHEN EXISTS (SELECT 1 FROM component_checks WHERE category = 'prerequisite' AND status = 'WARN') THEN 'WARN'
        ELSE 'PASS'
      END AS prerequisite_schema_status,
      CASE
        WHEN EXISTS (SELECT 1 FROM component_checks WHERE category = 'security' AND status = 'FAIL') THEN 'FAIL'
        WHEN EXISTS (SELECT 1 FROM component_checks WHERE category = 'security' AND status = 'WARN') THEN 'WARN'
        ELSE 'PASS'
      END AS security_manifest_status,
      CASE
        WHEN EXISTS (SELECT 1 FROM component_checks WHERE category = 'rpc' AND status = 'FAIL') THEN 'FAIL'
        WHEN EXISTS (SELECT 1 FROM component_checks WHERE category = 'rpc' AND status = 'WARN') THEN 'WARN'
        ELSE 'PASS'
      END AS rpc_status
  )
SELECT
  prerequisite_schema_status,
  security_manifest_status,
  rpc_status,
  CASE
    WHEN EXISTS (SELECT 1 FROM component_checks WHERE status = 'FAIL') THEN 'FAIL'
    WHEN EXISTS (SELECT 1 FROM component_checks WHERE status = 'WARN') THEN 'WARN'
    ELSE 'PASS'
  END AS overall_preflight_status
FROM summary_statuses;

COMMIT;
