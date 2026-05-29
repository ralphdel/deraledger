-- ============================================================
-- Provider-reported Settlement Sources
-- Settlement amounts should come from provider webhook/API data.
-- If a provider sends neither fee nor settlement amount, keep the
-- settlement in manual review instead of calculating a hardcoded fee.
-- ============================================================

ALTER TABLE public.settlement_records
  ALTER COLUMN expected_settlement DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS provider_fee_source TEXT,
  ADD COLUMN IF NOT EXISTS expected_settlement_source TEXT;

COMMENT ON COLUMN public.settlement_records.expected_settlement IS
  'Expected merchant settlement. Null means the provider did not supply settlement amount or fee data and reconciliation/manual review is required.';

COMMENT ON COLUMN public.settlement_records.provider_fee_source IS
  'Source used to determine provider fee: provider_settlement_amount, provider_fee, provider_missing, or reconciliation.';

COMMENT ON COLUMN public.settlement_records.expected_settlement_source IS
  'Source used to determine expected settlement: provider_settlement_amount, provider_fee, provider_missing, or reconciliation.';

UPDATE public.settlement_records sr
SET
  provider_fee = 0,
  merchant_fee = 0,
  customer_fee = 0,
  expected_settlement = NULL,
  settlement_status = 'manual_review',
  provider_fee_source = 'provider_missing',
  expected_settlement_source = 'provider_missing',
  raw_settlement_payload = COALESCE(sr.raw_settlement_payload, '{}'::jsonb) || jsonb_build_object(
    'settlement_calculation_note',
    'Paystack fee/settlement amount was not present in stored provider payload; hardcoded fee estimate removed.'
  ),
  updated_at = now()
WHERE sr.provider_name = 'paystack'
  AND COALESCE(sr.settlement_status, '') <> 'completed'
  AND (
    sr.raw_settlement_payload IS NULL
    OR (
      sr.raw_settlement_payload ? 'source'
      AND sr.raw_settlement_payload->>'source' = 'legacy_transactions'
    )
    OR (
      NOT (sr.raw_settlement_payload ? 'fees')
      AND NOT (sr.raw_settlement_payload ? 'data')
    )
  );
