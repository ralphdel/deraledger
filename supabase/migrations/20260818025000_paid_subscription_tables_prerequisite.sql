-- Paid subscription baseline required before migration 021's atomic upgrade RPC.
-- Migration 020 owns public.subscription_payments; this migration deliberately
-- creates only the missing subscriptions relation and its fail-closed access
-- contract. No business rows, provider configuration, or backfill is included.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('public.merchants') IS NULL THEN
    RAISE EXCEPTION 'Paid subscription prerequisite missing: public.merchants';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    RAISE EXCEPTION
      'Paid subscription prerequisite missing: service_role, authenticated, and anon roles are required';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL,
  plan_type TEXT NOT NULL,
  amount_paid NUMERIC(10,2) NOT NULL,
  start_date TIMESTAMPTZ NOT NULL,
  expiry_date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_notified_at TIMESTAMPTZ,
  is_banner_dismissed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_merchant_id_key UNIQUE (merchant_id),
  CONSTRAINT subscriptions_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE
);

-- The relation is intentionally additive only. Existing historical shapes are
-- not rewritten: migration 021 will fail closed on incompatible definitions.
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Browser reads are restricted to the merchant owner; all writes are
-- server/service-role only. This mirrors the owner-scoped billing-history
-- posture established by migration 020 without granting browser mutations.
CREATE POLICY subscriptions_merchant
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (
    merchant_id IN (
      SELECT merchants.id
      FROM public.merchants
      WHERE merchants.user_id = auth.uid()
    )
  );

REVOKE ALL ON TABLE public.subscriptions FROM PUBLIC;
REVOKE ALL ON TABLE public.subscriptions FROM anon;
REVOKE ALL ON TABLE public.subscriptions FROM authenticated;
GRANT SELECT ON TABLE public.subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.subscriptions TO service_role;

COMMIT;
