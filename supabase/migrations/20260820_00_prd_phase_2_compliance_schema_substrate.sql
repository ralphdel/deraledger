-- Migration 024: inert PRD Phase 2 compliance and collection-limit substrate.
--
-- This migration creates schema and security objects only. It creates no
-- profiles, reviews, events, limits, reservations, or usage rows; it defines
-- no transition functions; and it does not modify any existing business row.

BEGIN;

SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

DO $migration_024_prerequisites$
DECLARE
  v_relation text;
  v_role text;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'public.merchants',
    'public.invoices',
    'public.payment_records'
  ]
  LOOP
    IF to_regclass(v_relation) IS NULL THEN
      RAISE EXCEPTION 'Migration 024 prerequisite missing: %', v_relation;
    END IF;

    IF (SELECT relation.relkind::text FROM pg_class relation WHERE relation.oid = to_regclass(v_relation)) <> 'r' THEN
      RAISE EXCEPTION 'Migration 024 prerequisite incompatible: % is not an ordinary table', v_relation;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_attribute attribute
      WHERE attribute.attrelid = to_regclass(v_relation)
        AND attribute.attname = 'id'
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
        AND format_type(attribute.atttypid, attribute.atttypmod) = 'uuid'
        AND attribute.attnotnull
    ) THEN
      RAISE EXCEPTION 'Migration 024 prerequisite incompatible: %.id must be uuid NOT NULL', v_relation;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_index index_state
      JOIN LATERAL unnest(index_state.indkey) WITH ORDINALITY AS key_state(attnum, ordinality)
        ON key_state.ordinality = 1
      JOIN pg_attribute attribute
        ON attribute.attrelid = index_state.indrelid AND attribute.attnum = key_state.attnum
      WHERE index_state.indrelid = to_regclass(v_relation)
        AND index_state.indisunique
        AND index_state.indisvalid
        AND index_state.indisready
        AND index_state.indnkeyatts = 1
        AND index_state.indpred IS NULL
        AND index_state.indexprs IS NULL
        AND attribute.attname = 'id'
    ) THEN
      RAISE EXCEPTION 'Migration 024 prerequisite incompatible: %.id lacks a valid non-partial unique key', v_relation;
    END IF;
  END LOOP;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles role_state WHERE role_state.rolname = v_role) THEN
      RAISE EXCEPTION 'Migration 024 prerequisite missing: database role %', v_role;
    END IF;
  END LOOP;

  IF to_regprocedure('gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION 'Migration 024 prerequisite missing: gen_random_uuid()';
  END IF;
END;
$migration_024_prerequisites$;

CREATE TABLE IF NOT EXISTS public.merchant_compliance_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  plan_code text NOT NULL,
  business_type text,
  compliance_status text NOT NULL DEFAULT 'draft',
  activation_status text NOT NULL DEFAULT 'test_mode',
  risk_rating text,
  restriction_state text,
  restriction_reason_code text,
  restriction_notes text,
  restriction_effective_at timestamp with time zone,
  restriction_review_due_at timestamp with time zone,
  collection_limit_basis text,
  approved_monthly_volume numeric(18,2),
  cumulative_collection_cap numeric(18,2),
  cumulative_collection_used numeric(18,2),
  hidden_daily_velocity_limit numeric(18,2),
  single_transaction_limit numeric(18,2),
  outstanding_receivable_cap numeric(18,2),
  collection_limit_approved boolean NOT NULL DEFAULT false,
  limits_approved_at timestamp with time zone,
  limits_approved_by uuid,
  can_collect_payments boolean NOT NULL DEFAULT false,
  can_use_instant_sale boolean NOT NULL DEFAULT false,
  can_use_receivable_sale boolean NOT NULL DEFAULT false,
  can_use_storefront boolean NOT NULL DEFAULT false,
  can_activate_settlement boolean NOT NULL DEFAULT false,
  can_use_deposit_balance boolean NOT NULL DEFAULT false,
  policy_version text,
  decision_source_type text,
  decision_source_id uuid,
  decision_source_version bigint,
  last_reviewed_at timestamp with time zone,
  next_review_due_at timestamp with time zone,
  reviewed_by uuid,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT merchant_compliance_profiles_pkey PRIMARY KEY (id),
  CONSTRAINT uq_merchant_compliance_profiles_merchant_id UNIQUE (merchant_id),
  CONSTRAINT merchant_compliance_profiles_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_compliance_profiles_plan_code_check
    CHECK (plan_code IN ('starter', 'solo_lite', 'solo_plus', 'business')),
  CONSTRAINT merchant_compliance_profiles_business_type_check
    CHECK (business_type IS NULL OR business_type IN (
      'unregistered_individual', 'sole_proprietor', 'registered_business_name',
      'limited_liability_company', 'incorporated_trustee', 'other_entity'
    )),
  CONSTRAINT merchant_compliance_profiles_compliance_status_check
    CHECK (compliance_status IN (
      'draft', 'lite_pending', 'lite_verified', 'enhanced_pending',
      'enhanced_verified', 'business_pending', 'business_verified',
      'needs_attention', 'restricted', 'rejected'
    )),
  CONSTRAINT merchant_compliance_profiles_activation_status_check
    CHECK (activation_status IN (
      'test_mode', 'pre_approved', 'awaiting_review', 'approved',
      'needs_attention', 'restricted', 'suspended'
    )),
  CONSTRAINT merchant_compliance_profiles_risk_rating_check
    CHECK (risk_rating IS NULL OR risk_rating IN ('low', 'medium', 'high', 'restricted')),
  CONSTRAINT merchant_compliance_profiles_restriction_state_check
    CHECK (restriction_state IS NULL OR restriction_state IN ('active', 'restricted', 'suspended')),
  CONSTRAINT merchant_compliance_profiles_collection_limit_basis_check
    CHECK (collection_limit_basis IS NULL OR collection_limit_basis IN ('none', 'cumulative', 'monthly', 'approved_volume')),
  CONSTRAINT merchant_compliance_profiles_amounts_check
    CHECK (
      (approved_monthly_volume IS NULL OR approved_monthly_volume >= 0) AND
      (cumulative_collection_cap IS NULL OR cumulative_collection_cap >= 0) AND
      (cumulative_collection_used IS NULL OR cumulative_collection_used >= 0) AND
      (hidden_daily_velocity_limit IS NULL OR hidden_daily_velocity_limit > 0) AND
      (single_transaction_limit IS NULL OR single_transaction_limit > 0) AND
      (outstanding_receivable_cap IS NULL OR outstanding_receivable_cap >= 0)
    ),
  CONSTRAINT merchant_compliance_profiles_decision_source_check
    CHECK (
      (decision_source_type IS NULL AND decision_source_id IS NULL) OR
      (
        decision_source_type IN (
          'solo_lite_review', 'solo_plus_case', 'business_kyb_review',
          'restriction_review', 'system_reconciliation'
        ) AND decision_source_id IS NOT NULL
      )
    ),
  CONSTRAINT merchant_compliance_profiles_decision_source_version_check
    CHECK (decision_source_version IS NULL OR decision_source_version > 0),
  CONSTRAINT merchant_compliance_profiles_row_version_check CHECK (row_version > 0),
  CONSTRAINT merchant_compliance_profiles_limit_approval_check
    CHECK (
      NOT collection_limit_approved OR
      (
        collection_limit_basis IS NOT NULL AND
        collection_limit_basis <> 'none' AND
        limits_approved_at IS NOT NULL AND
        limits_approved_by IS NOT NULL
      )
    ),
  CONSTRAINT merchant_compliance_profiles_receivable_collection_check
    CHECK (NOT can_use_receivable_sale OR can_collect_payments),
  CONSTRAINT merchant_compliance_profiles_deposit_requires_receivable_check
    CHECK (NOT can_use_deposit_balance OR can_use_receivable_sale),
  CONSTRAINT merchant_compliance_profiles_plan_entitlement_check
    CHECK (
      plan_code NOT IN ('starter', 'solo_lite') OR
      (NOT can_use_receivable_sale AND NOT can_use_deposit_balance)
    )
);

