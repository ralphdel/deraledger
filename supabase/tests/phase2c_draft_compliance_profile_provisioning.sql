\set ON_ERROR_STOP on
\ir phase2c_b4p_local_target_gate.sql

-- Disposable rollback-only behavior matrix for M031/B4P. The target gate
-- above executes before any fixture mutation. All identities are synthetic.
BEGIN;

CREATE TEMP TABLE b4p_rehearsal_results (
  scenario text PRIMARY KEY,
  merchant_id uuid,
  result jsonb NOT NULL
);
GRANT SELECT, INSERT ON b4p_rehearsal_results TO service_role;

INSERT INTO auth.users (id)
VALUES ('b4b42000-0000-4000-8000-000000000001');

CREATE FUNCTION pg_temp.b4p_create_fixture(
  p_merchant_id uuid,
  p_workspace_id uuid,
  p_merchant_plan text,
  p_subscription_plan text,
  p_subscription_status text,
  p_owner_present boolean,
  p_workspace_present boolean,
  p_canonical_link_present boolean
) RETURNS void
LANGUAGE plpgsql
AS $fixture$
DECLARE
  v_owner_id uuid := CASE WHEN p_owner_present
    THEN 'b4b42000-0000-4000-8000-000000000001'::uuid ELSE NULL END;
  v_tier text := CASE
    WHEN p_merchant_plan IN ('business', 'corporate') THEN 'corporate'
    WHEN p_merchant_plan = 'starter' THEN 'starter'
    ELSE 'individual'
  END;
BEGIN
  INSERT INTO public.merchants (
    id, user_id, email, business_name, subscription_plan, merchant_tier
  ) VALUES (
    p_merchant_id,
    v_owner_id,
    p_merchant_id::text || '@example.invalid',
    'B4P synthetic rehearsal merchant',
    p_merchant_plan,
    v_tier
  );

  IF p_subscription_status IS NOT NULL THEN
    INSERT INTO public.subscriptions (
      merchant_id, plan_type, amount_paid, start_date, expiry_date, status
    ) VALUES (
      p_merchant_id,
      p_subscription_plan,
      CASE WHEN p_subscription_plan IN ('business', 'corporate') THEN 20000 ELSE 5000 END,
      now(), now() + interval '30 days', p_subscription_status
    );
  END IF;

  IF p_workspace_present THEN
    INSERT INTO public.workspaces (
      id, owner_user_id, merchant_id, workspace_type, display_name, plan_type,
      onboarding_status, setup_mode, live_features_enabled
    ) VALUES (
      p_workspace_id,
      v_owner_id,
      p_merchant_id,
      'business',
      'B4P synthetic rehearsal workspace',
      p_merchant_plan,
      'active',
      false,
      false
    );
  END IF;

  IF p_canonical_link_present THEN
    INSERT INTO public.merchant_canonical_workspaces (
      merchant_id, workspace_id, link_version, reconcile_idempotency_key, created_by
    ) VALUES (
      p_merchant_id,
      p_workspace_id,
      1,
      'phase2c-b4p-behavior-' || p_merchant_id::text,
      'b4b42000-0000-4000-8000-000000000001'
    );
  END IF;
END;
$fixture$;

-- Eligible create/replay paths and accepted aliases.
SELECT pg_temp.b4p_create_fixture('b4b42000-0000-4000-8000-000000001001', 'b4b42000-0000-4000-8000-000000002001', 'solo_lite', 'solo_lite', 'active', true, true, true);
SELECT pg_temp.b4p_create_fixture('b4b42000-0000-4000-8000-000000001002', 'b4b42000-0000-4000-8000-000000002002', 'individual', 'individual', 'active', true, true, true);
SELECT pg_temp.b4p_create_fixture('b4b42000-0000-4000-8000-000000001003', 'b4b42000-0000-4000-8000-000000002003', 'business', 'business', 'active', true, true, true);
SELECT pg_temp.b4p_create_fixture('b4b42000-0000-4000-8000-000000001004', 'b4b42000-0000-4000-8000-000000002004', 'corporate', 'corporate', 'active', true, true, true);

