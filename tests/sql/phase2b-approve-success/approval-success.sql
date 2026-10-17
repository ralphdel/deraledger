BEGIN;
\ir fixture.sql
-- Fingerprint every public table except the two intended approval-write tables.
CREATE TEMP TABLE local_unchanged_public_tables(table_oid oid PRIMARY KEY, digest text NOT NULL);
DO $$
DECLARE v_table record;
v_digest text;
BEGIN
  FOR v_table IN
    SELECT c.oid, c.oid::regclass AS relation FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND c.oid NOT IN ('public.solo_plus_cases'::regclass,
                        'public.solo_plus_case_events'::regclass)
  LOOP
    EXECUTE format('SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, ''|'' ORDER BY to_jsonb(x)::text), '''')) FROM %s x',
      v_table.relation) INTO v_digest;
    INSERT INTO local_unchanged_public_tables VALUES (v_table.oid, v_digest);
  END LOOP;
END $$;
DO $$
DECLARE v_case_id uuid := '00000000-0000-4000-8000-00000000e010';
v_before integer;
v_after integer;
v_result jsonb;
v_event jsonb;
v_table record;
v_digest text;
BEGIN
  SELECT row_version INTO v_before FROM public.solo_plus_cases WHERE id = v_case_id;
  v_result := public.review_solo_plus_case_approve_atomic_v1(
    v_case_id, v_before, 'local-success-key', 'approve',
    '00000000-0000-4000-8000-00000000e013', 'local synthetic approval',
    'local-approve-success', 'phase2b-approve-20261016-local001');
  SELECT row_version INTO v_after FROM public.solo_plus_cases WHERE id = v_case_id;
  v_event := v_result->'event';
  IF v_result->>'kind' <> 'updated' OR v_after <> v_before + 1
     OR (SELECT case_status FROM public.solo_plus_cases WHERE id = v_case_id) <> 'approved'
     OR (SELECT count(*) FROM public.solo_plus_case_events
         WHERE case_id = v_case_id AND event_type = 'case_approved') <> 1
     OR (v_event->'previous_state'->>'rowVersion')::integer <> v_before
     OR (v_event->'new_state'->>'rowVersion')::integer <> v_after
     OR v_event->'new_state'->>'caseStatus' <> 'approved'
     OR (SELECT count(*) FROM public.solo_plus_case_requirements
         WHERE case_id = v_case_id AND requirement_state = 'passed') <> 6
     OR (SELECT payment_status FROM public.payment_records
         WHERE id = '00000000-0000-4000-8000-00000000e012') <> 'successful' THEN
    RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|approval_transaction';
  END IF;
  FOR v_table IN SELECT * FROM local_unchanged_public_tables LOOP
    EXECUTE format('SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, ''|'' ORDER BY to_jsonb(x)::text), '''')) FROM %s x',
      v_table.table_oid::regclass) INTO v_digest;
    IF v_digest IS DISTINCT FROM v_table.digest THEN
      RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|unexpected_public_table_mutation';
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS|APPROVE_SUCCESS|atomic_case_and_one_event|before=%|after=%',
    v_before, v_after;
END $$;
ROLLBACK;
\echo PASS|APPROVE_SUCCESS|approval_and_side_effect_rollback
