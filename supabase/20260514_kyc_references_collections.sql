-- DeraLedger KYC + References additions
-- Safe to re-run: all changes are additive and idempotent.

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS selfie_url TEXT,
  ADD COLUMN IF NOT EXISTS selfie_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (selfie_status IN ('unverified', 'pending', 'verified', 'rejected')),
  ADD COLUMN IF NOT EXISTS dojah_reference TEXT,
  ADD COLUMN IF NOT EXISTS dojah_match_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS kyc_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kyc_last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public."references" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  handled_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, name)
);

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS reference_id UUID REFERENCES public."references"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS handled_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_references_merchant ON public."references"(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_reference ON public.invoices(reference_id);
CREATE INDEX IF NOT EXISTS idx_invoices_handled_by ON public.invoices(handled_by);

ALTER TABLE public."references" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Merchant members can view references" ON public."references";
CREATE POLICY "Merchant members can view references"
  ON public."references"
  FOR SELECT
  USING (
    merchant_id IN (
      SELECT id FROM public.merchants WHERE user_id = auth.uid()
      UNION
      SELECT merchant_id FROM public.merchant_team WHERE user_id = auth.uid() AND is_active = true
    )
  );

DROP POLICY IF EXISTS "Merchant members can manage references" ON public."references";
CREATE POLICY "Merchant members can manage references"
  ON public."references"
  FOR ALL
  USING (
    merchant_id IN (
      SELECT id FROM public.merchants WHERE user_id = auth.uid()
      UNION
      SELECT merchant_id FROM public.merchant_team WHERE user_id = auth.uid() AND is_active = true
    )
  )
  WITH CHECK (
    merchant_id IN (
      SELECT id FROM public.merchants WHERE user_id = auth.uid()
      UNION
      SELECT merchant_id FROM public.merchant_team WHERE user_id = auth.uid() AND is_active = true
    )
  );
