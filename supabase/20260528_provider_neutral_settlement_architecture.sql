-- ============================================================
-- Provider-neutral Settlement Architecture
-- Adds merchant settlement accounts, provider settlement mappings,
-- payment records, settlement records, and reconciliation logs.
--
-- This migration is additive and preserves legacy merchant Paystack
-- settlement fields for compatibility.
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

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS payment_rail TEXT,
  ADD COLUMN IF NOT EXISTS processor_reference TEXT,
  ADD COLUMN IF NOT EXISTS merchant_net_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS settlement_status TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.payment_events
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.merchant_settlement_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  bank_name VARCHAR(255) NOT NULL,
  bank_code VARCHAR(50),
  account_number VARCHAR(30) NOT NULL,
  account_name VARCHAR(255) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  is_default BOOLEAN NOT NULL DEFAULT false,
  verification_status VARCHAR(50) NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'failed', 'manual_review')),
  status VARCHAR(50) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'disabled')),
  raw_verification_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_settlement_accounts_default
  ON public.merchant_settlement_accounts(merchant_id)
  WHERE is_default = true AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_merchant_settlement_accounts_merchant
  ON public.merchant_settlement_accounts(merchant_id, status, verification_status);

DROP TRIGGER IF EXISTS trg_merchant_settlement_accounts_updated_at ON public.merchant_settlement_accounts;
CREATE TRIGGER trg_merchant_settlement_accounts_updated_at
BEFORE UPDATE ON public.merchant_settlement_accounts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.merchant_provider_settlement_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  settlement_account_id UUID NOT NULL REFERENCES public.merchant_settlement_accounts(id) ON DELETE CASCADE,
  provider_name VARCHAR(50) NOT NULL
    CHECK (provider_name IN ('paystack', 'monnify', 'breet', 'future_provider')),
  provider_account_reference VARCHAR(255),
  provider_subaccount_code VARCHAR(255),
  provider_split_reference VARCHAR(255),
  provider_recipient_reference VARCHAR(255),
  provider_auto_settlement_reference VARCHAR(255),
  provider_wallet_reference VARCHAR(255),
  provider_collection_address_reference VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'connected', 'active', 'failed', 'disabled', 'not_supported', 'requires_live_approval')),
  environment VARCHAR(20) NOT NULL DEFAULT 'sandbox'
    CHECK (environment IN ('sandbox', 'live')),
  raw_provider_response JSONB,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (settlement_account_id, provider_name, environment)
);

CREATE INDEX IF NOT EXISTS idx_merchant_provider_settlement_accounts_merchant
  ON public.merchant_provider_settlement_accounts(merchant_id, provider_name, environment, status);

DROP TRIGGER IF EXISTS trg_merchant_provider_settlement_accounts_updated_at ON public.merchant_provider_settlement_accounts;
CREATE TRIGGER trg_merchant_provider_settlement_accounts_updated_at
BEFORE UPDATE ON public.merchant_provider_settlement_accounts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.payment_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES public.merchants(id) ON DELETE SET NULL,
  customer_id UUID,
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  payment_link_id UUID,
  legacy_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  payment_purpose VARCHAR(50) NOT NULL,
  payment_method VARCHAR(50),
  provider_name VARCHAR(50),
  internal_reference VARCHAR(255) NOT NULL,
  provider_reference VARCHAR(255),
  amount_paid NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  payment_status VARCHAR(50) NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'successful', 'failed', 'abandoned', 'reversed', 'refunded')),
  customer_email TEXT,
  raw_provider_payload JSONB,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (internal_reference)
);