CREATE INDEX IF NOT EXISTS idx_merchant_compliance_profiles_decision_state
  ON public.merchant_compliance_profiles
  (merchant_id, plan_code, compliance_status, activation_status, restriction_state);

CREATE TABLE IF NOT EXISTS public.merchant_compliance_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  review_type text NOT NULL,
  target_plan_code text NOT NULL,
  review_status text NOT NULL DEFAULT 'draft',
  evidence_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision_reason_code text,
  decision_notes text,
  policy_version text,
  submitted_at timestamp with time zone,
  reviewed_at timestamp with time zone,
  reviewed_by uuid,
  idempotency_key text NOT NULL,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT merchant_compliance_reviews_pkey PRIMARY KEY (id),
  CONSTRAINT uq_merchant_compliance_reviews_idempotency UNIQUE (merchant_id, idempotency_key),
  CONSTRAINT merchant_compliance_reviews_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_compliance_reviews_profile_id_fkey
    FOREIGN KEY (profile_id) REFERENCES public.merchant_compliance_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_compliance_reviews_type_plan_check
    CHECK (
      (review_type = 'solo_lite' AND target_plan_code = 'solo_lite') OR
      (review_type = 'business_kyb' AND target_plan_code = 'business')
    ),
  CONSTRAINT merchant_compliance_reviews_status_check
    CHECK (review_status IN ('draft', 'pending', 'approved', 'rejected', 'needs_attention', 'cancelled')),
  CONSTRAINT merchant_compliance_reviews_evidence_snapshot_check
    CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
  CONSTRAINT merchant_compliance_reviews_idempotency_key_check
    CHECK (length(btrim(idempotency_key)) > 0),
  CONSTRAINT merchant_compliance_reviews_row_version_check CHECK (row_version > 0)
);

