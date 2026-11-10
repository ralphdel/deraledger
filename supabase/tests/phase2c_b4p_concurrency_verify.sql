\set ON_ERROR_STOP on
\ir phase2c_b4p_local_target_gate.sql

BEGIN TRANSACTION READ ONLY;

WITH result_state AS (
  SELECT
    count(*) AS result_count,
    count(*) FILTER (WHERE result->>'kind' = 'draft_profile_created') AS created_count,
    count(*) FILTER (WHERE result->>'kind' = 'draft_profile_existing_exact') AS replay_count
  FROM phase2c_b4p_rehearsal.results
), profile_state AS (
  SELECT
    count(*) AS profile_count,
    bool_and(
      plan_code = 'solo_lite'
      AND compliance_status = 'draft'
      AND activation_status = 'test_mode'
      AND row_version = 1
      AND NOT collection_limit_approved
      AND NOT can_collect_payments
      AND NOT can_use_instant_sale
      AND NOT can_use_receivable_sale
      AND NOT can_use_storefront
      AND NOT can_activate_settlement
      AND NOT can_use_deposit_balance
      AND policy_version IS NULL
      AND decision_source_type IS NULL
      AND decision_source_id IS NULL
      AND decision_source_version IS NULL
      AND last_reviewed_at IS NULL
      AND next_review_due_at IS NULL
      AND reviewed_by IS NULL
      AND risk_rating IS NULL
      AND restriction_state IS NULL
      AND collection_limit_basis IS NULL
      AND approved_monthly_volume IS NULL
      AND cumulative_collection_cap IS NULL
      AND cumulative_collection_used IS NULL
      AND hidden_daily_velocity_limit IS NULL
      AND single_transaction_limit IS NULL
      AND outstanding_receivable_cap IS NULL
    ) AS inert
  FROM public.merchant_compliance_profiles
  WHERE merchant_id = 'b4b40000-0000-4000-8000-000000000002'
), lifecycle_state AS (
  SELECT
    (SELECT count(*) FROM public.merchant_compliance_reviews
      WHERE merchant_id = 'b4b40000-0000-4000-8000-000000000002') AS review_count,
    (SELECT count(*) FROM public.merchant_compliance_events
      WHERE merchant_id = 'b4b40000-0000-4000-8000-000000000002') AS event_count
), barrier_state AS (
  SELECT
    count(*) = 1
      AND bool_and(worker_a_ready_observed)
      AND bool_and(worker_b_blocked_observed)
      AND bool_and(release_worker_a)
      AND bool_and(released_at IS NOT NULL) AS overlap_proven
  FROM phase2c_b4p_rehearsal.barrier
), authority_state AS (
  SELECT
    (SELECT count(*) FROM public.merchants
      WHERE id = 'b4b40000-0000-4000-8000-000000000002'
        AND subscription_plan = 'individual'
        AND merchant_tier = 'individual') = 1
    AND (SELECT count(*) FROM public.subscriptions
      WHERE merchant_id = 'b4b40000-0000-4000-8000-000000000002'
        AND plan_type = 'solo_lite' AND status = 'active' AND amount_paid = 5000) = 1
    AND (SELECT count(*) FROM public.workspaces
      WHERE id = 'b4b40000-0000-4000-8000-000000000003'
        AND merchant_id = 'b4b40000-0000-4000-8000-000000000002'
        AND NOT live_features_enabled) = 1
    AND (SELECT count(*) FROM public.merchant_canonical_workspaces
      WHERE merchant_id = 'b4b40000-0000-4000-8000-000000000002'
        AND workspace_id = 'b4b40000-0000-4000-8000-000000000003') = 1
    AND (SELECT count(*) FROM public.workspace_subscriptions
      WHERE workspace_id = 'b4b40000-0000-4000-8000-000000000003') = 0
      AS unchanged
)
SELECT
  'M031_CONCURRENCY' AS check_group,
  CASE
    WHEN result_state.result_count = 2
      AND result_state.created_count = 1
      AND result_state.replay_count = 1
      AND profile_state.profile_count = 1
      AND profile_state.inert
      AND lifecycle_state.review_count = 0
      AND lifecycle_state.event_count = 0
      AND barrier_state.overlap_proven
      AND authority_state.unchanged
    THEN 'PASS'
    ELSE 'FAIL'
  END AS result,
  result_state.*,
  profile_state.profile_count,
  barrier_state.overlap_proven,
  authority_state.unchanged AS authority_state_unchanged,
  lifecycle_state.review_count,
  lifecycle_state.event_count
FROM result_state, profile_state, lifecycle_state, barrier_state, authority_state;

ROLLBACK;
