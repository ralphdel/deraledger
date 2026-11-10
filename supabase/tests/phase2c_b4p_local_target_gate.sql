\set ON_ERROR_STOP on

-- Every B4P fixture-mutating rehearsal includes this executable gate itself.
-- Operator labels are not accepted as target proof: PostgreSQL must report the
-- approved loopback endpoint, port, major version, superuser session, and a
-- purpose-specific disposable database name.
DO $phase2c_b4p_local_target_gate$
DECLARE
  v_server_host text := host(inet_server_addr());
  v_server_port integer := inet_server_port();
  v_server_version_num integer := current_setting('server_version_num')::integer;
  v_database text := current_database();
BEGIN
  IF v_server_host IS DISTINCT FROM '127.0.0.1'
    OR v_server_port IS DISTINCT FROM 55432
    OR v_server_version_num < 150000
    OR v_server_version_num >= 160000
    OR v_database !~ '^deraledger_phase2c_b4p_rehearsal_[a-z0-9_]+$'
    OR v_database IN ('postgres', 'template0', 'template1')
    OR session_user IS DISTINCT FROM 'postgres'
    OR current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'B4P_LOCAL_TARGET_REJECTED';
  END IF;
END;
$phase2c_b4p_local_target_gate$;