CREATE INDEX IF NOT EXISTS idx_merchant_compliance_reviews_queue
  ON public.merchant_compliance_reviews (review_type, review_status, created_at);

CREATE TABLE IF NOT EXISTS public.merchant_compliance_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  event_type text NOT NULL,
  from_state jsonb NOT NULL,
  to_state jsonb NOT NULL,
  reason_code text,
  notes text,
  actor_type text NOT NULL,
  actor_id uuid,
  source_type text,
  source_id uuid,
  policy_version text,
  idempotency_key text NOT NULL,
  expected_row_version bigint,
  resulting_row_version bigint NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT merchant_compliance_events_pkey PRIMARY KEY (id),
  CONSTRAINT uq_merchant_compliance_events_idempotency UNIQUE (merchant_id, idempotency_key),
  CONSTRAINT merchant_compliance_events_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_compliance_events_profile_id_fkey
    FOREIGN KEY (profile_id) REFERENCES public.merchant_compliance_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_compliance_events_event_type_check CHECK (length(btrim(event_type)) > 0),
  CONSTRAINT merchant_compliance_events_actor_type_check
    CHECK (actor_type IN ('system', 'admin', 'merchant', 'reconciliation')),
  CONSTRAINT merchant_compliance_events_source_check
    CHECK (
      (source_type IS NULL AND source_id IS NULL) OR
      (
        source_type IN (
          'solo_lite_review', 'solo_plus_case', 'business_kyb_review',
          'restriction_review', 'system_reconciliation'
        ) AND source_id IS NOT NULL
      )
    ),
  CONSTRAINT merchant_compliance_events_idempotency_key_check
    CHECK (length(btrim(idempotency_key)) > 0),
  CONSTRAINT merchant_compliance_events_versions_check
    CHECK (
      (expected_row_version IS NULL OR expected_row_version > 0) AND
      resulting_row_version > 0
    ),
  CONSTRAINT merchant_compliance_events_state_check
    CHECK (jsonb_typeof(from_state) = 'object' AND jsonb_typeof(to_state) = 'object'),
  CONSTRAINT merchant_compliance_events_metadata_check CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_merchant_compliance_events_timeline
  ON public.merchant_compliance_events (merchant_id, created_at);

CREATE TABLE IF NOT EXISTS public.merchant_collection_limit_windows (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  window_type text NOT NULL,
  window_key text NOT NULL,
  window_start timestamp with time zone NOT NULL,
  window_end timestamp with time zone,
  policy_timezone text NOT NULL DEFAULT 'Africa/Lagos',
  limit_amount numeric(18,2) NOT NULL,
  committed_amount numeric(18,2) NOT NULL DEFAULT 0,
  reserved_amount numeric(18,2) NOT NULL DEFAULT 0,
  policy_version text NOT NULL,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT merchant_collection_limit_windows_pkey PRIMARY KEY (id),
  CONSTRAINT uq_merchant_collection_limit_windows_identity
    UNIQUE (merchant_id, window_type, window_key, policy_version),
  CONSTRAINT merchant_collection_limit_windows_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_collection_limit_windows_profile_id_fkey
    FOREIGN KEY (profile_id) REFERENCES public.merchant_compliance_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_collection_limit_windows_type_check
    CHECK (window_type IN ('cumulative', 'monthly', 'daily_velocity', 'outstanding_receivable')),
  CONSTRAINT merchant_collection_limit_windows_key_check CHECK (length(btrim(window_key)) > 0),
  CONSTRAINT merchant_collection_limit_windows_policy_version_check CHECK (length(btrim(policy_version)) > 0),
  CONSTRAINT merchant_collection_limit_windows_timezone_check CHECK (policy_timezone = 'Africa/Lagos'),
  CONSTRAINT merchant_collection_limit_windows_bounds_check
    CHECK (
      (window_type = 'cumulative' AND window_end IS NULL) OR
      (window_type <> 'cumulative' AND window_end IS NOT NULL AND window_end > window_start)
    ),
  CONSTRAINT merchant_collection_limit_windows_amounts_check
    CHECK (limit_amount > 0 AND committed_amount >= 0 AND reserved_amount >= 0),
  CONSTRAINT merchant_collection_limit_windows_row_version_check CHECK (row_version > 0)
);

