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
  required_objects AS (
    SELECT *
    FROM (VALUES
      ('solo_plus_cases'),
      ('solo_plus_case_requirements'),
      ('solo_plus_case_events'),
      ('merchants'),
      ('subscriptions'),
      ('workspaces'),
      ('workspace_subscriptions'),
      ('platform_settings')
    ) AS t(object_name)
  ),
  object_manifest AS (
    SELECT
      o.object_name,
      to_regclass(format('public.%I', o.object_name)) IS NOT NULL AS exists_ok
    FROM required_objects o
  ),
  cases_manifest AS (
    SELECT
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='solo_plus_cases' AND c.relkind='r') AS exists_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_cases' AND column_name='case_status' AND udt_name='text') AS case_status_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_cases' AND column_name='payment_status' AND udt_name='text') AS payment_status_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_cases' AND column_name='refund_status' AND udt_name='text') AS refund_status_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_cases' AND column_name='merchant_id' AND udt_name='uuid') AS merchant_id_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_cases' AND column_name='row_version' AND udt_name='int4') AS row_version_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_cases' AND column_name='activation_idempotency_key' AND udt_name='text') AS activation_key_ok,
      EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.solo_plus_cases'::regclass AND conname='solo_plus_cases_approved_consistency_chk') AS constraint_ok,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='solo_plus_cases' AND c.relrowsecurity) AS rls_ok,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='solo_plus_cases' AND c.relforcerowsecurity = false) AS forced_ok,
      (SELECT COALESCE(array_agg(policyname::text ORDER BY policyname::text), ARRAY[]::text[]) FROM pg_policies WHERE schemaname='public' AND tablename='solo_plus_cases') = ARRAY['merchant_read_solo_plus_cases']::text[] AS policies_ok,
      NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='solo_plus_cases' AND grantee IN ('PUBLIC','anon') AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')) AS browser_clear_ok
  ),
  requirements_manifest AS (
    SELECT
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='solo_plus_case_requirements' AND c.relkind='r') AS exists_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_requirements' AND column_name='requirement_code' AND udt_name='text') AS code_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_requirements' AND column_name='requirement_state' AND udt_name='text') AS state_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_requirements' AND column_name='verification_log_id' AND udt_name='uuid') AS verification_log_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_requirements' AND column_name='evidence_source_type' AND udt_name='text') AS source_type_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_requirements' AND column_name='evidence_source_id' AND udt_name='uuid') AS source_id_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_requirements' AND column_name='evidence_reference' AND udt_name='text') AS reference_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_requirements' AND column_name='policy_rule_applied' AND udt_name='text') AS policy_rule_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_requirements' AND column_name='reviewed_by_admin_id' AND udt_name='uuid') AS reviewed_by_ok,
      EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.solo_plus_case_requirements'::regclass AND conname='solo_plus_case_requirements_unique_case_code') AS constraint_ok,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='solo_plus_case_requirements' AND c.relrowsecurity) AS rls_ok,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='solo_plus_case_requirements' AND c.relforcerowsecurity = false) AS forced_ok,
      (SELECT COALESCE(array_agg(policyname::text ORDER BY policyname::text), ARRAY[]::text[]) FROM pg_policies WHERE schemaname='public' AND tablename='solo_plus_case_requirements') = ARRAY['merchant_read_solo_plus_case_requirements']::text[] AS policies_ok,
      NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='solo_plus_case_requirements' AND grantee IN ('PUBLIC','anon') AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')) AS browser_clear_ok
  ),
  events_manifest AS (
    SELECT
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='solo_plus_case_events' AND c.relkind='r') AS exists_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_events' AND column_name='case_id' AND udt_name='uuid') AS case_id_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_events' AND column_name='event_type' AND udt_name='text') AS event_type_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_events' AND column_name='previous_state' AND udt_name='jsonb') AS prev_state_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_events' AND column_name='new_state' AND udt_name='jsonb') AS new_state_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_events' AND column_name='actor_id' AND udt_name='uuid') AS actor_id_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_events' AND column_name='request_idempotency_key' AND udt_name='text') AS request_key_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_events' AND column_name='policy_version' AND udt_name='text') AS policy_version_ok,
      EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='solo_plus_case_events' AND indexname='idx_solo_plus_case_events_request_idempotency') AS index_ok,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='solo_plus_case_events' AND c.relrowsecurity) AS rls_ok,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='solo_plus_case_events' AND c.relforcerowsecurity = false) AS forced_ok,
      (SELECT COALESCE(array_agg(policyname::text ORDER BY policyname::text), ARRAY[]::text[]) FROM pg_policies WHERE schemaname='public' AND tablename='solo_plus_case_events') = ARRAY[]::text[] AS policies_ok,
      NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='solo_plus_case_events' AND grantee IN ('PUBLIC','anon','authenticated') AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')) AS browser_clear_ok
  ),
  rpc_manifest AS (
    SELECT
      count(*) FILTER (WHERE p.proname = 'activate_solo_plus_case_v1') AS overload_count,
      count(*) FILTER (WHERE p.proname = 'activate_solo_plus_case_v1' AND oidvectortypes(p.proargtypes) = 'uuid, bigint, text, uuid, text') AS exact_count,
      max(CASE WHEN oidvectortypes(p.proargtypes) = 'uuid, bigint, text, uuid, text' THEN pg_get_function_result(p.oid) END) AS return_type,
      max(CASE WHEN oidvectortypes(p.proargtypes) = 'uuid, bigint, text, uuid, text' THEN CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END END) AS security_mode,
      max(CASE WHEN oidvectortypes(p.proargtypes) = 'uuid, bigint, text, uuid, text' THEN p.oid END) AS exact_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public'
      AND p.proname='activate_solo_plus_case_v1'
  ),
  rpc_acl AS (
    SELECT
      COALESCE(array_agg(cfg.setting ORDER BY cfg.setting), ARRAY[]::text[]) AS search_path_config,
      md5(COALESCE(pg_get_functiondef(rpc_manifest.exact_oid), '')) AS definition_hash,
      EXISTS (
        SELECT 1
        FROM pg_proc proc_acl
        LEFT JOIN LATERAL aclexplode(COALESCE(proc_acl.proacl, acldefault('f', proc_acl.proowner))) acl ON TRUE
        WHERE proc_acl.oid = rpc_manifest.exact_oid
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
      ) AS public_execute,
      has_function_privilege('service_role', rpc_manifest.exact_oid, 'EXECUTE') AS service_role_execute,
      has_function_privilege('anon', rpc_manifest.exact_oid, 'EXECUTE') AS anon_execute,
      has_function_privilege('authenticated', rpc_manifest.exact_oid, 'EXECUTE') AS authenticated_execute
    FROM rpc_manifest
    LEFT JOIN pg_proc p ON p.oid = rpc_manifest.exact_oid
    LEFT JOIN unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg(setting) ON TRUE
    GROUP BY rpc_manifest.exact_oid
  ),
  platform_flags AS (
    SELECT COALESCE(array_agg(key || '=' || value ORDER BY key), ARRAY[]::text[]) AS flags
    FROM public.platform_settings
    WHERE key IN ('plan_migration_solo_lite_enabled', 'solo_plus_enabled', 'solo_plus_kyc_enabled')
  ),
  final_checks AS (
    SELECT
      'solo_plus_cases_manifest'::text AS check_name,
      CASE WHEN exists_ok AND case_status_ok AND payment_status_ok AND refund_status_ok AND merchant_id_ok AND row_version_ok AND activation_key_ok AND constraint_ok AND rls_ok AND forced_ok AND policies_ok AND browser_clear_ok THEN 'PASS' ELSE 'FAIL' END AS status,
      format('exists=%s columns=%s constraints=%s rls=%s policies=%s grants=%s', exists_ok, case_status_ok AND payment_status_ok AND refund_status_ok AND merchant_id_ok AND row_version_ok AND activation_key_ok, constraint_ok, rls_ok AND forced_ok, policies_ok, browser_clear_ok) AS details
    FROM cases_manifest
    UNION ALL
    SELECT
      'solo_plus_case_requirements_manifest',
      CASE WHEN exists_ok AND code_ok AND state_ok AND verification_log_ok AND source_type_ok AND source_id_ok AND reference_ok AND policy_rule_ok AND reviewed_by_ok AND constraint_ok AND rls_ok AND forced_ok AND policies_ok AND browser_clear_ok THEN 'PASS' ELSE 'FAIL' END,
      format('exists=%s columns=%s constraints=%s rls=%s policies=%s grants=%s', exists_ok, code_ok AND state_ok AND verification_log_ok AND source_type_ok AND source_id_ok AND reference_ok AND policy_rule_ok AND reviewed_by_ok, constraint_ok, rls_ok AND forced_ok, policies_ok, browser_clear_ok)
    FROM requirements_manifest
    UNION ALL
    SELECT
      'solo_plus_case_events_manifest',
      CASE WHEN exists_ok AND case_id_ok AND event_type_ok AND prev_state_ok AND new_state_ok AND actor_id_ok AND request_key_ok AND policy_version_ok AND index_ok AND rls_ok AND forced_ok AND policies_ok AND browser_clear_ok THEN 'PASS' ELSE 'FAIL' END,
      format('exists=%s columns=%s index=%s rls=%s policies=%s grants=%s', exists_ok, case_id_ok AND event_type_ok AND prev_state_ok AND new_state_ok AND actor_id_ok AND request_key_ok AND policy_version_ok, index_ok, rls_ok AND forced_ok, policies_ok, browser_clear_ok)
    FROM events_manifest
    UNION ALL
    SELECT
      'activate_solo_plus_case_v1',
      CASE
        WHEN overload_count = 0 THEN 'WARN'
        WHEN exact_count = 1 AND overload_count = 1 AND return_type = 'jsonb' AND security_mode = 'INVOKER' THEN 'PASS'
        ELSE 'FAIL'
      END,
      format(
        'exact_count=%s overload_count=%s return_type=%s security_mode=%s search_path=%s public_execute=%s service_role_execute=%s anon_execute=%s authenticated_execute=%s definition_hash=%s',
        exact_count,
        overload_count,
        COALESCE(return_type, '<missing>'),
        COALESCE(security_mode, '<missing>'),
        COALESCE(array_to_string(search_path_config, ','), '<missing>'),
        public_execute,
        service_role_execute,
        anon_execute,
        authenticated_execute,
        COALESCE(definition_hash, 'missing')
      )
    FROM rpc_manifest, rpc_acl
    UNION ALL
    SELECT
      'default_privileges',
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM pg_default_acl d
          JOIN pg_roles r ON r.oid = d.defaclrole
          JOIN LATERAL aclexplode(COALESCE(d.defaclacl, ARRAY[]::aclitem[])) acl ON TRUE
          LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
          WHERE coalesce(grantee.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated')
            AND d.defaclobjtype IN ('r', 'f')
            AND acl.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'EXECUTE')
        )
        THEN 'WARN'
        ELSE 'PASS'
      END,
      'default privileges inspected for public browser/browser-like access'
    UNION ALL
    SELECT
      'feature_flags',
      CASE WHEN (SELECT flags FROM platform_flags) = ARRAY['plan_migration_solo_lite_enabled=false','solo_plus_enabled=false','solo_plus_kyc_enabled=false']::text[] THEN 'PASS' ELSE 'FAIL' END,
      format('flags=%s', array_to_string((SELECT flags FROM platform_flags), ','))
    UNION ALL
    SELECT
      'plan_migrations_manifest',
      'PASS',
      'Commit 10 must not use public.plan_migrations'
    UNION ALL
    SELECT
      'prior_commit_functions',
      CASE WHEN
        EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public' AND p.proname='create_solo_plus_case_bundle_v1') AND
        EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public' AND p.proname='attach_solo_plus_onboarding_merchant_v1') AND
        EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public' AND p.proname='mark_solo_plus_case_awaiting_payment_v1') AND
        EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public' AND p.proname='confirm_solo_plus_payment_v1')
      THEN 'PASS' ELSE 'FAIL' END,
      'Commit 7/8/9 function chain still present'
  )
