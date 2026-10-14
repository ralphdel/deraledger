-- Dedicated disposable clone only. Never mix with verify-behavior.sql.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-00000000f013');
INSERT INTO public.merchants(id, business_name, email)
VALUES ('00000000-0000-4000-8000-00000000f011', 'Local race probe', 'race.invalid@example.invalid');
INSERT INTO public.solo_plus_cases(
  id, merchant_id, flow_origin, source_plan, case_status, payment_status,
  expected_amount, requirements_policy_version, idempotency_key, row_version, audit_metadata
) VALUES (
  '00000000-0000-4000-8000-00000000f010',
  '00000000-0000-4000-8000-00000000f011',
  'upgrade', 'solo_lite', 'manual_review', 'paid', 100.00,
  'local-approve-probe', 'local-race-case', 1,
  '{"fixture_scope":"phase2b_approve_acceptance","fixture_run_id":"phase2b-approve-20261014-local001","synthetic_approve_acceptance":true}'::jsonb
);
INSERT INTO public.payment_records(
  id, merchant_id, solo_plus_case_id, payment_purpose, internal_reference,
  amount_paid, expected_amount, currency, payment_status, metadata
) VALUES (
  '00000000-0000-4000-8000-00000000f012',
  '00000000-0000-4000-8000-00000000f011',
  '00000000-0000-4000-8000-00000000f010',
  'plan_upgrade', 'local-race-payment', 100.00, 100.00, 'NGN', 'successful',
  '{"fixture_scope":"phase2b_approve_acceptance","fixture_run_id":"phase2b-approve-20261014-local001","synthetic_approve_acceptance":true}'::jsonb
);
UPDATE public.solo_plus_cases
SET payment_record_id = '00000000-0000-4000-8000-00000000f012'
WHERE id = '00000000-0000-4000-8000-00000000f010';
INSERT INTO public.solo_plus_case_requirements(
  case_id, requirement_code, requirement_state, evidence_source_type,
  evidence_source_id, completed_at, metadata
)
SELECT '00000000-0000-4000-8000-00000000f010'::uuid,
       code, 'passed', 'manual_submission', gen_random_uuid(), now(),
       '{"fixture_scope":"phase2b_approve_acceptance","fixture_run_id":"phase2b-approve-20261014-local001","synthetic_approve_acceptance":true}'::jsonb
FROM unnest(ARRAY[
  'activity_profile', 'bvn', 'id_document', 'proof_of_address',
  'selfie_liveness', 'settlement_account'
]) AS code;
COMMIT;
\echo PASS|APPROVE_ATOMICITY|local_race_fixture_ready
