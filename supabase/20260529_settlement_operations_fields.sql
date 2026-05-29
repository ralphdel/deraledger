-- ============================================================
-- Settlement Operations Fields
-- Tracks who owns settlement movement without introducing merchant
-- withdrawals. DeraLedger does not hold provider-direct funds.
-- ============================================================

ALTER TABLE public.settlement_records
  ADD COLUMN IF NOT EXISTS settlement_mode TEXT NOT NULL DEFAULT 'provider_direct'
    CHECK (settlement_mode IN ('provider_direct', 'treasury_payout_required')),
  ADD COLUMN IF NOT EXISTS settlement_owner TEXT NOT NULL DEFAULT 'provider'
    CHECK (settlement_owner IN ('provider', 'deraledger_treasury', 'manual_review')),
  ADD COLUMN IF NOT EXISTS payout_action_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_reconciled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciliation_notes TEXT;

UPDATE public.settlement_records
SET
  settlement_mode = CASE
    WHEN provider_name = 'breet'
      AND raw_settlement_payload ? 'crypto_treasury_settlement_required'
      AND raw_settlement_payload->>'crypto_treasury_settlement_required' = 'true'
      THEN 'treasury_payout_required'
    ELSE 'provider_direct'
  END,
  settlement_owner = CASE
    WHEN settlement_status = 'manual_review' THEN 'manual_review'
    WHEN provider_name = 'breet'
      AND raw_settlement_payload ? 'crypto_treasury_settlement_required'
      AND raw_settlement_payload->>'crypto_treasury_settlement_required' = 'true'
      THEN 'deraledger_treasury'
    ELSE 'provider'
  END,
  payout_action_required = CASE
    WHEN provider_name = 'breet'
      AND raw_settlement_payload ? 'crypto_treasury_settlement_required'
      AND raw_settlement_payload->>'crypto_treasury_settlement_required' = 'true'
      THEN true
    ELSE false
  END
WHERE settlement_mode IS NULL
   OR settlement_owner IS NULL;

COMMENT ON COLUMN public.settlement_records.settlement_mode IS
  'provider_direct means the payment provider settles merchant funds directly. treasury_payout_required means DeraLedger treasury action is required.';

COMMENT ON COLUMN public.settlement_records.settlement_owner IS
  'Operational owner for settlement follow-up: provider, deraledger_treasury, or manual_review.';

COMMENT ON COLUMN public.settlement_records.payout_action_required IS
  'True only when DeraLedger treasury must release funds. This is not a merchant withdrawal flag.';
