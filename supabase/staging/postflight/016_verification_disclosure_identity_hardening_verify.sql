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
      count(*) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS exact_count,
      count(*) AS overload_count,
      max(pg_get_function_result(p.oid)) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS return_type,
      max(CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS security_mode,
      max(pg_get_userbyid(p.proowner)) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS owner_name,
      max(md5(pg_get_functiondef(p.oid))) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS definition_hash,
      bool_or(CASE WHEN p.proconfig IS NULL THEN false ELSE array_to_string(p.proconfig, ' ') ILIKE '%search_path=public, pg_temp%' END) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS search_path_ok,
      bool_or(pg_get_functiondef(p.oid) LIKE '%verification-disclosure:onboarding:%') FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS onboarding_lock_ok,
      bool_or(pg_get_functiondef(p.oid) LIKE '%verification-disclosure:upgrade:%') FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS upgrade_lock_ok,
      bool_or(pg_get_functiondef(p.oid) LIKE '%WHERE onboarding_session_id = p_onboarding_session_id%AND is_canonical = true%') FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS onboarding_predicate_ok,
      bool_or(pg_get_functiondef(p.oid) LIKE '%WHERE onboarding_session_id IS NULL%AND merchant_id = p_merchant_id%AND user_id IS NOT DISTINCT FROM p_user_id%AND is_canonical = true%') FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS upgrade_predicate_ok
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
        SELECT 1
        FROM pg_proc p
        LEFT JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl ON TRUE
        WHERE p.oid = exact_oid
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
          AND acl.is_grantable = false
      ) END AS public_execute
    FROM function_target
  ),
  column_manifest AS (
    SELECT
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'verification_disclosures' AND column_name = 'is_canonical' AND udt_name = 'bool' AND is_nullable = 'NO' AND column_default = 'true') AS is_canonical_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'verification_disclosures' AND column_name = 'superseded_by_disclosure_id' AND udt_name = 'uuid') AS superseded_ok
  ),
  constraint_manifest AS (
    SELECT
      EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.verification_disclosures'::regclass AND conname = 'verification_disclosures_superseded_by_fkey' AND convalidated) AS superseded_fk_ok,
      EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.verification_disclosures'::regclass AND conname = 'verification_disclosures_canonical_reference_state' AND convalidated) AS state_check_ok,
      EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.verification_disclosures'::regclass AND conname = 'verification_disclosures_no_self_supersede' AND convalidated) AS self_check_ok
  ),
  index_manifest AS (
    SELECT
      pg_get_indexdef(to_regclass('public.idx_verification_disclosures_onboarding_canonical_identity')) AS onboarding_indexdef,
      pg_get_indexdef(to_regclass('public.idx_verification_disclosures_upgrade_canonical_identity')) AS upgrade_indexdef
  ),
  canonical_groups AS (
    SELECT
      CASE WHEN onboarding_session_id IS NOT NULL THEN 'onboarding' ELSE 'upgrade' END AS identity_mode,
      CASE WHEN onboarding_session_id IS NOT NULL THEN onboarding_session_id ELSE NULL END AS session_key,
      CASE WHEN onboarding_session_id IS NULL THEN merchant_id ELSE NULL END AS merchant_key,
      CASE WHEN onboarding_session_id IS NULL THEN user_id ELSE NULL END AS user_key,
      plan_type,
      context,
      disclosure_version,
      count(*) AS row_count,
      count(*) FILTER (WHERE is_canonical) AS canonical_count
    FROM public.verification_disclosures
    GROUP BY
      CASE WHEN onboarding_session_id IS NOT NULL THEN 'onboarding' ELSE 'upgrade' END,
      CASE WHEN onboarding_session_id IS NOT NULL THEN onboarding_session_id ELSE NULL END,
      CASE WHEN onboarding_session_id IS NULL THEN merchant_id ELSE NULL END,
      CASE WHEN onboarding_session_id IS NULL THEN user_id ELSE NULL END,
      plan_type,
      context,
      disclosure_version
  ),
  invalid_canonicalization AS (
    SELECT count(*) AS invalid_count
    FROM canonical_groups
    WHERE canonical_count <> 1
  ),
  invalid_references AS (
    SELECT count(*) AS invalid_count
    FROM public.verification_disclosures vd
    LEFT JOIN public.verification_disclosures canonical
      ON canonical.id = vd.superseded_by_disclosure_id
    WHERE vd.is_canonical = false
      AND (
        vd.superseded_by_disclosure_id IS NULL
        OR canonical.id IS NULL
        OR canonical.is_canonical IS DISTINCT FROM true
        OR vd.superseded_by_disclosure_id = vd.id
      )
  ),
  security_manifest AS (
    SELECT
      NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'verification_disclosures' AND grantee IN ('PUBLIC', 'anon', 'authenticated') AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')) AS disclosure_browser_write_clear,
      NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'merchants' AND grantee IN ('PUBLIC', 'anon', 'authenticated') AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')) AS merchant_browser_write_clear,
      to_regprocedure('public.can_read_merchant_row_v1(uuid)') IS NOT NULL AS merchant_read_helper_exists
  )
