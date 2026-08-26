WITH required_relations AS (
  SELECT * FROM (VALUES
    ('merchants'::text), ('workspaces'::text), ('merchant_compliance_profiles'::text),
    ('merchant_compliance_reviews'::text), ('merchant_compliance_events'::text),
    ('approval_policy_versions'::text), ('approval_decision_requests'::text)
  ) AS required(table_name)
), required_columns AS (
  SELECT * FROM (VALUES
    ('merchants'::text, 'id'::text),
    ('workspaces'::text, 'id'::text), ('workspaces'::text, 'merchant_id'::text)
  ) AS required(table_name, column_name)
), role_facts AS (
  SELECT to_regrole('service_role') AS service_role_oid,
    to_regrole('anon') AS anon_oid,
    to_regrole('authenticated') AS authenticated_oid
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
), function_security AS (
  SELECT f.*, r.*,
    NOT EXISTS (
      SELECT 1 FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) privilege_state
      WHERE p.oid IN (f.approval_oid, f.issue_oid, f.snapshot_oid)
        AND privilege_state.grantee=0 AND privilege_state.privilege_type='EXECUTE'
    ) AS public_execute_denied,
    NOT EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid IN (f.approval_oid, f.issue_oid, f.snapshot_oid)
        AND (p.prosecdef OR NOT COALESCE(p.proconfig @> ARRAY['search_path=pg_catalog, public'], false))
    ) AS hardened_invoker,
    CASE WHEN r.anon_oid IS NULL OR f.approval_oid IS NULL OR f.issue_oid IS NULL OR f.snapshot_oid IS NULL THEN false ELSE has_function_privilege(r.anon_oid, f.approval_oid, 'EXECUTE') OR has_function_privilege(r.anon_oid, f.issue_oid, 'EXECUTE') OR has_function_privilege(r.anon_oid, f.snapshot_oid, 'EXECUTE') END AS anon_execute_any,
    CASE WHEN r.authenticated_oid IS NULL OR f.approval_oid IS NULL OR f.issue_oid IS NULL OR f.snapshot_oid IS NULL THEN false ELSE has_function_privilege(r.authenticated_oid, f.approval_oid, 'EXECUTE') OR has_function_privilege(r.authenticated_oid, f.issue_oid, 'EXECUTE') OR has_function_privilege(r.authenticated_oid, f.snapshot_oid, 'EXECUTE') END AS authenticated_execute_any,
    CASE WHEN r.service_role_oid IS NULL OR f.approval_oid IS NULL OR f.issue_oid IS NULL OR f.snapshot_oid IS NULL THEN false ELSE has_function_privilege(r.service_role_oid, f.approval_oid, 'EXECUTE') AND has_function_privilege(r.service_role_oid, f.issue_oid, 'EXECUTE') AND has_function_privilege(r.service_role_oid, f.snapshot_oid, 'EXECUTE') END AS service_execute_all
  FROM function_facts f CROSS JOIN role_facts r
), protected_table_facts AS (
  SELECT unnest(ARRAY[
    to_regclass('public.merchant_compliance_profiles'),
    to_regclass('public.merchant_compliance_reviews'),
    to_regclass('public.merchant_compliance_events'),
    to_regclass('public.approval_policy_versions'),
    to_regclass('public.approval_decision_requests')
  ]) AS table_oid
), protected_table_security AS (
  SELECT t.table_oid, r.*,
    EXISTS (SELECT 1 FROM pg_class c WHERE c.oid=t.table_oid AND c.relrowsecurity AND NOT c.relforcerowsecurity) AS rls_safe,
    NOT EXISTS (
      SELECT 1 FROM pg_class c
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) privilege_state
      WHERE c.oid=t.table_oid AND privilege_state.grantee=0
    ) AS public_privileges_denied,
    CASE WHEN t.table_oid IS NULL OR r.anon_oid IS NULL THEN false ELSE has_table_privilege(r.anon_oid, t.table_oid, 'SELECT') OR has_table_privilege(r.anon_oid, t.table_oid, 'INSERT') OR has_table_privilege(r.anon_oid, t.table_oid, 'UPDATE') OR has_table_privilege(r.anon_oid, t.table_oid, 'DELETE') OR has_table_privilege(r.anon_oid, t.table_oid, 'TRUNCATE') OR has_table_privilege(r.anon_oid, t.table_oid, 'REFERENCES') OR has_table_privilege(r.anon_oid, t.table_oid, 'TRIGGER') END AS anon_privileges_any,
    CASE WHEN t.table_oid IS NULL OR r.authenticated_oid IS NULL THEN false ELSE has_table_privilege(r.authenticated_oid, t.table_oid, 'SELECT') OR has_table_privilege(r.authenticated_oid, t.table_oid, 'INSERT') OR has_table_privilege(r.authenticated_oid, t.table_oid, 'UPDATE') OR has_table_privilege(r.authenticated_oid, t.table_oid, 'DELETE') OR has_table_privilege(r.authenticated_oid, t.table_oid, 'TRUNCATE') OR has_table_privilege(r.authenticated_oid, t.table_oid, 'REFERENCES') OR has_table_privilege(r.authenticated_oid, t.table_oid, 'TRIGGER') END AS authenticated_privileges_any
  FROM protected_table_facts t CROSS JOIN role_facts r
), checks AS (
  SELECT 'prerequisite.service_role'::text check_name,
    CASE WHEN EXISTS (SELECT 1 FROM role_facts WHERE service_role_oid IS NOT NULL) THEN 'PASS' ELSE 'FAIL' END status,
    'service_role exists; absent browser roles are treated as no direct grant'::text details
  UNION ALL
  SELECT 'prerequisite.relations',
    CASE WHEN NOT EXISTS (SELECT 1 FROM required_relations r WHERE to_regclass(format('public.%I', r.table_name)) IS NULL)
      AND to_regclass('auth.users') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'Required M024-M028, workspace, and auth relations exist'
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
      SELECT 1 FROM function_security f
      WHERE f.approval_oid IS NOT NULL AND f.issue_oid IS NOT NULL AND f.snapshot_oid IS NOT NULL
        AND f.hardened_invoker AND f.public_execute_denied
        AND NOT f.anon_execute_any AND NOT f.authenticated_execute_any AND f.service_execute_all
    ) THEN 'PASS' ELSE 'FAIL' END,
    'M026-M028 exact RPCs are SECURITY INVOKER, hardened, and service-role-only'
  UNION ALL
  SELECT 'prerequisite.compliance_m028_security',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM protected_table_security t
      WHERE t.table_oid IS NULL OR NOT t.rls_safe OR NOT t.public_privileges_denied
        OR t.anon_privileges_any OR t.authenticated_privileges_any
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
    CASE WHEN (
        (SELECT supporting_index_oid IS NULL FROM supporting_index_facts)
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i CROSS JOIN workspace_facts f
          WHERE i.indrelid=f.workspace_oid AND i.indisunique AND i.indpred IS NULL
            AND i.indnkeyatts=2 AND i.indnatts=2
            AND ARRAY(
              SELECT index_key.attnum
              FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS index_key(attnum, ordinal_position)
              ORDER BY index_key.ordinal_position
            )=ARRAY[f.workspace_id_attnum,f.workspace_merchant_attnum]::smallint[]
        )
      ) OR EXISTS (
        SELECT 1 FROM pg_index i CROSS JOIN workspace_facts f CROSS JOIN supporting_index_facts s
        WHERE i.indexrelid=s.supporting_index_oid AND i.indrelid=f.workspace_oid
          AND i.indisunique AND i.indpred IS NULL AND i.indnkeyatts=2 AND i.indnatts=2
          AND ARRAY(
            SELECT index_key.attnum
            FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS index_key(attnum, ordinal_position)
            ORDER BY index_key.ordinal_position
          )=ARRAY[f.workspace_id_attnum,f.workspace_merchant_attnum]::smallint[]
          AND 1=(
            SELECT count(*) FROM pg_index exact_index
            WHERE exact_index.indrelid=f.workspace_oid AND exact_index.indisunique AND exact_index.indpred IS NULL
              AND exact_index.indnkeyatts=2 AND exact_index.indnatts=2
              AND ARRAY(
                SELECT index_key.attnum
                FROM unnest(exact_index.indkey::smallint[]) WITH ORDINALITY AS index_key(attnum, ordinal_position)
                ORDER BY index_key.ordinal_position
              )=ARRAY[f.workspace_id_attnum,f.workspace_merchant_attnum]::smallint[]
          )
      ) THEN 'PASS' ELSE 'FAIL' END,
    'Supporting-index state is absent before first apply or exactly M029-created on rerun'
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
