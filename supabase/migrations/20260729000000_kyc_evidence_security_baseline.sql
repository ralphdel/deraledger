-- ============================================================
-- Canonical KYC evidence substrate and security baseline
--
-- Source ownership:
--   - fresh-install DDL extracted from kyc_compliance_migration.sql
--   - verification subject/linkage extracted from
--     verification_subject_migration.sql
--
-- Deliberately excluded:
--   - provider rows, URLs, credentials, or environment configuration
--   - verification_records rename/repair branches
--   - row backfills and legacy value rewrites
--   - storage bucket or storage.objects policy changes
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  v_relation text;
  v_role text;
  v_policy record;
  v_constraint_count integer;
  v_allowed_values text[];
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'public.merchants',
    'public.merchant_team',
    'public.verification_logs',
    'public.user_kyc_profiles',
    'public.business_registry_snapshots',
    'public.business_affiliations',
    'public.director_invitations',
    'public.director_verifications',
    'public.verification_costs'
  ]
  LOOP
    IF to_regclass(v_relation) IS NULL THEN
      RAISE EXCEPTION 'KYC evidence prerequisite missing: %', v_relation;
    END IF;
  END LOOP;

  IF to_regprocedure('public.can_read_merchant_row_v1(uuid)') IS NULL THEN
    RAISE EXCEPTION 'KYC evidence prerequisite missing: public.can_read_merchant_row_v1(uuid)';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      RAISE EXCEPTION 'KYC evidence prerequisite role missing: %', v_role;
    END IF;
  END LOOP;

  WITH verification_type_constraints AS (
    SELECT
      constraint_row.oid,
      pg_get_expr(constraint_row.conbin, constraint_row.conrelid, true) AS expression
    FROM pg_constraint constraint_row
    JOIN pg_attribute attribute
      ON attribute.attrelid = constraint_row.conrelid
     AND attribute.attname = 'verification_type'
     AND attribute.attnum = ANY (constraint_row.conkey)
    WHERE constraint_row.conrelid = 'public.verification_logs'::regclass
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
  ), literal_values AS (
    SELECT DISTINCT match_value[1] AS value
    FROM verification_type_constraints
    CROSS JOIN LATERAL regexp_matches(expression, '''([^'']+)''', 'g') AS match_value
  )
  SELECT
    (SELECT count(*) FROM verification_type_constraints),
    COALESCE(array_agg(value ORDER BY value), ARRAY[]::text[])
  INTO v_constraint_count, v_allowed_values
  FROM literal_values;

  IF v_constraint_count <> 1
     OR v_allowed_values <> ARRAY[
       'business',
       'business_registry',
       'bvn_selfie',
       'director',
       'director_bvn_selfie',
       'identity',
       'individual_bvn_selfie',
       'representative_bvn_selfie'
     ]::text[] THEN
    RAISE EXCEPTION
      'KYC evidence compatibility failure: verification_logs.verification_type contract is not canonical';
  END IF;

  FOR v_policy IN
    SELECT
      namespace_row.nspname::text AS schema_name,
      relation_row.relname::text AS table_name,
      policy_row.polname::text AS policy_name
    FROM pg_policy policy_row
    JOIN pg_class relation_row ON relation_row.oid = policy_row.polrelid
    JOIN pg_namespace namespace_row ON namespace_row.oid = relation_row.relnamespace
    WHERE namespace_row.nspname = 'public'
      AND relation_row.relname = ANY (ARRAY[
        'verification_providers',
        'verification_logs',
        'verification_retry_queue',
        'verification_rate_limits',
        'provider_health_events',
        'business_director_verifications',
        'user_kyc_profiles',
        'business_registry_snapshots',
        'business_affiliations',
        'director_invitations',
        'director_verifications',
        'verification_costs'
      ]::text[])
      AND policy_row.polname NOT IN (
        'kyc_authenticated_read_verification_logs',
        'kyc_authenticated_read_business_directors'
      )
  LOOP
    RAISE EXCEPTION
      'KYC evidence security drift: unexpected policy %.%.%',
      v_policy.schema_name,
      v_policy.table_name,
      v_policy.policy_name;
  END LOOP;
