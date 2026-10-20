\set ON_ERROR_STOP on
-- Disposable PostgreSQL only. The outer transaction always rolls back.
BEGIN;

INSERT INTO public.merchants(id, business_name, email, subscription_plan, merchant_tier)
VALUES
  ('00000000-0000-4000-8000-00000002c101', 'Atomic renewal Lite', 'lite-renewal.invalid@example.invalid', 'individual', 'individual'),
  ('00000000-0000-4000-8000-00000002c201', 'Atomic renewal Business', 'business-renewal.invalid@example.invalid', 'corporate', 'corporate');

INSERT INTO public.subscriptions(
  id, merchant_id, plan_type, amount_paid, start_date, expiry_date, status
) VALUES
  ('00000000-0000-4000-8000-00000002c102', '00000000-0000-4000-8000-00000002c101', 'individual', 5000, now() - interval '30 days', now() + interval '2 days', 'active'),
  ('00000000-0000-4000-8000-00000002c202', '00000000-0000-4000-8000-00000002c201', 'corporate', 20000, now() - interval '30 days', now() - interval '2 days', 'expired');

INSERT INTO public.payment_records(
  id, merchant_id, payment_purpose, provider_name, internal_reference,
  provider_reference, expected_amount, amount_paid, currency, payment_status,
  processing_status, account_setup_status, plan_id, plan_name
) VALUES
  ('00000000-0000-4000-8000-00000002c103', '00000000-0000-4000-8000-00000002c101', 'plan_renewal', 'paystack', 'phase2c-renew-lite', NULL, 5000, 0, 'NGN', 'pending', 'pending_payment', 'pending_payment', 'individual', 'solo_lite'),
  ('00000000-0000-4000-8000-00000002c203', '00000000-0000-4000-8000-00000002c201', 'plan_renewal', 'monnify', 'phase2c-renew-business', NULL, 20000, 0, 'NGN', 'pending', 'pending_payment', 'pending_payment', 'corporate', 'business');

DO $test$
DECLARE
  v_before timestamptz;
  v_after timestamptz;
  v_result jsonb;
BEGIN
  SELECT expiry_date INTO v_before FROM public.subscriptions WHERE id = '00000000-0000-4000-8000-00000002c102';
  v_result := public.confirm_fiat_plan_renewal_v1(
    '00000000-0000-4000-8000-00000002c103', 'paystack', 'phase2c-renew-lite',
    'provider-lite-1', 500000, 'NGN', '00000000-0000-4000-8000-00000002c101',
    'solo_lite', '{"source":"disposable-self-test"}'::jsonb
  );
  IF v_result->>'kind' <> 'applied' THEN RAISE EXCEPTION 'Lite renewal did not apply: %', v_result; END IF;
  SELECT expiry_date INTO v_after FROM public.subscriptions WHERE id = '00000000-0000-4000-8000-00000002c102';
  IF v_after IS DISTINCT FROM v_before + interval '30 days' THEN RAISE EXCEPTION 'Lite expiry delta was not 30 days'; END IF;
  IF (SELECT count(*) FROM public.subscription_payments WHERE paystack_ref = 'phase2c-renew-lite') <> 1 THEN RAISE EXCEPTION 'Lite ledger count mismatch'; END IF;

  v_result := public.confirm_fiat_plan_renewal_v1(
    '00000000-0000-4000-8000-00000002c103', 'paystack', 'phase2c-renew-lite',
    'provider-lite-1', 500000, 'NGN', '00000000-0000-4000-8000-00000002c101',
    'solo_lite', '{"source":"disposable-self-test-replay"}'::jsonb
  );
  IF v_result->>'kind' <> 'already_processed' THEN RAISE EXCEPTION 'Lite replay was not idempotent: %', v_result; END IF;
  IF (SELECT expiry_date FROM public.subscriptions WHERE id = '00000000-0000-4000-8000-00000002c102') IS DISTINCT FROM v_after THEN RAISE EXCEPTION 'Replay extended Lite twice'; END IF;

  v_result := public.confirm_fiat_plan_renewal_v1(
    '00000000-0000-4000-8000-00000002c203', 'monnify', 'phase2c-renew-business',
    'provider-business-1', 2000000, 'NGN', '00000000-0000-4000-8000-00000002c201',
    'business', '{"source":"disposable-self-test"}'::jsonb
  );
  IF v_result->>'kind' <> 'applied' THEN RAISE EXCEPTION 'Business renewal did not apply: %', v_result; END IF;
  IF (SELECT count(*) FROM public.subscription_payments WHERE paystack_ref = 'phase2c-renew-business') <> 1 THEN RAISE EXCEPTION 'Business ledger count mismatch'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_records
    WHERE id = '00000000-0000-4000-8000-00000002c203'
      AND payment_status = 'successful' AND processing_status = 'processed'
      AND account_setup_status = 'active' AND amount_paid = 20000
  ) THEN RAISE EXCEPTION 'Business payment state is incoherent'; END IF;
