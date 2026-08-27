WITH role_facts AS (
  SELECT to_regrole('service_role') AS service_role_oid,
         to_regrole('anon') AS anon_oid,
         to_regrole('authenticated') AS authenticated_oid
), function_specs AS (
  SELECT * FROM (VALUES
    ('approval', 'public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)'),
    ('issue_v1', 'public.issue_canonical_approval_decision_request_v1(uuid,uuid,text,text,text)'),
    ('snapshot_v1', 'public.read_canonical_approval_snapshot_v1(uuid)'),
    ('reconcile_v1', 'public.reconcile_canonical_merchant_workspace_link_v1(uuid,uuid,text)')
  ) AS expected(label, signature)
), function_facts AS (
  SELECT expected.label, expected.signature, to_regprocedure(expected.signature) AS oid
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
), required_tables AS (
  SELECT * FROM (VALUES
    ('merchant_compliance_profiles'), ('merchant_compliance_reviews'), ('merchant_compliance_events'), ('solo_plus_cases'),
    ('approval_policy_versions'), ('approval_decision_requests'),
    ('merchant_canonical_workspaces'), ('workspaces')
  ) AS expected(table_name)
), table_facts AS (
  SELECT expected.table_name, to_regclass(format('public.%I', expected.table_name)) AS oid
  FROM required_tables expected
), service_read_contract AS (
  SELECT * FROM (VALUES
    ('merchant_compliance_profiles', 'SELECT'), ('merchant_compliance_reviews', 'SELECT'),
    ('solo_plus_cases', 'SELECT'), ('approval_policy_versions', 'SELECT'),
    ('approval_decision_requests', 'SELECT'), ('approval_decision_requests', 'INSERT'),
    ('merchant_canonical_workspaces', 'SELECT'), ('workspaces', 'SELECT')
  ) AS expected(table_name, privilege_type)
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
), checks AS (
  SELECT 'prerequisite.roles'::text AS check_name,
    CASE WHEN (SELECT service_role_oid IS NOT NULL AND anon_oid IS NOT NULL AND authenticated_oid IS NOT NULL FROM role_facts) THEN 'PASS' ELSE 'FAIL' END AS status,
    'Managed service_role, anon, and authenticated roles exist'::text AS details
  UNION ALL
  SELECT 'prerequisite.tables',
    CASE WHEN NOT EXISTS (SELECT 1 FROM table_facts WHERE oid IS NULL)
      AND to_regclass('auth.users') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'M024, M028, M029, workspace, and auth prerequisite tables exist'
  UNION ALL
  SELECT 'prerequisite.m026_m029_rpc_security',
    CASE WHEN (SELECT count(*) FROM function_security) = 4
      AND NOT EXISTS (
        SELECT 1 FROM function_security f
        WHERE f.oid IS NULL OR f.prosecdef
          OR NOT COALESCE(f.proconfig @> ARRAY['search_path=pg_catalog, public'], false)
          OR NOT f.public_execute_denied OR f.anon_execute OR f.authenticated_execute OR NOT f.service_execute
      )
      AND NOT EXISTS (
        SELECT 1 FROM function_security f
        WHERE f.label = 'approval'
          AND f.definition ~ 'LOCAL_APPROVAL_BRANCH|LOCAL_APPROVAL_EXCEPTION|deraledger\.local_approval_rehearsal_diagnostics|approval_rpc_internal_diagnostics|GET STACKED DIAGNOSTICS'
      )
    THEN 'PASS' ELSE 'FAIL' END,
    'M026/M027, M028 v1, and M029 reconcile exact RPCs are SECURITY INVOKER, hardened, and service-role-only'
  UNION ALL
  SELECT 'prerequisite.m028_v1_fail_closed',
    CASE WHEN EXISTS (SELECT 1 FROM function_security f WHERE f.label = 'issue_v1' AND f.definition ~ 'canonical_request_workspace_linkage_unavailable')
      AND EXISTS (SELECT 1 FROM function_security f WHERE f.label = 'snapshot_v1' AND f.definition ~ 'canonical_snapshot_workspace_linkage_unavailable')
    THEN 'PASS' ELSE 'FAIL' END,
    'M028 v1 issue and snapshot RPCs remain installed and explicitly fail closed'
  UNION ALL
  SELECT 'prerequisite.m028_m029_rls_browser_security',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM table_security table_state
      WHERE table_state.table_name IN ('merchant_compliance_profiles', 'merchant_compliance_reviews', 'merchant_compliance_events', 'approval_policy_versions', 'approval_decision_requests', 'merchant_canonical_workspaces')
        AND (
          NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = table_state.oid AND c.relrowsecurity AND NOT c.relforcerowsecurity)
          OR table_state.public_privilege_exists OR table_state.anon_privilege_exists OR table_state.authenticated_privilege_exists
          OR EXISTS (SELECT 1 FROM pg_policy policy_state WHERE policy_state.polrelid = table_state.oid)
        )
    ) THEN 'PASS' ELSE 'FAIL' END,
    'M028/M029/compliance authorities retain RLS enabled/not forced with no browser grants or policies'
  UNION ALL
  SELECT 'prerequisite.service_role_read_contract',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM service_read_contract expected
      JOIN table_facts table_fact USING (table_name)
      CROSS JOIN role_facts roles
      WHERE table_fact.oid IS NULL OR roles.service_role_oid IS NULL
        OR NOT has_table_privilege(roles.service_role_oid, table_fact.oid, expected.privilege_type)
    )
      AND (SELECT service_role_oid IS NOT NULL FROM role_facts)
      AND to_regclass('auth.users') IS NOT NULL
      AND has_table_privilege((SELECT service_role_oid FROM role_facts), to_regclass('auth.users'), 'SELECT')
    THEN 'PASS' ELSE 'FAIL' END,
    'SECURITY INVOKER v2 prerequisite reads and M028 request insert are granted to service_role'
  UNION ALL
  SELECT 'prerequisite.m028_m029_constraints',
    CASE WHEN EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('public.approval_decision_requests') AND c.conname = 'approval_decision_requests_fingerprint_unique' AND c.contype = 'u'::"char" AND c.convalidated)
      AND EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('public.merchant_canonical_workspaces') AND c.conname = 'merchant_canonical_workspaces_pkey' AND c.contype = 'p'::"char" AND c.convalidated)
      AND EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('public.merchant_canonical_workspaces') AND c.conname = 'merchant_canonical_workspaces_workspace_owner_fkey' AND c.contype = 'f'::"char" AND c.convalidated)
      AND to_regclass('public.merchant_canonical_workspace_supporting_owner_key') IS NOT NULL
    THEN 'PASS' ELSE 'FAIL' END,
    'M028 request fingerprint and M029 canonical composite ownership proof are intact'
  UNION ALL
  SELECT 'migration_030.v2_objects_absent',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('issue_canonical_approval_decision_request_v2', 'read_canonical_approval_snapshot_v2')
    ) THEN 'PASS' ELSE 'FAIL' END,
    'No conflicting M030 v2 RPC overload exists before apply'
), rendered AS (
  SELECT check_name, 'schema/security'::text AS object_type, status, details FROM checks
), summary AS (
  SELECT CASE WHEN bool_and(status = 'PASS') THEN 'PASS' ELSE 'FAIL' END AS status FROM rendered
), output_rows AS (
  SELECT check_name, object_type, status, details FROM rendered
  UNION ALL
  SELECT 'summary', 'summary', status, 'Stop on FAIL; do not apply after a failed preflight' FROM summary
)
SELECT check_name, object_type, status, details
FROM output_rows
ORDER BY CASE WHEN check_name = 'summary' THEN 1 ELSE 0 END, check_name;
