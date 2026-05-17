-- ═══════════════════════════════════════════════════════════════════════════════
-- PurpLedger — Complete Database Schema
-- PRD v1.0 (Sections 5.1–5.6) + Addendum v1.1 (Sections 12–15)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Platform Settings (Addendum Section 12.5) ────────────────────────────
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO platform_settings (key, value) VALUES
  ('tier1_monthly_limit', '500000'),
  ('tier2_monthly_limit', 'unlimited'),
  ('auto_tier_up_threshold', '1000000'),
  ('auto_tier_up_min_account_age_days', '60'),
  ('auto_tier_up_chargeback_window_days', '90')
ON CONFLICT (key) DO NOTHING;

-- ── 2. Merchants (PRD v1.0 Section 5.1 + Addendum Section 12.5) ────────────
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

  -- Addendum v1.1 Section 12.5
  merchant_tier TEXT NOT NULL DEFAULT 'starter'
    CHECK (merchant_tier IN ('starter', 'individual', 'corporate')),
  kyc_submitted_at TIMESTAMPTZ,
  kyc_notes TEXT,
  monthly_collection_limit NUMERIC(12,2) NOT NULL DEFAULT 0,
  holds_pending_review BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 3. Roles (Addendum Section 14.3) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  permissions JSONB NOT NULL DEFAULT '{}',
  is_system_role BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO roles (name, permissions, is_system_role) VALUES
  -- Admin: Full operational access, no destructive/financial settings
  ('admin', '{
    "view_invoices":true,"create_invoice":true,"edit_invoice":true,
    "record_payment":true,"manual_close":true,"void_invoice":false,
    "view_references":true,"manage_references":true,
    "view_clients":true,"manage_clients":true,"delete_client":false,
    "view_analytics":true,"view_transactions":true,"view_settlements":true,
    "view_item_catalog":true,"manage_item_catalog":true,
    "view_discount_template":true,"manage_discount_template":true,
    "manage_kyc":false,"manage_business":true,"change_fee_settings":true,
    "manage_billing":false,"manage_team":true,
    "manage_advance_settings":true,"manage_settlement_account":false,
    "use_purpbot":true
  }', true),
  -- Accountant: Invoice/financial read+write, no team or settings management
  ('accountant', '{
    "view_invoices":true,"create_invoice":true,"edit_invoice":true,
    "record_payment":true,"manual_close":true,"void_invoice":false,
    "view_references":true,"manage_references":false,
    "view_clients":true,"manage_clients":false,"delete_client":false,
    "view_analytics":true,"view_transactions":true,"view_settlements":true,
    "view_item_catalog":true,"manage_item_catalog":false,
    "view_discount_template":true,"manage_discount_template":false,
    "manage_kyc":false,"manage_business":false,"change_fee_settings":false,
    "manage_billing":false,"manage_team":false,
    "manage_advance_settings":false,"manage_settlement_account":false,
    "use_purpbot":true
  }', true),
  -- Support: Client-facing, view invoices/clients, no financial operations
  ('support', '{
    "view_invoices":true,"create_invoice":false,"edit_invoice":false,
    "record_payment":false,"manual_close":false,"void_invoice":false,
    "view_references":true,"manage_references":false,
    "view_clients":true,"manage_clients":false,"delete_client":false,
    "view_analytics":false,"view_transactions":false,"view_settlements":false,
    "view_item_catalog":true,"manage_item_catalog":false,
    "view_discount_template":false,"manage_discount_template":false,
    "manage_kyc":false,"manage_business":false,"change_fee_settings":false,
    "manage_billing":false,"manage_team":false,
    "manage_advance_settings":false,"manage_settlement_account":false,
    "use_purpbot":false
  }', true),
  -- Admin Support: Invoice+references+analytics+client management, no settings
  ('admin_support', '{
    "view_invoices":true,"create_invoice":true,"edit_invoice":true,
    "record_payment":true,"manual_close":false,"void_invoice":false,
    "view_references":true,"manage_references":true,
    "view_clients":true,"manage_clients":true,"delete_client":false,
    "view_analytics":true,"view_transactions":true,"view_settlements":true,
    "view_item_catalog":true,"manage_item_catalog":true,
    "view_discount_template":true,"manage_discount_template":false,
    "manage_kyc":false,"manage_business":false,"change_fee_settings":false,
    "manage_billing":false,"manage_team":false,
    "manage_advance_settings":false,"manage_settlement_account":false,
    "use_purpbot":true
  }', true)
