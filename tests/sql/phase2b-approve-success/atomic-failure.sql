BEGIN;
\ir fixture.sql
-- Disposable transaction only. Force precisely the approval event INSERT to fail.
CREATE TEMP TABLE local_failure_fingerprint(table_oid oid PRIMARY KEY, digest text NOT NULL);
DO $$
DECLARE v_table record;
v_digest text;
BEGIN
  FOR v_table IN
    SELECT c.oid, c.oid::regclass AS relation FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, ''|'' ORDER BY to_jsonb(x)::text), '''')) FROM %s x',
      v_table.relation) INTO v_digest;
    INSERT INTO local_failure_fingerprint VALUES (v_table.oid, v_digest);
  END LOOP;
END $$;
ALTER TABLE public.solo_plus_case_events
  ADD CONSTRAINT local_approve_event_failure CHECK (event_type <> 'case_approved');
DO $$
DECLARE v_case_id uuid := '00000000-0000-4000-8000-00000000e010';
v_before integer;
v_constraint text;
v_table record;
v_digest text;
BEGIN
  SELECT row_version INTO v_before FROM public.solo_plus_cases WHERE id = v_case_id;
  BEGIN
    PERFORM public.review_solo_plus_case_approve_atomic_v1(
      v_case_id, v_before, 'local-event-failure-key', 'approve',
      '00000000-0000-4000-8000-00000000e013', 'local synthetic approval',
      'local-approve-success', 'phase2b-approve-20261016-local001');
    RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|event_failure_not_raised';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint IS DISTINCT FROM 'local_approve_event_failure' THEN
      RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|wrong_event_failure';
    END IF;
  END;
  IF (SELECT case_status FROM public.solo_plus_cases WHERE id = v_case_id) <> 'manual_review'
     OR (SELECT row_version FROM public.solo_plus_cases WHERE id = v_case_id) <> v_before
     OR (SELECT count(*) FROM public.solo_plus_case_events
         WHERE case_id = v_case_id AND event_type = 'case_approved') <> 0
     OR (SELECT count(*) FROM public.solo_plus_case_requirements
         WHERE case_id = v_case_id AND requirement_state = 'passed') <> 6 THEN
    RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|event_failure_partial_commit';
  END IF;
  FOR v_table IN SELECT * FROM local_failure_fingerprint LOOP
    EXECUTE format('SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, ''|'' ORDER BY to_jsonb(x)::text), '''')) FROM %s x',
      v_table.table_oid::regclass) INTO v_digest;
    IF v_digest IS DISTINCT FROM v_table.digest THEN
      RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|event_failure_side_effect';
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS|APPROVE_SUCCESS|event_failure_rollback|version=%', v_before;
END $$;
ROLLBACK;