-- Rejected authority states.
SELECT pg_temp.b4p_create_fixture('b4b42000-0000-4000-8000-000000001005', NULL, 'starter', NULL, NULL, true, false, false);
SELECT pg_temp.b4p_create_fixture('b4b42000-0000-4000-8000-000000001006', NULL, 'solo_plus', NULL, NULL, true, false, false);
SELECT pg_temp.b4p_create_fixture('b4b42000-0000-4000-8000-000000001007', NULL, 'unsupported_plan', NULL, NULL, true, false, false);
SELECT pg_temp.b4p_create_fixture('b4b42000-0000-4000-8000-000000001008', NULL, 'individual', NULL, NULL, false, false, false);
SELECT pg_temp.b4p_create_fixture('b4b42000-0000-4000-8000-000000001009', 'b4b42000-0000-4000-8000-000000002009', 'individual', 'individual', 'inactive', true, true, true);
SELECT pg_temp.b4p_create_fixture('b4b42000-0000-4000-8000-000000001010', 'b4b42000-0000-4000-8000-000000002010', 'individual', 'business', 'active', true, true, true);
SELECT pg_temp.b4p_create_fixture('b4b42000-0000-4000-8000-000000001011', 'b4b42000-0000-4000-8000-000000002011', 'individual', 'individual', 'active', true, true, false);

-- A second merchant owns this workspace. The composite canonical-workspace FK
-- must reject any attempt to link it to merchant 1012.
SELECT pg_temp.b4p_create_fixture('b4b42000-0000-4000-8000-000000001012', NULL, 'individual', 'individual', 'active', true, false, false);
SELECT pg_temp.b4p_create_fixture('b4b42000-0000-4000-8000-000000001013', 'b4b42000-0000-4000-8000-000000002013', 'individual', 'individual', 'active', true, true, false);

-- Existing-profile safety fixtures.
SELECT pg_temp.b4p_create_fixture('b4b42000-0000-4000-8000-000000001014', 'b4b42000-0000-4000-8000-000000002014', 'individual', 'individual', 'active', true, true, true);
SELECT pg_temp.b4p_create_fixture('b4b42000-0000-4000-8000-000000001015', 'b4b42000-0000-4000-8000-000000002015', 'individual', 'individual', 'active', true, true, true);
SELECT pg_temp.b4p_create_fixture('b4b42000-0000-4000-8000-000000001016', 'b4b42000-0000-4000-8000-000000002016', 'individual', 'individual', 'active', true, true, true);
SELECT pg_temp.b4p_create_fixture('b4b42000-0000-4000-8000-000000001017', 'b4b42000-0000-4000-8000-000000002017', 'individual', 'individual', 'active', true, true, true);
SELECT pg_temp.b4p_create_fixture('b4b42000-0000-4000-8000-000000001018', 'b4b42000-0000-4000-8000-000000002018', 'individual', 'individual', 'active', true, true, true);
SELECT pg_temp.b4p_create_fixture('b4b42000-0000-4000-8000-000000001019', 'b4b42000-0000-4000-8000-000000002019', 'individual', 'individual', 'active', true, true, true);

INSERT INTO public.merchant_compliance_profiles (
  merchant_id, plan_code, compliance_status, activation_status, row_version
) VALUES
  ('b4b42000-0000-4000-8000-000000001014', 'solo_lite', 'draft', 'test_mode', 1),
  ('b4b42000-0000-4000-8000-000000001015', 'business', 'draft', 'test_mode', 1),
  ('b4b42000-0000-4000-8000-000000001016', 'solo_lite', 'lite_verified', 'approved', 2),
  ('b4b42000-0000-4000-8000-000000001017', 'solo_lite', 'draft', 'test_mode', 1),
  ('b4b42000-0000-4000-8000-000000001018', 'solo_lite', 'restricted', 'restricted', 3),
  ('b4b42000-0000-4000-8000-000000001019', 'solo_lite', 'rejected', 'needs_attention', 2);
UPDATE public.merchant_compliance_profiles
SET policy_version = 'synthetic-reviewed-provenance',
    decision_source_type = 'system_reconciliation',
    decision_source_id = 'b4b42000-0000-4000-8000-000000009017',
    decision_source_version = 1,
    last_reviewed_at = now(),
    reviewed_by = 'b4b42000-0000-4000-8000-000000000001'
