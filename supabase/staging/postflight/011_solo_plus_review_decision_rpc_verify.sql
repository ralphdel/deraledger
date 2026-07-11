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
  cases_ok AS (
    SELECT
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
      EXISTS (
        SELECT 1
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'solo_plus_cases'
          AND grantee = 'authenticated'
          AND privilege_type = 'SELECT'
      ) AS authenticated_select_ok,
      NOT EXISTS (
        SELECT 1
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'solo_plus_cases'
          AND grantee IN ('PUBLIC', 'anon')
      ) AS public_anon_clear
  ),
  requirements_ok AS (
    SELECT
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
      EXISTS (
        SELECT 1
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'solo_plus_case_requirements'
          AND grantee = 'authenticated'
          AND privilege_type = 'SELECT'
      ) AS authenticated_select_ok,
      NOT EXISTS (
        SELECT 1
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'solo_plus_case_requirements'
          AND grantee IN ('PUBLIC', 'anon')
      ) AS public_anon_clear
  ),
  events_ok AS (
    SELECT
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
      NOT EXISTS (
        SELECT 1
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'solo_plus_case_events'
          AND grantee IN ('PUBLIC', 'anon', 'authenticated')
      ) AS browser_grants_clear
  ),
  review_rpc AS (
    SELECT
      exact_rpc.exact_oid IS NOT NULL AS exact_exists,
      NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'review_solo_plus_case_v1'
          AND p.oid <> exact_rpc.exact_oid
      ) AS no_overloads,
      exact_function.return_type = 'jsonb' AS return_type_ok,
      exact_function.security_type = 'INVOKER' AS security_ok,
      exact_function.has_hardened_search_path AS search_path_ok,
      exact_function.service_role_exists AND exact_function.service_role_can_execute AS service_role_ok,
      NOT exact_function.public_can_execute AS public_ok,
      exact_function.anon_exists AND NOT exact_function.anon_can_execute AS anon_ok,
      exact_function.authenticated_exists AND NOT exact_function.authenticated_can_execute AS authenticated_ok,
      exact_function.definition_hash
    FROM (
      SELECT
        to_regprocedure('public.review_solo_plus_case_v1(uuid,bigint,text,text,uuid,text,text)')::oid AS exact_oid
    ) exact_rpc
    LEFT JOIN (
      SELECT
        p.oid,
        pg_get_function_result(p.oid) AS return_type,
        CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS security_type,
        EXISTS (
          SELECT 1
          FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg(setting)
          WHERE cfg.setting = 'search_path=public, pg_temp'
        ) AS has_hardened_search_path,
        EXISTS (
          SELECT 1
          FROM pg_roles
          WHERE rolname = 'service_role'
        ) AS service_role_exists,
        EXISTS (
          SELECT 1
          FROM pg_roles
          WHERE rolname = 'anon'
        ) AS anon_exists,
        EXISTS (
          SELECT 1
          FROM pg_roles
          WHERE rolname = 'authenticated'
        ) AS authenticated_exists,
        EXISTS (
          SELECT 1
          FROM pg_proc proc_acl
          LEFT JOIN LATERAL aclexplode(COALESCE(proc_acl.proacl, acldefault('f', proc_acl.proowner))) acl ON TRUE
          WHERE proc_acl.oid = p.oid
            AND acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
        ) AS public_can_execute,
        has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
        md5(pg_get_functiondef(p.oid)) AS definition_hash
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'review_solo_plus_case_v1'
    ) exact_function
      ON exact_function.oid = exact_rpc.exact_oid
  ),
  prior_rpcs AS (
    SELECT
      count(*) FILTER (WHERE proname = 'create_solo_plus_case_bundle_v1') = 1 AS create_case_bundle_ok,
      count(*) FILTER (WHERE proname = 'attach_solo_plus_onboarding_merchant_v1') = 1 AS attach_ok,
      count(*) FILTER (WHERE proname = 'mark_solo_plus_case_awaiting_payment_v1') = 1 AS awaiting_payment_ok,
      count(*) FILTER (WHERE proname = 'confirm_solo_plus_payment_v1') = 1 AS confirm_payment_ok
    FROM (
      SELECT p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'create_solo_plus_case_bundle_v1',
          'attach_solo_plus_onboarding_merchant_v1',
          'mark_solo_plus_case_awaiting_payment_v1',
          'confirm_solo_plus_payment_v1'
        )
    ) q
  ),
  refund_discovery AS (
    SELECT
      to_regclass('public.refund_requests') IS NOT NULL AS refund_requests_exists,
      EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname ~* '(refund|credit|ledger)'
      ) AS refund_credit_functions_exist
  )
