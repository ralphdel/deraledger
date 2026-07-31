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
  table_manifest AS (
    SELECT
      to_regclass('public.merchants') IS NOT NULL AS merchants_ok,
      to_regclass('public.verification_disclosures') IS NOT NULL AS verification_disclosures_ok,
      to_regclass('public.merchant_team') IS NOT NULL AS merchant_team_ok
  ),
  column_manifest AS (
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'merchants'
          AND column_name = 'id' AND udt_name = 'uuid'
      ) AS merchant_id_ok,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'merchants'
          AND column_name = 'user_id' AND udt_name = 'uuid'
      ) AS merchant_user_ok,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'merchants'
          AND column_name = 'is_super_admin' AND udt_name = 'bool'
      ) AS merchant_super_admin_ok,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'merchants'
          AND column_name = 'verification_disclosure_acknowledged_at' AND udt_name = 'timestamptz'
      ) AS merchant_acknowledged_at_ok,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'merchants'
          AND column_name = 'verification_disclosure_version' AND udt_name IN ('text', 'varchar')
      ) AS merchant_version_ok,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'verification_disclosures'
          AND column_name = 'id' AND udt_name = 'uuid'
      ) AS disclosure_id_ok,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'verification_disclosures'
          AND column_name = 'merchant_id' AND udt_name = 'uuid'
      ) AS disclosure_merchant_ok,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'verification_disclosures'
          AND column_name = 'disclosure_version' AND udt_name IN ('text', 'varchar')
      ) AS disclosure_version_ok
  ),
  security_manifest AS (
    SELECT
      COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.merchants'::regclass), false) AS merchants_rls_enabled,
      COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.verification_disclosures'::regclass), false) AS disclosures_rls_enabled,
      EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'merchants'
          AND policyname = 'Allow public read merchants'
      ) AS legacy_public_read_merchants_policy_present,
      EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'merchants'
          AND policyname = 'Allow public update merchants'
      ) AS legacy_public_update_merchants_policy_present,
      EXISTS (
        SELECT 1
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'merchants'
          AND grantee IN ('PUBLIC', 'anon', 'authenticated')
          AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
      ) AS merchant_browser_write_grants_present,
      EXISTS (
        SELECT 1
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'verification_disclosures'
          AND grantee IN ('PUBLIC', 'anon', 'authenticated')
          AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
      ) AS disclosure_browser_grants_present,
      EXISTS (
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
      ) AS unsafe_alterable_default_acl_present,
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
  rpc_manifest AS (
    SELECT
      count(*) AS helper_overload_count,
      count(*) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid') AS helper_exact_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'can_read_merchant_row_v1'
  ),
  checks AS (
    SELECT
      CASE WHEN merchants_ok AND verification_disclosures_ok AND merchant_team_ok THEN 'PASS' ELSE 'FAIL' END AS status,
      'prerequisite_tables' AS check_name,
      format('merchants_ok=%s verification_disclosures_ok=%s merchant_team_ok=%s', merchants_ok, verification_disclosures_ok, merchant_team_ok) AS details
    FROM table_manifest

    UNION ALL

    SELECT
      CASE
        WHEN merchant_id_ok
          AND merchant_user_ok
          AND merchant_acknowledged_at_ok
          AND merchant_version_ok
          AND disclosure_id_ok
          AND disclosure_merchant_ok
          AND disclosure_version_ok
        THEN 'PASS'
        ELSE 'FAIL'
      END,
      'prerequisite_columns',
      format(
        'merchant_id_ok=%s merchant_user_ok=%s merchant_super_admin_ok=%s merchant_acknowledged_at_ok=%s merchant_version_ok=%s disclosure_id_ok=%s disclosure_merchant_ok=%s disclosure_version_ok=%s',
        merchant_id_ok,
        merchant_user_ok,
        merchant_super_admin_ok,
        merchant_acknowledged_at_ok,
        merchant_version_ok,
        disclosure_id_ok,
        disclosure_merchant_ok,
        disclosure_version_ok
      )
    FROM column_manifest

    UNION ALL

    SELECT
      CASE WHEN merchants_rls_enabled AND disclosures_rls_enabled THEN 'PASS' ELSE 'WARN' END,
      'rls_enabled',
      format('merchants_rls_enabled=%s disclosures_rls_enabled=%s', merchants_rls_enabled, disclosures_rls_enabled)
    FROM security_manifest

    UNION ALL

    SELECT
      CASE
        WHEN legacy_public_read_merchants_policy_present
          OR legacy_public_update_merchants_policy_present
          OR merchant_browser_write_grants_present
          OR disclosure_browser_grants_present
          OR unsafe_alterable_default_acl_present
          OR managed_unmodifiable_default_acl_present
          OR NOT merchant_super_admin_ok
        THEN 'WARN'
        ELSE 'PASS'
      END,
      'repairable_browser_surface',
      format(
        'legacy_public_read_merchants_policy_present=%s legacy_public_update_merchants_policy_present=%s merchant_browser_write_grants_present=%s disclosure_browser_grants_present=%s unsafe_alterable_default_acl_present=%s managed_unmodifiable_default_acl_present=%s default_acl_owner_capabilities=%s merchant_super_admin_ok=%s',
        legacy_public_read_merchants_policy_present,
        legacy_public_update_merchants_policy_present,
        merchant_browser_write_grants_present,
        disclosure_browser_grants_present,
        unsafe_alterable_default_acl_present,
        managed_unmodifiable_default_acl_present,
        default_acl_owner_capabilities,
        merchant_super_admin_ok
      )
    FROM security_manifest
    CROSS JOIN column_manifest

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

    UNION ALL

    SELECT
      CASE WHEN helper_overload_count = 0 THEN 'PASS' ELSE 'FAIL' END,
      'existing_helper_shape',
      format('helper_overload_count=%s helper_exact_count=%s', helper_overload_count, helper_exact_count)
    FROM rpc_manifest
  )
