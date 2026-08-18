-- Read-only, SQL-Editor-compatible paid-flow schema contract check.
-- This script performs catalog reads only. It does not apply or repair schema.
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
    ('subscription_payments', 'merchant_id'),
    ('subscription_payments', 'plan'),
    ('subscription_payments', 'amount_ngn'),
    ('subscription_payments', 'period_start'),
    ('subscription_payments', 'period_end'),
    ('subscription_payments', 'paystack_ref'),
    ('subscription_payments', 'payment_type'),
    ('subscription_payments', 'status'),
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
    'RLS state inspected'::text AS expected,
    CASE
      WHEN cls.oid IS NULL THEN 'table missing'
      ELSE 'rls=' || cls.relrowsecurity::text || ' policies=' || COUNT(pol.policyname)::text
    END AS actual,
    CASE
      WHEN cls.oid IS NULL THEN 'FAIL'
      WHEN cls.relrowsecurity THEN 'PASS'
      ELSE 'WARN'
    END AS status,
    CASE
      WHEN cls.oid IS NULL THEN 'Required table is missing.'
      WHEN cls.relrowsecurity THEN 'RLS is enabled; review reported policy count against the canonical security package.'
      ELSE 'RLS is disabled; review before paid-flow production testing.'
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
    'service_role has table privilege'::text AS expected,
    CASE
      WHEN t.table_name IS NULL THEN 'table missing'
      WHEN has_table_privilege('service_role', format('public.%I', rt.table_name), 'SELECT')
       AND has_table_privilege('service_role', format('public.%I', rt.table_name), 'INSERT')
       AND has_table_privilege('service_role', format('public.%I', rt.table_name), 'UPDATE') THEN 'present'
      ELSE 'not confirmed'
    END AS actual,
    CASE
      WHEN t.table_name IS NULL THEN 'FAIL'
      WHEN has_table_privilege('service_role', format('public.%I', rt.table_name), 'SELECT')
       AND has_table_privilege('service_role', format('public.%I', rt.table_name), 'INSERT')
       AND has_table_privilege('service_role', format('public.%I', rt.table_name), 'UPDATE') THEN 'PASS'
      ELSE 'WARN'
    END AS status,
    'Read-only privilege inspection; this script does not alter grants.'::text AS details
  FROM required_tables rt
  LEFT JOIN information_schema.tables t
    ON t.table_schema = 'public' AND t.table_name = rt.table_name
)
SELECT check_name, object_type, expected, actual, status, details FROM table_checks
UNION ALL
SELECT check_name, object_type, expected, actual, status, details FROM column_checks
UNION ALL
SELECT check_name, object_type, expected, actual, status, details FROM rls_checks
UNION ALL
SELECT check_name, object_type, expected, actual, status, details FROM service_role_checks
ORDER BY
  CASE status WHEN 'FAIL' THEN 1 WHEN 'WARN' THEN 2 ELSE 3 END,
  check_name;
