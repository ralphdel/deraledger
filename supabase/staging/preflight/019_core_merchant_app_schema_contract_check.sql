-- READ ONLY. Paste directly into Supabase SQL Editor before migration 019.
-- Missing additive repair columns/indexes are WARN; missing foundational objects
-- or incompatible existing types are FAIL.

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

WITH
table_contract(table_name) AS (
  VALUES ('merchants'), ('workspaces'), ('merchant_team'), ('roles'), ('clients'),
         ('invoices'), ('line_items'), ('references'), ('item_catalog'), ('discount_templates')
),
column_contract(table_name, specification) AS (
  VALUES
    ('merchants', 'id=uuid|user_id=uuid|workspace_id=uuid|business_name=text|email=text|phone=text|logo_url=text|fee_absorption_default=text|verification_status=text|merchant_tier=text|subscription_plan=text|monthly_collection_limit=numeric(12,2)|onboarding_status=text|setup_mode=boolean|live_features_enabled=boolean|is_super_admin=boolean|created_at=timestamp with time zone|updated_at=timestamp with time zone'),
    ('workspaces', 'id=uuid|owner_user_id=uuid|merchant_id=uuid|workspace_type=text|display_name=text|plan_type=text|onboarding_status=text|setup_mode=boolean|live_features_enabled=boolean|created_at=timestamp with time zone|updated_at=timestamp with time zone'),
    ('merchant_team', 'id=uuid|merchant_id=uuid|user_id=uuid|role_id=uuid|is_active=boolean|must_change_password=boolean|invited_by=uuid|added_at=timestamp with time zone|last_active_at=timestamp with time zone'),
    ('roles', 'id=uuid|merchant_id=uuid|name=text|permissions=jsonb|is_system_role=boolean|created_at=timestamp with time zone'),
    ('clients', 'id=uuid|merchant_id=uuid|full_name=text|email=text|phone=text|company_name=text|address=text|whatsapp_number=text|reminder_enabled=boolean|reminder_channels=text[]|is_deleted=boolean|deleted_at=timestamp with time zone|created_at=timestamp with time zone'),
    ('invoices', 'id=uuid|merchant_id=uuid|client_id=uuid|reference_id=uuid|handled_by=uuid|invoice_number=text|invoice_type=text|invoice_stage=text|status=text|subtotal=numeric(12,2)|discount_pct=numeric(5,2)|discount_value=numeric(12,2)|tax_pct=numeric(5,2)|tax_value=numeric(12,2)|grand_total=numeric(12,2)|amount_paid=numeric(12,2)|outstanding_balance=numeric(12,2)|fee_absorption=text|pay_by_date=date|short_link=text|qr_code_url=text|notes=text|payment_notes=text|manual_close_reason=text|send_reminders=boolean|allow_partial_payment=boolean|partial_payment_pct=numeric|is_archived=boolean|archived_at=timestamp with time zone|payment_provider=text|invoice_hash=text|payment_url=text|created_at=timestamp with time zone|updated_at=timestamp with time zone'),
    ('line_items', 'id=uuid|invoice_id=uuid|item_name=text|quantity=numeric(10,3)|unit_rate=numeric(12,2)|line_total=numeric(12,2)|sort_order=integer'),
    ('references', 'id=uuid|merchant_id=uuid|name=text|description=text|handled_by=uuid|project_total_value=numeric|created_at=timestamp with time zone|updated_at=timestamp with time zone'),
    ('item_catalog', 'id=uuid|merchant_id=uuid|item_name=text|default_rate=numeric(12,2)|description=text|is_active=boolean|usage_count=integer|created_at=timestamp with time zone|updated_at=timestamp with time zone'),
    ('discount_templates', 'id=uuid|merchant_id=uuid|name=text|percentage=numeric(5,2)|is_active=boolean|created_at=timestamp with time zone')
),
expected_columns AS (
  SELECT
    table_name,
    split_part(entry, '=', 1) AS column_name,
    split_part(entry, '=', 2) AS expected_type
  FROM column_contract
  CROSS JOIN LATERAL regexp_split_to_table(specification, '\|') AS entry
),
repairable_columns(table_name, column_name) AS (
  VALUES
    ('clients', 'deleted_at'),
    ('invoices', 'invoice_type'), ('invoices', 'payment_notes'),
    ('invoices', 'send_reminders'), ('invoices', 'allow_partial_payment'),
    ('invoices', 'partial_payment_pct'), ('invoices', 'is_archived'),
    ('invoices', 'archived_at'), ('invoices', 'payment_provider'),
    ('invoices', 'invoice_hash'), ('invoices', 'payment_url'),
    ('merchant_team', 'must_change_password'), ('roles', 'merchant_id')
),
expected_indexes(index_name, table_name) AS (
  VALUES
    ('idx_clients_is_deleted', 'clients'),
    ('idx_invoices_is_archived', 'invoices'),
    ('idx_invoices_invoice_hash', 'invoices'),
    ('idx_roles_merchant', 'roles'),
    ('idx_item_catalog_merchant', 'item_catalog'),
    ('idx_references_merchant', 'references'),
    ('idx_invoices_reference', 'invoices'),
    ('idx_invoices_handled_by', 'invoices')
),
table_checks AS (
  SELECT
    'table.public.' || contract.table_name AS check_name,
    'table'::text AS object_type,
    'ordinary table'::text AS expected,
    COALESCE('relkind=' || relation.relkind::text, 'missing') AS actual,
    CASE WHEN relation.oid IS NOT NULL AND relation.relkind = 'r' THEN 'PASS' ELSE 'FAIL' END AS status,
    'Required by the plan-neutral core merchant contract.'::text AS details
  FROM table_contract contract
  LEFT JOIN pg_class relation ON relation.oid = to_regclass(format('public.%I', contract.table_name))
),
column_checks AS (
  SELECT
    'column.public.' || expected.table_name || '.' || expected.column_name AS check_name,
    'column'::text AS object_type,
    expected.expected_type AS expected,
    COALESCE(format_type(attribute.atttypid, attribute.atttypmod), 'missing') AS actual,
    CASE
      WHEN attribute.attname IS NULL AND repairable.column_name IS NOT NULL THEN 'WARN'
      WHEN attribute.attname IS NULL THEN 'FAIL'
      WHEN format_type(attribute.atttypid, attribute.atttypmod) = expected.expected_type THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    CASE
      WHEN attribute.attname IS NULL AND repairable.column_name IS NOT NULL THEN 'Migration 019 can add this column.'
      WHEN attribute.attname IS NULL THEN 'Foundational column is absent; stop and inspect migration history.'
      WHEN format_type(attribute.atttypid, attribute.atttypmod) <> expected.expected_type THEN 'Existing type is incompatible; migration 019 will fail closed.'
      ELSE 'Column matches the application contract.'
    END AS details
  FROM expected_columns expected
  LEFT JOIN pg_class relation ON relation.oid = to_regclass(format('public.%I', expected.table_name))
  LEFT JOIN pg_attribute attribute
    ON attribute.attrelid = relation.oid
   AND attribute.attname = expected.column_name
   AND attribute.attnum > 0
   AND NOT attribute.attisdropped
  LEFT JOIN repairable_columns repairable
    ON repairable.table_name = expected.table_name
   AND repairable.column_name = expected.column_name
),
index_checks AS (
  SELECT
    'index.public.' || expected.index_name AS check_name,
    'index'::text AS object_type,
    'index on public.' || expected.table_name AS expected,
    COALESCE(index_row.indexdef, 'missing') AS actual,
    CASE
      WHEN index_row.indexname IS NULL THEN 'WARN'
      WHEN index_row.tablename = expected.table_name THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    CASE WHEN index_row.indexname IS NULL THEN 'An idempotent migration creates this index.' ELSE 'Index is present.' END AS details
  FROM expected_indexes expected
  LEFT JOIN pg_indexes index_row
    ON index_row.schemaname = 'public'
   AND index_row.indexname = expected.index_name
),
security_checks AS (
  SELECT
    'rls.public.' || contract.table_name AS check_name,
    'rls/policy'::text AS object_type,
    CASE
      WHEN contract.table_name = 'workspaces'
      THEN 'RLS enabled; exactly authenticated_read_merchant_workspaces SELECT policy'
      ELSE 'RLS enabled with at least one policy'
    END::text AS expected,
    format(
      'rls=%s policies=%s canonical_workspace_policies=%s',
      COALESCE(relation.relrowsecurity, false),
      count(policy.policyname),
      count(*) FILTER (
        WHERE policy.policyname = 'authenticated_read_merchant_workspaces'
          AND policy.permissive = 'PERMISSIVE'
          AND policy.cmd = 'SELECT'
          AND policy.roles::text[] = ARRAY['authenticated']::text[]
          AND replace(policy.qual, 'public.can_read_merchant_row_v1', 'can_read_merchant_row_v1')
            IN (
              'can_read_merchant_row_v1(merchant_id)',
              '(can_read_merchant_row_v1(merchant_id))'
            )
          AND policy.with_check IS NULL
      )
    ) AS actual,
    CASE
      WHEN NOT COALESCE(relation.relrowsecurity, false) THEN 'FAIL'
      WHEN contract.table_name = 'workspaces' AND count(policy.policyname) = 0 THEN 'WARN'
      WHEN contract.table_name = 'workspaces'
       AND count(policy.policyname) = 1
       AND count(*) FILTER (
         WHERE policy.policyname = 'authenticated_read_merchant_workspaces'
           AND policy.permissive = 'PERMISSIVE'
           AND policy.cmd = 'SELECT'
           AND policy.roles::text[] = ARRAY['authenticated']::text[]
           AND replace(policy.qual, 'public.can_read_merchant_row_v1', 'can_read_merchant_row_v1')
             IN (
               'can_read_merchant_row_v1(merchant_id)',
               '(can_read_merchant_row_v1(merchant_id))'
             )
           AND policy.with_check IS NULL
       ) = 1
      THEN 'PASS'
      WHEN contract.table_name = 'workspaces' THEN 'FAIL'
      WHEN count(policy.policyname) > 0 THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    CASE
      WHEN contract.table_name = 'workspaces' AND count(policy.policyname) = 0
      THEN 'Repairable: migration 019 creates the missing owner/team-scoped authenticated SELECT policy.'
      WHEN contract.table_name = 'workspaces'
      THEN 'Unexpected or incompatible workspace policies are not replaced and remain blocking.'
      ELSE 'Migration 019 preserves the existing authorization policy set.'
    END::text AS details
  FROM table_contract contract
  LEFT JOIN pg_class relation ON relation.oid = to_regclass(format('public.%I', contract.table_name))
  LEFT JOIN pg_policies policy
    ON policy.schemaname = 'public'
   AND policy.tablename = contract.table_name
  GROUP BY contract.table_name, relation.relrowsecurity
),
workspace_policy_prerequisite_check AS (
  SELECT
    'policy_prerequisite.public.workspaces' AS check_name,
    'function/role' AS object_type,
    'can_read_merchant_row_v1(uuid) and authenticated role exist' AS expected,
    format(
      'helper=%s authenticated_role=%s',
      to_regprocedure('public.can_read_merchant_row_v1(uuid)') IS NOT NULL,
      EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
    ) AS actual,
    CASE
      WHEN to_regprocedure('public.can_read_merchant_row_v1(uuid)') IS NOT NULL
       AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
      THEN 'PASS' ELSE 'FAIL'
    END AS status,
    'The workspace policy is repairable only with the existing hardened helper and Supabase authenticated role.' AS details
),
grant_checks AS (
  SELECT
    'grant.public.' || contract.table_name AS check_name,
    'grant'::text AS object_type,
    'service_role SELECT,INSERT,UPDATE,DELETE'::text AS expected,
    CASE
      WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN 'service_role missing'
      ELSE format(
        'select=%s insert=%s update=%s delete=%s',
        has_table_privilege('service_role', format('public.%I', contract.table_name), 'SELECT'),
        has_table_privilege('service_role', format('public.%I', contract.table_name), 'INSERT'),
        has_table_privilege('service_role', format('public.%I', contract.table_name), 'UPDATE'),
        has_table_privilege('service_role', format('public.%I', contract.table_name), 'DELETE')
      )
    END AS actual,
    CASE
      WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
       AND has_table_privilege('service_role', format('public.%I', contract.table_name), 'SELECT,INSERT,UPDATE,DELETE')
      THEN 'PASS' ELSE 'FAIL'
    END AS status,
    'Server actions use service-role writes; no browser write grant is added.'::text AS details
  FROM table_contract contract
)
SELECT check_name, object_type, expected, actual, status, details FROM table_checks
UNION ALL
SELECT check_name, object_type, expected, actual, status, details FROM column_checks
UNION ALL
SELECT check_name, object_type, expected, actual, status, details FROM index_checks
UNION ALL
SELECT check_name, object_type, expected, actual, status, details FROM security_checks
UNION ALL
SELECT check_name, object_type, expected, actual, status, details FROM workspace_policy_prerequisite_check
UNION ALL
SELECT check_name, object_type, expected, actual, status, details FROM grant_checks
UNION ALL
SELECT
  'preservation.row_counts' AS check_name,
  'data preservation' AS object_type,
  'Capture and compare exactly with postflight' AS expected,
  jsonb_build_object(
    'merchants', (SELECT count(*) FROM public.merchants),
    'workspaces', (SELECT count(*) FROM public.workspaces),
    'merchant_team', (SELECT count(*) FROM public.merchant_team),
    'roles', (SELECT count(*) FROM public.roles),
    'clients', (SELECT count(*) FROM public.clients),
    'invoices', (SELECT count(*) FROM public.invoices),
    'line_items', (SELECT count(*) FROM public.line_items),
    'references', (SELECT count(*) FROM public."references"),
    'item_catalog', (SELECT count(*) FROM public.item_catalog),
    'discount_templates', (SELECT count(*) FROM public.discount_templates)
  )::text AS actual,
  'PASS' AS status,
  'Migration 019 contains no INSERT, UPDATE, DELETE, TRUNCATE, or DROP.' AS details
ORDER BY object_type, check_name;

ROLLBACK;