END;
$test$;
\echo PASS|PHASE2C_RENEWAL|lite_business_replay

-- Every mismatch is evaluated on a fresh pending record and must leave it pending.
INSERT INTO public.payment_records(
  id, merchant_id, payment_purpose, provider_name, internal_reference,
  expected_amount, amount_paid, currency, payment_status, processing_status,
  account_setup_status, plan_id, plan_name
)
SELECT ('00000000-0000-4000-8000-00000002c' || suffix)::uuid,
       '00000000-0000-4000-8000-00000002c101', purpose, 'paystack', reference,
       expected_amount, 0, currency, 'pending', 'pending_payment', 'pending_payment', plan_id, plan_name
FROM (VALUES
  ('301', 'plan_renewal', 'phase2c-mismatch-plan', 5000::numeric, 'NGN', 'individual', 'solo_lite'),
  ('302', 'plan_renewal', 'phase2c-mismatch-amount', 5000::numeric, 'NGN', 'individual', 'solo_lite'),
  ('303', 'plan_renewal', 'phase2c-mismatch-currency', 5000::numeric, 'NGN', 'individual', 'solo_lite'),
  ('304', 'plan_renewal', 'phase2c-mismatch-provider', 5000::numeric, 'NGN', 'individual', 'solo_lite'),
  ('305', 'plan_renewal', 'phase2c-mismatch-reference', 5000::numeric, 'NGN', 'individual', 'solo_lite'),
  ('306', 'plan_subscription', 'phase2c-wrong-purpose', 5000::numeric, 'NGN', 'individual', 'solo_lite'),
  ('307', 'plan_renewal', 'phase2c-solo-plus', 13000::numeric, 'NGN', 'solo_plus', 'solo_plus'),
  ('308', 'plan_renewal', 'phase2c-starter', 0::numeric, 'NGN', 'starter', 'starter'),
  ('309', 'plan_renewal', 'phase2c-unsupported', 5000::numeric, 'NGN', 'mystery', 'mystery')
) AS fixture(suffix, purpose, reference, expected_amount, currency, plan_id, plan_name);