SELECT *
FROM (
  SELECT
    CASE WHEN is_canonical_ok AND superseded_ok THEN 'PASS' ELSE 'FAIL' END AS status,
    'canonical_columns' AS check_name,
    format('is_canonical_ok=%s superseded_ok=%s', is_canonical_ok, superseded_ok) AS details
  FROM column_manifest

  UNION ALL

  SELECT
    CASE WHEN superseded_fk_ok AND state_check_ok AND self_check_ok THEN 'PASS' ELSE 'FAIL' END,
    'canonical_constraints',
    format('superseded_fk_ok=%s state_check_ok=%s self_check_ok=%s', superseded_fk_ok, state_check_ok, self_check_ok)
  FROM constraint_manifest

  UNION ALL

  SELECT
    CASE
      WHEN onboarding_indexdef LIKE '%UNIQUE INDEX idx_verification_disclosures_onboarding_canonical_identity%'
        AND onboarding_indexdef LIKE '%onboarding_session_id, plan_type, context, disclosure_version%'
        AND onboarding_indexdef LIKE '%WHERE ((onboarding_session_id IS NOT NULL) AND (is_canonical = true))%'
        AND upgrade_indexdef LIKE '%UNIQUE INDEX idx_verification_disclosures_upgrade_canonical_identity%'
        AND upgrade_indexdef LIKE '%NULLS NOT DISTINCT%'
        AND upgrade_indexdef LIKE '%merchant_id, user_id, plan_type, context, disclosure_version%'
        AND upgrade_indexdef LIKE '%WHERE ((onboarding_session_id IS NULL) AND (is_canonical = true))%'
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    'canonical_unique_indexes',
    format('onboarding_index=%s upgrade_index=%s', COALESCE(onboarding_indexdef, 'absent'), COALESCE(upgrade_indexdef, 'absent'))
  FROM index_manifest

  UNION ALL

  SELECT
    CASE WHEN invalid_count = 0 THEN 'PASS' ELSE 'FAIL' END,
    'one_canonical_per_logical_identity',
    format('invalid_groups=%s', invalid_count)
  FROM invalid_canonicalization

  UNION ALL

  SELECT
    CASE WHEN invalid_count = 0 THEN 'PASS' ELSE 'FAIL' END,
    'noncanonical_reference_integrity',
    format('invalid_noncanonical_references=%s', invalid_count)
  FROM invalid_references

  UNION ALL

  SELECT
    CASE
      WHEN exact_oid IS NOT NULL
        AND exact_count = 1
        AND overload_count = 1
        AND return_type = 'jsonb'
        AND security_mode = 'DEFINER'
        AND owner_name = current_user
        AND COALESCE(search_path_ok, false)
        AND COALESCE(onboarding_lock_ok, false)
        AND COALESCE(upgrade_lock_ok, false)
        AND COALESCE(onboarding_predicate_ok, false)
        AND COALESCE(upgrade_predicate_ok, false)
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    'record_verification_disclosure_acceptance_v1_identity_contract',
    format('exact_exists=%s exact_count=%s overload_count=%s return_type=%s security_mode=%s owner=%s search_path_ok=%s onboarding_lock_ok=%s upgrade_lock_ok=%s onboarding_predicate_ok=%s upgrade_predicate_ok=%s definition_hash=%s', exact_oid IS NOT NULL, exact_count, overload_count, COALESCE(return_type, 'absent'), COALESCE(security_mode, 'absent'), COALESCE(owner_name, 'absent'), COALESCE(search_path_ok::text, 'false'), COALESCE(onboarding_lock_ok::text, 'false'), COALESCE(upgrade_lock_ok::text, 'false'), COALESCE(onboarding_predicate_ok::text, 'false'), COALESCE(upgrade_predicate_ok::text, 'false'), COALESCE(definition_hash, 'absent'))
  FROM function_target
  CROSS JOIN rpc_details

  UNION ALL

  SELECT
    CASE WHEN service_role_execute AND NOT public_execute AND NOT anon_execute AND NOT authenticated_execute THEN 'PASS' ELSE 'FAIL' END,
    'record_verification_disclosure_acceptance_v1_execute_privileges',
    format('service_role_execute=%s public_execute=%s anon_execute=%s authenticated_execute=%s', service_role_execute, public_execute, anon_execute, authenticated_execute)
  FROM execute_manifest

  UNION ALL

  SELECT
    CASE WHEN disclosure_browser_write_clear AND merchant_browser_write_clear AND merchant_read_helper_exists THEN 'PASS' ELSE 'FAIL' END,
    'authorization_hardening_preserved',
    format('disclosure_browser_write_clear=%s merchant_browser_write_clear=%s merchant_read_helper_exists=%s', disclosure_browser_write_clear, merchant_browser_write_clear, merchant_read_helper_exists)
  FROM security_manifest
) checks
ORDER BY check_name;

