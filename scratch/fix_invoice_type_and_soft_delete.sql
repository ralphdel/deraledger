-- ============================================================
-- Migration: Client Soft Delete + Invoice Type Correction
-- Run this in Supabase SQL Editor (once)
-- ============================================================

-- 1. Add soft-delete columns to clients table (if not already present)
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

-- Create index for performance on common query pattern
CREATE INDEX IF NOT EXISTS idx_clients_is_deleted ON clients(merchant_id, is_deleted);

-- 2. Fix invoices incorrectly created as 'collection' type for Starter plan merchants.
--    This corrects historical data caused by the default type bug.
--    Safe: only updates invoices for merchants who are currently on the starter plan
--    AND whose invoices have invoice_type = 'collection' AND have NO Paystack transactions
--    (i.e. no one has ever attempted to pay them — they are definitively offline records).

UPDATE invoices i
SET invoice_type = 'record'
WHERE 
  i.invoice_type = 'collection'
  AND EXISTS (
    SELECT 1 FROM merchants m
    WHERE m.id = i.merchant_id
    AND m.subscription_plan = 'starter'
  )
  AND NOT EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.invoice_id = i.id
  );

-- 3. Specifically fix invoices for anokblessing92@gmail.com
--    (belt-and-suspenders — covered by step 2, but explicit for audit clarity)
UPDATE invoices i
SET invoice_type = 'record'
FROM merchants m
WHERE 
  m.id = i.merchant_id
  AND m.email = 'anokblessing92@gmail.com'
  AND i.invoice_type = 'collection'
  AND NOT EXISTS (
    SELECT 1 FROM transactions t WHERE t.invoice_id = i.id
  );

-- 4. Verify the fix
SELECT 
  m.email,
  m.subscription_plan,
  i.invoice_number,
  i.invoice_type,
  i.grand_total,
  i.created_at
FROM invoices i
JOIN merchants m ON m.id = i.merchant_id
WHERE m.email = 'anokblessing92@gmail.com'
ORDER BY i.created_at DESC;