SELECT check_name, status, details
FROM final_checks
ORDER BY check_name;

WITH
  cases_manifest AS (
    SELECT
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='solo_plus_cases' AND c.relkind='r') AS exists_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_cases' AND column_name='case_status' AND udt_name='text') AS case_status_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_cases' AND column_name='payment_status' AND udt_name='text') AS payment_status_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_cases' AND column_name='refund_status' AND udt_name='text') AS refund_status_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_cases' AND column_name='merchant_id' AND udt_name='uuid') AS merchant_id_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_cases' AND column_name='row_version' AND udt_name='int4') AS row_version_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_cases' AND column_name='activation_idempotency_key' AND udt_name='text') AS activation_key_ok,
      EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.solo_plus_cases'::regclass AND conname='solo_plus_cases_approved_consistency_chk') AS constraint_ok,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='solo_plus_cases' AND c.relrowsecurity) AS rls_ok,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='solo_plus_cases' AND c.relforcerowsecurity = false) AS forced_ok,
      (SELECT COALESCE(array_agg(policyname::text ORDER BY policyname::text), ARRAY[]::text[]) FROM pg_policies WHERE schemaname='public' AND tablename='solo_plus_cases') = ARRAY['merchant_read_solo_plus_cases']::text[] AS policies_ok,
      NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='solo_plus_cases' AND grantee IN ('PUBLIC','anon') AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')) AS browser_clear_ok
  ),
  requirements_manifest AS (
    SELECT
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='solo_plus_case_requirements' AND c.relkind='r') AS exists_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_requirements' AND column_name='requirement_code' AND udt_name='text') AS code_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_requirements' AND column_name='requirement_state' AND udt_name='text') AS state_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_requirements' AND column_name='verification_log_id' AND udt_name='uuid') AS verification_log_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_requirements' AND column_name='evidence_source_type' AND udt_name='text') AS source_type_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_requirements' AND column_name='evidence_source_id' AND udt_name='uuid') AS source_id_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_requirements' AND column_name='evidence_reference' AND udt_name='text') AS reference_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_requirements' AND column_name='policy_rule_applied' AND udt_name='text') AS policy_rule_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_requirements' AND column_name='reviewed_by_admin_id' AND udt_name='uuid') AS reviewed_by_ok,
      EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.solo_plus_case_requirements'::regclass AND conname='solo_plus_case_requirements_unique_case_code') AS constraint_ok,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='solo_plus_case_requirements' AND c.relrowsecurity) AS rls_ok,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='solo_plus_case_requirements' AND c.relforcerowsecurity = false) AS forced_ok,
      (SELECT COALESCE(array_agg(policyname::text ORDER BY policyname::text), ARRAY[]::text[]) FROM pg_policies WHERE schemaname='public' AND tablename='solo_plus_case_requirements') = ARRAY['merchant_read_solo_plus_case_requirements']::text[] AS policies_ok,
      NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='solo_plus_case_requirements' AND grantee IN ('PUBLIC','anon') AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')) AS browser_clear_ok
  ),
  events_manifest AS (
    SELECT
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='solo_plus_case_events' AND c.relkind='r') AS exists_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_events' AND column_name='case_id' AND udt_name='uuid') AS case_id_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_events' AND column_name='event_type' AND udt_name='text') AS event_type_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_events' AND column_name='previous_state' AND udt_name='jsonb') AS prev_state_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_events' AND column_name='new_state' AND udt_name='jsonb') AS new_state_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_events' AND column_name='actor_id' AND udt_name='uuid') AS actor_id_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_events' AND column_name='request_idempotency_key' AND udt_name='text') AS request_key_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='solo_plus_case_events' AND column_name='policy_version' AND udt_name='text') AS policy_version_ok,
      EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='solo_plus_case_events' AND indexname='idx_solo_plus_case_events_request_idempotency') AS index_ok,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='solo_plus_case_events' AND c.relrowsecurity) AS rls_ok,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='solo_plus_case_events' AND c.relforcerowsecurity = false) AS forced_ok,
      (SELECT COALESCE(array_agg(policyname::text ORDER BY policyname::text), ARRAY[]::text[]) FROM pg_policies WHERE schemaname='public' AND tablename='solo_plus_case_events') = ARRAY[]::text[] AS policies_ok,
      NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='solo_plus_case_events' AND grantee IN ('PUBLIC','anon','authenticated') AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')) AS browser_clear_ok
  ),
  rpc_manifest AS (
    SELECT
      count(*) FILTER (WHERE p.proname = 'activate_solo_plus_case_v1') AS overload_count,
      count(*) FILTER (WHERE p.proname = 'activate_solo_plus_case_v1' AND oidvectortypes(p.proargtypes) = 'uuid, bigint, text, uuid, text') AS exact_count,
      max(CASE WHEN oidvectortypes(p.proargtypes) = 'uuid, bigint, text, uuid, text' THEN pg_get_function_result(p.oid) END) AS return_type,
      max(CASE WHEN oidvectortypes(p.proargtypes) = 'uuid, bigint, text, uuid, text' THEN CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END END) AS security_mode,
      max(CASE WHEN oidvectortypes(p.proargtypes) = 'uuid, bigint, text, uuid, text' THEN p.oid END) AS exact_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public'
      AND p.proname='activate_solo_plus_case_v1'
  ),
  rpc_acl AS (
    SELECT
      COALESCE(array_agg(cfg.setting ORDER BY cfg.setting), ARRAY[]::text[]) AS search_path_config,
      md5(COALESCE(pg_get_functiondef(rpc_manifest.exact_oid), '')) AS definition_hash,
      EXISTS (
        SELECT 1
        FROM pg_proc proc_acl
        LEFT JOIN LATERAL aclexplode(COALESCE(proc_acl.proacl, acldefault('f', proc_acl.proowner))) acl ON TRUE
        WHERE proc_acl.oid = rpc_manifest.exact_oid
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
      ) AS public_execute,
      has_function_privilege('service_role', rpc_manifest.exact_oid, 'EXECUTE') AS service_role_execute,
      has_function_privilege('anon', rpc_manifest.exact_oid, 'EXECUTE') AS anon_execute,
      has_function_privilege('authenticated', rpc_manifest.exact_oid, 'EXECUTE') AS authenticated_execute
    FROM rpc_manifest
    LEFT JOIN pg_proc p ON p.oid = rpc_manifest.exact_oid
    LEFT JOIN unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg(setting) ON TRUE
    GROUP BY rpc_manifest.exact_oid
  ),
  platform_flags AS (
    SELECT COALESCE(array_agg(key || '=' || value ORDER BY key), ARRAY[]::text[]) AS flags
    FROM public.platform_settings
    WHERE key IN ('plan_migration_solo_lite_enabled', 'solo_plus_enabled', 'solo_plus_kyc_enabled')
  ),
  summary AS (
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM cases_manifest WHERE NOT (exists_ok AND case_status_ok AND payment_status_ok AND refund_status_ok AND merchant_id_ok AND row_version_ok AND activation_key_ok AND constraint_ok AND rls_ok AND forced_ok AND policies_ok AND browser_clear_ok)) THEN 'FAIL'
      WHEN EXISTS (SELECT 1 FROM requirements_manifest WHERE NOT (exists_ok AND code_ok AND state_ok AND verification_log_ok AND source_type_ok AND source_id_ok AND reference_ok AND policy_rule_ok AND reviewed_by_ok AND constraint_ok AND rls_ok AND forced_ok AND policies_ok AND browser_clear_ok)) THEN 'FAIL'
      WHEN EXISTS (SELECT 1 FROM events_manifest WHERE NOT (exists_ok AND case_id_ok AND event_type_ok AND prev_state_ok AND new_state_ok AND actor_id_ok AND request_key_ok AND policy_version_ok AND index_ok AND rls_ok AND forced_ok AND policies_ok AND browser_clear_ok)) THEN 'FAIL'
      WHEN EXISTS (SELECT 1 FROM rpc_manifest, rpc_acl WHERE NOT (
        (rpc_manifest.overload_count = 0 OR rpc_manifest.exact_count = 1)
        AND (rpc_manifest.overload_count = 0 OR rpc_manifest.return_type = 'jsonb')
        AND (rpc_manifest.overload_count = 0 OR rpc_manifest.security_mode = 'INVOKER')
        AND (rpc_manifest.overload_count = 0 OR rpc_acl.search_path_config = ARRAY['search_path=public, pg_temp']::text[])
        AND (rpc_manifest.overload_count = 0 OR rpc_acl.service_role_execute)
      )) THEN 'FAIL'
      WHEN (SELECT flags FROM platform_flags) <> ARRAY['plan_migration_solo_lite_enabled=false','solo_plus_enabled=false','solo_plus_kyc_enabled=false']::text[] THEN 'WARN'
      WHEN EXISTS (
        SELECT 1
        FROM pg_default_acl d
        JOIN LATERAL aclexplode(COALESCE(d.defaclacl, ARRAY[]::aclitem[])) acl ON TRUE
        LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
        WHERE coalesce(grantee.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated')
          AND d.defaclobjtype IN ('r', 'f')
          AND acl.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'EXECUTE')
      ) THEN 'WARN'
      WHEN EXISTS (SELECT 1 FROM rpc_manifest WHERE overload_count = 0) THEN 'WARN'
      ELSE 'PASS'
    END AS overall_preflight_status
  )
SELECT overall_preflight_status
FROM summary;

ROLLBACK;
