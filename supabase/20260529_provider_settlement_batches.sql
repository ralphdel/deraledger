-- ============================================================
-- Provider Settlement Batches
-- Tracks provider-direct bank settlement drops without introducing
-- merchant withdrawals. One provider batch can settle many payment
-- settlement records.
-- ============================================================

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.provider_settlement_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name TEXT NOT NULL
    CHECK (provider_name IN ('paystack', 'monnify', 'breet', 'future_provider')),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  settlement_account_id UUID REFERENCES public.merchant_settlement_accounts(id) ON DELETE SET NULL,
  provider_settlement_account_id UUID REFERENCES public.merchant_provider_settlement_accounts(id) ON DELETE SET NULL,
  provider_batch_reference TEXT,
  settlement_mode TEXT NOT NULL DEFAULT 'provider_direct'
    CHECK (settlement_mode IN ('provider_direct', 'treasury_payout_required')),
  settlement_owner TEXT NOT NULL DEFAULT 'provider'
    CHECK (settlement_owner IN ('provider', 'deraledger_treasury', 'manual_review')),
  gross_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  expected_settlement_total NUMERIC(18,2),
  actual_settlement_total NUMERIC(18,2),
  settlement_difference NUMERIC(18,2),
  settlement_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (settlement_status IN ('pending', 'processing', 'completed', 'failed', 'disputed', 'manual_review')),
  settlement_account_snapshot JSONB,
  provider_reported_settled_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  raw_provider_payload JSONB,
  reconciliation_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_settlement_batches_provider_ref
  ON public.provider_settlement_batches(provider_name, provider_batch_reference)
  WHERE provider_batch_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provider_settlement_batches_merchant
  ON public.provider_settlement_batches(merchant_id, settlement_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_settlement_batches_account
  ON public.provider_settlement_batches(settlement_account_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_provider_settlement_batches_updated_at ON public.provider_settlement_batches;
CREATE TRIGGER trg_provider_settlement_batches_updated_at
BEFORE UPDATE ON public.provider_settlement_batches
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.provider_settlement_batch_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_settlement_batch_id UUID NOT NULL REFERENCES public.provider_settlement_batches(id) ON DELETE CASCADE,
  settlement_record_id UUID NOT NULL REFERENCES public.settlement_records(id) ON DELETE CASCADE,
  payment_record_id UUID REFERENCES public.payment_records(id) ON DELETE SET NULL,
  expected_settlement NUMERIC(18,2),
  actual_settlement NUMERIC(18,2),
  settlement_difference NUMERIC(18,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (settlement_record_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_settlement_batch_items_batch
  ON public.provider_settlement_batch_items(provider_settlement_batch_id, created_at DESC);

ALTER TABLE public.settlement_records
  ADD COLUMN IF NOT EXISTS provider_settlement_batch_id UUID REFERENCES public.provider_settlement_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_settlement_records_provider_batch
  ON public.settlement_records(provider_settlement_batch_id);

COMMENT ON TABLE public.provider_settlement_batches IS
  'Provider-direct settlement drops to merchant bank accounts. This is not a merchant withdrawal queue.';

COMMENT ON TABLE public.provider_settlement_batch_items IS
  'Links individual settlement records to a provider settlement batch.';

COMMENT ON COLUMN public.settlement_records.provider_settlement_batch_id IS
  'Provider batch that settled this transaction, when the provider reports or admin records batch-level settlement.';
