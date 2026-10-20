\set ON_ERROR_STOP on
-- Dedicated disposable database only. Teardown is database deletion.
BEGIN;
INSERT INTO public.merchants(id, business_name, email, subscription_plan, merchant_tier)
VALUES ('00000000-0000-4000-8000-00000002c601', 'Atomic renewal race', 'renewal-race.invalid@example.invalid', 'individual', 'individual');
INSERT INTO public.subscriptions(id, merchant_id, plan_type, amount_paid, start_date, expiry_date, status)
VALUES ('00000000-0000-4000-8000-00000002c602', '00000000-0000-4000-8000-00000002c601', 'individual', 5000, now() - interval '30 days', now() + interval '1 day', 'active');
INSERT INTO public.payment_records(
  id, merchant_id, payment_purpose, provider_name, internal_reference,
  expected_amount, amount_paid, currency, payment_status, processing_status,
  account_setup_status, plan_id, plan_name
) VALUES (
  '00000000-0000-4000-8000-00000002c603', '00000000-0000-4000-8000-00000002c601',
  'plan_renewal', 'paystack', 'phase2c-renewal-race', 5000, 0, 'NGN',
  'pending', 'pending_payment', 'pending_payment', 'individual', 'solo_lite'
);
COMMIT;
\echo PASS|PHASE2C_RENEWAL|concurrency_fixture_ready
