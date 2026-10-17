-- Synthetic changes are rolled back. Observed versions are emitted without row data.
BEGIN;
\ir fixture.sql
DO $$
DECLARE v_case uuid := '00000000-0000-4000-8000-00000000e010';
v_before integer;
v_after integer;
BEGIN
  SELECT row_version INTO v_before FROM public.solo_plus_cases WHERE id = v_case;
  UPDATE public.payment_records SET amount_paid = amount_paid
    WHERE id = '00000000-0000-4000-8000-00000000e012';
  SELECT row_version INTO v_after FROM public.solo_plus_cases WHERE id = v_case;
  IF v_after <> v_before THEN RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|payment_noop'; END IF;
  RAISE NOTICE 'PASS|APPROVE_SUCCESS|payment_noop|before=%|after=%', v_before, v_after;

  UPDATE public.solo_plus_case_requirements SET requirement_state = requirement_state
    WHERE case_id = v_case;
  SELECT row_version INTO v_after FROM public.solo_plus_cases WHERE id = v_case;
  IF v_after <> v_before THEN RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|requirement_noop'; END IF;
  RAISE NOTICE 'PASS|APPROVE_SUCCESS|requirement_noop|before=%|after=%', v_before, v_after;

  INSERT INTO public.payment_records(id, merchant_id, payment_purpose, internal_reference,
    amount_paid, expected_amount, currency, payment_status)
  VALUES ('00000000-0000-4000-8000-00000000e014',
    '00000000-0000-4000-8000-00000000e011', 'plan_upgrade',
    'local-approve-unrelated', 0, 100, 'NGN', 'pending');
  UPDATE public.payment_records SET amount_paid = 1
    WHERE id = '00000000-0000-4000-8000-00000000e014';
  SELECT row_version INTO v_after FROM public.solo_plus_cases WHERE id = v_case;
  IF v_after <> v_before THEN RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|unrelated_payment'; END IF;
  RAISE NOTICE 'PASS|APPROVE_SUCCESS|unrelated_payment|before=%|after=%', v_before, v_after;

  UPDATE public.payment_records SET amount_paid = 99
    WHERE id = '00000000-0000-4000-8000-00000000e012';
  SELECT row_version INTO v_after FROM public.solo_plus_cases WHERE id = v_case;
  IF v_after <> v_before + 1 THEN RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|relevant_payment'; END IF;
  RAISE NOTICE 'PASS|APPROVE_SUCCESS|relevant_payment|before=%|after=%', v_before, v_after;
  v_before := v_after;

  UPDATE public.solo_plus_case_requirements SET evidence_source_id = gen_random_uuid()
    WHERE case_id = v_case;
  SELECT row_version INTO v_after FROM public.solo_plus_cases WHERE id = v_case;
  IF v_after <> v_before + 1 THEN RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|six_requirement_statement'; END IF;
  RAISE NOTICE 'PASS|APPROVE_SUCCESS|six_requirement_statement|before=%|after=%', v_before, v_after;
  v_before := v_after;

  DELETE FROM public.solo_plus_case_requirements
    WHERE case_id = v_case AND requirement_code = 'bvn';
  SELECT row_version INTO v_before FROM public.solo_plus_cases WHERE id = v_case;
  INSERT INTO public.solo_plus_case_requirements(
    case_id, requirement_code, requirement_state, evidence_source_type,
    evidence_source_id, completed_at, metadata)
  SELECT v_case, code, 'passed', 'manual_submission', gen_random_uuid(), now(),
    '{"fixture_scope":"phase2b_approve_acceptance","fixture_run_id":"phase2b-approve-20261016-local001","synthetic_approve_acceptance":true}'::jsonb
  FROM unnest(ARRAY['bvn', 'id_document']) AS code
  ON CONFLICT (case_id, requirement_code) DO UPDATE
    SET evidence_source_id = EXCLUDED.evidence_source_id;
  SELECT row_version INTO v_after FROM public.solo_plus_cases WHERE id = v_case;
  IF v_after < v_before + 1 OR v_after > v_before + 2 THEN
    RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|mixed_upsert_version_bound';
  END IF;
  RAISE NOTICE 'PASS|APPROVE_SUCCESS|mixed_upsert_version_bound|before=%|after=%', v_before, v_after;
END $$;
ROLLBACK;
\echo PASS|APPROVE_SUCCESS|writer_contract_rollback
\ir legacy-payment-writers.sql
