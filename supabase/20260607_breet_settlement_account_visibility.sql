-- ============================================================
-- Breet settlement account visibility
-- Adds masked settlement snapshot fields for crypto settlement
-- records so admin accounting can display Breet auto-settlement
-- destinations without exposing full account numbers.
-- ============================================================

ALTER TABLE public.settlement_records
  ADD COLUMN IF NOT EXISTS settlement_account_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS settlement_bank_name TEXT,
  ADD COLUMN IF NOT EXISTS settlement_account_name TEXT,
  ADD COLUMN IF NOT EXISTS settlement_account_number_masked TEXT,
  ADD COLUMN IF NOT EXISTS provider_bank_id TEXT,
  ADD COLUMN IF NOT EXISTS wallet_address TEXT,
  ADD COLUMN IF NOT EXISTS tx_hash TEXT;
