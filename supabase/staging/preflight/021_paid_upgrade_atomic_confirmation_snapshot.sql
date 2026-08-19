-- Read-only SQL Editor preflight for Migration 021.
BEGIN;
SET TRANSACTION READ ONLY;

WITH required_tables(table_name) AS (
  VALUES ('payment_records'), ('merchants'), ('workspaces'),
         ('workspace_subscriptions'), ('subscriptions'), ('subscription_payments')
), missing_tables AS (
  SELECT table_name FROM required_tables
  WHERE to_regclass('public.' || table_name) IS NULL
), required_columns(table_name, column_name) AS (
  VALUES
    ('payment_records','id'), ('payment_records','user_id'),
    ('payment_records','merchant_id'), ('payment_records','payment_purpose'),
    ('payment_records','provider_name'), ('payment_records','internal_reference'),
    ('payment_records','provider_reference'), ('payment_records','expected_amount'),
    ('payment_records','amount_paid'), ('payment_records','currency'),
    ('payment_records','payment_status'), ('payment_records','processing_status'),
    ('payment_records','account_setup_status'), ('payment_records','customer_email'),
    ('payment_records','plan_id'), ('payment_records','plan_name'),
    ('payment_records','metadata'), ('payment_records','raw_provider_payload'),
    ('payment_records','failure_reason'), ('payment_records','paid_at'),
    ('payment_records','updated_at'),
    ('merchants','id'), ('merchants','user_id'), ('merchants','email'),
    ('merchants','business_name'),
    ('merchants','subscription_plan'), ('merchants','merchant_tier'),
    ('merchants','monthly_collection_limit'),
    ('merchants','relationship_claim'), ('merchants','workspace_id'),
    ('merchants','onboarding_status'), ('merchants','setup_mode'),
    ('merchants','live_features_enabled'), ('merchants','paid_setup_started_at'),
    ('merchants','updated_at'),
    ('workspaces','id'), ('workspaces','owner_user_id'), ('workspaces','merchant_id'),
    ('workspaces','workspace_type'), ('workspaces','display_name'),
    ('workspaces','plan_type'), ('workspaces','onboarding_status'),
    ('workspaces','setup_mode'), ('workspaces','live_features_enabled'),
    ('workspaces','created_at'), ('workspaces','updated_at'),
    ('workspace_subscriptions','id'), ('workspace_subscriptions','workspace_id'),
    ('workspace_subscriptions','merchant_id'), ('workspace_subscriptions','plan_type'),
    ('workspace_subscriptions','subscription_status'),
    ('workspace_subscriptions','payment_reference'),
    ('workspace_subscriptions','amount_paid'), ('workspace_subscriptions','period_start'),
    ('workspace_subscriptions','period_end'), ('workspace_subscriptions','created_at'),
    ('workspace_subscriptions','updated_at'),
    ('subscriptions','merchant_id'), ('subscriptions','plan_type'),
    ('subscriptions','amount_paid'), ('subscriptions','start_date'),
    ('subscriptions','expiry_date'), ('subscriptions','status'),
    ('subscriptions','last_notified_at'), ('subscriptions','is_banner_dismissed'),
    ('subscriptions','updated_at'),
    ('subscription_payments','merchant_id'), ('subscription_payments','plan'),
    ('subscription_payments','amount_ngn'), ('subscription_payments','period_start'),
    ('subscription_payments','period_end'), ('subscription_payments','paystack_ref'),
    ('subscription_payments','payment_type'), ('subscription_payments','status')
), missing_columns AS (
  SELECT table_name || '.' || column_name AS object_name
  FROM required_columns
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = required_columns.table_name
      AND c.column_name = required_columns.column_name
  )
), merchant_activation_columns AS (
  SELECT expected.column_name,
    format_type(a.atttypid, a.atttypmod) AS actual_type,
    a.attnotnull,
    pg_get_expr(d.adbin, d.adrelid) AS actual_default
  FROM (VALUES
    ('business_type'),
    ('subscription_notifications_sent')
  ) AS expected(column_name)
  LEFT JOIN pg_attribute a
    ON a.attrelid = to_regclass('public.merchants')
   AND a.attname = expected.column_name
   AND a.attnum > 0
   AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d
    ON d.adrelid = a.attrelid AND d.adnum = a.attnum
), legacy_plan_type AS (
  SELECT type_row.oid,
    type_row.typtype::text AS type_kind,
    COALESCE((
      SELECT array_agg(enum_row.enumlabel::text ORDER BY enum_row.enumsortorder)
      FROM pg_enum enum_row
      WHERE enum_row.enumtypid = type_row.oid
    ), ARRAY[]::text[]) AS labels
  FROM (VALUES (1)) AS singleton(value)
  LEFT JOIN pg_namespace namespace_row
    ON namespace_row.nspname = 'public'
  LEFT JOIN pg_type type_row
    ON type_row.typnamespace = namespace_row.oid
   AND type_row.typname = 'subscription_plan_type'
), subscription_plan_column AS (
  SELECT attribute.atttypid AS type_oid,
    format_type(attribute.atttypid, attribute.atttypmod) AS formatted_type
  FROM (VALUES (1)) AS singleton(value)
  LEFT JOIN pg_attribute attribute
    ON attribute.attrelid = to_regclass('public.subscriptions')
   AND attribute.attname = 'plan_type'
   AND attribute.attnum > 0
   AND NOT attribute.attisdropped
), rpc_state AS (
  SELECT
    count(*) AS overload_count,
    count(*) FILTER (
      WHERE p.oid = to_regprocedure(
        'public.confirm_paid_upgrade_v1(uuid,text,text,text,bigint,text,text,jsonb,jsonb)'
      )
    ) AS exact_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'confirm_paid_upgrade_v1'
), checks(check_name, object_type, expected, actual, status, details) AS (
  SELECT 'prerequisite.tables', 'table set', 'all six activation tables exist',
    COALESCE((SELECT string_agg(table_name, ', ' ORDER BY table_name) FROM missing_tables), 'none missing'),
    CASE WHEN EXISTS (SELECT 1 FROM missing_tables) THEN 'FAIL' ELSE 'PASS' END,
    'Migration 021 creates no tables; missing tables are unsafe drift.'
  UNION ALL
  SELECT 'prerequisite.columns', 'column set', 'all activation columns exist',
    COALESCE((SELECT string_agg(object_name, ', ' ORDER BY object_name) FROM missing_columns), 'none missing'),
    CASE WHEN EXISTS (SELECT 1 FROM missing_columns) THEN 'FAIL' ELSE 'PASS' END,
    'Missing columns here are unsafe drift; the two canonical merchant drift columns are checked separately.'
  UNION ALL
  SELECT 'column.merchants.business_type', 'column',
    'nullable text with no default',
    CASE WHEN actual_type IS NULL THEN 'missing'
      ELSE format('type=%s nullable=%s default=%s', actual_type, NOT attnotnull, COALESCE(actual_default, 'none')) END,
    CASE
      WHEN actual_type IS NULL THEN 'WARN'
      WHEN actual_type = 'text' AND NOT attnotnull AND actual_default IS NULL THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN actual_type IS NULL THEN 'Migration 021 adds the canonical nullable column without backfilling business meaning.'
      WHEN actual_type = 'text' AND NOT attnotnull AND actual_default IS NULL THEN 'Canonical historical definition is present.'
      ELSE 'Incompatible existing definition cannot be repaired safely by Migration 021.'
    END
  FROM merchant_activation_columns
  WHERE column_name = 'business_type'
  UNION ALL
  SELECT 'column.merchants.subscription_notifications_sent', 'column',
    'nullable jsonb with empty-object default',
    CASE WHEN actual_type IS NULL THEN 'missing'
      ELSE format('type=%s nullable=%s default=%s', actual_type, NOT attnotnull, COALESCE(actual_default, 'none')) END,
    CASE
      WHEN actual_type IS NULL THEN 'WARN'
      WHEN actual_type = 'jsonb' AND NOT attnotnull
        AND (actual_default IS NULL OR actual_default = '''{}''::jsonb')
        THEN CASE WHEN actual_default IS NULL THEN 'WARN' ELSE 'PASS' END
      ELSE 'FAIL'
    END,
    CASE
      WHEN actual_type IS NULL THEN 'Migration 021 adds the canonical nullable jsonb column and future-write default without backfilling rows.'
      WHEN actual_type = 'jsonb' AND NOT attnotnull AND actual_default IS NULL THEN 'Migration 021 safely restores the canonical future-write default without rewriting rows.'
      WHEN actual_type = 'jsonb' AND NOT attnotnull AND actual_default = '''{}''::jsonb' THEN 'Canonical historical definition is present.'
      ELSE 'Incompatible existing definition cannot be repaired safely by Migration 021.'
    END
  FROM merchant_activation_columns
  WHERE column_name = 'subscription_notifications_sent'
  UNION ALL
  SELECT 'type.public.subscription_plan_type', 'type/enum',
    'absent, or enum including individual/corporate/starter',
    CASE WHEN oid IS NULL THEN 'missing'
      ELSE format('kind=%s labels=%s', type_kind, labels::text) END,
    CASE
      WHEN oid IS NULL THEN 'WARN'
      WHEN type_kind = 'e'
        AND labels @> ARRAY['individual', 'corporate', 'starter']::text[] THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN oid IS NULL THEN 'Accepted clean-production state: Migration 021 does not create the legacy enum or cast through it.'
      WHEN type_kind = 'e'
        AND labels @> ARRAY['individual', 'corporate', 'starter']::text[] THEN 'Canonical historical enum is compatible.'
      ELSE 'An existing invalid object with the canonical enum name is unsafe drift.'
    END
  FROM legacy_plan_type
  UNION ALL
  SELECT 'column.subscriptions.plan_type', 'column type',
    'text, or canonical public.subscription_plan_type',
    COALESCE(column_state.formatted_type, 'missing'),
    CASE
      WHEN column_state.formatted_type = 'text' THEN 'PASS'
      WHEN column_state.type_oid = legacy_state.oid
        AND legacy_state.type_kind = 'e'
        AND legacy_state.labels @> ARRAY['individual', 'corporate', 'starter']::text[] THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN column_state.formatted_type = 'text' THEN 'Clean-production text contract is supported through subscriptions.plan_type%TYPE.'
      WHEN column_state.type_oid = legacy_state.oid
        AND legacy_state.type_kind = 'e'
        AND legacy_state.labels @> ARRAY['individual', 'corporate', 'starter']::text[] THEN 'Historical enum-backed contract is supported through subscriptions.plan_type%TYPE.'
      ELSE 'Migration 021 does not convert or rewrite subscriptions.plan_type.'
    END
  FROM subscription_plan_column column_state
  CROSS JOIN legacy_plan_type legacy_state
  UNION ALL
  SELECT 'rpc.public.confirm_paid_upgrade_v1', 'function',
    'absent or one exact signature',
    format('overloads=%s exact=%s', overload_count, exact_count),
    CASE
      WHEN overload_count = 0 THEN 'WARN'
      WHEN overload_count = 1 AND exact_count = 1 THEN 'WARN'
      ELSE 'FAIL'
    END,
    CASE
      WHEN overload_count = 0 THEN 'Migration 021 will create the service-role-only RPC.'
      WHEN overload_count = 1 AND exact_count = 1 THEN 'Migration 021 will deliberately replace the exact RPC definition and privileges.'
      ELSE 'Unexpected overloads cannot be repaired safely.'
    END
  FROM rpc_state
)
SELECT check_name, object_type, expected, actual, status, details
FROM checks
ORDER BY CASE status WHEN 'FAIL' THEN 0 WHEN 'WARN' THEN 1 ELSE 2 END, check_name;

-- Stop on every FAIL. WARN for compatible merchant-column drift, an absent
-- unused legacy enum, and the absent/exact RPC is expected. Migration 021 does
-- not create or convert subscription_plan_type.
ROLLBACK;
