BEGIN READ ONLY;

SELECT
  'PASS' AS status,
  'database_identity' AS check_name,
  format(
    'db=%s user=%s version=%s search_path=%s',
    current_database(),
    current_user,
    regexp_replace(version(), '\s+', ' ', 'g'),
    current_setting('search_path')
  ) AS details;

WITH
  target AS (
    SELECT to_regclass('public.payment_events') AS relid
  ),
  column_manifest AS (
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'payment_events'
        AND column_name = 'merchant_id'
        AND udt_name = 'uuid'
        AND is_nullable = 'YES'
    ) AS merchant_id_nullable_uuid
  ),
  fk_manifest AS (
    SELECT bool_or(
      con.conname = 'payment_events_merchant_id_fkey'
      AND con.contype = 'f'
      AND ref_nsp.nspname = 'public'
      AND ref_cls.relname = 'merchants'
      AND con.confdeltype = 'c'
    ) AS merchant_fk_cascade
    FROM target
    LEFT JOIN pg_constraint con ON con.conrelid = target.relid
    LEFT JOIN pg_class ref_cls ON ref_cls.oid = con.confrelid
    LEFT JOIN pg_namespace ref_nsp ON ref_nsp.oid = ref_cls.relnamespace
  ),
  index_manifest AS (
    SELECT
      EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'payment_events' AND indexname = 'idx_payment_events_created_at') AS created_at_index_ok,
      EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'payment_events' AND indexname = 'idx_payment_events_payment_reference') AS reference_index_ok,
      EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'payment_events' AND indexname = 'idx_payment_events_processor_ref') AS processor_index_ok,
      EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'payment_events' AND indexname = 'idx_payment_events_idempotency') AS idempotency_index_ok
  ),
  data_manifest AS (
    SELECT
      count(*) FILTER (WHERE merchant_id IS NULL) AS ownerless_rows,
      count(*) FILTER (WHERE merchant_id IS NOT NULL) AS merchant_owned_rows
    FROM public.payment_events
  ),
  security_manifest AS (
    SELECT
      COALESCE((
        SELECT NOT c.relrowsecurity
        FROM pg_class c
        WHERE c.oid = (SELECT relid FROM target)
      ), false) AS rls_disabled,
      NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'payment_events'
      ) AS no_policies,
      NOT EXISTS (
        SELECT 1
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'payment_events'
          AND grantee IN ('PUBLIC', 'anon', 'authenticated')
      ) AS browser_grants_clear
  ),
  feature_manifest AS (
    SELECT NOT EXISTS (
      SELECT 1
      FROM public.platform_settings
      WHERE key IN (
        'solo_plus_enabled',
        'solo_plus_kyc_enabled',
        'breet_live_enabled',
        'breet_invoice_crypto_enabled',
        'breet_subscription_crypto_enabled',
        'breet_development_checkout_enabled',
        'breet_merchant_auto_settlement_enabled',
        'breet_platform_auto_settlement_enabled'
      )
        AND value <> 'false'
    ) AS protected_flags_disabled
  ),
  summary AS (
    SELECT
      target.relid IS NOT NULL AS table_exists,
      column_manifest.merchant_id_nullable_uuid,
      COALESCE(fk_manifest.merchant_fk_cascade, false) AS merchant_fk_cascade,
      index_manifest.created_at_index_ok,
      index_manifest.reference_index_ok,
      index_manifest.processor_index_ok,
      index_manifest.idempotency_index_ok,
      data_manifest.ownerless_rows,
      data_manifest.merchant_owned_rows,
      security_manifest.rls_disabled,
      security_manifest.no_policies,
      security_manifest.browser_grants_clear,
      feature_manifest.protected_flags_disabled
    FROM target
    CROSS JOIN column_manifest
    CROSS JOIN fk_manifest
    CROSS JOIN index_manifest
    CROSS JOIN data_manifest
    CROSS JOIN security_manifest
    CROSS JOIN feature_manifest
  )
SELECT
  CASE
    WHEN table_exists
      AND merchant_id_nullable_uuid
      AND merchant_fk_cascade
      AND created_at_index_ok
      AND reference_index_ok
      AND processor_index_ok
      AND idempotency_index_ok
      AND rls_disabled
      AND no_policies
      AND browser_grants_clear
      AND protected_flags_disabled
    THEN 'PASS'
    ELSE 'FAIL'
  END AS status,
  'payment_events_legacy_merchant_compatibility_postflight' AS check_name,
  format(
    'table=%s merchant_id_nullable_uuid=%s fk_cascade=%s indexes=%s/%s/%s/%s ownerless_rows=%s merchant_owned_rows=%s rls_disabled=%s no_policies=%s browser_grants_clear=%s protected_flags_disabled=%s',
    table_exists,
    merchant_id_nullable_uuid,
    merchant_fk_cascade,
    created_at_index_ok,
    reference_index_ok,
    processor_index_ok,
    idempotency_index_ok,
    ownerless_rows,
    merchant_owned_rows,
    rls_disabled,
    no_policies,
    browser_grants_clear,
    protected_flags_disabled
  ) AS details
FROM summary;

ROLLBACK;
