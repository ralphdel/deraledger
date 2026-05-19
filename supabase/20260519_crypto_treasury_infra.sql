-- DeraLedger crypto treasury infrastructure
-- Adds merchant ledger, crypto payment sessions, treasury transactions,
-- settlement batches, and atomic webhook processing for invoice collections.

CREATE TABLE IF NOT EXISTS public.merchant_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  currency VARCHAR(10) NOT NULL,
  available_balance NUMERIC(20,2) NOT NULL DEFAULT 0,
  pending_balance NUMERIC(20,2) NOT NULL DEFAULT 0,
  locked_balance NUMERIC(20,2) NOT NULL DEFAULT 0,
  total_settled NUMERIC(20,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, currency)
);

CREATE TABLE IF NOT EXISTS public.payment_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  payment_rail VARCHAR(50) NOT NULL,
  source_currency VARCHAR(10) NOT NULL,
  destination_currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  amount_ngn NUMERIC(20,2) NOT NULL,
  amount_crypto NUMERIC(20,8) NOT NULL,
  exchange_rate NUMERIC(20,4) NOT NULL,
  wallet_address TEXT NOT NULL,
  wallet_provider_id TEXT,
  network VARCHAR(50),
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  confirmation_count INTEGER NOT NULL DEFAULT 0,
  expected_confirmations INTEGER NOT NULL DEFAULT 0,
  reference TEXT NOT NULL UNIQUE,
  provider_reference TEXT,
  tx_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('PENDING', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'UNDER_REVIEW', 'SETTLEMENT_PENDING', 'SETTLED', 'FAILED', 'EXPIRED', 'REFUNDED'))
);

CREATE INDEX IF NOT EXISTS idx_payment_sessions_invoice_status
  ON public.payment_sessions(invoice_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_sessions_merchant_status
  ON public.payment_sessions(merchant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.treasury_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  payment_session_id UUID NOT NULL REFERENCES public.payment_sessions(id) ON DELETE CASCADE,
  payment_rail VARCHAR(50),
  source_currency VARCHAR(10),
  source_amount NUMERIC(20,8),
  exchange_rate NUMERIC(20,4),
  gross_ngn NUMERIC(20,2),
  platform_fee NUMERIC(20,2) NOT NULL DEFAULT 0,
  network_fee NUMERIC(20,2) NOT NULL DEFAULT 0,
  merchant_net_ngn NUMERIC(20,2),
  blockchain_tx_hash TEXT,
  breet_reference TEXT,
  settlement_reference TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'INITIATED',
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_session_id),
  CHECK (status IN ('INITIATED', 'PAYMENT_DETECTED', 'BLOCKCHAIN_CONFIRMED', 'FX_CONVERTED', 'MERCHANT_PENDING', 'SETTLEMENT_QUEUED', 'SETTLED', 'FAILED', 'REVERSED'))
);

CREATE INDEX IF NOT EXISTS idx_treasury_transactions_merchant_created
  ON public.treasury_transactions(merchant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_treasury_transactions_status
  ON public.treasury_transactions(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.settlement_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  total_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  payout_provider VARCHAR(50),
  payout_reference TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'queued',
  processed_at TIMESTAMPTZ,
  failure_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('queued', 'processing', 'settled', 'failed', 'held', 'reversed'))
);

CREATE INDEX IF NOT EXISTS idx_settlement_batches_merchant_status
  ON public.settlement_batches(merchant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.treasury_webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(50) NOT NULL,
  event_type TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'received',
  processor_reference TEXT,
  merchant_id UUID REFERENCES public.merchants(id) ON DELETE SET NULL,
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  payment_session_id UUID REFERENCES public.payment_sessions(id) ON DELETE SET NULL,
  response_code INTEGER,
  error_message TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('received', 'processed', 'duplicate', 'failed', 'under_review'))
);

