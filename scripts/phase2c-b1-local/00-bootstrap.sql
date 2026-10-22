\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB NOLOGIN NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB NOLOGIN NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB NOLOGIN NOREPLICATION BYPASSRLS;
  END IF;
END;
$roles$;
DO $role_safety$
DECLARE
  v_role record;
BEGIN
  -- BYPASSRLS is expected only for the server-side transport role; table ACLs are checked separately.
  FOR v_role IN
    SELECT expected.rolname AS expected_name, expected.bypassrls AS expected_bypassrls, actual.*
    FROM (VALUES ('anon', false), ('authenticated', false), ('service_role', true)) AS expected(rolname, bypassrls)
    LEFT JOIN pg_catalog.pg_roles AS actual ON actual.rolname = expected.rolname
  LOOP
    IF v_role.rolname IS NULL THEN RAISE EXCEPTION 'BOOTSTRAP_ROLE_CONTRACT_INCOMPATIBLE:%:missing', v_role.expected_name; END IF;
    IF v_role.rolsuper THEN RAISE EXCEPTION 'BOOTSTRAP_ROLE_CONTRACT_INCOMPATIBLE:%:superuser', v_role.expected_name; END IF;
    IF NOT v_role.rolinherit THEN RAISE EXCEPTION 'BOOTSTRAP_ROLE_CONTRACT_INCOMPATIBLE:%:inherit', v_role.expected_name; END IF;
    IF v_role.rolcreaterole THEN RAISE EXCEPTION 'BOOTSTRAP_ROLE_CONTRACT_INCOMPATIBLE:%:createrole', v_role.expected_name; END IF;
    IF v_role.rolcreatedb THEN RAISE EXCEPTION 'BOOTSTRAP_ROLE_CONTRACT_INCOMPATIBLE:%:createdb', v_role.expected_name; END IF;
    IF v_role.rolcanlogin THEN RAISE EXCEPTION 'BOOTSTRAP_ROLE_CONTRACT_INCOMPATIBLE:%:login', v_role.expected_name; END IF;
    IF v_role.rolreplication THEN RAISE EXCEPTION 'BOOTSTRAP_ROLE_CONTRACT_INCOMPATIBLE:%:replication', v_role.expected_name; END IF;
    IF v_role.rolbypassrls IS DISTINCT FROM v_role.expected_bypassrls THEN
      RAISE EXCEPTION 'BOOTSTRAP_ROLE_CONTRACT_INCOMPATIBLE:%:bypassrls', v_role.expected_name;
    END IF;
  END LOOP;
END;
$role_safety$;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);

CREATE TABLE public.merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name text NOT NULL,
  email text NOT NULL,
  subscription_plan text NOT NULL DEFAULT 'starter'
);

CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  merchant_id uuid REFERENCES public.merchants(id) ON DELETE CASCADE,
  workspace_type text NOT NULL DEFAULT 'business',
  display_name text NOT NULL,
  plan_type text NOT NULL DEFAULT 'starter',
  onboarding_status text NOT NULL DEFAULT 'setup_mode',
  setup_mode boolean NOT NULL DEFAULT true,
  live_features_enabled boolean NOT NULL DEFAULT false,
  UNIQUE (merchant_id)
);
CREATE UNIQUE INDEX merchant_canonical_workspace_supporting_owner_key
  ON public.workspaces (id, merchant_id);

CREATE TABLE public.merchant_canonical_workspaces (
  merchant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  link_version bigint NOT NULL DEFAULT 1,
  reconcile_idempotency_key text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT merchant_canonical_workspaces_pkey PRIMARY KEY (merchant_id),
  CONSTRAINT merchant_canonical_workspaces_workspace_key UNIQUE (workspace_id),
  CONSTRAINT merchant_canonical_workspaces_reconcile_key UNIQUE (reconcile_idempotency_key),
  CONSTRAINT merchant_canonical_workspaces_version_check CHECK (link_version = 1),
  CONSTRAINT merchant_canonical_workspaces_key_check CHECK (length(btrim(reconcile_idempotency_key)) > 0),
  CONSTRAINT merchant_canonical_workspaces_merchant_fkey FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_canonical_workspaces_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_canonical_workspaces_workspace_owner_fkey FOREIGN KEY (workspace_id, merchant_id)
    REFERENCES public.workspaces(id, merchant_id) ON DELETE RESTRICT
);

