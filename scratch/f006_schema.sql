-- New table: tracks every subscription payment separately from operational transactions
-- Provides clean billing history without polluting the transactions table
CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id       UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  plan              TEXT NOT NULL,          -- 'individual' | 'corporate'
  amount_ngn        NUMERIC(10,2) NOT NULL, -- ₦5000 or ₦20000
  period_start      TIMESTAMPTZ NOT NULL,   -- Start of the 30-day window
  period_end        TIMESTAMPTZ NOT NULL,   -- End of the 30-day window
  paystack_ref      TEXT NOT NULL UNIQUE,   -- Paystack transaction reference
  payment_type      TEXT NOT NULL DEFAULT 'new', -- 'new' | 'renewal' | 'upgrade'
  status            TEXT NOT NULL DEFAULT 'paid', -- 'paid' | 'refunded'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: merchant sees only their own subscription payments
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sub_payments_merchant" ON public.subscription_payments
  FOR SELECT USING (
    merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
  );

-- Backfill: migrate existing successful subscription payments from onboarding_sessions
-- We map onboarding sessions where payment was confirmed and a merchant was created
INSERT INTO public.subscription_payments (
  merchant_id, 
  plan, 
  amount_ngn, 
  period_start, 
  period_end, 
  paystack_ref, 
  payment_type, 
  status, 
  created_at
)
SELECT 
  merchant_id, 
  plan, 
  amount_paid, 
  created_at, 
  COALESCE(expires_at, created_at + INTERVAL '30 days'), 
  paystack_ref, 
  'new', 
  'paid', 
  created_at
FROM public.onboarding_sessions 
WHERE status = 'payment_confirmed' AND merchant_id IS NOT NULL AND paystack_ref IS NOT NULL
ON CONFLICT (paystack_ref) DO NOTHING;
