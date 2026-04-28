-- ============================================================
-- PurpLedger v2.1 — Full Database Migration
-- STEP 1: Purge test data (protect ralphdel14@yahoo.com)
-- STEP 2: Schema migration
-- STEP 3: Seed platform_settings
-- STEP 4: Verification
--
-- Run in Supabase SQL Editor AFTER taking a full backup.
-- Run ONCE. Do not re-run — use IF NOT EXISTS guards.
-- ============================================================


-- ============================================================
-- STEP 1: PURGE TEST DATA
-- PROTECTED: ralphdel14@yahoo.com — NEVER deleted
-- ============================================================

BEGIN;

-- Safety check: abort if protected admin account is missing
DO $$ DECLARE
  protected_email TEXT := 'ralphdel14@yahoo.com';
  protected_user_id UUID;
BEGIN
  SELECT id INTO protected_user_id FROM auth.users WHERE email = protected_email;
  IF protected_user_id IS NULL THEN
    RAISE EXCEPTION 'ABORT: Protected admin account not found in auth.users. Do not proceed.';
  END IF;
  RAISE NOTICE 'Protected admin confirmed: %', protected_user_id;
END $$;

-- Delete transactional data (FK order: children first)
-- NOTE: payment_events and manual_payments are NEW tables created in Step 3.
-- They do not exist yet — nothing to purge from them.

DELETE FROM transactions
  WHERE merchant_id NOT IN (
    SELECT id FROM merchants WHERE email = 'ralphdel14@yahoo.com'
  );

DELETE FROM invoice_line_items
  WHERE invoice_id IN (
    SELECT id FROM invoices WHERE merchant_id NOT IN (
      SELECT id FROM merchants WHERE email = 'ralphdel14@yahoo.com'
    )
  );

DELETE FROM invoices
  WHERE merchant_id NOT IN (
    SELECT id FROM merchants WHERE email = 'ralphdel14@yahoo.com'
  );

DELETE FROM clients
  WHERE merchant_id NOT IN (
    SELECT id FROM merchants WHERE email = 'ralphdel14@yahoo.com'
  );

-- item_catalog, discount_templates, onboarding_sessions are NEW tables (created in Step 3).
-- They do not exist yet — nothing to purge from them.

DELETE FROM pending_invites
  WHERE merchant_id NOT IN (
    SELECT id FROM merchants WHERE email = 'ralphdel14@yahoo.com'
  );

DELETE FROM merchant_team
  WHERE merchant_id NOT IN (
    SELECT id FROM merchants WHERE email = 'ralphdel14@yahoo.com'
  );

DELETE FROM audit_logs
  WHERE actor_id NOT IN (
    SELECT user_id FROM merchants WHERE email = 'ralphdel14@yahoo.com'
  )
  AND actor_id IS NOT NULL;

-- Delete merchant records (except protected)
DELETE FROM merchants
  WHERE email != 'ralphdel14@yahoo.com';

-- Verify protection
DO $$ BEGIN
  IF (SELECT COUNT(*) FROM merchants WHERE email = 'ralphdel14@yahoo.com') = 0 THEN
    RAISE EXCEPTION 'ABORT: Protected admin merchant record was deleted. ROLLBACK immediately.';
  END IF;
  RAISE NOTICE 'Purge complete. Protected admin intact. Remaining merchants: %', (SELECT COUNT(*) FROM merchants);
END $$;

COMMIT;

-- NOTE: Auth users must be purged separately via Supabase Dashboard:
-- Authentication → Users → select all non-admin users → Delete
-- Leave ralphdel14@yahoo.com intact.


-- ============================================================
-- STEP 2: SCHEMA MIGRATION
-- ============================================================

