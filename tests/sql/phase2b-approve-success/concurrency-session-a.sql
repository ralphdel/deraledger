\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() <> 'deraledger_phase2b_approve_success_race_disposable'
     OR current_user <> 'postgres' OR host(inet_server_addr()) <> '127.0.0.1'
     OR inet_server_port() <> 55432 THEN
    RAISE EXCEPTION 'BLOCKED|APPROVE_SUCCESS|race_identity_a';
  END IF;
END $$;
CREATE FUNCTION pg_temp.require_b_lock_wait() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_waiting boolean := false;
BEGIN
  FOR attempt IN 1..100 LOOP
    PERFORM pg_stat_clear_snapshot();
    SELECT EXISTS (SELECT 1 FROM pg_stat_activity
      WHERE datname = 'deraledger_phase2b_approve_success_race_disposable'
        AND application_name = 'phase2b_approve_success_b'
        AND wait_event_type = 'Lock') INTO v_waiting;
    EXIT WHEN v_waiting;
    PERFORM pg_sleep(0.1);
  END LOOP;
  IF NOT v_waiting THEN
    RAISE EXCEPTION 'BLOCKED|APPROVE_SUCCESS|race_overlap_unproven';
  END IF;
END $$;

BEGIN;
SELECT 1 FROM public.solo_plus_cases
WHERE id = '00000000-0000-4000-8000-00000000e110' FOR UPDATE;
\echo READY|APPROVE_SUCCESS|a_same_case_locked
\prompt 'Start B same-key call; when B_CALL_START is visible and B is still running, press Enter: ' continue_same
SELECT pg_temp.require_b_lock_wait();
DO $$
DECLARE v_version integer;
v_result jsonb;
BEGIN
  SELECT row_version INTO v_version FROM public.solo_plus_cases
    WHERE id = '00000000-0000-4000-8000-00000000e110';
  v_result := public.review_solo_plus_case_approve_atomic_v1(
    '00000000-0000-4000-8000-00000000e110', v_version,
    'local-race-same-key', 'approve', '00000000-0000-4000-8000-00000000e113',
    'local race approval', 'local-approve-race', 'phase2b-approve-20261016-race001');
  IF v_result->>'kind' <> 'updated' THEN
    RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|race_same_a';
  END IF;
END $$;
COMMIT;
\echo PASS|APPROVE_SUCCESS|race_same_a

BEGIN;
SELECT 1 FROM public.solo_plus_cases
WHERE id = '00000000-0000-4000-8000-00000000e210' FOR UPDATE;
\echo READY|APPROVE_SUCCESS|a_different_case_locked
\prompt 'Start B different-key call; when B_CALL_START is visible and B is still running, press Enter: ' continue_different
SELECT pg_temp.require_b_lock_wait();
DO $$
DECLARE v_version integer;
v_result jsonb;
BEGIN
  SELECT row_version INTO v_version FROM public.solo_plus_cases
    WHERE id = '00000000-0000-4000-8000-00000000e210';
  v_result := public.review_solo_plus_case_approve_atomic_v1(
    '00000000-0000-4000-8000-00000000e210', v_version,
    'local-race-different-a', 'approve', '00000000-0000-4000-8000-00000000e213',
    'local race approval', 'local-approve-race', 'phase2b-approve-20261016-race002');
  IF v_result->>'kind' <> 'updated' THEN
    RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|race_different_a';
  END IF;
END $$;
COMMIT;
\echo PASS|APPROVE_SUCCESS|race_different_a

BEGIN;
SELECT 1 FROM public.solo_plus_cases
WHERE id = '00000000-0000-4000-8000-00000000e310' FOR UPDATE;
\echo READY|APPROVE_SUCCESS|a_child_case_locked
\prompt 'Start B child payment UPDATE; when B_CALL_START is visible and B is still running, press Enter: ' continue_child
SELECT pg_temp.require_b_lock_wait();
DO $$
DECLARE v_version integer;
v_result jsonb;
BEGIN
  SELECT row_version INTO v_version FROM public.solo_plus_cases
    WHERE id = '00000000-0000-4000-8000-00000000e310';
  v_result := public.review_solo_plus_case_approve_atomic_v1(
    '00000000-0000-4000-8000-00000000e310', v_version,
    'local-race-child-a', 'approve', '00000000-0000-4000-8000-00000000e313',
    'local race approval', 'local-approve-race', 'phase2b-approve-20261016-race003');
  IF v_result->>'kind' <> 'state_conflict' THEN
    RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|race_child_a';
  END IF;
END $$;
COMMIT;
\echo PASS|APPROVE_SUCCESS|race_child_a_fail_closed
