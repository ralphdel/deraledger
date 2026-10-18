\set ON_ERROR_STOP on
\ir phase2b_approve_paid_staging_preflight.sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT set_config('deraledger.phase2b_expected_project_ref', :'expected_project_ref', true);
SELECT set_config('deraledger.phase2b_approve_run_id', :'fixture_run_id', true);
DO $fixture$
DECLARE
  v_run text := current_setting('deraledger.phase2b_approve_run_id');
  v_case uuid := gen_random_uuid();
  v_merchant uuid := gen_random_uuid();
  v_workspace uuid := gen_random_uuid();
  v_payment uuid := gen_random_uuid();
  v_marker jsonb := jsonb_build_object(
    'fixture_scope', 'phase2b_approve_acceptance',
    'fixture_run_id', current_setting('deraledger.phase2b_approve_run_id'),
    'synthetic_approve_acceptance', true);
BEGIN
  IF current_setting('deraledger.phase2b_expected_project_ref') IS DISTINCT FROM 'fsjljliiyfchkwbjifzw'
     OR current_database() IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM 'postgres'
     OR v_run !~ '^phase2b-approve-[0-9]{8}-[a-z0-9]{3,16}$'
     OR (SELECT md5(replace(replace(prosrc,E'\r\n',E'\n'),E'\r',E'\n'))
         FROM pg_proc WHERE oid = to_regprocedure(
          'public.review_solo_plus_case_approve_atomic_v1(uuid,bigint,text,text,uuid,text,text,text)'))
        IS DISTINCT FROM '5cc81f443c678a15bed43de6df472077'
     OR (SELECT count(*) FROM pg_trigger
         WHERE NOT tgisinternal AND tgname LIKE 'trg_phase2b_approve_%') IS DISTINCT FROM 7
     OR EXISTS (SELECT 1 FROM pg_trigger
         WHERE NOT tgisinternal AND tgrelid IN (
           'public.merchants'::regclass, 'public.workspaces'::regclass))
     OR EXISTS (SELECT 1 FROM pg_trigger
         WHERE NOT tgisinternal AND tgrelid IN (
           'public.solo_plus_cases'::regclass,
           'public.solo_plus_case_requirements'::regclass,
           'public.solo_plus_case_events'::regclass,
           'public.payment_records'::regclass)
           AND tgname NOT IN (
             'trg_solo_plus_cases_updated_at',
             'trg_solo_plus_case_requirements_updated_at',
             'trg_payment_records_updated_at',
             'trg_phase2b_approve_payment_version',
             'trg_phase2b_approve_payment_insert_version',
             'trg_phase2b_approve_payment_delete_version',
             'trg_phase2b_approve_requirement_version',
             'trg_phase2b_approve_requirement_insert_version',
             'trg_phase2b_approve_requirement_delete_version',
             'trg_phase2b_approve_case_link_version'))
     OR EXISTS (SELECT 1 FROM public.solo_plus_cases
         WHERE audit_metadata ->> 'fixture_run_id' = v_run)
     OR EXISTS (SELECT 1 FROM public.payment_records
         WHERE metadata ->> 'fixture_run_id' = v_run
            OR internal_reference = 'phase2b-approve:' || v_run)
     OR EXISTS (SELECT 1 FROM public.merchants
         WHERE email = v_run || '@example.invalid') THEN
    RAISE EXCEPTION 'BLOCKED|APPROVE_STAGING|fixture_boundary';
  END IF;

  -- The synthetic merchant has no user, customer, instrument, provider,
  -- settlement destination, or real subscription. It is isolated by run ID.
  INSERT INTO public.merchants (
    id, business_name, email, subscription_plan, merchant_tier,
    onboarding_status, setup_mode, live_features_enabled
  ) VALUES (
    v_merchant, 'Phase 2B Approve Fixture ' || v_run,
    v_run || '@example.invalid', 'solo_lite', 'individual',
    'setup_mode', true, false
  );
  INSERT INTO public.workspaces (
    id, merchant_id, display_name, plan_type, onboarding_status,
    setup_mode, live_features_enabled
  ) VALUES (
    v_workspace, v_merchant, 'Phase 2B Approve Fixture ' || v_run,
    'solo_lite', 'setup_mode', true, false
  );
  UPDATE public.merchants SET workspace_id = v_workspace WHERE id = v_merchant;

  INSERT INTO public.solo_plus_cases (
    id, merchant_id, flow_origin, source_plan, target_plan,
    case_status, payment_status, refund_status, expected_amount,
    payment_currency, requirements_policy_version, active_plan_snapshot,
    idempotency_key, row_version, audit_metadata
  ) VALUES (
    v_case, v_merchant, 'upgrade', 'solo_lite', 'solo_plus',
    'awaiting_payment', 'pending', 'none', 100.00,
    'NGN', 'phase2b-approve-synthetic-v1', 'solo_lite',
    'phase2b-approve:case:' || v_run, 1,
    v_marker || jsonb_build_object('fixture_workspace_id', v_workspace::text)
  );
  INSERT INTO public.payment_records (
    id, merchant_id, solo_plus_case_id, payment_purpose,
    internal_reference, amount_paid, expected_amount, currency,
    payment_status, processing_status, account_setup_status, metadata
  ) VALUES (
    v_payment, v_merchant, v_case, 'plan_upgrade',
    'phase2b-approve:' || v_run, 100.00, 100.00, 'NGN',
    'successful', 'manual_review', 'manual_review', v_marker
  );
  UPDATE public.solo_plus_cases
  SET payment_record_id = v_payment, payment_status = 'paid',
      row_version = row_version + 1
  WHERE id = v_case;
  UPDATE public.solo_plus_cases
  SET case_status = 'manual_review', row_version = row_version + 1
  WHERE id = v_case;
  INSERT INTO public.solo_plus_case_requirements (
    case_id, requirement_code, requirement_state, evidence_source_type,
    evidence_source_id, completed_at, metadata
  )
  SELECT v_case, code, 'passed', 'manual_submission', gen_random_uuid(), now(), v_marker
  FROM unnest(ARRAY[
    'activity_profile', 'bvn', 'id_document', 'proof_of_address',
    'selfie_liveness', 'settlement_account'
  ]) AS code;
  IF (SELECT count(*) FROM public.solo_plus_case_requirements WHERE case_id = v_case) IS DISTINCT FROM 6
     OR (SELECT count(*) FROM public.payment_records
         WHERE solo_plus_case_id = v_case AND payment_status = 'successful') IS DISTINCT FROM 1
     OR (SELECT count(*) FROM public.solo_plus_cases
         WHERE id = v_case AND case_status = 'manual_review'
           AND payment_status = 'paid' AND payment_record_id = v_payment) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FAIL|APPROVE_STAGING|fixture_final_state';
  END IF;
END
$fixture$;
COMMIT;
SELECT 'PASS|APPROVE_STAGING|fixture_created|case_id=' || id::text ||
       '|row_version=' || row_version::text
FROM public.solo_plus_cases
WHERE audit_metadata ->> 'fixture_scope' = 'phase2b_approve_acceptance'
  AND audit_metadata ->> 'fixture_run_id' = :'fixture_run_id'
  AND audit_metadata ->> 'synthetic_approve_acceptance' = 'true';
SELECT id AS fixture_case_id FROM public.solo_plus_cases
WHERE audit_metadata ->> 'fixture_scope' = 'phase2b_approve_acceptance'
  AND audit_metadata ->> 'fixture_run_id' = :'fixture_run_id'
  AND audit_metadata ->> 'synthetic_approve_acceptance' = 'true'
\gset
\ir phase2b_approve_paid_staging_fixture_preflight.sql
