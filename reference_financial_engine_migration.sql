-- ============================================================================
-- DeraLedger — Reference Financial Engine Migration (Fixed)
-- "references" is a reserved word in PostgreSQL — must be double-quoted.
-- Run in Supabase SQL Editor.
-- ============================================================================

-- 1. Add project_total_value to references table
ALTER TABLE "references" ADD COLUMN IF NOT EXISTS project_total_value NUMERIC DEFAULT 0;

-- 2. Add invoice_stage to invoices table
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_stage TEXT DEFAULT 'standard';

-- 3. Add CHECK constraint for invoice_stage (safe — skips if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'invoices' AND constraint_name = 'invoices_invoice_stage_check'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_invoice_stage_check
      CHECK (invoice_stage IN ('deposit', 'milestone', 'balance', 'standard'));
  END IF;
END $$;

-- 4. Verify
SELECT table_name, column_name, data_type, column_default
FROM information_schema.columns
WHERE (table_name = 'references' AND column_name = 'project_total_value')
   OR (table_name = 'invoices'   AND column_name = 'invoice_stage')
ORDER BY table_name, column_name;