ON CONFLICT (name) DO UPDATE SET
  permissions = EXCLUDED.permissions,
  is_system_role = true;

-- ── 4. Merchant Team (Addendum Section 14.3) ────────────────────────────────
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

-- ── 5. Pending Invites (Addendum Section 14.3) ─────────────────────────────
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

-- ── 6. Clients (PRD v1.0 Section 5.2) ──────────────────────────────────────
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

-- ── 7. Invoices (PRD v1.0 Section 5.3) ─────────────────────────────────────
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

-- ── 8. Line Items (PRD v1.0 Section 5.3) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  quantity NUMERIC(10,3) NOT NULL DEFAULT 1,
  unit_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ── 9. Transactions (PRD v1.0 Section 5.4) ─────────────────────────────────
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

-- ── 10. Audit Logs (PRD v1.0 Section 5.6) ──────────────────────────────────
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

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED DATA — Realistic Nigerian business consulting invoices
-- ═══════════════════════════════════════════════════════════════════════════════

-- Merchant (demo account)
INSERT INTO merchants (id, business_name, email, phone, fee_absorption_default, verification_status, merchant_tier, monthly_collection_limit)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Adewale & Partners Consulting',
  'ade@adewale.ng',
  '+234 812 345 6789',
  'business',
  'verified',
  'corporate',
  0
) ON CONFLICT (id) DO NOTHING;

-- Clients
INSERT INTO clients (id, merchant_id, full_name, email, phone, company_name) VALUES
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'Oluwaseun Bakare', 'seun@techcorp.ng', '+234 803 111 2222', 'TechCorp Nigeria Ltd'),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'Chioma Okafor', 'chioma@greenfields.ng', '+234 805 333 4444', 'Greenfields Agro'),
  ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000001', 'Emeka Nwosu', 'emeka@logistix.ng', '+234 901 555 6666', 'Logistix Express'),
  ('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000001', 'Fatima Ibrahim', 'fatima@stategovt.ng', '+234 802 777 8888', 'Kano State Ministry of Works'),
  ('00000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000001', 'Dayo Afolabi', 'dayo@creativestudios.ng', '+234 810 999 0000', 'Creative Studios')
ON CONFLICT (id) DO NOTHING;

-- Invoices
INSERT INTO invoices (id, merchant_id, client_id, invoice_number, status, subtotal, discount_pct, discount_value, tax_pct, tax_value, grand_total, amount_paid, outstanding_balance, fee_absorption, pay_by_date, short_link, notes, manual_close_reason) VALUES
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', 'INV-2025-001', 'partially_paid', 2500000, 5, 125000, 7.5, 178125, 2553125, 1000000, 1553125, 'business', '2025-07-15', 'purpledger.app/pay/00000000-0000-0000-0000-000000000101', 'Phase 1 consulting engagement. Payment in installments accepted.', NULL),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000012', 'INV-2025-002', 'open', 850000, 0, 0, 7.5, 63750, 913750, 0, 913750, 'customer', '2025-08-01', 'purpledger.app/pay/00000000-0000-0000-0000-000000000102', 'Agricultural supply chain advisory.', NULL),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000013', 'INV-2025-003', 'closed', 1200000, 10, 120000, 7.5, 81000, 1161000, 1161000, 0, 'business', '2025-06-30', 'purpledger.app/pay/00000000-0000-0000-0000-000000000103', 'Fleet management consultation — fully paid.', NULL),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000014', 'INV-2025-004', 'expired', 5000000, 0, 0, 7.5, 375000, 5375000, 2000000, 3375000, 'business', '2025-05-31', 'purpledger.app/pay/00000000-0000-0000-0000-000000000104', 'Government infrastructure advisory — link expired.', NULL),
  ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000015', 'INV-2025-005', 'manually_closed', 400000, 0, 0, 7.5, 30000, 430000, 415000, 15000, 'business', '2025-07-01', 'purpledger.app/pay/00000000-0000-0000-0000-000000000105', 'Brand identity project.', 'Goodwill Adjustment'),
  ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', 'INV-2025-006', 'open', 1800000, 5, 90000, 7.5, 128250, 1838250, 0, 1838250, 'business', '2025-09-01', 'purpledger.app/pay/00000000-0000-0000-0000-000000000106', 'Phase 2 — Digital Transformation advisory.', NULL)
