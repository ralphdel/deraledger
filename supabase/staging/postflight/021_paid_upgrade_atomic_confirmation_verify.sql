-- Read-only SQL Editor postflight for Migration 021.
BEGIN;
SET TRANSACTION READ ONLY;

WITH rpc AS (
  SELECT p.oid, p.prosecdef, p.proconfig,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
    EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
      WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    ) AS public_execute
  FROM pg_proc p
  WHERE p.oid = to_regprocedure(
    'public.confirm_paid_upgrade_v1(uuid,text,text,text,bigint,text,text,jsonb,jsonb)'
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
), overloads AS (
  SELECT count(*) AS count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'confirm_paid_upgrade_v1'
), checks(check_name, object_type, expected, actual, status, details) AS (
  SELECT 'column.merchants.business_type', 'column', 'nullable text with no default',
    CASE WHEN actual_type IS NULL THEN 'missing'
      ELSE format('type=%s nullable=%s default=%s', actual_type, NOT attnotnull, COALESCE(actual_default, 'none')) END,
    CASE WHEN actual_type = 'text' AND NOT attnotnull AND actual_default IS NULL THEN 'PASS' ELSE 'FAIL' END,
    'Migration 021 must restore the canonical column without inventing or backfilling business meaning.'
  FROM merchant_activation_columns
  WHERE column_name = 'business_type'
  UNION ALL
  SELECT 'column.merchants.subscription_notifications_sent', 'column', 'nullable jsonb with empty-object default',
    CASE WHEN actual_type IS NULL THEN 'missing'
      ELSE format('type=%s nullable=%s default=%s', actual_type, NOT attnotnull, COALESCE(actual_default, 'none')) END,
    CASE WHEN actual_type = 'jsonb' AND NOT attnotnull AND actual_default = '''{}''::jsonb' THEN 'PASS' ELSE 'FAIL' END,
    'Migration 021 must restore the canonical notification-cycle state for future writes without backfilling rows.'
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
      WHEN oid IS NULL THEN 'Accepted final state: the RPC uses subscriptions.plan_type%TYPE and does not require the legacy enum.'
      WHEN type_kind = 'e'
        AND labels @> ARRAY['individual', 'corporate', 'starter']::text[] THEN 'Canonical historical enum remains compatible.'
      ELSE 'Invalid named type is unsafe even though Migration 021 does not rewrite it.'
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
    'The activation RPC derives its variable type from this column and performs no named enum cast.'
  FROM subscription_plan_column column_state
  CROSS JOIN legacy_plan_type legacy_state
  UNION ALL
  SELECT 'rpc.signature', 'function', 'one exact signature',
    format('exact=%s overloads=%s', (SELECT count(*) FROM rpc), (SELECT count FROM overloads)),
    CASE WHEN (SELECT count(*) FROM rpc) = 1 AND (SELECT count FROM overloads) = 1 THEN 'PASS' ELSE 'FAIL' END,
    'Unexpected overloads fail the postflight.'
  UNION ALL
  SELECT 'rpc.security', 'function security',
    'SECURITY DEFINER; search_path=public, pg_temp',
    COALESCE(format('prosecdef=%s proconfig=%s', prosecdef, proconfig::text), 'missing'),
    CASE WHEN prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] THEN 'PASS' ELSE 'FAIL' END,
    'The definer RPC must use a hardened fixed search path.'
  FROM rpc
  UNION ALL
  SELECT 'rpc.grants', 'function grants',
    'service_role=true; public/anon/authenticated=false',
    COALESCE(format('service=%s public=%s anon=%s authenticated=%s', service_execute, public_execute, anon_execute, authenticated_execute), 'missing'),
    CASE WHEN service_execute AND NOT public_execute AND NOT anon_execute AND NOT authenticated_execute THEN 'PASS' ELSE 'FAIL' END,
    'Only the trusted server service role may execute paid activation.'
  FROM rpc
  UNION ALL
  SELECT 'ledger.idempotency', 'constraint', 'unique subscription_payments.paystack_ref',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.subscription_payments'::regclass AND contype = 'u'
        AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.subscription_payments'::regclass AND attname = 'paystack_ref')]::smallint[]
    ) THEN 'present' ELSE 'missing' END,
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.subscription_payments'::regclass AND contype = 'u'
        AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.subscription_payments'::regclass AND attname = 'paystack_ref')]::smallint[]
    ) THEN 'PASS' ELSE 'FAIL' END,
    'The payment reference uniqueness constraint prevents duplicate ledger rows.'
)
SELECT check_name, object_type, expected, actual, status, details
FROM checks
ORDER BY CASE status WHEN 'FAIL' THEN 0 WHEN 'WARN' THEN 1 ELSE 2 END, check_name;

ROLLBACK;
