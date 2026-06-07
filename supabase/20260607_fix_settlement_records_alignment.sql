-- ============================================================
-- Settlement records alignment repair
-- Ensures Breet/provider-neutral settlement columns exist in
-- environments that missed earlier settlement migrations.
-- ============================================================

ALTER TABLE public.settlement_records
  ADD COLUMN IF NOT EXISTS settlement_recipient_type TEXT,
  ADD COLUMN IF NOT EXISTS settlement_currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS settlement_mode TEXT NOT NULL DEFAULT 'provider_direct',
  ADD COLUMN IF NOT EXISTS settlement_owner TEXT NOT NULL DEFAULT 'provider',
  ADD COLUMN IF NOT EXISTS payout_action_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS provider_fee_source TEXT,
  ADD COLUMN IF NOT EXISTS expected_settlement_source TEXT;

ALTER TABLE public.settlement_records
  DROP CONSTRAINT IF EXISTS settlement_records_settlement_mode_check;

ALTER TABLE public.settlement_records
  ADD CONSTRAINT settlement_records_settlement_mode_check
  CHECK (settlement_mode IN ('provider_direct', 'breet_auto_settlement', 'platform_auto_settlement', 'treasury_manual', 'treasury_payout_required', 'disabled'));

ALTER TABLE public.settlement_records
  DROP CONSTRAINT IF EXISTS settlement_records_settlement_owner_check;

ALTER TABLE public.settlement_records
  ADD CONSTRAINT settlement_records_settlement_owner_check
  CHECK (settlement_owner IN ('provider', 'deraledger_treasury', 'manual_review'));
