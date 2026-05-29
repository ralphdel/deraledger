-- ============================================================
-- Repair Provider-reported Settlement Records
-- Recalculates non-completed, non-batched settlement records from
-- stored provider payloads when either settlement amount or provider
-- fee is present. Only rows with both missing remain manual_review.
-- ============================================================

WITH settlement_payloads AS (
  SELECT
    sr.id,
    sr.provider_name,
    sr.gross_amount,
    sr.fee_payer,
    sr.settlement_account_id,
    sr.provider_settlement_account_id,
    COALESCE(pe.raw_payload, pr.raw_provider_payload, sr.raw_settlement_payload, '{}'::jsonb) AS payload,
    COALESCE(
      pe.raw_payload #>> '{eventData,settlementAmount}',
      pr.raw_provider_payload #>> '{eventData,settlementAmount}',
      sr.raw_settlement_payload #>> '{eventData,settlementAmount}',
      pe.raw_payload #>> '{settlementAmount}',
      pr.raw_provider_payload #>> '{settlementAmount}',
      sr.raw_settlement_payload #>> '{settlementAmount}'
    ) AS provider_settlement_amount_text,
    COALESCE(
      pe.raw_payload #>> '{data,fees}',
      pr.raw_provider_payload #>> '{data,fees}',
      sr.raw_settlement_payload #>> '{data,fees}',
      pe.raw_payload #>> '{fees}',
      pr.raw_provider_payload #>> '{fees}',
      sr.raw_settlement_payload #>> '{fees}'
    ) AS provider_fee_kobo_text
  FROM public.settlement_records sr
  LEFT JOIN public.payment_records pr ON pr.id = sr.payment_record_id
  LEFT JOIN LATERAL (
    SELECT raw_payload
    FROM public.payment_events pe
    WHERE pe.processor_ref = pr.provider_reference
       OR pe.processor_ref = pr.internal_reference
       OR pe.processor_ref = sr.provider_settlement_reference
    ORDER BY pe.created_at DESC NULLS LAST
    LIMIT 1
  ) pe ON true
  WHERE sr.settlement_status <> 'completed'
    AND sr.provider_settlement_batch_id IS NULL
),
parsed AS (
  SELECT
    *,
    CASE
      WHEN provider_settlement_amount_text ~ '^[0-9]+(\.[0-9]+)?$'
        THEN provider_settlement_amount_text::numeric
      ELSE NULL
    END AS provider_settlement_amount,
    CASE
      WHEN provider_fee_kobo_text ~ '^[0-9]+(\.[0-9]+)?$'
        THEN provider_fee_kobo_text::numeric / 100
      ELSE NULL
    END AS provider_fee_amount
  FROM settlement_payloads
),
calculated AS (
  SELECT
    id,
    CASE
      WHEN provider_name = 'monnify'
        AND provider_settlement_amount IS NOT NULL
        AND provider_settlement_amount >= 0
        AND provider_settlement_amount <= gross_amount
        THEN provider_settlement_amount
      WHEN provider_fee_amount IS NOT NULL
        THEN CASE
          WHEN fee_payer = 'customer_pays_fee' THEN gross_amount
          ELSE GREATEST(0, gross_amount - provider_fee_amount)
        END
      ELSE NULL
    END AS expected_settlement,
    CASE
      WHEN provider_name = 'monnify'
        AND provider_settlement_amount IS NOT NULL
        AND provider_settlement_amount >= 0
        AND provider_settlement_amount <= gross_amount
        THEN GREATEST(0, gross_amount - provider_settlement_amount)
      WHEN provider_fee_amount IS NOT NULL
        THEN provider_fee_amount
      ELSE NULL
    END AS provider_fee,
    CASE
      WHEN provider_name = 'monnify'
        AND provider_settlement_amount IS NOT NULL
        AND provider_settlement_amount >= 0
        AND provider_settlement_amount <= gross_amount
        THEN 'provider_settlement_amount'
      WHEN provider_fee_amount IS NOT NULL
        THEN 'provider_fee'
      ELSE 'provider_missing'
    END AS settlement_source,
    CASE
      WHEN (
        provider_name = 'monnify'
        AND provider_settlement_amount IS NOT NULL
        AND provider_settlement_amount >= 0
        AND provider_settlement_amount <= gross_amount
      ) OR provider_fee_amount IS NOT NULL
        THEN 'processing'
      ELSE 'manual_review'
    END AS next_status
  FROM parsed
)
UPDATE public.settlement_records sr
SET
  provider_fee = COALESCE(calculated.provider_fee, 0),
  merchant_fee = CASE
    WHEN sr.fee_payer = 'merchant_pays_fee' THEN COALESCE(calculated.provider_fee, 0)
    ELSE 0
  END,
  customer_fee = CASE
    WHEN sr.fee_payer = 'customer_pays_fee' THEN COALESCE(calculated.provider_fee, 0)
    ELSE 0
  END,
  expected_settlement = calculated.expected_settlement,
  actual_settlement = CASE
    WHEN sr.actual_settlement = 0 AND sr.settlement_status = 'manual_review' THEN NULL
    ELSE sr.actual_settlement
  END,
  settlement_difference = CASE
    WHEN sr.actual_settlement = 0 AND sr.settlement_status = 'manual_review' THEN NULL
    ELSE sr.settlement_difference
  END,
  settlement_status = calculated.next_status,
  settlement_owner = CASE
    WHEN calculated.next_status = 'manual_review' THEN 'manual_review'
    ELSE 'provider'
  END,
  provider_fee_source = calculated.settlement_source,
  expected_settlement_source = calculated.settlement_source,
  reconciliation_notes = CASE
    WHEN calculated.next_status = 'processing'
      THEN CASE
        WHEN sr.provider_settlement_account_id IS NULL
          THEN 'Repaired from provider payload; expected settlement calculated. Provider mapping should be checked before live routing.'
        ELSE 'Repaired from stored provider payload; awaiting provider settlement confirmation.'
      END
    ELSE sr.reconciliation_notes
  END,
  updated_at = now()
FROM calculated
WHERE calculated.id = sr.id;
