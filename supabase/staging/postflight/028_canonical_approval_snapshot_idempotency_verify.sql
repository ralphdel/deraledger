WITH functions AS (
  SELECT p.oid,p.proname,p.prosecdef,p.proconfig,p.proacl,p.proowner,pg_get_functiondef(p.oid) definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('issue_canonical_approval_decision_request_v1','read_canonical_approval_snapshot_v1')
), expected AS (
  SELECT * FROM (VALUES
    ('issue_canonical_approval_decision_request_v1','public.issue_canonical_approval_decision_request_v1(uuid,uuid,text,text,text)'),
    ('read_canonical_approval_snapshot_v1','public.read_canonical_approval_snapshot_v1(uuid)')
  ) AS e(proname,signature)
), checks AS (
  SELECT 'objects.tables'::text check_name,CASE WHEN to_regclass('public.approval_policy_versions') IS NOT NULL AND to_regclass('public.approval_decision_requests') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END status,'M028 policy and immutable decision-request tables exist'::text details
  UNION ALL
  SELECT 'rpc.signature',CASE WHEN (SELECT count(*) FROM functions)=2 AND NOT EXISTS (SELECT 1 FROM expected e WHERE NOT EXISTS (SELECT 1 FROM functions f WHERE f.oid=to_regprocedure(e.signature))) THEN 'PASS' ELSE 'FAIL' END,'Exactly the two expected M028 RPC signatures exist'
  UNION ALL
  SELECT 'rpc.security',CASE WHEN (SELECT count(*) FROM functions)=2 AND (SELECT bool_and(NOT prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, public']) FROM functions) THEN 'PASS' ELSE 'FAIL' END,'M028 RPCs are SECURITY INVOKER with hardened search paths'
  UNION ALL
  SELECT 'rpc.grants',CASE WHEN NOT EXISTS (SELECT 1 FROM expected e WHERE has_function_privilege('anon',e.signature,'EXECUTE') OR has_function_privilege('authenticated',e.signature,'EXECUTE') OR NOT has_function_privilege('service_role',e.signature,'EXECUTE')) AND NOT EXISTS (SELECT 1 FROM functions f CROSS JOIN LATERAL aclexplode(COALESCE(f.proacl,acldefault('f',f.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') THEN 'PASS' ELSE 'FAIL' END,'No PUBLIC/anon/authenticated EXECUTE; service_role has exact RPC execute'
  UNION ALL
  SELECT 'tables.browser_security',CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants g WHERE g.table_schema='public' AND g.table_name IN ('approval_policy_versions','approval_decision_requests','merchant_compliance_profiles','merchant_compliance_reviews','merchant_compliance_events') AND g.grantee IN ('PUBLIC','anon','authenticated')) AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid IN (to_regclass('public.approval_policy_versions'),to_regclass('public.approval_decision_requests'),to_regclass('public.merchant_compliance_profiles'),to_regclass('public.merchant_compliance_reviews'),to_regclass('public.merchant_compliance_events'))) THEN 'PASS' ELSE 'FAIL' END,'No browser/public grants or policies on M028/compliance tables'
  UNION ALL
  SELECT 'rpc.forbidden_writes',CASE WHEN NOT EXISTS (SELECT 1 FROM functions f WHERE f.definition ~ '(INSERT INTO|UPDATE|DELETE FROM|TRUNCATE) public\.(merchants|workspaces|subscriptions|invoices|payment_records|merchant_collection_limit_windows|merchant_collection_limit_reservations|merchant_collection_limit_reservation_windows|merchant_collection_usage_events)' OR f.definition ~ 'setup_mode\s*=|live_features_enabled\s*=|can_collect_payments\s*=|activation_status\s*=\s*''active''') THEN 'PASS' ELSE 'FAIL' END,'M028 function definitions contain no activation, entitlement, payment, provider, or limit writes'
  UNION ALL
  SELECT 'data.empty_after_apply',CASE WHEN (SELECT count(*) FROM public.approval_policy_versions)=0 AND (SELECT count(*) FROM public.approval_decision_requests)=0 AND (SELECT count(*) FROM public.merchant_compliance_profiles)=0 AND (SELECT count(*) FROM public.merchant_compliance_reviews)=0 AND (SELECT count(*) FROM public.merchant_compliance_events)=0 THEN 'PASS' ELSE 'FAIL' END,'Migration created no compliance business rows'
)
SELECT check_name,'rpc/security'::text object_type,status,details FROM checks
UNION ALL SELECT 'summary','summary',CASE WHEN bool_and(status='PASS') THEN 'PASS' ELSE 'FAIL' END,'All postflight checks must pass' FROM checks;
