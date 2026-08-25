WITH required_columns AS (
  SELECT * FROM (VALUES
    ('merchant_compliance_profiles','id'), ('merchant_compliance_profiles','merchant_id'),
    ('merchant_compliance_profiles','plan_code'), ('merchant_compliance_profiles','compliance_status'),
    ('merchant_compliance_profiles','activation_status'), ('merchant_compliance_profiles','restriction_state'),
    ('merchant_compliance_profiles','decision_source_type'), ('merchant_compliance_profiles','decision_source_id'),
    ('merchant_compliance_profiles','decision_source_version'), ('merchant_compliance_profiles','row_version'),
    ('merchant_compliance_reviews','id'), ('merchant_compliance_reviews','merchant_id'),
    ('merchant_compliance_reviews','profile_id'), ('merchant_compliance_reviews','review_type'),
    ('merchant_compliance_reviews','target_plan_code'), ('merchant_compliance_reviews','review_status'),
    ('merchant_compliance_reviews','row_version'),
    ('merchant_compliance_events','id'), ('merchant_compliance_events','merchant_id'),
    ('merchant_compliance_events','profile_id'), ('merchant_compliance_events','idempotency_key'),
    ('merchant_compliance_events','resulting_row_version'),
    ('solo_plus_cases','id'), ('solo_plus_cases','merchant_id'), ('solo_plus_cases','target_plan'),
    ('solo_plus_cases','case_status'), ('solo_plus_cases','requirements_policy_version'),
    ('solo_plus_cases','approved_at'), ('solo_plus_cases','approved_by_admin_id'),
    ('solo_plus_cases','rejected_at'), ('solo_plus_cases','rejected_by_admin_id'), ('solo_plus_cases','row_version')
  ) AS expected(table_name, column_name)
), checks AS (
  SELECT 'prerequisite.tables_columns'::text check_name,
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM required_columns expected
      WHERE to_regclass(format('public.%I', expected.table_name)) IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM pg_attribute attribute
          WHERE attribute.attrelid = to_regclass(format('public.%I', expected.table_name))
            AND attribute.attname = expected.column_name AND attribute.attnum > 0 AND NOT attribute.attisdropped
        )
    ) THEN 'PASS' ELSE 'FAIL' END status,
    'Migration 024 compliance columns and Solo Plus decision-source columns exist'::text details
  UNION ALL
  SELECT 'prerequisite.rls', CASE WHEN NOT EXISTS (
    SELECT 1 FROM pg_class relation
    WHERE relation.oid IN (
      to_regclass('public.merchant_compliance_profiles'),
      to_regclass('public.merchant_compliance_reviews'),
      to_regclass('public.merchant_compliance_events')
    )
      AND (NOT relation.relrowsecurity OR relation.relforcerowsecurity)
  ) THEN 'PASS' ELSE 'FAIL' END, 'RLS enabled and not forced on compliance tables'
  UNION ALL
  SELECT 'prerequisite.browser_grants', CASE WHEN NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants grant_state
    WHERE grant_state.table_schema='public'
      AND grant_state.table_name IN ('merchant_compliance_profiles','merchant_compliance_reviews','merchant_compliance_events')
      AND grant_state.grantee IN ('PUBLIC','anon','authenticated')
  ) THEN 'PASS' ELSE 'FAIL' END, 'No browser/public compliance-table grants'
  UNION ALL
  SELECT 'prerequisite.browser_policies', CASE WHEN NOT EXISTS (
    SELECT 1 FROM pg_policy policy_state
    WHERE policy_state.polrelid IN (
      to_regclass('public.merchant_compliance_profiles'),
      to_regclass('public.merchant_compliance_reviews'),
      to_regclass('public.merchant_compliance_events')
    )
  ) THEN 'PASS' ELSE 'FAIL' END, 'Zero browser policies on compliance tables'
  UNION ALL
  SELECT 'migration_025.rpc_security', CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc procedure_state
    WHERE procedure_state.oid = to_regprocedure('public.bootstrap_reviewed_profile_v1(uuid,uuid,text,text,text,text,text,uuid,uuid,timestamptz)')
      AND NOT procedure_state.prosecdef
      AND procedure_state.proconfig @> ARRAY['search_path=pg_catalog, public']
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges privilege_state
    WHERE privilege_state.routine_schema='public' AND privilege_state.routine_name='bootstrap_reviewed_profile_v1'
      AND privilege_state.grantee IN ('PUBLIC','anon','authenticated')
  ) AND EXISTS (
    SELECT 1 FROM information_schema.routine_privileges privilege_state
    WHERE privilege_state.routine_schema='public' AND privilege_state.routine_name='bootstrap_reviewed_profile_v1'
      AND privilege_state.grantee='service_role' AND privilege_state.privilege_type='EXECUTE'
  ) THEN 'PASS' ELSE 'FAIL' END, 'Migration 025 bootstrap RPC remains service-role-only and SECURITY INVOKER'
  UNION ALL
  SELECT 'rpc.overloads', CASE WHEN (
    SELECT count(*) FROM pg_proc procedure_state JOIN pg_namespace namespace_state ON namespace_state.oid=procedure_state.pronamespace
    WHERE namespace_state.nspname='public' AND procedure_state.proname='review_compliance_profile_decision_v1'
  ) <= 1 THEN 'PASS' ELSE 'FAIL' END, 'No conflicting approval RPC overload'
  UNION ALL
  SELECT 'rpc.execute_leakage', CASE WHEN NOT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges privilege_state
    WHERE privilege_state.routine_schema='public' AND privilege_state.routine_name='review_compliance_profile_decision_v1'
      AND privilege_state.grantee IN ('PUBLIC','anon','authenticated')
  ) THEN 'PASS' ELSE 'FAIL' END, 'No browser/public execute grant on any existing approval RPC'
)
SELECT check_name, 'schema/security'::text object_type, status, details FROM checks
UNION ALL
SELECT 'summary','summary',CASE WHEN bool_and(status='PASS') THEN 'PASS' ELSE 'FAIL' END,
  'Stop on FAIL; apply only after all prerequisites pass' FROM checks;
