-- Operator-only, disposable PostgreSQL 15 at 127.0.0.1:55432.
-- Run with psql -X -W -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55432 -U postgres -d postgres -f this-file.
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
     OR EXISTS (SELECT 1 FROM pg_database WHERE datname IN
       ('deraledger_phase2b_approve_success_disposable', 'deraledger_phase2b_approve_success_race_disposable')) THEN
    RAISE EXCEPTION 'BLOCKED|APPROVE_SUCCESS|local_identity_or_disposable_state';
  END IF;
END $$;
CREATE DATABASE deraledger_phase2b_approve_success_disposable
  TEMPLATE deraledger_phase2b_approve_atomicity_baseline_disposable;
COMMENT ON DATABASE deraledger_phase2b_approve_success_disposable
  IS 'phase2b-approve-success:local-disposable';
\connect deraledger_phase2b_approve_success_disposable postgres 127.0.0.1 55432
DO $$ BEGIN
  IF current_database() <> 'deraledger_phase2b_approve_success_disposable'
     OR current_user <> 'postgres' OR host(inet_server_addr()) <> '127.0.0.1'
     OR inet_server_port() <> 55432 THEN
    RAISE EXCEPTION 'BLOCKED|APPROVE_SUCCESS|clone_identity';
  END IF;
END $$;

-- Local-only Supabase managed-role ACL emulation.
-- The canonical authorization-hardening migration revokes automatic table
-- privileges from PUBLIC/anon/authenticated but intentionally preserves the
-- managed service_role contract. Vanilla PostgreSQL does not create those
-- Supabase defaults, so emulate only the four tables exercised by this package.
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
\echo PASS|APPROVE_SUCCESS|predecessor_applied
\ir ../../../supabase/migrations/20261015000000_phase2b_approve_success_atomic.sql
\echo PASS|APPROVE_SUCCESS|first_apply
\ir postflight.sql
\echo PASS|APPROVE_SUCCESS|postflight
\ir ../../../supabase/migrations/20261015000000_phase2b_approve_success_atomic.sql
\ir postflight.sql
\echo PASS|APPROVE_SUCCESS|rerun
\ir writer-contract.sql
\ir protected-case.sql
\ir approval-success.sql
\ir atomic-failure.sql
\ir replay.sql
\ir legacy-regression.sql
\connect postgres postgres 127.0.0.1 55432
DO $$ BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres'
     OR host(inet_server_addr()) <> '127.0.0.1' OR inet_server_port() <> 55432 THEN
    RAISE EXCEPTION 'BLOCKED|APPROVE_SUCCESS|race_clone_identity';
  END IF;
END $$;
CREATE DATABASE deraledger_phase2b_approve_success_race_disposable
  TEMPLATE deraledger_phase2b_approve_success_disposable;
COMMENT ON DATABASE deraledger_phase2b_approve_success_race_disposable
  IS 'phase2b-approve-success:local-disposable';
\connect deraledger_phase2b_approve_success_race_disposable postgres 127.0.0.1 55432
\ir concurrency-fixture.sql
\echo PASS|APPROVE_SUCCESS|sequential_gates_complete
