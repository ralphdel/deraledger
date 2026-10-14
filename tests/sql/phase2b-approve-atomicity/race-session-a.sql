-- Interactive Session A; use a fresh race clone per scenario.
\set ON_ERROR_STOP on
SELECT set_config('phase2b.race_scenario', :'scenario', false);
BEGIN;
SET LOCAL statement_timeout = '30s';
DO $$
DECLARE v_case_id uuid := '00000000-0000-4000-8000-00000000f010';
BEGIN
  CASE current_setting('phase2b.race_scenario')
    WHEN 'payment_lock' THEN
      PERFORM 1 FROM public.payment_records WHERE id = '00000000-0000-4000-8000-00000000f012' FOR UPDATE;
    WHEN 'requirement_lock' THEN
      PERFORM 1 FROM public.solo_plus_case_requirements
      WHERE case_id = v_case_id AND requirement_code = 'activity_profile' FOR UPDATE;
    WHEN 'case_lock' THEN
      PERFORM 1 FROM public.solo_plus_cases WHERE id = v_case_id FOR UPDATE;
    WHEN 'payment_drift' THEN
      UPDATE public.payment_records SET amount_paid = 99.00
      WHERE id = '00000000-0000-4000-8000-00000000f012';
    WHEN 'requirement_drift' THEN
      UPDATE public.solo_plus_case_requirements SET requirement_state = 'failed', completed_at = NULL
      WHERE case_id = v_case_id AND requirement_code = 'activity_profile';
    WHEN 'case_version' THEN
      UPDATE public.solo_plus_cases SET row_version = row_version + 1 WHERE id = v_case_id;
    WHEN 'marker_drift' THEN
      UPDATE public.solo_plus_cases
      SET audit_metadata = jsonb_set(audit_metadata, '{fixture_run_id}', '"phase2b-approve-20261014-local002"')
      WHERE id = v_case_id;
    ELSE
      RAISE EXCEPTION 'FAIL|RACE_SETUP|unknown_scenario';
  END CASE;
END $$;
SELECT (current_setting('phase2b.race_scenario') IN
        ('payment_lock','requirement_lock','case_lock'))::text AS hold_lock \gset
\if :hold_lock
\echo PASS|APPROVE_ATOMICITY|session_a_lock_held
\prompt 'Run Session B now, then press Enter to release Session A: ' release_ack
ROLLBACK;
\else
COMMIT;
\echo PASS|APPROVE_ATOMICITY|session_a_drift_committed
\endif
