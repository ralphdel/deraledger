-- ============================================================
-- Plan payment recovery and webhook audit normalization
-- Adds durable recovery fields for subscription/upgrade payments
-- and normalized webhook columns for admin visibility.
-- ============================================================

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

ALTER TABLE public.payment_events
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS payment_purpose TEXT,
  ADD COLUMN IF NOT EXISTS payment_reference TEXT,
  ADD COLUMN IF NOT EXISTS provider_reference TEXT,
  ADD COLUMN IF NOT EXISTS expected_amount NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS fee NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS plan_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_id UUID,
  ADD COLUMN IF NOT EXISTS business_id UUID,
  ADD COLUMN IF NOT EXISTS customer_email TEXT,
  ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'received',
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS settlement_destination_source TEXT,
  ADD COLUMN IF NOT EXISTS reconciliation_status TEXT;

CREATE INDEX IF NOT EXISTS idx_payment_records_plan_recovery
  ON public.payment_records(payment_purpose, processing_status, account_setup_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_records_customer_email
  ON public.payment_records(customer_email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_events_payment_reference
  ON public.payment_events(payment_reference, provider_reference, created_at DESC);
