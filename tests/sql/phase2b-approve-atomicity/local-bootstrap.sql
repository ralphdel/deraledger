-- Disposable PostgreSQL 15 only. Never run against Supabase or shared data.
\set ON_ERROR_STOP on
-- Roles are cluster-wide. Never create or repair them in a disposable database.
DO $$ BEGIN
  IF (SELECT count(*)
      FROM (VALUES ('service_role', true), ('anon', false),
                   ('authenticated', false)) AS expected(role_name, bypass_rls)
      JOIN pg_catalog.pg_roles r ON r.rolname = expected.role_name
      WHERE r.rolbypassrls = expected.bypass_rls
        AND NOT r.rolcanlogin AND NOT r.rolsuper
        AND NOT r.rolcreatedb AND NOT r.rolcreaterole
        AND NOT r.rolreplication AND r.rolinherit
        AND r.rolconnlimit = -1 AND r.rolvaliduntil IS NULL
        AND r.rolconfig IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_auth_members m
          WHERE m.roleid = r.oid OR m.member = r.oid
        )) <> 3 THEN
    RAISE EXCEPTION 'BLOCKED|APPROVE_ATOMICITY|local_roles_unavailable_or_drifted';
  END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'authenticated'::text $$;

-- Canonical schema-only chain used by the existing Solo Plus local harness.
-- 005 is a fake-data seed and is deliberately excluded.
\ir ../../../supabase/staging/001_schema_only.sql
\ir ../../../supabase/staging/002_onboarding_verification_upgrade_flow.sql
\ir ../../../supabase/staging/003_rls_policies.sql
\ir ../../../supabase/staging/004_phase1_plan_compatibility.sql
\ir ../../../supabase/staging/006_solo_plus_prerequisites.sql
\ir ../../../supabase/staging/007_solo_plus_case_foundation.sql
\ir ../../../supabase/staging/008_solo_plus_transactional_repository_rpcs.sql
-- These two staging wrappers use \i, which resolves from psql's working
-- directory. Include their exact canonical migration targets with \ir here.
\ir ../../../supabase/migrations/20260707010000_breet_payment_substrate_reconciliation.sql
\ir ../../../supabase/migrations/20260707020000_solo_plus_payment_lifecycle.sql
\ir ../../../supabase/staging/011_solo_plus_review_decision_rpc.sql
\ir ../../../supabase/staging/012_solo_plus_activation_rpc.sql
\ir ../../../supabase/staging/013_solo_plus_payment_recovery.sql
\ir ../../../supabase/staging/014_authorization_hardening.sql
\ir ../../../supabase/staging/015_verification_disclosure_acknowledgement_rpc.sql
\ir ../../../supabase/staging/016_verification_disclosure_identity_hardening.sql
\ir ../../../supabase/staging/017_payment_events_legacy_merchant_compatibility.sql
\ir ../../../supabase/staging/018_core_merchant_schema_compatibility.sql
\ir ../../../supabase/migrations/20260930000000_phase2b_review_action_intent_hardening.sql
\echo PASS|APPROVE_ATOMICITY|local_baseline_loaded
