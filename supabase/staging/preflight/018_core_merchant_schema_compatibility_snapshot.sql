-- READ ONLY: core merchant schema compatibility preflight.
-- Missing additive objects are WARN/repairable. Incompatible existing objects
-- are FAIL and must not be repaired by running the migration.

\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset pager off

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

SELECT format(
  'PASS|database_identity|database=%s user=%s server_version_num=%s search_path=%s transaction_read_only=%s',
  current_database(),
  current_user,
  current_setting('server_version_num'),
  current_setting('search_path'),
  current_setting('transaction_read_only')
);

WITH expected(object_name, required_before_apply) AS (
  VALUES
    ('auth.users'::text, true),
    ('public.merchants', true),
    ('public.merchant_team', true),
    ('public.clients', true),
    ('public.invoices', true),
    ('public.line_items', false),
    ('public.references', false),
    ('public.item_catalog', false),
    ('public.discount_templates', false)
), state AS (
  SELECT
    expected.*,
    to_regclass(expected.object_name) AS relation_oid,
    relation.relkind::text AS relkind
  FROM expected
  LEFT JOIN pg_class relation ON relation.oid = to_regclass(expected.object_name)
)
SELECT format(
  '%s|relation_manifest|required_missing=%s repairable_missing=%s incompatible_relkind=%s',
  CASE
    WHEN count(*) FILTER (WHERE required_before_apply AND relation_oid IS NULL) > 0
      OR count(*) FILTER (WHERE relation_oid IS NOT NULL AND relkind <> 'r') > 0
    THEN 'FAIL'
    WHEN count(*) FILTER (WHERE NOT required_before_apply AND relation_oid IS NULL) > 0
    THEN 'WARN'
    ELSE 'PASS'
  END,
  count(*) FILTER (WHERE required_before_apply AND relation_oid IS NULL),
  count(*) FILTER (WHERE NOT required_before_apply AND relation_oid IS NULL),
  count(*) FILTER (WHERE relation_oid IS NOT NULL AND relkind <> 'r')
)
FROM state;

WITH prerequisite_state AS (
  SELECT
    to_regprocedure('public.can_read_merchant_row_v1(uuid)') IS NOT NULL AS merchant_read_helper,
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AS anon_role,
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AS authenticated_role,
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') AS service_role
)
SELECT format(
  '%s|security_prerequisites|merchant_read_helper=%s anon_role=%s authenticated_role=%s service_role=%s',
  CASE WHEN merchant_read_helper AND anon_role AND authenticated_role AND service_role THEN 'PASS' ELSE 'FAIL' END,
  merchant_read_helper,
  anon_role,
  authenticated_role,
  service_role
)
FROM prerequisite_state;