END;
$$;

CREATE TABLE IF NOT EXISTS public.verification_providers (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  provider_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  priority INTEGER NOT NULL DEFAULT 10,
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT verification_providers_pkey PRIMARY KEY (id),
  CONSTRAINT verification_providers_provider_name_key UNIQUE (provider_name),
  CONSTRAINT verification_providers_status_check
    CHECK (status IN ('ACTIVE', 'DEGRADED', 'DOWN', 'DISABLED'))
);

CREATE TABLE IF NOT EXISTS public.verification_retry_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  verification_log_id UUID REFERENCES public.verification_logs(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL,
  retry_attempt INTEGER NOT NULL DEFAULT 1,
  next_retry_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT verification_retry_queue_pkey PRIMARY KEY (id),
  CONSTRAINT verification_retry_queue_status_check
    CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'abandoned'))
);

CREATE INDEX IF NOT EXISTS idx_retry_queue_next
  ON public.verification_retry_queue(next_retry_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_retry_queue_status
  ON public.verification_retry_queue(status);

CREATE TABLE IF NOT EXISTS public.verification_rate_limits (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  window_type TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT verification_rate_limits_pkey PRIMARY KEY (id),
  CONSTRAINT verification_rate_limits_window_type_check
    CHECK (window_type IN ('hourly', 'daily')),
  CONSTRAINT verification_rate_limits_merchant_window_key
    UNIQUE (merchant_id, window_type, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_merchant
  ON public.verification_rate_limits(merchant_id, window_type, window_start);

CREATE TABLE IF NOT EXISTS public.provider_health_events (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  provider_name TEXT NOT NULL,
  status TEXT NOT NULL,
  response_time_ms INTEGER,
  error_message TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT provider_health_events_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_health_events_provider
  ON public.provider_health_events(provider_name, checked_at DESC);

CREATE TABLE IF NOT EXISTS public.business_director_verifications (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  business_verification_id UUID REFERENCES public.verification_logs(id) ON DELETE SET NULL,
  invitation_id UUID REFERENCES public.director_invitations(id) ON DELETE SET NULL,
  director_name TEXT NOT NULL,
  director_role TEXT NOT NULL DEFAULT 'director',
  masked_bvn TEXT,
  nin TEXT,
  provider_name TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending',
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT business_director_verifications_pkey PRIMARY KEY (id),
  CONSTRAINT business_director_verifications_role_check
    CHECK (director_role IN (
      'director',
      'shareholder',
      'beneficial_owner',
      'signatory',
      'proprietor',
      'partner',
      'trustee'
    )),
  CONSTRAINT business_director_verifications_status_check
    CHECK (verification_status IN ('pending', 'verified', 'failed', 'manual_review'))
);

CREATE INDEX IF NOT EXISTS idx_director_verif_merchant
  ON public.business_director_verifications(merchant_id);
CREATE INDEX IF NOT EXISTS idx_director_verif_biz
  ON public.business_director_verifications(business_verification_id);
CREATE INDEX IF NOT EXISTS idx_director_verif_invitation
  ON public.business_director_verifications(invitation_id);

DO $$
DECLARE
  v_column record;
  v_actual_type oid;
  v_relation regclass;
BEGIN
  FOR v_column IN
    SELECT *
    FROM (VALUES
      ('verification_providers', 'id', 'uuid'::regtype),
      ('verification_providers', 'provider_name', 'text'::regtype),
      ('verification_providers', 'status', 'text'::regtype),
      ('verification_providers', 'priority', 'integer'::regtype),
      ('verification_providers', 'bvn_selfie_cost', 'numeric'::regtype),
      ('verification_providers', 'business_cost', 'numeric'::regtype),
      ('verification_providers', 'director_cost', 'numeric'::regtype),
      ('verification_retry_queue', 'id', 'uuid'::regtype),
      ('verification_retry_queue', 'verification_log_id', 'uuid'::regtype),
      ('verification_retry_queue', 'provider_name', 'text'::regtype),
      ('verification_retry_queue', 'retry_attempt', 'integer'::regtype),
      ('verification_retry_queue', 'next_retry_at', 'timestamptz'::regtype),
      ('verification_retry_queue', 'status', 'text'::regtype),
      ('verification_retry_queue', 'last_error', 'text'::regtype),
      ('verification_rate_limits', 'id', 'uuid'::regtype),
      ('verification_rate_limits', 'merchant_id', 'uuid'::regtype),
      ('verification_rate_limits', 'window_type', 'text'::regtype),
      ('verification_rate_limits', 'window_start', 'timestamptz'::regtype),
      ('verification_rate_limits', 'attempt_count', 'integer'::regtype),
      ('provider_health_events', 'id', 'uuid'::regtype),
      ('provider_health_events', 'provider_name', 'text'::regtype),
      ('provider_health_events', 'status', 'text'::regtype),
      ('provider_health_events', 'response_time_ms', 'integer'::regtype),
      ('provider_health_events', 'error_message', 'text'::regtype),
      ('provider_health_events', 'checked_at', 'timestamptz'::regtype),
      ('business_director_verifications', 'id', 'uuid'::regtype),
      ('business_director_verifications', 'merchant_id', 'uuid'::regtype),
      ('business_director_verifications', 'business_verification_id', 'uuid'::regtype),
      ('business_director_verifications', 'invitation_id', 'uuid'::regtype),
      ('business_director_verifications', 'director_name', 'text'::regtype),
      ('business_director_verifications', 'director_role', 'text'::regtype),
      ('business_director_verifications', 'verification_status', 'text'::regtype),
      ('business_director_verifications', 'normalized_response', 'jsonb'::regtype),
      ('business_director_verifications', 'manual_review_required', 'boolean'::regtype),
      ('business_director_verifications', 'created_at', 'timestamptz'::regtype),
      ('business_director_verifications', 'updated_at', 'timestamptz'::regtype)
    ) AS expected(table_name, column_name, expected_type)
  LOOP
    v_relation := to_regclass(format('public.%I', v_column.table_name));
    SELECT attribute.atttypid
    INTO v_actual_type
    FROM pg_attribute attribute
    WHERE attribute.attrelid = v_relation
      AND attribute.attname = v_column.column_name
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped;

    IF v_relation IS NULL
       OR v_actual_type IS NULL
       OR v_actual_type <> v_column.expected_type::oid THEN
      RAISE EXCEPTION
        'KYC evidence compatibility failure: public.%.% expected type %',
        v_column.table_name,
        v_column.column_name,
        v_column.expected_type::text;
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.verification_logs
  ADD COLUMN IF NOT EXISTS verification_subject TEXT,
  ADD COLUMN IF NOT EXISTS invitation_id UUID REFERENCES public.director_invitations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS business_affiliation_id UUID REFERENCES public.business_affiliations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_director_name TEXT,
  ADD COLUMN IF NOT EXISTS returned_bvn_name TEXT,
  ADD COLUMN IF NOT EXISTS name_match_status TEXT;

DO $$
DECLARE
  v_column record;
  v_expected_type regtype;
  v_actual_type oid;
  v_subject_values text[];
BEGIN
  FOR v_column IN
    SELECT *
    FROM (VALUES
      ('verification_subject', 'text'::regtype),
      ('invitation_id', 'uuid'::regtype),
      ('business_affiliation_id', 'uuid'::regtype),
      ('invited_director_name', 'text'::regtype),
      ('returned_bvn_name', 'text'::regtype),
      ('name_match_status', 'text'::regtype)
    ) AS expected(column_name, expected_type)
  LOOP
    SELECT attribute.atttypid
    INTO v_actual_type
    FROM pg_attribute attribute
    WHERE attribute.attrelid = 'public.verification_logs'::regclass
      AND attribute.attname = v_column.column_name
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped;

    v_expected_type := v_column.expected_type;
    IF v_actual_type IS NULL OR v_actual_type <> v_expected_type::oid THEN
      RAISE EXCEPTION
        'KYC evidence compatibility failure: verification_logs.% expected type %',
        v_column.column_name,
        v_expected_type::text;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'public.verification_logs'::regclass
      AND constraint_row.conname = 'verification_logs_verification_subject_check'
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
  ) THEN
    ALTER TABLE public.verification_logs
      ADD CONSTRAINT verification_logs_verification_subject_check
      CHECK (verification_subject IS NULL OR verification_subject IN ('representative', 'business', 'director'));
  END IF;

  SELECT COALESCE(array_agg(value ORDER BY value), ARRAY[]::text[])
  INTO v_subject_values
  FROM (
    SELECT DISTINCT match_value[1] AS value
    FROM pg_constraint constraint_row
    CROSS JOIN LATERAL regexp_matches(
      pg_get_expr(constraint_row.conbin, constraint_row.conrelid, true),
      '''([^'']+)''',
      'g'
    ) AS match_value
    WHERE constraint_row.conrelid = 'public.verification_logs'::regclass
      AND constraint_row.conname = 'verification_logs_verification_subject_check'
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
  ) AS subject_literals;

  IF v_subject_values <> ARRAY['business', 'director', 'representative']::text[] THEN
    RAISE EXCEPTION
      'KYC evidence compatibility failure: verification_logs.verification_subject contract is not canonical';
  END IF;
END;
$$;

COMMENT ON TABLE public.verification_providers IS
  'Service-managed KYC provider registry. Environment-specific rows and URLs are configured separately.';
COMMENT ON TABLE public.verification_retry_queue IS
  'Service-managed retry queue for failed verification provider calls.';
COMMENT ON TABLE public.verification_rate_limits IS
  'Service-managed per-merchant verification rate-limit windows.';
COMMENT ON TABLE public.provider_health_events IS
  'Append-only service-managed provider health evidence.';
COMMENT ON TABLE public.business_director_verifications IS
  'Sensitive director/shareholder identity-verification evidence.';

ALTER TABLE public.verification_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_providers NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.verification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_logs NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.verification_retry_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_retry_queue NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.verification_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_rate_limits NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.provider_health_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_health_events NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.business_director_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_director_verifications NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_kyc_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_kyc_profiles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.business_registry_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_registry_snapshots NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.business_affiliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_affiliations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.director_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.director_invitations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.director_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.director_verifications NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.verification_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_costs NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.verification_providers,
  public.verification_logs,
  public.verification_retry_queue,
  public.verification_rate_limits,
  public.provider_health_events,
  public.business_director_verifications,
  public.user_kyc_profiles,
  public.business_registry_snapshots,
  public.business_affiliations,
  public.director_invitations,
  public.director_verifications,
  public.verification_costs
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, UPDATE ON TABLE public.verification_providers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.verification_logs TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.verification_retry_queue TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.verification_rate_limits TO service_role;
GRANT SELECT, INSERT ON TABLE public.provider_health_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_director_verifications TO service_role;
GRANT DELETE ON TABLE public.user_kyc_profiles TO service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.business_registry_snapshots TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_affiliations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.director_invitations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.director_verifications TO service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.verification_costs TO service_role;

GRANT SELECT (
  merchant_id,
  verification_type,
  returned_bvn_name,
  name_match_status,
  created_at
) ON TABLE public.verification_logs TO authenticated;

GRANT SELECT (
  id,
  merchant_id,
  director_name,
  director_role,
  verification_status,
  created_at
) ON TABLE public.business_director_verifications TO authenticated;

DROP POLICY IF EXISTS kyc_authenticated_read_verification_logs
  ON public.verification_logs;
CREATE POLICY kyc_authenticated_read_verification_logs
  ON public.verification_logs
  FOR SELECT
  TO authenticated
  USING (public.can_read_merchant_row_v1(merchant_id));

DROP POLICY IF EXISTS kyc_authenticated_read_business_directors
  ON public.business_director_verifications;
CREATE POLICY kyc_authenticated_read_business_directors
  ON public.business_director_verifications
  FOR SELECT
  TO authenticated
  USING (public.can_read_merchant_row_v1(merchant_id));

DO $$
DECLARE
  v_relation text;
  v_security record;
  v_grant record;
  v_actual_privileges text[];
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'verification_providers',
    'verification_logs',
    'verification_retry_queue',
    'verification_rate_limits',
    'provider_health_events',
    'business_director_verifications',
    'user_kyc_profiles',
    'business_registry_snapshots',
    'business_affiliations',
    'director_invitations',
    'director_verifications',
    'verification_costs'
  ]
  LOOP
    SELECT relation_row.relrowsecurity, relation_row.relforcerowsecurity
    INTO v_security
    FROM pg_class relation_row
    WHERE relation_row.oid = to_regclass(format('public.%I', v_relation));

    IF v_security.relrowsecurity IS DISTINCT FROM true
       OR v_security.relforcerowsecurity IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'KYC evidence security assertion failed for public.%', v_relation;
    END IF;

  END LOOP;

  FOREACH v_relation IN ARRAY ARRAY[
    'verification_providers',
    'verification_retry_queue',
    'verification_rate_limits',
    'provider_health_events',
    'business_director_verifications'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint constraint_row
      JOIN pg_attribute attribute
        ON attribute.attrelid = constraint_row.conrelid
       AND attribute.attname = 'id'
       AND constraint_row.conkey = ARRAY[attribute.attnum]::smallint[]
      WHERE constraint_row.conrelid = format('public.%I', v_relation)::regclass
        AND constraint_row.contype = 'p'
    ) THEN
      RAISE EXCEPTION 'KYC evidence compatibility failure: public.% id primary key mismatch', v_relation;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM information_schema.table_privileges privilege_row
    WHERE privilege_row.table_schema = 'public'
      AND privilege_row.table_name = ANY (ARRAY[
        'verification_providers',
        'verification_logs',
        'verification_retry_queue',
        'verification_rate_limits',
        'provider_health_events',
        'business_director_verifications',
        'user_kyc_profiles',
        'business_registry_snapshots',
        'business_affiliations',
        'director_invitations',
        'director_verifications',
        'verification_costs'
      ]::text[])
      AND privilege_row.grantee IN ('PUBLIC', 'anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'KYC evidence security assertion failed: broad browser table privilege remains';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.column_privileges privilege_row
    WHERE privilege_row.table_schema = 'public'
      AND privilege_row.table_name = ANY (ARRAY[
        'verification_providers',
        'verification_logs',
        'verification_retry_queue',
        'verification_rate_limits',
        'provider_health_events',
        'business_director_verifications',
        'user_kyc_profiles',
        'business_registry_snapshots',
        'business_affiliations',
        'director_invitations',
        'director_verifications',
        'verification_costs'
      ]::text[])
      AND (
        privilege_row.grantee IN ('PUBLIC', 'anon')
        OR (
          privilege_row.grantee = 'authenticated'
          AND NOT (
            privilege_row.privilege_type = 'SELECT'
            AND (
              (
                privilege_row.table_name = 'verification_logs'
                AND privilege_row.column_name = ANY (ARRAY[
                  'merchant_id',
                  'verification_type',
                  'returned_bvn_name',
                  'name_match_status',
                  'created_at'
                ]::text[])
              )
              OR (
                privilege_row.table_name = 'business_director_verifications'
                AND privilege_row.column_name = ANY (ARRAY[
                  'id',
                  'merchant_id',
                  'director_name',
                  'director_role',
                  'verification_status',
                  'created_at'
                ]::text[])
              )
            )
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'KYC evidence security assertion failed: unsafe browser column privilege remains';
  END IF;

  FOR v_grant IN
    SELECT *
    FROM (VALUES
      ('verification_providers', ARRAY['SELECT', 'UPDATE']::text[]),
      ('verification_logs', ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[]),
      ('verification_retry_queue', ARRAY['INSERT', 'SELECT', 'UPDATE']::text[]),
      ('verification_rate_limits', ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[]),
      ('provider_health_events', ARRAY['INSERT', 'SELECT']::text[]),
      ('business_director_verifications', ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[]),
      ('user_kyc_profiles', ARRAY['DELETE']::text[]),
      ('business_registry_snapshots', ARRAY['DELETE', 'INSERT', 'SELECT']::text[]),
      ('business_affiliations', ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[]),
      ('director_invitations', ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[]),
      ('director_verifications', ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[]),
      ('verification_costs', ARRAY['DELETE', 'INSERT', 'SELECT']::text[])
    ) AS expected(table_name, privileges)
  LOOP
    SELECT COALESCE(array_agg(privilege_row.privilege_type ORDER BY privilege_row.privilege_type), ARRAY[]::text[])
    INTO v_actual_privileges
    FROM information_schema.table_privileges privilege_row
    WHERE privilege_row.table_schema = 'public'
      AND privilege_row.table_name = v_grant.table_name
      AND privilege_row.grantee = 'service_role';

    IF v_actual_privileges <> v_grant.privileges THEN
      RAISE EXCEPTION
        'KYC evidence security assertion failed: service_role grant mismatch on public.%',
        v_grant.table_name;
    END IF;
  END LOOP;

  SELECT COALESCE(array_agg(privilege_row.column_name ORDER BY privilege_row.column_name), ARRAY[]::text[])
  INTO v_actual_privileges
  FROM information_schema.column_privileges privilege_row
  WHERE privilege_row.table_schema = 'public'
    AND privilege_row.table_name = 'verification_logs'
    AND privilege_row.grantee = 'authenticated'
    AND privilege_row.privilege_type = 'SELECT';

  IF v_actual_privileges <> ARRAY[
    'created_at',
    'merchant_id',
    'name_match_status',
    'returned_bvn_name',
    'verification_type'
  ]::text[] THEN
    RAISE EXCEPTION
      'KYC evidence security assertion failed: authenticated verification_logs column grants mismatch';
  END IF;

  SELECT COALESCE(array_agg(privilege_row.column_name ORDER BY privilege_row.column_name), ARRAY[]::text[])
  INTO v_actual_privileges
  FROM information_schema.column_privileges privilege_row
  WHERE privilege_row.table_schema = 'public'
    AND privilege_row.table_name = 'business_director_verifications'
    AND privilege_row.grantee = 'authenticated'
    AND privilege_row.privilege_type = 'SELECT';

  IF v_actual_privileges <> ARRAY[
    'created_at',
    'director_name',
    'director_role',
    'id',
    'merchant_id',
    'verification_status'
  ]::text[] THEN
    RAISE EXCEPTION
      'KYC evidence security assertion failed: authenticated business_director_verifications column grants mismatch';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policy policy_row
    WHERE policy_row.polrelid IN (
      'public.verification_logs'::regclass,
      'public.business_director_verifications'::regclass
    )
      AND policy_row.polname IN (
        'kyc_authenticated_read_verification_logs',
        'kyc_authenticated_read_business_directors'
      )
      AND policy_row.polcmd = 'r'
      AND policy_row.polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]::oid[]
  ) <> 2 THEN
    RAISE EXCEPTION 'KYC evidence security assertion failed: authenticated read policies mismatch';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
