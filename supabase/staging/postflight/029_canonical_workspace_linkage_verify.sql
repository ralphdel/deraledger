WITH function_facts AS (
  SELECT p.oid,p.pronargs,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='reconcile_canonical_merchant_workspace_link_v1'
), link_table AS (
  SELECT to_regclass('public.merchant_canonical_workspaces') oid
), checks AS (
  SELECT 'objects.table'::text check_name,
    CASE WHEN (SELECT oid IS NOT NULL FROM link_table) THEN 'PASS' ELSE 'FAIL' END status,
    'Canonical workspace-link authority exists'::text details
  UNION ALL
  SELECT 'table.rls',
    CASE WHEN EXISTS (SELECT 1 FROM pg_class c CROSS JOIN link_table t WHERE c.oid=t.oid AND c.relrowsecurity AND NOT c.relforcerowsecurity) THEN 'PASS' ELSE 'FAIL' END,
    'Canonical-link RLS is enabled and not forced'
  UNION ALL
  SELECT 'table.browser_grants',
    CASE WHEN (SELECT oid IS NOT NULL FROM link_table)
      AND NOT has_table_privilege('PUBLIC','public.merchant_canonical_workspaces','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT has_table_privilege('anon','public.merchant_canonical_workspaces','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT has_table_privilege('authenticated','public.merchant_canonical_workspaces','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    THEN 'PASS' ELSE 'FAIL' END,
    'PUBLIC, anon, and authenticated have no effective canonical-link table privileges'
  UNION ALL
  SELECT 'table.service_role_grants',
    CASE WHEN has_table_privilege('service_role','public.merchant_canonical_workspaces','SELECT')
      AND has_table_privilege('service_role','public.merchant_canonical_workspaces','INSERT')
      AND NOT has_table_privilege('service_role','public.merchant_canonical_workspaces','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    THEN 'PASS' ELSE 'FAIL' END,
    'service_role has only required SELECT/INSERT table privileges'
  UNION ALL
  SELECT 'table.browser_policies',
    CASE WHEN NOT EXISTS (SELECT 1 FROM pg_policy p CROSS JOIN link_table t WHERE p.polrelid=t.oid) THEN 'PASS' ELSE 'FAIL' END,
    'No canonical-link browser policies exist'
  UNION ALL
  SELECT 'table.constraints_indexes',
    CASE WHEN EXISTS (SELECT 1 FROM pg_constraint c CROSS JOIN link_table t WHERE c.conrelid=t.oid AND c.conname='merchant_canonical_workspaces_pkey' AND c.contype='p'::"char")
      AND EXISTS (SELECT 1 FROM pg_constraint c CROSS JOIN link_table t WHERE c.conrelid=t.oid AND c.conname='merchant_canonical_workspaces_workspace_key' AND c.contype='u'::"char")
      AND EXISTS (SELECT 1 FROM pg_constraint c CROSS JOIN link_table t WHERE c.conrelid=t.oid AND c.conname='merchant_canonical_workspaces_reconcile_key' AND c.contype='u'::"char")
      AND EXISTS (SELECT 1 FROM pg_constraint c CROSS JOIN link_table t WHERE c.conrelid=t.oid AND c.conname='merchant_canonical_workspaces_workspace_owner_fkey' AND c.contype='f'::"char" AND c.convalidated)
      AND EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=to_regclass('public.workspaces') AND i.indisunique AND i.indpred IS NULL AND i.indexrelid=to_regclass('public.merchant_canonical_workspace_supporting_owner_key'))
    THEN 'PASS' ELSE 'FAIL' END,
    'Canonical keys, composite ownership FK, and supporting unique index exist'
  UNION ALL
  SELECT 'table.immutable_posture',
    CASE WHEN NOT has_table_privilege('service_role','public.merchant_canonical_workspaces','UPDATE,DELETE')
      AND NOT EXISTS (SELECT 1 FROM pg_trigger t CROSS JOIN link_table l WHERE t.tgrelid=l.oid AND NOT t.tgisinternal)
    THEN 'PASS' ELSE 'FAIL' END,
    'No service-role update/delete privilege or user trigger can mutate canonical links'
  UNION ALL
  SELECT 'rpc.signature',
    CASE WHEN (SELECT count(*) FROM function_facts)=1 AND (SELECT pronargs FROM function_facts)=3 THEN 'PASS' ELSE 'FAIL' END,
    'One exact reconcile RPC signature exists'
  UNION ALL
  SELECT 'rpc.security',
    CASE WHEN EXISTS (SELECT 1 FROM function_facts f WHERE NOT f.prosecdef AND f.proconfig @> ARRAY['search_path=pg_catalog, public']) THEN 'PASS' ELSE 'FAIL' END,
    'Reconcile RPC is SECURITY INVOKER with hardened search path'
  UNION ALL
  SELECT 'rpc.grants',
    CASE WHEN NOT has_function_privilege('PUBLIC','public.reconcile_canonical_merchant_workspace_link_v1(uuid,uuid,text)','EXECUTE')
      AND NOT has_function_privilege('anon','public.reconcile_canonical_merchant_workspace_link_v1(uuid,uuid,text)','EXECUTE')
      AND NOT has_function_privilege('authenticated','public.reconcile_canonical_merchant_workspace_link_v1(uuid,uuid,text)','EXECUTE')
      AND has_function_privilege('service_role','public.reconcile_canonical_merchant_workspace_link_v1(uuid,uuid,text)','EXECUTE')
    THEN 'PASS' ELSE 'FAIL' END,
    'Only service_role can execute the exact reconcile RPC'
  UNION ALL
  SELECT 'rpc.diagnostics_absent',
    CASE WHEN NOT EXISTS (SELECT 1 FROM function_facts f WHERE f.definition ~ 'LOCAL_APPROVAL_BRANCH|LOCAL_APPROVAL_EXCEPTION|deraledger\.local_approval_rehearsal_diagnostics|approval_rpc_internal_diagnostics|GET STACKED DIAGNOSTICS') THEN 'PASS' ELSE 'FAIL' END,
    'No local diagnostic instrumentation appears in reconcile RPC'
  UNION ALL
  SELECT 'rpc.forbidden_writes',
    CASE WHEN NOT EXISTS (SELECT 1 FROM function_facts f WHERE f.definition ~ '(UPDATE|DELETE FROM|TRUNCATE) public\.(merchants|workspaces|merchant_compliance_profiles|merchant_compliance_events|approval_decision_requests|payment|provider|invoice|subscription|merchant_collection)')
      AND NOT EXISTS (SELECT 1 FROM function_facts f WHERE f.definition ~ 'setup_mode|live_features_enabled|can_collect_payments|activation_status')
    THEN 'PASS' ELSE 'FAIL' END,
    'Reconcile RPC has no activation, collection, or forbidden operational writes'
  UNION ALL
  SELECT 'm028.remains_fail_closed',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid=to_regprocedure('public.issue_canonical_approval_decision_request_v1(uuid,uuid,text,text,text)')
        AND pg_get_functiondef(p.oid) ~ 'canonical_request_workspace_linkage_unavailable'
    ) AND EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid=to_regprocedure('public.read_canonical_approval_snapshot_v1(uuid)')
        AND pg_get_functiondef(p.oid) ~ 'canonical_snapshot_workspace_linkage_unavailable'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'M029 does not enable M028 issue/snapshot readiness'
  UNION ALL
  SELECT 'data.empty_after_apply',
    CASE WHEN (SELECT oid IS NOT NULL FROM link_table) AND (SELECT count(*) FROM public.merchant_canonical_workspaces)=0 THEN 'PASS' ELSE 'FAIL' END,
    'Installation created no canonical-link business rows'
), rendered AS (
  SELECT check_name,status,details FROM checks
), summary AS (
  SELECT CASE WHEN bool_and(status='PASS') THEN 'PASS' ELSE 'FAIL' END status FROM rendered
)
SELECT check_name,status,details FROM rendered
UNION ALL
SELECT 'summary',status,'All postflight checks must pass' FROM summary
ORDER BY CASE WHEN check_name='summary' THEN 1 ELSE 0 END, check_name;
