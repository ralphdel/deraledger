BEGIN;
\ir fixture.sql
DO $$
DECLARE v_case_id uuid := '00000000-0000-4000-8000-00000000e010';
v_version integer;
BEGIN
  SELECT row_version INTO v_version FROM public.solo_plus_cases WHERE id = v_case_id;
  IF (public.review_solo_plus_case_v1(v_case_id, v_version,
      'local-legacy-approve', 'approve',
      '00000000-0000-4000-8000-00000000e013', 'synthetic reason',
      'local-approve-success')->>'kind') <> 'state_conflict' THEN
    RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|legacy_v1_approve';
  END IF;
END $$;
SAVEPOINT local_rmi;
DO $$
DECLARE v_case_id uuid := '00000000-0000-4000-8000-00000000e010';
v_version integer;
BEGIN
  SELECT row_version INTO v_version FROM public.solo_plus_cases WHERE id = v_case_id;
  IF (public.review_solo_plus_case_v1(v_case_id, v_version,
      'local-legacy-rmi', 'request_more_information',
      '00000000-0000-4000-8000-00000000e013', 'synthetic reason',
      'local-approve-success')->>'kind') <> 'updated' THEN
    RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|legacy_rmi';
  END IF;
END $$;
ROLLBACK TO SAVEPOINT local_rmi;
SAVEPOINT local_reject;
DO $$
DECLARE v_case_id uuid := '00000000-0000-4000-8000-00000000e010';
v_version integer;
BEGIN
  SELECT row_version INTO v_version FROM public.solo_plus_cases WHERE id = v_case_id;
  IF (public.review_solo_plus_case_v1(v_case_id, v_version,
      'local-legacy-reject', 'reject',
      '00000000-0000-4000-8000-00000000e013', 'synthetic reason',
      'local-approve-success')->>'kind') <> 'updated' THEN
    RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|legacy_reject';
  END IF;
END $$;
ROLLBACK TO SAVEPOINT local_reject;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.solo_plus_case_events
    WHERE case_id = '00000000-0000-4000-8000-00000000e010') THEN
    RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|legacy_rollback';
  END IF;
END $$;
ROLLBACK;
\echo PASS|APPROVE_SUCCESS|legacy_v1_rmi_reject_and_blocked_approve
