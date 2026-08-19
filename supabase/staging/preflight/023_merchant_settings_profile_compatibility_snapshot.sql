-- Read-only SQL Editor preflight for Migration 023.
-- This audits the complete merchant-column contract used by Settings,
-- Business Profile, dashboard profile gates, and verification profile flows.

BEGIN;
SET TRANSACTION READ ONLY;

WITH expected_columns(
  column_name,
  formatted_type,
  expected_not_null,
  repairable_by_023,
  allow_not_null,
  allowed_defaults
) AS (
  VALUES
    ('id'::text, 'uuid'::text, true, false, true, NULL::text[]),
    ('user_id', 'uuid', false, false, false, NULL),
    ('business_name', 'text', true, false, true, NULL),
    ('email', 'text', true, false, true, NULL),
    ('phone', 'text', false, false, false, NULL),
    ('logo_url', 'text', false, false, false, NULL),
    ('fee_absorption_default', 'text', true, false, true, NULL),
    ('verification_status', 'text', true, false, true, NULL),
    ('merchant_tier', 'text', true, false, true, NULL),
    ('subscription_plan', 'text', true, false, true, NULL),
    ('kyc_submitted_at', 'timestamp with time zone', false, false, false, NULL),
    ('kyc_notes', 'text', false, false, false, NULL),
    ('monthly_collection_limit', 'numeric(12,2)', true, false, true, NULL),
    ('holds_pending_review', 'boolean', true, false, true, NULL),
    ('created_at', 'timestamp with time zone', true, false, true, NULL),
    ('updated_at', 'timestamp with time zone', true, false, true, NULL),
    ('workspace_id', 'uuid', false, false, false, NULL),
    ('onboarding_status', 'text', false, false, false, NULL),
    ('setup_mode', 'boolean', true, false, true, NULL),
    ('live_features_enabled', 'boolean', false, false, false, NULL),
    ('verification_disclosure_acknowledged_at', 'timestamp with time zone', false, false, false, NULL),
    ('verification_disclosure_version', 'text', false, false, false, NULL),
    ('relationship_claim', 'text', false, false, false, NULL),
    ('paid_setup_started_at', 'timestamp with time zone', false, false, false, NULL),
    ('live_features_activated_at', 'timestamp with time zone', false, false, false, NULL),
    ('is_super_admin', 'boolean', true, false, true, NULL),
    ('business_type', 'text', false, false, false, NULL),
    ('business_street', 'text', false, false, false, NULL),
    ('business_city', 'text', false, false, false, NULL),
    ('business_state', 'text', false, false, false, NULL),
    ('business_country', 'text', false, false, false, NULL),
    ('trading_name', 'text', false, true, false, ARRAY['<NULL>']::text[]),
    ('owner_name', 'text', false, true, false, ARRAY['<NULL>']::text[]),
    ('platform_version', 'integer', false, true, false, ARRAY['<NULL>', '0', '0::integer', '''0''::integer']::text[]),
    ('cac_number', 'text', false, true, false, ARRAY['<NULL>']::text[]),
    ('bvn', 'text', false, true, false, ARRAY['<NULL>']::text[]),
    ('cac_document_url', 'text', false, true, false, ARRAY['<NULL>']::text[]),
    ('utility_document_url', 'text', false, true, false, ARRAY['<NULL>']::text[]),
    ('cac_status', 'text', false, true, false, ARRAY['<NULL>', '''unverified''::text']::text[]),
    ('utility_status', 'text', false, true, false, ARRAY['<NULL>', '''unverified''::text']::text[]),
    ('bvn_status', 'text', false, true, false, ARRAY['<NULL>', '''unverified''::text']::text[]),
    ('selfie_url', 'text', false, true, false, ARRAY['<NULL>']::text[]),
    ('selfie_status', 'text', false, true, true, ARRAY['<NULL>', '''unverified''::text']::text[]),
    ('dojah_reference', 'text', false, true, false, ARRAY['<NULL>']::text[]),
    ('dojah_match_score', 'numeric(5,2)', false, true, false, ARRAY['<NULL>']::text[]),
    ('kyc_attempt_count', 'integer', false, true, true, ARRAY['<NULL>', '0', '0::integer', '''0''::integer']::text[]),
    ('kyc_last_attempt_at', 'timestamp with time zone', false, true, false, ARRAY['<NULL>']::text[]),
    ('kyc_provider_metadata', 'jsonb', false, true, true, ARRAY['<NULL>', '''{}''::jsonb']::text[]),
    ('kyc_locked_until', 'timestamp with time zone', false, true, false, ARRAY['<NULL>']::text[]),
    ('kyc_rejection_reason', 'text', false, true, false, ARRAY['<NULL>']::text[]),
    ('kyc_reviewed_at', 'timestamp with time zone', false, true, false, ARRAY['<NULL>']::text[]),
    ('kyc_reset_at', 'timestamp with time zone', false, true, false, ARRAY['<NULL>']::text[]),
    ('verification_step_state', 'jsonb', false, true, true, ARRAY['<NULL>', '''{}''::jsonb']::text[]),
    ('business_registry_snapshot_id', 'uuid', false, true, false, ARRAY['<NULL>']::text[]),
    ('business_affiliation_status', 'text', false, true, false, ARRAY['<NULL>', '''not_started''::text']::text[]),
    ('settlement_bank_name', 'text', false, true, false, ARRAY['<NULL>']::text[]),
    ('settlement_account_number', 'text', false, true, false, ARRAY['<NULL>']::text[]),
    ('settlement_account_name', 'text', false, true, false, ARRAY['<NULL>']::text[])
), relation_state AS (
  SELECT
    to_regclass('public.merchants') AS relation_oid,
    relation.relkind,
    relation.relrowsecurity,
    relation.relacl
  FROM (VALUES (1)) AS seed(value)
  LEFT JOIN pg_class relation
    ON relation.oid = to_regclass('public.merchants')
), column_state AS (
  SELECT
    expected.*,
    format_type(attribute.atttypid, attribute.atttypmod) AS actual_type,
    attribute.attnotnull AS actual_not_null,
    pg_get_expr(default_value.adbin, default_value.adrelid, true) AS actual_default
  FROM expected_columns expected
  CROSS JOIN relation_state relation
  LEFT JOIN pg_attribute attribute
    ON attribute.attrelid = relation.relation_oid
   AND attribute.attname = expected.column_name
   AND attribute.attnum > 0
   AND NOT attribute.attisdropped
  LEFT JOIN pg_attrdef default_value
    ON default_value.adrelid = attribute.attrelid
   AND default_value.adnum = attribute.attnum
), checks AS (
  SELECT
    'table.public.merchants'::text AS check_name,
    'table'::text AS object_type,
    'existing ordinary table'::text AS expected,
    CASE
      WHEN relation_oid IS NULL THEN 'missing'
      ELSE format('oid=%s relkind=%s', relation_oid, relkind)
    END AS actual,
    CASE WHEN relation_oid IS NOT NULL AND relkind = 'r' THEN 'PASS' ELSE 'FAIL' END AS status,
    'Migration 023 requires the existing merchants table and does not replace it.'::text AS details
  FROM relation_state

  UNION ALL

  SELECT
    'column.public.merchants.' || column_name,
    'column',
    format(
      '%s; %s%s',
      formatted_type,
      CASE
        WHEN repairable_by_023 AND allow_not_null THEN 'nullable or historical NOT NULL with a safe default'
        WHEN expected_not_null THEN 'not null'
        ELSE 'nullable'
      END,
      CASE WHEN repairable_by_023 THEN '; Migration 023 compatible defaults only' ELSE '' END
    ),
    CASE
      WHEN actual_type IS NULL THEN 'missing'
      ELSE format(
        'type=%s nullable=%s default=%s',
        actual_type,
        NOT actual_not_null,
        COALESCE(actual_default, '<NULL>')
      )
    END,
    CASE
      WHEN actual_type IS NULL THEN CASE WHEN repairable_by_023 THEN 'WARN' ELSE 'FAIL' END
      WHEN actual_type <> formatted_type THEN 'FAIL'
      WHEN repairable_by_023 AND actual_not_null AND NOT allow_not_null THEN 'FAIL'
      WHEN repairable_by_023 AND actual_not_null AND actual_default IS NULL THEN 'FAIL'
      WHEN repairable_by_023 AND NOT (COALESCE(actual_default, '<NULL>') = ANY (allowed_defaults)) THEN 'FAIL'
      WHEN NOT repairable_by_023 AND actual_not_null <> expected_not_null THEN 'FAIL'
      ELSE 'PASS'
    END,
    CASE
      WHEN actual_type IS NULL AND repairable_by_023 THEN 'Migration 023 will add the canonical nullable column without backfilling existing rows.'
      WHEN actual_type IS NULL THEN 'This prerequisite belongs to the already-applied clean-production contract; Migration 023 does not replace it.'
      WHEN actual_type <> formatted_type THEN 'Migration 023 does not rewrite incompatible existing column types.'
      WHEN repairable_by_023 AND actual_not_null AND NOT allow_not_null THEN 'The historical profile contract requires this field to remain nullable.'
      WHEN repairable_by_023 AND actual_not_null AND actual_default IS NULL THEN 'A NOT NULL field without a safe default could break merchant creation.'
      WHEN repairable_by_023 AND NOT (COALESCE(actual_default, '<NULL>') = ANY (allowed_defaults)) THEN 'The existing default is outside the canonical fail-closed profile contract.'
      WHEN NOT repairable_by_023 AND actual_not_null <> expected_not_null THEN 'The clean-production prerequisite has unexpected nullability.'
      ELSE 'The existing column is compatible.'
    END
  FROM column_state

  UNION ALL

  SELECT
    'security.public.merchants',
    'rls/policy/grant',
    'observed only; unchanged by Migration 023',
    format(
      'rls=%s policies=%s grants=%s',
      COALESCE(relrowsecurity, false),
      (SELECT count(*) FROM pg_policy WHERE polrelid = relation_oid),
      COALESCE(array_to_string(relacl, ', '), '<default privileges>')
    ),
    'PASS',
    'Migration 023 adds nullable columns only and does not change existing RLS policies or grants.'
  FROM relation_state
)
SELECT check_name, object_type, expected, actual, status, details
FROM checks
ORDER BY CASE status WHEN 'FAIL' THEN 0 WHEN 'WARN' THEN 1 ELSE 2 END, check_name;

-- Stop on every FAIL. WARN is expected only for missing columns explicitly
-- marked repairable by Migration 023.
ROLLBACK;
