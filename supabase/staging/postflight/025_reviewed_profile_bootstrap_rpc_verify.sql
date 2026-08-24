WITH fn AS (
  SELECT p.oid,p.prosecdef,p.proconfig,p.proargtypes::regtype[] args
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='bootstrap_reviewed_profile_v1'
), checks AS (
  SELECT 'rpc.signature'::text check_name, CASE WHEN count(*)=1 AND bool_and(oid=to_regprocedure('public.bootstrap_reviewed_profile_v1(uuid,uuid,text,text,text,text,text,uuid,uuid,timestamptz)')) THEN 'PASS' ELSE 'FAIL' END status, 'One exact 10-argument RPC'::text details FROM fn
  UNION ALL SELECT 'rpc.security',CASE WHEN count(*)=1 AND bool_and(prosecdef=false) AND bool_and(proconfig @> ARRAY['search_path=pg_catalog, public']) THEN 'PASS' ELSE 'FAIL' END,'SECURITY INVOKER with hardened search path' FROM fn
  UNION ALL SELECT 'rpc.browser_grants',CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.routine_privileges WHERE routine_schema='public' AND routine_name='bootstrap_reviewed_profile_v1' AND grantee IN ('PUBLIC','anon','authenticated')) THEN 'PASS' ELSE 'FAIL' END,'No PUBLIC/anon/authenticated EXECUTE' 
  UNION ALL SELECT 'rpc.service_role_grant',CASE WHEN EXISTS (SELECT 1 FROM information_schema.routine_privileges WHERE routine_schema='public' AND routine_name='bootstrap_reviewed_profile_v1' AND grantee='service_role' AND privilege_type='EXECUTE') THEN 'PASS' ELSE 'FAIL' END,'service_role EXECUTE only'
  UNION ALL SELECT 'data.empty_after_apply',CASE WHEN (SELECT count(*) FROM public.merchant_compliance_profiles)=0 AND (SELECT count(*) FROM public.merchant_compliance_reviews)=0 AND (SELECT count(*) FROM public.merchant_compliance_events)=0 THEN 'PASS' ELSE 'FAIL' END,'Migration created no bootstrap business rows'
)
SELECT check_name,'rpc/security'::text object_type,status,details FROM checks
UNION ALL SELECT 'summary','summary',CASE WHEN bool_and(status='PASS') THEN 'PASS' ELSE 'FAIL' END,'All postflight checks must pass' FROM checks;