-- 2.1 merchants table — add v2.1 columns
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS subscription_plan        TEXT NOT NULL DEFAULT 'starter'
    CONSTRAINT valid_subscription_plan CHECK (subscription_plan IN ('starter', 'individual', 'corporate')),

  ADD COLUMN IF NOT EXISTS settlement_bank_name      TEXT,
  ADD COLUMN IF NOT EXISTS settlement_bank_code      TEXT,
  ADD COLUMN IF NOT EXISTS settlement_account_number TEXT,
  ADD COLUMN IF NOT EXISTS settlement_account_name   TEXT,
  ADD COLUMN IF NOT EXISTS settlement_account_type   TEXT DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS payment_subaccount_code   TEXT,
  ADD COLUMN IF NOT EXISTS payment_provider          TEXT DEFAULT 'paystack',
  ADD COLUMN IF NOT EXISTS subaccount_verified       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS settlement_activated_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS monthly_collection_limit  NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kyc_submitted_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_notes                 TEXT,
  ADD COLUMN IF NOT EXISTS holds_pending_review      BOOLEAN NOT NULL DEFAULT false;

-- Sync subscription_plan from existing merchant_tier if column exists
-- (This handles the rename from merchant_tier → subscription_plan)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'merchants' AND column_name = 'merchant_tier') THEN
    UPDATE merchants
      SET subscription_plan = merchant_tier
      WHERE subscription_plan = 'starter'; -- only update defaults
    RAISE NOTICE 'Synced merchant_tier → subscription_plan';
  END IF;
END $$;


-- 2.2 clients table — add address, whatsapp_number, and reminder preference columns
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS address            TEXT CONSTRAINT address_max CHECK (char_length(address) <= 300),
  ADD COLUMN IF NOT EXISTS whatsapp_number    TEXT CONSTRAINT whatsapp_format
    CHECK (whatsapp_number IS NULL OR whatsapp_number ~ '^[0-9]{10,15}$'),
  ADD COLUMN IF NOT EXISTS reminder_enabled   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_channels  TEXT[] NOT NULL DEFAULT '{}';
  -- reminder_channels values: 'email', 'whatsapp', or both: '{"email","whatsapp"}'
  -- Constraint: if reminder_channels includes 'email', email must not be null
  --             if reminder_channels includes 'whatsapp', whatsapp_number must not be null
  -- (enforced at application layer for better UX error messages)


-- 2.3 invoices table — add invoice_type
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS invoice_type TEXT NOT NULL DEFAULT 'collection'
    CONSTRAINT valid_invoice_type CHECK (invoice_type IN ('record', 'collection')),
  ADD COLUMN IF NOT EXISTS payment_notes TEXT; -- Record Invoice only: how payment was received


-- 2.4 invoice_line_items table — ensure correct table name used in app
-- (app uses 'line_items' internally — check your schema name and align)
-- If your table is named invoice_line_items, update references in actions.ts accordingly.


-- ============================================================
-- STEP 3: CREATE NEW TABLES
-- ============================================================

-- 3.1 manual_payments (Record Invoice offline payment tracking)
CREATE TABLE IF NOT EXISTS manual_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  merchant_id     UUID NOT NULL REFERENCES merchants(id),
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method  TEXT NOT NULL DEFAULT 'cash'
    CONSTRAINT valid_payment_method CHECK (payment_method IN ('cash', 'bank_transfer', 'cheque', 'other')),
  date_received   DATE NOT NULL DEFAULT CURRENT_DATE,
  reference_note  TEXT,
  recorded_by     UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE manual_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS manual_payments_merchant ON manual_payments;
CREATE POLICY manual_payments_merchant ON manual_payments
  FOR ALL USING (
    merchant_id IN (
      SELECT id FROM merchants WHERE user_id = auth.uid()
      UNION
      SELECT merchant_id FROM merchant_team
        WHERE user_id = auth.uid() AND is_active = true
    )
  );


