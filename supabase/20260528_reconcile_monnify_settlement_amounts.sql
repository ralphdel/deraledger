-- ============================================================
-- Reconcile Monnify Provider-Reported Settlement Amounts
-- Repairs transactions that were first processed by callback
-- verification before Monnify settlementAmount was normalized.
-- ============================================================

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS payment_rail TEXT,
  ADD COLUMN IF NOT EXISTS settlement_status TEXT,
  ADD COLUMN IF NOT EXISTS processor_reference TEXT,
  ADD COLUMN IF NOT EXISTS merchant_net_amount NUMERIC(20,2);

WITH monnify_events AS (
  SELECT DISTINCT ON (processor_ref)
    processor_ref,
    amount_kobo,
    NULLIF(raw_payload #>> '{eventData,settlementAmount}', '')::numeric AS settlement_amount,
    raw_payload #>> '{eventData,paymentMethod}' AS payment_method
  FROM public.payment_events
  WHERE processor = 'monnify'
    AND processor_ref IS NOT NULL
    AND NULLIF(raw_payload #>> '{eventData,settlementAmount}', '') IS NOT NULL
  ORDER BY processor_ref, created_at DESC NULLS LAST
)
UPDATE public.transactions AS t
SET
  paystack_fee = GREATEST(0, ROUND((t.amount_paid - e.settlement_amount)::numeric, 2)),
  merchant_net_amount = ROUND(e.settlement_amount::numeric, 2),
  processor_reference = COALESCE(t.processor_reference, e.processor_ref),
  payment_rail = COALESCE(
    t.payment_rail,
    CASE
      WHEN LOWER(COALESCE(e.payment_method, '')) LIKE '%transfer%' THEN 'bank_transfer'
      WHEN LOWER(COALESCE(e.payment_method, '')) LIKE '%card%' THEN 'card'
      WHEN LOWER(COALESCE(e.payment_method, '')) LIKE '%ussd%' THEN 'ussd'
      ELSE t.payment_method
    END
  ),
  settlement_status = CASE
    WHEN t.settlement_status IS NULL OR t.settlement_status = 'settled' THEN 'processing'
    ELSE t.settlement_status
  END
FROM monnify_events e
WHERE t.paystack_reference = e.processor_ref
  AND e.settlement_amount > 0
  AND e.settlement_amount <= t.amount_paid;

