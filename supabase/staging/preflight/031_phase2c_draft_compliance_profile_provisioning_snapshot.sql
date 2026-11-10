\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

WITH required_relations(relation_name) AS (
  VALUES
    ('public.merchants'),
    ('public.subscriptions'),
    ('public.workspaces'),
    ('public.merchant_canonical_workspaces'),
    ('public.merchant_compliance_profiles'),
    ('public.merchant_compliance_reviews'),
    ('public.merchant_compliance_events')
), relation_state AS (
  SELECT relation_name, to_regclass(relation_name) IS NOT NULL AS present
  FROM required_relations
), rpc_state AS (
  SELECT
    count(*) FILTER (
      WHERE p.oid = to_regprocedure('public.ensure_draft_compliance_profile_v1(uuid)')
    ) AS exact_signature_count,
    count(*) AS same_name_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'ensure_draft_compliance_profile_v1'
), profile_contract AS (
  SELECT
    EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conrelid = to_regclass('public.merchant_compliance_profiles')
        AND c.conname = 'uq_merchant_compliance_profiles_merchant_id'
        AND c.contype = 'u'::"char"
        AND c.convalidated
    ) AS one_profile_per_merchant
)
SELECT
  'M031_PREFLIGHT' AS check_group,
  CASE
    WHEN bool_and(relation_state.present)
      AND (SELECT same_name_count IN (0, 1) FROM rpc_state)
      AND (SELECT exact_signature_count = same_name_count FROM rpc_state)
      AND (SELECT one_profile_per_merchant FROM profile_contract)
      AND to_regrole('service_role') IS NOT NULL
    THEN 'PASS'
    ELSE 'FAIL'
  END AS result,
  count(*) FILTER (WHERE NOT relation_state.present) AS missing_relation_count,
  (SELECT same_name_count FROM rpc_state) AS existing_rpc_count,
  (SELECT exact_signature_count FROM rpc_state) AS exact_rpc_count
FROM relation_state;

ROLLBACK;
