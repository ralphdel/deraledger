-- Run only after all local evidence is captured and both race sessions exit.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres'
     OR host(inet_server_addr()) <> '127.0.0.1' OR inet_server_port() <> 55432
     OR current_setting('server_version_num')::integer / 10000 <> 15
     OR NOT EXISTS (SELECT 1 FROM pg_database
       WHERE datname = 'deraledger_phase2b_approve_atomicity_baseline_disposable')
     OR EXISTS (SELECT 1 FROM pg_database
       WHERE datname IN (
         'deraledger_phase2b_approve_success_race_disposable',
         'deraledger_phase2b_approve_success_origin_drift_disposable',
         'deraledger_phase2b_approve_success_ownership_drift_disposable',
         'deraledger_phase2b_approve_success_disposable')
         AND pg_catalog.shobj_description(oid, 'pg_database')
           IS DISTINCT FROM 'phase2b-approve-success:local-disposable') THEN
    RAISE EXCEPTION 'BLOCKED|APPROVE_SUCCESS|teardown_identity';
  END IF;
END $$;
DROP DATABASE IF EXISTS deraledger_phase2b_approve_success_race_disposable;
DROP DATABASE IF EXISTS deraledger_phase2b_approve_success_origin_drift_disposable;
DROP DATABASE IF EXISTS deraledger_phase2b_approve_success_ownership_drift_disposable;
DROP DATABASE IF EXISTS deraledger_phase2b_approve_success_disposable;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_database WHERE datname IN (
       'deraledger_phase2b_approve_success_race_disposable',
       'deraledger_phase2b_approve_success_origin_drift_disposable',
       'deraledger_phase2b_approve_success_ownership_drift_disposable',
       'deraledger_phase2b_approve_success_disposable'))
     OR NOT EXISTS (SELECT 1 FROM pg_database
       WHERE datname = 'deraledger_phase2b_approve_atomicity_baseline_disposable') THEN
    RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|local_teardown';
  END IF;
END $$;
\echo PASS|APPROVE_SUCCESS|local_teardown