CREATE INDEX IF NOT EXISTS idx_payment_records_merchant
  ON public.payment_records(merchant_id, payment_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_records_provider_reference
  ON public.payment_records(provider_name, provider_reference);

DROP TRIGGER IF EXISTS trg_payment_records_updated_at ON public.payment_records;
CREATE TRIGGER trg_payment_records_updated_at
BEFORE UPDATE ON public.payment_records
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.settlement_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_record_id UUID NOT NULL REFERENCES public.payment_records(id) ON DELETE CASCADE,
  legacy_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  settlement_account_id UUID REFERENCES public.merchant_settlement_accounts(id) ON DELETE SET NULL,
  provider_settlement_account_id UUID REFERENCES public.merchant_provider_settlement_accounts(id) ON DELETE SET NULL,
  provider_name VARCHAR(50) NOT NULL,
  payment_method VARCHAR(50),
  gross_amount NUMERIC(18,2) NOT NULL,
  provider_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
  platform_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
  customer_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
  merchant_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
  expected_settlement NUMERIC(18,2) NOT NULL,
  actual_settlement NUMERIC(18,2),
  settlement_difference NUMERIC(18,2),
  fee_payer VARCHAR(50),
  settlement_status VARCHAR(50) NOT NULL DEFAULT 'pending'
    CHECK (settlement_status IN ('pending', 'processing', 'completed', 'failed', 'disputed', 'manual_review', 'not_applicable')),
  provider_settlement_reference VARCHAR(255),
  expected_settlement_date TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  raw_settlement_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_record_id)
);

