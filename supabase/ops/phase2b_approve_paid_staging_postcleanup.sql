\set ON_ERROR_STOP on
\ir phase2b_approve_paid_staging_preflight.sql
BEGIN READ ONLY;
SELECT set_config('deraledger.phase2b_expected_project_ref', :'expected_project_ref', true);
SELECT set_config('deraledger.phase2b_approve_run_id', :'fixture_run_id', true);
SELECT set_config('deraledger.phase2b_approve_case_id', :'fixture_case_id', true);
DO $guard$
DECLARE v_run text := current_setting('deraledger.phase2b_approve_run_id');
BEGIN
  IF current_setting('deraledger.phase2b_expected_project_ref') IS DISTINCT FROM 'fsjljliiyfchkwbjifzw'
     OR current_database() IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM 'postgres'
     OR v_run !~ '^phase2b-approve-[0-9]{8}-[a-z0-9]{3,16}$'
     OR EXISTS (SELECT 1 FROM public.solo_plus_cases
       WHERE id = current_setting('deraledger.phase2b_approve_case_id')::uuid
          OR audit_metadata ->> 'fixture_run_id' = v_run)
     OR EXISTS (SELECT 1 FROM public.solo_plus_case_requirements
       WHERE case_id = current_setting('deraledger.phase2b_approve_case_id')::uuid
          OR metadata ->> 'fixture_run_id' = v_run)
     OR EXISTS (SELECT 1 FROM public.solo_plus_case_events
       WHERE case_id = current_setting('deraledger.phase2b_approve_case_id')::uuid)
     OR EXISTS (SELECT 1 FROM public.payment_records
       WHERE solo_plus_case_id = current_setting('deraledger.phase2b_approve_case_id')::uuid
          OR metadata ->> 'fixture_run_id' = v_run
          OR internal_reference = 'phase2b-approve:' || v_run)
     OR EXISTS (SELECT 1 FROM public.merchants
       WHERE email = v_run || '@example.invalid'
          OR business_name = 'Phase 2B Approve Fixture ' || v_run)
     OR EXISTS (SELECT 1 FROM public.workspaces
       WHERE display_name = 'Phase 2B Approve Fixture ' || v_run) THEN
    RAISE EXCEPTION 'FAIL|APPROVE_STAGING|postcleanup_descendant_present';
  END IF;
END
$guard$;
SELECT 'PASS|APPROVE_STAGING|postcleanup_absent';
ROLLBACK;
