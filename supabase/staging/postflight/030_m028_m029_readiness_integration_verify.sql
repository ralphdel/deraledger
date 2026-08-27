WITH role_facts AS (
  SELECT to_regrole('service_role') AS service_role_oid,
         to_regrole('anon') AS anon_oid,
         to_regrole('authenticated') AS authenticated_oid
), function_specs AS (
  SELECT * FROM (VALUES
    ('approval_v1', 'review_compliance_profile_decision_v1', 'public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)'),
    ('issue_v1', 'issue_canonical_approval_decision_request_v1', 'public.issue_canonical_approval_decision_request_v1(uuid,uuid,text,text,text)'),
    ('snapshot_v1', 'read_canonical_approval_snapshot_v1', 'public.read_canonical_approval_snapshot_v1(uuid)'),
    ('reconcile_v1', 'reconcile_canonical_merchant_workspace_link_v1', 'public.reconcile_canonical_merchant_workspace_link_v1(uuid,uuid,text)'),
    ('issue_v2', 'issue_canonical_approval_decision_request_v2', 'public.issue_canonical_approval_decision_request_v2(uuid,uuid,text,text,text)'),
    ('snapshot_v2', 'read_canonical_approval_snapshot_v2', 'public.read_canonical_approval_snapshot_v2(uuid)')
  ) AS expected(label, proname, signature)
), function_facts AS (
  SELECT expected.*, to_regprocedure(expected.signature) AS oid
  FROM function_specs expected
), function_security AS (
  SELECT fact.*, p.prosecdef, p.proconfig, p.proacl, p.proowner, pg_get_functiondef(p.oid) AS definition,
    NOT EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) privilege_state
      WHERE privilege_state.grantee = 0 AND privilege_state.privilege_type = 'EXECUTE'
    ) AS public_execute_denied,
    CASE WHEN roles.anon_oid IS NULL OR fact.oid IS NULL THEN false ELSE has_function_privilege(roles.anon_oid, fact.oid, 'EXECUTE') END AS anon_execute,
    CASE WHEN roles.authenticated_oid IS NULL OR fact.oid IS NULL THEN false ELSE has_function_privilege(roles.authenticated_oid, fact.oid, 'EXECUTE') END AS authenticated_execute,
    CASE WHEN roles.service_role_oid IS NULL OR fact.oid IS NULL THEN false ELSE has_function_privilege(roles.service_role_oid, fact.oid, 'EXECUTE') END AS service_execute
  FROM function_facts fact
  CROSS JOIN role_facts roles
  LEFT JOIN pg_proc p ON p.oid = fact.oid
), function_overloads AS (
  SELECT expected.proname,
    count(actual.oid) AS overload_count
  FROM (SELECT DISTINCT proname FROM function_specs) expected
  LEFT JOIN pg_proc actual ON actual.pronamespace = 'public'::regnamespace AND actual.proname = expected.proname
  GROUP BY expected.proname
), table_specs AS (
  SELECT * FROM (VALUES
    ('merchant_compliance_profiles'), ('merchant_compliance_reviews'), ('merchant_compliance_events'),
    ('approval_policy_versions'), ('approval_decision_requests'), ('merchant_canonical_workspaces')
  ) AS expected(table_name)
), table_facts AS (
  SELECT expected.table_name, to_regclass(format('public.%I', expected.table_name)) AS oid
  FROM table_specs expected
), table_security AS (
  SELECT table_fact.*, roles.*,
    CASE WHEN table_fact.oid IS NULL THEN false ELSE EXISTS (
      SELECT 1 FROM pg_class c
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) privilege_state
      WHERE c.oid = table_fact.oid AND privilege_state.grantee = 0
    ) END AS public_privilege_exists,
    CASE WHEN table_fact.oid IS NULL OR roles.anon_oid IS NULL THEN false ELSE has_table_privilege(roles.anon_oid, table_fact.oid, 'SELECT') OR has_table_privilege(roles.anon_oid, table_fact.oid, 'INSERT') OR has_table_privilege(roles.anon_oid, table_fact.oid, 'UPDATE') OR has_table_privilege(roles.anon_oid, table_fact.oid, 'DELETE') END AS anon_privilege_exists,
    CASE WHEN table_fact.oid IS NULL OR roles.authenticated_oid IS NULL THEN false ELSE has_table_privilege(roles.authenticated_oid, table_fact.oid, 'SELECT') OR has_table_privilege(roles.authenticated_oid, table_fact.oid, 'INSERT') OR has_table_privilege(roles.authenticated_oid, table_fact.oid, 'UPDATE') OR has_table_privilege(roles.authenticated_oid, table_fact.oid, 'DELETE') END AS authenticated_privilege_exists
  FROM table_facts table_fact CROSS JOIN role_facts roles
), authority_counts AS (
  SELECT table_fact.table_name, table_fact.oid,
    CASE WHEN table_fact.oid IS NULL THEN NULL::bigint
      ELSE ((xpath('/row/count/text()', query_to_xml(format('SELECT count(*) AS count FROM %s', table_fact.oid::text), false, true, '')))[1]::text)::bigint
    END AS row_count
  FROM table_facts table_fact
  WHERE table_fact.table_name IN ('approval_decision_requests', 'merchant_canonical_workspaces')
), checks AS (
  SELECT 'rpc.signatures'::text AS check_name,
    CASE WHEN (SELECT count(*) FROM function_security WHERE oid IS NOT NULL) = 6
      AND NOT EXISTS (SELECT 1 FROM function_overloads WHERE overload_count <> 1)
    THEN 'PASS' ELSE 'FAIL' END AS status,
    'One exact M026, M028 v1/v2, and M029 reconcile signature exists for each function name'::text AS details
  UNION ALL
  SELECT 'rpc.security_grants',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM function_security f
      WHERE f.oid IS NULL OR f.prosecdef
        OR NOT COALESCE(f.proconfig @> ARRAY['search_path=pg_catalog, public'], false)
        OR NOT f.public_execute_denied OR f.anon_execute OR f.authenticated_execute OR NOT f.service_execute
    ) THEN 'PASS' ELSE 'FAIL' END,
    'All approval-context RPCs are SECURITY INVOKER, hardened, and service-role-only'
  UNION ALL
  SELECT 'm028.v1_preserved',
    CASE WHEN EXISTS (SELECT 1 FROM function_security f WHERE f.label='issue_v1' AND f.definition ~ 'canonical_request_workspace_linkage_unavailable')
      AND EXISTS (SELECT 1 FROM function_security f WHERE f.label='snapshot_v1' AND f.definition ~ 'canonical_snapshot_workspace_linkage_unavailable')
    THEN 'PASS' ELSE 'FAIL' END,
    'M030 did not replace M028 v1 fail-closed RPC bodies'
  UNION ALL
  SELECT 'm029.authority_intact',
    CASE WHEN to_regclass('public.merchant_canonical_workspaces') IS NOT NULL
      AND EXISTS (SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('public.merchant_canonical_workspaces') AND c.relrowsecurity AND NOT c.relforcerowsecurity)
      AND EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=to_regclass('public.merchant_canonical_workspaces') AND c.conname='merchant_canonical_workspaces_pkey' AND c.contype='p'::"char" AND c.convalidated)
      AND EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=to_regclass('public.merchant_canonical_workspaces') AND c.conname='merchant_canonical_workspaces_workspace_owner_fkey' AND c.contype='f'::"char" AND c.convalidated)
      AND to_regclass('public.merchant_canonical_workspace_supporting_owner_key') IS NOT NULL
    THEN 'PASS' ELSE 'FAIL' END,
    'M029 canonical link authority, RLS, and composite ownership proof remain intact'
  UNION ALL
  SELECT 'tables.browser_security',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM table_security table_state
      WHERE table_state.oid IS NULL OR table_state.public_privilege_exists OR table_state.anon_privilege_exists OR table_state.authenticated_privilege_exists
        OR EXISTS (SELECT 1 FROM pg_policy policy_state WHERE policy_state.polrelid=table_state.oid)
    ) THEN 'PASS' ELSE 'FAIL' END,
    'M028/M029/compliance authorities retain no browser/public table grants or policies'
  UNION ALL
  SELECT 'v2.workspace_authority',
    CASE WHEN EXISTS (
      SELECT 1 FROM function_security f
      WHERE f.label='issue_v2'
        AND f.definition ~ 'public\.merchant_canonical_workspaces'
        AND f.definition ~ 'JOIN public\.workspaces workspace_owner'
        AND f.definition ~ 'workspace_owner\.id = canonical_link\.workspace_id'
        AND f.definition ~ 'workspace_owner\.merchant_id = canonical_link\.merchant_id'
        AND f.definition ~ 'canonical_request_v2_workspace_linkage_unavailable'
        AND f.definition ~ 'canonical_request_v2_workspace_linkage_conflict'
    ) AND EXISTS (
      SELECT 1 FROM function_security f
      WHERE f.label='snapshot_v2'
        AND f.definition ~ 'public\.merchant_canonical_workspaces'
        AND f.definition ~ 'JOIN public\.workspaces workspace_owner'
        AND f.definition ~ 'v_request\.workspace_id IS DISTINCT FROM v_workspace_id'
        AND f.definition ~ 'canonical_snapshot_v2_workspace_linkage_unavailable'
        AND f.definition ~ 'canonical_snapshot_v2_workspace_linkage_conflict'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'V2 issue/snapshot re-read M029 link and re-prove merchant/workspace ownership before readiness'
  UNION ALL
  SELECT 'v2.safe_result_codes',
    CASE WHEN EXISTS (
      SELECT 1 FROM function_security f WHERE f.label='issue_v2'
        AND f.definition ~ 'canonical_request_v2_payload_invalid'
        AND f.definition ~ 'canonical_request_v2_reviewer_invalid'
        AND f.definition ~ 'canonical_request_v2_profile_missing'
        AND f.definition ~ 'canonical_request_v2_profile_state_invalid'
        AND f.definition ~ 'canonical_request_v2_workspace_linkage_unavailable'
        AND f.definition ~ 'canonical_request_v2_workspace_linkage_conflict'
        AND f.definition ~ 'canonical_request_v2_policy_invalid'
        AND f.definition ~ 'canonical_request_v2_source_invalid'
        AND f.definition ~ 'canonical_request_v2_idempotent_replay'
        AND f.definition ~ 'canonical_request_v2_idempotency_conflict'
        AND f.definition ~ 'canonical_request_v2_created'
        AND f.definition ~ 'canonical_request_v2_failed'
    ) AND EXISTS (
      SELECT 1 FROM function_security f WHERE f.label='snapshot_v2'
        AND f.definition ~ 'canonical_snapshot_v2_payload_invalid'
        AND f.definition ~ 'canonical_snapshot_v2_request_missing'
        AND f.definition ~ 'canonical_snapshot_v2_profile_missing'
        AND f.definition ~ 'canonical_snapshot_v2_stale_or_conflicting'
        AND f.definition ~ 'canonical_snapshot_v2_workspace_linkage_unavailable'
        AND f.definition ~ 'canonical_snapshot_v2_workspace_linkage_conflict'
        AND f.definition ~ 'canonical_snapshot_v2_policy_invalid'
        AND f.definition ~ 'canonical_snapshot_v2_source_invalid'
        AND f.definition ~ 'canonical_snapshot_v2_ready'
        AND f.definition ~ 'canonical_snapshot_v2_failed'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'V2 functions expose only the locked safe result-code vocabulary'
  UNION ALL
  SELECT 'rpc.diagnostics_and_forbidden_writes_absent',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM function_security f
      WHERE f.label IN ('issue_v2', 'snapshot_v2')
        AND (
          f.definition ~ 'LOCAL_APPROVAL_BRANCH|LOCAL_APPROVAL_EXCEPTION|deraledger\.local_approval_rehearsal_diagnostics|approval_rpc_internal_diagnostics|GET STACKED DIAGNOSTICS|RAISE NOTICE'
          OR f.definition ~ '(INSERT INTO|UPDATE|DELETE FROM|TRUNCATE) public\.(merchants|workspaces|merchant_canonical_workspaces|merchant_compliance_profiles|merchant_compliance_reviews|merchant_compliance_events|merchant_collection|payment|provider|invoice|subscription|storefront)'
          OR f.definition ~ 'setup_mode\s*=|live_features_enabled\s*=|can_collect_payments\s*=|activation_status\s*=\s*''active'''
        )
    ) THEN 'PASS' ELSE 'FAIL' END,
    'V2 contains no diagnostics, forbidden writes, activation, entitlement, payment, provider, limit, or storefront behavior'
  UNION ALL
  SELECT 'data.new_authorities_empty_after_apply',
    CASE WHEN NOT EXISTS (SELECT 1 FROM authority_counts count_state WHERE count_state.oid IS NULL OR count_state.row_count <> 0)
    THEN 'PASS' ELSE 'FAIL' END,
    'M030 installation created no approval-request or canonical-link business rows'
), rendered AS (
  SELECT check_name, 'rpc/security'::text AS object_type, status, details FROM checks
), summary AS (
  SELECT CASE WHEN bool_and(status='PASS') THEN 'PASS' ELSE 'FAIL' END AS status FROM rendered
), output_rows AS (
  SELECT check_name, object_type, status, details FROM rendered
  UNION ALL
  SELECT 'summary', 'summary', status, 'All postflight checks must pass' FROM summary
)
SELECT check_name, object_type, status, details
FROM output_rows
ORDER BY CASE WHEN check_name='summary' THEN 1 ELSE 0 END, check_name;
