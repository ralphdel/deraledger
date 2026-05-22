-- DeraLedger — Verification Engine Provider Settings Migration
-- Run AFTER existing schema is in place.
-- This migration is fully additive — no existing data is modified.
-- Safe to run against both staging and production.

-- ── 1. Provider configuration in platform_settings ───────────────────────────
-- platform_settings table already exists (key TEXT PK, value TEXT, updated_by, updated_at)

INSERT INTO platform_settings (key, value, updated_by, updated_at)
VALUES
  ('active_verification_provider', 'DOJAH',  NULL, now()),
  ('verification_sandbox_mode',    'true',   NULL, now()),
  ('verification_provider_health', '{"DOJAH":"UNCHECKED","YOUVERIFY":"UNCHECKED"}', NULL, now())
ON CONFLICT (key) DO NOTHING;

-- ── 2. Identity verification capability flag on merchants ────────────────────
-- Separates "identity is verified" (BVN+selfie) from overall verification_status
-- This is an ADDITIVE field — existing records default to false.
-- Set to true when bvn_status = "verified" AND selfie_status = "verified" AND admin-approved.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS identity_verified          BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS identity_verified_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS active_verification_provider TEXT        DEFAULT 'DOJAH';

-- Backfill: merchants already fully verified get identity_verified = true
UPDATE merchants
SET
  identity_verified        = TRUE,
  identity_verified_at     = COALESCE(kyc_reviewed_at, kyc_submitted_at, updated_at)
WHERE
  verification_status      = 'verified'
  AND bvn_status           = 'verified'
  AND (selfie_status        = 'verified' OR selfie_status IS NULL);

-- ── 3. Verification records table (modular per-attempt audit trail) ──────────
-- Each verification attempt creates one record.
-- Supports independent retry / fail / update per stage (identity / business / representative).

CREATE TABLE IF NOT EXISTS verification_records (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id         UUID          NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  -- Type of verification attempt
  verification_type   TEXT          NOT NULL CHECK (verification_type IN ('identity', 'business', 'representative')),
  -- Which provider was used for this attempt
  provider            TEXT          NOT NULL CHECK (provider IN ('DOJAH', 'YOUVERIFY')),
  -- Sandbox or production
  is_sandbox          BOOLEAN       NOT NULL DEFAULT TRUE,
  -- Outcome
  status              TEXT          NOT NULL CHECK (status IN ('pending', 'verified', 'rejected', 'failed', 'retrying')),
  match_score         NUMERIC(5, 2),
  provider_reference  TEXT,
  error_code          TEXT,
  error_message       TEXT,
  -- Full audit — raw response stored encrypted at rest via Supabase
  raw_response        JSONB,
  -- Attempt tracking (increments per merchant+type combination)
  attempt_number      INTEGER       NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Index: fast lookups by merchant and type
CREATE INDEX IF NOT EXISTS idx_verification_records_merchant
  ON verification_records (merchant_id, verification_type, created_at DESC);

-- ── 4. Row Level Security ─────────────────────────────────────────────────────
ALTER TABLE verification_records ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist to prevent duplicates
DROP POLICY IF EXISTS "merchants_read_own_verification_records" ON verification_records;
DROP POLICY IF EXISTS "service_role_full_access_verification_records" ON verification_records;

-- Merchants can only read their own records
CREATE POLICY "merchants_read_own_verification_records"
  ON verification_records FOR SELECT
  USING (
    merchant_id IN (
      SELECT id FROM merchants WHERE user_id = auth.uid()
    )
  );

-- Only service role (server actions) can insert/update/delete
CREATE POLICY "service_role_full_access_verification_records"
  ON verification_records FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── End of migration ──────────────────────────────────────────────────────────
