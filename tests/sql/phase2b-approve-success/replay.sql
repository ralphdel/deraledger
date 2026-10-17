BEGIN;
\ir fixture.sql
DO $$
DECLARE v_case_id uuid := '00000000-0000-4000-8000-00000000e010';
v_before integer;
v_after integer;
v_first jsonb;
v_replay jsonb;
v_conflict jsonb;
v_other jsonb;
BEGIN
  SELECT row_version INTO v_before FROM public.solo_plus_cases WHERE id = v_case_id;
  v_first := public.review_solo_plus_case_approve_atomic_v1(
    v_case_id, v_before, 'local-replay-key', 'approve',
    '00000000-0000-4000-8000-00000000e013', 'local synthetic approval',
    'local-approve-success', 'phase2b-approve-20261016-local001');
  v_replay := public.review_solo_plus_case_approve_atomic_v1(
    v_case_id, v_before, 'local-replay-key', 'approve',
    '00000000-0000-4000-8000-00000000e013', 'local synthetic approval',
    'local-approve-success', 'phase2b-approve-20261016-local001');
  v_conflict := public.review_solo_plus_case_approve_atomic_v1(
    v_case_id, v_before, 'local-replay-key', 'approve',
    '00000000-0000-4000-8000-00000000e013', 'different reason',
    'local-approve-success', 'phase2b-approve-20261016-local001');
  v_other := public.review_solo_plus_case_approve_atomic_v1(
    v_case_id, v_before, 'local-other-key', 'approve',
    '00000000-0000-4000-8000-00000000e013', 'local synthetic approval',
    'local-approve-success', 'phase2b-approve-20261016-local001');
  SELECT row_version INTO v_after FROM public.solo_plus_cases WHERE id = v_case_id;
  IF v_first->>'kind' <> 'updated'
     OR v_replay->>'kind' <> 'idempotent_replay'
     OR v_replay->'event'->>'id' IS DISTINCT FROM v_first->'event'->>'id'
     OR v_conflict->>'kind' <> 'idempotency_conflict'
     OR v_other->>'kind' NOT IN ('version_conflict', 'state_conflict')
     OR v_after <> v_before + 1
     OR (SELECT count(*) FROM public.solo_plus_case_events
         WHERE case_id = v_case_id AND event_type = 'case_approved') <> 1 THEN
    RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|replay';
  END IF;
  RAISE NOTICE 'PASS|APPROVE_SUCCESS|replay_one_event|before=%|after=%', v_before, v_after;
END $$;
ROLLBACK;
