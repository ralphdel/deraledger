-- Exact functions, trigger identities, grants, and unchanged v1 body.
DO $$
DECLARE v_approve oid := to_regprocedure('public.review_solo_plus_case_approve_atomic_v1(uuid,bigint,text,text,uuid,text,text,text)')::oid;
v_old oid := to_regprocedure('public.review_solo_plus_case_v1(uuid,bigint,text,text,uuid,text,text)')::oid;
BEGIN
  IF v_approve IS NULL OR v_old IS NULL
     OR (SELECT md5(replace(replace(prosrc, E'\r\n', E'\n'), E'\r', E'\n')) FROM pg_proc WHERE oid = v_approve)
          <> '5cc81f443c678a15bed43de6df472077'
     OR (SELECT md5(replace(replace(prosrc, E'\r\n', E'\n'), E'\r', E'\n')) FROM pg_proc WHERE oid = v_old)
          <> '27710a7819d8413aa8764d8762a6a0ca'
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
           AND proname = 'review_solo_plus_case_approve_atomic_v1') <> 1
     OR (SELECT count(*) FROM pg_trigger
         WHERE NOT tgisinternal AND tgname LIKE 'trg_phase2b_approve_%') <> 7
     OR EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
          WHERE p.oid IN (v_approve, v_old) AND a.privilege_type = 'EXECUTE'
            AND a.grantee NOT IN (p.proowner, to_regrole('service_role')::oid))
     OR NOT has_function_privilege('service_role', v_approve, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_old, 'EXECUTE')
     OR (SELECT prosecdef FROM pg_proc WHERE oid = v_approve)
     OR (SELECT replace(proconfig[1], ' ', '') FROM pg_proc WHERE oid = v_approve)
           IS DISTINCT FROM 'search_path=public,pg_temp' THEN
    RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|postflight';
  END IF;
END $$;