WITH expected_columns(
  table_name,
  column_name,
  formatted_type,
  not_null,
  missing_is_repairable
) AS (
  VALUES
    ('clients'::text, 'address'::text, 'text'::text, false, true),
    ('clients', 'whatsapp_number', 'text', false, true),
    ('clients', 'reminder_enabled', 'boolean', true, true),
    ('clients', 'reminder_channels', 'text[]', true, true),
    ('invoices', 'reference_id', 'uuid', false, true),
    ('invoices', 'handled_by', 'uuid', false, true),
    ('invoices', 'invoice_stage', 'text', false, true),
    ('references', 'id', 'uuid', true, false),
    ('references', 'merchant_id', 'uuid', true, false),
    ('references', 'name', 'text', true, false),
    ('references', 'description', 'text', false, false),
    ('references', 'handled_by', 'uuid', false, false),
    ('references', 'created_at', 'timestamp with time zone', true, false),
    ('references', 'updated_at', 'timestamp with time zone', true, false),
    ('references', 'project_total_value', 'numeric', false, true),
    ('item_catalog', 'id', 'uuid', true, false),
    ('item_catalog', 'merchant_id', 'uuid', true, false),
    ('item_catalog', 'item_name', 'text', true, false),
    ('item_catalog', 'default_rate', 'numeric(12,2)', true, false),
    ('item_catalog', 'description', 'text', false, false),
    ('item_catalog', 'is_active', 'boolean', true, false),
    ('item_catalog', 'usage_count', 'integer', true, false),
    ('item_catalog', 'created_at', 'timestamp with time zone', true, false),
    ('item_catalog', 'updated_at', 'timestamp with time zone', true, false),
    ('discount_templates', 'id', 'uuid', true, false),
    ('discount_templates', 'merchant_id', 'uuid', true, false),
    ('discount_templates', 'name', 'text', true, false),
    ('discount_templates', 'percentage', 'numeric(5,2)', true, false),
    ('discount_templates', 'is_active', 'boolean', true, false),
    ('discount_templates', 'created_at', 'timestamp with time zone', true, false),
    ('line_items', 'id', 'uuid', true, false),
    ('line_items', 'invoice_id', 'uuid', true, false),
    ('line_items', 'item_name', 'text', true, false),
    ('line_items', 'quantity', 'numeric(10,3)', true, false),
    ('line_items', 'unit_rate', 'numeric(12,2)', true, false),
    ('line_items', 'line_total', 'numeric(12,2)', true, false),
    ('line_items', 'sort_order', 'integer', true, false)
), actual_columns AS (
  SELECT
    expected_columns.*,
    table_relation.oid AS table_oid,
    attribute.attname AS actual_column,
    format_type(attribute.atttypid, attribute.atttypmod) AS actual_type,
    attribute.attnotnull AS actual_not_null
  FROM expected_columns
  LEFT JOIN pg_class table_relation
    ON table_relation.oid = to_regclass(format('public.%I', expected_columns.table_name))
  LEFT JOIN pg_attribute attribute
    ON attribute.attrelid = table_relation.oid
   AND attribute.attname = expected_columns.column_name
   AND attribute.attnum > 0
   AND NOT attribute.attisdropped
), classified AS (
  SELECT *,
    CASE
      WHEN table_oid IS NULL THEN 'REPAIRABLE_MISSING_TABLE'
      WHEN actual_column IS NULL AND missing_is_repairable THEN 'REPAIRABLE_MISSING_COLUMN'
      WHEN actual_column IS NULL THEN 'UNSAFE_MISSING_COLUMN'
      WHEN actual_type <> formatted_type OR actual_not_null <> not_null THEN 'UNSAFE_INCOMPATIBLE_COLUMN'
      ELSE 'CANONICAL'
    END AS classification
  FROM actual_columns
)
SELECT format(
  '%s|column_manifest|canonical=%s repairable_missing=%s unsafe_missing=%s unsafe_incompatible=%s',
  CASE
    WHEN count(*) FILTER (WHERE classification LIKE 'UNSAFE_%') > 0 THEN 'FAIL'
    WHEN count(*) FILTER (WHERE classification LIKE 'REPAIRABLE_%') > 0 THEN 'WARN'
    ELSE 'PASS'
  END,
  count(*) FILTER (WHERE classification = 'CANONICAL'),
  count(*) FILTER (WHERE classification LIKE 'REPAIRABLE_%'),
  count(*) FILTER (WHERE classification = 'UNSAFE_MISSING_COLUMN'),
  count(*) FILTER (WHERE classification = 'UNSAFE_INCOMPATIBLE_COLUMN')
)
FROM classified;

