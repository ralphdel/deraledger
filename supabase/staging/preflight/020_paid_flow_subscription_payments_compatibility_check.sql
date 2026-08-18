-- READ ONLY. Paste directly into Supabase SQL Editor before migration 020.
-- Missing subscription_payments objects are WARN only when migration 020 can
-- create them from scratch. Stop on every FAIL.

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

WITH
expected_columns(column_name, expected_type, expected_nullable) AS (
  VALUES
    ('id', 'uuid', 'NO'),
    ('merchant_id', 'uuid', 'NO'),
    ('plan', 'text', 'NO'),
    ('amount_ngn', 'numeric(10,2)', 'NO'),
    ('period_start', 'timestamp with time zone', 'NO'),
    ('period_end', 'timestamp with time zone', 'NO'),
    ('paystack_ref', 'text', 'NO'),
    ('payment_type', 'text', 'NO'),
    ('status', 'text', 'NO'),
    ('created_at', 'timestamp with time zone', 'NO')
),
target AS (
  SELECT to_regclass('public.subscription_payments') AS relid
),
prerequisite_checks AS (
  SELECT
    'prerequisite.public.merchants' AS check_name,
    'table' AS object_type,
    'ordinary table' AS expected,
    COALESCE('relkind=' || relation.relkind::text, 'missing') AS actual,
    CASE WHEN relation.relkind = 'r' THEN 'PASS' ELSE 'FAIL' END AS status,
    'Migration 020 requires the existing merchant identity table.' AS details
  FROM (VALUES (to_regclass('public.merchants'))) expected(relid)
  LEFT JOIN pg_class relation ON relation.oid = expected.relid

  UNION ALL

  SELECT
    'prerequisite.supabase_roles',
    'role',
    'service_role, authenticated, and anon exist',
    format(
      'service_role=%s authenticated=%s anon=%s',
      EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role'),
      EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated'),
      EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
    ),
    CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
           AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
           AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
      THEN 'PASS' ELSE 'FAIL' END,
    'Migration 020 grants server writes and an owner-scoped authenticated read.'
),
table_check AS (
  SELECT
    'table.public.subscription_payments' AS check_name,
    'table' AS object_type,
    'ordinary table after migration 020' AS expected,
    COALESCE('relkind=' || relation.relkind::text, 'missing') AS actual,
    CASE
      WHEN target.relid IS NULL THEN 'WARN'
      WHEN relation.relkind = 'r' THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    CASE
      WHEN target.relid IS NULL THEN 'Repairable: migration 020 creates the canonical empty table.'
      WHEN relation.relkind = 'r' THEN 'Existing table will be checked for exact compatibility.'
      ELSE 'Blocking: migration 020 does not replace a non-table relation.'
    END AS details
  FROM target
  LEFT JOIN pg_class relation ON relation.oid = target.relid
),
column_checks AS (
  SELECT
    'column.public.subscription_payments.' || expected.column_name AS check_name,
    'column' AS object_type,
    expected.expected_type || ' nullable=' || expected.expected_nullable AS expected,
    CASE
      WHEN target.relid IS NULL THEN 'table missing'
      WHEN column_row.column_name IS NULL THEN 'column missing'
      ELSE format('%s nullable=%s', column_row.formatted_type, column_row.is_nullable)
    END AS actual,
    CASE
      WHEN target.relid IS NULL THEN 'WARN'
      WHEN column_row.column_name IS NULL THEN 'FAIL'
      WHEN column_row.formatted_type = expected.expected_type
       AND column_row.is_nullable = expected.expected_nullable THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    CASE
      WHEN target.relid IS NULL THEN 'Repairable with a new canonical table.'
      WHEN column_row.column_name IS NULL THEN 'Blocking on an existing table: values will not be invented for populated rows.'
      WHEN column_row.formatted_type <> expected.expected_type THEN 'Blocking incompatible type.'
      WHEN column_row.is_nullable <> expected.expected_nullable THEN 'Blocking nullable drift; inspect existing values before applying.'
      ELSE 'Column matches the canonical historical definition.'
    END AS details
  FROM expected_columns expected
  CROSS JOIN target
  LEFT JOIN LATERAL (
    SELECT
      attribute.attname AS column_name,
      format_type(attribute.atttypid, attribute.atttypmod) AS formatted_type,
      CASE WHEN attribute.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable
    FROM pg_attribute attribute
    WHERE attribute.attrelid = target.relid
      AND attribute.attname = expected.column_name
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ) column_row ON true
),
constraint_checks AS (
  SELECT
    'constraint.public.subscription_payments.' || expected.constraint_name AS check_name,
    'constraint' AS object_type,
    expected.expected_description AS expected,
    COALESCE(pg_get_constraintdef(constraint_row.oid, true), 'missing') AS actual,
    CASE
      WHEN target.relid IS NULL THEN 'WARN'
      WHEN constraint_row.oid IS NULL THEN 'FAIL'
      WHEN expected.constraint_name = 'subscription_payments_pkey'
       AND constraint_row.contype = 'p'
       AND constraint_row.convalidated
       AND constraint_row.conkey = ARRAY[
         (SELECT attnum FROM pg_attribute WHERE attrelid = target.relid AND attname = 'id')
       ]::smallint[] THEN 'PASS'
      WHEN expected.constraint_name = 'subscription_payments_paystack_ref_key'
       AND constraint_row.contype = 'u'
       AND constraint_row.convalidated
       AND constraint_row.conkey = ARRAY[
         (SELECT attnum FROM pg_attribute WHERE attrelid = target.relid AND attname = 'paystack_ref')
       ]::smallint[] THEN 'PASS'
      WHEN expected.constraint_name = 'subscription_payments_merchant_id_fkey'
       AND constraint_row.contype = 'f'
       AND constraint_row.convalidated
       AND constraint_row.conkey = ARRAY[
         (SELECT attnum FROM pg_attribute WHERE attrelid = target.relid AND attname = 'merchant_id')
       ]::smallint[]
       AND constraint_row.confkey = ARRAY[
         (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.merchants'::regclass AND attname = 'id')
       ]::smallint[]
       AND constraint_row.confrelid = 'public.merchants'::regclass
       AND constraint_row.confdeltype = 'c' THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    CASE
      WHEN target.relid IS NULL THEN 'Repairable with a new canonical table.'
      WHEN constraint_row.oid IS NULL THEN 'Blocking on an existing table; inspect duplicates/orphans before adding constraints.'
      ELSE 'Canonical identity, idempotency, or merchant ownership constraint.'
    END AS details
  FROM (VALUES
    ('subscription_payments_pkey', 'p'::"char", 'PRIMARY KEY (id)'),
    ('subscription_payments_paystack_ref_key', 'u'::"char", 'UNIQUE (paystack_ref)'),
    ('subscription_payments_merchant_id_fkey', 'f'::"char", 'merchant_id REFERENCES public.merchants(id) ON DELETE CASCADE')
  ) expected(constraint_name, constraint_type, expected_description)
  CROSS JOIN target
  LEFT JOIN pg_constraint constraint_row
    ON constraint_row.conrelid = target.relid
   AND constraint_row.conname = expected.constraint_name
),
subscription_security_check AS (
  SELECT
    'security.public.subscription_payments' AS check_name,
    'rls/policy/grant' AS object_type,
    'RLS; one owner SELECT policy; authenticated SELECT-only; service_role SELECT/INSERT/UPDATE/DELETE' AS expected,
    CASE
      WHEN target.relid IS NULL THEN 'table missing'
      ELSE format(
        'rls=%s policies=%s browser_grants=%s service_role_siud=%s',
        relation.relrowsecurity,
        count(policy.policyname),
        (SELECT count(*) FROM information_schema.role_table_grants grant_row
         WHERE grant_row.table_schema = 'public'
           AND grant_row.table_name = 'subscription_payments'
           AND grant_row.grantee IN ('PUBLIC', 'anon', 'authenticated')),
        has_table_privilege('service_role', 'public.subscription_payments', 'SELECT,INSERT,UPDATE,DELETE')
      )
    END AS actual,
    CASE
      WHEN target.relid IS NULL THEN 'WARN'
      WHEN relation.relrowsecurity
       AND count(policy.policyname) = 1
       AND count(*) FILTER (
         WHERE policy.policyname = 'sub_payments_merchant'
           AND policy.cmd = 'SELECT'
           AND policy.qual LIKE '%merchant_id%'
           AND policy.qual LIKE '%merchants.user_id%'
           AND policy.qual LIKE '%auth.uid()%'
           AND policy.with_check IS NULL
       ) = 1
       AND has_table_privilege('authenticated', 'public.subscription_payments', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'public.subscription_payments', 'INSERT,UPDATE,DELETE')
       AND NOT has_table_privilege('anon', 'public.subscription_payments', 'SELECT,INSERT,UPDATE,DELETE')
       AND has_table_privilege('service_role', 'public.subscription_payments', 'SELECT,INSERT,UPDATE,DELETE')
      THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    CASE
      WHEN target.relid IS NULL THEN 'Repairable: migration 020 creates and secures the table.'
      ELSE 'Existing security drift is not silently replaced; stop on FAIL.'
    END AS details
  FROM target
  LEFT JOIN pg_class relation ON relation.oid = target.relid
  LEFT JOIN pg_policies policy
    ON policy.schemaname = 'public'
   AND policy.tablename = 'subscription_payments'
  GROUP BY target.relid, relation.relrowsecurity
),
payment_events_target AS (
  SELECT to_regclass('public.payment_events') AS relid
),
payment_events_security_check AS (
  SELECT
    'security.public.payment_events' AS check_name,
    'service-only table' AS object_type,
    'RLS disabled; zero policies; zero PUBLIC/anon/authenticated grants; service_role SELECT/INSERT/UPDATE/DELETE' AS expected,
    CASE
      WHEN relation.oid IS NULL THEN 'table missing'
      ELSE format(
        'rls=%s policies=%s browser_grants=%s service_role_siud=%s',
        relation.relrowsecurity,
        count(policy.policyname),
        (SELECT count(*) FROM information_schema.role_table_grants grant_row
         WHERE grant_row.table_schema = 'public'
           AND grant_row.table_name = 'payment_events'
           AND grant_row.grantee IN ('PUBLIC', 'anon', 'authenticated')),
        has_table_privilege('service_role', 'public.payment_events', 'SELECT,INSERT,UPDATE,DELETE')
      )
    END AS actual,
    CASE
      WHEN relation.oid IS NOT NULL
       AND NOT relation.relrowsecurity
       AND count(policy.policyname) = 0
       AND NOT EXISTS (
         SELECT 1 FROM information_schema.role_table_grants grant_row
         WHERE grant_row.table_schema = 'public'
           AND grant_row.table_name = 'payment_events'
           AND grant_row.grantee IN ('PUBLIC', 'anon', 'authenticated')
       )
       AND has_table_privilege('service_role', 'public.payment_events', 'SELECT,INSERT,UPDATE,DELETE')
      THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    'Migration 017 deliberately established this service-only contract; migration 020 does not alter payment_events.' AS details
  FROM payment_events_target target
  LEFT JOIN pg_class relation ON relation.oid = target.relid
  LEFT JOIN pg_policies policy
    ON policy.schemaname = 'public'
   AND policy.tablename = 'payment_events'
  GROUP BY target.relid, relation.oid, relation.relrowsecurity
),
checks AS (
  SELECT * FROM prerequisite_checks
  UNION ALL SELECT * FROM table_check
  UNION ALL SELECT * FROM column_checks
  UNION ALL SELECT * FROM constraint_checks
  UNION ALL SELECT * FROM subscription_security_check
  UNION ALL SELECT * FROM payment_events_security_check
)
SELECT check_name, object_type, expected, actual, status, details
FROM checks

UNION ALL

SELECT
  'preservation.paid_flow_row_counts',
  'data preservation',
  'Capture and compare with postflight',
  jsonb_build_object(
    'onboarding_sessions', (SELECT count(*) FROM public.onboarding_sessions),
    'payment_records', (SELECT count(*) FROM public.payment_records),
    'payment_events', (SELECT count(*) FROM public.payment_events),
    'subscriptions', (SELECT count(*) FROM public.subscriptions),
    'workspace_subscriptions', (SELECT count(*) FROM public.workspace_subscriptions),
    'plan_migrations', (SELECT count(*) FROM public.plan_migrations)
  )::text,
  'PASS',
  'Migration 020 contains no business-row DML; retain this JSON for postflight comparison.'
ORDER BY status, check_name;

ROLLBACK;
