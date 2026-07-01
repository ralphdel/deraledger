-- ============================================================
-- DeraLedger staging bootstrap: schema only
-- Source: supabase/schema.sql
-- Purpose: create baseline tables only, with no demo/sample data
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  logo_url TEXT,
  fee_absorption_default TEXT NOT NULL DEFAULT 'business'
    CHECK (fee_absorption_default IN ('business', 'customer')),
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected', 'suspended')),
  subscription_plan TEXT NOT NULL DEFAULT 'starter',
  merchant_tier TEXT NOT NULL DEFAULT 'starter'
    CHECK (merchant_tier IN ('starter', 'individual', 'corporate')),
  kyc_submitted_at TIMESTAMPTZ,
  kyc_notes TEXT,
  monthly_collection_limit NUMERIC(12,2) NOT NULL DEFAULT 0,
  holds_pending_review BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  permissions JSONB NOT NULL DEFAULT '{}',
  is_system_role BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS merchant_team (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  invited_by UUID REFERENCES auth.users(id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at TIMESTAMPTZ,
  UNIQUE (merchant_id, user_id)
);

CREATE TABLE IF NOT EXISTS pending_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  role_id UUID NOT NULL REFERENCES roles(id),
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company_name TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id),
  invoice_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'partially_paid', 'closed', 'manually_closed', 'expired', 'void')),
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  discount_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  grand_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  outstanding_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  fee_absorption TEXT NOT NULL DEFAULT 'business'
    CHECK (fee_absorption IN ('business', 'customer')),
  pay_by_date DATE,
  short_link TEXT,
  qr_code_url TEXT,
  notes TEXT,
  manual_close_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  quantity NUMERIC(10,3) NOT NULL DEFAULT 1,
  unit_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  amount_paid NUMERIC(12,2) NOT NULL,
  k_factor NUMERIC(10,6) NOT NULL,
  tax_collected NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_applied NUMERIC(12,2) NOT NULL DEFAULT 0,
  paystack_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  fee_absorbed_by TEXT NOT NULL DEFAULT 'business'
    CHECK (fee_absorbed_by IN ('business', 'customer')),
  paystack_reference TEXT UNIQUE,
  payment_method TEXT DEFAULT 'card'
    CHECK (payment_method IN ('card', 'bank_transfer', 'ussd')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('success', 'failed', 'pending', 'held_pending_review')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  actor_id UUID,
  actor_role TEXT DEFAULT 'merchant'
    CHECK (actor_role IN ('merchant', 'admin', 'system')),
  target_id UUID,
  target_type TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  provider_name TEXT NOT NULL,
  verification_type TEXT NOT NULL
    CHECK (verification_type IN ('bvn_selfie', 'business', 'director', 'identity')),
  verification_id TEXT,
  request_fingerprint TEXT,
  masked_bvn TEXT,
  response_status TEXT,
  normalized_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (normalized_status IN ('verified', 'failed', 'pending', 'retrying', 'provider_down')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  verification_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_sandbox BOOLEAN NOT NULL DEFAULT false,
  request_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  response_timestamp TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  match_score NUMERIC(5,2),
  provider_reference TEXT,
  raw_response JSONB DEFAULT '{}',
  attempt_number INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verification_logs_merchant
  ON verification_logs(merchant_id);
CREATE INDEX IF NOT EXISTS idx_verification_logs_fingerprint
  ON verification_logs(request_fingerprint);
CREATE INDEX IF NOT EXISTS idx_verification_logs_created
  ON verification_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verification_logs_status
  ON verification_logs(normalized_status);