CREATE INDEX IF NOT EXISTS idx_settlement_records_merchant
  ON public.settlement_records(merchant_id, settlement_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_settlement_records_provider
  ON public.settlement_records(provider_name, provider_settlement_reference);

DROP TRIGGER IF EXISTS trg_settlement_records_updated_at ON public.settlement_records;
CREATE TRIGGER trg_settlement_records_updated_at
BEFORE UPDATE ON public.settlement_records
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.settlement_reconciliation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_record_id UUID REFERENCES public.settlement_records(id) ON DELETE SET NULL,
  provider_name VARCHAR(50) NOT NULL,
  provider_reference VARCHAR(255),
  reconciliation_status VARCHAR(50),
  expected_amount NUMERIC(18,2),
  provider_reported_amount NUMERIC(18,2),
  difference NUMERIC(18,2),
  raw_provider_payload JSONB,
  checked_by VARCHAR(50)
    CHECK (checked_by IS NULL OR checked_by IN ('system', 'admin', 'scheduled_job', 'webhook')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_settlement_reconciliation_logs_record
  ON public.settlement_reconciliation_logs(settlement_record_id, created_at DESC);

-- Backfill provider-neutral accounts from legacy merchant settlement fields.
WITH legacy_accounts AS (
  SELECT
    m.id AS merchant_id,
    COALESCE(NULLIF(m.settlement_bank_name, ''), 'Legacy settlement bank') AS bank_name,
    NULLIF(m.settlement_bank_code, '') AS bank_code,
    m.settlement_account_number AS account_number,
    COALESCE(NULLIF(m.settlement_account_name, ''), m.business_name, m.email, 'Legacy settlement account') AS account_name,
    CASE
      WHEN COALESCE(m.subaccount_verified, false) = true THEN 'verified'
      WHEN NULLIF(m.payment_subaccount_code, '') IS NOT NULL THEN 'manual_review'
      ELSE 'pending'
    END AS verification_status,
    jsonb_build_object(
      'source', 'legacy_merchants',
      'payment_subaccount_code', m.payment_subaccount_code,
      'subaccount_verified', m.subaccount_verified,
      'settlement_activated_at', m.settlement_activated_at
    ) AS raw_verification_payload
  FROM public.merchants m
  WHERE NULLIF(m.settlement_account_number, '') IS NOT NULL
)
INSERT INTO public.merchant_settlement_accounts (
  merchant_id,
  bank_name,
  bank_code,
  account_number,
  account_name,
  currency,
  is_default,
  verification_status,
  status,
  raw_verification_payload
)
SELECT
  merchant_id,
  bank_name,
  bank_code,
  account_number,
  account_name,
  'NGN',
  true,
  verification_status,
  'active',
  raw_verification_payload
FROM legacy_accounts
ON CONFLICT DO NOTHING;

-- Preserve existing Paystack subaccount mapping internally.
INSERT INTO public.merchant_provider_settlement_accounts (
  merchant_id,
  settlement_account_id,
  provider_name,
  provider_subaccount_code,
  provider_account_reference,
  status,
  environment,
  raw_provider_response,
  last_sync_at
)
SELECT
  msa.merchant_id,
  msa.id,
  'paystack',
  NULLIF(m.payment_subaccount_code, ''),
  NULLIF(m.payment_subaccount_code, ''),
  CASE
    WHEN NULLIF(m.payment_subaccount_code, '') IS NOT NULL AND COALESCE(m.subaccount_verified, false) = true THEN 'connected'
    WHEN NULLIF(m.payment_subaccount_code, '') IS NOT NULL THEN 'pending'
    ELSE 'pending'
  END,
  env.environment,
  jsonb_build_object('source', 'legacy_merchants', 'provider', 'paystack'),
  now()
FROM public.merchant_settlement_accounts msa
JOIN public.merchants m ON m.id = msa.merchant_id
CROSS JOIN (VALUES ('sandbox'), ('live')) AS env(environment)
WHERE msa.is_default = true
ON CONFLICT (settlement_account_id, provider_name, environment) DO UPDATE SET
  provider_subaccount_code = COALESCE(EXCLUDED.provider_subaccount_code, public.merchant_provider_settlement_accounts.provider_subaccount_code),
  provider_account_reference = COALESCE(EXCLUDED.provider_account_reference, public.merchant_provider_settlement_accounts.provider_account_reference),
  status = CASE
    WHEN public.merchant_provider_settlement_accounts.status IN ('connected', 'active') THEN public.merchant_provider_settlement_accounts.status
    ELSE EXCLUDED.status
  END,
  last_sync_at = now();

-- Sandbox Monnify readiness is stored as an internal mapping only; live still requires provider approval/sync.
INSERT INTO public.merchant_provider_settlement_accounts (
  merchant_id,
  settlement_account_id,
  provider_name,
  status,
  environment,
  raw_provider_response,
  last_sync_at
)
SELECT
  msa.merchant_id,
  msa.id,
  'monnify',
  CASE WHEN msa.verification_status = 'verified' THEN 'connected' ELSE 'pending' END,
  'sandbox',
  jsonb_build_object('source', 'migration', 'note', 'sandbox settlement mapping placeholder; live sync still required'),
  now()
FROM public.merchant_settlement_accounts msa
WHERE msa.is_default = true
ON CONFLICT (settlement_account_id, provider_name, environment) DO NOTHING;

-- Backfill normalized payment records from legacy successful invoice transactions.
WITH tx_with_provider AS (
  SELECT
    t.*,
    COALESCE(pe.processor, CASE WHEN NULLIF(t.processor_reference, '') IS NOT NULL THEN 'monnify' ELSE 'paystack' END) AS provider_name,
    COALESCE(t.processor_reference, t.paystack_reference, t.id::text) AS provider_reference
  FROM public.transactions t
  LEFT JOIN LATERAL (
    SELECT processor
    FROM public.payment_events pe
    WHERE pe.processor_ref = COALESCE(t.processor_reference, t.paystack_reference)
       OR pe.processor_ref = t.paystack_reference
    ORDER BY pe.created_at DESC NULLS LAST
    LIMIT 1
  ) pe ON true
  WHERE t.status = 'success'
)
INSERT INTO public.payment_records (
  merchant_id,
  invoice_id,
  legacy_transaction_id,
  payment_purpose,
  payment_method,
  provider_name,
  internal_reference,
  provider_reference,
  amount_paid,
  currency,
  payment_status,
  paid_at,
  raw_provider_payload
)
SELECT
  merchant_id,
  invoice_id,
  id,
  'invoice_payment',
  payment_method,
  provider_name,
  provider_reference,
  provider_reference,
  amount_paid,
  'NGN',
  'successful',
  created_at,
  jsonb_build_object('source', 'legacy_transactions', 'legacy_transaction_id', id)
FROM tx_with_provider
ON CONFLICT (internal_reference) DO UPDATE SET
  legacy_transaction_id = COALESCE(public.payment_records.legacy_transaction_id, EXCLUDED.legacy_transaction_id),
  provider_name = COALESCE(public.payment_records.provider_name, EXCLUDED.provider_name),
  payment_status = 'successful',
  updated_at = now();

-- Backfill settlement records separately from payment status.
INSERT INTO public.settlement_records (
  payment_record_id,
  legacy_transaction_id,
  merchant_id,
  settlement_account_id,
  provider_settlement_account_id,
  provider_name,
  payment_method,
  gross_amount,
  provider_fee,
  platform_fee,
  customer_fee,
  merchant_fee,
  expected_settlement,
  actual_settlement,
  settlement_difference,
  fee_payer,
  settlement_status,
  provider_settlement_reference,
  raw_settlement_payload
)
SELECT
  pr.id,
  t.id,
  t.merchant_id,
  msa.id,
  mpsa.id,
  COALESCE(pr.provider_name, 'paystack'),
  t.payment_method,
  t.amount_paid,
  COALESCE(t.paystack_fee, 0),
  0,
  CASE WHEN t.fee_absorbed_by = 'customer' THEN COALESCE(t.paystack_fee, 0) ELSE 0 END,
  CASE WHEN t.fee_absorbed_by = 'business' THEN COALESCE(t.paystack_fee, 0) ELSE 0 END,
  COALESCE(NULLIF(t.merchant_net_amount, 0), CASE WHEN t.fee_absorbed_by = 'business' THEN t.amount_paid - COALESCE(t.paystack_fee, 0) ELSE t.amount_paid END),
  NULL,
  NULL,
  CASE WHEN t.fee_absorbed_by = 'customer' THEN 'customer_pays_fee' ELSE 'merchant_pays_fee' END,
  CASE
    WHEN msa.id IS NULL OR mpsa.id IS NULL THEN 'manual_review'
    WHEN COALESCE(t.settlement_status, '') IN ('failed', 'disputed', 'manual_review') THEN t.settlement_status
    WHEN COALESCE(t.settlement_status, '') IN ('processing', 'pending') THEN t.settlement_status
    ELSE 'pending'
  END,
  COALESCE(t.processor_reference, t.paystack_reference),
  jsonb_build_object(
    'source', 'legacy_transactions',
    'legacy_settlement_status', t.settlement_status,
    'legacy_transaction_id', t.id
  )
FROM public.payment_records pr
JOIN public.transactions t ON t.id = pr.legacy_transaction_id
LEFT JOIN public.merchant_settlement_accounts msa
  ON msa.merchant_id = t.merchant_id
 AND msa.is_default = true
 AND msa.status = 'active'
LEFT JOIN public.merchant_provider_settlement_accounts mpsa
  ON mpsa.settlement_account_id = msa.id
 AND mpsa.provider_name = COALESCE(pr.provider_name, 'paystack')
 AND mpsa.environment = 'sandbox'
WHERE pr.payment_purpose = 'invoice_payment'
ON CONFLICT (payment_record_id) DO UPDATE SET
  expected_settlement = EXCLUDED.expected_settlement,
  provider_fee = EXCLUDED.provider_fee,
  merchant_fee = EXCLUDED.merchant_fee,
  customer_fee = EXCLUDED.customer_fee,
  provider_settlement_account_id = COALESCE(public.settlement_records.provider_settlement_account_id, EXCLUDED.provider_settlement_account_id),
  settlement_account_id = COALESCE(public.settlement_records.settlement_account_id, EXCLUDED.settlement_account_id),
  settlement_status = CASE
    WHEN public.settlement_records.settlement_status = 'completed' THEN public.settlement_records.settlement_status
    ELSE EXCLUDED.settlement_status
  END,
  updated_at = now();

COMMENT ON TABLE public.merchant_settlement_accounts IS
  'Provider-neutral merchant bank settlement accounts. Legacy Paystack merchant fields remain for compatibility.';

COMMENT ON TABLE public.merchant_provider_settlement_accounts IS
  'Provider-specific settlement mappings for merchant settlement accounts. Provider references are internal.';

COMMENT ON TABLE public.payment_records IS
  'Provider-neutral payment ledger. Payment success is separate from settlement completion.';

COMMENT ON TABLE public.settlement_records IS
  'Settlement ledger for expected, actual, and reconciled merchant settlement state.';

COMMENT ON TABLE public.settlement_reconciliation_logs IS
  'Reconciliation events from webhook, API sync, scheduled jobs, and admin review.';