SELECT * FROM (
  SELECT
    CASE
      WHEN cases_ok.rls_ok AND cases_ok.policies_ok AND cases_ok.authenticated_select_ok AND cases_ok.public_anon_clear
      THEN 'PASS' ELSE 'FAIL'
    END AS status,
    'solo_plus_cases_manifest' AS check_name,
    format(
      'rls_ok=%s policies_ok=%s authenticated_select_ok=%s public_anon_clear=%s',
      cases_ok.rls_ok,
      cases_ok.policies_ok,
      cases_ok.authenticated_select_ok,
      cases_ok.public_anon_clear
    ) AS details
  FROM cases_ok

  UNION ALL

  SELECT
    CASE
      WHEN requirements_ok.rls_ok AND requirements_ok.policies_ok AND requirements_ok.authenticated_select_ok AND requirements_ok.public_anon_clear
      THEN 'PASS' ELSE 'FAIL'
    END,
    'solo_plus_case_requirements_manifest',
    format(
      'rls_ok=%s policies_ok=%s authenticated_select_ok=%s public_anon_clear=%s',
      requirements_ok.rls_ok,
      requirements_ok.policies_ok,
      requirements_ok.authenticated_select_ok,
      requirements_ok.public_anon_clear
    )
  FROM requirements_ok

  UNION ALL

  SELECT
    CASE
      WHEN events_ok.rls_ok AND events_ok.policies_ok AND events_ok.browser_grants_clear
      THEN 'PASS' ELSE 'FAIL'
    END,
    'solo_plus_case_events_manifest',
    format(
      'rls_ok=%s policies_ok=%s browser_grants_clear=%s',
      events_ok.rls_ok,
      events_ok.policies_ok,
      events_ok.browser_grants_clear
    )
  FROM events_ok

  UNION ALL

  SELECT
    CASE
      WHEN review_rpc.exact_exists
       AND review_rpc.no_overloads
       AND review_rpc.security_ok
       AND review_rpc.search_path_ok
       AND review_rpc.service_role_ok
       AND review_rpc.public_ok
       AND review_rpc.anon_ok
       AND review_rpc.authenticated_ok
      THEN 'PASS' ELSE 'FAIL'
    END,
    'review_solo_plus_case_v1',
    format(
      'exact_exists=%s no_overloads=%s return_type_ok=%s security_ok=%s search_path_ok=%s service_role_ok=%s public_ok=%s anon_ok=%s authenticated_ok=%s definition_hash=%s',
      review_rpc.exact_exists,
      review_rpc.no_overloads,
      review_rpc.return_type_ok,
      review_rpc.security_ok,
      review_rpc.search_path_ok,
      review_rpc.service_role_ok,
      review_rpc.public_ok,
      review_rpc.anon_ok,
      review_rpc.authenticated_ok,
      coalesce(review_rpc.definition_hash, 'missing')
    )
  FROM review_rpc

  UNION ALL

  SELECT
    CASE
      WHEN prior_rpcs.create_case_bundle_ok
       AND prior_rpcs.attach_ok
       AND prior_rpcs.awaiting_payment_ok
       AND prior_rpcs.confirm_payment_ok
      THEN 'PASS' ELSE 'FAIL'
    END,
    'prior_commit_rpcs',
    format(
      'create_case_bundle_ok=%s attach_ok=%s awaiting_payment_ok=%s confirm_payment_ok=%s',
      prior_rpcs.create_case_bundle_ok,
      prior_rpcs.attach_ok,
      prior_rpcs.awaiting_payment_ok,
      prior_rpcs.confirm_payment_ok
    )
  FROM prior_rpcs

  UNION ALL

  SELECT
    'PASS',
    'refund_schema_discovery',
    format(
      'refund_requests_exists=%s refund_credit_functions_exist=%s',
      refund_discovery.refund_requests_exists,
      refund_discovery.refund_credit_functions_exist
    )
  FROM refund_discovery
) lines
ORDER BY check_name;

