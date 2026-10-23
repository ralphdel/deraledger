\set ON_ERROR_STOP on

BEGIN READ ONLY;
SELECT pg_catalog.set_config('deraledger.phase2c_expected_database', :'expected_database', true) AS identity_database \gset
SELECT pg_catalog.set_config('deraledger.phase2c_expected_current_user', :'expected_current_user', true) AS identity_user \gset
SELECT pg_catalog.set_config('deraledger.phase2c_expected_server_major', :'expected_server_major', true) AS identity_server_major \gset

DO $identity$
BEGIN
  IF current_database() IS DISTINCT FROM current_setting('deraledger.phase2c_expected_database') THEN
    RAISE EXCEPTION 'PHASE2C_STAGING_TARGET_IDENTITY_REJECTED:database';
  END IF;
  IF current_user IS DISTINCT FROM current_setting('deraledger.phase2c_expected_current_user') THEN
    RAISE EXCEPTION 'PHASE2C_STAGING_TARGET_IDENTITY_REJECTED:current_user';
  END IF;
  IF session_user IS DISTINCT FROM current_setting('deraledger.phase2c_expected_current_user') THEN
    RAISE EXCEPTION 'PHASE2C_STAGING_TARGET_IDENTITY_REJECTED:session_user';
  END IF;
  IF current_setting('server_version_num')::integer / 10000
      IS DISTINCT FROM current_setting('deraledger.phase2c_expected_server_major')::integer THEN
    RAISE EXCEPTION 'PHASE2C_STAGING_TARGET_IDENTITY_REJECTED:server_major';
  END IF;
  IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_stat_ssl
      WHERE pid = pg_catalog.pg_backend_pid() AND ssl
    ) THEN
    RAISE EXCEPTION 'PHASE2C_STAGING_TARGET_IDENTITY_REJECTED:tls';
  END IF;
  IF pg_catalog.to_regnamespace('auth') IS NULL THEN
    RAISE EXCEPTION 'PHASE2C_STAGING_TARGET_IDENTITY_REJECTED:auth_schema';
  END IF;
  IF pg_catalog.to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'PHASE2C_STAGING_TARGET_IDENTITY_REJECTED:auth_users';
  END IF;
END;
$identity$;

SELECT 'CONTROL|IDENTITY|database=' || current_database()
  || '|current_user=' || current_user
  || '|session_user=' || session_user
  || '|server_major=' || current_setting('server_version_num')::integer / 10000
  || '|ssl=true|supabase_auth=true';

COMMIT;
