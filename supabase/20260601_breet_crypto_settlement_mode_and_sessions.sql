-- ============================================================
-- Breet crypto settlement mode and session tracking
-- Adds explicit settlement mode config, invoice crypto lifecycle
-- fields, and a dedicated plan/subscription crypto session table.
-- ============================================================

INSERT INTO public.platform_settings (key, value) VALUES
  ('breet_settlement_mode', 'disabled'),
  ('breet_invoice_crypto_enabled', 'false'),
  ('breet_subscription_crypto_enabled', 'false'),
  ('breet_webhook_url', ''),
  ('breet_supported_assets', 'USDT,USDC,BTC,ETH'),
  ('breet_supported_networks', 'TRON,ETHEREUM,BITCOIN'),
  ('breet_treasury_settlement_account_reference', ''),
  ('breet_treasury_settlement_account_label', ''),
  ('breet_live_enabled', 'false'),
  ('crypto_rate_lock_minutes', '15'),
  ('crypto_manual_review_threshold_bps', '100'),
  ('crypto_overpayment_action', 'manual_review'),
  ('crypto_settlement_currency', 'NGN')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.payment_sessions
  ADD COLUMN IF NOT EXISTS provider_name VARCHAR(50) NOT NULL DEFAULT 'breet',
  ADD COLUMN IF NOT EXISTS payment_purpose VARCHAR(50) NOT NULL DEFAULT 'invoice_payment',
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) NOT NULL DEFAULT 'crypto',
  ADD COLUMN IF NOT EXISTS settlement_mode VARCHAR(50) NOT NULL DEFAULT 'treasury_manual',
  ADD COLUMN IF NOT EXISTS crypto_status VARCHAR(50) NOT NULL DEFAULT 'crypto_payment_initialized',
  ADD COLUMN IF NOT EXISTS crypto_amount_received NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS converted_ngn_amount NUMERIC(20,2),
  ADD COLUMN IF NOT EXISTS provider_fee NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settlement_fee NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_settlement_ngn NUMERIC(20,2),
  ADD COLUMN IF NOT EXISTS actual_settlement_ngn NUMERIC(20,2),
  ADD COLUMN IF NOT EXISTS settlement_account_reference TEXT,
  ADD COLUMN IF NOT EXISTS webhook_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS manual_review_reason TEXT,
  ADD COLUMN IF NOT EXISTS raw_webhook_payload JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payment_sessions_crypto_status_check'
  ) THEN
    ALTER TABLE public.payment_sessions
      ADD CONSTRAINT payment_sessions_crypto_status_check
      CHECK (crypto_status IN (
        'crypto_payment_initialized',
        'crypto_payment_waiting',
        'crypto_payment_detected',
        'crypto_payment_confirming',
        'crypto_payment_confirmed',
        'crypto_underpaid',
        'crypto_overpaid',
        'crypto_expired',
        'crypto_converted_to_ngn',
        'crypto_settlement_pending',
        'crypto_settlement_completed',
        'crypto_settlement_failed',
        'manual_review',
        'failed'
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payment_sessions_settlement_mode_check'
  ) THEN
    ALTER TABLE public.payment_sessions
      ADD CONSTRAINT payment_sessions_settlement_mode_check
      CHECK (settlement_mode IN ('provider_direct', 'treasury_manual', 'disabled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payment_sessions_provider_status
  ON public.payment_sessions(provider_name, crypto_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_sessions_payment_purpose
  ON public.payment_sessions(payment_purpose, created_at DESC);

CREATE TABLE IF NOT EXISTS public.crypto_payment_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES public.merchants(id) ON DELETE SET NULL,
  user_id UUID,
  business_id UUID,
  plan_id TEXT,
  payment_purpose VARCHAR(50) NOT NULL
    CHECK (payment_purpose IN ('plan_subscription', 'plan_upgrade')),
  provider_name VARCHAR(50) NOT NULL DEFAULT 'breet'
    CHECK (provider_name IN ('breet', 'paystack', 'monnify')),
  internal_reference TEXT NOT NULL UNIQUE,
  provider_reference TEXT UNIQUE,
  payment_method VARCHAR(50) NOT NULL DEFAULT 'crypto',
  expected_ngn_amount NUMERIC(20,2) NOT NULL,
  crypto_asset VARCHAR(20) NOT NULL,
  crypto_network VARCHAR(50) NOT NULL,
  crypto_amount_expected NUMERIC(20,8) NOT NULL,
  crypto_amount_received NUMERIC(20,8),
  converted_ngn_amount NUMERIC(20,2),
  conversion_rate NUMERIC(20,4),
  provider_fee NUMERIC(20,2) NOT NULL DEFAULT 0,
  settlement_fee NUMERIC(20,2) NOT NULL DEFAULT 0,
  expected_settlement_ngn NUMERIC(20,2),
  actual_settlement_ngn NUMERIC(20,2),
  settlement_mode VARCHAR(50) NOT NULL DEFAULT 'treasury_manual'
    CHECK (settlement_mode IN ('provider_direct', 'treasury_manual', 'disabled')),
  crypto_status VARCHAR(50) NOT NULL DEFAULT 'crypto_payment_initialized'
    CHECK (crypto_status IN (
      'crypto_payment_initialized',
      'crypto_payment_waiting',
      'crypto_payment_detected',
      'crypto_payment_confirming',
      'crypto_payment_confirmed',
      'crypto_underpaid',
      'crypto_overpaid',
      'crypto_expired',
      'crypto_converted_to_ngn',
      'crypto_settlement_pending',
      'crypto_settlement_completed',
      'crypto_settlement_failed',
      'manual_review',
      'failed'
    )),
  settlement_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  webhook_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  payment_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  payment_session_reference TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_webhook_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  manual_review_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (settlement_status IN ('pending', 'processing', 'completed', 'failed', 'manual_review', 'not_applicable'))
);

CREATE INDEX IF NOT EXISTS idx_crypto_payment_sessions_merchant_status
  ON public.crypto_payment_sessions(merchant_id, crypto_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_crypto_payment_sessions_provider_reference
  ON public.crypto_payment_sessions(provider_name, provider_reference);

CREATE INDEX IF NOT EXISTS idx_crypto_payment_sessions_internal_reference
  ON public.crypto_payment_sessions(internal_reference);

DROP TRIGGER IF EXISTS trg_crypto_payment_sessions_updated_at ON public.crypto_payment_sessions;
CREATE TRIGGER trg_crypto_payment_sessions_updated_at
BEFORE UPDATE ON public.crypto_payment_sessions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
