-- ============================================================
-- Allow pre-merchant subscription payment audit events
-- Subscription/onboarding payments can be verified before a
-- merchant row exists, so payment_events.merchant_id must be nullable.
-- ============================================================

ALTER TABLE public.payment_events
  ALTER COLUMN merchant_id DROP NOT NULL;

