-- READ ONLY. Paste directly into Supabase SQL Editor after migration 020.
-- Every schema/security row must PASS. Compare preservation.paid_flow_row_counts
-- with the preflight JSON. If the table was absent at preflight, it must be empty
-- immediately after this schema-only migration.

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

WITH
expected_columns(column_name, expected_type, expected_nullable, expected_default) AS (
  VALUES
    ('id', 'uuid', 'NO', 'gen_random_uuid()'),
    ('merchant_id', 'uuid', 'NO', NULL),
    ('plan', 'text', 'NO', NULL),
    ('amount_ngn', 'numeric(10,2)', 'NO', NULL),
    ('period_start', 'timestamp with time zone', 'NO', NULL),
    ('period_end', 'timestamp with time zone', 'NO', NULL),
    ('paystack_ref', 'text', 'NO', NULL),
    ('payment_type', 'text', 'NO', '''new''::text'),
    ('status', 'text', 'NO', '''paid''::text'),
    ('created_at', 'timestamp with time zone', 'NO', 'now()')
),
target AS (
  SELECT to_regclass('public.subscription_payments') AS relid
),
table_check AS (
  SELECT
    'table.public.subscription_payments' AS check_name,
    'table' AS object_type,
    'ordinary table' AS expected,
    COALESCE('relkind=' || relation.relkind::text, 'missing') AS actual,
    CASE WHEN relation.relkind = 'r' THEN 'PASS' ELSE 'FAIL' END AS status,
    'Canonical subscription billing history table.' AS details
  FROM target
  LEFT JOIN pg_class relation ON relation.oid = target.relid
),
column_checks AS (
  SELECT
    'column.public.subscription_payments.' || expected.column_name AS check_name,
    'column' AS object_type,
    format(
      '%s nullable=%s default=%s',
      expected.expected_type,
      expected.expected_nullable,
      COALESCE(expected.expected_default, 'none')
    ) AS expected,
    CASE
      WHEN column_row.column_name IS NULL THEN 'missing'
      ELSE format(
        '%s nullable=%s default=%s',
        column_row.formatted_type,
        column_row.is_nullable,
        COALESCE(column_row.column_default, 'none')
      )
    END AS actual,
    CASE
      WHEN column_row.formatted_type = expected.expected_type
       AND column_row.is_nullable = expected.expected_nullable
       AND COALESCE(column_row.column_default, '') = COALESCE(expected.expected_default, '')
      THEN 'PASS' ELSE 'FAIL'
    END AS status,
    'Exact historical column type, nullability, and default contract.' AS details
  FROM expected_columns expected
  CROSS JOIN target
  LEFT JOIN LATERAL (
    SELECT
      attribute.attname AS column_name,
      format_type(attribute.atttypid, attribute.atttypmod) AS formatted_type,
      CASE WHEN attribute.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
      pg_get_expr(default_row.adbin, default_row.adrelid) AS column_default
    FROM pg_attribute attribute
    LEFT JOIN pg_attrdef default_row
      ON default_row.adrelid = attribute.attrelid
     AND default_row.adnum = attribute.attnum
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
    'Canonical identity, idempotency, or merchant ownership constraint.' AS details
  FROM (VALUES
    ('subscription_payments_pkey', 'PRIMARY KEY (id)'),
    ('subscription_payments_paystack_ref_key', 'UNIQUE (paystack_ref)'),
    ('subscription_payments_merchant_id_fkey', 'merchant_id REFERENCES public.merchants(id) ON DELETE CASCADE')
  ) expected(constraint_name, expected_description)
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
    format(
      'rls=%s policies=%s browser_grants=%s service_role_siud=%s',
      COALESCE(relation.relrowsecurity, false),
      count(policy.policyname),
      (SELECT count(*) FROM information_schema.role_table_grants grant_row
       WHERE grant_row.table_schema = 'public'
         AND grant_row.table_name = 'subscription_payments'
         AND grant_row.grantee IN ('PUBLIC', 'anon', 'authenticated')),
      CASE WHEN target.relid IS NULL THEN false
        ELSE has_table_privilege('service_role', 'public.subscription_payments', 'SELECT,INSERT,UPDATE,DELETE') END
    ) AS actual,
    CASE
      WHEN target.relid IS NOT NULL
       AND relation.relrowsecurity
       AND count(policy.policyname) = 1
       AND count(*) FILTER (
         WHERE policy.policyname = 'sub_payments_merchant'
           AND policy.permissive = 'PERMISSIVE'
           AND policy.cmd = 'SELECT'
           AND policy.roles::text[] IN (
             ARRAY['public']::text[],
             ARRAY['authenticated']::text[]
           )
           AND policy.qual LIKE '%merchant_id%'
           AND policy.qual LIKE '%merchants.user_id%'
           AND policy.qual LIKE '%auth.uid()%'
           AND policy.with_check IS NULL
       ) = 1
       AND has_table_privilege('authenticated', 'public.subscription_payments', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'public.subscription_payments', 'INSERT,UPDATE,DELETE')
       AND NOT has_table_privilege('anon', 'public.subscription_payments', 'SELECT,INSERT,UPDATE,DELETE')
       AND has_table_privilege('service_role', 'public.subscription_payments', 'SELECT,INSERT,UPDATE,DELETE')
      THEN 'PASS' ELSE 'FAIL'
    END AS status,
    'Browser writes remain blocked; paid activation writes remain service-only.' AS details
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
      WHEN target.relid IS NULL THEN 'table missing'
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
      WHEN target.relid IS NOT NULL
       AND NOT relation.relrowsecurity
       AND count(policy.policyname) = 0
       AND NOT EXISTS (
         SELECT 1 FROM information_schema.role_table_grants grant_row
         WHERE grant_row.table_schema = 'public'
           AND grant_row.table_name = 'payment_events'
           AND grant_row.grantee IN ('PUBLIC', 'anon', 'authenticated')
       )
       AND has_table_privilege('service_role', 'public.payment_events', 'SELECT,INSERT,UPDATE,DELETE')
      THEN 'PASS' ELSE 'FAIL'
    END AS status,
    'Migration 017 canonical service-only audit contract remains unchanged.' AS details
  FROM payment_events_target target
  LEFT JOIN pg_class relation ON relation.oid = target.relid
  LEFT JOIN pg_policies policy
    ON policy.schemaname = 'public'
   AND policy.tablename = 'payment_events'
  GROUP BY target.relid, relation.relrowsecurity
),
checks AS (
  SELECT * FROM table_check
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
  'Existing table counts equal preflight; subscription_payments=0 if absent at preflight',
  jsonb_build_object(
    'onboarding_sessions', (SELECT count(*) FROM public.onboarding_sessions),
    'payment_records', (SELECT count(*) FROM public.payment_records),
    'payment_events', (SELECT count(*) FROM public.payment_events),
    'subscriptions', (SELECT count(*) FROM public.subscriptions),
    'subscription_payments', (SELECT count(*) FROM public.subscription_payments),
    'workspace_subscriptions', (SELECT count(*) FROM public.workspace_subscriptions),
    'plan_migrations', (SELECT count(*) FROM public.plan_migrations)
  )::text,
  'WARN',
  'Manual comparison required: SQL Editor sessions do not retain preflight state. Migration 020 contains no business-row DML.'
ORDER BY status, check_name;

ROLLBACK;
