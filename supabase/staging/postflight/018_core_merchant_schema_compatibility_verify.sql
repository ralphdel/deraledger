-- READ ONLY: core merchant schema compatibility postflight.

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

WITH expected(table_name) AS (
  VALUES
    ('clients'::text),
    ('invoices'),
    ('line_items'),
    ('references'),
    ('item_catalog'),
    ('discount_templates')
), state AS (
  SELECT
    expected.table_name,
    relation.oid,
    relation.relkind::text AS relkind
  FROM expected
  LEFT JOIN pg_class relation
    ON relation.oid = to_regclass(format('public.%I', expected.table_name))
)
SELECT format(
  '%s|relation_manifest|present=%s expected=%s ordinary_tables=%s',
  CASE WHEN count(oid) = count(*) AND bool_and(relkind = 'r') THEN 'PASS' ELSE 'FAIL' END,
  count(oid),
  count(*),
  count(*) FILTER (WHERE relkind = 'r')
)
FROM state;

WITH expected_columns(table_name, column_name, formatted_type, not_null, allowed_defaults) AS (
  VALUES
    ('clients'::text, 'address'::text, 'text'::text, false, NULL::text[]),
    ('clients', 'whatsapp_number', 'text', false, NULL),
    ('clients', 'reminder_enabled', 'boolean', true, ARRAY['false']::text[]),
    ('clients', 'reminder_channels', 'text[]', true, ARRAY['''{}''::text[]', 'ARRAY[]::text[]']::text[]),
    ('invoices', 'reference_id', 'uuid', false, NULL),
    ('invoices', 'handled_by', 'uuid', false, NULL),
    ('invoices', 'invoice_stage', 'text', false, ARRAY['''standard''::text']::text[]),
    ('references', 'id', 'uuid', true, ARRAY['gen_random_uuid()']::text[]),
    ('references', 'merchant_id', 'uuid', true, NULL),
    ('references', 'name', 'text', true, NULL),
    ('references', 'description', 'text', false, NULL),
    ('references', 'handled_by', 'uuid', false, NULL),
    ('references', 'created_at', 'timestamp with time zone', true, ARRAY['now()']::text[]),
    ('references', 'updated_at', 'timestamp with time zone', true, ARRAY['now()']::text[]),
    ('references', 'project_total_value', 'numeric', false, ARRAY['0']::text[]),
    ('item_catalog', 'id', 'uuid', true, ARRAY['gen_random_uuid()']::text[]),
    ('item_catalog', 'merchant_id', 'uuid', true, NULL),
    ('item_catalog', 'item_name', 'text', true, NULL),
    ('item_catalog', 'default_rate', 'numeric(12,2)', true, NULL),
    ('item_catalog', 'description', 'text', false, NULL),
    ('item_catalog', 'is_active', 'boolean', true, ARRAY['true']::text[]),
    ('item_catalog', 'usage_count', 'integer', true, ARRAY['0']::text[]),
    ('item_catalog', 'created_at', 'timestamp with time zone', true, ARRAY['now()']::text[]),
    ('item_catalog', 'updated_at', 'timestamp with time zone', true, ARRAY['now()']::text[]),
    ('discount_templates', 'id', 'uuid', true, ARRAY['gen_random_uuid()']::text[]),
    ('discount_templates', 'merchant_id', 'uuid', true, NULL),
    ('discount_templates', 'name', 'text', true, NULL),
    ('discount_templates', 'percentage', 'numeric(5,2)', true, NULL),
    ('discount_templates', 'is_active', 'boolean', true, ARRAY['true']::text[]),
    ('discount_templates', 'created_at', 'timestamp with time zone', true, ARRAY['now()']::text[]),
    ('line_items', 'id', 'uuid', true, ARRAY['gen_random_uuid()']::text[]),
    ('line_items', 'invoice_id', 'uuid', true, NULL),
    ('line_items', 'item_name', 'text', true, NULL),
    ('line_items', 'quantity', 'numeric(10,3)', true, ARRAY['1']::text[]),
    ('line_items', 'unit_rate', 'numeric(12,2)', true, ARRAY['0']::text[]),
    ('line_items', 'line_total', 'numeric(12,2)', true, ARRAY['0']::text[]),
    ('line_items', 'sort_order', 'integer', true, ARRAY['0']::text[])
), state AS (
  SELECT
    expected_columns.*,
    attribute.attname AS actual_column,
    format_type(attribute.atttypid, attribute.atttypmod) AS actual_type,
    attribute.attnotnull AS actual_not_null,
    pg_get_expr(default_value.adbin, default_value.adrelid, true) AS actual_default
  FROM expected_columns
  LEFT JOIN pg_class relation
    ON relation.oid = to_regclass(format('public.%I', expected_columns.table_name))
  LEFT JOIN pg_attribute attribute
    ON attribute.attrelid = relation.oid
   AND attribute.attname = expected_columns.column_name
   AND attribute.attnum > 0
   AND NOT attribute.attisdropped
  LEFT JOIN pg_attrdef default_value
    ON default_value.adrelid = attribute.attrelid
   AND default_value.adnum = attribute.attnum
), classified AS (
  SELECT *,
    actual_column IS NOT NULL
      AND actual_type = formatted_type
      AND actual_not_null = not_null
      AND (
        allowed_defaults IS NULL
        OR COALESCE(actual_default, '<NULL>') = ANY (allowed_defaults)
      ) AS canonical
  FROM state
)
SELECT format(
  '%s|column_manifest|canonical=%s expected=%s missing=%s incompatible=%s',
  CASE WHEN bool_and(canonical) THEN 'PASS' ELSE 'FAIL' END,
  count(*) FILTER (WHERE canonical),
  count(*),
  count(*) FILTER (WHERE actual_column IS NULL),
  count(*) FILTER (WHERE actual_column IS NOT NULL AND NOT canonical)
)
FROM classified;

WITH expected_constraints(table_name, constraint_name, constraint_type) AS (
  VALUES
    ('references'::text, 'references_pkey'::text, 'p'::text),
    ('references', 'references_merchant_id_fkey', 'f'),
    ('references', 'references_handled_by_fkey', 'f'),
    ('references', 'references_merchant_id_name_key', 'u'),
    ('item_catalog', 'item_catalog_pkey', 'p'),
    ('item_catalog', 'item_catalog_merchant_id_fkey', 'f'),
    ('item_catalog', 'item_name_len', 'c'),
    ('item_catalog', 'item_catalog_default_rate_check', 'c'),
    ('discount_templates', 'discount_templates_pkey', 'p'),
    ('discount_templates', 'discount_templates_merchant_id_fkey', 'f'),
    ('discount_templates', 'discount_name_len', 'c'),
    ('discount_templates', 'discount_templates_percentage_check', 'c'),
    ('line_items', 'line_items_pkey', 'p'),
    ('line_items', 'line_items_invoice_id_fkey', 'f'),
    ('invoices', 'invoices_reference_id_fkey', 'f'),
    ('invoices', 'invoices_handled_by_fkey', 'f'),
    ('invoices', 'invoices_invoice_stage_check', 'c')
), state AS (
  SELECT
    expected_constraints.*,
    constraint_row.oid,
    constraint_row.contype::text AS actual_type,
    constraint_row.convalidated
  FROM expected_constraints
  LEFT JOIN pg_constraint constraint_row
    ON constraint_row.conrelid = to_regclass(format('public.%I', expected_constraints.table_name))
   AND constraint_row.conname = expected_constraints.constraint_name
)
SELECT format(
  '%s|constraint_manifest|canonical=%s expected=%s missing=%s wrong_type_or_unvalidated=%s',
  CASE
    WHEN count(oid) = count(*)
      AND bool_and(actual_type = constraint_type AND convalidated)
    THEN 'PASS'
    ELSE 'FAIL'
  END,
  count(*) FILTER (WHERE oid IS NOT NULL AND actual_type = constraint_type AND convalidated),
  count(*),
  count(*) FILTER (WHERE oid IS NULL),
  count(*) FILTER (WHERE oid IS NOT NULL AND (actual_type <> constraint_type OR NOT convalidated))
)
FROM state;

WITH expected_fks(
  table_name,
  constraint_name,
  local_columns,
  referenced_relation,
  referenced_columns,
  delete_action
) AS (
  VALUES
    ('references'::text, 'references_merchant_id_fkey'::text, ARRAY['merchant_id']::text[], 'public.merchants'::text, ARRAY['id']::text[], 'c'::text),
    ('references', 'references_handled_by_fkey', ARRAY['handled_by']::text[], 'auth.users', ARRAY['id']::text[], 'a'),
    ('item_catalog', 'item_catalog_merchant_id_fkey', ARRAY['merchant_id']::text[], 'public.merchants', ARRAY['id']::text[], 'c'),
    ('discount_templates', 'discount_templates_merchant_id_fkey', ARRAY['merchant_id']::text[], 'public.merchants', ARRAY['id']::text[], 'c'),
    ('line_items', 'line_items_invoice_id_fkey', ARRAY['invoice_id']::text[], 'public.invoices', ARRAY['id']::text[], 'c'),
    ('invoices', 'invoices_reference_id_fkey', ARRAY['reference_id']::text[], 'public.references', ARRAY['id']::text[], 'n'),
    ('invoices', 'invoices_handled_by_fkey', ARRAY['handled_by']::text[], 'auth.users', ARRAY['id']::text[], 'a')
), state AS (
  SELECT
    expected_fks.*,
    constraint_row.oid,
    constraint_row.convalidated,
    constraint_row.confrelid,
    constraint_row.confdeltype::text AS actual_delete_action,
    ARRAY(
      SELECT attribute.attname::text
      FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
      JOIN pg_attribute attribute
        ON attribute.attrelid = constraint_row.conrelid
       AND attribute.attnum = key_column.attnum
      ORDER BY key_column.ordinality
    ) AS actual_local_columns,
    ARRAY(
      SELECT attribute.attname::text
      FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key_column(attnum, ordinality)
      JOIN pg_attribute attribute
        ON attribute.attrelid = constraint_row.confrelid
       AND attribute.attnum = key_column.attnum
      ORDER BY key_column.ordinality
    ) AS actual_referenced_columns
  FROM expected_fks
  LEFT JOIN pg_constraint constraint_row
    ON constraint_row.conrelid = to_regclass(format('public.%I', expected_fks.table_name))
   AND constraint_row.conname = expected_fks.constraint_name
   AND constraint_row.contype = 'f'
)
SELECT format(
  '%s|foreign_key_manifest|canonical=%s expected=%s missing_or_incompatible=%s',
  CASE
    WHEN bool_and(
      oid IS NOT NULL
      AND convalidated
      AND confrelid = to_regclass(referenced_relation)
      AND actual_delete_action = delete_action
      AND actual_local_columns = local_columns
      AND actual_referenced_columns = referenced_columns
    )
    THEN 'PASS'
    ELSE 'FAIL'
  END,
  count(*) FILTER (
    WHERE oid IS NOT NULL
      AND convalidated
      AND confrelid = to_regclass(referenced_relation)
      AND actual_delete_action = delete_action
      AND actual_local_columns = local_columns
      AND actual_referenced_columns = referenced_columns
  ),
  count(*),
  count(*) FILTER (
    WHERE oid IS NULL
      OR NOT convalidated
      OR confrelid <> to_regclass(referenced_relation)
      OR actual_delete_action <> delete_action
      OR actual_local_columns <> local_columns
      OR actual_referenced_columns <> referenced_columns
  )
)
FROM state;

WITH expected(index_name, table_name, expected_definition) AS (
  VALUES
    (
      'idx_item_catalog_merchant'::text,
      'item_catalog'::text,
      'CREATE INDEX idx_item_catalog_merchant ON public.item_catalog USING btree (merchant_id, is_active)'::text
    ),
    (
      'idx_references_merchant',
      'references',
      'CREATE INDEX idx_references_merchant ON public."references" USING btree (merchant_id, created_at DESC)'
    ),
    (
      'idx_invoices_reference',
      'invoices',
      'CREATE INDEX idx_invoices_reference ON public.invoices USING btree (reference_id)'
    ),
    (
      'idx_invoices_handled_by',
      'invoices',
      'CREATE INDEX idx_invoices_handled_by ON public.invoices USING btree (handled_by)'
    )
), state AS (
  SELECT
    expected.*,
    index_row.indexname,
    index_row.tablename AS actual_table,
    index_row.indexdef AS actual_definition
  FROM expected
  LEFT JOIN pg_indexes index_row
    ON index_row.schemaname = 'public'
   AND index_row.indexname = expected.index_name
)
SELECT format(
  '%s|index_manifest|canonical=%s expected=%s missing=%s incompatible=%s',
  CASE
    WHEN count(indexname) = count(*)
      AND bool_and(actual_table = table_name AND actual_definition = expected_definition)
    THEN 'PASS'
    ELSE 'FAIL'
  END,
  count(*) FILTER (WHERE actual_table = table_name AND actual_definition = expected_definition),
  count(*),
  count(*) FILTER (WHERE indexname IS NULL),
  count(*) FILTER (WHERE indexname IS NOT NULL AND (actual_table <> table_name OR actual_definition <> expected_definition))
)
FROM state;

WITH expected_policies(table_name, policy_name) AS (
  VALUES
    ('clients'::text, 'authenticated_read_merchant_clients'::text),
    ('invoices', 'authenticated_read_merchant_invoices'),
    ('line_items', 'authenticated_read_merchant_line_items'),
    ('references', 'authenticated_read_merchant_references'),
    ('item_catalog', 'authenticated_read_merchant_item_catalog'),
    ('discount_templates', 'authenticated_read_merchant_discount_templates')
), state AS (
  SELECT
    expected_policies.*,
    relation.relrowsecurity,
    policy_row.policyname,
    policy_row.cmd,
    policy_row.roles
  FROM expected_policies
  LEFT JOIN pg_class relation
    ON relation.oid = to_regclass(format('public.%I', expected_policies.table_name))
  LEFT JOIN pg_policies policy_row
    ON policy_row.schemaname = 'public'
   AND policy_row.tablename = expected_policies.table_name
   AND policy_row.policyname = expected_policies.policy_name
), unsafe_extra AS (
  SELECT count(*) AS count
  FROM pg_policies policy_row
  WHERE policy_row.schemaname = 'public'
    AND policy_row.tablename IN (
      'clients', 'invoices', 'line_items', 'references', 'item_catalog', 'discount_templates'
    )
    AND policy_row.roles && ARRAY['public', 'anon', 'authenticated']::name[]
    AND policy_row.policyname NOT IN (SELECT policy_name FROM expected_policies)
)
SELECT format(
  '%s|rls_policy_manifest|canonical=%s expected=%s unsafe_extra=%s',
  CASE
    WHEN bool_and(
      relrowsecurity
      AND policyname IS NOT NULL
      AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[]
    )
      AND (SELECT count FROM unsafe_extra) = 0
    THEN 'PASS'
    ELSE 'FAIL'
  END,
  count(*) FILTER (
    WHERE relrowsecurity
      AND policyname IS NOT NULL
      AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[]
  ),
  count(*),
  (SELECT count FROM unsafe_extra)
)
FROM state;

WITH targets(table_name) AS (
  VALUES
    ('clients'::text),
    ('invoices'),
    ('line_items'),
    ('references'),
    ('item_catalog'),
    ('discount_templates')
), state AS (
  SELECT
    targets.table_name,
    NOT EXISTS (
      SELECT 1
      FROM information_schema.table_privileges privilege_row
      WHERE privilege_row.table_schema = 'public'
        AND privilege_row.table_name = targets.table_name
        AND privilege_row.grantee IN ('PUBLIC', 'anon')
    ) AS anonymous_access_clear,
    has_table_privilege('authenticated', format('public.%I', targets.table_name), 'SELECT') AS authenticated_select,
    NOT has_table_privilege('authenticated', format('public.%I', targets.table_name), 'INSERT')
      AND NOT has_table_privilege('authenticated', format('public.%I', targets.table_name), 'UPDATE')
      AND NOT has_table_privilege('authenticated', format('public.%I', targets.table_name), 'DELETE')
      AND NOT has_table_privilege('authenticated', format('public.%I', targets.table_name), 'TRUNCATE')
      AND NOT has_table_privilege('authenticated', format('public.%I', targets.table_name), 'REFERENCES')
      AND NOT has_table_privilege('authenticated', format('public.%I', targets.table_name), 'TRIGGER')
      AS authenticated_writes_clear,
    has_table_privilege('service_role', format('public.%I', targets.table_name), 'SELECT')
      AND has_table_privilege('service_role', format('public.%I', targets.table_name), 'INSERT')
      AND has_table_privilege('service_role', format('public.%I', targets.table_name), 'UPDATE')
      AND has_table_privilege('service_role', format('public.%I', targets.table_name), 'DELETE')
      AND has_table_privilege('service_role', format('public.%I', targets.table_name), 'TRUNCATE')
      AND has_table_privilege('service_role', format('public.%I', targets.table_name), 'REFERENCES')
      AND has_table_privilege('service_role', format('public.%I', targets.table_name), 'TRIGGER')
      AS service_role_access
  FROM targets
)
SELECT format(
  '%s|grant_manifest|canonical=%s expected=%s',
  CASE
    WHEN bool_and(
      anonymous_access_clear
      AND authenticated_select
      AND authenticated_writes_clear
      AND service_role_access
    )
    THEN 'PASS'
    ELSE 'FAIL'
  END,
  count(*) FILTER (
    WHERE anonymous_access_clear
      AND authenticated_select
      AND authenticated_writes_clear
      AND service_role_access
  ),
  count(*)
)
FROM state;

SELECT format(
  '%s|trigger_manifest|unexpected_new_table_triggers=%s',
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
  count(*)
)
FROM pg_trigger trigger_row
JOIN pg_class relation ON relation.oid = trigger_row.tgrelid
JOIN pg_namespace relation_namespace ON relation_namespace.oid = relation.relnamespace
WHERE relation_namespace.nspname = 'public'
  AND relation.relname IN ('line_items', 'references', 'item_catalog', 'discount_templates')
  AND NOT trigger_row.tgisinternal;

SELECT format(
  'PASS|preservation_postflight|clients=%s invoices=%s line_items=%s references=%s item_catalog=%s discount_templates=%s (clients/invoices must match preflight)',
  (SELECT count(*) FROM public.clients),
  (SELECT count(*) FROM public.invoices),
  (SELECT count(*) FROM public.line_items),
  (SELECT count(*) FROM public."references"),
  (SELECT count(*) FROM public.item_catalog),
  (SELECT count(*) FROM public.discount_templates)
);

SELECT format(
  '%s|invoice_detail_table_contract|line_items_exists=%s invoice_items_required=false invoice_items_present=%s',
  CASE WHEN to_regclass('public.line_items') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
  to_regclass('public.line_items') IS NOT NULL,
  to_regclass('public.invoice_items') IS NOT NULL
);

WITH expected_columns(table_name, column_name, formatted_type, not_null) AS (
  VALUES
    ('clients'::text, 'address'::text, 'text'::text, false),
    ('clients', 'whatsapp_number', 'text', false),
    ('clients', 'reminder_enabled', 'boolean', true),
    ('clients', 'reminder_channels', 'text[]', true),
    ('invoices', 'reference_id', 'uuid', false),
    ('invoices', 'handled_by', 'uuid', false),
    ('invoices', 'invoice_stage', 'text', false),
    ('references', 'id', 'uuid', true),
    ('references', 'merchant_id', 'uuid', true),
    ('references', 'name', 'text', true),
    ('references', 'description', 'text', false),
    ('references', 'handled_by', 'uuid', false),
    ('references', 'created_at', 'timestamp with time zone', true),
    ('references', 'updated_at', 'timestamp with time zone', true),
    ('references', 'project_total_value', 'numeric', false),
    ('item_catalog', 'id', 'uuid', true),
    ('item_catalog', 'merchant_id', 'uuid', true),
    ('item_catalog', 'item_name', 'text', true),
    ('item_catalog', 'default_rate', 'numeric(12,2)', true),
    ('item_catalog', 'description', 'text', false),
    ('item_catalog', 'is_active', 'boolean', true),
    ('item_catalog', 'usage_count', 'integer', true),
    ('item_catalog', 'created_at', 'timestamp with time zone', true),
    ('item_catalog', 'updated_at', 'timestamp with time zone', true),
    ('discount_templates', 'id', 'uuid', true),
    ('discount_templates', 'merchant_id', 'uuid', true),
    ('discount_templates', 'name', 'text', true),
    ('discount_templates', 'percentage', 'numeric(5,2)', true),
    ('discount_templates', 'is_active', 'boolean', true),
    ('discount_templates', 'created_at', 'timestamp with time zone', true),
    ('line_items', 'id', 'uuid', true),
    ('line_items', 'invoice_id', 'uuid', true),
    ('line_items', 'item_name', 'text', true),
    ('line_items', 'quantity', 'numeric(10,3)', true),
    ('line_items', 'unit_rate', 'numeric(12,2)', true),
    ('line_items', 'line_total', 'numeric(12,2)', true),
    ('line_items', 'sort_order', 'integer', true)
), column_state AS (
  SELECT
    expected_columns.*,
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
), expected_constraints(table_name, constraint_name, constraint_type) AS (
  VALUES
    ('references'::text, 'references_pkey'::text, 'p'::text),
    ('references', 'references_merchant_id_fkey', 'f'),
    ('references', 'references_handled_by_fkey', 'f'),
    ('references', 'references_merchant_id_name_key', 'u'),
    ('item_catalog', 'item_catalog_pkey', 'p'),
    ('item_catalog', 'item_catalog_merchant_id_fkey', 'f'),
    ('item_catalog', 'item_name_len', 'c'),
    ('item_catalog', 'item_catalog_default_rate_check', 'c'),
    ('discount_templates', 'discount_templates_pkey', 'p'),
    ('discount_templates', 'discount_templates_merchant_id_fkey', 'f'),
    ('discount_templates', 'discount_name_len', 'c'),
    ('discount_templates', 'discount_templates_percentage_check', 'c'),
    ('line_items', 'line_items_pkey', 'p'),
    ('line_items', 'line_items_invoice_id_fkey', 'f'),
    ('invoices', 'invoices_reference_id_fkey', 'f'),
    ('invoices', 'invoices_handled_by_fkey', 'f'),
    ('invoices', 'invoices_invoice_stage_check', 'c')
), constraint_state AS (
  SELECT
    expected_constraints.*,
    constraint_row.oid,
    constraint_row.contype::text AS actual_type,
    constraint_row.convalidated
  FROM expected_constraints
  LEFT JOIN pg_constraint constraint_row
    ON constraint_row.conrelid = to_regclass(format('public.%I', expected_constraints.table_name))
   AND constraint_row.conname = expected_constraints.constraint_name
), expected_policies(table_name, policy_name) AS (
  VALUES
    ('clients'::text, 'authenticated_read_merchant_clients'::text),
    ('invoices', 'authenticated_read_merchant_invoices'),
    ('line_items', 'authenticated_read_merchant_line_items'),
    ('references', 'authenticated_read_merchant_references'),
    ('item_catalog', 'authenticated_read_merchant_item_catalog'),
    ('discount_templates', 'authenticated_read_merchant_discount_templates')
), policy_state AS (
  SELECT
    expected_policies.*,
    relation.relrowsecurity,
    policy_row.policyname,
    policy_row.cmd,
    policy_row.roles
  FROM expected_policies
  LEFT JOIN pg_class relation
    ON relation.oid = to_regclass(format('public.%I', expected_policies.table_name))
  LEFT JOIN pg_policies policy_row
    ON policy_row.schemaname = 'public'
   AND policy_row.tablename = expected_policies.table_name
   AND policy_row.policyname = expected_policies.policy_name
), expected_indexes(index_name, table_name, expected_definition) AS (
  VALUES
    (
      'idx_item_catalog_merchant'::text,
      'item_catalog'::text,
      'CREATE INDEX idx_item_catalog_merchant ON public.item_catalog USING btree (merchant_id, is_active)'::text
    ),
    (
      'idx_references_merchant',
      'references',
      'CREATE INDEX idx_references_merchant ON public."references" USING btree (merchant_id, created_at DESC)'
    ),
    (
      'idx_invoices_reference',
      'invoices',
      'CREATE INDEX idx_invoices_reference ON public.invoices USING btree (reference_id)'
    ),
    (
      'idx_invoices_handled_by',
      'invoices',
      'CREATE INDEX idx_invoices_handled_by ON public.invoices USING btree (handled_by)'
    )
), index_state AS (
  SELECT
    expected_indexes.*,
    index_row.indexname,
    index_row.tablename AS actual_table,
    index_row.indexdef AS actual_definition
  FROM expected_indexes
  LEFT JOIN pg_indexes index_row
    ON index_row.schemaname = 'public'
   AND index_row.indexname = expected_indexes.index_name
), grant_state AS (
  SELECT
    target.table_name,
    NOT EXISTS (
      SELECT 1
      FROM information_schema.table_privileges privilege_row
      WHERE privilege_row.table_schema = 'public'
        AND privilege_row.table_name = target.table_name
        AND privilege_row.grantee IN ('PUBLIC', 'anon')
    )
      AND has_table_privilege('authenticated', format('public.%I', target.table_name), 'SELECT')
      AND NOT has_table_privilege('authenticated', format('public.%I', target.table_name), 'INSERT')
      AND NOT has_table_privilege('authenticated', format('public.%I', target.table_name), 'UPDATE')
      AND NOT has_table_privilege('authenticated', format('public.%I', target.table_name), 'DELETE')
      AND NOT has_table_privilege('authenticated', format('public.%I', target.table_name), 'TRUNCATE')
      AND NOT has_table_privilege('authenticated', format('public.%I', target.table_name), 'REFERENCES')
      AND NOT has_table_privilege('authenticated', format('public.%I', target.table_name), 'TRIGGER')
      AND has_table_privilege('service_role', format('public.%I', target.table_name), 'SELECT')
      AND has_table_privilege('service_role', format('public.%I', target.table_name), 'INSERT')
      AND has_table_privilege('service_role', format('public.%I', target.table_name), 'UPDATE')
      AND has_table_privilege('service_role', format('public.%I', target.table_name), 'DELETE')
      AND has_table_privilege('service_role', format('public.%I', target.table_name), 'TRUNCATE')
      AND has_table_privilege('service_role', format('public.%I', target.table_name), 'REFERENCES')
      AND has_table_privilege('service_role', format('public.%I', target.table_name), 'TRIGGER')
      AS canonical
  FROM (
    VALUES
      ('clients'::text),
      ('invoices'),
      ('line_items'),
      ('references'),
      ('item_catalog'),
      ('discount_templates')
  ) AS target(table_name)
), final_state AS (
  SELECT
    to_regclass('public.clients') IS NOT NULL
    AND to_regclass('public.invoices') IS NOT NULL
    AND to_regclass('public.line_items') IS NOT NULL
    AND to_regclass('public.references') IS NOT NULL
    AND to_regclass('public.item_catalog') IS NOT NULL
    AND to_regclass('public.discount_templates') IS NOT NULL
    AND to_regprocedure('public.can_read_merchant_row_v1(uuid)') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM column_state
      WHERE actual_column IS NULL
        OR actual_type <> formatted_type
        OR actual_not_null <> not_null
    )
    AND NOT EXISTS (
      SELECT 1 FROM constraint_state
      WHERE oid IS NULL
        OR actual_type <> constraint_type
        OR NOT convalidated
    )
    AND NOT EXISTS (
      SELECT 1 FROM policy_state
      WHERE NOT relrowsecurity
        OR policyname IS NULL
        OR cmd <> 'SELECT'
        OR roles <> ARRAY['authenticated']::name[]
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_policies policy_row
      WHERE policy_row.schemaname = 'public'
        AND policy_row.tablename IN (
          'clients', 'invoices', 'line_items', 'references', 'item_catalog', 'discount_templates'
        )
        AND policy_row.roles && ARRAY['public', 'anon', 'authenticated']::name[]
        AND policy_row.policyname NOT IN (SELECT policy_name FROM expected_policies)
    )
    AND NOT EXISTS (
      SELECT 1 FROM index_state
      WHERE indexname IS NULL
        OR actual_table <> table_name
        OR actual_definition <> expected_definition
    )
    AND NOT EXISTS (SELECT 1 FROM grant_state WHERE NOT canonical)
    AND NOT EXISTS (
      SELECT 1
      FROM pg_trigger trigger_row
      JOIN pg_class relation ON relation.oid = trigger_row.tgrelid
      JOIN pg_namespace relation_namespace ON relation_namespace.oid = relation.relnamespace
      WHERE relation_namespace.nspname = 'public'
        AND relation.relname IN ('line_items', 'references', 'item_catalog', 'discount_templates')
        AND NOT trigger_row.tgisinternal
    ) AS compatible
)
SELECT format(
  '%s|FINAL|tables=%s columns=%s constraints=%s policies=%s indexes=%s grants=%s triggers=%s data_compare_required=true',
  CASE WHEN compatible THEN 'PASS' ELSE 'FAIL' END,
  CASE WHEN compatible THEN 'PASS' ELSE 'FAIL' END,
  CASE WHEN compatible THEN 'PASS' ELSE 'FAIL' END,
  CASE WHEN compatible THEN 'PASS' ELSE 'FAIL' END,
  CASE WHEN compatible THEN 'PASS' ELSE 'FAIL' END,
  CASE WHEN compatible THEN 'PASS' ELSE 'FAIL' END,
  CASE WHEN compatible THEN 'PASS' ELSE 'FAIL' END,
  CASE WHEN compatible THEN 'PASS' ELSE 'FAIL' END
)
FROM final_state;

ROLLBACK;
