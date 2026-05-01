-- 1. Create Subscriptions Table
CREATE TYPE subscription_plan_type AS ENUM ('individual', 'corporate', 'starter');
CREATE TYPE subscription_status AS ENUM ('active', 'expired', 'cancelled');

CREATE TABLE public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    plan_type subscription_plan_type NOT NULL,
    amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
    start_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    expiry_date TIMESTAMPTZ NOT NULL,
    status subscription_status NOT NULL DEFAULT 'active',
    last_notified_at TIMESTAMPTZ,
    is_banner_dismissed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(merchant_id) -- Ensures 1:1 active mapping for easy lookups
);

-- 2. Add Row Level Security (RLS)
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Policy: Merchants can read their own subscription
CREATE POLICY "Merchants can view own subscription" 
ON public.subscriptions 
FOR SELECT 
USING (
  merchant_id IN (
    SELECT id FROM public.merchants WHERE user_id = auth.uid()
    UNION
    SELECT merchant_id FROM public.merchant_team WHERE user_id = auth.uid()
  )
);

-- Policy: SuperAdmins can read all subscriptions
CREATE POLICY "SuperAdmins can view all subscriptions"
ON public.subscriptions
FOR SELECT
USING (
  auth.jwt() ->> 'email' = 'ralphdel14@yahoo.com'
);

-- Note: Inserts and Updates are handled securely via Server Actions or Webhooks using Service Role

-- 3. Set up updated_at trigger
CREATE OR REPLACE FUNCTION public.set_current_timestamp_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER handle_subscriptions_updated_at 
BEFORE UPDATE ON public.subscriptions 
FOR EACH ROW EXECUTE PROCEDURE public.set_current_timestamp_updated_at();

-- 4. Backfill Existing Merchants
-- This migrates all current merchants into the subscriptions table.
-- We give 'starter' plans a theoretical 10-year expiry since they expire on invoice count, not time.
-- We give existing 'individual' and 'corporate' plans a 30-day expiry starting from today.
INSERT INTO public.subscriptions (merchant_id, plan_type, amount_paid, start_date, expiry_date, status)
SELECT 
    id,
    CASE 
        WHEN subscription_plan = 'corporate' THEN 'corporate'::subscription_plan_type
        WHEN subscription_plan = 'individual' THEN 'individual'::subscription_plan_type
        ELSE 'starter'::subscription_plan_type
    END,
    0, -- Amount paid is historical, set to 0
    now(),
    CASE 
        WHEN subscription_plan = 'starter' THEN now() + interval '10 years'
        ELSE now() + interval '30 days'
    END,
    'active'::subscription_status
FROM public.merchants
ON CONFLICT (merchant_id) DO NOTHING;
