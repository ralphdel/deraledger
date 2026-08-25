WITH fn AS (
  SELECT p.oid, p.prosecdef, p.proconfig, p.proacl, p.proowner, pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'review_compliance_profile_decision_v1'
), checks AS (
  SELECT 'rpc.signature'::text check_name, CASE WHEN count(*)=1 AND bool_and(oid=to_regprocedure('public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)')) THEN 'PASS' ELSE 'FAIL' END status, 'One exact 13-argument approval RPC'::text details FROM fn
  UNION ALL SELECT 'rpc.security', CASE WHEN count(*)=1 AND bool_and(prosecdef=false) AND bool_and(proconfig @> ARRAY['search_path=pg_catalog, public']) THEN 'PASS' ELSE 'FAIL' END, 'SECURITY INVOKER with hardened search path' FROM fn
  UNION ALL SELECT 'rpc.diagnostics_removed', CASE WHEN count(*)=1 AND bool_and(definition !~ 'LOCAL_APPROVAL_BRANCH|LOCAL_APPROVAL_EXCEPTION|deraledger\.local_approval_rehearsal_diagnostics|approval_rpc_internal_diagnostics|GET STACKED DIAGNOSTICS') THEN 'PASS' ELSE 'FAIL' END, 'No local diagnostic instrumentation remains in RPC body' FROM fn
  UNION ALL SELECT 'rpc.browser_grants', CASE WHEN
    NOT has_function_privilege('anon', 'public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)', 'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM fn procedure_state CROSS JOIN LATERAL aclexplode(COALESCE(procedure_state.proacl, acldefault('f', procedure_state.proowner))) privilege_state WHERE privilege_state.grantee = 0 AND privilege_state.privilege_type = 'EXECUTE')
    THEN 'PASS' ELSE 'FAIL' END, 'No effective anon/authenticated or explicit PUBLIC approval RPC execute grant'
  UNION ALL SELECT 'rpc.service_role_grant', CASE WHEN has_function_privilege('service_role', 'public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'service_role has EXECUTE on the exact approval RPC signature'
  UNION ALL SELECT 'compliance.browser_grants', CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants g WHERE g.table_schema='public' AND g.table_name IN ('merchant_compliance_profiles','merchant_compliance_reviews','merchant_compliance_events') AND g.grantee IN ('PUBLIC','anon','authenticated')) THEN 'PASS' ELSE 'FAIL' END, 'No browser/public compliance-table grants'
  UNION ALL SELECT 'compliance.browser_policies', CASE WHEN NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid IN (to_regclass('public.merchant_compliance_profiles'),to_regclass('public.merchant_compliance_reviews'),to_regclass('public.merchant_compliance_events'))) THEN 'PASS' ELSE 'FAIL' END, 'Zero browser policies on compliance tables'
  UNION ALL SELECT 'data.empty_after_apply', CASE WHEN (SELECT count(*) FROM public.merchant_compliance_profiles)=0 AND (SELECT count(*) FROM public.merchant_compliance_reviews)=0 AND (SELECT count(*) FROM public.merchant_compliance_events)=0 THEN 'PASS' ELSE 'FAIL' END, 'Migration created no compliance business rows'
)
SELECT check_name,'rpc/security'::text object_type,status,details FROM checks
UNION ALL SELECT 'summary','summary',CASE WHEN bool_and(status='PASS') THEN 'PASS' ELSE 'FAIL' END,'All postflight checks must pass' FROM checks;
