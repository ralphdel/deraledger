\set ON_ERROR_STOP on
\ir phase2b_approve_paid_staging_preflight.sql
BEGIN READ ONLY;
SELECT set_config('deraledger.phase2b_expected_project_ref', :'expected_project_ref', true);
SELECT set_config('deraledger.phase2b_approve_run_id', :'fixture_run_id', true);
SELECT set_config('deraledger.phase2b_approve_case_id', :'fixture_case_id', true);
DO $guard$
DECLARE
  v_case public.solo_plus_cases%ROWTYPE;
  v_payment public.payment_records%ROWTYPE;
  v_run text := current_setting('deraledger.phase2b_approve_run_id');
  v_codes text[];
BEGIN
  IF current_setting('deraledger.phase2b_expected_project_ref') IS DISTINCT FROM 'fsjljliiyfchkwbjifzw'
     OR current_database() IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM 'postgres'
     OR v_run !~ '^phase2b-approve-[0-9]{8}-[a-z0-9]{3,16}$'
     OR (SELECT md5(replace(replace(prosrc,E'\r\n',E'\n'),E'\r',E'\n'))
         FROM pg_proc WHERE oid = to_regprocedure(
          'public.review_solo_plus_case_approve_atomic_v1(uuid,bigint,text,text,uuid,text,text,text)'))
        IS DISTINCT FROM '5cc81f443c678a15bed43de6df472077' THEN
    RAISE EXCEPTION 'BLOCKED|APPROVE_PREFLIGHT|target_or_rpc';
  END IF;
  SELECT * INTO v_case FROM public.solo_plus_cases
  WHERE id = current_setting('deraledger.phase2b_approve_case_id')::uuid;
  IF NOT FOUND OR v_case.audit_metadata ->> 'fixture_scope' IS DISTINCT FROM 'phase2b_approve_acceptance'
     OR v_case.audit_metadata ->> 'fixture_run_id' IS DISTINCT FROM v_run
     OR v_case.audit_metadata ->> 'synthetic_approve_acceptance' IS DISTINCT FROM 'true'
     OR v_case.flow_origin IS DISTINCT FROM 'upgrade' OR v_case.source_plan IS DISTINCT FROM 'solo_lite'
     OR v_case.onboarding_session_id IS NOT NULL
     OR v_case.case_status IS DISTINCT FROM 'manual_review' OR v_case.payment_status IS DISTINCT FROM 'paid'
     OR v_case.refund_status IS DISTINCT FROM 'none' OR v_case.payment_record_id IS NULL
     OR v_case.row_version < 1 OR v_case.approved_at IS NOT NULL
     OR v_case.rejected_at IS NOT NULL OR v_case.reopened_at IS NOT NULL
     OR v_case.activation_idempotency_key IS NOT NULL
     OR v_case.refund_idempotency_key IS NOT NULL
     OR v_case.payment_provider IS NOT NULL OR v_case.payment_reference IS NOT NULL
     OR v_case.expected_amount IS DISTINCT FROM 100.00 OR v_case.payment_currency IS DISTINCT FROM 'NGN'
     OR v_case.requirements_policy_version IS DISTINCT FROM 'phase2b-approve-synthetic-v1'
     OR EXISTS (SELECT 1 FROM public.solo_plus_case_events e WHERE e.case_id = v_case.id)
     OR (SELECT count(*) FROM public.solo_plus_cases c
         WHERE c.audit_metadata ->> 'fixture_run_id' = v_run) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'BLOCKED|APPROVE_PREFLIGHT|case_boundary';
  END IF;
  SELECT * INTO v_payment FROM public.payment_records WHERE id = v_case.payment_record_id;
  IF NOT FOUND OR v_payment.solo_plus_case_id IS DISTINCT FROM v_case.id
     OR v_payment.merchant_id IS DISTINCT FROM v_case.merchant_id
     OR v_payment.onboarding_session_id IS NOT NULL
     OR v_payment.payment_purpose IS DISTINCT FROM 'plan_upgrade'
     OR v_payment.payment_status IS DISTINCT FROM 'successful'
     OR v_payment.processing_status IS DISTINCT FROM 'manual_review'
     OR v_payment.account_setup_status IS DISTINCT FROM 'manual_review'
     OR v_payment.amount_paid IS DISTINCT FROM v_case.expected_amount
     OR v_payment.expected_amount IS DISTINCT FROM v_case.expected_amount
     OR v_payment.currency IS DISTINCT FROM v_case.payment_currency
     OR v_payment.internal_reference IS DISTINCT FROM 'phase2b-approve:' || v_run
     OR v_payment.provider_name IS NOT NULL OR v_payment.provider_reference IS NOT NULL
     OR v_payment.raw_provider_payload IS NOT NULL
     OR v_payment.metadata ->> 'fixture_scope' IS DISTINCT FROM 'phase2b_approve_acceptance'
     OR v_payment.metadata ->> 'fixture_run_id' IS DISTINCT FROM v_run
     OR v_payment.metadata ->> 'synthetic_approve_acceptance' IS DISTINCT FROM 'true'
     OR (SELECT count(*) FROM public.payment_records p
         WHERE p.solo_plus_case_id = v_case.id) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'BLOCKED|APPROVE_PREFLIGHT|payment_boundary';
  END IF;
  SELECT array_agg(requirement_code ORDER BY requirement_code) INTO v_codes
  FROM public.solo_plus_case_requirements WHERE case_id = v_case.id;
  IF v_codes IS DISTINCT FROM ARRAY[
       'activity_profile','bvn','id_document','proof_of_address',
       'selfie_liveness','settlement_account']::text[]
     OR EXISTS (SELECT 1 FROM public.solo_plus_case_requirements r
         WHERE r.case_id = v_case.id AND (
           r.requirement_state IS DISTINCT FROM 'passed' OR r.completed_at IS NULL
           OR r.evidence_source_type IS DISTINCT FROM 'manual_submission'
           OR r.evidence_source_id IS NULL OR r.verification_log_id IS NOT NULL
           OR r.provider_name IS NOT NULL OR r.provider_reference IS NOT NULL
           OR r.metadata ->> 'fixture_scope' IS DISTINCT FROM 'phase2b_approve_acceptance'
           OR r.metadata ->> 'fixture_run_id' IS DISTINCT FROM v_run
           OR r.metadata ->> 'synthetic_approve_acceptance' IS DISTINCT FROM 'true'))
     OR NOT EXISTS (SELECT 1 FROM public.merchants m
         JOIN public.workspaces w ON w.id = m.workspace_id AND w.merchant_id = m.id
         WHERE m.id = v_case.merchant_id
           AND m.email = v_run || '@example.invalid'
           AND m.business_name = 'Phase 2B Approve Fixture ' || v_run
           AND m.subscription_plan = 'solo_lite'
           AND m.setup_mode AND NOT m.live_features_enabled
           AND w.display_name = 'Phase 2B Approve Fixture ' || v_run
           AND w.plan_type = 'solo_lite'
           AND w.setup_mode AND NOT w.live_features_enabled)
     OR EXISTS (SELECT 1 FROM public.subscriptions WHERE merchant_id = v_case.merchant_id)
     OR EXISTS (SELECT 1 FROM public.workspace_subscriptions WHERE merchant_id = v_case.merchant_id)
     OR EXISTS (SELECT 1 FROM public.subscription_payments WHERE merchant_id = v_case.merchant_id)
     OR EXISTS (SELECT 1 FROM public.plan_migrations WHERE merchant_id = v_case.merchant_id)
     OR EXISTS (SELECT 1 FROM public.settlement_records WHERE payment_record_id = v_payment.id)
     OR EXISTS (SELECT 1 FROM public.settlement_batches WHERE merchant_id = v_case.merchant_id) THEN
    RAISE EXCEPTION 'BLOCKED|APPROVE_PREFLIGHT|requirements_or_side_effect_boundary';
  END IF;
END
$guard$;
\ir phase2b_approve_paid_staging_boundary.sql
SELECT 'PASS|APPROVE_PREFLIGHT|ready|row_version=' || c.row_version::text ||
       '|boundary=' || :'fixture_boundary'
FROM public.solo_plus_cases c
WHERE c.id = :'fixture_case_id'::uuid;
ROLLBACK;