WHERE merchant_id = 'b4b42000-0000-4000-8000-000000001017';
UPDATE public.merchant_compliance_profiles
SET restriction_state = 'restricted', restriction_reason_code = 'synthetic_test'
WHERE merchant_id = 'b4b42000-0000-4000-8000-000000001018';

CREATE TEMP TABLE b4p_authority_snapshot AS
SELECT
  m.id AS merchant_id,
  to_jsonb(m) AS merchant_row,
  COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.subscriptions s WHERE s.merchant_id = m.id), '[]'::jsonb) AS subscription_rows,
  COALESCE((SELECT jsonb_agg(to_jsonb(w) ORDER BY w.id) FROM public.workspaces w WHERE w.merchant_id = m.id), '[]'::jsonb) AS workspace_rows,
  COALESCE((SELECT jsonb_agg(to_jsonb(ws) ORDER BY ws.id) FROM public.workspace_subscriptions ws JOIN public.workspaces w ON w.id = ws.workspace_id WHERE w.merchant_id = m.id), '[]'::jsonb) AS workspace_subscription_rows,
  COALESCE((SELECT jsonb_agg(to_jsonb(cw) ORDER BY cw.merchant_id) FROM public.merchant_canonical_workspaces cw WHERE cw.merchant_id = m.id), '[]'::jsonb) AS canonical_rows
FROM public.merchants m
WHERE m.id::text LIKE 'b4b42000-0000-4000-8000-000000001%';

CREATE TEMP TABLE b4p_existing_profile_snapshot AS
SELECT merchant_id, to_jsonb(p) AS profile_row
FROM public.merchant_compliance_profiles p
WHERE p.merchant_id BETWEEN 'b4b42000-0000-4000-8000-000000001014'::uuid
  AND 'b4b42000-0000-4000-8000-000000001019'::uuid;