WITH expected_constraints(table_name, column_name, constraint_name, constraint_type) AS (
  VALUES
    ('references'::text, NULL::text, 'references_pkey'::text, 'p'::text),
    ('references', NULL, 'references_merchant_id_fkey', 'f'),
    ('references', NULL, 'references_handled_by_fkey', 'f'),
    ('references', NULL, 'references_merchant_id_name_key', 'u'),
    ('item_catalog', NULL, 'item_catalog_pkey', 'p'),
    ('item_catalog', NULL, 'item_catalog_merchant_id_fkey', 'f'),
    ('item_catalog', NULL, 'item_name_len', 'c'),
    ('item_catalog', NULL, 'item_catalog_default_rate_check', 'c'),
    ('discount_templates', NULL, 'discount_templates_pkey', 'p'),
    ('discount_templates', NULL, 'discount_templates_merchant_id_fkey', 'f'),
    ('discount_templates', NULL, 'discount_name_len', 'c'),
    ('discount_templates', NULL, 'discount_templates_percentage_check', 'c'),
    ('line_items', NULL, 'line_items_pkey', 'p'),
    ('line_items', NULL, 'line_items_invoice_id_fkey', 'f'),
    ('invoices', 'reference_id', 'invoices_reference_id_fkey', 'f'),
    ('invoices', 'handled_by', 'invoices_handled_by_fkey', 'f'),
    ('invoices', 'invoice_stage', 'invoices_invoice_stage_check', 'c')
), state AS (
  SELECT
    expected_constraints.*,
    relation.oid AS table_oid,
    attribute.attname AS actual_column,
    constraint_row.oid AS constraint_oid,
    constraint_row.contype::text AS actual_type,
    constraint_row.convalidated
  FROM expected_constraints
  LEFT JOIN pg_class relation
    ON relation.oid = to_regclass(format('public.%I', expected_constraints.table_name))
  LEFT JOIN pg_attribute attribute
    ON attribute.attrelid = relation.oid
   AND attribute.attname = expected_constraints.column_name
   AND attribute.attnum > 0
   AND NOT attribute.attisdropped
  LEFT JOIN pg_constraint constraint_row
    ON constraint_row.conrelid = relation.oid
   AND constraint_row.conname = expected_constraints.constraint_name
), classified AS (
  SELECT *,
    CASE
      WHEN table_oid IS NULL THEN 'REPAIRABLE_MISSING_TABLE'
      WHEN column_name IS NOT NULL AND actual_column IS NULL THEN 'REPAIRABLE_MISSING_COLUMN'
      WHEN constraint_oid IS NULL THEN 'UNSAFE_MISSING_CONSTRAINT'
      WHEN actual_type <> constraint_type OR NOT convalidated THEN 'UNSAFE_INCOMPATIBLE_CONSTRAINT'
      ELSE 'CANONICAL'
    END AS classification
  FROM state
)
SELECT format(
  '%s|constraint_manifest|canonical=%s repairable_missing=%s unsafe_missing=%s unsafe_incompatible=%s',
  CASE
    WHEN count(*) FILTER (WHERE classification LIKE 'UNSAFE_%') > 0 THEN 'FAIL'
    WHEN count(*) FILTER (WHERE classification LIKE 'REPAIRABLE_%') > 0 THEN 'WARN'
    ELSE 'PASS'
  END,
  count(*) FILTER (WHERE classification = 'CANONICAL'),
  count(*) FILTER (WHERE classification LIKE 'REPAIRABLE_%'),
  count(*) FILTER (WHERE classification = 'UNSAFE_MISSING_CONSTRAINT'),
  count(*) FILTER (WHERE classification = 'UNSAFE_INCOMPATIBLE_CONSTRAINT')
)
FROM classified;

WITH expected_indexes(index_name, table_name) AS (
  VALUES
    ('idx_item_catalog_merchant'::text, 'item_catalog'::text),
    ('idx_references_merchant', 'references'),
    ('idx_invoices_reference', 'invoices'),
    ('idx_invoices_handled_by', 'invoices')
), state AS (
  SELECT
    expected_indexes.*,
    index_row.indexname,
    index_row.tablename AS actual_table
  FROM expected_indexes
  LEFT JOIN pg_indexes index_row
    ON index_row.schemaname = 'public'
   AND index_row.indexname = expected_indexes.index_name
)
SELECT format(
  '%s|index_manifest|missing_repairable=%s wrong_table=%s',
  CASE
    WHEN count(*) FILTER (WHERE indexname IS NOT NULL AND actual_table <> table_name) > 0 THEN 'FAIL'
    WHEN count(*) FILTER (WHERE indexname IS NULL) > 0 THEN 'WARN'
    ELSE 'PASS'
  END,
  count(*) FILTER (WHERE indexname IS NULL),
  count(*) FILTER (WHERE indexname IS NOT NULL AND actual_table <> table_name)
)
FROM state;

WITH target_tables(table_name) AS (
  VALUES
    ('clients'::text),
    ('invoices'),
    ('line_items'),
    ('references'),
    ('item_catalog'),
    ('discount_templates')
), existing_targets AS (
  SELECT target_tables.table_name, relation.oid, relation.relrowsecurity
  FROM target_tables
  JOIN pg_class relation
    ON relation.oid = to_regclass(format('public.%I', target_tables.table_name))
), security_state AS (
  SELECT
    count(*) FILTER (WHERE NOT relrowsecurity) AS rls_disabled,
    (
      SELECT count(*)
      FROM pg_policies policy_row
      JOIN existing_targets target ON target.table_name = policy_row.tablename
      WHERE policy_row.schemaname = 'public'
        AND policy_row.roles && ARRAY['public', 'anon', 'authenticated']::name[]
        AND (
          policy_row.cmd <> 'SELECT'
          OR policy_row.roles <> ARRAY['authenticated']::name[]
          OR policy_row.policyname NOT IN (
            'authenticated_read_merchant_clients',
            'authenticated_read_merchant_invoices',
            'authenticated_read_merchant_line_items',
            'authenticated_read_merchant_references',
            'authenticated_read_merchant_item_catalog',
            'authenticated_read_merchant_discount_templates'
          )
        )
    ) AS browser_policy_count,
    (
      SELECT count(*)
      FROM information_schema.table_privileges grant_row
      JOIN existing_targets target ON target.table_name = grant_row.table_name
      WHERE grant_row.table_schema = 'public'
        AND grant_row.grantee IN ('PUBLIC', 'anon', 'authenticated')
        AND grant_row.privilege_type <> 'SELECT'
    ) AS browser_write_grant_count,
    (
      SELECT count(*)
      FROM information_schema.table_privileges grant_row
      JOIN existing_targets target ON target.table_name = grant_row.table_name
      WHERE grant_row.table_schema = 'public'
        AND grant_row.grantee IN ('PUBLIC', 'anon')
    ) AS anonymous_grant_count
  FROM existing_targets
)
SELECT format(
  '%s|security_drift|rls_disabled=%s browser_policies_to_replace=%s anonymous_grants_to_revoke=%s browser_write_grants_to_revoke=%s',
  CASE
    WHEN rls_disabled > 0
      OR browser_policy_count > 0
      OR anonymous_grant_count > 0
      OR browser_write_grant_count > 0
    THEN 'WARN'
    ELSE 'PASS'
  END,
  rls_disabled,
  browser_policy_count,
  anonymous_grant_count,
  browser_write_grant_count
)
FROM security_state;