SELECT status, check_name, details
FROM checks
ORDER BY check_name;

WITH
  table_manifest AS (
    SELECT
      to_regclass('public.merchants') IS NOT NULL AS merchants_ok,
      to_regclass('public.verification_disclosures') IS NOT NULL AS verification_disclosures_ok,
      to_regclass('public.merchant_team') IS NOT NULL AS merchant_team_ok
  ),
  column_manifest AS (
    SELECT
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'merchants' AND column_name = 'id' AND udt_name = 'uuid') AS merchant_id_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'merchants' AND column_name = 'user_id' AND udt_name = 'uuid') AS merchant_user_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'merchants' AND column_name = 'is_super_admin' AND udt_name = 'bool') AS merchant_super_admin_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'merchants' AND column_name = 'verification_disclosure_acknowledged_at' AND udt_name = 'timestamptz') AS merchant_acknowledged_at_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'merchants' AND column_name = 'verification_disclosure_version' AND udt_name IN ('text', 'varchar')) AS merchant_version_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'verification_disclosures' AND column_name = 'id' AND udt_name = 'uuid') AS disclosure_id_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'verification_disclosures' AND column_name = 'merchant_id' AND udt_name = 'uuid') AS disclosure_merchant_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'verification_disclosures' AND column_name = 'disclosure_version' AND udt_name IN ('text', 'varchar')) AS disclosure_version_ok
  ),
  security_manifest AS (
    SELECT
      COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.merchants'::regclass), false) AS merchants_rls_enabled,
      COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.verification_disclosures'::regclass), false) AS disclosures_rls_enabled
  ),
  rpc_manifest AS (
    SELECT count(*) AS helper_overload_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'can_read_merchant_row_v1'
  ),
  checks AS (
    SELECT CASE WHEN merchants_ok AND verification_disclosures_ok AND merchant_team_ok THEN 'PASS' ELSE 'FAIL' END AS status FROM table_manifest
    UNION ALL
    SELECT CASE WHEN merchant_id_ok AND merchant_user_ok AND merchant_acknowledged_at_ok AND merchant_version_ok AND disclosure_id_ok AND disclosure_merchant_ok AND disclosure_version_ok THEN 'PASS' ELSE 'FAIL' END FROM column_manifest
    UNION ALL
    SELECT CASE WHEN helper_overload_count = 0 THEN 'PASS' ELSE 'FAIL' END FROM rpc_manifest
  )
SELECT CASE WHEN EXISTS (SELECT 1 FROM checks WHERE status = 'FAIL') THEN 'true' ELSE 'false' END AS has_fail
\gset

\if :has_fail
\echo '014 authorization hardening preflight failed.'
SELECT 1 / 0;
\endif

ROLLBACK;
