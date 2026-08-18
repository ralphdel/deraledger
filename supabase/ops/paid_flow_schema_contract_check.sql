-- Read-only, SQL-Editor-compatible paid-flow schema contract check.
-- This script performs catalog reads only. It does not apply or repair schema.
-- Paid/live payment testing remains prohibited unless every returned row is PASS.
WITH required_tables(table_name) AS (
  VALUES
    ('onboarding_sessions'),
    ('payment_records'),
    ('payment_events'),
    ('subscriptions'),
    ('subscription_payments'),
    ('workspace_subscriptions'),
    ('plan_migrations')
),
required_columns(table_name, column_name) AS (
  VALUES
    ('onboarding_sessions', 'id'),
    ('onboarding_sessions', 'email'),
    ('onboarding_sessions', 'business_name'),
    ('onboarding_sessions', 'plan'),
    ('onboarding_sessions', 'status'),
    ('onboarding_sessions', 'expires_at'),
    ('onboarding_sessions', 'merchant_id'),
    ('onboarding_sessions', 'paystack_ref'),
    ('onboarding_sessions', 'amount_paid'),
    ('onboarding_sessions', 'idempotency_key'),
    ('onboarding_sessions', 'business_type'),
    ('onboarding_sessions', 'relationship_claim'),
    ('onboarding_sessions', 'verification_disclosure_acknowledged_at'),
    ('onboarding_sessions', 'verification_disclosure_version'),
    ('payment_records', 'id'),
    ('payment_records', 'user_id'),
    ('payment_records', 'merchant_id'),
    ('payment_records', 'onboarding_session_id'),
    ('payment_records', 'solo_plus_case_id'),
    ('payment_records', 'business_id'),
    ('payment_records', 'payment_purpose'),
    ('payment_records', 'payment_method'),
    ('payment_records', 'provider_name'),
    ('payment_records', 'internal_reference'),
    ('payment_records', 'provider_reference'),
    ('payment_records', 'expected_amount'),
    ('payment_records', 'amount_paid'),
    ('payment_records', 'plan_name'),
    ('payment_records', 'plan_id'),
    ('payment_records', 'payment_status'),
    ('payment_records', 'processing_status'),
    ('payment_records', 'account_setup_status'),
    ('payment_records', 'password_setup_required'),
    ('payment_records', 'customer_email'),
    ('payment_records', 'currency'),
    ('payment_records', 'metadata'),
    ('payment_records', 'failure_reason'),
    ('payment_records', 'raw_provider_payload'),
    ('payment_records', 'paid_at'),
    ('payment_records', 'setup_recovery_token_hash'),
    ('payment_records', 'setup_recovery_token_expires_at'),
    ('payment_records', 'setup_recovery_email_sent_at'),
    ('payment_records', 'setup_recovery_email_count'),
    ('payment_events', 'id'),
    ('payment_events', 'merchant_id'),
    ('payment_events', 'invoice_id'),
    ('payment_events', 'event_type'),
    ('payment_events', 'processor'),
    ('payment_events', 'processor_ref'),
    ('payment_events', 'amount_kobo'),
    ('payment_events', 'raw_payload'),
    ('payment_events', 'idempotency_key'),
    ('payment_events', 'payment_method'),
    ('payment_events', 'payment_purpose'),
    ('payment_events', 'payment_reference'),
    ('payment_events', 'provider_reference'),
    ('payment_events', 'expected_amount'),
    ('payment_events', 'paid_amount'),
    ('payment_events', 'currency'),
    ('payment_events', 'fee'),
    ('payment_events', 'plan_id'),
    ('payment_events', 'subscription_id'),
    ('payment_events', 'business_id'),
    ('payment_events', 'customer_email'),
    ('payment_events', 'processing_status'),
    ('payment_events', 'failure_reason'),
    ('payment_events', 'settlement_destination_source'),
    ('payment_events', 'reconciliation_status'),
    ('subscriptions', 'id'),
    ('subscriptions', 'merchant_id'),
    ('subscriptions', 'plan_type'),
    ('subscriptions', 'amount_paid'),
    ('subscriptions', 'start_date'),
    ('subscriptions', 'expiry_date'),
    ('subscriptions', 'status'),
    ('subscriptions', 'created_at'),
    ('subscription_payments', 'id'),
    ('subscription_payments', 'merchant_id'),
    ('subscription_payments', 'plan'),
    ('subscription_payments', 'amount_ngn'),
    ('subscription_payments', 'period_start'),
    ('subscription_payments', 'period_end'),
    ('subscription_payments', 'paystack_ref'),
    ('subscription_payments', 'payment_type'),
    ('subscription_payments', 'status'),
    ('subscription_payments', 'created_at'),
    ('workspace_subscriptions', 'id'),
    ('workspace_subscriptions', 'workspace_id'),
    ('workspace_subscriptions', 'merchant_id'),
    ('workspace_subscriptions', 'plan_type'),
    ('workspace_subscriptions', 'subscription_status'),
    ('workspace_subscriptions', 'payment_reference'),
    ('plan_migrations', 'id'),
    ('plan_migrations', 'merchant_id'),
    ('plan_migrations', 'source_table'),
    ('plan_migrations', 'source_record_id'),
    ('plan_migrations', 'old_plan_code'),
    ('plan_migrations', 'new_plan_code'),
    ('plan_migrations', 'migration_type'),
    ('plan_migrations', 'migration_key'),
    ('plan_migrations', 'metadata_json'),
    ('plan_migrations', 'created_at')
),
table_checks AS (
  SELECT
    'table.public.' || rt.table_name AS check_name,
    'table'::text AS object_type,
    'present'::text AS expected,
    CASE WHEN t.table_name IS NULL THEN 'missing' ELSE 'present' END AS actual,
    CASE WHEN t.table_name IS NULL THEN 'FAIL' ELSE 'PASS' END AS status,
    'Required by paid onboarding, payment recovery, or plan activation.'::text AS details
  FROM required_tables rt
  LEFT JOIN information_schema.tables t
    ON t.table_schema = 'public' AND t.table_name = rt.table_name
),
column_checks AS (
  SELECT
    'column.public.' || rc.table_name || '.' || rc.column_name AS check_name,
    'column'::text AS object_type,
    'present'::text AS expected,
    CASE WHEN c.column_name IS NULL THEN 'missing' ELSE c.data_type END AS actual,
    CASE WHEN c.column_name IS NULL THEN 'FAIL' ELSE 'PASS' END AS status,
    'Column is read or written by the current paid-flow application contract.'::text AS details
  FROM required_columns rc
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public'
   AND c.table_name = rc.table_name
   AND c.column_name = rc.column_name
),
rls_checks AS (
  SELECT
    'rls.public.' || rt.table_name AS check_name,
    'rls/policy'::text AS object_type,
    CASE
      WHEN rt.table_name = 'subscription_payments'
        THEN 'RLS enabled with one canonical owner SELECT policy'
      WHEN rt.table_name = 'payment_events'
        THEN 'Canonical service-only state: RLS disabled, zero policies, zero browser grants'
      ELSE 'RLS enabled'
    END::text AS expected,
    CASE
      WHEN cls.oid IS NULL THEN 'table missing'
      WHEN rt.table_name = 'payment_events' THEN format(
        'rls=%s policies=%s browser_grants=%s',
        cls.relrowsecurity,
        COUNT(pol.policyname),
        (SELECT count(*)
         FROM information_schema.role_table_grants grant_row
         WHERE grant_row.table_schema = 'public'
           AND grant_row.table_name = 'payment_events'
           AND grant_row.grantee IN ('PUBLIC', 'anon', 'authenticated'))
      )
      ELSE 'rls=' || cls.relrowsecurity::text || ' policies=' || COUNT(pol.policyname)::text
    END AS actual,
    CASE
      WHEN cls.oid IS NULL THEN 'FAIL'
      WHEN rt.table_name = 'subscription_payments'
       AND cls.relrowsecurity
       AND COUNT(pol.policyname) = 1
       AND COUNT(*) FILTER (
         WHERE pol.policyname = 'sub_payments_merchant'
           AND pol.cmd = 'SELECT'
           AND pol.qual LIKE '%merchant_id%'
           AND pol.qual LIKE '%merchants.user_id%'
           AND pol.qual LIKE '%auth.uid()%'
           AND pol.with_check IS NULL
       ) = 1 THEN 'PASS'
      WHEN rt.table_name = 'subscription_payments' THEN 'FAIL'
      WHEN rt.table_name = 'payment_events'
       AND NOT cls.relrowsecurity
       AND COUNT(pol.policyname) = 0
       AND NOT EXISTS (
         SELECT 1
         FROM information_schema.role_table_grants grant_row
         WHERE grant_row.table_schema = 'public'
           AND grant_row.table_name = 'payment_events'
           AND grant_row.grantee IN ('PUBLIC', 'anon', 'authenticated')
       ) THEN 'PASS'
      WHEN rt.table_name = 'payment_events' THEN 'FAIL'
      WHEN cls.relrowsecurity THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    CASE
      WHEN cls.oid IS NULL THEN 'Required table is missing.'
      WHEN rt.table_name = 'subscription_payments' AND cls.relrowsecurity
        THEN 'Owner-scoped billing history policy is present.'
      WHEN rt.table_name = 'payment_events' AND NOT cls.relrowsecurity
        THEN 'Migration 017 intentionally made this audit table service-only; RLS-off is safe only with zero browser grants and policies.'
      WHEN cls.relrowsecurity THEN 'RLS is enabled.'
      ELSE 'RLS/security state does not match the paid-flow contract.'
    END AS details
  FROM required_tables rt
  LEFT JOIN pg_namespace ns ON ns.nspname = 'public'
  LEFT JOIN pg_class cls ON cls.relnamespace = ns.oid AND cls.relname = rt.table_name AND cls.relkind = 'r'
  LEFT JOIN pg_policies pol ON pol.schemaname = 'public' AND pol.tablename = rt.table_name
  GROUP BY rt.table_name, cls.oid, cls.relrowsecurity
),
service_role_checks AS (
  SELECT
    'grant.service_role.public.' || rt.table_name AS check_name,
    'grant'::text AS object_type,
    CASE WHEN rt.table_name IN ('subscription_payments', 'payment_events')
      THEN 'service_role SELECT,INSERT,UPDATE,DELETE'
      ELSE 'service_role SELECT,INSERT,UPDATE'
    END::text AS expected,
    CASE
      WHEN t.table_name IS NULL THEN 'table missing'
      WHEN has_table_privilege('service_role', format('public.%I', rt.table_name), 'SELECT')
       AND has_table_privilege('service_role', format('public.%I', rt.table_name), 'INSERT')
       AND has_table_privilege('service_role', format('public.%I', rt.table_name), 'UPDATE')
       AND (rt.table_name NOT IN ('subscription_payments', 'payment_events')
         OR has_table_privilege('service_role', format('public.%I', rt.table_name), 'DELETE')) THEN 'present'
      ELSE 'not confirmed'
    END AS actual,
    CASE
      WHEN t.table_name IS NULL THEN 'FAIL'
      WHEN has_table_privilege('service_role', format('public.%I', rt.table_name), 'SELECT')
       AND has_table_privilege('service_role', format('public.%I', rt.table_name), 'INSERT')
       AND has_table_privilege('service_role', format('public.%I', rt.table_name), 'UPDATE')
       AND (rt.table_name NOT IN ('subscription_payments', 'payment_events')
         OR has_table_privilege('service_role', format('public.%I', rt.table_name), 'DELETE')) THEN 'PASS'
      ELSE 'WARN'
    END AS status,
    'Read-only privilege inspection; this script does not alter grants.'::text AS details
  FROM required_tables rt
  LEFT JOIN information_schema.tables t
    ON t.table_schema = 'public' AND t.table_name = rt.table_name
),
subscription_payment_column_contract_checks AS (
  SELECT
    'contract.public.subscription_payments.' || expected.column_name AS check_name,
    'column contract'::text AS object_type,
    expected.expected_type || ' nullable=' || expected.expected_nullable AS expected,
    CASE
      WHEN attribute.attname IS NULL THEN 'missing'
      ELSE format(
        '%s nullable=%s',
        format_type(attribute.atttypid, attribute.atttypmod),
        CASE WHEN attribute.attnotnull THEN 'NO' ELSE 'YES' END
      )
    END AS actual,
    CASE
      WHEN format_type(attribute.atttypid, attribute.atttypmod) = expected.expected_type
       AND CASE WHEN attribute.attnotnull THEN 'NO' ELSE 'YES' END = expected.expected_nullable
      THEN 'PASS' ELSE 'FAIL'
    END AS status,
    'Exact historical subscription payment type and nullability contract.' AS details
  FROM (VALUES
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
  ) expected(column_name, expected_type, expected_nullable)
  LEFT JOIN pg_attribute attribute
    ON attribute.attrelid = to_regclass('public.subscription_payments')
   AND attribute.attname = expected.column_name
   AND attribute.attnum > 0
   AND NOT attribute.attisdropped
),
subscription_payment_constraint_checks AS (
  SELECT
    'constraint.public.subscription_payments.' || expected.constraint_name AS check_name,
    'constraint'::text AS object_type,
    expected.expected_description::text AS expected,
    COALESCE(pg_get_constraintdef(constraint_row.oid, true), 'missing') AS actual,
    CASE
      WHEN to_regclass('public.subscription_payments') IS NULL THEN 'FAIL'
      WHEN expected.constraint_name = 'subscription_payments_pkey'
       AND constraint_row.contype = 'p'
       AND constraint_row.convalidated
       AND constraint_row.conkey = ARRAY[
         (SELECT attnum FROM pg_attribute
          WHERE attrelid = to_regclass('public.subscription_payments') AND attname = 'id')
       ]::smallint[] THEN 'PASS'
      WHEN expected.constraint_name = 'subscription_payments_paystack_ref_key'
       AND constraint_row.contype = 'u'
       AND constraint_row.convalidated
       AND constraint_row.conkey = ARRAY[
         (SELECT attnum FROM pg_attribute
          WHERE attrelid = to_regclass('public.subscription_payments') AND attname = 'paystack_ref')
       ]::smallint[] THEN 'PASS'
      WHEN expected.constraint_name = 'subscription_payments_merchant_id_fkey'
       AND constraint_row.contype = 'f'
       AND constraint_row.convalidated
       AND constraint_row.conkey = ARRAY[
         (SELECT attnum FROM pg_attribute
          WHERE attrelid = to_regclass('public.subscription_payments') AND attname = 'merchant_id')
       ]::smallint[]
       AND constraint_row.confkey = ARRAY[
         (SELECT attnum FROM pg_attribute
          WHERE attrelid = to_regclass('public.merchants') AND attname = 'id')
       ]::smallint[]
       AND constraint_row.confrelid = to_regclass('public.merchants')
       AND constraint_row.confdeltype = 'c' THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    'Canonical subscription payment identity, idempotency, or merchant ownership constraint.' AS details
  FROM (VALUES
    ('subscription_payments_pkey', 'p'::"char", 'PRIMARY KEY (id)'),
    ('subscription_payments_paystack_ref_key', 'u'::"char", 'UNIQUE (paystack_ref)'),
    ('subscription_payments_merchant_id_fkey', 'f'::"char", 'merchant_id REFERENCES public.merchants(id) ON DELETE CASCADE')
  ) expected(constraint_name, constraint_type, expected_description)
  LEFT JOIN pg_constraint constraint_row
    ON constraint_row.conrelid = to_regclass('public.subscription_payments')
   AND constraint_row.conname = expected.constraint_name
),
subscription_payment_browser_grant_check AS (
  SELECT
    'grant.browser.public.subscription_payments' AS check_name,
    'grant'::text AS object_type,
    'authenticated SELECT only; anon/PUBLIC none'::text AS expected,
    CASE
      WHEN to_regclass('public.subscription_payments') IS NULL THEN 'table missing'
      ELSE format(
        'authenticated_select=%s authenticated_write=%s anon_any=%s explicit_browser_grants=%s',
        has_table_privilege('authenticated', 'public.subscription_payments', 'SELECT'),
        has_table_privilege('authenticated', 'public.subscription_payments', 'INSERT,UPDATE,DELETE'),
        has_table_privilege('anon', 'public.subscription_payments', 'SELECT,INSERT,UPDATE,DELETE'),
        (SELECT count(*) FROM information_schema.role_table_grants grant_row
         WHERE grant_row.table_schema = 'public'
           AND grant_row.table_name = 'subscription_payments'
           AND grant_row.grantee IN ('PUBLIC', 'anon', 'authenticated'))
      )
    END AS actual,
    CASE
      WHEN to_regclass('public.subscription_payments') IS NOT NULL
       AND has_table_privilege('authenticated', 'public.subscription_payments', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'public.subscription_payments', 'INSERT,UPDATE,DELETE')
       AND NOT has_table_privilege('anon', 'public.subscription_payments', 'SELECT,INSERT,UPDATE,DELETE')
      THEN 'PASS' ELSE 'FAIL'
    END AS status,
    'Billing history is owner-readable through RLS; paid activation writes remain service-only.' AS details
)
SELECT check_name, object_type, expected, actual, status, details FROM table_checks
UNION ALL
SELECT check_name, object_type, expected, actual, status, details FROM column_checks
UNION ALL
SELECT check_name, object_type, expected, actual, status, details FROM rls_checks
UNION ALL
SELECT check_name, object_type, expected, actual, status, details FROM service_role_checks
UNION ALL
SELECT check_name, object_type, expected, actual, status, details FROM subscription_payment_column_contract_checks
UNION ALL
SELECT check_name, object_type, expected, actual, status, details FROM subscription_payment_constraint_checks
UNION ALL
SELECT check_name, object_type, expected, actual, status, details FROM subscription_payment_browser_grant_check
ORDER BY
  status,
  check_name;
