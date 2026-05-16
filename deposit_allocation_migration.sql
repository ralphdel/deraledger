-- DeraLedger — Deposit Allocation Migration
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS invoice_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  source_invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  target_invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  allocated_amount NUMERIC(14,2) NOT NULL CHECK (allocated_amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_invoice_id, target_invoice_id)
);

-- Index for fast lookups by target invoice
CREATE INDEX IF NOT EXISTS idx_invoice_allocations_target ON invoice_allocations(target_invoice_id);
-- Index for fast lookups by source invoice
CREATE INDEX IF NOT EXISTS idx_invoice_allocations_source ON invoice_allocations(source_invoice_id);
-- Index for merchant-level queries
CREATE INDEX IF NOT EXISTS idx_invoice_allocations_merchant ON invoice_allocations(merchant_id);
