-- Included inside a transaction by each behavior probe. Upgrade-only fake data.
INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-00000000e013');
INSERT INTO public.merchants(id, business_name, email)
VALUES ('00000000-0000-4000-8000-00000000e011', 'Local approve probe', 'approve.invalid@example.invalid');
INSERT INTO public.solo_plus_cases(
  id, merchant_id, flow_origin, source_plan, case_status, payment_status,
  expected_amount, requirements_policy_version, idempotency_key, row_version, audit_metadata
) VALUES (
  '00000000-0000-4000-8000-00000000e010',
  '00000000-0000-4000-8000-00000000e011', 'upgrade', 'solo_lite',
  'awaiting_payment', 'pending', 100.00, 'local-approve-success',
  'local-approve-success-case', 1,
  '{"fixture_scope":"phase2b_approve_acceptance","fixture_run_id":"phase2b-approve-20261016-local001","synthetic_approve_acceptance":true}'::jsonb
);
INSERT INTO public.payment_records(
  id, merchant_id, solo_plus_case_id, payment_purpose, internal_reference,
  amount_paid, expected_amount, currency, payment_status, metadata
) VALUES (
  '00000000-0000-4000-8000-00000000e012',
  '00000000-0000-4000-8000-00000000e011',
  '00000000-0000-4000-8000-00000000e010',
  'plan_upgrade', 'local-approve-success-payment', 100.00, 100.00, 'NGN', 'successful',
  '{"fixture_scope":"phase2b_approve_acceptance","fixture_run_id":"phase2b-approve-20261016-local001","synthetic_approve_acceptance":true}'::jsonb
);
UPDATE public.solo_plus_cases SET
  payment_record_id = '00000000-0000-4000-8000-00000000e012',
  payment_status = 'paid', row_version = row_version + 1
WHERE id = '00000000-0000-4000-8000-00000000e010';
UPDATE public.solo_plus_cases SET case_status = 'manual_review', row_version = row_version + 1
WHERE id = '00000000-0000-4000-8000-00000000e010';
INSERT INTO public.solo_plus_case_requirements(
  case_id, requirement_code, requirement_state, evidence_source_type,
  evidence_source_id, completed_at, metadata
)
SELECT '00000000-0000-4000-8000-00000000e010'::uuid,
       code, 'passed', 'manual_submission', gen_random_uuid(), now(),
       '{"fixture_scope":"phase2b_approve_acceptance","fixture_run_id":"phase2b-approve-20261016-local001","synthetic_approve_acceptance":true}'::jsonb
FROM unnest(ARRAY[
  'activity_profile', 'bvn', 'id_document', 'proof_of_address',
  'selfie_liveness', 'settlement_account'
]) AS code;