CREATE INDEX IF NOT EXISTS idx_treasury_webhook_logs_provider_created
  ON public.treasury_webhook_logs(provider, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_treasury_webhook_logs_status
  ON public.treasury_webhook_logs(status, created_at DESC);

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'PENDING';

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS payment_rail TEXT,
  ADD COLUMN IF NOT EXISTS settlement_status TEXT,
  ADD COLUMN IF NOT EXISTS processor_reference TEXT,
  ADD COLUMN IF NOT EXISTS source_currency TEXT,
  ADD COLUMN IF NOT EXISTS source_amount NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS fx_rate NUMERIC(20,4),
  ADD COLUMN IF NOT EXISTS merchant_net_amount NUMERIC(20,2);

UPDATE public.transactions
SET
  payment_rail = COALESCE(payment_rail, payment_method),
  settlement_status = COALESCE(settlement_status, CASE WHEN status = 'success' THEN 'settled' ELSE 'pending' END),
  processor_reference = COALESCE(processor_reference, paystack_reference),
  merchant_net_amount = COALESCE(
    merchant_net_amount,
    CASE
      WHEN fee_absorbed_by = 'business' THEN amount_paid - paystack_fee
      ELSE amount_paid
    END
  )
WHERE payment_rail IS NULL
   OR settlement_status IS NULL
   OR processor_reference IS NULL
   OR merchant_net_amount IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transactions_payment_method_check'
  ) THEN
    ALTER TABLE public.transactions DROP CONSTRAINT transactions_payment_method_check;
  END IF;
