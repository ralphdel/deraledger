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
    SELECT to_regprocedure(
      'public.record_verification_disclosure_acceptance_v1(uuid,uuid,uuid,text,text,text,text,text,jsonb)'
    )::oid AS exact_oid
  ),
  rpc_details AS (
    SELECT
      count(*) FILTER (
        WHERE oidvectortypes(p.proargtypes) =
          'uuid, uuid, uuid, text, text, text, text, text, jsonb'
      ) AS exact_count,
      count(*) AS overload_count,
      max(pg_get_function_result(p.oid)) FILTER (
        WHERE oidvectortypes(p.proargtypes) =
          'uuid, uuid, uuid, text, text, text, text, text, jsonb'
      ) AS return_type,
      max(CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END) FILTER (
        WHERE oidvectortypes(p.proargtypes) =
          'uuid, uuid, uuid, text, text, text, text, text, jsonb'
      ) AS security_mode,
      max(pg_get_userbyid(p.proowner)) FILTER (
        WHERE oidvectortypes(p.proargtypes) =
          'uuid, uuid, uuid, text, text, text, text, text, jsonb'
      ) AS owner_name,
      max(md5(pg_get_functiondef(p.oid))) FILTER (
        WHERE oidvectortypes(p.proargtypes) =
          'uuid, uuid, uuid, text, text, text, text, text, jsonb'
      ) AS definition_hash,
      bool_or(
        CASE
          WHEN p.proconfig IS NULL THEN false
          ELSE array_to_string(p.proconfig, ' ') ILIKE '%search_path=public, pg_temp%'
        END
      ) FILTER (
        WHERE oidvectortypes(p.proargtypes) =
          'uuid, uuid, uuid, text, text, text, text, text, jsonb'
      ) AS search_path_ok
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'record_verification_disclosure_acceptance_v1'
  ),
  execute_manifest AS (
    SELECT
      CASE WHEN exact_oid IS NULL THEN false ELSE has_function_privilege('service_role', exact_oid, 'EXECUTE') END AS service_role_execute,
      CASE WHEN exact_oid IS NULL THEN false ELSE has_function_privilege('anon', exact_oid, 'EXECUTE') END AS anon_execute,
      CASE WHEN exact_oid IS NULL THEN false ELSE has_function_privilege('authenticated', exact_oid, 'EXECUTE') END AS authenticated_execute,
      CASE
        WHEN exact_oid IS NULL THEN true
        ELSE EXISTS (
          SELECT 1
          FROM pg_proc p
          LEFT JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl ON TRUE
          WHERE p.oid = exact_oid
            AND acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
            AND acl.is_grantable = false
        )
      END AS public_execute
    FROM function_target
  ),
  column_manifest AS (
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'verification_disclosures'
          AND column_name = 'id' AND udt_name = 'uuid' AND is_nullable = 'NO'
      ) AS disclosure_id_ok,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'verification_disclosures'
          AND column_name = 'user_id' AND udt_name = 'uuid'
      ) AS disclosure_user_ok,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'verification_disclosures'
          AND column_name = 'merchant_id' AND udt_name = 'uuid'
      ) AS disclosure_merchant_ok,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'verification_disclosures'
          AND column_name = 'onboarding_session_id' AND udt_name = 'uuid'
      ) AS disclosure_session_ok,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'verification_disclosures'
          AND column_name = 'plan_type' AND udt_name IN ('text', 'varchar') AND is_nullable = 'NO'
      ) AS disclosure_plan_ok,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'verification_disclosures'
          AND column_name = 'context' AND udt_name IN ('text', 'varchar') AND is_nullable = 'NO'
      ) AS disclosure_context_ok,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'verification_disclosures'
          AND column_name = 'disclosure_version' AND udt_name IN ('text', 'varchar') AND is_nullable = 'NO'
      ) AS disclosure_version_ok,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'verification_disclosures'
          AND column_name = 'acknowledged_at' AND udt_name = 'timestamptz' AND is_nullable = 'NO'
      ) AS disclosure_acknowledged_at_ok,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'verification_disclosures'
          AND column_name = 'device_metadata' AND udt_name = 'jsonb'
      ) AS disclosure_metadata_ok,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'merchants'
          AND column_name = 'verification_disclosure_acknowledged_at' AND udt_name = 'timestamptz'
      ) AS merchant_acknowledged_at_ok,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'merchants'
          AND column_name = 'verification_disclosure_version' AND udt_name IN ('text', 'varchar')
      ) AS merchant_version_ok
  ),
  constraint_manifest AS (
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.table_constraints tc
        WHERE tc.table_schema = 'public'
          AND tc.table_name = 'verification_disclosures'
          AND tc.constraint_type = 'PRIMARY KEY'
      ) AS disclosure_pk_ok,
      EXISTS (
        SELECT 1
        FROM pg_constraint con
        WHERE con.conrelid = to_regclass('public.verification_disclosures')
          AND con.contype = 'f'
          AND con.confrelid = to_regclass('public.merchants')
      ) AS disclosure_merchant_fk_ok
  ),
  security_manifest AS (
    SELECT
      NOT EXISTS (
        SELECT 1
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'verification_disclosures'
          AND grantee IN ('PUBLIC', 'anon', 'authenticated')
          AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
      ) AS disclosure_browser_write_clear,
      NOT EXISTS (
        SELECT 1
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'merchants'
          AND grantee IN ('PUBLIC', 'anon', 'authenticated')
          AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
      ) AS merchant_browser_write_clear,
      NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'verification_disclosures'
          AND cmd IN ('INSERT', 'ALL')
          AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
      ) AS disclosure_browser_insert_policy_clear,
      NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'merchants'
          AND cmd IN ('UPDATE', 'ALL')
          AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
      ) AS merchant_browser_update_policy_clear
  )
