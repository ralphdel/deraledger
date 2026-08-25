WITH required_columns AS (
  SELECT * FROM (VALUES
    ('merchant_compliance_profiles','id'),('merchant_compliance_profiles','merchant_id'),('merchant_compliance_profiles','plan_code'),('merchant_compliance_profiles','compliance_status'),('merchant_compliance_profiles','decision_source_type'),('merchant_compliance_profiles','decision_source_id'),('merchant_compliance_profiles','decision_source_version'),('merchant_compliance_profiles','row_version'),
    ('merchant_compliance_reviews','id'),('merchant_compliance_reviews','merchant_id'),('merchant_compliance_reviews','profile_id'),('merchant_compliance_reviews','review_type'),('merchant_compliance_reviews','target_plan_code'),('merchant_compliance_reviews','review_status'),('merchant_compliance_reviews','row_version'),
    ('merchant_compliance_events','id'),('merchant_compliance_events','merchant_id'),('merchant_compliance_events','profile_id'),('merchant_compliance_events','idempotency_key'),('merchant_compliance_events','source_type'),('merchant_compliance_events','source_id'),('merchant_compliance_events','policy_version'),('merchant_compliance_events','expected_row_version'),('merchant_compliance_events','resulting_row_version'),
    ('solo_plus_cases','id'),('solo_plus_cases','merchant_id'),('solo_plus_cases','target_plan'),('solo_plus_cases','case_status'),('solo_plus_cases','requirements_policy_version'),('solo_plus_cases','approved_at'),('solo_plus_cases','approved_by_admin_id'),('solo_plus_cases','rejected_at'),('solo_plus_cases','rejected_by_admin_id'),('solo_plus_cases','row_version'),
    ('merchants','id'),('workspaces','id'),('workspaces','merchant_id')
  ) AS expected(table_name,column_name)
), bootstrap_fn AS (
  SELECT p.oid,p.prosecdef,p.proconfig,p.proacl,p.proowner
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='bootstrap_reviewed_profile_v1'
), approval_fn AS (
  SELECT p.oid,p.prosecdef,p.proconfig,p.proacl,p.proowner,pg_get_functiondef(p.oid) definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='review_compliance_profile_decision_v1'
), workspace_key_shape AS (
  SELECT
    EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN unnest(c.conkey) WITH ORDINALITY k(attnum, ordinality) ON true
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
      WHERE c.conrelid=to_regclass('public.merchants') AND c.contype='p'
        AND array_length(c.conkey,1)=1 AND a.attname='id'
    ) AS merchant_id_is_unique,
    EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN unnest(c.conkey) WITH ORDINALITY k(attnum, ordinality) ON true
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
      WHERE c.conrelid=to_regclass('public.workspaces') AND c.contype='p'
        AND array_length(c.conkey,1)=1 AND a.attname='id'
    ) AS workspace_id_is_unique,
    EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN unnest(c.conkey) WITH ORDINALITY k(attnum, ordinality) ON true
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
      WHERE c.conrelid=to_regclass('public.workspaces') AND c.contype='u'
        AND array_length(c.conkey,1)=1 AND a.attname='merchant_id'
    ) AS workspace_merchant_is_unique,
    EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN unnest(c.conkey) WITH ORDINALITY source_key(attnum, ordinality) ON true
      JOIN unnest(c.confkey) WITH ORDINALITY target_key(attnum, ordinality) ON source_key.ordinality=target_key.ordinality
      JOIN pg_attribute source_attribute ON source_attribute.attrelid=c.conrelid AND source_attribute.attnum=source_key.attnum
      JOIN pg_attribute target_attribute ON target_attribute.attrelid=c.confrelid AND target_attribute.attnum=target_key.attnum
      WHERE c.conrelid=to_regclass('public.workspaces') AND c.confrelid=to_regclass('public.merchants')
        AND c.contype='f' AND array_length(c.conkey,1)=1
        AND source_attribute.attname='merchant_id' AND target_attribute.attname='id'
    ) AS workspace_merchant_fk_is_exact
), checks AS (
  SELECT 'prerequisite.tables_columns'::text check_name,
    CASE WHEN NOT EXISTS (SELECT 1 FROM required_columns e WHERE to_regclass(format('public.%I',e.table_name)) IS NULL OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass(format('public.%I',e.table_name)) AND a.attname=e.column_name AND a.attnum>0 AND NOT a.attisdropped)) THEN 'PASS' ELSE 'FAIL' END status,
    'M024/M025 compliance, source, merchant, and workspace columns exist'::text details
  UNION ALL
  SELECT 'prerequisite.workspace_linkage',CASE WHEN merchant_id_is_unique AND workspace_id_is_unique AND workspace_merchant_is_unique AND workspace_merchant_fk_is_exact THEN 'PASS' ELSE 'FAIL' END,
    'Canonical workspaces.merchant_id is unique and FK-backed; M028 fails closed for absent or ambiguous workspace linkage' FROM workspace_key_shape
  UNION ALL
  SELECT 'prerequisite.compliance_security',CASE WHEN NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid IN (to_regclass('public.merchant_compliance_profiles'),to_regclass('public.merchant_compliance_reviews'),to_regclass('public.merchant_compliance_events')) AND (NOT c.relrowsecurity OR c.relforcerowsecurity)) AND NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants g WHERE g.table_schema='public' AND g.table_name IN ('merchant_compliance_profiles','merchant_compliance_reviews','merchant_compliance_events') AND g.grantee IN ('PUBLIC','anon','authenticated')) AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid IN (to_regclass('public.merchant_compliance_profiles'),to_regclass('public.merchant_compliance_reviews'),to_regclass('public.merchant_compliance_events'))) THEN 'PASS' ELSE 'FAIL' END,'Compliance RLS/grants/policies remain safe'
  UNION ALL
  SELECT 'migration_025.rpc_security',CASE WHEN (SELECT count(*) FROM bootstrap_fn)=1 AND (SELECT bool_and(oid=to_regprocedure('public.bootstrap_reviewed_profile_v1(uuid,uuid,text,text,text,text,text,uuid,uuid,timestamptz)') AND NOT prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, public']) FROM bootstrap_fn) AND NOT has_function_privilege('anon','public.bootstrap_reviewed_profile_v1(uuid,uuid,text,text,text,text,text,uuid,uuid,timestamptz)','EXECUTE') AND NOT has_function_privilege('authenticated','public.bootstrap_reviewed_profile_v1(uuid,uuid,text,text,text,text,text,uuid,uuid,timestamptz)','EXECUTE') AND has_function_privilege('service_role','public.bootstrap_reviewed_profile_v1(uuid,uuid,text,text,text,text,text,uuid,uuid,timestamptz)','EXECUTE') AND NOT EXISTS (SELECT 1 FROM bootstrap_fn f CROSS JOIN LATERAL aclexplode(COALESCE(f.proacl,acldefault('f',f.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') THEN 'PASS' ELSE 'FAIL' END,'M025 bootstrap RPC is exact, SECURITY INVOKER, hardened, and service-role-only'
  UNION ALL
  SELECT 'migration_026_027.rpc',CASE WHEN (SELECT count(*) FROM approval_fn)=1 AND (SELECT bool_and(oid=to_regprocedure('public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)') AND NOT prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, public'] AND definition !~ 'LOCAL_APPROVAL_BRANCH|LOCAL_APPROVAL_EXCEPTION|deraledger\.local_approval_rehearsal_diagnostics|approval_rpc_internal_diagnostics|GET STACKED DIAGNOSTICS') FROM approval_fn) THEN 'PASS' ELSE 'FAIL' END,'M026 approval RPC exists and M027 diagnostics cleanup is present'
  UNION ALL
  SELECT 'migration_026_027.grants',CASE WHEN NOT has_function_privilege('anon','public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)','EXECUTE') AND NOT has_function_privilege('authenticated','public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)','EXECUTE') AND has_function_privilege('service_role','public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)','EXECUTE') AND NOT EXISTS (SELECT 1 FROM approval_fn f CROSS JOIN LATERAL aclexplode(COALESCE(f.proacl,acldefault('f',f.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') THEN 'PASS' ELSE 'FAIL' END,'M026 approval RPC is service-role-only'
  UNION ALL
  SELECT 'migration_028.objects',CASE WHEN to_regclass('public.approval_policy_versions') IS NULL AND to_regclass('public.approval_decision_requests') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('issue_canonical_approval_decision_request_v1','read_canonical_approval_snapshot_v1')) THEN 'PASS' ELSE 'FAIL' END,'No conflicting M028 tables or RPC overloads exist before apply'
)
SELECT check_name,'schema/security'::text object_type,status,details FROM checks
UNION ALL SELECT 'summary','summary',CASE WHEN bool_and(status='PASS') THEN 'PASS' ELSE 'FAIL' END,'Stop on FAIL; do not apply after a failed preflight' FROM checks;
