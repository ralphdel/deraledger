\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
SELECT set_config('deraledger.phase2b_expected_project_ref', :'expected_project_ref', true);
SELECT set_config('deraledger.phase2b_reopen_case_id', :'fixture_case_id', true);
SELECT set_config('deraledger.phase2b_reopen_run_id', :'fixture_run_id', true);
SELECT set_config('deraledger.phase2b_reopen_expected_version', :'expected_row_version', true);
DO $guard$
DECLARE
  v_case public.solo_plus_cases%ROWTYPE;
  v_expected integer := current_setting('deraledger.phase2b_reopen_expected_version')::integer;
BEGIN
  IF current_setting('deraledger.phase2b_expected_project_ref') IS DISTINCT FROM 'fsjljliiyfchkwbjifzw'
     OR current_database() IS DISTINCT FROM 'postgres'
     OR current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'BLOCKED|REOPEN_FIXTURE|target_identity';
  END IF;
  SELECT * INTO v_case FROM public.solo_plus_cases
  WHERE id = current_setting('deraledger.phase2b_reopen_case_id')::uuid
  FOR UPDATE;
  IF NOT FOUND
     OR v_case.row_version IS DISTINCT FROM v_expected
     OR v_case.case_status IS DISTINCT FROM 'rejected'
     OR v_case.payment_status IS DISTINCT FROM 'pending'
     OR v_case.refund_status IS DISTINCT FROM 'none'
     OR v_case.payment_record_id IS NOT NULL
     OR v_case.payment_provider IS NOT NULL
     OR v_case.payment_reference IS NOT NULL
     OR v_case.activation_idempotency_key IS NOT NULL
     OR v_case.refund_idempotency_key IS NOT NULL
     OR v_case.approved_at IS NOT NULL OR v_case.approved_by_admin_id IS NOT NULL
     OR v_case.rejected_at IS NULL OR v_case.rejected_by_admin_id IS NULL
     OR NULLIF(btrim(v_case.rejection_reason), '') IS NULL
     OR v_case.reopened_at IS NOT NULL OR v_case.reopened_by_admin_id IS NOT NULL
     OR v_case.audit_metadata ->> 'fixture_scope' IS DISTINCT FROM 'phase2b_admin_detail_smoke'
     OR v_case.audit_metadata ->> 'fixture_run_id'
        IS DISTINCT FROM current_setting('deraledger.phase2b_reopen_run_id')
     OR v_case.audit_metadata ->> 'synthetic_read_only_admin_smoke' IS DISTINCT FROM 'true'
     OR EXISTS (SELECT 1 FROM public.payment_records p WHERE p.solo_plus_case_id = v_case.id)
     OR (SELECT array_agg(r.requirement_code ORDER BY r.requirement_code)
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
           OR r.metadata IS DISTINCT FROM '{}'::jsonb))
     OR (SELECT count(*) FROM public.solo_plus_case_events e
         WHERE e.case_id = v_case.id AND e.event_type = 'case_rejected'
           AND e.actor_type = 'admin' AND e.actor_id = v_case.rejected_by_admin_id
           AND e.reason = v_case.rejection_reason
           AND e.request_idempotency_key IS NOT NULL
           AND e.previous_state ->> 'caseStatus' = 'manual_review'
           AND e.new_state ->> 'caseStatus' = 'rejected'
           AND e.new_state ->> 'rowVersion' = v_expected::text) IS DISTINCT FROM 1
     OR EXISTS (SELECT 1 FROM public.solo_plus_case_events e
         WHERE e.case_id = v_case.id AND e.event_type IN (
           'case_review_requested_more_information', 'case_approved', 'case_reopened'
         )) THEN
    RAISE EXCEPTION 'BLOCKED|REOPEN_FIXTURE|candidate_drift';
  END IF;

  UPDATE public.solo_plus_cases
  SET audit_metadata = audit_metadata || jsonb_build_object(
        'fixture_scope', 'phase2b_reopen_acceptance',
        'fixture_origin_scope', 'phase2b_admin_detail_smoke',
        'synthetic_reopen_acceptance', true
      ),
      row_version = row_version + 1,
      updated_at = now()
  WHERE id = v_case.id AND row_version = v_expected;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCKED|REOPEN_FIXTURE|candidate_changed';
  END IF;
END
$guard$;
SELECT 'PASS|REOPEN_FIXTURE|prepared|row_version=' || c.row_version::text
FROM public.solo_plus_cases c
WHERE c.id = :'fixture_case_id'::uuid;
COMMIT;
