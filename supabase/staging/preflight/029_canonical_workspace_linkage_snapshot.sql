WITH required_relations AS (
  SELECT * FROM (VALUES ('merchants'::text), ('workspaces'::text), ('approval_policy_versions'::text), ('approval_decision_requests'::text)) AS required(table_name)
), required_columns AS (
  SELECT * FROM (VALUES
    ('merchants'::text, 'id'::text),
    ('workspaces'::text, 'id'::text), ('workspaces'::text, 'merchant_id'::text)
  ) AS required(table_name, column_name)
), workspace_facts AS (
  SELECT
    to_regclass('public.workspaces') workspace_oid,
    to_regclass('public.merchants') merchant_oid,
    (SELECT attnum FROM pg_attribute WHERE attrelid=to_regclass('public.workspaces') AND attname='id' AND attnum>0 AND NOT attisdropped) workspace_id_attnum,
    (SELECT attnum FROM pg_attribute WHERE attrelid=to_regclass('public.workspaces') AND attname='merchant_id' AND attnum>0 AND NOT attisdropped) workspace_merchant_attnum,
    (SELECT attnum FROM pg_attribute WHERE attrelid=to_regclass('public.merchants') AND attname='id' AND attnum>0 AND NOT attisdropped) merchant_id_attnum
), supporting_index_facts AS (
  SELECT to_regclass('public.merchant_canonical_workspace_supporting_owner_key') supporting_index_oid
), function_facts AS (
  SELECT
    to_regprocedure('public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)') approval_oid,
    to_regprocedure('public.issue_canonical_approval_decision_request_v1(uuid,uuid,text,text,text)') issue_oid,
    to_regprocedure('public.read_canonical_approval_snapshot_v1(uuid)') snapshot_oid
), checks AS (
  SELECT 'prerequisite.roles'::text check_name,
    CASE WHEN to_regrole('service_role') IS NOT NULL AND to_regrole('anon') IS NOT NULL AND to_regrole('authenticated') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END status,
    'Managed service/browser roles exist'::text details
  UNION ALL
  SELECT 'prerequisite.relations',
    CASE WHEN NOT EXISTS (SELECT 1 FROM required_relations r WHERE to_regclass(format('public.%I', r.table_name)) IS NULL)
      AND to_regclass('auth.users') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'Required M028, workspace, and auth relations exist'
  UNION ALL
  SELECT 'prerequisite.workspace_columns',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM required_columns r
      WHERE to_regclass(format('public.%I', r.table_name)) IS NULL
        OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass(format('public.%I', r.table_name)) AND a.attname=r.column_name AND a.attnum>0 AND NOT a.attisdropped AND format_type(a.atttypid,a.atttypmod)='uuid')
    ) THEN 'PASS' ELSE 'FAIL' END,
    'Merchant/workspace identity columns are uuid'
  UNION ALL
  SELECT 'prerequisite.workspace_contract',
    CASE WHEN EXISTS (SELECT 1 FROM workspace_facts f WHERE f.workspace_oid IS NOT NULL AND f.merchant_oid IS NOT NULL)
      AND (SELECT count(*) FROM pg_constraint c CROSS JOIN workspace_facts f WHERE c.conrelid=f.workspace_oid AND c.contype='p'::"char" AND c.conkey=ARRAY[f.workspace_id_attnum]::smallint[] AND c.convalidated)=1
      AND (SELECT count(*) FROM pg_constraint c CROSS JOIN workspace_facts f WHERE c.conrelid=f.workspace_oid AND c.contype='f'::"char" AND c.conkey=ARRAY[f.workspace_merchant_attnum]::smallint[] AND c.confrelid=f.merchant_oid AND c.confkey=ARRAY[f.merchant_id_attnum]::smallint[] AND c.confdeltype='c'::"char" AND c.convalidated)=1
      AND (SELECT count(*) FROM pg_constraint c CROSS JOIN workspace_facts f WHERE c.conrelid=f.workspace_oid AND c.contype='f'::"char" AND c.conkey=ARRAY[f.workspace_merchant_attnum]::smallint[])=1
      AND (SELECT count(*) FROM pg_constraint c CROSS JOIN workspace_facts f WHERE c.conrelid=f.workspace_oid AND c.contype='u'::"char" AND c.conkey=ARRAY[f.workspace_merchant_attnum]::smallint[] AND c.convalidated)=1
    THEN 'PASS' ELSE 'FAIL' END,
    'Workspace primary key, merchant FK cascade, and count-one merchant uniqueness are exact'
  UNION ALL
  SELECT 'migration_026_028.rpc_security',
    CASE WHEN EXISTS (
      SELECT 1
      FROM function_facts f
      WHERE f.approval_oid IS NOT NULL AND f.issue_oid IS NOT NULL AND f.snapshot_oid IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid IN (f.approval_oid,f.issue_oid,f.snapshot_oid) AND (p.prosecdef OR NOT (p.proconfig @> ARRAY['search_path=pg_catalog, public'])))
        AND NOT has_function_privilege('PUBLIC',f.approval_oid,'EXECUTE')
        AND NOT has_function_privilege('anon',f.approval_oid,'EXECUTE')
        AND NOT has_function_privilege('authenticated',f.approval_oid,'EXECUTE')
        AND has_function_privilege('service_role',f.approval_oid,'EXECUTE')
        AND NOT has_function_privilege('PUBLIC',f.issue_oid,'EXECUTE')
        AND NOT has_function_privilege('anon',f.issue_oid,'EXECUTE')
        AND NOT has_function_privilege('authenticated',f.issue_oid,'EXECUTE')
        AND has_function_privilege('service_role',f.issue_oid,'EXECUTE')
        AND NOT has_function_privilege('PUBLIC',f.snapshot_oid,'EXECUTE')
        AND NOT has_function_privilege('anon',f.snapshot_oid,'EXECUTE')
        AND NOT has_function_privilege('authenticated',f.snapshot_oid,'EXECUTE')
        AND has_function_privilege('service_role',f.snapshot_oid,'EXECUTE')
    )
    THEN 'PASS' ELSE 'FAIL' END,
    'M026-M028 exact RPCs are SECURITY INVOKER, hardened, and service-role-only'
  UNION ALL
  SELECT 'prerequisite.compliance_m028_security',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM pg_class c
      WHERE c.oid IN (to_regclass('public.merchant_compliance_profiles'),to_regclass('public.merchant_compliance_reviews'),to_regclass('public.merchant_compliance_events'),to_regclass('public.approval_policy_versions'),to_regclass('public.approval_decision_requests'))
        AND (NOT c.relrowsecurity OR c.relforcerowsecurity)
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.role_table_grants g
      WHERE g.table_schema='public' AND g.table_name IN ('merchant_compliance_profiles','merchant_compliance_reviews','merchant_compliance_events','approval_policy_versions','approval_decision_requests')
        AND g.grantee IN ('PUBLIC','anon','authenticated')
    ) THEN 'PASS' ELSE 'FAIL' END,
    'Compliance and M028 table posture remains browser-denied'
  UNION ALL
  SELECT 'migration_029.objects_absent',
    CASE WHEN to_regclass('public.merchant_canonical_workspaces') IS NULL
      AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='reconcile_canonical_merchant_workspace_link_v1')
    THEN 'PASS' ELSE 'FAIL' END,
    'No conflicting M029 table or reconcile RPC exists before apply'
  UNION ALL
  SELECT 'migration_029.supporting_index_name',
    CASE WHEN (SELECT supporting_index_oid IS NULL FROM supporting_index_facts)
      OR EXISTS (
        SELECT 1
        FROM pg_index i
        CROSS JOIN workspace_facts f
        CROSS JOIN supporting_index_facts s
        WHERE i.indexrelid=s.supporting_index_oid
          AND i.indrelid=f.workspace_oid
          AND i.indisunique
          AND i.indpred IS NULL
          AND i.indkey::smallint[]=ARRAY[f.workspace_id_attnum,f.workspace_merchant_attnum]::smallint[]
      ) THEN 'PASS' ELSE 'FAIL' END,
    'Existing supporting-index name is absent or has the exact unique workspace ownership definition'
), rendered AS (
  SELECT check_name, status, details FROM checks
), summary AS (
  SELECT CASE WHEN bool_and(status='PASS') THEN 'PASS' ELSE 'FAIL' END status FROM rendered
), output_rows AS (
  SELECT check_name, status, details FROM rendered
  UNION ALL
  SELECT 'summary', status, 'All preflight checks must pass' FROM summary
)
SELECT check_name, status, details
FROM output_rows
ORDER BY CASE WHEN check_name='summary' THEN 1 ELSE 0 END, check_name;
