\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres'
     OR host(inet_server_addr()) <> '127.0.0.1' OR inet_server_port() <> 55432
     OR current_setting('server_version_num')::integer / 10000 <> 15
     OR NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'deraledger_phase2b_approve_atomicity_baseline_disposable')
     OR (SELECT count(*) FROM (VALUES ('service_role', true), ('anon', false),
          ('authenticated', false)) e(role_name, bypass_rls)
          JOIN pg_roles r ON r.rolname = e.role_name
          WHERE r.rolbypassrls = e.bypass_rls AND NOT r.rolcanlogin
            AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole
            AND NOT r.rolreplication AND r.rolinherit AND r.rolconnlimit = -1
            AND r.rolvaliduntil IS NULL AND r.rolconfig IS NULL
            AND NOT EXISTS (SELECT 1 FROM pg_auth_members m
              WHERE m.roleid = r.oid OR m.member = r.oid)) <> 3
     OR EXISTS (SELECT 1 FROM pg_database WHERE datname = 'deraledger_phase2b_approve_success_origin_drift_disposable') THEN
    RAISE EXCEPTION 'BLOCKED|APPROVE_SUCCESS|drift_identity_or_state';
  END IF;
END $$;
CREATE DATABASE deraledger_phase2b_approve_success_origin_drift_disposable
  TEMPLATE deraledger_phase2b_approve_atomicity_baseline_disposable;
COMMENT ON DATABASE deraledger_phase2b_approve_success_origin_drift_disposable
  IS 'phase2b-approve-success:local-disposable';
\connect deraledger_phase2b_approve_success_origin_drift_disposable postgres 127.0.0.1 55432
-- Local-only Supabase managed-role ACL emulation.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.solo_plus_cases
  TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.solo_plus_case_requirements
  TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.payment_records
  TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.solo_plus_case_events
  TO service_role;
\ir ../../../supabase/migrations/20261014000000_phase2b_approve_atomicity_fail_closed.sql
ALTER TABLE public.solo_plus_cases DROP CONSTRAINT solo_plus_cases_flow_origin_check;
ALTER TABLE public.solo_plus_cases ADD CONSTRAINT solo_plus_cases_flow_origin_check
  CHECK (flow_origin IN ('onboarding', 'upgrade', 'other'));
\ir ../../../supabase/migrations/20261015000000_phase2b_approve_success_atomic.sql
-- The include above MUST stop with exactly one expected guard error.
\echo FAIL|APPROVE_SUCCESS|flow_origin_drift_was_accepted