CREATE INDEX IF NOT EXISTS idx_merchant_collection_limit_windows_active
  ON public.merchant_collection_limit_windows
  (merchant_id, window_type, window_start, window_end);

CREATE TABLE IF NOT EXISTS public.merchant_collection_limit_reservations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  invoice_id uuid,
  payment_record_id uuid,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  internal_reference text NOT NULL,
  idempotency_key text NOT NULL,
  amount numeric(18,2) NOT NULL,
  currency text NOT NULL DEFAULT 'NGN',
  status text NOT NULL DEFAULT 'reserved',
  reserved_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  committed_at timestamp with time zone,
  released_at timestamp with time zone,
  release_reason_code text,
  provider_reference text,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT merchant_collection_limit_reservations_pkey PRIMARY KEY (id),
  CONSTRAINT uq_merchant_collection_reservations_reference UNIQUE (merchant_id, internal_reference),
  CONSTRAINT uq_merchant_collection_reservations_idempotency UNIQUE (merchant_id, idempotency_key),
  CONSTRAINT merchant_collection_limit_reservations_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_collection_limit_reservations_profile_id_fkey
    FOREIGN KEY (profile_id) REFERENCES public.merchant_compliance_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_collection_limit_reservations_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_collection_limit_reservations_payment_record_id_fkey
    FOREIGN KEY (payment_record_id) REFERENCES public.payment_records(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_collection_limit_reservations_source_type_check
    CHECK (source_type IN ('invoice', 'storefront_order', 'receivable')),
  CONSTRAINT merchant_collection_limit_reservations_reference_check
    CHECK (length(btrim(internal_reference)) > 0 AND length(btrim(idempotency_key)) > 0),
  CONSTRAINT merchant_collection_limit_reservations_amount_check CHECK (amount > 0),
  CONSTRAINT merchant_collection_limit_reservations_currency_check CHECK (currency = 'NGN'),
  CONSTRAINT merchant_collection_limit_reservations_status_check
    CHECK (status IN ('reserved', 'committed', 'released', 'expired', 'reversed')),
  CONSTRAINT merchant_collection_limit_reservations_expiry_check CHECK (expires_at > reserved_at),
  CONSTRAINT merchant_collection_limit_reservations_row_version_check CHECK (row_version > 0)
);

CREATE INDEX IF NOT EXISTS idx_merchant_collection_reservations_expiry
  ON public.merchant_collection_limit_reservations (status, expires_at);

