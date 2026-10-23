\set ON_ERROR_STOP on
DO $final$
DECLARE v_case record;
BEGIN
  FOR v_case IN SELECT * FROM public.b2_rehearsal_cases LOOP
    IF (SELECT count(*) FROM public.merchant_compliance_reviews WHERE merchant_id=v_case.merchant_id)
        <>v_case.expected_reviews
      OR (SELECT count(*) FROM public.merchant_compliance_events WHERE merchant_id=v_case.merchant_id)
        <>v_case.expected_events THEN RAISE EXCEPTION 'B2_RACE_COUNTS:%',v_case.scenario; END IF;
  END LOOP;
  -- Behavior: 4 reviews/8 events. Eleven races: 16 reviews/33 events.
  IF (SELECT count(*) FROM public.merchant_compliance_reviews)<>20
    OR (SELECT count(*) FROM public.merchant_compliance_events)<>41
    OR (SELECT count(*) FROM public.merchant_compliance_reviews WHERE review_status='pending')<>8
    OR (SELECT count(*) FROM public.merchant_compliance_reviews WHERE review_status='needs_attention')<>5
    OR (SELECT count(*) FROM public.merchant_compliance_reviews WHERE review_status='cancelled'
      AND decision_reason_code='superseded_by_corrected_submission')<>7
    OR (SELECT count(*) FROM public.merchant_compliance_events
      WHERE event_type='phase2c_draft_review_submit_v1')<>20
    OR (SELECT count(*) FROM public.merchant_compliance_events
      WHERE event_type='phase2c_draft_review_needs_attention_v1')<>12
    OR (SELECT count(*) FROM public.merchant_compliance_events
      WHERE event_type='phase2c_draft_review_superseded_v1')<>7
    OR (SELECT count(*) FROM public.merchant_compliance_events
      WHERE event_type='b2_mixed_writer_probe')<>2 THEN RAISE EXCEPTION 'B2_FINAL_COUNTS'; END IF;
  IF EXISTS (SELECT 1 FROM public.b2_rehearsal_profile_baseline b
      FULL JOIN public.merchant_compliance_profiles p ON p.id=b.id
      WHERE b.body IS DISTINCT FROM pg_catalog.to_jsonb(p))
    OR EXISTS (SELECT 1 FROM public.b2_rehearsal_workspace_baseline b
      FULL JOIN public.workspaces w ON w.id=b.id
      WHERE b.body IS DISTINCT FROM pg_catalog.to_jsonb(w)) THEN
    RAISE EXCEPTION 'B2_FINAL_PROFILE_OR_ACTIVATION_MUTATION';
  END IF;
  IF EXISTS (SELECT 1 FROM public.b2_rehearsal_artifact_baseline b
    LEFT JOIN public.merchant_compliance_reviews r ON r.id=b.id
    WHERE b.body IS DISTINCT FROM (pg_catalog.to_jsonb(r)-ARRAY['review_status','decision_reason_code',
      'decision_notes','reviewed_by','reviewed_at','row_version','updated_at'])) THEN
    RAISE EXCEPTION 'B2_FINAL_SUBMITTED_IDENTITY_OR_SNAPSHOT_CHANGED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.merchant_compliance_reviews
    WHERE review_status NOT IN ('pending','needs_attention','cancelled')) THEN
    RAISE EXCEPTION 'B2_TERMINAL_DECISION_CREATED';
  END IF;
END;
$final$;
SELECT 'PASS|b2_final_counts_and_profile_firewall' AS result;
