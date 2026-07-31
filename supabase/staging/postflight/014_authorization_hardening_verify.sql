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
  function_target AS (
    SELECT to_regprocedure('public.can_read_merchant_row_v1(uuid)')::oid AS exact_oid
  ),
  rpc_details AS (
    SELECT
      count(*) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid') AS exact_count,
      count(*) AS overload_count,
      max(pg_get_function_result(p.oid)) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid') AS return_type,
      max(CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid') AS security_mode,
      max(pg_get_userbyid(p.proowner)) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid') AS owner_name,
      max(md5(pg_get_functiondef(p.oid))) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid') AS definition_hash,
      bool_or(
        CASE
          WHEN p.proconfig IS NULL THEN false
          ELSE array_to_string(p.proconfig, ' ') ILIKE '%search_path=public, pg_temp%'
        END
      ) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid') AS search_path_ok
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'can_read_merchant_row_v1'
  ),
  execute_manifest AS (
    SELECT
      CASE WHEN exact_oid IS NULL THEN false ELSE has_function_privilege('authenticated', exact_oid, 'EXECUTE') END AS authenticated_execute,
      CASE WHEN exact_oid IS NULL THEN false ELSE has_function_privilege('anon', exact_oid, 'EXECUTE') END AS anon_execute,
      CASE
        WHEN exact_oid IS NULL THEN true
        ELSE EXISTS (
          SELECT 1
          FROM pg_proc p
          LEFT JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl ON true
          WHERE p.oid = exact_oid
            AND acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
        )
      END AS public_execute
    FROM function_target
  ),
  security_manifest AS (
    SELECT
      COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.merchants'::regclass), false) AS merchants_rls_enabled,
      COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.verification_disclosures'::regclass), false) AS disclosures_rls_enabled,
      EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'merchants'
          AND policyname = 'authenticated_read_own_team_or_admin_merchants'
          AND cmd = 'SELECT'
          AND roles && ARRAY['authenticated']::name[]
      ) AS narrow_merchants_select_policy_present,
      NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'merchants'
          AND (
            policyname IN ('Allow public read merchants', 'Allow public update merchants')
            OR (
              cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
              AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
            )
          )
      ) AS merchant_browser_write_policies_clear,
      NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'verification_disclosures'
          AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
      ) AS disclosure_browser_policies_clear,
      NOT has_table_privilege('anon', 'public.merchants', 'SELECT') AS anon_merchant_select_clear,
      has_table_privilege('authenticated', 'public.merchants', 'SELECT') AS authenticated_merchant_select_granted,
      NOT has_table_privilege('anon', 'public.merchants', 'UPDATE') AS anon_merchant_update_clear,
      NOT has_table_privilege('authenticated', 'public.merchants', 'UPDATE') AS authenticated_merchant_update_clear,
      NOT has_table_privilege('anon', 'public.verification_disclosures', 'INSERT') AS anon_disclosure_insert_clear,
      NOT has_table_privilege('authenticated', 'public.verification_disclosures', 'INSERT') AS authenticated_disclosure_insert_clear,
      NOT has_table_privilege('anon', 'public.verification_disclosures', 'UPDATE') AS anon_disclosure_update_clear,
      NOT has_table_privilege('authenticated', 'public.verification_disclosures', 'UPDATE') AS authenticated_disclosure_update_clear,
      NOT has_table_privilege('anon', 'public.verification_disclosures', 'DELETE') AS anon_disclosure_delete_clear,
      NOT has_table_privilege('authenticated', 'public.verification_disclosures', 'DELETE') AS authenticated_disclosure_delete_clear,
      NOT EXISTS (
        SELECT 1
        FROM pg_default_acl d
        JOIN pg_namespace n ON n.oid = d.defaclnamespace
        JOIN pg_roles owner_role ON owner_role.oid = d.defaclrole
        LEFT JOIN LATERAL aclexplode(d.defaclacl) acl ON true
        LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
        WHERE n.nspname = 'public'
          AND (
            owner_role.rolname IN ('postgres', current_user)
            OR pg_has_role(current_user, owner_role.rolname, 'MEMBER')
          )
          AND COALESCE(grantee_role.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated')
          AND acl.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'EXECUTE')
      ) AS unsafe_alterable_default_acl_clear,
      EXISTS (
        SELECT 1
        FROM pg_default_acl d
        JOIN pg_namespace n ON n.oid = d.defaclnamespace
        JOIN pg_roles owner_role ON owner_role.oid = d.defaclrole
        LEFT JOIN LATERAL aclexplode(d.defaclacl) acl ON true
        LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
        WHERE n.nspname = 'public'
          AND owner_role.rolname = 'supabase_admin'
          AND NOT (owner_role.rolname = current_user OR pg_has_role(current_user, owner_role.rolname, 'MEMBER'))
          AND COALESCE(grantee_role.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated')
          AND acl.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'EXECUTE')
      ) AS managed_unmodifiable_default_acl_present,
      COALESCE((
        SELECT string_agg(
          format(
            '%s:can_alter=%s',
            owner_role.rolname,
            owner_role.rolname = current_user OR pg_has_role(current_user, owner_role.rolname, 'MEMBER')
          ),
          ', ' ORDER BY owner_role.rolname
        )
        FROM pg_roles owner_role
        WHERE owner_role.rolname IN ('postgres', 'supabase_admin', current_user)
      ), 'none') AS default_acl_owner_capabilities
  ),
  checks AS (
    SELECT
      CASE
        WHEN exact_oid IS NOT NULL
          AND exact_count = 1
          AND overload_count = 1
          AND return_type = 'boolean'
          AND security_mode = 'DEFINER'
          AND COALESCE(search_path_ok, false)
          AND owner_name = current_user
        THEN 'PASS'
        ELSE 'FAIL'
      END AS status,
      'can_read_merchant_row_v1_signature' AS check_name,
      format(
        'exact_exists=%s exact_count=%s overload_count=%s return_type=%s security_mode=%s owner=%s search_path_ok=%s definition_hash=%s',
        exact_oid IS NOT NULL,
        exact_count,
        overload_count,
        COALESCE(return_type, 'absent'),
        COALESCE(security_mode, 'absent'),
        COALESCE(owner_name, 'absent'),
        COALESCE(search_path_ok::text, 'false'),
        COALESCE(definition_hash, 'absent')
      ) AS details
    FROM function_target
    CROSS JOIN rpc_details

    UNION ALL

    SELECT
      CASE WHEN authenticated_execute AND NOT anon_execute AND NOT public_execute THEN 'PASS' ELSE 'FAIL' END,
      'can_read_merchant_row_v1_execute_privileges',
      format('authenticated_execute=%s anon_execute=%s public_execute=%s', authenticated_execute, anon_execute, public_execute)
    FROM execute_manifest

    UNION ALL

    SELECT
      CASE WHEN merchants_rls_enabled AND disclosures_rls_enabled THEN 'PASS' ELSE 'FAIL' END,
      'rls_enabled',
      format('merchants_rls_enabled=%s disclosures_rls_enabled=%s', merchants_rls_enabled, disclosures_rls_enabled)
    FROM security_manifest

    UNION ALL

    SELECT
      CASE
        WHEN narrow_merchants_select_policy_present
          AND merchant_browser_write_policies_clear
          AND disclosure_browser_policies_clear
          AND anon_merchant_select_clear
          AND authenticated_merchant_select_granted
          AND anon_merchant_update_clear
          AND authenticated_merchant_update_clear
          AND anon_disclosure_insert_clear
          AND authenticated_disclosure_insert_clear
          AND anon_disclosure_update_clear
          AND authenticated_disclosure_update_clear
          AND anon_disclosure_delete_clear
          AND authenticated_disclosure_delete_clear
          AND unsafe_alterable_default_acl_clear
        THEN 'PASS'
        ELSE 'FAIL'
      END,
      'browser_write_surface_hardened',
      format(
        'narrow_merchants_select_policy_present=%s merchant_browser_write_policies_clear=%s disclosure_browser_policies_clear=%s anon_merchant_select_clear=%s authenticated_merchant_select_granted=%s anon_merchant_update_clear=%s authenticated_merchant_update_clear=%s anon_disclosure_insert_clear=%s authenticated_disclosure_insert_clear=%s anon_disclosure_update_clear=%s authenticated_disclosure_update_clear=%s anon_disclosure_delete_clear=%s authenticated_disclosure_delete_clear=%s unsafe_alterable_default_acl_clear=%s',
        narrow_merchants_select_policy_present,
        merchant_browser_write_policies_clear,
        disclosure_browser_policies_clear,
        anon_merchant_select_clear,
        authenticated_merchant_select_granted,
        anon_merchant_update_clear,
        authenticated_merchant_update_clear,
        anon_disclosure_insert_clear,
        authenticated_disclosure_insert_clear,
        anon_disclosure_update_clear,
        authenticated_disclosure_update_clear,
        anon_disclosure_delete_clear,
        authenticated_disclosure_delete_clear,
        unsafe_alterable_default_acl_clear
      )
    FROM security_manifest

    UNION ALL

    SELECT
      CASE WHEN managed_unmodifiable_default_acl_present THEN 'WARN' ELSE 'PASS' END,
      'managed_role_default_acl_unmodifiable',
      format(
        'managed_unmodifiable_default_acl_present=%s default_acl_owner_capabilities=%s',
        managed_unmodifiable_default_acl_present,
        default_acl_owner_capabilities
      )
    FROM security_manifest
  )
