WITH object_facts AS (
  SELECT to_regclass('public.merchant_canonical_workspaces') AS link_table_oid,
    to_regprocedure('public.reconcile_canonical_merchant_workspace_link_v1(uuid,uuid,text)') AS reconcile_oid
), workspace_facts AS (
  SELECT to_regclass('public.workspaces') AS workspace_oid,
    (SELECT attnum FROM pg_attribute WHERE attrelid=to_regclass('public.workspaces') AND attname='id' AND attnum>0 AND NOT attisdropped) AS workspace_id_attnum,
    (SELECT attnum FROM pg_attribute WHERE attrelid=to_regclass('public.workspaces') AND attname='merchant_id' AND attnum>0 AND NOT attisdropped) AS workspace_merchant_attnum
), role_facts AS (
  SELECT to_regrole('service_role') AS service_role_oid,
    to_regrole('anon') AS anon_oid,
    to_regrole('authenticated') AS authenticated_oid
), function_facts AS (
  SELECT p.oid,p.pronargs,p.prosecdef,p.proconfig,p.proacl,p.proowner,pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p CROSS JOIN object_facts o
  WHERE p.oid=o.reconcile_oid
), function_security AS (
  SELECT f.*, r.*,
    NOT EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(f.proacl, acldefault('f', f.proowner))) privilege_state
      WHERE privilege_state.grantee=0 AND privilege_state.privilege_type='EXECUTE'
    ) AS public_execute_denied,
    CASE WHEN r.anon_oid IS NULL THEN false ELSE has_function_privilege(r.anon_oid, f.oid, 'EXECUTE') END AS anon_execute,
    CASE WHEN r.authenticated_oid IS NULL THEN false ELSE has_function_privilege(r.authenticated_oid, f.oid, 'EXECUTE') END AS authenticated_execute,
    CASE WHEN r.service_role_oid IS NULL THEN false ELSE has_function_privilege(r.service_role_oid, f.oid, 'EXECUTE') END AS service_execute
  FROM function_facts f CROSS JOIN role_facts r
), table_security AS (
  SELECT o.*, r.*, c.relacl, c.relowner,
    NOT EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) privilege_state
      WHERE privilege_state.grantee=0
    ) AS public_privileges_denied,
    CASE WHEN o.link_table_oid IS NULL OR r.anon_oid IS NULL THEN false ELSE has_table_privilege(r.anon_oid, o.link_table_oid, 'SELECT') OR has_table_privilege(r.anon_oid, o.link_table_oid, 'INSERT') OR has_table_privilege(r.anon_oid, o.link_table_oid, 'UPDATE') OR has_table_privilege(r.anon_oid, o.link_table_oid, 'DELETE') OR has_table_privilege(r.anon_oid, o.link_table_oid, 'TRUNCATE') OR has_table_privilege(r.anon_oid, o.link_table_oid, 'REFERENCES') OR has_table_privilege(r.anon_oid, o.link_table_oid, 'TRIGGER') END AS anon_privileges_any,
    CASE WHEN o.link_table_oid IS NULL OR r.authenticated_oid IS NULL THEN false ELSE has_table_privilege(r.authenticated_oid, o.link_table_oid, 'SELECT') OR has_table_privilege(r.authenticated_oid, o.link_table_oid, 'INSERT') OR has_table_privilege(r.authenticated_oid, o.link_table_oid, 'UPDATE') OR has_table_privilege(r.authenticated_oid, o.link_table_oid, 'DELETE') OR has_table_privilege(r.authenticated_oid, o.link_table_oid, 'TRUNCATE') OR has_table_privilege(r.authenticated_oid, o.link_table_oid, 'REFERENCES') OR has_table_privilege(r.authenticated_oid, o.link_table_oid, 'TRIGGER') END AS authenticated_privileges_any,
    CASE WHEN o.link_table_oid IS NULL OR r.service_role_oid IS NULL THEN false ELSE has_table_privilege(r.service_role_oid, o.link_table_oid, 'SELECT') END AS service_select,
    CASE WHEN o.link_table_oid IS NULL OR r.service_role_oid IS NULL THEN false ELSE has_table_privilege(r.service_role_oid, o.link_table_oid, 'INSERT') END AS service_insert,
    CASE WHEN o.link_table_oid IS NULL OR r.service_role_oid IS NULL THEN true ELSE has_table_privilege(r.service_role_oid, o.link_table_oid, 'UPDATE') OR has_table_privilege(r.service_role_oid, o.link_table_oid, 'DELETE') OR has_table_privilege(r.service_role_oid, o.link_table_oid, 'TRUNCATE') OR has_table_privilege(r.service_role_oid, o.link_table_oid, 'REFERENCES') OR has_table_privilege(r.service_role_oid, o.link_table_oid, 'TRIGGER') END AS service_forbidden_any
  FROM object_facts o CROSS JOIN role_facts r
  LEFT JOIN pg_class c ON c.oid=o.link_table_oid
), reconcile_overloads AS (
  SELECT count(*) AS overload_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='reconcile_canonical_merchant_workspace_link_v1'
), link_row_count AS (
  SELECT o.link_table_oid,
    CASE WHEN o.link_table_oid IS NULL THEN NULL::bigint
      ELSE ((xpath('/row/count/text()', query_to_xml(format('SELECT count(*) AS count FROM %s', o.link_table_oid::text), false, true, '')))[1]::text)::bigint
    END AS row_count
  FROM object_facts o
), checks AS (
  SELECT 'objects.table'::text AS check_name,
    CASE WHEN EXISTS (SELECT 1 FROM object_facts o WHERE o.link_table_oid IS NOT NULL) THEN 'PASS' ELSE 'FAIL' END AS status,
    'Canonical workspace-link authority exists'::text AS details
  UNION ALL
  SELECT 'table.rls',
    CASE WHEN EXISTS (SELECT 1 FROM pg_class c CROSS JOIN object_facts o WHERE c.oid=o.link_table_oid AND c.relrowsecurity AND NOT c.relforcerowsecurity) THEN 'PASS' ELSE 'FAIL' END,
    'Canonical-link RLS is enabled and not forced'
  UNION ALL
  SELECT 'table.browser_grants',
    CASE WHEN EXISTS (
      SELECT 1 FROM table_security t
      WHERE t.link_table_oid IS NOT NULL AND t.public_privileges_denied
        AND NOT t.anon_privileges_any AND NOT t.authenticated_privileges_any
    ) THEN 'PASS' ELSE 'FAIL' END,
    'PUBLIC ACL plus anon/authenticated effective canonical-link table privileges are denied'
  UNION ALL
  SELECT 'table.service_role_grants',
    CASE WHEN EXISTS (
      SELECT 1 FROM table_security t
      WHERE t.link_table_oid IS NOT NULL AND t.service_select AND t.service_insert AND NOT t.service_forbidden_any
    ) THEN 'PASS' ELSE 'FAIL' END,
    'service_role has only required SELECT/INSERT table privileges'
  UNION ALL
  SELECT 'table.browser_policies',
    CASE WHEN EXISTS (SELECT 1 FROM object_facts o WHERE o.link_table_oid IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM pg_policy p CROSS JOIN object_facts o WHERE p.polrelid=o.link_table_oid) THEN 'PASS' ELSE 'FAIL' END,
    'No canonical-link browser policies exist'
  UNION ALL
  SELECT 'table.constraints_indexes',
    CASE WHEN EXISTS (SELECT 1 FROM pg_constraint c CROSS JOIN object_facts o WHERE c.conrelid=o.link_table_oid AND c.conname='merchant_canonical_workspaces_pkey' AND c.contype='p'::"char")
      AND EXISTS (SELECT 1 FROM pg_constraint c CROSS JOIN object_facts o WHERE c.conrelid=o.link_table_oid AND c.conname='merchant_canonical_workspaces_workspace_key' AND c.contype='u'::"char")
      AND EXISTS (SELECT 1 FROM pg_constraint c CROSS JOIN object_facts o WHERE c.conrelid=o.link_table_oid AND c.conname='merchant_canonical_workspaces_reconcile_key' AND c.contype='u'::"char")
      AND EXISTS (SELECT 1 FROM pg_constraint c CROSS JOIN object_facts o WHERE c.conrelid=o.link_table_oid AND c.conname='merchant_canonical_workspaces_workspace_owner_fkey' AND c.contype='f'::"char" AND c.convalidated)
      AND EXISTS (
        SELECT 1 FROM pg_index i CROSS JOIN workspace_facts f
        WHERE i.indexrelid=to_regclass('public.merchant_canonical_workspace_supporting_owner_key')
          AND i.indrelid=f.workspace_oid AND i.indisunique AND i.indpred IS NULL
          AND i.indnkeyatts=2 AND i.indnatts=2
          AND ARRAY(
            SELECT index_key.attnum
            FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS index_key(attnum, ordinal_position)
            ORDER BY index_key.ordinal_position
          )=ARRAY[f.workspace_id_attnum,f.workspace_merchant_attnum]::smallint[]
      )
    THEN 'PASS' ELSE 'FAIL' END,
    'Canonical keys, composite ownership FK, and exact supporting unique index exist'
  UNION ALL
  SELECT 'table.immutable_posture',
    CASE WHEN EXISTS (
      SELECT 1 FROM table_security t
      WHERE t.link_table_oid IS NOT NULL AND NOT t.service_forbidden_any
    ) AND NOT EXISTS (SELECT 1 FROM pg_trigger t CROSS JOIN object_facts o WHERE t.tgrelid=o.link_table_oid AND NOT t.tgisinternal)
    THEN 'PASS' ELSE 'FAIL' END,
    'No service-role update/delete privilege or user trigger can mutate canonical links'
  UNION ALL
  SELECT 'rpc.signature',
    CASE WHEN EXISTS (SELECT 1 FROM object_facts o WHERE o.reconcile_oid IS NOT NULL)
      AND (SELECT overload_count FROM reconcile_overloads)=1
    THEN 'PASS' ELSE 'FAIL' END,
    'One exact reconcile_canonical_merchant_workspace_link_v1(uuid,uuid,text) signature exists'
  UNION ALL
  SELECT 'rpc.security',
    CASE WHEN EXISTS (SELECT 1 FROM function_facts f WHERE NOT f.prosecdef AND COALESCE(f.proconfig @> ARRAY['search_path=pg_catalog, public'], false)) THEN 'PASS' ELSE 'FAIL' END,
    'Reconcile RPC is SECURITY INVOKER with hardened search path'
  UNION ALL
  SELECT 'rpc.grants',
    CASE WHEN EXISTS (
      SELECT 1 FROM function_security f
      WHERE f.public_execute_denied AND NOT f.anon_execute AND NOT f.authenticated_execute AND f.service_execute
    ) THEN 'PASS' ELSE 'FAIL' END,
    'Only service_role can execute the exact reconcile RPC'
  UNION ALL
  SELECT 'rpc.diagnostics_absent',
    CASE WHEN EXISTS (SELECT 1 FROM function_facts)
      AND NOT EXISTS (SELECT 1 FROM function_facts f WHERE f.definition ~ 'LOCAL_APPROVAL_BRANCH|LOCAL_APPROVAL_EXCEPTION|deraledger\.local_approval_rehearsal_diagnostics|approval_rpc_internal_diagnostics|GET STACKED DIAGNOSTICS')
    THEN 'PASS' ELSE 'FAIL' END,
    'No local diagnostic instrumentation appears in reconcile RPC'
  UNION ALL
  SELECT 'rpc.forbidden_writes',
    CASE WHEN EXISTS (SELECT 1 FROM function_facts)
      AND NOT EXISTS (SELECT 1 FROM function_facts f WHERE f.definition ~ '(UPDATE|DELETE FROM|TRUNCATE) public\.(merchants|workspaces|merchant_compliance_profiles|merchant_compliance_events|approval_decision_requests|payment|provider|invoice|subscription|merchant_collection)')
      AND NOT EXISTS (SELECT 1 FROM function_facts f WHERE f.definition ~ 'setup_mode|live_features_enabled|can_collect_payments|activation_status')
    THEN 'PASS' ELSE 'FAIL' END,
    'Reconcile RPC has no activation, collection, or forbidden operational writes'
  UNION ALL
  SELECT 'm028.remains_fail_closed',
    CASE WHEN EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.issue_canonical_approval_decision_request_v1(uuid,uuid,text,text,text)') AND pg_get_functiondef(p.oid) ~ 'canonical_request_workspace_linkage_unavailable')
      AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.read_canonical_approval_snapshot_v1(uuid)') AND pg_get_functiondef(p.oid) ~ 'canonical_snapshot_workspace_linkage_unavailable')
    THEN 'PASS' ELSE 'FAIL' END,
    'M029 does not enable M028 issue/snapshot readiness'
  UNION ALL
  SELECT 'data.empty_after_apply',
    CASE WHEN EXISTS (SELECT 1 FROM link_row_count r WHERE r.link_table_oid IS NOT NULL AND r.row_count=0) THEN 'PASS' ELSE 'FAIL' END,
    'Installation created no canonical-link business rows'
), rendered AS (
  SELECT check_name,status,details FROM checks
), summary AS (
  SELECT CASE WHEN bool_and(status='PASS') THEN 'PASS' ELSE 'FAIL' END AS status FROM rendered
), output_rows AS (
  SELECT check_name, status, details FROM rendered
  UNION ALL
  SELECT 'summary', status, 'All postflight checks must pass' FROM summary
)
SELECT check_name, status, details
FROM output_rows
ORDER BY CASE WHEN check_name='summary' THEN 1 ELSE 0 END, check_name;
