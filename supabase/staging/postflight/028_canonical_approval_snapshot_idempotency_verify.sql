WITH functions AS (
  SELECT p.oid,p.proname,p.prosecdef,p.proconfig,p.proacl,p.proowner,pg_get_functiondef(p.oid) definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('issue_canonical_approval_decision_request_v1','read_canonical_approval_snapshot_v1')
), expected_functions AS (
  SELECT * FROM (VALUES
    ('issue_canonical_approval_decision_request_v1','public.issue_canonical_approval_decision_request_v1(uuid,uuid,text,text,text)'),
    ('read_canonical_approval_snapshot_v1','public.read_canonical_approval_snapshot_v1(uuid)')
  ) AS e(proname,signature)
), expected_table_grants AS (
  SELECT * FROM (VALUES
    ('approval_policy_versions', ARRAY['SELECT']::text[]),
    ('approval_decision_requests', ARRAY['INSERT','SELECT']::text[])
  ) AS e(table_name, expected_privileges)
), actual_service_role_grants AS (
  SELECT e.table_name, COALESCE(array_agg(DISTINCT g.privilege_type::text ORDER BY g.privilege_type::text) FILTER (WHERE g.privilege_type IS NOT NULL), ARRAY[]::text[]) AS actual_privileges
  FROM expected_table_grants e
  LEFT JOIN information_schema.role_table_grants g
    ON g.table_schema='public' AND g.table_name=e.table_name AND g.grantee='service_role'
  GROUP BY e.table_name
), required_constraints AS (
  SELECT * FROM (VALUES
    ('approval_policy_versions','approval_policy_versions_pkey'),('approval_policy_versions','approval_policy_versions_version_check'),('approval_policy_versions','approval_policy_versions_plan_source_check'),('approval_policy_versions','approval_policy_versions_state_check'),
    ('approval_decision_requests','approval_decision_requests_pkey'),('approval_decision_requests','approval_decision_requests_key_unique'),('approval_decision_requests','approval_decision_requests_fingerprint_unique'),('approval_decision_requests','approval_decision_requests_reviewer_fkey'),('approval_decision_requests','approval_decision_requests_merchant_fkey'),('approval_decision_requests','approval_decision_requests_workspace_fkey'),('approval_decision_requests','approval_decision_requests_profile_fkey'),('approval_decision_requests','approval_decision_requests_policy_fkey'),('approval_decision_requests','approval_decision_requests_key_check'),('approval_decision_requests','approval_decision_requests_versions_check'),('approval_decision_requests','approval_decision_requests_plan_source_check'),('approval_decision_requests','approval_decision_requests_target_check'),('approval_decision_requests','approval_decision_requests_reason_check')
  ) AS e(table_name,constraint_name)
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
  SELECT 'objects.tables'::text check_name,CASE WHEN to_regclass('public.approval_policy_versions') IS NOT NULL AND to_regclass('public.approval_decision_requests') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END status,'M028 policy and immutable decision-request tables exist'::text details
  UNION ALL
  SELECT 'prerequisite.workspace_linkage',CASE WHEN merchant_id_is_unique AND workspace_id_is_unique AND workspace_merchant_is_unique AND workspace_merchant_fk_is_exact THEN 'PASS' ELSE 'FAIL' END,'Canonical workspaces.merchant_id remains unique and FK-backed' FROM workspace_key_shape
  UNION ALL
  SELECT 'tables.rls',CASE WHEN (SELECT count(*) FROM pg_class c WHERE c.oid IN (to_regclass('public.approval_policy_versions'),to_regclass('public.approval_decision_requests')) AND c.relrowsecurity AND NOT c.relforcerowsecurity)=2 THEN 'PASS' ELSE 'FAIL' END,'M028 tables have RLS enabled and not forced'
  UNION ALL
  SELECT 'tables.service_role_grants',CASE WHEN NOT EXISTS (SELECT 1 FROM expected_table_grants e JOIN actual_service_role_grants a USING (table_name) WHERE a.actual_privileges<>e.expected_privileges) AND NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants g WHERE g.table_schema='public' AND g.table_name IN ('approval_policy_versions','approval_decision_requests') AND g.grantee IN ('PUBLIC','anon','authenticated')) THEN 'PASS' ELSE 'FAIL' END,'service_role has only SELECT on policy versions and SELECT/INSERT on decision requests; browser roles have no table grant'
  UNION ALL
  SELECT 'tables.constraints_indexes',CASE WHEN NOT EXISTS (SELECT 1 FROM required_constraints e WHERE NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=to_regclass(format('public.%I',e.table_name)) AND c.conname=e.constraint_name)) AND to_regclass('public.idx_approval_decision_requests_profile_source') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,'Required M028 request uniqueness, foreign-key, check constraints, and profile/source index exist'
  UNION ALL
  SELECT 'tables.immutable_posture',CASE WHEN NOT EXISTS (SELECT 1 FROM actual_service_role_grants a WHERE a.table_name='approval_policy_versions' AND a.actual_privileges<>ARRAY['SELECT']::text[]) AND NOT EXISTS (SELECT 1 FROM actual_service_role_grants a WHERE a.table_name='approval_decision_requests' AND a.actual_privileges<>ARRAY['INSERT','SELECT']::text[]) AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid IN (to_regclass('public.approval_policy_versions'),to_regclass('public.approval_decision_requests'))) AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid IN (to_regclass('public.approval_policy_versions'),to_regclass('public.approval_decision_requests')) AND NOT t.tgisinternal) THEN 'PASS' ELSE 'FAIL' END,'Service-role grants exclude UPDATE/DELETE; M028 tables have no policies or user triggers'
  UNION ALL
  SELECT 'rpc.signature',CASE WHEN (SELECT count(*) FROM functions)=2 AND NOT EXISTS (SELECT 1 FROM expected_functions e WHERE NOT EXISTS (SELECT 1 FROM functions f WHERE f.oid=to_regprocedure(e.signature))) THEN 'PASS' ELSE 'FAIL' END,'Exactly the two expected M028 RPC signatures exist'
  UNION ALL
  SELECT 'rpc.security',CASE WHEN (SELECT count(*) FROM functions)=2 AND (SELECT bool_and(NOT prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, public']) FROM functions) THEN 'PASS' ELSE 'FAIL' END,'M028 RPCs are SECURITY INVOKER with hardened search paths'
  UNION ALL
  SELECT 'rpc.grants',CASE WHEN NOT EXISTS (SELECT 1 FROM expected_functions e WHERE has_function_privilege('anon',e.signature,'EXECUTE') OR has_function_privilege('authenticated',e.signature,'EXECUTE') OR NOT has_function_privilege('service_role',e.signature,'EXECUTE')) AND NOT EXISTS (SELECT 1 FROM functions f CROSS JOIN LATERAL aclexplode(COALESCE(f.proacl,acldefault('f',f.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') THEN 'PASS' ELSE 'FAIL' END,'No PUBLIC/anon/authenticated EXECUTE; service_role has exact RPC execute'
  UNION ALL
  SELECT 'tables.browser_security',CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants g WHERE g.table_schema='public' AND g.table_name IN ('approval_policy_versions','approval_decision_requests','merchant_compliance_profiles','merchant_compliance_reviews','merchant_compliance_events') AND g.grantee IN ('PUBLIC','anon','authenticated')) AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid IN (to_regclass('public.approval_policy_versions'),to_regclass('public.approval_decision_requests'),to_regclass('public.merchant_compliance_profiles'),to_regclass('public.merchant_compliance_reviews'),to_regclass('public.merchant_compliance_events'))) THEN 'PASS' ELSE 'FAIL' END,'No browser/public grants or policies on M028/compliance tables'
  UNION ALL
  SELECT 'rpc.diagnostics_absent',CASE WHEN NOT EXISTS (SELECT 1 FROM functions f WHERE f.definition ~ 'LOCAL_APPROVAL_BRANCH|LOCAL_APPROVAL_EXCEPTION|deraledger\.local_approval_rehearsal_diagnostics|approval_rpc_internal_diagnostics|GET STACKED DIAGNOSTICS') THEN 'PASS' ELSE 'FAIL' END,'M028 RPC definitions contain no local diagnostic instrumentation'
  UNION ALL
  SELECT 'rpc.forbidden_writes',CASE WHEN NOT EXISTS (SELECT 1 FROM functions f WHERE f.definition ~ '(INSERT INTO|UPDATE|DELETE FROM|TRUNCATE) public\.(merchants|workspaces|subscriptions|invoices|payment_records|providers|merchant_collection_limit_windows|merchant_collection_limit_reservations|merchant_collection_limit_reservation_windows|merchant_collection_usage_events)' OR f.definition ~ 'setup_mode\s*=|live_features_enabled\s*=|can_collect_payments\s*=|activation_status\s*=\s*''active''') THEN 'PASS' ELSE 'FAIL' END,'M028 function definitions contain no activation, entitlement, payment, provider, or limit writes'
  UNION ALL
  SELECT 'data.empty_after_apply',CASE WHEN (SELECT count(*) FROM public.approval_policy_versions)=0 AND (SELECT count(*) FROM public.approval_decision_requests)=0 AND (SELECT count(*) FROM public.merchant_compliance_profiles)=0 AND (SELECT count(*) FROM public.merchant_compliance_reviews)=0 AND (SELECT count(*) FROM public.merchant_compliance_events)=0 THEN 'PASS' ELSE 'FAIL' END,'Migration created no compliance business rows'
)
SELECT check_name,'rpc/security'::text object_type,status,details FROM checks
UNION ALL SELECT 'summary','summary',CASE WHEN bool_and(status='PASS') THEN 'PASS' ELSE 'FAIL' END,'All postflight checks must pass' FROM checks;
