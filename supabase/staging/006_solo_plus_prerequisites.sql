-- ============================================================
-- Solo Plus staging prerequisites
-- Shared objects required before Solo Plus case foundation.
-- Safe to rerun on clean or partially provisioned staging.
-- ============================================================

DO $$
DECLARE
  v_has_valid_touch_updated_at BOOLEAN;
  v_has_conflicting_touch_updated_at BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'touch_updated_at'
      AND p.pronargs = 0
      AND p.prorettype = 'trigger'::regtype
  ) INTO v_has_valid_touch_updated_at;

  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'touch_updated_at'
      AND NOT (p.pronargs = 0 AND p.prorettype = 'trigger'::regtype)
  ) INTO v_has_conflicting_touch_updated_at;

  IF v_has_valid_touch_updated_at THEN
    RETURN;
  END IF;

  IF v_has_conflicting_touch_updated_at THEN
    RAISE EXCEPTION 'public.touch_updated_at exists but is not a zero-argument trigger-returning function';
  END IF;

  EXECUTE $fn$
    CREATE FUNCTION public.touch_updated_at()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $body$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $body$;
  $fn$;
END
$$;

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
  CONSTRAINT payment_records_internal_reference_key UNIQUE (internal_reference)
);

ALTER TABLE public.payment_records
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS business_id UUID,
  ADD COLUMN IF NOT EXISTS plan_id TEXT,
  ADD COLUMN IF NOT EXISTS plan_name TEXT,
  ADD COLUMN IF NOT EXISTS expected_amount NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'pending_payment',
  ADD COLUMN IF NOT EXISTS account_setup_status TEXT NOT NULL DEFAULT 'pending_payment',
  ADD COLUMN IF NOT EXISTS password_setup_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settlement_destination_source TEXT,
  ADD COLUMN IF NOT EXISTS reconciliation_status TEXT NOT NULL DEFAULT 'pending_reconciliation',
  ADD COLUMN IF NOT EXISTS setup_recovery_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS setup_recovery_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS setup_recovery_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS setup_recovery_email_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS setup_completed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'payment_records'
      AND c.conname = 'payment_records_payment_status_check'
  ) THEN
    ALTER TABLE public.payment_records
      ADD CONSTRAINT payment_records_payment_status_check
      CHECK (payment_status IN ('pending', 'successful', 'failed', 'abandoned', 'reversed', 'refunded'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_payment_records_merchant
  ON public.payment_records(merchant_id, payment_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_records_provider_reference
  ON public.payment_records(provider_name, provider_reference);

CREATE INDEX IF NOT EXISTS idx_payment_records_plan_recovery
  ON public.payment_records(payment_purpose, processing_status, account_setup_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_records_customer_email
  ON public.payment_records(customer_email, created_at DESC);

DROP TRIGGER IF EXISTS trg_payment_records_updated_at ON public.payment_records;
CREATE TRIGGER trg_payment_records_updated_at
BEFORE UPDATE ON public.payment_records
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
