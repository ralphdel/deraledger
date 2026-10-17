-- Exercise only the local synthetic confirmation/recovery version boundary.
BEGIN;
INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-00000000e023');
INSERT INTO public.merchants(id, business_name, email)
VALUES ('00000000-0000-4000-8000-00000000e021', 'Local pending probe', 'pending.invalid@example.invalid');
INSERT INTO public.solo_plus_cases(
  id, merchant_id, flow_origin, source_plan, case_status, payment_status,
  expected_amount, requirements_policy_version, idempotency_key, row_version, audit_metadata
) VALUES ('00000000-0000-4000-8000-00000000e020',
  '00000000-0000-4000-8000-00000000e021', 'upgrade', 'solo_lite',
  'awaiting_payment', 'pending', 100, 'local-approve-success', 'local-pending-case', 1,
  '{"fixture_scope":"phase2b_approve_acceptance","fixture_run_id":"phase2b-approve-20261016-local002","synthetic_approve_acceptance":true}'::jsonb);
INSERT INTO public.payment_records(id, merchant_id, solo_plus_case_id, payment_purpose,
  provider_name, provider_reference, internal_reference, amount_paid, expected_amount,
  currency, payment_status, metadata)
VALUES ('00000000-0000-4000-8000-00000000e022',
  '00000000-0000-4000-8000-00000000e021', '00000000-0000-4000-8000-00000000e020',
  'plan_upgrade', 'paystack', 'local-pending-reference', 'local-pending-reference',
  0, 100, 'NGN', 'pending', '{}'::jsonb);
UPDATE public.solo_plus_cases SET payment_record_id = '00000000-0000-4000-8000-00000000e022',
  row_version = row_version + 1 WHERE id = '00000000-0000-4000-8000-00000000e020';
SAVEPOINT before_confirmation;
DO $$
DECLARE v_before integer;
v_after integer;
v_result jsonb;
BEGIN
  SELECT row_version INTO v_before FROM public.solo_plus_cases
    WHERE id = '00000000-0000-4000-8000-00000000e020';
  v_result := public.confirm_solo_plus_payment_v1(
    'local-pending-reference', 'paystack', 'local-pending-reference',
    'plan_upgrade', '100.00', 'NGN',
    '00000000-0000-4000-8000-00000000e021', NULL, NULL, '{}'::jsonb,
    'local-confirmation-key');
  SELECT row_version INTO v_after FROM public.solo_plus_cases
    WHERE id = '00000000-0000-4000-8000-00000000e020';
  IF v_result->>'kind' <> 'confirmed' OR v_after <> v_before + 1 THEN
    RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|confirmation_version';
  END IF;
  RAISE NOTICE 'PASS|APPROVE_SUCCESS|confirmation_version|before=%|after=%', v_before, v_after;
END $$;
ROLLBACK TO SAVEPOINT before_confirmation;
DO $$
DECLARE v_before integer;
v_after integer;
v_result jsonb;
BEGIN
  SELECT row_version INTO v_before FROM public.solo_plus_cases
    WHERE id = '00000000-0000-4000-8000-00000000e020';
  v_result := public.recover_solo_plus_payment_attempt_v1(
    '00000000-0000-4000-8000-00000000e022',
    '00000000-0000-4000-8000-00000000e020',
    '00000000-0000-4000-8000-00000000e021',
    'local-recovery-key', 'unpaid_unrecoverable', 'local synthetic test',
    'monnify', 'card');
  SELECT row_version INTO v_after FROM public.solo_plus_cases
    WHERE id = '00000000-0000-4000-8000-00000000e020';
  IF v_result->>'kind' <> 'applied' OR v_after <> v_before + 1 THEN
    RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|recovery_version';
  END IF;
  RAISE NOTICE 'PASS|APPROVE_SUCCESS|recovery_version|before=%|after=%', v_before, v_after;
END $$;
ROLLBACK;
