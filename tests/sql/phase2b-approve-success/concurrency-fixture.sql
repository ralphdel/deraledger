-- Committed only on the dedicated local race clone. Three independent fake cases.
BEGIN;
INSERT INTO auth.users(id) VALUES
  ('00000000-0000-4000-8000-00000000e113'),
  ('00000000-0000-4000-8000-00000000e213'),
  ('00000000-0000-4000-8000-00000000e313');
INSERT INTO public.merchants(id, business_name, email) VALUES
  ('00000000-0000-4000-8000-00000000e111', 'Local same-key race', 'same.invalid@example.invalid'),
  ('00000000-0000-4000-8000-00000000e211', 'Local different-key race', 'different.invalid@example.invalid'),
  ('00000000-0000-4000-8000-00000000e311', 'Local child-writer race', 'child.invalid@example.invalid');
INSERT INTO public.solo_plus_cases(
  id, merchant_id, flow_origin, source_plan, case_status, payment_status,
  expected_amount, requirements_policy_version, idempotency_key, row_version,
  audit_metadata)
SELECT ('00000000-0000-4000-8000-00000000e' || n || '10')::uuid,
  ('00000000-0000-4000-8000-00000000e' || n || '11')::uuid,
  'upgrade', 'solo_lite', 'awaiting_payment', 'pending', 100,
  'local-approve-race', 'local-race-case-' || n, 1,
  jsonb_build_object('fixture_scope', 'phase2b_approve_acceptance',
    'fixture_run_id', 'phase2b-approve-20261016-race00' || n,
    'synthetic_approve_acceptance', true)
FROM generate_series(1,3) AS n;
INSERT INTO public.payment_records(id, merchant_id, solo_plus_case_id,
  payment_purpose, internal_reference, amount_paid, expected_amount,
  currency, payment_status, metadata)
SELECT ('00000000-0000-4000-8000-00000000e' || n || '12')::uuid,
  ('00000000-0000-4000-8000-00000000e' || n || '11')::uuid,
  ('00000000-0000-4000-8000-00000000e' || n || '10')::uuid,
  'plan_upgrade', 'local-race-payment-' || n, 100, 100, 'NGN', 'successful',
  jsonb_build_object('fixture_scope', 'phase2b_approve_acceptance',
    'fixture_run_id', 'phase2b-approve-20261016-race00' || n,
    'synthetic_approve_acceptance', true)
FROM generate_series(1,3) AS n;
UPDATE public.solo_plus_cases c SET payment_record_id =
  ('00000000-0000-4000-8000-00000000e' || substring(c.id::text from 34 for 1) || '12')::uuid,
  payment_status = 'paid', row_version = row_version + 1
WHERE c.id IN ('00000000-0000-4000-8000-00000000e110',
               '00000000-0000-4000-8000-00000000e210',
               '00000000-0000-4000-8000-00000000e310');
UPDATE public.solo_plus_cases SET case_status = 'manual_review',
  row_version = row_version + 1
WHERE id IN ('00000000-0000-4000-8000-00000000e110',
             '00000000-0000-4000-8000-00000000e210',
             '00000000-0000-4000-8000-00000000e310');
INSERT INTO public.solo_plus_case_requirements(case_id, requirement_code,
  requirement_state, evidence_source_type, evidence_source_id, completed_at, metadata)
SELECT c.id, code, 'passed', 'manual_submission', gen_random_uuid(), now(),
  jsonb_build_object('fixture_scope', 'phase2b_approve_acceptance',
    'fixture_run_id', c.audit_metadata->>'fixture_run_id',
    'synthetic_approve_acceptance', true)
FROM public.solo_plus_cases c
CROSS JOIN unnest(ARRAY['activity_profile', 'bvn', 'id_document',
  'proof_of_address', 'selfie_liveness', 'settlement_account']) AS code
WHERE c.id IN ('00000000-0000-4000-8000-00000000e110',
               '00000000-0000-4000-8000-00000000e210',
               '00000000-0000-4000-8000-00000000e310');
COMMIT;
\echo PASS|APPROVE_SUCCESS|concurrency_fixture_ready