DO $test$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.confirm_fiat_plan_renewal_v1('00000000-0000-4000-8000-00000002c301', 'paystack', 'phase2c-mismatch-plan', 'p-301', 500000, 'NGN', '00000000-0000-4000-8000-00000002c101', 'business', '{}'::jsonb);
  IF v_result->>'kind' <> 'state_conflict' THEN RAISE EXCEPTION 'Plan mismatch did not fail closed'; END IF;
  v_result := public.confirm_fiat_plan_renewal_v1('00000000-0000-4000-8000-00000002c302', 'paystack', 'phase2c-mismatch-amount', 'p-302', 499999, 'NGN', '00000000-0000-4000-8000-00000002c101', 'solo_lite', '{}'::jsonb);
  IF v_result->>'kind' <> 'state_conflict' THEN RAISE EXCEPTION 'Amount mismatch did not fail closed'; END IF;
  v_result := public.confirm_fiat_plan_renewal_v1('00000000-0000-4000-8000-00000002c303', 'paystack', 'phase2c-mismatch-currency', 'p-303', 500000, 'USD', '00000000-0000-4000-8000-00000002c101', 'solo_lite', '{}'::jsonb);
  IF v_result->>'kind' <> 'state_conflict' THEN RAISE EXCEPTION 'Currency mismatch did not fail closed'; END IF;
  v_result := public.confirm_fiat_plan_renewal_v1('00000000-0000-4000-8000-00000002c304', 'monnify', 'phase2c-mismatch-provider', 'p-304', 500000, 'NGN', '00000000-0000-4000-8000-00000002c101', 'solo_lite', '{}'::jsonb);
  IF v_result->>'kind' <> 'state_conflict' THEN RAISE EXCEPTION 'Provider mismatch did not fail closed'; END IF;
  v_result := public.confirm_fiat_plan_renewal_v1('00000000-0000-4000-8000-00000002c305', 'paystack', 'wrong-reference', 'p-305', 500000, 'NGN', '00000000-0000-4000-8000-00000002c101', 'solo_lite', '{}'::jsonb);
  IF v_result->>'kind' <> 'state_conflict' THEN RAISE EXCEPTION 'Reference mismatch did not fail closed'; END IF;
  v_result := public.confirm_fiat_plan_renewal_v1('00000000-0000-4000-8000-00000002c306', 'paystack', 'phase2c-wrong-purpose', 'p-306', 500000, 'NGN', '00000000-0000-4000-8000-00000002c101', 'solo_lite', '{}'::jsonb);
  IF v_result->>'kind' <> 'state_conflict' THEN RAISE EXCEPTION 'Wrong purpose did not fail closed'; END IF;
  v_result := public.confirm_fiat_plan_renewal_v1('00000000-0000-4000-8000-00000002c307', 'paystack', 'phase2c-solo-plus', 'p-307', 1300000, 'NGN', '00000000-0000-4000-8000-00000002c101', 'solo_plus', '{}'::jsonb);
  IF v_result->>'kind' <> 'state_conflict' THEN RAISE EXCEPTION 'Solo Plus did not fail closed'; END IF;
  v_result := public.confirm_fiat_plan_renewal_v1('00000000-0000-4000-8000-00000002c308', 'paystack', 'phase2c-starter', 'p-308', 1, 'NGN', '00000000-0000-4000-8000-00000002c101', 'starter', '{}'::jsonb);
  IF v_result->>'kind' <> 'state_conflict' THEN RAISE EXCEPTION 'Starter did not fail closed'; END IF;
  v_result := public.confirm_fiat_plan_renewal_v1('00000000-0000-4000-8000-00000002c309', 'paystack', 'phase2c-unsupported', 'p-309', 500000, 'NGN', '00000000-0000-4000-8000-00000002c101', 'unknown', '{}'::jsonb);
  IF v_result->>'kind' <> 'state_conflict' THEN RAISE EXCEPTION 'Unsupported plan did not fail closed'; END IF;
END;
$test$;
\echo PASS|PHASE2C_RENEWAL|mismatch_fail_closed

-- A forced ledger failure is caught by a PL/pgSQL subtransaction. The RPC's
-- preceding subscription update must roll back with the failed insert.
CREATE OR REPLACE FUNCTION pg_temp.phase2c_force_ledger_failure()
RETURNS trigger LANGUAGE plpgsql AS $trigger$
BEGIN
  IF NEW.paystack_ref = 'phase2c-forced-failure' THEN
    RAISE EXCEPTION 'deliberate disposable renewal ledger failure';
  END IF;
  RETURN NEW;
END;
$trigger$;
CREATE TRIGGER phase2c_force_ledger_failure
BEFORE INSERT ON public.subscription_payments
FOR EACH ROW EXECUTE FUNCTION pg_temp.phase2c_force_ledger_failure();

