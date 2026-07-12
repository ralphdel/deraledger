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
  exact_rpc AS (
    SELECT to_regprocedure('public.activate_solo_plus_case_v1(uuid,bigint,text,uuid,text)')::oid AS exact_oid
  ),
  overloads AS (
    SELECT
      count(*) AS overload_count,
      count(*) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, bigint, text, uuid, text') AS exact_count,
      string_agg(oidvectortypes(p.proargtypes), ', ' ORDER BY oidvectortypes(p.proargtypes)) AS overload_signatures
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public'
      AND p.proname='activate_solo_plus_case_v1'
  ),
  rpc_details AS (
    SELECT
      p.oid,
      pg_get_function_result(p.oid) AS return_type,
      CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS security_mode,
      EXISTS (
        SELECT 1
        FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg(setting)
        WHERE cfg.setting = 'search_path=public, pg_temp'
      ) AS search_path_ok,
      pg_get_userbyid(p.proowner) AS owner_name,
      md5(pg_get_functiondef(p.oid)) AS definition_hash,
      EXISTS (
        SELECT 1
        FROM pg_proc proc_acl
        LEFT JOIN LATERAL aclexplode(COALESCE(proc_acl.proacl, acldefault('f', proc_acl.proowner))) acl ON TRUE
        WHERE proc_acl.oid = p.oid
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
      ) AS public_execute,
      has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
      has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
    FROM pg_proc p
    JOIN exact_rpc e ON e.exact_oid = p.oid
  ),
  table_manifest AS (
    SELECT 'solo_plus_cases'::text AS table_name,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='solo_plus_cases' AND c.relrowsecurity AND NOT c.relforcerowsecurity) AS rls_ok,
      (SELECT COALESCE(array_agg(policyname::text ORDER BY policyname::text), ARRAY[]::text[]) FROM pg_policies WHERE schemaname='public' AND tablename='solo_plus_cases') = ARRAY['merchant_read_solo_plus_cases']::text[] AS policies_ok,
      NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='solo_plus_cases' AND grantee IN ('PUBLIC','anon') AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')) AND EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='solo_plus_cases' AND grantee='authenticated' AND privilege_type='SELECT') AS grants_ok
    UNION ALL
    SELECT 'solo_plus_case_requirements',
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='solo_plus_case_requirements' AND c.relrowsecurity AND NOT c.relforcerowsecurity) AS rls_ok,
      (SELECT COALESCE(array_agg(policyname::text ORDER BY policyname::text), ARRAY[]::text[]) FROM pg_policies WHERE schemaname='public' AND tablename='solo_plus_case_requirements') = ARRAY['merchant_read_solo_plus_case_requirements']::text[] AS policies_ok,
      NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='solo_plus_case_requirements' AND grantee IN ('PUBLIC','anon') AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')) AND EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='solo_plus_case_requirements' AND grantee='authenticated' AND privilege_type='SELECT') AS grants_ok
    UNION ALL
    SELECT 'solo_plus_case_events',
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='solo_plus_case_events' AND c.relrowsecurity AND NOT c.relforcerowsecurity) AS rls_ok,
      (SELECT COALESCE(array_agg(policyname::text ORDER BY policyname::text), ARRAY[]::text[]) FROM pg_policies WHERE schemaname='public' AND tablename='solo_plus_case_events') = ARRAY[]::text[] AS policies_ok,
      NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='solo_plus_case_events' AND grantee IN ('PUBLIC','anon','authenticated') AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')) AS grants_ok
  ),
  platform_flags AS (
    SELECT COALESCE(array_agg(key || '=' || value ORDER BY key), ARRAY[]::text[]) AS flags
    FROM public.platform_settings
    WHERE key IN ('plan_migration_solo_lite_enabled', 'solo_plus_enabled', 'solo_plus_kyc_enabled')
  ),
  results AS (
    SELECT
      'activate_solo_plus_case_v1'::text AS check_name,
      CASE
        WHEN exact_rpc.exact_oid IS NULL THEN 'FAIL'
        WHEN overloads.exact_count <> 1 OR overloads.overload_count <> 1 THEN 'FAIL'
        WHEN rpc_details.return_type <> 'jsonb' THEN 'FAIL'
        WHEN rpc_details.security_mode <> 'INVOKER' THEN 'FAIL'
        WHEN NOT rpc_details.search_path_ok THEN 'FAIL'
        WHEN rpc_details.public_execute THEN 'FAIL'
        WHEN NOT rpc_details.service_role_execute THEN 'FAIL'
        WHEN rpc_details.anon_execute THEN 'FAIL'
        WHEN rpc_details.authenticated_execute THEN 'FAIL'
        ELSE 'PASS'
      END AS status,
      format(
        'exact_exists=%s overload_count=%s exact_count=%s return_type=%s security_mode=%s owner=%s search_path_ok=%s public_execute=%s service_role_execute=%s anon_execute=%s authenticated_execute=%s definition_hash=%s',
        exact_rpc.exact_oid IS NOT NULL,
        overloads.overload_count,
        overloads.exact_count,
        COALESCE(rpc_details.return_type, '<missing>'),
        COALESCE(rpc_details.security_mode, '<missing>'),
        COALESCE(rpc_details.owner_name, '<missing>'),
        COALESCE(rpc_details.search_path_ok::text, 'false'),
        COALESCE(rpc_details.public_execute::text, 'false'),
        COALESCE(rpc_details.service_role_execute::text, 'false'),
        COALESCE(rpc_details.anon_execute::text, 'false'),
        COALESCE(rpc_details.authenticated_execute::text, 'false'),
        COALESCE(rpc_details.definition_hash, 'missing')
      ) AS details
    FROM exact_rpc, overloads, rpc_details

    UNION ALL

    SELECT
      table_name || '_manifest',
      CASE WHEN rls_ok AND policies_ok AND grants_ok THEN 'PASS' ELSE 'FAIL' END,
      format('rls_ok=%s policies_ok=%s grants_ok=%s', rls_ok, policies_ok, grants_ok)
    FROM table_manifest

    UNION ALL

    SELECT
      'protected_feature_flags',
      CASE WHEN (SELECT flags FROM platform_flags) = ARRAY['plan_migration_solo_lite_enabled=false','solo_plus_enabled=false','solo_plus_kyc_enabled=false']::text[] THEN 'PASS' ELSE 'FAIL' END,
      format('flags=%s', array_to_string((SELECT flags FROM platform_flags), ','))
  ),
  summary AS (
    SELECT CASE WHEN EXISTS (SELECT 1 FROM results WHERE status = 'FAIL') THEN 'FAIL' ELSE 'PASS' END AS commit_10_post_apply_status
  )
SELECT check_name, status, details
FROM results
UNION ALL
SELECT
  'COMMIT_10_POST_APPLY_STATUS' AS check_name,
  (SELECT commit_10_post_apply_status FROM summary) AS status,
  'summary derived from detailed checks' AS details
ORDER BY check_name;

ROLLBACK;
