\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() <> 'deraledger_phase2b_approve_success_race_disposable'
     OR current_user <> 'postgres' OR host(inet_server_addr()) <> '127.0.0.1'
     OR inet_server_port() <> 55432 THEN
    RAISE EXCEPTION 'BLOCKED|APPROVE_SUCCESS|race_identity_b';
  END IF;
END $$;
SET application_name = 'phase2b_approve_success_b';
SET statement_timeout = '60s';
\prompt 'Wait for A_SAME_CASE_LOCKED; press Enter to start B: ' start_same
\echo B_CALL_START|APPROVE_SUCCESS|same_key
DO $$
DECLARE v_before integer;
v_result jsonb;
BEGIN
  SELECT row_version INTO v_before FROM public.solo_plus_cases
    WHERE id = '00000000-0000-4000-8000-00000000e110';
  v_result := public.review_solo_plus_case_approve_atomic_v1(
    '00000000-0000-4000-8000-00000000e110', v_before,
    'local-race-same-key', 'approve', '00000000-0000-4000-8000-00000000e113',
    'local race approval', 'local-approve-race', 'phase2b-approve-20261016-race001');
  IF v_result->>'kind' <> 'idempotent_replay'
     OR (v_result->'event'->'previous_state'->>'rowVersion')::integer <> v_before THEN
    RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|race_same_b';
  END IF;
END $$;
\echo PASS|APPROVE_SUCCESS|race_same_key

\prompt 'Wait for A_DIFFERENT_CASE_LOCKED; press Enter to start B: ' start_different
\echo B_CALL_START|APPROVE_SUCCESS|different_key
DO $$
DECLARE v_before integer;
v_result jsonb;
BEGIN
  SELECT row_version INTO v_before FROM public.solo_plus_cases
    WHERE id = '00000000-0000-4000-8000-00000000e210';
  v_result := public.review_solo_plus_case_approve_atomic_v1(
    '00000000-0000-4000-8000-00000000e210', v_before,
    'local-race-different-b', 'approve', '00000000-0000-4000-8000-00000000e213',
    'local race approval', 'local-approve-race', 'phase2b-approve-20261016-race002');
  IF v_result->>'kind' <> 'version_conflict'
     OR (v_result->'case'->>'row_version')::integer <> v_before + 1 THEN
    RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|race_different_b';
  END IF;
END $$;
\echo PASS|APPROVE_SUCCESS|race_different_key

\prompt 'Wait for A_CHILD_CASE_LOCKED; press Enter to start B: ' start_child
\echo B_CALL_START|APPROVE_SUCCESS|child_writer
DO $$
DECLARE v_before integer;
v_after integer;
BEGIN
  SELECT row_version INTO v_before FROM public.solo_plus_cases
    WHERE id = '00000000-0000-4000-8000-00000000e310';
  UPDATE public.payment_records SET amount_paid = 99
    WHERE id = '00000000-0000-4000-8000-00000000e312';
  SELECT row_version INTO v_after FROM public.solo_plus_cases
    WHERE id = '00000000-0000-4000-8000-00000000e310';
  IF v_after <> v_before + 1 THEN
    RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|race_child_b';
  END IF;
END $$;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.solo_plus_case_events
       WHERE event_type = 'case_approved'
         AND case_id = '00000000-0000-4000-8000-00000000e110') <> 1
     OR (SELECT count(*) FROM public.solo_plus_case_events
       WHERE event_type = 'case_approved'
         AND case_id = '00000000-0000-4000-8000-00000000e210') <> 1
     OR EXISTS (SELECT 1 FROM public.solo_plus_cases
       WHERE id IN ('00000000-0000-4000-8000-00000000e110',
                    '00000000-0000-4000-8000-00000000e210')
         AND case_status <> 'approved')
     OR EXISTS (SELECT 1 FROM public.solo_plus_case_events
       WHERE case_id = '00000000-0000-4000-8000-00000000e310'
         AND event_type = 'case_approved')
     OR (SELECT case_status FROM public.solo_plus_cases
       WHERE id = '00000000-0000-4000-8000-00000000e310') <> 'manual_review' THEN
    RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|race_final_cardinality';
  END IF;
END $$;
\echo PASS|APPROVE_SUCCESS|race_child_writer_fail_closed
\echo PASS|APPROVE_SUCCESS|race_matrix|count=3
