-- ============================================================
-- Allow Breet renewal crypto sessions and platform settlement mode
-- Aligns crypto_payment_sessions constraints with deployed
-- subscription renewal + platform auto-settlement behavior.
-- ============================================================

ALTER TABLE public.crypto_payment_sessions
  DROP CONSTRAINT IF EXISTS crypto_payment_sessions_payment_purpose_check;

ALTER TABLE public.crypto_payment_sessions
  ADD CONSTRAINT crypto_payment_sessions_payment_purpose_check
  CHECK (payment_purpose IN ('plan_subscription', 'plan_upgrade', 'plan_renewal'));

ALTER TABLE public.crypto_payment_sessions
  DROP CONSTRAINT IF EXISTS crypto_payment_sessions_settlement_mode_check;

ALTER TABLE public.crypto_payment_sessions
  ADD CONSTRAINT crypto_payment_sessions_settlement_mode_check
  CHECK (settlement_mode IN ('provider_direct', 'breet_auto_settlement', 'platform_auto_settlement', 'treasury_manual', 'disabled'));
