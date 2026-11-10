\set ON_ERROR_STOP on
\ir phase2c_b4p_local_target_gate.sql

-- LOCAL DISPOSABLE DATABASE ONLY.
--
-- This is an orchestration bootstrap, not a replacement schema. Application
-- relations are created by the source-pinned canonical staging/migration
-- files referenced below. Only the Supabase-managed roles/auth primitives
-- unavailable in vanilla PostgreSQL are represented locally here.

DO $b4p_empty_database_guard$
BEGIN
  IF to_regclass('public.merchants') IS NOT NULL
    OR to_regclass('public.workspaces') IS NOT NULL
    OR to_regclass('public.subscriptions') IS NOT NULL
    OR to_regclass('public.merchant_compliance_profiles') IS NOT NULL
    OR to_regclass('public.merchant_canonical_workspaces') IS NOT NULL THEN
    RAISE EXCEPTION 'B4P_PRE_M031_BOOTSTRAP_REQUIRES_EMPTY_DATABASE';
  END IF;
END;
$b4p_empty_database_guard$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $b4p_local_managed_roles$
DECLARE
  v_role record;
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

  FOR v_role IN
    SELECT expected.rolname AS expected_name,
           expected.bypassrls AS expected_bypassrls,
           actual.*
    FROM (VALUES
      ('anon', false),
      ('authenticated', false),
      ('service_role', true)
    ) AS expected(rolname, bypassrls)
    LEFT JOIN pg_catalog.pg_roles actual ON actual.rolname = expected.rolname
  LOOP
    IF v_role.rolname IS NULL
      OR v_role.rolsuper
      OR NOT v_role.rolinherit
      OR v_role.rolcreaterole
      OR v_role.rolcreatedb
      OR v_role.rolcanlogin
      OR v_role.rolreplication
      OR v_role.rolbypassrls IS DISTINCT FROM v_role.expected_bypassrls THEN
      RAISE EXCEPTION 'B4P_LOCAL_MANAGED_ROLE_INCOMPATIBLE:%', v_role.expected_name;
    END IF;
  END LOOP;

  -- Existing membership can confer authority not visible in pg_roles. The
  -- disposable harness accepts no membership involving its managed roles and
  -- never alters cluster-scoped role membership to make a rehearsal pass.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member
    WHERE granted_role.rolname IN ('anon', 'authenticated', 'service_role')
       OR member_role.rolname IN ('anon', 'authenticated', 'service_role')
  ) THEN
    RAISE EXCEPTION 'B4P_LOCAL_MANAGED_ROLE_MEMBERSHIP_INCOMPATIBLE';
  END IF;
END;
$b4p_local_managed_roles$;

CREATE SCHEMA auth;
REVOKE ALL ON SCHEMA auth FROM PUBLIC;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY
);
REVOKE ALL ON TABLE auth.users FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE auth.users TO service_role;

CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$ SELECT NULL::uuid $$;

CREATE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$ SELECT 'authenticated'::text $$;

REVOKE ALL ON FUNCTION auth.uid(), auth.role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;

-- Canonical historical substrate. Hashes are pinned by the PowerShell runner
-- and the source-contract test before this file can be executed.
\ir ../staging/001_schema_only.sql
\ir ../staging/002_onboarding_verification_upgrade_flow.sql
\ir ../staging/004_phase1_plan_compatibility.sql
\ir ../staging/006_solo_plus_prerequisites.sql
\ir ../staging/007_solo_plus_case_foundation.sql
\ir ../migrations/20260728000000_authorization_hardening.sql

-- These grants reproduce the server-side authority expected by the canonical
-- M024-M030 chain. Browser roles receive no new table mutation authority.
REVOKE ALL ON TABLE public.merchants, public.workspaces, public.solo_plus_cases
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE ON TABLE public.merchants TO service_role;
GRANT SELECT ON TABLE public.workspaces, public.solo_plus_cases TO service_role;

\ir ../migrations/20260818025000_paid_subscription_tables_prerequisite.sql
\ir ../migrations/20260820_00_prd_phase_2_compliance_schema_substrate.sql
\ir ../migrations/20260824_00_reviewed_profile_bootstrap_rpc.sql
\ir ../migrations/20260825000000_reviewed_profile_approval_rpc.sql
\ir ../migrations/20260825010000_cleanup_approval_rpc_diagnostics.sql
\ir ../migrations/20260825020000_canonical_approval_snapshot_idempotency.sql
\ir ../migrations/20260826_00_canonical_workspace_linkage.sql
\ir ../migrations/20260827_00_m028_m029_readiness_integration.sql
\ir ../migrations/20261021000000_phase2c_nonadopted_review_substrate.sql
\ir ../migrations/20261022000000_phase2c_nonadopted_review_triage_resubmission.sql

SELECT 'B4P_PRE_M031_BOOTSTRAP|PASS';