SELECT format(
  'PASS|preservation_baseline|clients=%s invoices=%s (compare these counts with postflight)',
  (SELECT count(*) FROM public.clients),
  (SELECT count(*) FROM public.invoices)
);

WITH expected_columns(table_name, column_name, formatted_type, not_null, missing_is_repairable) AS (
  VALUES
    ('clients'::text, 'address'::text, 'text'::text, false, true),
    ('clients', 'whatsapp_number', 'text', false, true),
    ('clients', 'reminder_enabled', 'boolean', true, true),
    ('clients', 'reminder_channels', 'text[]', true, true),
    ('invoices', 'reference_id', 'uuid', false, true),
    ('invoices', 'handled_by', 'uuid', false, true),
    ('invoices', 'invoice_stage', 'text', false, true),
    ('references', 'id', 'uuid', true, false),
    ('references', 'merchant_id', 'uuid', true, false),
    ('references', 'name', 'text', true, false),
    ('references', 'description', 'text', false, false),
    ('references', 'handled_by', 'uuid', false, false),
    ('references', 'created_at', 'timestamp with time zone', true, false),
    ('references', 'updated_at', 'timestamp with time zone', true, false),
    ('references', 'project_total_value', 'numeric', false, true),
    ('item_catalog', 'id', 'uuid', true, false),
    ('item_catalog', 'merchant_id', 'uuid', true, false),
    ('item_catalog', 'item_name', 'text', true, false),
    ('item_catalog', 'default_rate', 'numeric(12,2)', true, false),
    ('item_catalog', 'description', 'text', false, false),
    ('item_catalog', 'is_active', 'boolean', true, false),
    ('item_catalog', 'usage_count', 'integer', true, false),
    ('item_catalog', 'created_at', 'timestamp with time zone', true, false),
    ('item_catalog', 'updated_at', 'timestamp with time zone', true, false),
    ('discount_templates', 'id', 'uuid', true, false),
    ('discount_templates', 'merchant_id', 'uuid', true, false),
    ('discount_templates', 'name', 'text', true, false),
    ('discount_templates', 'percentage', 'numeric(5,2)', true, false),
    ('discount_templates', 'is_active', 'boolean', true, false),
    ('discount_templates', 'created_at', 'timestamp with time zone', true, false),
    ('line_items', 'id', 'uuid', true, false),
    ('line_items', 'invoice_id', 'uuid', true, false),
    ('line_items', 'item_name', 'text', true, false),
    ('line_items', 'quantity', 'numeric(10,3)', true, false),
    ('line_items', 'unit_rate', 'numeric(12,2)', true, false),
    ('line_items', 'line_total', 'numeric(12,2)', true, false),
    ('line_items', 'sort_order', 'integer', true, false)
), column_state AS (
  SELECT
    expected_columns.*,
    relation.oid AS table_oid,
    attribute.attname AS actual_column,
    format_type(attribute.atttypid, attribute.atttypmod) AS actual_type,
    attribute.attnotnull AS actual_not_null
  FROM expected_columns
  LEFT JOIN pg_class relation
    ON relation.oid = to_regclass(format('public.%I', expected_columns.table_name))
  LEFT JOIN pg_attribute attribute
    ON attribute.attrelid = relation.oid
   AND attribute.attname = expected_columns.column_name
   AND attribute.attnum > 0
   AND NOT attribute.attisdropped
), expected_constraints(table_name, column_name, constraint_name, constraint_type) AS (
  VALUES
    ('references'::text, NULL::text, 'references_pkey'::text, 'p'::text),
    ('references', NULL, 'references_merchant_id_fkey', 'f'),
    ('references', NULL, 'references_handled_by_fkey', 'f'),
    ('references', NULL, 'references_merchant_id_name_key', 'u'),
    ('item_catalog', NULL, 'item_catalog_pkey', 'p'),
    ('item_catalog', NULL, 'item_catalog_merchant_id_fkey', 'f'),
    ('item_catalog', NULL, 'item_name_len', 'c'),
    ('item_catalog', NULL, 'item_catalog_default_rate_check', 'c'),
    ('discount_templates', NULL, 'discount_templates_pkey', 'p'),
    ('discount_templates', NULL, 'discount_templates_merchant_id_fkey', 'f'),
    ('discount_templates', NULL, 'discount_name_len', 'c'),
    ('discount_templates', NULL, 'discount_templates_percentage_check', 'c'),
    ('line_items', NULL, 'line_items_pkey', 'p'),
    ('line_items', NULL, 'line_items_invoice_id_fkey', 'f'),
    ('invoices', 'reference_id', 'invoices_reference_id_fkey', 'f'),
    ('invoices', 'handled_by', 'invoices_handled_by_fkey', 'f'),
    ('invoices', 'invoice_stage', 'invoices_invoice_stage_check', 'c')
), constraint_state AS (
  SELECT
    expected_constraints.*,
    relation.oid AS table_oid,
    attribute.attname AS actual_column,
    constraint_row.oid AS constraint_oid,
    constraint_row.contype::text AS actual_type,
    constraint_row.convalidated
  FROM expected_constraints
  LEFT JOIN pg_class relation
    ON relation.oid = to_regclass(format('public.%I', expected_constraints.table_name))
  LEFT JOIN pg_attribute attribute
    ON attribute.attrelid = relation.oid
   AND attribute.attname = expected_constraints.column_name
   AND attribute.attnum > 0
   AND NOT attribute.attisdropped
  LEFT JOIN pg_constraint constraint_row
    ON constraint_row.conrelid = relation.oid
   AND constraint_row.conname = expected_constraints.constraint_name
), unsafe AS (
  SELECT
    to_regclass('auth.users') IS NULL
    OR to_regclass('public.merchants') IS NULL
    OR to_regclass('public.merchant_team') IS NULL
    OR to_regclass('public.clients') IS NULL
    OR to_regclass('public.invoices') IS NULL
    OR to_regprocedure('public.can_read_merchant_row_v1(uuid)') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
    OR EXISTS (
      SELECT 1
      FROM pg_class relation
      WHERE relation.oid IN (
        to_regclass('public.merchants'),
        to_regclass('public.merchant_team'),
        to_regclass('public.clients'),
        to_regclass('public.invoices'),
        to_regclass('public.line_items'),
        to_regclass('public.references'),
        to_regclass('public.item_catalog'),
        to_regclass('public.discount_templates')
      )
        AND relation.relkind::text <> 'r'
    )
    OR EXISTS (
      SELECT 1
      FROM column_state
      WHERE table_oid IS NOT NULL
        AND (
          (actual_column IS NULL AND NOT missing_is_repairable)
          OR (
            actual_column IS NOT NULL
            AND (actual_type <> formatted_type OR actual_not_null <> not_null)
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM constraint_state
      WHERE table_oid IS NOT NULL
        AND (column_name IS NULL OR actual_column IS NOT NULL)
        AND (
          constraint_oid IS NULL
          OR actual_type <> constraint_type
          OR NOT convalidated
        )
    )
    OR EXISTS (
      SELECT 1
      FROM (VALUES
        ('idx_item_catalog_merchant'::text, 'item_catalog'::text),
        ('idx_references_merchant', 'references'),
        ('idx_invoices_reference', 'invoices'),
        ('idx_invoices_handled_by', 'invoices')
      ) AS expected_index(index_name, table_name)
      JOIN pg_indexes index_row
        ON index_row.schemaname = 'public'
       AND index_row.indexname = expected_index.index_name
      WHERE index_row.tablename <> expected_index.table_name
    ) AS blocked
)
SELECT format(
  '%s|FINAL|prerequisites=%s migration_compatibility=%s apply_authorized=false',
  CASE WHEN blocked THEN 'FAIL' ELSE 'PASS' END,
  CASE WHEN blocked THEN 'FAIL' ELSE 'PASS' END,
  CASE WHEN blocked THEN 'FAIL' ELSE 'PASS' END
)
FROM unsafe;

ROLLBACK;
