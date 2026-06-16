-- ============================================================
-- Merchant settlement access + Breet completion alignment
-- Ensures merchant-authenticated reads can access normalized
-- settlement tables, and backfills completed Breet rows with
-- settled timestamps and completion notes.
-- ============================================================

ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_settlement_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_provider_settlement_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_settlement_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "merchant_read_payment_records" ON public.payment_records;
CREATE POLICY "merchant_read_payment_records"
  ON public.payment_records
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (
      EXISTS (
        SELECT 1
        FROM public.merchants m
        WHERE m.id = public.payment_records.merchant_id
          AND m.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.merchant_team mt
        WHERE mt.merchant_id = public.payment_records.merchant_id
          AND mt.user_id = auth.uid()
          AND COALESCE(mt.is_active, false) = true
      )
    )
  );

DROP POLICY IF EXISTS "merchant_read_settlement_records" ON public.settlement_records;
CREATE POLICY "merchant_read_settlement_records"
  ON public.settlement_records
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (
      EXISTS (
        SELECT 1
        FROM public.merchants m
        WHERE m.id = public.settlement_records.merchant_id
          AND m.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.merchant_team mt
        WHERE mt.merchant_id = public.settlement_records.merchant_id
          AND mt.user_id = auth.uid()
          AND COALESCE(mt.is_active, false) = true
      )
    )
  );

DROP POLICY IF EXISTS "merchant_read_settlement_accounts" ON public.merchant_settlement_accounts;
CREATE POLICY "merchant_read_settlement_accounts"
  ON public.merchant_settlement_accounts
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (
      EXISTS (
        SELECT 1
        FROM public.merchants m
        WHERE m.id = public.merchant_settlement_accounts.merchant_id
          AND m.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.merchant_team mt
        WHERE mt.merchant_id = public.merchant_settlement_accounts.merchant_id
          AND mt.user_id = auth.uid()
          AND COALESCE(mt.is_active, false) = true
      )
    )
  );

DROP POLICY IF EXISTS "merchant_read_provider_settlement_accounts" ON public.merchant_provider_settlement_accounts;
CREATE POLICY "merchant_read_provider_settlement_accounts"
  ON public.merchant_provider_settlement_accounts
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (
      EXISTS (
        SELECT 1
        FROM public.merchants m
        WHERE m.id = public.merchant_provider_settlement_accounts.merchant_id
          AND m.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.merchant_team mt
        WHERE mt.merchant_id = public.merchant_provider_settlement_accounts.merchant_id
          AND mt.user_id = auth.uid()
          AND COALESCE(mt.is_active, false) = true
      )
    )
  );

DROP POLICY IF EXISTS "merchant_read_provider_batches" ON public.provider_settlement_batches;
CREATE POLICY "merchant_read_provider_batches"
  ON public.provider_settlement_batches
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (
      EXISTS (
        SELECT 1
        FROM public.merchants m
        WHERE m.id = public.provider_settlement_batches.merchant_id
          AND m.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.merchant_team mt
        WHERE mt.merchant_id = public.provider_settlement_batches.merchant_id
          AND mt.user_id = auth.uid()
          AND COALESCE(mt.is_active, false) = true
      )
    )
  );

UPDATE public.settlement_records sr
SET
  settled_at = COALESCE(
    sr.settled_at,
    CASE
      WHEN NULLIF(sr.raw_settlement_payload->>'updatedAt', '') IS NOT NULL
        THEN (sr.raw_settlement_payload->>'updatedAt')::timestamptz
      WHEN NULLIF(sr.raw_settlement_payload->>'createdAt', '') IS NOT NULL
        THEN (sr.raw_settlement_payload->>'createdAt')::timestamptz
      ELSE now()
    END
  ),
  reconciliation_notes = COALESCE(NULLIF(sr.reconciliation_notes, ''), 'breet trade completed')
WHERE sr.provider_name = 'breet'
  AND sr.payment_method = 'crypto'
  AND sr.settlement_status = 'completed'
  AND sr.actual_settlement IS NOT NULL
  AND (
    COALESCE(sr.expected_settlement_source, '') = 'breet_trade_completed'
    OR COALESCE(sr.raw_settlement_payload->>'event', '') = 'trade.completed'
  )
  AND (
    sr.settled_at IS NULL
    OR COALESCE(sr.reconciliation_notes, '') = ''
  );

UPDATE public.payment_records pr
SET
  processing_status = 'completed',
  reconciliation_status = 'invoice_credited',
  updated_at = now()
FROM public.settlement_records sr
WHERE sr.payment_record_id = pr.id
  AND sr.provider_name = 'breet'
  AND sr.payment_method = 'crypto'
  AND sr.settlement_status = 'completed'
  AND sr.actual_settlement IS NOT NULL
  AND (
    COALESCE(pr.processing_status, '') <> 'completed'
    OR COALESCE(pr.reconciliation_status, '') <> 'invoice_credited'
  );
