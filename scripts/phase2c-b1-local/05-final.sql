\set ON_ERROR_STOP on
DO $final$
DECLARE
  v_review_count integer;
  v_event_count integer;
  v_submission_event_count integer;
BEGIN
  SELECT count(*) INTO v_review_count FROM public.merchant_compliance_reviews;
  SELECT count(*) INTO v_event_count FROM public.merchant_compliance_events;
  SELECT count(*) INTO v_submission_event_count FROM public.merchant_compliance_events
    WHERE event_type='phase2c_draft_review_submit_v1';
  -- Two historical reviews + five behavior submissions + three B1 races + one mixed B1.
  -- Submission events exclude the two historical reviews; one extra event is the mixed writer probe.
  IF v_review_count<>11 OR v_event_count<>10 OR v_submission_event_count<>9 THEN
    RAISE EXCEPTION 'FINAL_PERSISTENCE_COUNT:expected_reviews=11:actual_reviews=%:expected_events=10:actual_events=%:expected_submissions=9:actual_submissions=%',
      v_review_count,v_event_count,v_submission_event_count;
  END IF;
  IF EXISTS (SELECT 1 FROM public.merchant_compliance_profiles
    WHERE compliance_status<>'draft' OR activation_status<>'test_mode' OR policy_version IS NOT NULL
      OR decision_source_type IS NOT NULL OR decision_source_id IS NOT NULL OR decision_source_version IS NOT NULL
      OR row_version<>1 OR can_collect_payments OR can_use_instant_sale OR can_use_receivable_sale
      OR can_use_storefront OR can_activate_settlement OR can_use_deposit_balance) THEN
    RAISE EXCEPTION 'FINAL_NON_ADOPTION_VIOLATION:profile';
  END IF;
  IF EXISTS (SELECT 1 FROM public.workspaces
    WHERE onboarding_status<>'setup_mode' OR NOT setup_mode OR live_features_enabled) THEN
    RAISE EXCEPTION 'FINAL_NON_ADOPTION_VIOLATION:workspace';
  END IF;
  IF EXISTS (SELECT 1 FROM public.merchants merchant_row
    WHERE merchant_row.subscription_plan IS DISTINCT FROM
      CASE (((right(merchant_row.id::text,12))::integer-1)%7)+1
        WHEN 1 THEN 'solo_lite' WHEN 2 THEN 'individual' WHEN 3 THEN 'business'
        WHEN 4 THEN 'corporate' WHEN 5 THEN 'starter' WHEN 6 THEN 'solo_plus'
        ELSE 'unknown_plan' END) THEN
    RAISE EXCEPTION 'FINAL_NON_ADOPTION_VIOLATION:commercial_plan';
  END IF;
  IF EXISTS (SELECT 1 FROM public.merchant_compliance_reviews review_row
    LEFT JOIN public.merchant_compliance_events event_row
      ON event_row.merchant_id=review_row.merchant_id AND event_row.source_id=review_row.id
      AND event_row.event_type='phase2c_draft_review_submit_v1'
    WHERE review_row.idempotency_key NOT LIKE 'legacy-%' AND event_row.id IS NULL) THEN
    RAISE EXCEPTION 'FINAL_REVIEW_WITHOUT_EVENT'; END IF;
  IF EXISTS (SELECT 1 FROM public.merchant_compliance_events event_row
    LEFT JOIN public.merchant_compliance_reviews review_row ON review_row.id=event_row.source_id
    LEFT JOIN public.merchant_compliance_profiles profile_row ON profile_row.id=event_row.profile_id
    LEFT JOIN public.merchants merchant_row ON merchant_row.id=event_row.merchant_id
    LEFT JOIN public.merchant_canonical_workspaces workspace_row ON workspace_row.merchant_id=event_row.merchant_id
    WHERE event_row.event_type='phase2c_draft_review_submit_v1' AND (
      review_row.id IS NULL OR profile_row.id IS NULL OR merchant_row.id IS NULL OR workspace_row.merchant_id IS NULL
      OR review_row.merchant_id IS DISTINCT FROM event_row.merchant_id
      OR review_row.profile_id IS DISTINCT FROM event_row.profile_id
      OR review_row.row_version IS DISTINCT FROM event_row.resulting_row_version
      OR review_row.row_version<>1 OR review_row.policy_version IS DISTINCT FROM event_row.policy_version
      OR review_row.policy_version<>'2c-2b-draft-v1'
      OR review_row.submitted_at IS NULL OR review_row.reviewed_at IS NOT NULL OR review_row.reviewed_by IS NOT NULL
      OR review_row.review_status NOT IN ('pending','needs_attention')
      OR review_row.decision_reason_code IS NOT NULL
      OR (review_row.review_status='needs_attention' AND review_row.idempotency_key<>'behavior-lite-0001')
      OR (review_row.decision_notes IS NOT NULL AND review_row.idempotency_key<>'behavior-lite-0001')
      OR event_row.actor_type<>'merchant' OR event_row.actor_id IS DISTINCT FROM merchant_row.user_id
      OR event_row.reason_code IS NOT NULL OR event_row.expected_row_version IS NOT NULL
      OR event_row.source_type IS DISTINCT FROM CASE review_row.review_type
        WHEN 'solo_lite' THEN 'solo_lite_review' ELSE 'business_kyb_review' END
      OR event_row.from_state<>'{}'::jsonb OR event_row.to_state<>'{"review_status":"pending"}'::jsonb
      OR event_row.metadata->>'workspace_id' IS DISTINCT FROM workspace_row.workspace_id::text
      OR event_row.metadata->>'profile_row_version' IS DISTINCT FROM '1'
      OR event_row.metadata->>'policy_id' IS DISTINCT FROM review_row.evidence_snapshot->>'policyId'
      OR event_row.metadata->>'evidence_trust' IS DISTINCT FROM 'unverified_diagnostic'
      OR event_row.metadata->>'snapshot_sha256' IS DISTINCT FROM
        encode(sha256(convert_to(review_row.evidence_snapshot::text,'UTF8')),'hex'))
  ) THEN RAISE EXCEPTION 'FINAL_SUBMISSION_EVENT_COHERENCE'; END IF;
  IF (SELECT count(*) FROM public.merchant_compliance_reviews WHERE review_status='needs_attention')<>2
    OR (SELECT count(*) FROM public.merchant_compliance_reviews WHERE review_status='pending')<>9
    OR EXISTS (SELECT 1 FROM public.merchant_compliance_reviews WHERE review_status NOT IN ('pending','needs_attention')) THEN
    RAISE EXCEPTION 'FINAL_REVIEW_STATUS:expected_pending=9:expected_needs_attention=2'; END IF;
  IF (SELECT count(*) FROM public.merchant_compliance_reviews WHERE merchant_id='20000000-0000-4000-8000-000000000015') <> 1 THEN
    RAISE EXCEPTION 'CONCURRENCY_IDENTICAL_COUNT'; END IF;
  IF (SELECT count(*) FROM public.merchant_compliance_reviews WHERE merchant_id='20000000-0000-4000-8000-000000000016') <> 1 THEN
    RAISE EXCEPTION 'CONCURRENCY_CHANGED_PAYLOAD_COUNT'; END IF;
  IF (SELECT count(*) FROM public.merchant_compliance_reviews WHERE merchant_id='20000000-0000-4000-8000-000000000017') <> 1 THEN
    RAISE EXCEPTION 'CONCURRENCY_DIFFERENT_KEY_COUNT'; END IF;
  IF (SELECT count(*) FROM public.merchant_compliance_reviews WHERE merchant_id='20000000-0000-4000-8000-000000000018') <> 1 THEN
    RAISE EXCEPTION 'MIXED_WRITER_B1_COUNT'; END IF;
END;
$final$;
SELECT 'PASS|final_persistence_and_non_adoption' AS result;
