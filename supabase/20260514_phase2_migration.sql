-- ============================================================
-- DeraLedger Phase 2 Migration
-- Stream 2: Forced Platform Re-Acknowledgement
-- Stream 3: KYC Document Storage columns
-- Stream 4: KYC Rate Limiting columns
-- Stream 5: Invoice Archive/Delete policy
-- ============================================================

-- ── STREAM 2: Platform Re-Acknowledgement ────────────────────────────────────
-- Track what platform version each merchant has acknowledged

-- Add platform version tracking to merchants
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS last_acknowledged_version INTEGER DEFAULT 0 NOT NULL;

-- Global platform settings table (if not exists)
CREATE TABLE IF NOT EXISTS platform_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Insert the current platform version (admins bump this to force re-ack)
INSERT INTO platform_settings (key, value)
VALUES ('current_platform_version', '1')
ON CONFLICT (key) DO NOTHING;

-- ── STREAM 3: KYC Document Storage ───────────────────────────────────────────
-- Extend merchant KYC tracking columns

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS kyc_locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_reviewed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dojah_reference  TEXT,
  ADD COLUMN IF NOT EXISTS dojah_match_score NUMERIC(5,2);

-- Create private kyc-documents storage bucket
-- NOTE: Run this in Supabase dashboard SQL editor or via supabase CLI
-- The bucket insert is via Supabase internal tables:
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'kyc-documents',
  'kyc-documents',
  false,           -- private bucket
  10485760,        -- 10MB limit per file
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies for kyc-documents bucket
-- Only the merchant who owns the file can upload; service role can read
DO $$
BEGIN
    DROP POLICY IF EXISTS "kyc_owner_insert" ON storage.objects;
    DROP POLICY IF EXISTS "kyc_service_read" ON storage.objects;
END
$$;

CREATE POLICY "kyc_owner_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'kyc-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "kyc_service_read"
ON storage.objects FOR SELECT
TO service_role
USING (bucket_id = 'kyc-documents');

-- ── STREAM 4: KYC Rate Limiting (columns should already exist) ────────────────
-- Add if missing (idempotent)
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS kyc_attempt_count    INTEGER DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS kyc_last_attempt_at  TIMESTAMPTZ;

-- ── STREAM 5: Invoice Archive + Delete Policy ─────────────────────────────────
-- Soft archive support for invoices

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS is_archived    BOOLEAN DEFAULT FALSE NOT NULL,
  ADD COLUMN IF NOT EXISTS archived_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by    UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS payment_provider       TEXT DEFAULT 'paystack',
  ADD COLUMN IF NOT EXISTS crypto_deposit_address TEXT,
  ADD COLUMN IF NOT EXISTS crypto_asset           TEXT;

-- Index for fast archive filtering
CREATE INDEX IF NOT EXISTS idx_invoices_is_archived
  ON invoices (merchant_id, is_archived);

-- ── STREAM 7: Subscription & Platform ────────────────────────────────────────
-- Platform version on merchants (already added above)
-- Add subscription_expires_at if not present (for subscription enforcement)
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;

-- ── Comments ──────────────────────────────────────────────────────────────────
COMMENT ON COLUMN merchants.last_acknowledged_version IS
  'The last platform version this merchant acknowledged in the re-acknowledgement flow.';
COMMENT ON COLUMN invoices.is_archived IS
  'Soft archive flag. Archived invoices are hidden from default lists but not deleted.';
COMMENT ON COLUMN invoices.payment_provider IS
  'Payment provider for this collection invoice: paystack | monnify | breet';