WITH
  function_target AS (
    SELECT to_regprocedure('public.record_verification_disclosure_acceptance_v1(uuid,uuid,uuid,text,text,text,text,text,jsonb)')::oid AS exact_oid
  ),
  rpc_details AS (
    SELECT
      count(*) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS exact_count,
      count(*) AS overload_count,
      max(pg_get_function_result(p.oid)) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS return_type,
      max(CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS security_mode,
      max(pg_get_userbyid(p.proowner)) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS owner_name,
      bool_or(CASE WHEN p.proconfig IS NULL THEN false ELSE array_to_string(p.proconfig, ' ') ILIKE '%search_path=public, pg_temp%' END) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS search_path_ok,
      bool_or(pg_get_functiondef(p.oid) LIKE '%verification-disclosure:onboarding:%') FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS onboarding_lock_ok,
      bool_or(pg_get_functiondef(p.oid) LIKE '%verification-disclosure:upgrade:%') FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS upgrade_lock_ok,
      bool_or(pg_get_functiondef(p.oid) LIKE '%WHERE onboarding_session_id = p_onboarding_session_id%AND is_canonical = true%') FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS onboarding_predicate_ok,
      bool_or(pg_get_functiondef(p.oid) LIKE '%WHERE onboarding_session_id IS NULL%AND merchant_id = p_merchant_id%AND user_id IS NOT DISTINCT FROM p_user_id%AND is_canonical = true%') FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS upgrade_predicate_ok
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'record_verification_disclosure_acceptance_v1'
  ),
  execute_manifest AS (
    SELECT
      CASE WHEN exact_oid IS NULL THEN false ELSE has_function_privilege('service_role', exact_oid, 'EXECUTE') END AS service_role_execute,
      CASE WHEN exact_oid IS NULL THEN false ELSE has_function_privilege('anon', exact_oid, 'EXECUTE') END AS anon_execute,
      CASE WHEN exact_oid IS NULL THEN false ELSE has_function_privilege('authenticated', exact_oid, 'EXECUTE') END AS authenticated_execute,
      CASE WHEN exact_oid IS NULL THEN true ELSE EXISTS (SELECT 1 FROM pg_proc p LEFT JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl ON TRUE WHERE p.oid = exact_oid AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE' AND acl.is_grantable = false) END AS public_execute
    FROM function_target
  ),
  column_manifest AS (
    SELECT
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'verification_disclosures' AND column_name = 'is_canonical' AND udt_name = 'bool' AND is_nullable = 'NO' AND column_default = 'true') AS is_canonical_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'verification_disclosures' AND column_name = 'superseded_by_disclosure_id' AND udt_name = 'uuid') AS superseded_ok
  ),
  constraint_manifest AS (
    SELECT
      EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.verification_disclosures'::regclass AND conname = 'verification_disclosures_superseded_by_fkey' AND convalidated) AS superseded_fk_ok,
      EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.verification_disclosures'::regclass AND conname = 'verification_disclosures_canonical_reference_state' AND convalidated) AS state_check_ok,
      EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.verification_disclosures'::regclass AND conname = 'verification_disclosures_no_self_supersede' AND convalidated) AS self_check_ok
  ),
  index_manifest AS (
    SELECT
      pg_get_indexdef(to_regclass('public.idx_verification_disclosures_onboarding_canonical_identity')) AS onboarding_indexdef,
      pg_get_indexdef(to_regclass('public.idx_verification_disclosures_upgrade_canonical_identity')) AS upgrade_indexdef
  ),
  canonical_groups AS (
    SELECT
      CASE WHEN onboarding_session_id IS NOT NULL THEN 'onboarding' ELSE 'upgrade' END AS identity_mode,
      CASE WHEN onboarding_session_id IS NOT NULL THEN onboarding_session_id ELSE NULL END AS session_key,
      CASE WHEN onboarding_session_id IS NULL THEN merchant_id ELSE NULL END AS merchant_key,
      CASE WHEN onboarding_session_id IS NULL THEN user_id ELSE NULL END AS user_key,
      plan_type,
      context,
      disclosure_version,
      count(*) FILTER (WHERE is_canonical) AS canonical_count
    FROM public.verification_disclosures
    GROUP BY
      CASE WHEN onboarding_session_id IS NOT NULL THEN 'onboarding' ELSE 'upgrade' END,
      CASE WHEN onboarding_session_id IS NOT NULL THEN onboarding_session_id ELSE NULL END,
      CASE WHEN onboarding_session_id IS NULL THEN merchant_id ELSE NULL END,
      CASE WHEN onboarding_session_id IS NULL THEN user_id ELSE NULL END,
      plan_type,
      context,
      disclosure_version
  ),
  invalid_canonicalization AS (
    SELECT count(*) AS invalid_count FROM canonical_groups WHERE canonical_count <> 1
  ),
  invalid_references AS (
    SELECT count(*) AS invalid_count
    FROM public.verification_disclosures vd
    LEFT JOIN public.verification_disclosures canonical ON canonical.id = vd.superseded_by_disclosure_id
    WHERE vd.is_canonical = false
      AND (vd.superseded_by_disclosure_id IS NULL OR canonical.id IS NULL OR canonical.is_canonical IS DISTINCT FROM true OR vd.superseded_by_disclosure_id = vd.id)
  ),
  security_manifest AS (
    SELECT
      NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'verification_disclosures' AND grantee IN ('PUBLIC', 'anon', 'authenticated') AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')) AS disclosure_browser_write_clear,
      NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'merchants' AND grantee IN ('PUBLIC', 'anon', 'authenticated') AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')) AS merchant_browser_write_clear,
      to_regprocedure('public.can_read_merchant_row_v1(uuid)') IS NOT NULL AS merchant_read_helper_exists
  ),
  checks AS (
    SELECT CASE WHEN is_canonical_ok AND superseded_ok THEN 'PASS' ELSE 'FAIL' END AS status FROM column_manifest
    UNION ALL
    SELECT CASE WHEN superseded_fk_ok AND state_check_ok AND self_check_ok THEN 'PASS' ELSE 'FAIL' END FROM constraint_manifest
    UNION ALL
    SELECT CASE WHEN onboarding_indexdef LIKE '%UNIQUE INDEX idx_verification_disclosures_onboarding_canonical_identity%' AND onboarding_indexdef LIKE '%onboarding_session_id, plan_type, context, disclosure_version%' AND onboarding_indexdef LIKE '%WHERE ((onboarding_session_id IS NOT NULL) AND (is_canonical = true))%' AND upgrade_indexdef LIKE '%UNIQUE INDEX idx_verification_disclosures_upgrade_canonical_identity%' AND upgrade_indexdef LIKE '%NULLS NOT DISTINCT%' AND upgrade_indexdef LIKE '%merchant_id, user_id, plan_type, context, disclosure_version%' AND upgrade_indexdef LIKE '%WHERE ((onboarding_session_id IS NULL) AND (is_canonical = true))%' THEN 'PASS' ELSE 'FAIL' END FROM index_manifest
    UNION ALL
    SELECT CASE WHEN invalid_count = 0 THEN 'PASS' ELSE 'FAIL' END FROM invalid_canonicalization
    UNION ALL
    SELECT CASE WHEN invalid_count = 0 THEN 'PASS' ELSE 'FAIL' END FROM invalid_references
    UNION ALL
    SELECT CASE WHEN exact_oid IS NOT NULL AND exact_count = 1 AND overload_count = 1 AND return_type = 'jsonb' AND security_mode = 'DEFINER' AND owner_name = current_user AND COALESCE(search_path_ok, false) AND COALESCE(onboarding_lock_ok, false) AND COALESCE(upgrade_lock_ok, false) AND COALESCE(onboarding_predicate_ok, false) AND COALESCE(upgrade_predicate_ok, false) THEN 'PASS' ELSE 'FAIL' END FROM function_target CROSS JOIN rpc_details
    UNION ALL
    SELECT CASE WHEN service_role_execute AND NOT public_execute AND NOT anon_execute AND NOT authenticated_execute THEN 'PASS' ELSE 'FAIL' END FROM execute_manifest
    UNION ALL
    SELECT CASE WHEN disclosure_browser_write_clear AND merchant_browser_write_clear AND merchant_read_helper_exists THEN 'PASS' ELSE 'FAIL' END FROM security_manifest
  )
SELECT CASE WHEN EXISTS (SELECT 1 FROM checks WHERE status = 'FAIL') THEN 'true' ELSE 'false' END AS has_fail
\gset

\if :has_fail
\echo '016 verification disclosure identity hardening postflight failed.'
SELECT 1 / 0;
\endif

ROLLBACK;
