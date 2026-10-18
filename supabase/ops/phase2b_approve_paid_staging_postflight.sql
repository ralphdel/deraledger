\set ON_ERROR_STOP on
\ir phase2b_approve_paid_staging_preflight.sql
BEGIN READ ONLY;
SELECT set_config('deraledger.phase2b_expected_project_ref', :'expected_project_ref', true);
SELECT set_config('deraledger.phase2b_approve_run_id', :'fixture_run_id', true);
SELECT set_config('deraledger.phase2b_approve_case_id', :'fixture_case_id', true);
SELECT set_config('deraledger.phase2b_expected_boundary', :'expected_boundary', true);
SELECT set_config('deraledger.phase2b_expected_version', :'expected_row_version', true);
\ir phase2b_approve_paid_staging_boundary.sql
SELECT set_config('deraledger.phase2b_observed_boundary', :'fixture_boundary', true);
DO $guard$
DECLARE
  v_case public.solo_plus_cases%ROWTYPE;
  v_event public.solo_plus_case_events%ROWTYPE;
  v_run text := current_setting('deraledger.phase2b_approve_run_id');
BEGIN
  IF current_setting('deraledger.phase2b_expected_project_ref') IS DISTINCT FROM 'fsjljliiyfchkwbjifzw'
     OR current_database() IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM 'postgres'
     OR current_setting('deraledger.phase2b_expected_boundary') !~ '^[0-9a-f]{32}$'
     OR current_setting('deraledger.phase2b_observed_boundary')
        IS DISTINCT FROM current_setting('deraledger.phase2b_expected_boundary') THEN
    RAISE EXCEPTION 'FAIL|APPROVE_POSTFLIGHT|target_or_boundary';
  END IF;
  SELECT * INTO v_case FROM public.solo_plus_cases
  WHERE id = current_setting('deraledger.phase2b_approve_case_id')::uuid;
  IF NOT FOUND OR v_case.audit_metadata ->> 'fixture_scope' IS DISTINCT FROM 'phase2b_approve_acceptance'
     OR v_case.audit_metadata ->> 'fixture_run_id' IS DISTINCT FROM v_run
     OR v_case.audit_metadata ->> 'synthetic_approve_acceptance' IS DISTINCT FROM 'true'
     OR v_case.case_status IS DISTINCT FROM 'approved' OR v_case.payment_status IS DISTINCT FROM 'paid'
     OR v_case.flow_origin IS DISTINCT FROM 'upgrade' OR v_case.source_plan IS DISTINCT FROM 'solo_lite'
     OR v_case.onboarding_session_id IS NOT NULL
     OR v_case.active_plan_snapshot IS DISTINCT FROM 'solo_lite'
     OR v_case.expected_amount IS DISTINCT FROM 100.00 OR v_case.payment_currency IS DISTINCT FROM 'NGN'
     OR v_case.payment_record_id IS NULL
     OR v_case.payment_provider IS NOT NULL OR v_case.payment_reference IS NOT NULL
     OR v_case.refund_status IS DISTINCT FROM 'none'
     OR v_case.row_version IS DISTINCT FROM current_setting('deraledger.phase2b_expected_version')::integer + 1
     OR v_case.approved_at IS NULL OR v_case.approved_by_admin_id IS NULL
     OR v_case.activation_idempotency_key IS NOT NULL
     OR v_case.refund_idempotency_key IS NOT NULL
     OR v_case.rejected_at IS NOT NULL OR v_case.reopened_at IS NOT NULL
     OR (SELECT count(*) FROM public.payment_records p
         WHERE p.solo_plus_case_id = v_case.id) IS DISTINCT FROM 1
     OR (SELECT count(*) FROM public.solo_plus_case_requirements r
         WHERE r.case_id = v_case.id) IS DISTINCT FROM 6
     OR (SELECT count(*) FROM public.solo_plus_case_events e
         WHERE e.case_id = v_case.id) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FAIL|APPROVE_POSTFLIGHT|case_or_descendants';
  END IF;
  SELECT * INTO v_event FROM public.solo_plus_case_events
  WHERE case_id = v_case.id AND event_type = 'case_approved';
  IF NOT FOUND OR v_event.actor_type IS DISTINCT FROM 'admin'
     OR v_event.actor_id IS DISTINCT FROM v_case.approved_by_admin_id
     OR v_event.request_idempotency_key IS NULL
     OR v_event.request_idempotency_key !~ '^solo-plus-review-'
     OR v_event.previous_state ->> 'caseStatus' IS DISTINCT FROM 'manual_review'
     OR v_event.new_state ->> 'caseStatus' IS DISTINCT FROM 'approved'
     OR v_event.previous_state ->> 'rowVersion'
        IS DISTINCT FROM current_setting('deraledger.phase2b_expected_version')
     OR v_event.new_state ->> 'rowVersion' IS DISTINCT FROM v_case.row_version::text
     OR v_event.new_state ->> 'approvedByAdminId' IS DISTINCT FROM v_case.approved_by_admin_id::text
     OR v_event.policy_version IS DISTINCT FROM v_case.requirements_policy_version THEN
    RAISE EXCEPTION 'FAIL|APPROVE_POSTFLIGHT|approval_event';
  END IF;
END
$guard$;
SELECT 'PASS|APPROVE_POSTFLIGHT|approved_without_activation|row_version=' ||
       c.row_version::text || '|event_id=' || e.id::text
FROM public.solo_plus_cases c
JOIN public.solo_plus_case_events e ON e.case_id = c.id AND e.event_type = 'case_approved'
WHERE c.id = :'fixture_case_id'::uuid;
ROLLBACK;
