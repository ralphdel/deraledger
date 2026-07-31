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
      to_regclass('public.verification_disclosures') IS NOT NULL AS verification_disclosures_ok,
      to_regclass('public.merchants') IS NOT NULL AS merchants_ok,
      to_regclass('public.onboarding_sessions') IS NOT NULL AS onboarding_sessions_ok
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
  rpc_manifest AS (
    SELECT
      count(*) AS overload_count,
      count(*) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS exact_count,
      max(pg_get_function_result(p.oid)) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS return_type,
      max(CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS security_mode,
      max(md5(pg_get_functiondef(p.oid))) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS definition_hash
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'record_verification_disclosure_acceptance_v1'
  ),
  security_manifest AS (
    SELECT
      NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'verification_disclosures' AND grantee IN ('PUBLIC', 'anon', 'authenticated') AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')) AS disclosure_browser_write_clear,
      NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'merchants' AND grantee IN ('PUBLIC', 'anon', 'authenticated') AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')) AS merchant_browser_write_clear
  ),
  duplicate_groups AS (
    SELECT
      CASE WHEN onboarding_session_id IS NOT NULL THEN 'onboarding' ELSE 'upgrade' END AS identity_mode,
      count(*) AS row_count
    FROM public.verification_disclosures
    GROUP BY
      CASE WHEN onboarding_session_id IS NOT NULL THEN 'onboarding' ELSE 'upgrade' END,
      CASE WHEN onboarding_session_id IS NOT NULL THEN onboarding_session_id ELSE NULL END,
      CASE WHEN onboarding_session_id IS NULL THEN merchant_id ELSE NULL END,
      CASE WHEN onboarding_session_id IS NULL THEN user_id ELSE NULL END,
      plan_type,
      context,
      disclosure_version
    HAVING count(*) > 1
  ),
  duplicate_manifest AS (
    SELECT
      count(*) AS duplicate_group_count,
      COALESCE(sum(row_count - 1), 0)::integer AS duplicate_extra_row_count,
      count(*) FILTER (WHERE identity_mode = 'upgrade') AS null_session_duplicate_groups,
      count(*) FILTER (WHERE identity_mode = 'onboarding') AS nonnull_session_duplicate_groups
    FROM duplicate_groups
  ),
  reference_manifest AS (
    SELECT count(*) AS fk_reference_count
    FROM pg_constraint
    WHERE contype = 'f'
      AND confrelid = 'public.verification_disclosures'::regclass
  ),
  migration_016_manifest AS (
    SELECT
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'verification_disclosures' AND column_name = 'is_canonical') AS is_canonical_exists,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'verification_disclosures' AND column_name = 'superseded_by_disclosure_id') AS superseded_exists,
      to_regclass('public.idx_verification_disclosures_onboarding_canonical_identity') IS NOT NULL AS onboarding_index_exists,
      to_regclass('public.idx_verification_disclosures_upgrade_canonical_identity') IS NOT NULL AS upgrade_index_exists
  )