CREATE TABLE public.merchant_compliance_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  plan_code text NOT NULL,
  compliance_status text NOT NULL DEFAULT 'draft',
  activation_status text NOT NULL DEFAULT 'test_mode',
  policy_version text,
  decision_source_type text,
  decision_source_id uuid,
  decision_source_version bigint,
  row_version bigint NOT NULL DEFAULT 1,
  can_collect_payments boolean NOT NULL DEFAULT false,
  can_use_instant_sale boolean NOT NULL DEFAULT false,
  can_use_receivable_sale boolean NOT NULL DEFAULT false,
  can_use_storefront boolean NOT NULL DEFAULT false,
  can_activate_settlement boolean NOT NULL DEFAULT false,
  can_use_deposit_balance boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT merchant_compliance_profiles_pkey PRIMARY KEY (id),
  CONSTRAINT uq_merchant_compliance_profiles_merchant_id UNIQUE (merchant_id),
  CONSTRAINT merchant_compliance_profiles_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_compliance_profiles_plan_code_check CHECK (plan_code IN ('starter','solo_lite','solo_plus','business')),
  CONSTRAINT merchant_compliance_profiles_compliance_status_check CHECK (compliance_status IN
    ('draft','lite_pending','lite_verified','enhanced_pending','enhanced_verified','business_pending','business_verified','needs_attention','restricted','rejected')),
  CONSTRAINT merchant_compliance_profiles_activation_status_check CHECK (activation_status IN
    ('test_mode','pre_approved','awaiting_review','approved','needs_attention','restricted','suspended')),
  CONSTRAINT merchant_compliance_profiles_row_version_check CHECK (row_version > 0)
);

CREATE TABLE public.merchant_compliance_reviews (
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
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  idempotency_key text NOT NULL,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT merchant_compliance_reviews_pkey PRIMARY KEY (id),
  CONSTRAINT uq_merchant_compliance_reviews_idempotency UNIQUE (merchant_id, idempotency_key),
  CONSTRAINT merchant_compliance_reviews_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_compliance_reviews_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.merchant_compliance_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_compliance_reviews_type_plan_check CHECK (
    (review_type='solo_lite' AND target_plan_code='solo_lite') OR
    (review_type='business_kyb' AND target_plan_code='business')),
  CONSTRAINT merchant_compliance_reviews_status_check CHECK (review_status IN ('draft','pending','approved','rejected','needs_attention','cancelled')),
  CONSTRAINT merchant_compliance_reviews_evidence_snapshot_check CHECK (jsonb_typeof(evidence_snapshot)='object'),
  CONSTRAINT merchant_compliance_reviews_idempotency_key_check CHECK (length(btrim(idempotency_key)) > 0),
  CONSTRAINT merchant_compliance_reviews_row_version_check CHECK (row_version > 0)
);

CREATE TABLE public.merchant_compliance_events (
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
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT merchant_compliance_events_pkey PRIMARY KEY (id),
  CONSTRAINT uq_merchant_compliance_events_idempotency UNIQUE (merchant_id, idempotency_key),
  CONSTRAINT merchant_compliance_events_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_compliance_events_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.merchant_compliance_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_compliance_events_actor_type_check CHECK (actor_type IN ('system','admin','merchant','reconciliation')),
  CONSTRAINT merchant_compliance_events_source_check CHECK ((source_type IS NULL AND source_id IS NULL) OR
    (source_type IN ('solo_lite_review','solo_plus_case','business_kyb_review','restriction_review','system_reconciliation') AND source_id IS NOT NULL)),
  CONSTRAINT merchant_compliance_events_versions_check CHECK ((expected_row_version IS NULL OR expected_row_version > 0) AND resulting_row_version > 0),
  CONSTRAINT merchant_compliance_events_state_check CHECK (jsonb_typeof(from_state)='object' AND jsonb_typeof(to_state)='object'),
  CONSTRAINT merchant_compliance_events_metadata_check CHECK (jsonb_typeof(metadata)='object')
);

ALTER TABLE public.merchant_canonical_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_compliance_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_compliance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_compliance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_canonical_workspaces NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_compliance_profiles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_compliance_reviews NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_compliance_events NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.merchants TO service_role;
GRANT SELECT ON public.merchant_canonical_workspaces TO service_role;
GRANT SELECT, UPDATE ON public.merchant_compliance_profiles TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.merchant_compliance_reviews TO service_role;
GRANT SELECT, INSERT ON public.merchant_compliance_events TO service_role;

SELECT 'PASS|bootstrap_exact_prerequisites' AS result;