END $$;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_payment_method_check
  CHECK (payment_method IN ('card', 'bank_transfer', 'ussd', 'crypto', 'usdt', 'usdc', 'btc', 'eth'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoices_payment_status_check'
  ) THEN
    ALTER TABLE public.invoices DROP CONSTRAINT invoices_payment_status_check;
  END IF;
END $$;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_payment_status_check
  CHECK (payment_status IN ('PENDING', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'UNDER_REVIEW', 'SETTLEMENT_PENDING', 'SETTLED', 'FAILED', 'EXPIRED', 'REFUNDED'));

CREATE INDEX IF NOT EXISTS idx_invoices_payment_status
  ON public.invoices(merchant_id, payment_status, updated_at DESC);

INSERT INTO public.platform_settings (key, value) VALUES
  ('crypto_usdt_ngn_rate', '1650'),
  ('crypto_usdc_ngn_rate', '1650'),
  ('crypto_btc_ngn_rate', '100000000'),
  ('crypto_eth_ngn_rate', '5000000'),
  ('crypto_session_ttl_minutes', '30'),
  ('crypto_rate_slippage_bps', '100'),
  ('crypto_underpayment_tolerance_bps', '100'),
  ('crypto_platform_fee_bps', '0'),
  ('crypto_btc_confirmations', '3'),
  ('crypto_eth_confirmations', '12'),
  ('crypto_usdt_confirmations', '12'),
  ('crypto_usdc_confirmations', '12')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_merchant_wallets_updated_at ON public.merchant_wallets;
CREATE TRIGGER trg_merchant_wallets_updated_at
BEFORE UPDATE ON public.merchant_wallets
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_payment_sessions_updated_at ON public.payment_sessions;
CREATE TRIGGER trg_payment_sessions_updated_at
BEFORE UPDATE ON public.payment_sessions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_treasury_transactions_updated_at ON public.treasury_transactions;
CREATE TRIGGER trg_treasury_transactions_updated_at
BEFORE UPDATE ON public.treasury_transactions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_settlement_batches_updated_at ON public.settlement_batches;
CREATE TRIGGER trg_settlement_batches_updated_at
BEFORE UPDATE ON public.settlement_batches
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.process_breet_invoice_confirmation(
  p_payment_session_id UUID,
  p_event_type TEXT,
  p_processor_reference TEXT,
  p_blockchain_tx_hash TEXT,
  p_breet_reference TEXT,
  p_source_amount NUMERIC,
  p_exchange_rate NUMERIC,
  p_payment_rail TEXT,
  p_source_currency TEXT,
  p_gross_ngn NUMERIC,
  p_platform_fee NUMERIC,
  p_network_fee NUMERIC,
  p_merchant_net_ngn NUMERIC,
  p_confirmation_count INTEGER,
  p_expected_confirmations INTEGER,
  p_raw_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_session public.payment_sessions%ROWTYPE;
  v_invoice public.invoices%ROWTYPE;
  v_tx public.treasury_transactions%ROWTYPE;
  v_applied_ngn NUMERIC(20,2);
  v_new_amount_paid NUMERIC(20,2);
  v_new_outstanding NUMERIC(20,2);
  v_invoice_status TEXT;
  v_payment_status TEXT;
BEGIN
  SELECT *
  INTO v_session
  FROM public.payment_sessions
  WHERE id = p_payment_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'payment_session_not_found');
  END IF;

  IF v_session.status IN ('CONFIRMED', 'SETTLEMENT_PENDING', 'SETTLED') THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'session_status', v_session.status);
  END IF;

  SELECT *
  INTO v_invoice
  FROM public.invoices
  WHERE id = v_session.invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invoice_not_found');
  END IF;

  INSERT INTO public.merchant_wallets (merchant_id, currency)
  VALUES (v_session.merchant_id, 'NGN')
  ON CONFLICT (merchant_id, currency) DO NOTHING;

  v_applied_ngn := LEAST(COALESCE(v_session.amount_ngn, 0), COALESCE(v_invoice.outstanding_balance, 0));
  v_new_amount_paid := COALESCE(v_invoice.amount_paid, 0) + v_applied_ngn;
  v_new_outstanding := GREATEST(COALESCE(v_invoice.outstanding_balance, 0) - v_applied_ngn, 0);
  v_invoice_status := CASE
    WHEN v_new_outstanding <= 0 THEN 'closed'
    WHEN v_applied_ngn > 0 THEN 'partially_paid'
    ELSE v_invoice.status
  END;
  v_payment_status := CASE
    WHEN COALESCE(p_expected_confirmations, 0) > 0
      AND COALESCE(p_confirmation_count, 0) < COALESCE(p_expected_confirmations, 0)
      THEN 'AWAITING_CONFIRMATION'
    ELSE 'SETTLEMENT_PENDING'
  END;

  UPDATE public.invoices
  SET
    amount_paid = v_new_amount_paid,
    outstanding_balance = v_new_outstanding,
    status = v_invoice_status,
    payment_status = v_payment_status,
    payment_provider = COALESCE(v_invoice.payment_provider, 'breet'),
    crypto_asset = COALESCE(v_invoice.crypto_asset, UPPER(p_payment_rail)),
    updated_at = now()
  WHERE id = v_invoice.id;

  INSERT INTO public.treasury_transactions (
    merchant_id,
    invoice_id,
    payment_session_id,
    payment_rail,
    source_currency,
    source_amount,
    exchange_rate,
    gross_ngn,
    platform_fee,
    network_fee,
    merchant_net_ngn,
    blockchain_tx_hash,
    breet_reference,
    settlement_reference,
    status,
    raw_payload
  )
  VALUES (
    v_session.merchant_id,
    v_session.invoice_id,
    v_session.id,
    LOWER(p_payment_rail),
    UPPER(p_source_currency),
    p_source_amount,
    p_exchange_rate,
    p_gross_ngn,
    p_platform_fee,
    p_network_fee,
    p_merchant_net_ngn,
    p_blockchain_tx_hash,
    p_breet_reference,
    'SETTLE-' || replace(v_session.id::text, '-', ''),
    CASE
      WHEN COALESCE(p_expected_confirmations, 0) > 0
        AND COALESCE(p_confirmation_count, 0) < COALESCE(p_expected_confirmations, 0)
        THEN 'PAYMENT_DETECTED'
      ELSE 'MERCHANT_PENDING'
    END,
    COALESCE(p_raw_payload, '{}'::jsonb)
  )
  ON CONFLICT (payment_session_id) DO UPDATE SET
    blockchain_tx_hash = EXCLUDED.blockchain_tx_hash,
    breet_reference = EXCLUDED.breet_reference,
    exchange_rate = EXCLUDED.exchange_rate,
    source_amount = EXCLUDED.source_amount,
    gross_ngn = EXCLUDED.gross_ngn,
    platform_fee = EXCLUDED.platform_fee,
    network_fee = EXCLUDED.network_fee,
    merchant_net_ngn = EXCLUDED.merchant_net_ngn,
    status = EXCLUDED.status,
    raw_payload = EXCLUDED.raw_payload,
    updated_at = now()
  RETURNING * INTO v_tx;

  UPDATE public.payment_sessions
  SET
    status = CASE
      WHEN COALESCE(p_expected_confirmations, 0) > 0
        AND COALESCE(p_confirmation_count, 0) < COALESCE(p_expected_confirmations, 0)
        THEN 'AWAITING_CONFIRMATION'
      ELSE 'CONFIRMED'
    END,
    provider_reference = COALESCE(p_breet_reference, p_processor_reference, provider_reference),
    tx_hash = COALESCE(p_blockchain_tx_hash, tx_hash),
    confirmation_count = GREATEST(COALESCE(confirmation_count, 0), COALESCE(p_confirmation_count, 0)),
    expected_confirmations = GREATEST(COALESCE(expected_confirmations, 0), COALESCE(p_expected_confirmations, 0)),
    paid_at = COALESCE(paid_at, now()),
    updated_at = now()
  WHERE id = v_session.id;

  UPDATE public.merchant_wallets
  SET
    pending_balance = pending_balance + CASE
      WHEN COALESCE(p_expected_confirmations, 0) > 0
        AND COALESCE(p_confirmation_count, 0) < COALESCE(p_expected_confirmations, 0)
        THEN 0
      ELSE COALESCE(p_merchant_net_ngn, 0)
    END
  WHERE merchant_id = v_session.merchant_id
    AND currency = 'NGN';

  INSERT INTO public.transactions (
    invoice_id,
    merchant_id,
    amount_paid,
    k_factor,
    tax_collected,
    discount_applied,
    paystack_fee,
    fee_absorbed_by,
    paystack_reference,
    payment_method,
    status,
    payment_rail,
    settlement_status,
    processor_reference,
    source_currency,
    source_amount,
    fx_rate,
    merchant_net_amount
  )
  SELECT
    v_invoice.id,
    v_invoice.merchant_id,
    v_applied_ngn,
    CASE
      WHEN COALESCE(v_invoice.grand_total, 0) > 0 THEN v_applied_ngn / v_invoice.grand_total
      ELSE 0
    END,
    ROUND((CASE WHEN COALESCE(v_invoice.grand_total, 0) > 0 THEN v_applied_ngn / v_invoice.grand_total ELSE 0 END) * COALESCE(v_invoice.tax_value, 0), 2),
    ROUND((CASE WHEN COALESCE(v_invoice.grand_total, 0) > 0 THEN v_applied_ngn / v_invoice.grand_total ELSE 0 END) * COALESCE(v_invoice.discount_value, 0), 2),
    COALESCE(p_platform_fee, 0) + COALESCE(p_network_fee, 0),
    'business',
    COALESCE(p_breet_reference, p_processor_reference, p_blockchain_tx_hash),
    LOWER(p_payment_rail),
    'success',
    LOWER(p_payment_rail),
    LOWER(v_payment_status),
    COALESCE(p_breet_reference, p_processor_reference, p_blockchain_tx_hash),
    UPPER(p_source_currency),
    p_source_amount,
    p_exchange_rate,
    p_merchant_net_ngn
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.transactions t
    WHERE t.processor_reference = COALESCE(p_breet_reference, p_processor_reference, p_blockchain_tx_hash)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'payment_session_id', v_session.id,
    'treasury_transaction_id', v_tx.id,
    'invoice_id', v_invoice.id,
    'invoice_status', v_invoice_status,
    'payment_status', v_payment_status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_pending_crypto_settlements(
  p_merchant_id UUID DEFAULT NULL,
  p_payout_provider TEXT DEFAULT 'paystack'
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_wallet RECORD;
  v_batch_id UUID;
  v_created_count INTEGER := 0;
BEGIN
  FOR v_wallet IN
    SELECT mw.merchant_id, mw.pending_balance
    FROM public.merchant_wallets mw
    WHERE mw.currency = 'NGN'
      AND mw.pending_balance > 0
      AND (p_merchant_id IS NULL OR mw.merchant_id = p_merchant_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.settlement_batches sb
        WHERE sb.merchant_id = mw.merchant_id
          AND sb.status IN ('queued', 'processing', 'held')
      )
    FOR UPDATE
  LOOP
    INSERT INTO public.settlement_batches (
      merchant_id,
      total_amount,
      currency,
      payout_provider,
      payout_reference,
      status,
      metadata
    )
    VALUES (
      v_wallet.merchant_id,
      v_wallet.pending_balance,
      'NGN',
      LOWER(COALESCE(p_payout_provider, 'paystack')),
      'PAYOUT-' || replace(gen_random_uuid()::text, '-', ''),
      'queued',
      jsonb_build_object('queued_from', 'treasury_engine')
    )
    RETURNING id INTO v_batch_id;

    UPDATE public.merchant_wallets
    SET
      pending_balance = pending_balance - v_wallet.pending_balance,
      locked_balance = locked_balance + v_wallet.pending_balance
    WHERE merchant_id = v_wallet.merchant_id
      AND currency = 'NGN';

    UPDATE public.treasury_transactions
    SET
      status = 'SETTLEMENT_QUEUED',
      settlement_reference = v_batch_id::text,
      updated_at = now()
    WHERE merchant_id = v_wallet.merchant_id
      AND status = 'MERCHANT_PENDING';

    v_created_count := v_created_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'created_batches', v_created_count,
    'provider', LOWER(COALESCE(p_payout_provider, 'paystack'))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_settlement_batch_status(
  p_batch_id UUID,
  p_action TEXT,
  p_failure_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_batch public.settlement_batches%ROWTYPE;
BEGIN
  SELECT *
  INTO v_batch
  FROM public.settlement_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'batch_not_found');
  END IF;

  IF p_action = 'hold' THEN
    UPDATE public.settlement_batches
    SET status = 'held', failure_reason = p_failure_reason, updated_at = now()
    WHERE id = p_batch_id;
  ELSIF p_action = 'release' THEN
    UPDATE public.settlement_batches
    SET status = 'queued', failure_reason = NULL, updated_at = now()
    WHERE id = p_batch_id;
  ELSIF p_action = 'processing' THEN
    UPDATE public.settlement_batches
    SET status = 'processing', updated_at = now()
    WHERE id = p_batch_id;
  ELSIF p_action = 'retry' THEN
    UPDATE public.settlement_batches
    SET status = 'queued', failure_reason = NULL, updated_at = now()
    WHERE id = p_batch_id;

    UPDATE public.merchant_wallets
    SET
      pending_balance = GREATEST(pending_balance - v_batch.total_amount, 0),
      locked_balance = locked_balance + v_batch.total_amount
    WHERE merchant_id = v_batch.merchant_id
      AND currency = 'NGN'
      AND v_batch.status = 'failed';

    UPDATE public.treasury_transactions
    SET status = 'SETTLEMENT_QUEUED', updated_at = now()
    WHERE settlement_reference = p_batch_id::text
      AND status = 'MERCHANT_PENDING';
  ELSIF p_action = 'settled' THEN
    UPDATE public.settlement_batches
    SET status = 'settled', processed_at = now(), failure_reason = NULL, updated_at = now()
    WHERE id = p_batch_id;

    UPDATE public.merchant_wallets
    SET
      locked_balance = GREATEST(locked_balance - v_batch.total_amount, 0),
      total_settled = total_settled + v_batch.total_amount
    WHERE merchant_id = v_batch.merchant_id
      AND currency = 'NGN';

    UPDATE public.treasury_transactions
    SET status = 'SETTLED', updated_at = now()
    WHERE settlement_reference = p_batch_id::text
      AND status = 'SETTLEMENT_QUEUED';
  ELSIF p_action = 'fail' THEN
    UPDATE public.settlement_batches
    SET status = 'failed', failure_reason = COALESCE(p_failure_reason, failure_reason), updated_at = now()
    WHERE id = p_batch_id;

    UPDATE public.merchant_wallets
    SET
      locked_balance = GREATEST(locked_balance - v_batch.total_amount, 0),
      pending_balance = pending_balance + v_batch.total_amount
    WHERE merchant_id = v_batch.merchant_id
      AND currency = 'NGN';

    UPDATE public.treasury_transactions
    SET status = 'MERCHANT_PENDING', updated_at = now()
    WHERE settlement_reference = p_batch_id::text
      AND status = 'SETTLEMENT_QUEUED';
  ELSIF p_action = 'reverse' THEN
    UPDATE public.settlement_batches
    SET status = 'reversed', failure_reason = COALESCE(p_failure_reason, failure_reason), updated_at = now()
    WHERE id = p_batch_id;

    UPDATE public.merchant_wallets
    SET
      locked_balance = GREATEST(locked_balance - v_batch.total_amount, 0),
      available_balance = available_balance + v_batch.total_amount
    WHERE merchant_id = v_batch.merchant_id
      AND currency = 'NGN';

    UPDATE public.treasury_transactions
    SET status = 'REVERSED', updated_at = now()
    WHERE settlement_reference = p_batch_id::text;
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'unsupported_action');
  END IF;

  RETURN jsonb_build_object('ok', true, 'batch_id', p_batch_id, 'action', p_action);
END;
$$;