-- 3.2 item_catalog
CREATE TABLE IF NOT EXISTS item_catalog (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id   UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  item_name     TEXT NOT NULL CONSTRAINT item_name_len CHECK (char_length(item_name) <= 200),
  default_rate  NUMERIC(12,2) NOT NULL CHECK (default_rate >= 0),
  description   TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  usage_count   INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE item_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS item_catalog_merchant ON item_catalog;
CREATE POLICY item_catalog_merchant ON item_catalog
  FOR ALL USING (
    merchant_id IN (
      SELECT id FROM merchants WHERE user_id = auth.uid()
      UNION
      SELECT merchant_id FROM merchant_team
        WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE INDEX IF NOT EXISTS idx_item_catalog_merchant ON item_catalog(merchant_id, is_active);


-- 3.3 discount_templates
CREATE TABLE IF NOT EXISTS discount_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id   UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CONSTRAINT discount_name_len CHECK (char_length(name) <= 100),
  percentage    NUMERIC(5,2) NOT NULL CHECK (percentage > 0 AND percentage <= 100),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE discount_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS discount_templates_merchant ON discount_templates;
CREATE POLICY discount_templates_merchant ON discount_templates
  FOR ALL USING (
    merchant_id IN (
      SELECT id FROM merchants WHERE user_id = auth.uid()
      UNION
      SELECT merchant_id FROM merchant_team
        WHERE user_id = auth.uid() AND is_active = true
    )
  );


-- 3.4 onboarding_sessions (paid onboarding flow)
CREATE TABLE IF NOT EXISTS onboarding_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL,
  business_name   TEXT NOT NULL,
  plan            TEXT NOT NULL CHECK (plan IN ('individual', 'corporate')),
  status          TEXT NOT NULL DEFAULT 'awaiting_payment'
    CHECK (status IN ('awaiting_payment', 'payment_confirmed', 'activated', 'expired')),
  paystack_ref    TEXT,
  amount_paid     NUMERIC(10,2),
  merchant_id     UUID REFERENCES merchants(id),
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT UNIQUE  -- Paystack ref — prevents duplicate processing
);

CREATE INDEX IF NOT EXISTS idx_onboarding_pending
  ON onboarding_sessions(status, created_at)
  WHERE status = 'awaiting_payment';


-- 3.5 platform_settings (admin-configurable key-value store)
CREATE TABLE IF NOT EXISTS platform_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_by  UUID REFERENCES auth.users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed with all 11 required keys
INSERT INTO platform_settings (key, value) VALUES
  ('tier1_monthly_limit',          '5000000'),
  ('tier2_monthly_limit',          'unlimited'),
  ('starter_invoice_limit',        '5'),
  ('starter_client_limit',         '10'),
  ('individual_team_limit',        '2'),
  ('individual_price_ngn',         '5000'),
  ('corporate_price_ngn',          '20000'),
  ('auto_tier_up_threshold',       '1000000'),
  ('auto_tier_up_min_days',        '60'),
  ('auto_tier_up_chargeback_window','90'),
  ('active_payment_provider',      'paystack')
ON CONFLICT (key) DO NOTHING;


-- 3.6 payment_events (raw webhook event log)
CREATE TABLE IF NOT EXISTS payment_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     UUID NOT NULL REFERENCES merchants(id),
  invoice_id      UUID REFERENCES invoices(id),
  transaction_id  UUID REFERENCES transactions(id),
  event_type      TEXT NOT NULL,
  processor       TEXT NOT NULL DEFAULT 'paystack',
  processor_ref   TEXT,
  amount_kobo     BIGINT,
  raw_payload     JSONB,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_payment_events_merchant ON payment_events(merchant_id, processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_events_invoice  ON payment_events(invoice_id);


-- ============================================================
-- STEP 4: VERIFICATION
-- ============================================================

-- Confirm platform_settings seeded correctly (should return 11 rows)
SELECT key, value FROM platform_settings ORDER BY key;

-- Confirm protected admin is intact
SELECT
  m.email,
  m.subscription_plan,
  m.verification_status,
  au.raw_user_meta_data->>'is_super_admin' AS is_super_admin
FROM merchants m
JOIN auth.users au ON au.email = m.email
WHERE m.email = 'ralphdel14@yahoo.com';

-- Expected: subscription_plan = 'corporate' (or current value), verification_status = 'verified', is_super_admin = 'true'

-- Confirm merchant count after purge (should be 1 — admin only)
SELECT COUNT(*) AS remaining_merchants FROM merchants;

-- ============================================================
-- MIGRATION COMPLETE
-- Next: run npm run build && git push
-- ============================================================
