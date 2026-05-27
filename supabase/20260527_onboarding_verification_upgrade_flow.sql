-- ============================================================
-- DeraLedger Onboarding, Verification & Plan Upgrade Flow
-- PRD v1.0 additive migration
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO platform_settings (key, value) VALUES
  ('enable_verification_disclosure', 'true'),
  ('enable_setup_mode_feature_gating', 'true'),
  ('enable_business_registry_snapshot', 'true'),
  ('enable_business_affiliation_matching', 'true'),
  ('enable_director_invite_approval', 'false'),
  ('enable_new_upgrade_flow', 'true'),
  ('enable_verification_cost_monitoring', 'true'),
  ('verification_disclosure_version', '1.0')
ON CONFLICT (key) DO NOTHING;

-- Existing merchant rows remain the operational workspace until the full
-- multi-workspace model is rolled out. These columns make setup mode explicit.
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS workspace_id UUID,
  ADD COLUMN IF NOT EXISTS workspace_type TEXT DEFAULT 'business',
  ADD COLUMN IF NOT EXISTS onboarding_status TEXT DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS setup_mode BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS live_features_enabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS verification_disclosure_acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_disclosure_version TEXT,
  ADD COLUMN IF NOT EXISTS relationship_claim TEXT,
  ADD COLUMN IF NOT EXISTS business_registry_snapshot_id UUID,
  ADD COLUMN IF NOT EXISTS business_affiliation_status TEXT DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS paid_setup_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS live_features_activated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS onboarding_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  business_name TEXT NOT NULL,
  plan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_payment',
  paystack_ref TEXT,
  amount_paid NUMERIC(12,2),
  merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
  idempotency_key TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE onboarding_sessions
  ADD COLUMN IF NOT EXISTS business_type TEXT,
  ADD COLUMN IF NOT EXISTS relationship_claim TEXT,
  ADD COLUMN IF NOT EXISTS verification_disclosure_acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_disclosure_version TEXT,
  ADD COLUMN IF NOT EXISTS disclosure_ip_address TEXT,
  ADD COLUMN IF NOT EXISTS disclosure_user_agent TEXT;

UPDATE merchants
SET
  live_features_enabled = CASE
    WHEN COALESCE(subscription_plan, merchant_tier, 'starter') = 'starter' THEN false
    WHEN verification_status = 'verified' THEN true
    ELSE false
  END,
  setup_mode = CASE
    WHEN COALESCE(subscription_plan, merchant_tier, 'starter') <> 'starter'
      AND verification_status <> 'verified' THEN true
    ELSE false
  END,
  onboarding_status = CASE
    WHEN COALESCE(subscription_plan, merchant_tier, 'starter') = 'starter' THEN 'active'
    WHEN verification_status = 'verified' THEN 'active'
    WHEN verification_status = 'pending' THEN 'pending_manual_review'
    ELSE 'setup_mode'
  END
WHERE live_features_enabled IS NULL;

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  workspace_type TEXT NOT NULL DEFAULT 'business'
    CHECK (workspace_type IN ('personal', 'business')),
  display_name TEXT NOT NULL,
  plan_type TEXT NOT NULL DEFAULT 'starter'
    CHECK (plan_type IN ('starter', 'individual', 'corporate')),
  onboarding_status TEXT NOT NULL DEFAULT 'setup_mode'
    CHECK (onboarding_status IN ('setup_mode', 'pending_kyc', 'pending_kyb', 'pending_affiliation_match', 'pending_director_approval', 'pending_manual_review', 'active', 'rejected')),
  kyc_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (kyc_status IN ('not_started', 'pending', 'verified', 'failed', 'manual_review', 'expired')),
  kyb_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (kyb_status IN ('not_started', 'pending', 'verified', 'failed', 'manual_review')),
  affiliation_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (affiliation_status IN ('not_started', 'strong_match', 'partial_match', 'no_match', 'director_approved', 'rejected', 'manual_review')),
  setup_mode BOOLEAN NOT NULL DEFAULT true,
  live_features_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant_id)
);