SELECT *
FROM (
  SELECT
    CASE WHEN verification_disclosures_ok AND merchants_ok AND onboarding_sessions_ok THEN 'PASS' ELSE 'FAIL' END AS status,
    'prerequisite_tables' AS check_name,
    format('verification_disclosures_ok=%s merchants_ok=%s onboarding_sessions_ok=%s', verification_disclosures_ok, merchants_ok, onboarding_sessions_ok) AS details
  FROM table_manifest

  UNION ALL

  SELECT
    CASE WHEN disclosure_id_ok AND disclosure_user_ok AND disclosure_merchant_ok AND disclosure_session_ok AND disclosure_plan_ok AND disclosure_context_ok AND disclosure_version_ok AND disclosure_acknowledged_at_ok AND disclosure_metadata_ok AND merchant_acknowledged_at_ok AND merchant_version_ok THEN 'PASS' ELSE 'FAIL' END,
    'prerequisite_columns',
    format('disclosure_id_ok=%s disclosure_user_ok=%s disclosure_merchant_ok=%s disclosure_session_ok=%s disclosure_plan_ok=%s disclosure_context_ok=%s disclosure_version_ok=%s disclosure_acknowledged_at_ok=%s disclosure_metadata_ok=%s merchant_acknowledged_at_ok=%s merchant_version_ok=%s', disclosure_id_ok, disclosure_user_ok, disclosure_merchant_ok, disclosure_session_ok, disclosure_plan_ok, disclosure_context_ok, disclosure_version_ok, disclosure_acknowledged_at_ok, disclosure_metadata_ok, merchant_acknowledged_at_ok, merchant_version_ok)
  FROM column_manifest

  UNION ALL

  SELECT
    CASE WHEN exact_count = 1 AND overload_count = 1 AND return_type = 'jsonb' AND security_mode = 'DEFINER' THEN 'PASS' ELSE 'FAIL' END,
    'migration_015_rpc_present',
    format('exact_count=%s overload_count=%s return_type=%s security_mode=%s definition_hash=%s', exact_count, overload_count, COALESCE(return_type, 'absent'), COALESCE(security_mode, 'absent'), COALESCE(definition_hash, 'absent'))
  FROM rpc_manifest

  UNION ALL

  SELECT
    CASE WHEN disclosure_browser_write_clear AND merchant_browser_write_clear THEN 'PASS' ELSE 'FAIL' END,
    'browser_write_surface',
    format('disclosure_browser_write_clear=%s merchant_browser_write_clear=%s', disclosure_browser_write_clear, merchant_browser_write_clear)
  FROM security_manifest

  UNION ALL

  SELECT
    CASE WHEN duplicate_extra_row_count > 0 THEN 'WARN' ELSE 'PASS' END,
    'historical_duplicate_summary',
    format('duplicate_groups=%s duplicate_extra_rows=%s null_session_groups=%s nonnull_session_groups=%s', duplicate_group_count, duplicate_extra_row_count, null_session_duplicate_groups, nonnull_session_duplicate_groups)
  FROM duplicate_manifest

  UNION ALL

  SELECT
    'PASS',
    'verification_disclosure_references',
    format('foreign_keys_referencing_verification_disclosures=%s', fk_reference_count)
  FROM reference_manifest

  UNION ALL

  SELECT
    CASE WHEN is_canonical_exists AND superseded_exists AND onboarding_index_exists AND upgrade_index_exists THEN 'PASS' ELSE 'WARN' END,
    'migration_016_applied_state',
    format('is_canonical_exists=%s superseded_exists=%s onboarding_index_exists=%s upgrade_index_exists=%s', is_canonical_exists, superseded_exists, onboarding_index_exists, upgrade_index_exists)
  FROM migration_016_manifest
) checks
ORDER BY check_name;

WITH
  table_manifest AS (
    SELECT to_regclass('public.verification_disclosures') IS NOT NULL AS verification_disclosures_ok,
           to_regclass('public.merchants') IS NOT NULL AS merchants_ok,
           to_regclass('public.onboarding_sessions') IS NOT NULL AS onboarding_sessions_ok
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
  rpc_manifest AS (
    SELECT count(*) AS overload_count,
           count(*) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS exact_count,
           max(pg_get_function_result(p.oid)) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS return_type,
           max(CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END) FILTER (WHERE oidvectortypes(p.proargtypes) = 'uuid, uuid, uuid, text, text, text, text, text, jsonb') AS security_mode
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'record_verification_disclosure_acceptance_v1'
  ),
  security_manifest AS (
    SELECT
      NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'verification_disclosures' AND grantee IN ('PUBLIC', 'anon', 'authenticated') AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')) AS disclosure_browser_write_clear,
      NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'merchants' AND grantee IN ('PUBLIC', 'anon', 'authenticated') AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')) AS merchant_browser_write_clear
  ),
  checks AS (
    SELECT CASE WHEN verification_disclosures_ok AND merchants_ok AND onboarding_sessions_ok THEN 'PASS' ELSE 'FAIL' END AS status FROM table_manifest
    UNION ALL
    SELECT CASE WHEN disclosure_id_ok AND disclosure_user_ok AND disclosure_merchant_ok AND disclosure_session_ok AND disclosure_plan_ok AND disclosure_context_ok AND disclosure_version_ok AND disclosure_acknowledged_at_ok AND disclosure_metadata_ok AND merchant_acknowledged_at_ok AND merchant_version_ok THEN 'PASS' ELSE 'FAIL' END FROM column_manifest
    UNION ALL
    SELECT CASE WHEN exact_count = 1 AND overload_count = 1 AND return_type = 'jsonb' AND security_mode = 'DEFINER' THEN 'PASS' ELSE 'FAIL' END FROM rpc_manifest
    UNION ALL
    SELECT CASE WHEN disclosure_browser_write_clear AND merchant_browser_write_clear THEN 'PASS' ELSE 'FAIL' END FROM security_manifest
  )
SELECT CASE WHEN EXISTS (SELECT 1 FROM checks WHERE status = 'FAIL') THEN 'true' ELSE 'false' END AS has_fail
\gset

\if :has_fail
\echo '016 verification disclosure identity hardening preflight failed.'
SELECT 1 / 0;
\endif

ROLLBACK;