INSERT INTO public.payment_records(
  id, merchant_id, payment_purpose, provider_name, internal_reference,
  expected_amount, amount_paid, currency, payment_status, processing_status,
  account_setup_status, plan_id, plan_name
) VALUES (
  '00000000-0000-4000-8000-00000002c401', '00000000-0000-4000-8000-00000002c101',
  'plan_renewal', 'paystack', 'phase2c-forced-failure', 5000, 0, 'NGN',
  'pending', 'pending_payment', 'pending_payment', 'individual', 'solo_lite'
);

DO $test$
DECLARE
  v_before timestamptz;
BEGIN
  SELECT expiry_date INTO v_before FROM public.subscriptions WHERE id = '00000000-0000-4000-8000-00000002c102';
  BEGIN
    PERFORM public.confirm_fiat_plan_renewal_v1(
      '00000000-0000-4000-8000-00000002c401', 'paystack', 'phase2c-forced-failure',
      'p-401', 500000, 'NGN', '00000000-0000-4000-8000-00000002c101', 'solo_lite', '{}'::jsonb
    );
    RAISE EXCEPTION 'Forced ledger failure unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM IS DISTINCT FROM 'deliberate disposable renewal ledger failure' THEN RAISE; END IF;
  END;
  IF (SELECT expiry_date FROM public.subscriptions WHERE id = '00000000-0000-4000-8000-00000002c102') IS DISTINCT FROM v_before THEN RAISE EXCEPTION 'Forced failure left an expiry mutation'; END IF;
  IF EXISTS (SELECT 1 FROM public.subscription_payments WHERE paystack_ref = 'phase2c-forced-failure') THEN RAISE EXCEPTION 'Forced failure left a ledger row'; END IF;
  IF (SELECT payment_status FROM public.payment_records WHERE id = '00000000-0000-4000-8000-00000002c401') <> 'pending' THEN RAISE EXCEPTION 'Forced failure changed payment status'; END IF;
END;
$test$;
DROP TRIGGER phase2c_force_ledger_failure ON public.subscription_payments;
\echo PASS|PHASE2C_RENEWAL|forced_failure_rollback

-- Runtime ambiguity defense remains explicit even if the prerequisite unique
-- key is deliberately removed inside this rolled-back disposable test.
ALTER TABLE public.subscriptions DROP CONSTRAINT subscriptions_merchant_id_key;
INSERT INTO public.subscriptions(
  id, merchant_id, plan_type, amount_paid, start_date, expiry_date, status
) VALUES (
  '00000000-0000-4000-8000-00000002c501', '00000000-0000-4000-8000-00000002c101',
  'individual', 5000, now() - interval '30 days', now() + interval '1 day', 'active'
);
INSERT INTO public.payment_records(
  id, merchant_id, payment_purpose, provider_name, internal_reference,
  expected_amount, amount_paid, currency, payment_status, processing_status,
  account_setup_status, plan_id, plan_name
) VALUES (
  '00000000-0000-4000-8000-00000002c502', '00000000-0000-4000-8000-00000002c101',
  'plan_renewal', 'paystack', 'phase2c-ambiguous-subscription', 5000, 0, 'NGN',
  'pending', 'pending_payment', 'pending_payment', 'individual', 'solo_lite'
);
DO $test$
DECLARE v_result jsonb;
BEGIN
  v_result := public.confirm_fiat_plan_renewal_v1(
    '00000000-0000-4000-8000-00000002c502', 'paystack', 'phase2c-ambiguous-subscription',
    'p-502', 500000, 'NGN', '00000000-0000-4000-8000-00000002c101', 'solo_lite', '{}'::jsonb
  );
  IF v_result->>'kind' <> 'state_conflict' OR v_result->>'reason' <> 'subscription_ambiguous_or_missing' THEN
    RAISE EXCEPTION 'Ambiguous subscriptions did not fail closed: %', v_result;
  END IF;
END;
$test$;
\echo PASS|PHASE2C_RENEWAL|ambiguous_subscription_fail_closed

ROLLBACK;
\echo PASS|PHASE2C_RENEWAL|self_test_rolled_back