SELECT *
FROM (
  SELECT
    CASE
      WHEN exact_oid IS NOT NULL
        AND exact_count = 1
        AND overload_count = 1
        AND return_type = 'jsonb'
        AND security_mode = 'DEFINER'
        AND COALESCE(search_path_ok, false)
        AND owner_name = current_user
      THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    'record_verification_disclosure_acceptance_v1_signature' AS check_name,
    format(
      'exact_exists=%s exact_count=%s overload_count=%s return_type=%s security_mode=%s owner=%s search_path_ok=%s',
      exact_oid IS NOT NULL,
      exact_count,
      overload_count,
      COALESCE(return_type, 'absent'),
      COALESCE(security_mode, 'absent'),
      COALESCE(owner_name, 'absent'),
      COALESCE(search_path_ok::text, 'false')
    ) AS details
  FROM function_target
  CROSS JOIN rpc_details

  UNION ALL

  SELECT
    CASE WHEN exact_oid IS NOT NULL AND definition_hash IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
    'record_verification_disclosure_acceptance_v1_definition_hash' AS check_name,
    format('exact_exists=%s definition_hash=%s', exact_oid IS NOT NULL, COALESCE(definition_hash, 'absent')) AS details
  FROM function_target
  CROSS JOIN rpc_details

  UNION ALL

  SELECT
    CASE
      WHEN service_role_execute
        AND NOT public_execute
        AND NOT anon_execute
        AND NOT authenticated_execute
      THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    'record_verification_disclosure_acceptance_v1_execute_privileges' AS check_name,
    format(
      'service_role_execute=%s public_execute=%s anon_execute=%s authenticated_execute=%s',
      service_role_execute,
      public_execute,
      anon_execute,
      authenticated_execute
    ) AS details
  FROM execute_manifest

  UNION ALL

  SELECT
    CASE
      WHEN disclosure_id_ok
        AND disclosure_user_ok
        AND disclosure_merchant_ok
        AND disclosure_session_ok
        AND disclosure_plan_ok
        AND disclosure_context_ok
        AND disclosure_version_ok
        AND disclosure_acknowledged_at_ok
        AND disclosure_metadata_ok
        AND merchant_acknowledged_at_ok
        AND merchant_version_ok
      THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    'disclosure_schema_preserved' AS check_name,
    format(
      'disclosure_id_ok=%s disclosure_user_ok=%s disclosure_merchant_ok=%s disclosure_session_ok=%s disclosure_plan_ok=%s disclosure_context_ok=%s disclosure_version_ok=%s disclosure_acknowledged_at_ok=%s disclosure_metadata_ok=%s merchant_acknowledged_at_ok=%s merchant_version_ok=%s',
      disclosure_id_ok,
      disclosure_user_ok,
      disclosure_merchant_ok,
      disclosure_session_ok,
      disclosure_plan_ok,
      disclosure_context_ok,
      disclosure_version_ok,
      disclosure_acknowledged_at_ok,
      disclosure_metadata_ok,
      merchant_acknowledged_at_ok,
      merchant_version_ok
    ) AS details
  FROM column_manifest

  UNION ALL

  SELECT
    CASE WHEN disclosure_pk_ok AND disclosure_merchant_fk_ok THEN 'PASS' ELSE 'FAIL' END AS status,
    'disclosure_constraints_preserved' AS check_name,
    format('disclosure_pk_ok=%s disclosure_merchant_fk_ok=%s', disclosure_pk_ok, disclosure_merchant_fk_ok) AS details
  FROM constraint_manifest

  UNION ALL

  SELECT
    CASE
      WHEN disclosure_browser_write_clear
        AND merchant_browser_write_clear
        AND disclosure_browser_insert_policy_clear
        AND merchant_browser_update_policy_clear
      THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    'browser_write_surface' AS check_name,
    format(
      'disclosure_browser_write_clear=%s merchant_browser_write_clear=%s disclosure_browser_insert_policy_clear=%s merchant_browser_update_policy_clear=%s',
      disclosure_browser_write_clear,
      merchant_browser_write_clear,
      disclosure_browser_insert_policy_clear,
      merchant_browser_update_policy_clear
    ) AS details
  FROM security_manifest
) checks
ORDER BY check_name;