DO $cross_tenant_link_rejection$
BEGIN
  BEGIN
    INSERT INTO public.merchant_canonical_workspaces (
      merchant_id, workspace_id, link_version, reconcile_idempotency_key, created_by
    ) VALUES (
      'b4b42000-0000-4000-8000-000000001012',
      'b4b42000-0000-4000-8000-000000002013',
      1,
      'phase2c-b4p-cross-tenant-must-fail',
      'b4b42000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'B4P rehearsal failed: cross-tenant canonical link was accepted';
  EXCEPTION
    WHEN foreign_key_violation THEN
      INSERT INTO b4p_rehearsal_results(scenario, merchant_id, result)
      VALUES ('cross_tenant_link_constraint', 'b4b42000-0000-4000-8000-000000001012', '{"kind":"cross_tenant_link_rejected"}'::jsonb);
  END;
END;
$cross_tenant_link_rejection$;

SET LOCAL ROLE service_role;

INSERT INTO b4p_rehearsal_results(scenario, merchant_id, result) VALUES
  ('solo_lite_create', 'b4b42000-0000-4000-8000-000000001001', public.ensure_draft_compliance_profile_v1('b4b42000-0000-4000-8000-000000001001')),
  ('individual_alias', 'b4b42000-0000-4000-8000-000000001002', public.ensure_draft_compliance_profile_v1('b4b42000-0000-4000-8000-000000001002')),
  ('business_create', 'b4b42000-0000-4000-8000-000000001003', public.ensure_draft_compliance_profile_v1('b4b42000-0000-4000-8000-000000001003')),
  ('corporate_alias', 'b4b42000-0000-4000-8000-000000001004', public.ensure_draft_compliance_profile_v1('b4b42000-0000-4000-8000-000000001004')),
  ('starter_rejected', 'b4b42000-0000-4000-8000-000000001005', public.ensure_draft_compliance_profile_v1('b4b42000-0000-4000-8000-000000001005')),
  ('solo_plus_rejected', 'b4b42000-0000-4000-8000-000000001006', public.ensure_draft_compliance_profile_v1('b4b42000-0000-4000-8000-000000001006')),
  ('unknown_rejected', 'b4b42000-0000-4000-8000-000000001007', public.ensure_draft_compliance_profile_v1('b4b42000-0000-4000-8000-000000001007')),
  ('owner_required', 'b4b42000-0000-4000-8000-000000001008', public.ensure_draft_compliance_profile_v1('b4b42000-0000-4000-8000-000000001008')),
  ('subscription_inactive', 'b4b42000-0000-4000-8000-000000001009', public.ensure_draft_compliance_profile_v1('b4b42000-0000-4000-8000-000000001009')),
  ('subscription_mismatch', 'b4b42000-0000-4000-8000-000000001010', public.ensure_draft_compliance_profile_v1('b4b42000-0000-4000-8000-000000001010')),
  ('canonical_missing', 'b4b42000-0000-4000-8000-000000001011', public.ensure_draft_compliance_profile_v1('b4b42000-0000-4000-8000-000000001011')),
  ('cross_tenant_rpc_missing', 'b4b42000-0000-4000-8000-000000001012', public.ensure_draft_compliance_profile_v1('b4b42000-0000-4000-8000-000000001012')),
  ('existing_exact', 'b4b42000-0000-4000-8000-000000001014', public.ensure_draft_compliance_profile_v1('b4b42000-0000-4000-8000-000000001014')),
  ('existing_plan_mismatch', 'b4b42000-0000-4000-8000-000000001015', public.ensure_draft_compliance_profile_v1('b4b42000-0000-4000-8000-000000001015')),
  ('existing_stronger', 'b4b42000-0000-4000-8000-000000001016', public.ensure_draft_compliance_profile_v1('b4b42000-0000-4000-8000-000000001016')),
  ('existing_provenance', 'b4b42000-0000-4000-8000-000000001017', public.ensure_draft_compliance_profile_v1('b4b42000-0000-4000-8000-000000001017')),
  ('existing_restricted', 'b4b42000-0000-4000-8000-000000001018', public.ensure_draft_compliance_profile_v1('b4b42000-0000-4000-8000-000000001018')),
  ('existing_rejected', 'b4b42000-0000-4000-8000-000000001019', public.ensure_draft_compliance_profile_v1('b4b42000-0000-4000-8000-000000001019'));

-- Replays are separate statements so ordering is a tested property, not an
-- assumption about VALUES expression evaluation order.
INSERT INTO b4p_rehearsal_results(scenario, merchant_id, result) VALUES
  ('solo_lite_replay', 'b4b42000-0000-4000-8000-000000001001', public.ensure_draft_compliance_profile_v1('b4b42000-0000-4000-8000-000000001001')),
  ('business_replay', 'b4b42000-0000-4000-8000-000000001003', public.ensure_draft_compliance_profile_v1('b4b42000-0000-4000-8000-000000001003'));

RESET ROLE;

-- Inject one genuine unexpected database failure. The RPC must not translate
-- this trigger exception into a business-state JSON result.
SELECT pg_temp.b4p_create_fixture('b4b42000-0000-4000-8000-000000001020', 'b4b42000-0000-4000-8000-000000002020', 'individual', 'individual', 'active', true, true, true);
CREATE FUNCTION pg_temp.b4p_force_unexpected_failure() RETURNS trigger
LANGUAGE plpgsql AS $forced_failure$
BEGIN
  IF NEW.merchant_id = 'b4b42000-0000-4000-8000-000000001020'::uuid THEN
    RAISE EXCEPTION 'B4P_FORCED_UNEXPECTED_DATABASE_FAILURE';
  END IF;
  RETURN NEW;
END;
$forced_failure$;
CREATE TRIGGER b4p_force_unexpected_failure
BEFORE INSERT ON public.merchant_compliance_profiles
FOR EACH ROW EXECUTE FUNCTION pg_temp.b4p_force_unexpected_failure();

SET LOCAL ROLE service_role;
DO $forced_failure_assertion$
DECLARE
  v_result jsonb;
BEGIN
  BEGIN
    v_result := public.ensure_draft_compliance_profile_v1('b4b42000-0000-4000-8000-000000001020');
    RAISE EXCEPTION 'B4P rehearsal failed: forced database failure returned %', v_result;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'B4P_FORCED_UNEXPECTED_DATABASE_FAILURE' THEN
      RAISE;
    END IF;
    INSERT INTO b4p_rehearsal_results(scenario, merchant_id, result)
    VALUES ('unexpected_db_failure', 'b4b42000-0000-4000-8000-000000001020', '{"kind":"rpc_error_propagated"}'::jsonb);
  END;
END;
$forced_failure_assertion$;
RESET ROLE;
DROP TRIGGER b4p_force_unexpected_failure ON public.merchant_compliance_profiles;

DO $b4p_rehearsal_assertions$
DECLARE
  v_expected record;
BEGIN
  FOR v_expected IN
    SELECT * FROM (VALUES
      ('solo_lite_create', 'draft_profile_created'),
      ('solo_lite_replay', 'draft_profile_existing_exact'),
      ('individual_alias', 'draft_profile_created'),
      ('business_create', 'draft_profile_created'),
      ('business_replay', 'draft_profile_existing_exact'),
      ('corporate_alias', 'draft_profile_created'),
      ('starter_rejected', 'draft_profile_plan_not_eligible'),
      ('solo_plus_rejected', 'draft_profile_plan_not_eligible'),
      ('unknown_rejected', 'draft_profile_plan_not_eligible'),
      ('owner_required', 'draft_profile_owner_required'),
      ('subscription_inactive', 'draft_profile_subscription_inactive'),
      ('subscription_mismatch', 'draft_profile_subscription_plan_mismatch'),
      ('canonical_missing', 'draft_profile_canonical_workspace_missing'),
      ('cross_tenant_rpc_missing', 'draft_profile_canonical_workspace_missing'),
      ('existing_exact', 'draft_profile_existing_exact'),
      ('existing_plan_mismatch', 'draft_profile_existing_conflict'),
      ('existing_stronger', 'draft_profile_existing_conflict'),
      ('existing_provenance', 'draft_profile_existing_conflict'),
      ('existing_restricted', 'draft_profile_existing_conflict'),
      ('existing_rejected', 'draft_profile_existing_conflict'),
      ('cross_tenant_link_constraint', 'cross_tenant_link_rejected'),
      ('unexpected_db_failure', 'rpc_error_propagated')
    ) AS expected(scenario, expected_kind)
  LOOP
    IF (SELECT result->>'kind' FROM b4p_rehearsal_results WHERE scenario = v_expected.scenario)
      IS DISTINCT FROM v_expected.expected_kind THEN
      RAISE EXCEPTION 'B4P rehearsal failed: scenario % did not return %', v_expected.scenario, v_expected.expected_kind;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM b4p_rehearsal_results) <> 22 THEN
    RAISE EXCEPTION 'B4P rehearsal failed: behavior matrix result count mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.merchant_compliance_profiles p
    WHERE p.merchant_id IN (
      'b4b42000-0000-4000-8000-000000001001',
      'b4b42000-0000-4000-8000-000000001002',
      'b4b42000-0000-4000-8000-000000001003',
      'b4b42000-0000-4000-8000-000000001004',
      'b4b42000-0000-4000-8000-000000001014'
    ) AND (
      p.plan_code NOT IN ('solo_lite', 'business')
      OR p.compliance_status <> 'draft'
      OR p.activation_status <> 'test_mode'
      OR p.row_version <> 1
      OR p.business_type IS NOT NULL
      OR p.risk_rating IS NOT NULL
      OR p.restriction_state IS NOT NULL
      OR p.restriction_reason_code IS NOT NULL
      OR p.restriction_notes IS NOT NULL
      OR p.restriction_effective_at IS NOT NULL
      OR p.restriction_review_due_at IS NOT NULL
      OR p.collection_limit_basis IS NOT NULL
      OR p.approved_monthly_volume IS NOT NULL
      OR p.cumulative_collection_cap IS NOT NULL
      OR p.cumulative_collection_used IS NOT NULL
      OR p.hidden_daily_velocity_limit IS NOT NULL
      OR p.single_transaction_limit IS NOT NULL
      OR p.outstanding_receivable_cap IS NOT NULL
      OR p.collection_limit_approved
      OR p.limits_approved_at IS NOT NULL
      OR p.limits_approved_by IS NOT NULL
      OR p.can_collect_payments
      OR p.can_use_instant_sale
      OR p.can_use_receivable_sale
      OR p.can_use_storefront
      OR p.can_activate_settlement
      OR p.can_use_deposit_balance
      OR p.policy_version IS NOT NULL
      OR p.decision_source_type IS NOT NULL
      OR p.decision_source_id IS NOT NULL
      OR p.decision_source_version IS NOT NULL
      OR p.last_reviewed_at IS NOT NULL
      OR p.next_review_due_at IS NOT NULL
      OR p.reviewed_by IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION 'B4P rehearsal failed: created/existing exact profile is not fully inert';
  END IF;

  IF (SELECT plan_code FROM public.merchant_compliance_profiles WHERE merchant_id = 'b4b42000-0000-4000-8000-000000001002') <> 'solo_lite'
    OR (SELECT plan_code FROM public.merchant_compliance_profiles WHERE merchant_id = 'b4b42000-0000-4000-8000-000000001004') <> 'business' THEN
    RAISE EXCEPTION 'B4P rehearsal failed: plan alias normalization mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM b4p_existing_profile_snapshot before_state
    JOIN public.merchant_compliance_profiles after_state USING (merchant_id)
    WHERE before_state.profile_row IS DISTINCT FROM to_jsonb(after_state)
  ) OR (SELECT count(*) FROM b4p_existing_profile_snapshot) <> 6 THEN
    RAISE EXCEPTION 'B4P rehearsal failed: existing profile was overwritten';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM b4p_authority_snapshot before_state
    JOIN public.merchants m ON m.id = before_state.merchant_id
    WHERE before_state.merchant_row IS DISTINCT FROM to_jsonb(m)
      OR before_state.subscription_rows IS DISTINCT FROM COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.subscriptions s WHERE s.merchant_id = m.id), '[]'::jsonb)
      OR before_state.workspace_rows IS DISTINCT FROM COALESCE((SELECT jsonb_agg(to_jsonb(w) ORDER BY w.id) FROM public.workspaces w WHERE w.merchant_id = m.id), '[]'::jsonb)
      OR before_state.workspace_subscription_rows IS DISTINCT FROM COALESCE((SELECT jsonb_agg(to_jsonb(ws) ORDER BY ws.id) FROM public.workspace_subscriptions ws JOIN public.workspaces w ON w.id = ws.workspace_id WHERE w.merchant_id = m.id), '[]'::jsonb)
      OR before_state.canonical_rows IS DISTINCT FROM COALESCE((SELECT jsonb_agg(to_jsonb(cw) ORDER BY cw.merchant_id) FROM public.merchant_canonical_workspaces cw WHERE cw.merchant_id = m.id), '[]'::jsonb)
  ) THEN
    RAISE EXCEPTION 'B4P rehearsal failed: merchant/subscription/workspace authority state mutated';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.merchant_compliance_reviews
    WHERE merchant_id::text LIKE 'b4b42000-0000-4000-8000-000000001%'
  ) OR EXISTS (
    SELECT 1 FROM public.merchant_compliance_events
    WHERE merchant_id::text LIKE 'b4b42000-0000-4000-8000-000000001%'
  ) THEN
    RAISE EXCEPTION 'B4P rehearsal failed: review lifecycle rows were created';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.merchant_compliance_profiles
    WHERE merchant_id IN (
      'b4b42000-0000-4000-8000-000000001005',
      'b4b42000-0000-4000-8000-000000001006',
      'b4b42000-0000-4000-8000-000000001007',
      'b4b42000-0000-4000-8000-000000001008',
      'b4b42000-0000-4000-8000-000000001009',
      'b4b42000-0000-4000-8000-000000001010',
      'b4b42000-0000-4000-8000-000000001011',
      'b4b42000-0000-4000-8000-000000001012',
      'b4b42000-0000-4000-8000-000000001020'
    )
  ) THEN
    RAISE EXCEPTION 'B4P rehearsal failed: rejected/failed authority state created a profile';
  END IF;
END;
$b4p_rehearsal_assertions$;

SELECT 'M031_BEHAVIOR_REHEARSAL' AS check_group, 'PASS' AS result;

ROLLBACK;
