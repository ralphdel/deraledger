WITH required_columns AS (
  SELECT * FROM (VALUES
    ('merchant_compliance_profiles','id'),('merchant_compliance_profiles','merchant_id'),('merchant_compliance_profiles','plan_code'),('merchant_compliance_profiles','compliance_status'),('merchant_compliance_profiles','decision_source_type'),('merchant_compliance_profiles','decision_source_id'),('merchant_compliance_profiles','decision_source_version'),('merchant_compliance_profiles','row_version'),
    ('merchant_compliance_reviews','id'),('merchant_compliance_reviews','merchant_id'),('merchant_compliance_reviews','profile_id'),('merchant_compliance_reviews','review_type'),('merchant_compliance_reviews','target_plan_code'),('merchant_compliance_reviews','review_status'),('merchant_compliance_reviews','row_version'),
    ('merchant_compliance_events','id'),('merchant_compliance_events','merchant_id'),('merchant_compliance_events','profile_id'),('merchant_compliance_events','idempotency_key'),('merchant_compliance_events','source_type'),('merchant_compliance_events','source_id'),('merchant_compliance_events','policy_version'),('merchant_compliance_events','expected_row_version'),('merchant_compliance_events','resulting_row_version'),
    ('solo_plus_cases','id'),('solo_plus_cases','merchant_id'),('solo_plus_cases','target_plan'),('solo_plus_cases','case_status'),('solo_plus_cases','requirements_policy_version'),('solo_plus_cases','approved_at'),('solo_plus_cases','approved_by_admin_id'),('solo_plus_cases','rejected_at'),('solo_plus_cases','rejected_by_admin_id'),('solo_plus_cases','row_version'),
    ('merchants','id'),('merchants','workspace_id'),('workspaces','id'),('workspaces','merchant_id')
  ) AS expected(table_name,column_name)
), approval_fn AS (
  SELECT p.oid,p.prosecdef,p.proconfig,p.proacl,p.proowner,pg_get_functiondef(p.oid) definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='review_compliance_profile_decision_v1'
), checks AS (
  SELECT 'prerequisite.tables_columns'::text check_name,
    CASE WHEN NOT EXISTS (SELECT 1 FROM required_columns e WHERE to_regclass(format('public.%I',e.table_name)) IS NULL OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass(format('public.%I',e.table_name)) AND a.attname=e.column_name AND a.attnum>0 AND NOT a.attisdropped)) THEN 'PASS' ELSE 'FAIL' END status,
    'M024/M025 compliance, source, merchant, and workspace columns exist'::text details
  UNION ALL
  SELECT 'prerequisite.compliance_security',CASE WHEN NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid IN (to_regclass('public.merchant_compliance_profiles'),to_regclass('public.merchant_compliance_reviews'),to_regclass('public.merchant_compliance_events')) AND (NOT c.relrowsecurity OR c.relforcerowsecurity)) AND NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants g WHERE g.table_schema='public' AND g.table_name IN ('merchant_compliance_profiles','merchant_compliance_reviews','merchant_compliance_events') AND g.grantee IN ('PUBLIC','anon','authenticated')) AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid IN (to_regclass('public.merchant_compliance_profiles'),to_regclass('public.merchant_compliance_reviews'),to_regclass('public.merchant_compliance_events'))) THEN 'PASS' ELSE 'FAIL' END,'Compliance RLS/grants/policies remain safe'
  UNION ALL
  SELECT 'migration_025.rpc',CASE WHEN to_regprocedure('public.bootstrap_reviewed_profile_v1(uuid,uuid,text,text,text,text,text,uuid,uuid,timestamptz)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,'M025 bootstrap RPC exists'
  UNION ALL
  SELECT 'migration_026_027.rpc',CASE WHEN (SELECT count(*) FROM approval_fn)=1 AND (SELECT bool_and(oid=to_regprocedure('public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)') AND NOT prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, public'] AND definition !~ 'LOCAL_APPROVAL_BRANCH|LOCAL_APPROVAL_EXCEPTION|deraledger\.local_approval_rehearsal_diagnostics|approval_rpc_internal_diagnostics|GET STACKED DIAGNOSTICS') FROM approval_fn) THEN 'PASS' ELSE 'FAIL' END,'M026 approval RPC exists and M027 diagnostics cleanup is present'
  UNION ALL
  SELECT 'migration_026_027.grants',CASE WHEN NOT has_function_privilege('anon','public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)','EXECUTE') AND NOT has_function_privilege('authenticated','public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)','EXECUTE') AND has_function_privilege('service_role','public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)','EXECUTE') AND NOT EXISTS (SELECT 1 FROM approval_fn f CROSS JOIN LATERAL aclexplode(COALESCE(f.proacl,acldefault('f',f.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') THEN 'PASS' ELSE 'FAIL' END,'M026 approval RPC is service-role-only'
  UNION ALL
  SELECT 'migration_028.overloads',CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('issue_canonical_approval_decision_request_v1','read_canonical_approval_snapshot_v1')) THEN 'PASS' ELSE 'FAIL' END,'No conflicting M028 RPC exists before apply'
)
SELECT check_name,'schema/security'::text object_type,status,details FROM checks
UNION ALL SELECT 'summary','summary',CASE WHEN bool_and(status='PASS') THEN 'PASS' ELSE 'FAIL' END,'Stop on FAIL; do not apply after a failed preflight' FROM checks;