WITH
  function_target AS (
    SELECT to_regprocedure(
      'public.record_verification_disclosure_acceptance_v1(uuid,uuid,uuid,text,text,text,text,text,jsonb)'
    )::oid AS exact_oid
  ),
  rpc_details AS (
    SELECT
      count(*) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS exact_count,
      count(*) AS overload_count,
      max(pg_get_function_result(p.oid)) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS return_type,
      max(CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS security_mode,
      max(pg_get_userbyid(p.proowner)) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS owner_name,
      bool_or(CASE WHEN p.proconfig IS NULL THEN false ELSE array_to_string(p.proconfig, ' ') ILIKE '%search_path=public, pg_temp%' END) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS search_path_ok
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'record_verification_disclosure_acceptance_v1'
  ),
  execute_manifest AS (
    SELECT
      CASE WHEN exact_oid IS NULL THEN false ELSE has_function_privilege('service_role', exact_oid, 'EXECUTE') END AS service_role_execute,
      CASE WHEN exact_oid IS NULL THEN false ELSE has_function_privilege('anon', exact_oid, 'EXECUTE') END AS anon_execute,
      CASE WHEN exact_oid IS NULL THEN false ELSE has_function_privilege('authenticated', exact_oid, 'EXECUTE') END AS authenticated_execute,
      CASE WHEN exact_oid IS NULL THEN true ELSE EXISTS (
        SELECT 1 FROM pg_proc p
        LEFT JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl ON TRUE
        WHERE p.oid = exact_oid AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE' AND acl.is_grantable = false
      ) END AS public_execute
    FROM function_target
  ),
  column_manifest AS (
    SELECT
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'verification_disclosures' AND column_name = 'id' AND udt_name = 'uuid' AND is_nullable = 'NO') AS disclosure_id_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'verification_disclosures' AND column_name = 'user_id' AND udt_name = 'uuid') AS disclosure_user_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'verification_disclosures' AND column_name = 'merchant_id' AND udt_name = 'uuid') AS disclosure_merchant_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'verification_disclosures' AND column_name = 'onboarding_session_id' AND udt_name = 'uuid') AS disclosure_session_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'verification_disclosures' AND column_name = 'plan_type' AND udt_name IN ('text', 'varchar') AND is_nullable = 'NO') AS disclosure_plan_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'verification_disclosures' AND column_name = 'context' AND udt_name IN ('text', 'varchar') AND is_nullable = 'NO') AS disclosure_context_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'verification_disclosures' AND column_name = 'disclosure_version' AND udt_name IN ('text', 'varchar') AND is_nullable = 'NO') AS disclosure_version_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'verification_disclosures' AND column_name = 'acknowledged_at' AND udt_name = 'timestamptz' AND is_nullable = 'NO') AS disclosure_acknowledged_at_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'verification_disclosures' AND column_name = 'device_metadata' AND udt_name = 'jsonb') AS disclosure_metadata_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'merchants' AND column_name = 'verification_disclosure_acknowledged_at' AND udt_name = 'timestamptz') AS merchant_acknowledged_at_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'merchants' AND column_name = 'verification_disclosure_version' AND udt_name IN ('text', 'varchar')) AS merchant_version_ok
  ),
  constraint_manifest AS (
    SELECT
      EXISTS (SELECT 1 FROM information_schema.table_constraints tc WHERE tc.table_schema = 'public' AND tc.table_name = 'verification_disclosures' AND tc.constraint_type = 'PRIMARY KEY') AS disclosure_pk_ok,
      EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conrelid = to_regclass('public.verification_disclosures') AND con.contype = 'f' AND con.confrelid = to_regclass('public.merchants')) AS disclosure_merchant_fk_ok
  ),
  security_manifest AS (
    SELECT
      NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'verification_disclosures' AND grantee IN ('PUBLIC', 'anon', 'authenticated') AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')) AS disclosure_browser_write_clear,
      NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'merchants' AND grantee IN ('PUBLIC', 'anon', 'authenticated') AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')) AS merchant_browser_write_clear,
      NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'verification_disclosures' AND cmd IN ('INSERT', 'ALL') AND roles && ARRAY['public', 'anon', 'authenticated']::name[]) AS disclosure_browser_insert_policy_clear,
      NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'merchants' AND cmd IN ('UPDATE', 'ALL') AND roles && ARRAY['public', 'anon', 'authenticated']::name[]) AS merchant_browser_update_policy_clear
  ),
  checks AS (
    SELECT CASE WHEN exact_oid IS NOT NULL AND exact_count = 1 AND overload_count = 1 AND return_type = 'jsonb' AND security_mode = 'DEFINER' AND COALESCE(search_path_ok, false) AND owner_name = current_user THEN 'PASS' ELSE 'FAIL' END AS status FROM function_target CROSS JOIN rpc_details
    UNION ALL
    SELECT CASE WHEN exact_oid IS NOT NULL THEN 'PASS' ELSE 'FAIL' END FROM function_target CROSS JOIN rpc_details
    UNION ALL
    SELECT CASE WHEN service_role_execute AND NOT public_execute AND NOT anon_execute AND NOT authenticated_execute THEN 'PASS' ELSE 'FAIL' END FROM execute_manifest
    UNION ALL
    SELECT CASE WHEN disclosure_id_ok AND disclosure_user_ok AND disclosure_merchant_ok AND disclosure_session_ok AND disclosure_plan_ok AND disclosure_context_ok AND disclosure_version_ok AND disclosure_acknowledged_at_ok AND disclosure_metadata_ok AND merchant_acknowledged_at_ok AND merchant_version_ok THEN 'PASS' ELSE 'FAIL' END FROM column_manifest
    UNION ALL
    SELECT CASE WHEN disclosure_pk_ok AND disclosure_merchant_fk_ok THEN 'PASS' ELSE 'FAIL' END FROM constraint_manifest
    UNION ALL
    SELECT CASE WHEN disclosure_browser_write_clear AND merchant_browser_write_clear AND disclosure_browser_insert_policy_clear AND merchant_browser_update_policy_clear THEN 'PASS' ELSE 'FAIL' END FROM security_manifest
  )
SELECT CASE WHEN EXISTS (SELECT 1 FROM checks WHERE status = 'FAIL') THEN 'true' ELSE 'false' END AS has_fail
\gset

\if :has_fail
\echo '015 verification disclosure acknowledgement postflight failed.'
SELECT 1 / 0;
\endif

ROLLBACK;