WITH
  cases_ok AS (
    SELECT
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
      EXISTS (
        SELECT 1
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'solo_plus_cases'
          AND grantee = 'authenticated'
          AND privilege_type = 'SELECT'
      ) AS authenticated_select_ok,
      NOT EXISTS (
        SELECT 1
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'solo_plus_cases'
          AND grantee IN ('PUBLIC', 'anon')
      ) AS public_anon_clear
  ),
  requirements_ok AS (
    SELECT
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
      EXISTS (
        SELECT 1
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'solo_plus_case_requirements'
          AND grantee = 'authenticated'
          AND privilege_type = 'SELECT'
      ) AS authenticated_select_ok,
      NOT EXISTS (
        SELECT 1
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'solo_plus_case_requirements'
          AND grantee IN ('PUBLIC', 'anon')
      ) AS public_anon_clear
  ),
  events_ok AS (
    SELECT
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
      NOT EXISTS (
        SELECT 1
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'solo_plus_case_events'
          AND grantee IN ('PUBLIC', 'anon', 'authenticated')
      ) AS browser_grants_clear
  ),
  review_rpc AS (
    SELECT
      exact_rpc.exact_oid IS NOT NULL AS exact_exists,
      NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'review_solo_plus_case_v1'
          AND p.oid <> exact_rpc.exact_oid
      ) AS no_overloads,
      exact_function.return_type = 'jsonb' AS return_type_ok,
      exact_function.security_type = 'INVOKER' AS security_ok,
      exact_function.has_hardened_search_path AS search_path_ok,
      exact_function.service_role_exists AND exact_function.service_role_can_execute AS service_role_ok,
      NOT exact_function.public_can_execute AS public_ok,
      exact_function.anon_exists AND NOT exact_function.anon_can_execute AS anon_ok,
      exact_function.authenticated_exists AND NOT exact_function.authenticated_can_execute AS authenticated_ok
    FROM (
      SELECT
        to_regprocedure('public.review_solo_plus_case_v1(uuid,bigint,text,text,uuid,text,text)')::oid AS exact_oid
    ) exact_rpc
    LEFT JOIN (
      SELECT
        p.oid,
        pg_get_function_result(p.oid) AS return_type,
        CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS security_type,
        EXISTS (
          SELECT 1
          FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg(setting)
          WHERE cfg.setting = 'search_path=public, pg_temp'
        ) AS has_hardened_search_path,
        EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') AS service_role_exists,
        EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AS anon_exists,
        EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AS authenticated_exists,
        EXISTS (
          SELECT 1
          FROM pg_proc proc_acl
          LEFT JOIN LATERAL aclexplode(COALESCE(proc_acl.proacl, acldefault('f', proc_acl.proowner))) acl ON TRUE
          WHERE proc_acl.oid = p.oid
            AND acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
        ) AS public_can_execute,
        has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'review_solo_plus_case_v1'
    ) exact_function
      ON exact_function.oid = exact_rpc.exact_oid
  ),
  prior_rpcs AS (
    SELECT
      count(*) FILTER (WHERE proname = 'create_solo_plus_case_bundle_v1') = 1 AS create_case_bundle_ok,
      count(*) FILTER (WHERE proname = 'attach_solo_plus_onboarding_merchant_v1') = 1 AS attach_ok,
      count(*) FILTER (WHERE proname = 'mark_solo_plus_case_awaiting_payment_v1') = 1 AS awaiting_payment_ok,
      count(*) FILTER (WHERE proname = 'confirm_solo_plus_payment_v1') = 1 AS confirm_payment_ok
    FROM (
      SELECT p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'create_solo_plus_case_bundle_v1',
          'attach_solo_plus_onboarding_merchant_v1',
          'mark_solo_plus_case_awaiting_payment_v1',
          'confirm_solo_plus_payment_v1'
        )
    ) q
  ),
  final_status AS (
    SELECT
      CASE
        WHEN NOT (cases_ok.rls_ok AND cases_ok.policies_ok AND cases_ok.authenticated_select_ok AND cases_ok.public_anon_clear) THEN 'FAIL'
        WHEN NOT (requirements_ok.rls_ok AND requirements_ok.policies_ok AND requirements_ok.authenticated_select_ok AND requirements_ok.public_anon_clear) THEN 'FAIL'
        WHEN NOT (events_ok.rls_ok AND events_ok.policies_ok AND events_ok.browser_grants_clear) THEN 'FAIL'
        WHEN NOT (review_rpc.exact_exists AND review_rpc.no_overloads AND review_rpc.return_type_ok AND review_rpc.security_ok AND review_rpc.search_path_ok AND review_rpc.service_role_ok AND review_rpc.public_ok AND review_rpc.anon_ok AND review_rpc.authenticated_ok) THEN 'FAIL'
        WHEN NOT (prior_rpcs.create_case_bundle_ok AND prior_rpcs.attach_ok AND prior_rpcs.awaiting_payment_ok AND prior_rpcs.confirm_payment_ok) THEN 'FAIL'
        ELSE 'PASS'
      END AS commit_9_post_apply_status
    FROM cases_ok, requirements_ok, events_ok, review_rpc, prior_rpcs
  )
SELECT commit_9_post_apply_status AS COMMIT_9_POST_APPLY_STATUS
FROM final_status;

COMMIT;