CREATE TABLE IF NOT EXISTS workspace_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('starter', 'individual', 'corporate')),
  subscription_status TEXT NOT NULL DEFAULT 'paid_setup'
    CHECK (subscription_status IN ('paid_setup', 'active', 'paused', 'cancelled', 'downgrade_pending', 'refund_review_pending')),
  payment_reference TEXT,
  amount_paid NUMERIC(12,2) DEFAULT 0,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verification_disclosures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
  onboarding_session_id UUID,
  plan_type TEXT NOT NULL,
  disclosure_version TEXT NOT NULL DEFAULT '1.0',
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address TEXT,
  user_agent TEXT,
  device_metadata JSONB DEFAULT '{}',
  context TEXT NOT NULL DEFAULT 'onboarding'
    CHECK (context IN ('onboarding', 'upgrade', 'renewal')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_kyc_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'pending', 'verified', 'failed', 'manual_review', 'expired')),
  verified_full_name TEXT,
  bvn_masked TEXT,
  provider_name TEXT,
  provider_reference TEXT,
  last_verification_log_id UUID REFERENCES verification_logs(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_registry_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL,
  business_type TEXT,
  registered_name TEXT,
  registration_number TEXT NOT NULL,
  registration_status TEXT DEFAULT 'unknown',
  directors_json JSONB DEFAULT '[]',
  raw_response_encrypted JSONB DEFAULT '{}',
  normalized_response_json JSONB DEFAULT '{}',
  verification_reference TEXT,
  verification_log_id UUID REFERENCES verification_logs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_registry_snapshots_merchant
  ON business_registry_snapshots(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_registry_snapshots_registration
  ON business_registry_snapshots(registration_number);

CREATE TABLE IF NOT EXISTS business_affiliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  registry_snapshot_id UUID REFERENCES business_registry_snapshots(id) ON DELETE SET NULL,
  claimed_relationship_type TEXT NOT NULL DEFAULT 'owner_affiliated_claim'
    CHECK (claimed_relationship_type IN ('owner_affiliated_claim', 'representative_claim')),
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'strong_match', 'partial_match', 'no_match', 'director_approved', 'rejected', 'manual_review')),
  matched_registry_name TEXT,
  match_score NUMERIC(5,2),
  match_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS director_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  requester_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  registry_snapshot_id UUID REFERENCES business_registry_snapshots(id) ON DELETE SET NULL,
  selected_director_record_id TEXT,
  selected_director_name TEXT NOT NULL,
  director_email TEXT NOT NULL,
  director_phone TEXT,
  token_hash TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'opened', 'expired', 'verified', 'approved', 'rejected', 'cancelled')),
  expires_at TIMESTAMPTZ NOT NULL,
  decision_at TIMESTAMPTZ,
  decision_ip TEXT,
  decision_metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS director_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id UUID REFERENCES director_invitations(id) ON DELETE CASCADE,
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  registry_snapshot_id UUID REFERENCES business_registry_snapshots(id) ON DELETE SET NULL,
  provider_name TEXT,
  verification_log_id UUID REFERENCES verification_logs(id) ON DELETE SET NULL,
  director_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'failed', 'manual_review')),
  face_match_score NUMERIC(5,2),
  liveness_score NUMERIC(5,2),
  normalized_response_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verification_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_log_id UUID REFERENCES verification_logs(id) ON DELETE SET NULL,
  merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  provider_name TEXT NOT NULL,
  verification_type TEXT NOT NULL,
  status TEXT NOT NULL,
  cost_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'NGN',
  duplicate_prevented BOOLEAN NOT NULL DEFAULT false,
  is_sandbox BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verification_costs_merchant_created
  ON verification_costs(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verification_costs_provider_type
  ON verification_costs(provider_name, verification_type, created_at DESC);

COMMENT ON TABLE verification_disclosures IS 'Acknowledgement that paid setup grants dashboard access but live collection remains locked until verification.';
COMMENT ON TABLE business_registry_snapshots IS 'Saved RC/CAC/KYB provider output used as the business registry source of truth.';
COMMENT ON TABLE business_affiliations IS 'Relationship match between verified user identity and business registry records.';
COMMENT ON TABLE director_invitations IS 'Single-use director approval invitations for representatives and no-match owner claims.';
COMMENT ON TABLE verification_costs IS 'Cost ledger for all verification attempts, including failures and sandbox zero-cost attempts.';
