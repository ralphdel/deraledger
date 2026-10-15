-- Run only after the candidate migration succeeds on a disposable clone.
\set ON_ERROR_STOP on
DO $$
DECLARE
  v_old pg_proc%ROWTYPE;
  v_new pg_proc%ROWTYPE;
  v_service_role oid := to_regrole('service_role')::oid;
BEGIN
  SELECT * INTO STRICT v_old FROM pg_proc
  WHERE oid = to_regprocedure('public.review_solo_plus_case_v1(uuid,bigint,text,text,uuid,text,text)');
  SELECT * INTO STRICT v_new FROM pg_proc
  WHERE oid = to_regprocedure('public.review_solo_plus_case_approve_atomic_v1(uuid,bigint,text,text,uuid,text,text,text)');
  IF md5(replace(replace(v_old.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) <> '27710a7819d8413aa8764d8762a6a0ca'
     OR md5(replace(replace(v_new.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) <> '59a78faa12cc7abad8d93637b4a60125'
     OR v_old.prosecdef OR v_new.prosecdef
     OR COALESCE(array_length(v_old.proconfig, 1), 0) <> 1
     OR COALESCE(array_length(v_new.proconfig, 1), 0) <> 1
     OR replace(v_old.proconfig[1], ' ', '') IS DISTINCT FROM 'search_path=public,pg_temp'
     OR replace(v_new.proconfig[1], ' ', '') IS DISTINCT FROM 'search_path=public,pg_temp' THEN
    RAISE EXCEPTION 'FAIL|APPROVE_ATOMICITY|installed_function_or_security_drift';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid IN (v_old.oid, v_new.oid) AND a.privilege_type = 'EXECUTE'
      AND a.grantee NOT IN (p.proowner, v_service_role)
  ) OR (SELECT count(*) FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
        WHERE p.oid IN (v_old.oid, v_new.oid) AND a.privilege_type = 'EXECUTE'
          AND a.grantee = v_service_role) <> 2 THEN
    RAISE EXCEPTION 'FAIL|APPROVE_ATOMICITY|execute_grant_drift';
  END IF;
END $$;
\echo PASS|APPROVE_ATOMICITY|installed_functions_and_grants
