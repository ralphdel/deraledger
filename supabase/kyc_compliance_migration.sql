-- ============================================================
-- DeraLedger KYC Compliance Infrastructure Migration
-- Phases: provider registry, audit logs, retry queue,
--         rate limits, health events, director verifications
-- ============================================================

-- 1. verification_providers table
CREATE TABLE IF NOT EXISTS verification_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'DEGRADED', 'DOWN', 'DISABLED')),
  priority INTEGER NOT NULL DEFAULT 10,
  api_base_url TEXT,
  bvn_selfie_cost NUMERIC(10,2) NOT NULL DEFAULT 150,
  business_cost NUMERIC(10,2) NOT NULL DEFAULT 150,
  director_cost NUMERIC(10,2) NOT NULL DEFAULT 150,
  supports_bvn BOOLEAN NOT NULL DEFAULT true,
  supports_selfie BOOLEAN NOT NULL DEFAULT true,
  supports_liveness BOOLEAN NOT NULL DEFAULT false,
  supports_business_verification BOOLEAN NOT NULL DEFAULT true,
  health_check_failures INTEGER NOT NULL DEFAULT 0,
  last_health_check_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO verification_providers (provider_name, status, priority, api_base_url, supports_bvn, supports_selfie, supports_liveness, supports_business_verification)
VALUES
  ('DOJAH', 'ACTIVE', 1, 'https://sandbox.dojah.io', true, true, false, true),
  ('YOUVERIFY', 'ACTIVE', 2, 'https://api.sandbox.youverify.co', true, true, false, true),
  ('SMILEID', 'DISABLED', 3, null, true, true, true, false)
ON CONFLICT (provider_name) DO NOTHING;

ALTER TABLE verification_providers ADD COLUMN IF NOT EXISTS bvn_selfie_cost NUMERIC(10,2) NOT NULL DEFAULT 150;
ALTER TABLE verification_providers ADD COLUMN IF NOT EXISTS business_cost NUMERIC(10,2) NOT NULL DEFAULT 150;
ALTER TABLE verification_providers ADD COLUMN IF NOT EXISTS director_cost NUMERIC(10,2) NOT NULL DEFAULT 150;

-- 2. Rename verification_records to verification_logs if old table exists
-- (idempotent: only runs if old table exists and new does not)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'verification_records')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'verification_logs') THEN
    ALTER TABLE verification_records RENAME TO verification_logs;
  END IF;
END
$$;

-- 3. Create verification_logs if it doesn't exist yet (fresh install)
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

-- Add new columns to verification_logs if upgrading from verification_records
ALTER TABLE verification_logs ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;
ALTER TABLE verification_logs ADD COLUMN IF NOT EXISTS masked_bvn TEXT;
ALTER TABLE verification_logs ADD COLUMN IF NOT EXISTS response_status TEXT;
ALTER TABLE verification_logs ADD COLUMN IF NOT EXISTS normalized_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE verification_logs ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE verification_logs ADD COLUMN IF NOT EXISTS verification_cost NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE verification_logs ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE verification_logs ADD COLUMN IF NOT EXISTS request_timestamp TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE verification_logs ADD COLUMN IF NOT EXISTS response_timestamp TIMESTAMPTZ;
ALTER TABLE verification_logs ADD COLUMN IF NOT EXISTS verification_id TEXT;
ALTER TABLE verification_logs ADD COLUMN IF NOT EXISTS error_code TEXT;
ALTER TABLE verification_logs ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE verification_logs ADD COLUMN IF NOT EXISTS match_score NUMERIC(5,2);
ALTER TABLE verification_logs ADD COLUMN IF NOT EXISTS provider_reference TEXT;
ALTER TABLE verification_logs ADD COLUMN IF NOT EXISTS raw_response JSONB DEFAULT '{}';
ALTER TABLE verification_logs ADD COLUMN IF NOT EXISTS attempt_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE verification_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Replace legacy verification_type constraint carried over from verification_records
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'verification_records_verification_type_check'
  ) THEN
    ALTER TABLE verification_logs DROP CONSTRAINT verification_records_verification_type_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'verification_logs_verification_type_check'
  ) THEN
    ALTER TABLE verification_logs DROP CONSTRAINT verification_logs_verification_type_check;
  END IF;

  ALTER TABLE verification_logs
    ADD CONSTRAINT verification_logs_verification_type_check
    CHECK (verification_type IN ('bvn_selfie', 'business', 'director', 'identity'));
