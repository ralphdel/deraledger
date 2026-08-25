WITH fn AS (
  SELECT p.oid, p.prosecdef, p.proconfig
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'review_compliance_profile_decision_v1'
), checks AS (
  SELECT 'migration_026.rpc_signature'::text check_name,
    CASE WHEN count(*) = 1 AND bool_and(oid = to_regprocedure('public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)')) THEN 'PASS' ELSE 'FAIL' END status,
    'Migration 026 exact approval RPC exists'::text details FROM fn
  UNION ALL SELECT 'migration_026.rpc_security', CASE WHEN count(*) = 1 AND bool_and(prosecdef = false) AND bool_and(proconfig @> ARRAY['search_path=pg_catalog, public']) THEN 'PASS' ELSE 'FAIL' END, 'Migration 026 RPC is SECURITY INVOKER with hardened search path' FROM fn
  UNION ALL SELECT 'rpc.overloads', CASE WHEN (SELECT count(*) FROM fn) = 1 THEN 'PASS' ELSE 'FAIL' END, 'No conflicting approval RPC overload'
  UNION ALL SELECT 'rpc.browser_grants', CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.routine_privileges rp WHERE rp.routine_schema='public' AND rp.routine_name='review_compliance_profile_decision_v1' AND rp.grantee IN ('PUBLIC','anon','authenticated')) THEN 'PASS' ELSE 'FAIL' END, 'No browser/public approval RPC execute grant'
  UNION ALL SELECT 'rpc.service_role_grant', CASE WHEN EXISTS (SELECT 1 FROM information_schema.routine_privileges rp WHERE rp.routine_schema='public' AND rp.routine_name='review_compliance_profile_decision_v1' AND rp.grantee='service_role' AND rp.privilege_type='EXECUTE') AND NOT EXISTS (SELECT 1 FROM information_schema.routine_privileges rp WHERE rp.routine_schema='public' AND rp.routine_name='review_compliance_profile_decision_v1' AND rp.privilege_type='EXECUTE' AND rp.grantee <> 'service_role') THEN 'PASS' ELSE 'FAIL' END, 'service_role is the only explicit approval RPC EXECUTE grantee'
  UNION ALL SELECT 'compliance.browser_grants', CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants g WHERE g.table_schema='public' AND g.table_name IN ('merchant_compliance_profiles','merchant_compliance_reviews','merchant_compliance_events') AND g.grantee IN ('PUBLIC','anon','authenticated')) THEN 'PASS' ELSE 'FAIL' END, 'No browser/public compliance-table grants'
  UNION ALL SELECT 'compliance.browser_policies', CASE WHEN NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid IN (to_regclass('public.merchant_compliance_profiles'),to_regclass('public.merchant_compliance_reviews'),to_regclass('public.merchant_compliance_events'))) THEN 'PASS' ELSE 'FAIL' END, 'Zero browser policies on compliance tables'
)
SELECT check_name, 'cleanup-prerequisite'::text object_type, status, details FROM checks
UNION ALL SELECT 'summary','summary',CASE WHEN bool_and(status='PASS') THEN 'PASS' ELSE 'FAIL' END,'Stop on FAIL; apply only after all prerequisites pass' FROM checks;