CREATE TABLE IF NOT EXISTS public.merchant_collection_limit_reservation_windows (
  reservation_id uuid NOT NULL,
  window_id uuid NOT NULL,
  amount numeric(18,2) NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT merchant_collection_limit_reservation_windows_pkey PRIMARY KEY (reservation_id, window_id),
  CONSTRAINT merchant_collection_res_windows_reservation_id_fkey
    FOREIGN KEY (reservation_id) REFERENCES public.merchant_collection_limit_reservations(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_collection_limit_reservation_windows_window_id_fkey
    FOREIGN KEY (window_id) REFERENCES public.merchant_collection_limit_windows(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_collection_limit_reservation_windows_amount_check CHECK (amount > 0)
);

CREATE TABLE IF NOT EXISTS public.merchant_collection_usage_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  window_id uuid NOT NULL,
  reservation_id uuid,
  payment_record_id uuid,
  event_type text NOT NULL,
  direction text NOT NULL,
  amount numeric(18,2) NOT NULL,
  currency text NOT NULL DEFAULT 'NGN',
  internal_reference text NOT NULL,
  provider_reference text,
  idempotency_key text NOT NULL,
  actor_type text NOT NULL,
  actor_id uuid,
  reason_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT merchant_collection_usage_events_pkey PRIMARY KEY (id),
  CONSTRAINT uq_merchant_collection_usage_events_idempotency
    UNIQUE (merchant_id, window_id, idempotency_key),
  CONSTRAINT merchant_collection_usage_events_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_collection_usage_events_profile_id_fkey
    FOREIGN KEY (profile_id) REFERENCES public.merchant_compliance_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_collection_usage_events_window_id_fkey
    FOREIGN KEY (window_id) REFERENCES public.merchant_collection_limit_windows(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_collection_usage_events_reservation_id_fkey
    FOREIGN KEY (reservation_id) REFERENCES public.merchant_collection_limit_reservations(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_collection_usage_events_payment_record_id_fkey
    FOREIGN KEY (payment_record_id) REFERENCES public.payment_records(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_collection_usage_events_event_type_check
    CHECK (event_type IN (
      'collection_committed', 'refund_adjustment', 'chargeback_adjustment',
      'reservation_released', 'manual_correction'
    )),
  CONSTRAINT merchant_collection_usage_events_direction_check CHECK (direction IN ('debit', 'credit')),
  CONSTRAINT merchant_collection_usage_events_amount_check CHECK (amount > 0),
  CONSTRAINT merchant_collection_usage_events_currency_check CHECK (currency = 'NGN'),
  CONSTRAINT merchant_collection_usage_events_reference_check
    CHECK (length(btrim(internal_reference)) > 0 AND length(btrim(idempotency_key)) > 0),
  CONSTRAINT merchant_collection_usage_events_actor_type_check
    CHECK (actor_type IN ('system', 'admin', 'reconciliation')),
  CONSTRAINT merchant_collection_usage_events_metadata_check CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_merchant_collection_usage_events_timeline
  ON public.merchant_collection_usage_events (merchant_id, created_at);

ALTER TABLE public.merchant_compliance_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_compliance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_compliance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_collection_limit_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_collection_limit_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_collection_limit_reservation_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_collection_usage_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.merchant_compliance_profiles FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.merchant_compliance_reviews FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.merchant_compliance_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.merchant_collection_limit_windows FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.merchant_collection_limit_reservations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.merchant_collection_limit_reservation_windows FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.merchant_collection_usage_events FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.merchant_compliance_profiles TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.merchant_compliance_reviews TO service_role;
GRANT SELECT, INSERT ON TABLE public.merchant_compliance_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.merchant_collection_limit_windows TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.merchant_collection_limit_reservations TO service_role;
GRANT SELECT, INSERT ON TABLE public.merchant_collection_limit_reservation_windows TO service_role;
GRANT SELECT, INSERT ON TABLE public.merchant_collection_usage_events TO service_role;

DO $migration_024_postconditions$
DECLARE
  v_table text;
  v_expected_columns integer;
  v_actual_columns integer;
  v_expected_service_privileges text[];
  v_actual_service_privileges text[];
BEGIN
  FOR v_table, v_expected_columns, v_expected_service_privileges IN
    SELECT * FROM (VALUES
      ('merchant_compliance_profiles', 38, ARRAY['INSERT', 'SELECT', 'UPDATE']::text[]),
      ('merchant_compliance_reviews', 17, ARRAY['INSERT', 'SELECT', 'UPDATE']::text[]),
      ('merchant_compliance_events', 18, ARRAY['INSERT', 'SELECT']::text[]),
      ('merchant_collection_limit_windows', 15, ARRAY['INSERT', 'SELECT', 'UPDATE']::text[]),
      ('merchant_collection_limit_reservations', 21, ARRAY['INSERT', 'SELECT', 'UPDATE']::text[]),
      ('merchant_collection_limit_reservation_windows', 4, ARRAY['INSERT', 'SELECT']::text[]),
      ('merchant_collection_usage_events', 18, ARRAY['INSERT', 'SELECT']::text[])
    ) AS expected(table_name, column_count, service_privileges)
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL OR
       (SELECT relation.relkind::text FROM pg_class relation WHERE relation.oid = to_regclass(format('public.%I', v_table))) <> 'r' THEN
      RAISE EXCEPTION 'Migration 024 postcondition failure: public.% is missing or not an ordinary table', v_table;
    END IF;

    SELECT count(*)
    INTO v_actual_columns
    FROM pg_attribute attribute
    WHERE attribute.attrelid = to_regclass(format('public.%I', v_table))
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped;

    IF v_actual_columns <> v_expected_columns THEN
      RAISE EXCEPTION 'Migration 024 postcondition failure: public.% expected % columns, actual %',
        v_table, v_expected_columns, v_actual_columns;
    END IF;

    IF NOT (SELECT relation.relrowsecurity FROM pg_class relation WHERE relation.oid = to_regclass(format('public.%I', v_table))) THEN
      RAISE EXCEPTION 'Migration 024 postcondition failure: RLS is disabled on public.%', v_table;
    END IF;

    IF (SELECT relation.relforcerowsecurity FROM pg_class relation WHERE relation.oid = to_regclass(format('public.%I', v_table))) THEN
      RAISE EXCEPTION 'Migration 024 postcondition failure: forced RLS is unexpected on public.%', v_table;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_policy policy_state
      WHERE policy_state.polrelid = to_regclass(format('public.%I', v_table))
    ) THEN
      RAISE EXCEPTION 'Migration 024 postcondition failure: public.% must have zero policies', v_table;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_trigger trigger_state
      WHERE trigger_state.tgrelid = to_regclass(format('public.%I', v_table))
        AND NOT trigger_state.tgisinternal
    ) THEN
      RAISE EXCEPTION 'Migration 024 postcondition failure: public.% must have zero non-internal triggers', v_table;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_attribute attribute
      WHERE attribute.attrelid = to_regclass(format('public.%I', v_table))
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
        AND attribute.attacl IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Migration 024 postcondition failure: public.% has direct column ACL entries', v_table;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.role_table_grants grant_state
      WHERE grant_state.table_schema = 'public'
        AND grant_state.table_name = v_table
        AND grant_state.grantee IN ('PUBLIC', 'anon', 'authenticated')
    ) THEN
      RAISE EXCEPTION 'Migration 024 postcondition failure: browser/public grant exists on public.%', v_table;
    END IF;

    SELECT COALESCE(array_agg(grant_state.privilege_type::text ORDER BY grant_state.privilege_type::text), ARRAY[]::text[])
    INTO v_actual_service_privileges
    FROM information_schema.role_table_grants grant_state
    WHERE grant_state.table_schema = 'public'
      AND grant_state.table_name = v_table
      AND grant_state.grantee = 'service_role';

    IF v_actual_service_privileges <> v_expected_service_privileges THEN
      RAISE EXCEPTION 'Migration 024 postcondition failure: public.% service_role grants expected %, actual %',
        v_table, v_expected_service_privileges, v_actual_service_privileges;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('merchant_compliance_profiles', 'uq_merchant_compliance_profiles_merchant_id'),
      ('merchant_compliance_profiles', 'idx_merchant_compliance_profiles_decision_state'),
      ('merchant_compliance_reviews', 'uq_merchant_compliance_reviews_idempotency'),
      ('merchant_compliance_reviews', 'idx_merchant_compliance_reviews_queue'),
      ('merchant_compliance_events', 'uq_merchant_compliance_events_idempotency'),
      ('merchant_compliance_events', 'idx_merchant_compliance_events_timeline'),
      ('merchant_collection_limit_windows', 'uq_merchant_collection_limit_windows_identity'),
      ('merchant_collection_limit_windows', 'idx_merchant_collection_limit_windows_active'),
      ('merchant_collection_limit_reservations', 'uq_merchant_collection_reservations_reference'),
      ('merchant_collection_limit_reservations', 'uq_merchant_collection_reservations_idempotency'),
      ('merchant_collection_limit_reservations', 'idx_merchant_collection_reservations_expiry'),
      ('merchant_collection_limit_reservation_windows', 'merchant_collection_limit_reservation_windows_pkey'),
      ('merchant_collection_usage_events', 'uq_merchant_collection_usage_events_idempotency'),
      ('merchant_collection_usage_events', 'idx_merchant_collection_usage_events_timeline')
    ) AS expected_index(table_name, index_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_indexes index_state
      WHERE index_state.schemaname = 'public'
        AND index_state.tablename = expected_index.table_name
        AND index_state.indexname = expected_index.index_name
    )
  ) THEN
    RAISE EXCEPTION 'Migration 024 postcondition failure: canonical index set is incomplete';
  END IF;
END;
$migration_024_postconditions$;

NOTIFY pgrst, 'reload schema';

COMMIT;