END
$$;

-- Migrate existing verification_type values (identity -> bvn_selfie for logs)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='verification_logs' AND column_name='verification_type') THEN
    UPDATE verification_logs
    SET verification_type = 'bvn_selfie'
    WHERE verification_type = 'identity';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='verification_logs' AND column_name='status') THEN
    UPDATE verification_logs SET normalized_status = CASE WHEN status = 'verified' THEN 'verified' WHEN status = 'failed' THEN 'failed' ELSE 'pending' END
    WHERE normalized_status = 'pending' AND status IS NOT NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_verification_logs_merchant ON verification_logs(merchant_id);
CREATE INDEX IF NOT EXISTS idx_verification_logs_fingerprint ON verification_logs(request_fingerprint);
CREATE INDEX IF NOT EXISTS idx_verification_logs_created ON verification_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verification_logs_status ON verification_logs(normalized_status);

-- 4. verification_retry_queue
CREATE TABLE IF NOT EXISTS verification_retry_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_log_id UUID REFERENCES verification_logs(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL,
  retry_attempt INTEGER NOT NULL DEFAULT 1,
  next_retry_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'abandoned')),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retry_queue_next ON verification_retry_queue(next_retry_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_retry_queue_status ON verification_retry_queue(status);

-- 5. verification_rate_limits
CREATE TABLE IF NOT EXISTS verification_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  window_type TEXT NOT NULL CHECK (window_type IN ('hourly', 'daily')),
  window_start TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, window_type, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_merchant ON verification_rate_limits(merchant_id, window_type, window_start);

-- 6. provider_health_events (append-only)
CREATE TABLE IF NOT EXISTS provider_health_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name TEXT NOT NULL,
  status TEXT NOT NULL,
  response_time_ms INTEGER,
  error_message TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_health_events_provider ON provider_health_events(provider_name, checked_at DESC);

-- 7. business_director_verifications
CREATE TABLE IF NOT EXISTS business_director_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  business_verification_id UUID REFERENCES verification_logs(id) ON DELETE SET NULL,
  director_name TEXT NOT NULL,
  director_role TEXT NOT NULL DEFAULT 'director'
    CHECK (director_role IN ('director', 'shareholder', 'beneficial_owner', 'signatory', 'proprietor', 'partner', 'trustee')),
  masked_bvn TEXT,
  nin TEXT,
  provider_name TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'failed', 'manual_review')),
  selfie_url TEXT,
  face_match_score NUMERIC(5,2),
  liveness_score NUMERIC(5,2),
  verification_id TEXT,
  normalized_response JSONB DEFAULT '{}',
  retry_count INTEGER NOT NULL DEFAULT 0,
  verification_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  manual_review_required BOOLEAN NOT NULL DEFAULT false,
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_director_verif_merchant ON business_director_verifications(merchant_id);
CREATE INDEX IF NOT EXISTS idx_director_verif_biz ON business_director_verifications(business_verification_id);

-- 8. Comments
COMMENT ON TABLE verification_providers IS 'KYC provider registry with health status and routing priority.';
COMMENT ON TABLE verification_logs IS 'Full audit log of every verification attempt. Replaces verification_records.';
COMMENT ON TABLE verification_retry_queue IS 'Exponential backoff retry queue for failed provider calls.';
COMMENT ON TABLE verification_rate_limits IS 'Per-merchant rate limiting windows (hourly/daily).';
COMMENT ON TABLE provider_health_events IS 'Append-only health check event log per provider.';
COMMENT ON TABLE business_director_verifications IS 'Individual director/shareholder identity verification for KYB.';
