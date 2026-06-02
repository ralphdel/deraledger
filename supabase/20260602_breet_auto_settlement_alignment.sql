-- ============================================================
-- Breet auto-settlement alignment
-- Adds confirmed Breet settlement modes, Breet snapshot fields,
-- and updates crypto payment session constraints for the new
-- per-transaction settlement architecture.
-- ============================================================

INSERT INTO public.platform_settings (key, value) VALUES
  ('breet_settlement_mode', 'breet_auto_settlement'),
  ('breet_auto_settlement_enabled', 'true'),
  ('breet_merchant_auto_settlement_enabled', 'true'),
  ('breet_invoice_crypto_enabled', 'true'),
  ('breet_subscription_crypto_enabled', 'true'),
  ('breet_default_receive_currency', 'NGN'),
  ('breet_sandbox_force_platform_settlement', 'false')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value;

ALTER TABLE public.payment_sessions
  ADD COLUMN IF NOT EXISTS settlement_recipient_type TEXT,
  ADD COLUMN IF NOT EXISTS provider_wallet_id TEXT,
  ADD COLUMN IF NOT EXISTS settlement_account_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS amount_settled NUMERIC(20,2),
  ADD COLUMN IF NOT EXISTS settlement_currency VARCHAR(10) NOT NULL DEFAULT 'NGN';

ALTER TABLE public.crypto_payment_sessions
  ADD COLUMN IF NOT EXISTS settlement_recipient_type TEXT,
  ADD COLUMN IF NOT EXISTS provider_wallet_id TEXT,
  ADD COLUMN IF NOT EXISTS settlement_account_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS amount_settled NUMERIC(20,2),
  ADD COLUMN IF NOT EXISTS settlement_currency VARCHAR(10) NOT NULL DEFAULT 'NGN';

ALTER TABLE public.settlement_records
  ADD COLUMN IF NOT EXISTS settlement_recipient_type TEXT,
  ADD COLUMN IF NOT EXISTS settlement_currency VARCHAR(10) NOT NULL DEFAULT 'NGN';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payment_sessions_settlement_mode_check'
  ) THEN
    ALTER TABLE public.payment_sessions
      DROP CONSTRAINT payment_sessions_settlement_mode_check;
  END IF;

  ALTER TABLE public.payment_sessions
    ADD CONSTRAINT payment_sessions_settlement_mode_check
    CHECK (settlement_mode IN ('breet_auto_settlement', 'platform_auto_settlement', 'treasury_manual', 'disabled'));
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'crypto_payment_sessions_settlement_mode_check'
  ) THEN
    ALTER TABLE public.crypto_payment_sessions
      DROP CONSTRAINT crypto_payment_sessions_settlement_mode_check;
  END IF;

  ALTER TABLE public.crypto_payment_sessions
    ADD CONSTRAINT crypto_payment_sessions_settlement_mode_check
    CHECK (settlement_mode IN ('breet_auto_settlement', 'platform_auto_settlement', 'treasury_manual', 'disabled'));
END $$;

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

  v_applied_ngn := LEAST(
    COALESCE(p_gross_ngn, COALESCE(v_session.amount_ngn, 0)),
    COALESCE(v_invoice.outstanding_balance, 0)
  );
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
