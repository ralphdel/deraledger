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
  relation_manifest AS (
    SELECT
      relid IS NOT NULL AS table_exists,
      COALESCE((
        SELECT c.relkind = 'r'
        FROM pg_class c
        WHERE c.oid = relid
      ), false) AS ordinary_table_ok
    FROM target
  ),
  column_manifest AS (
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payment_events'
          AND column_name = 'merchant_id'
          AND udt_name = 'uuid'
      ) AS merchant_id_uuid_ok,
      COALESCE((
        SELECT is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payment_events'
          AND column_name = 'merchant_id'
      ), 'missing') AS merchant_id_nullable_state
  ),
  fk_manifest AS (
    SELECT
      count(*) FILTER (WHERE con.conname = 'payment_events_merchant_id_fkey') AS named_fk_count,
      bool_or(
        con.conname = 'payment_events_merchant_id_fkey'
        AND con.contype = 'f'
        AND ref_nsp.nspname = 'public'
        AND ref_cls.relname = 'merchants'
        AND con.confdeltype IN ('a', 'r', 'c', 'n')
      ) AS merchant_fk_repairable,
      bool_or(
        con.conname = 'payment_events_merchant_id_fkey'
        AND con.confdeltype = 'c'
      ) AS merchant_fk_cascade
    FROM target
    LEFT JOIN pg_constraint con ON con.conrelid = target.relid
    LEFT JOIN pg_class ref_cls ON ref_cls.oid = con.confrelid
    LEFT JOIN pg_namespace ref_nsp ON ref_nsp.oid = ref_cls.relnamespace
  ),
  data_manifest AS (
    SELECT
      COALESCE((
        SELECT count(*)
        FROM public.payment_events
        WHERE merchant_id IS NULL
      ), 0) AS historical_ownerless_rows
    WHERE (SELECT relid IS NOT NULL FROM target)
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
      relation_manifest.table_exists,
      relation_manifest.ordinary_table_ok,
      column_manifest.merchant_id_uuid_ok,
      column_manifest.merchant_id_nullable_state,
      fk_manifest.named_fk_count,
      COALESCE(fk_manifest.merchant_fk_repairable, false) AS merchant_fk_repairable,
      COALESCE(fk_manifest.merchant_fk_cascade, false) AS merchant_fk_cascade,
      COALESCE(data_manifest.historical_ownerless_rows, 0) AS historical_ownerless_rows,
      security_manifest.rls_disabled,
      security_manifest.no_policies,
      security_manifest.browser_grants_clear,
      feature_manifest.protected_flags_disabled
    FROM relation_manifest
    CROSS JOIN column_manifest
    CROSS JOIN fk_manifest
    CROSS JOIN data_manifest
    CROSS JOIN security_manifest
    CROSS JOIN feature_manifest
  )
SELECT
  CASE
    WHEN table_exists
      AND ordinary_table_ok
      AND merchant_id_uuid_ok
      AND named_fk_count = 1
      AND merchant_fk_repairable
      AND protected_flags_disabled
    THEN 'PASS'
    ELSE 'FAIL'
  END AS status,
  'payment_events_legacy_merchant_compatibility_preflight' AS check_name,
  format(
    'table=%s relkind=%s merchant_id_uuid=%s merchant_id_nullable=%s fk_count=%s fk_repairable=%s fk_cascade=%s null_rows=%s rls_disabled=%s no_policies=%s browser_grants_clear=%s protected_flags_disabled=%s',
    table_exists,
    ordinary_table_ok,
    merchant_id_uuid_ok,
    merchant_id_nullable_state,
    named_fk_count,
    merchant_fk_repairable,
    merchant_fk_cascade,
    historical_ownerless_rows,
    rls_disabled,
    no_policies,
    browser_grants_clear,
    protected_flags_disabled
  ) AS details
FROM summary;

ROLLBACK;
