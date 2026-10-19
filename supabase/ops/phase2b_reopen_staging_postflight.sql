\set ON_ERROR_STOP on
BEGIN READ ONLY;
SELECT set_config('deraledger.phase2b_expected_project_ref', :'expected_project_ref', true);
SELECT set_config('deraledger.phase2b_reopen_case_id', :'fixture_case_id', true);
SELECT set_config('deraledger.phase2b_reopen_run_id', :'fixture_run_id', true);
SELECT set_config('deraledger.phase2b_reopen_expected_version', :'expected_row_version', true);
SELECT set_config('deraledger.phase2b_reopen_expected_boundary', :'expected_boundary', true);
\ir phase2b_reopen_staging_boundary.sql
SELECT set_config('deraledger.phase2b_reopen_observed_boundary', :'reopen_boundary', true);
DO $guard$
DECLARE
  v_case public.solo_plus_cases%ROWTYPE;
  v_event public.solo_plus_case_events%ROWTYPE;
  v_expected integer := current_setting('deraledger.phase2b_reopen_expected_version')::integer;
BEGIN
  IF current_setting('deraledger.phase2b_expected_project_ref') IS DISTINCT FROM 'fsjljliiyfchkwbjifzw'
     OR current_database() IS DISTINCT FROM 'postgres'
     OR current_user IS DISTINCT FROM 'postgres'
     OR current_setting('deraledger.phase2b_reopen_expected_boundary') !~ '^[0-9a-f]{32}$'
     OR current_setting('deraledger.phase2b_reopen_observed_boundary')
        IS DISTINCT FROM current_setting('deraledger.phase2b_reopen_expected_boundary') THEN
    RAISE EXCEPTION 'FAIL|REOPEN_POSTFLIGHT|target_or_boundary';
  END IF;
  SELECT * INTO v_case FROM public.solo_plus_cases
  WHERE id = current_setting('deraledger.phase2b_reopen_case_id')::uuid;
  IF NOT FOUND
     OR v_case.audit_metadata ->> 'fixture_scope' IS DISTINCT FROM 'phase2b_reopen_acceptance'
     OR v_case.audit_metadata ->> 'fixture_origin_scope' IS DISTINCT FROM 'phase2b_admin_detail_smoke'
     OR v_case.audit_metadata ->> 'synthetic_reopen_acceptance' IS DISTINCT FROM 'true'
     OR v_case.audit_metadata ->> 'fixture_run_id'
        IS DISTINCT FROM current_setting('deraledger.phase2b_reopen_run_id')
     OR v_case.audit_metadata ->> 'synthetic_read_only_admin_smoke' IS DISTINCT FROM 'true'
     OR v_case.case_status IS DISTINCT FROM 'verification_pending'
     OR v_case.row_version IS DISTINCT FROM v_expected + 1
     OR v_case.payment_status IS DISTINCT FROM 'pending'
     OR v_case.refund_status IS DISTINCT FROM 'none'
     OR v_case.payment_record_id IS NOT NULL
     OR v_case.payment_provider IS NOT NULL
     OR v_case.payment_reference IS NOT NULL
     OR v_case.activation_idempotency_key IS NOT NULL
     OR v_case.refund_idempotency_key IS NOT NULL
     OR v_case.approved_at IS NOT NULL OR v_case.approved_by_admin_id IS NOT NULL
     OR v_case.rejected_at IS NOT NULL OR v_case.rejected_by_admin_id IS NOT NULL
     OR v_case.rejection_reason IS NOT NULL
     OR v_case.reopened_at IS NULL OR v_case.reopened_by_admin_id IS NULL
     OR EXISTS (SELECT 1 FROM public.payment_records p WHERE p.solo_plus_case_id = v_case.id) THEN
    RAISE EXCEPTION 'FAIL|REOPEN_POSTFLIGHT|case_or_commercial_state';
  END IF;
  IF (SELECT array_agg(r.requirement_code ORDER BY r.requirement_code)
      FROM public.solo_plus_case_requirements r WHERE r.case_id = v_case.id)
       IS DISTINCT FROM ARRAY['activity_profile','bvn','id_document','proof_of_address','selfie_liveness','settlement_account']::text[]
     OR EXISTS (SELECT 1 FROM public.solo_plus_case_requirements r
       WHERE r.case_id = v_case.id AND (r.requirement_state IS DISTINCT FROM 'not_started'
         OR r.verification_log_id IS NOT NULL OR r.evidence_source_type IS NOT NULL
         OR r.evidence_source_id IS NOT NULL OR r.evidence_reference IS NOT NULL
         OR r.original_completed_at IS NOT NULL OR r.reuse_decision_at IS NOT NULL
         OR r.reuse_reason IS NOT NULL OR r.policy_rule_applied IS NOT NULL
         OR r.reviewed_by_admin_id IS NOT NULL OR r.review_note IS NOT NULL
         OR r.provider_name IS NOT NULL OR r.provider_reference IS NOT NULL
         OR r.failure_reason IS NOT NULL OR r.completed_at IS NOT NULL
         OR r.metadata IS DISTINCT FROM '{}'::jsonb)) THEN
    RAISE EXCEPTION 'FAIL|REOPEN_POSTFLIGHT|requirements_changed';
  END IF;
  SELECT * INTO v_event FROM public.solo_plus_case_events e
  WHERE e.case_id = v_case.id AND e.event_type = 'case_reopened';
  IF NOT FOUND
     OR (SELECT count(*) FROM public.solo_plus_case_events e
         WHERE e.case_id = v_case.id AND e.event_type = 'case_reopened') IS DISTINCT FROM 1
     OR (SELECT count(*) FROM public.solo_plus_case_events e
         WHERE e.case_id = v_case.id AND e.event_type = 'case_rejected') IS DISTINCT FROM 1
     OR v_event.actor_type IS DISTINCT FROM 'admin'
     OR v_event.actor_id IS DISTINCT FROM v_case.reopened_by_admin_id
     OR v_event.request_idempotency_key IS NULL
     OR v_event.request_idempotency_key !~ '^solo-plus-review-'
     OR v_event.previous_state ->> 'caseStatus' IS DISTINCT FROM 'rejected'
     OR v_event.previous_state ->> 'rowVersion' IS DISTINCT FROM v_expected::text
     OR v_event.new_state ->> 'caseStatus' IS DISTINCT FROM 'verification_pending'
     OR v_event.new_state ->> 'rowVersion' IS DISTINCT FROM v_case.row_version::text
     OR v_event.new_state ->> 'refundStatus' IS DISTINCT FROM 'none'
     OR v_event.new_state ->> 'rejectionReason' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL|REOPEN_POSTFLIGHT|event_history_mismatch';
  END IF;
END
$guard$;
SELECT 'PASS|REOPEN_POSTFLIGHT|verification_pending_without_side_effects|row_version=' ||
       c.row_version::text || '|event_id=' || e.id::text
FROM public.solo_plus_cases c
JOIN public.solo_plus_case_events e ON e.case_id = c.id AND e.event_type = 'case_reopened'
WHERE c.id = :'fixture_case_id'::uuid;
ROLLBACK;