ON CONFLICT (id) DO NOTHING;

-- Line Items
INSERT INTO line_items (id, invoice_id, item_name, quantity, unit_rate, line_total, sort_order) VALUES
  ('00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000000101', 'Business Strategy Consultation', 40, 50000, 2000000, 1),
  ('00000000-0000-0000-0000-000000001002', '00000000-0000-0000-0000-000000000101', 'Market Research Report', 1, 500000, 500000, 2),
  ('00000000-0000-0000-0000-000000001003', '00000000-0000-0000-0000-000000000102', 'Supply Chain Audit', 1, 600000, 600000, 1),
  ('00000000-0000-0000-0000-000000001004', '00000000-0000-0000-0000-000000000102', 'Process Optimization Plan', 1, 250000, 250000, 2),
  ('00000000-0000-0000-0000-000000001005', '00000000-0000-0000-0000-000000000103', 'Fleet Analysis', 1, 750000, 750000, 1),
  ('00000000-0000-0000-0000-000000001006', '00000000-0000-0000-0000-000000000103', 'Route Optimization', 1, 450000, 450000, 2),
  ('00000000-0000-0000-0000-000000001007', '00000000-0000-0000-0000-000000000104', 'Infrastructure Assessment', 1, 3000000, 3000000, 1),
  ('00000000-0000-0000-0000-000000001008', '00000000-0000-0000-0000-000000000104', 'Regulatory Compliance Review', 1, 2000000, 2000000, 2),
  ('00000000-0000-0000-0000-000000001009', '00000000-0000-0000-0000-000000000105', 'Logo Design', 1, 200000, 200000, 1),
  ('00000000-0000-0000-0000-000000001010', '00000000-0000-0000-0000-000000000105', 'Brand Guidelines', 1, 200000, 200000, 2),
  ('00000000-0000-0000-0000-000000001011', '00000000-0000-0000-0000-000000000106', 'Digital Audit', 1, 800000, 800000, 1),
  ('00000000-0000-0000-0000-000000001012', '00000000-0000-0000-0000-000000000106', 'Tech Stack Recommendation', 1, 500000, 500000, 2),
  ('00000000-0000-0000-0000-000000001013', '00000000-0000-0000-0000-000000000106', 'Implementation Roadmap', 1, 500000, 500000, 3)
ON CONFLICT (id) DO NOTHING;

-- Transactions
INSERT INTO transactions (id, invoice_id, merchant_id, amount_paid, k_factor, tax_collected, discount_applied, paystack_fee, fee_absorbed_by, paystack_reference, payment_method, status) VALUES
  ('00000000-0000-0000-0000-000000002001', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 500000, 0.195822, 34884.26, 24478.02, 2000, 'business', 'PSK_ref_001abc', 'card', 'success'),
  ('00000000-0000-0000-0000-000000002002', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 500000, 0.195822, 34884.26, 24478.02, 2000, 'business', 'PSK_ref_002def', 'bank_transfer', 'success'),
  ('00000000-0000-0000-0000-000000002003', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000001', 600000, 0.516795, 41860.40, 62015.40, 2000, 'business', 'PSK_ref_003ghi', 'card', 'success'),
  ('00000000-0000-0000-0000-000000002004', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000001', 561000, 0.483205, 39139.60, 57984.60, 2000, 'business', 'PSK_ref_004jkl', 'ussd', 'success'),
  ('00000000-0000-0000-0000-000000002005', '00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000001', 2000000, 0.372093, 139534.88, 0, 2000, 'business', 'PSK_ref_005mno', 'bank_transfer', 'success'),
  ('00000000-0000-0000-0000-000000002006', '00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000001', 415000, 0.965116, 28953.49, 0, 2000, 'business', 'PSK_ref_006pqr', 'card', 'success')
ON CONFLICT (id) DO NOTHING;