SELECT status, check_name, details
FROM checks
ORDER BY check_name;

WITH
  function_target AS (
    SELECT to_regprocedure('public.can_read_merchant_row_v1(uuid)')::oid AS exact_oid
  ),
  rpc_details AS (
    SELECT
      count(*) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid') AS exact_count,
      count(*) AS overload_count,
      max(pg_get_function_result(p.oid)) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid') AS return_type,
      max(CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid') AS security_mode,
      max(pg_get_userbyid(p.proowner)) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid') AS owner_name,
      bool_or(CASE WHEN p.proconfig IS NULL THEN false ELSE array_to_string(p.proconfig, ' ') ILIKE '%search_path=public, pg_temp%' END) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid') AS search_path_ok
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'can_read_merchant_row_v1'
  ),
  execute_manifest AS (
    SELECT
      CASE WHEN exact_oid IS NULL THEN false ELSE has_function_privilege('authenticated', exact_oid, 'EXECUTE') END AS authenticated_execute,
      CASE WHEN exact_oid IS NULL THEN false ELSE has_function_privilege('anon', exact_oid, 'EXECUTE') END AS anon_execute,
      CASE WHEN exact_oid IS NULL THEN true ELSE EXISTS (
        SELECT 1 FROM pg_proc p
        LEFT JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl ON true
        WHERE p.oid = exact_oid AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
      ) END AS public_execute
    FROM function_target
  ),
  security_manifest AS (
    SELECT
      COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.merchants'::regclass), false) AS merchants_rls_enabled,
      COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.verification_disclosures'::regclass), false) AS disclosures_rls_enabled,
      EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'merchants' AND policyname = 'authenticated_read_own_team_or_admin_merchants' AND cmd = 'SELECT' AND roles && ARRAY['authenticated']::name[]) AS narrow_merchants_select_policy_present,
      NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'merchants' AND (policyname IN ('Allow public read merchants', 'Allow public update merchants') OR (cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL') AND roles && ARRAY['public', 'anon', 'authenticated']::name[]))) AS merchant_browser_write_policies_clear,
      NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'verification_disclosures' AND roles && ARRAY['public', 'anon', 'authenticated']::name[]) AS disclosure_browser_policies_clear,
      NOT has_table_privilege('anon', 'public.merchants', 'SELECT') AS anon_merchant_select_clear,
      has_table_privilege('authenticated', 'public.merchants', 'SELECT') AS authenticated_merchant_select_granted,
      NOT has_table_privilege('anon', 'public.merchants', 'UPDATE') AS anon_merchant_update_clear,
      NOT has_table_privilege('authenticated', 'public.merchants', 'UPDATE') AS authenticated_merchant_update_clear,
      NOT has_table_privilege('anon', 'public.verification_disclosures', 'INSERT') AS anon_disclosure_insert_clear,
      NOT has_table_privilege('authenticated', 'public.verification_disclosures', 'INSERT') AS authenticated_disclosure_insert_clear,
      NOT has_table_privilege('anon', 'public.verification_disclosures', 'UPDATE') AS anon_disclosure_update_clear,
      NOT has_table_privilege('authenticated', 'public.verification_disclosures', 'UPDATE') AS authenticated_disclosure_update_clear,
      NOT has_table_privilege('anon', 'public.verification_disclosures', 'DELETE') AS anon_disclosure_delete_clear,
      NOT has_table_privilege('authenticated', 'public.verification_disclosures', 'DELETE') AS authenticated_disclosure_delete_clear,
      NOT EXISTS (
        SELECT 1 FROM pg_default_acl d
        JOIN pg_namespace n ON n.oid = d.defaclnamespace
        JOIN pg_roles owner_role ON owner_role.oid = d.defaclrole
        LEFT JOIN LATERAL aclexplode(d.defaclacl) acl ON true
        LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
        WHERE n.nspname = 'public'
          AND (
            owner_role.rolname IN ('postgres', current_user)
            OR pg_has_role(current_user, owner_role.rolname, 'MEMBER')
          )
          AND COALESCE(grantee_role.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated')
          AND acl.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'EXECUTE')
      ) AS unsafe_alterable_default_acl_clear
  ),
  checks AS (
    SELECT CASE WHEN exact_oid IS NOT NULL AND exact_count = 1 AND overload_count = 1 AND return_type = 'boolean' AND security_mode = 'DEFINER' AND COALESCE(search_path_ok, false) AND owner_name = current_user THEN 'PASS' ELSE 'FAIL' END AS status FROM function_target CROSS JOIN rpc_details
    UNION ALL
    SELECT CASE WHEN authenticated_execute AND NOT anon_execute AND NOT public_execute THEN 'PASS' ELSE 'FAIL' END FROM execute_manifest
    UNION ALL
    SELECT CASE WHEN merchants_rls_enabled AND disclosures_rls_enabled THEN 'PASS' ELSE 'FAIL' END FROM security_manifest
    UNION ALL
    SELECT CASE WHEN narrow_merchants_select_policy_present AND merchant_browser_write_policies_clear AND disclosure_browser_policies_clear AND anon_merchant_select_clear AND authenticated_merchant_select_granted AND anon_merchant_update_clear AND authenticated_merchant_update_clear AND anon_disclosure_insert_clear AND authenticated_disclosure_insert_clear AND anon_disclosure_update_clear AND authenticated_disclosure_update_clear AND anon_disclosure_delete_clear AND authenticated_disclosure_delete_clear AND unsafe_alterable_default_acl_clear THEN 'PASS' ELSE 'FAIL' END FROM security_manifest
  )
SELECT CASE WHEN EXISTS (SELECT 1 FROM checks WHERE status = 'FAIL') THEN 'true' ELSE 'false' END AS has_fail
\gset

\if :has_fail
\echo '014 authorization hardening postflight failed.'
SELECT 1 / 0;
\endif

ROLLBACK;
