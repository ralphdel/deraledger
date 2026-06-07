-- ============================================================
-- Allow onboarding session processing lock status
-- Successful subscription confirmation temporarily marks an
-- onboarding session as processing before payment_confirmed.
-- ============================================================

ALTER TABLE public.onboarding_sessions
  DROP CONSTRAINT IF EXISTS onboarding_sessions_status_check;

ALTER TABLE public.onboarding_sessions
  ADD CONSTRAINT onboarding_sessions_status_check
  CHECK (status IN ('awaiting_payment', 'processing', 'payment_confirmed', 'activated', 'expired'));
