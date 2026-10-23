\set ON_ERROR_STOP on

BEGIN READ ONLY;
SELECT pg_catalog.set_config('deraledger.phase2c_expected_database', :'expected_database', true) AS identity_database \gset
SELECT pg_catalog.set_config('deraledger.phase2c_expected_current_user', :'expected_current_user', true) AS identity_user \gset

DO $identity$
BEGIN
  IF current_database() IS DISTINCT FROM current_setting('deraledger.phase2c_expected_database')
    OR current_user IS DISTINCT FROM current_setting('deraledger.phase2c_expected_current_user')
    OR session_user IS DISTINCT FROM current_setting('deraledger.phase2c_expected_current_user')
    OR current_setting('server_version_num')::integer < 150000
    OR current_setting('server_version_num')::integer >= 160000
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_stat_ssl
      WHERE pid = pg_catalog.pg_backend_pid() AND ssl
    )
    OR pg_catalog.to_regnamespace('auth') IS NULL
    OR pg_catalog.to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'PHASE2C_STAGING_TARGET_IDENTITY_REJECTED';
  END IF;
END;
$identity$;

SELECT 'CONTROL|IDENTITY|database=' || current_database()
  || '|current_user=' || current_user
  || '|server_major=' || current_setting('server_version_num')::integer / 10000
  || '|ssl=true|supabase_auth=true';

COMMIT;
