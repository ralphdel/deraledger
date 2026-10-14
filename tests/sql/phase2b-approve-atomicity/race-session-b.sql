-- Run only after Session A prints a barrier marker, on the same local clone.
\set ON_ERROR_STOP on
SELECT set_config('phase2b.race_scenario', :'scenario', false);
SET statement_timeout = '8s';
SET lock_timeout = '2s';
DO $$
DECLARE
  v_scenario text := current_setting('phase2b.race_scenario');
  v_kind text;
  v_expected text;
BEGIN
  v_expected := CASE v_scenario
    WHEN 'case_version' THEN 'version_conflict'
    WHEN 'case_lock' THEN 'lock_timeout'
    WHEN 'payment_lock' THEN 'state_conflict'
    WHEN 'requirement_lock' THEN 'state_conflict'
    WHEN 'payment_drift' THEN 'state_conflict'
    WHEN 'requirement_drift' THEN 'state_conflict'
    WHEN 'marker_drift' THEN 'state_conflict'
    ELSE NULL END;
  IF v_expected IS NULL THEN RAISE EXCEPTION 'FAIL|RACE|unknown_scenario'; END IF;
  BEGIN
    v_kind := public.review_solo_plus_case_approve_atomic_v1(
      '00000000-0000-4000-8000-00000000f010', 1,
      'local-race-' || v_scenario, 'approve',
      '00000000-0000-4000-8000-00000000f013', 'synthetic race probe',
      'local-approve-probe', 'phase2b-approve-20261014-local001')->>'kind';
  EXCEPTION WHEN lock_not_available THEN
    v_kind := 'lock_timeout';
  END;
  IF v_kind IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'FAIL|RACE|unexpected_result|scenario=%|expected=%|actual=%',
      v_scenario, v_expected, COALESCE(v_kind, 'null');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.solo_plus_cases
    WHERE id = '00000000-0000-4000-8000-00000000f010'
      AND (case_status <> 'manual_review' OR approved_at IS NOT NULL
           OR activation_idempotency_key IS NOT NULL)
  ) OR EXISTS (
    SELECT 1 FROM public.solo_plus_case_events
    WHERE case_id = '00000000-0000-4000-8000-00000000f010'
  ) THEN
    RAISE EXCEPTION 'FAIL|RACE|approval_or_event_mutation';
  END IF;
END $$;
\echo PASS|APPROVE_ATOMICITY|two_session_fail_closed
