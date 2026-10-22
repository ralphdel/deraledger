\set ON_ERROR_STOP on
DO $postflight$
DECLARE
  v_rpc regprocedure := 'public.submit_draft_plan_review_v1(uuid,uuid,bigint,uuid,text,jsonb,text)'::regprocedure;
  v_guard regprocedure := 'public.freeze_submitted_plan_review_v1()'::regprocedure;
  v_role record;
BEGIN
  IF current_setting('server_version_num')::integer < 150000 OR current_setting('server_version_num')::integer >= 160000 THEN
    RAISE EXCEPTION 'POSTFLIGHT_POSTGRES_15_REQUIRED';
  END IF;
  -- service_role may bypass RLS, but must still lack direct review UPDATE privilege below.
  FOR v_role IN
    SELECT expected.rolname AS expected_name, expected.bypassrls AS expected_bypassrls, actual.*
    FROM (VALUES ('anon', false), ('authenticated', false), ('service_role', true)) AS expected(rolname, bypassrls)
    LEFT JOIN pg_catalog.pg_roles AS actual ON actual.rolname = expected.rolname
  LOOP
    IF v_role.rolname IS NULL THEN RAISE EXCEPTION 'POSTFLIGHT_ROLE_CONTRACT_INCOMPATIBLE:%:missing', v_role.expected_name; END IF;
    IF v_role.rolsuper THEN RAISE EXCEPTION 'POSTFLIGHT_ROLE_CONTRACT_INCOMPATIBLE:%:superuser', v_role.expected_name; END IF;
    IF NOT v_role.rolinherit THEN RAISE EXCEPTION 'POSTFLIGHT_ROLE_CONTRACT_INCOMPATIBLE:%:inherit', v_role.expected_name; END IF;
    IF v_role.rolcreaterole THEN RAISE EXCEPTION 'POSTFLIGHT_ROLE_CONTRACT_INCOMPATIBLE:%:createrole', v_role.expected_name; END IF;
    IF v_role.rolcreatedb THEN RAISE EXCEPTION 'POSTFLIGHT_ROLE_CONTRACT_INCOMPATIBLE:%:createdb', v_role.expected_name; END IF;
    IF v_role.rolcanlogin THEN RAISE EXCEPTION 'POSTFLIGHT_ROLE_CONTRACT_INCOMPATIBLE:%:login', v_role.expected_name; END IF;
    IF v_role.rolreplication THEN RAISE EXCEPTION 'POSTFLIGHT_ROLE_CONTRACT_INCOMPATIBLE:%:replication', v_role.expected_name; END IF;
    IF v_role.rolbypassrls IS DISTINCT FROM v_role.expected_bypassrls THEN
      RAISE EXCEPTION 'POSTFLIGHT_ROLE_CONTRACT_INCOMPATIBLE:%:bypassrls', v_role.expected_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=v_rpc AND prosecdef
      AND proowner=to_regrole(current_user)::oid
      AND proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]) THEN
    RAISE EXCEPTION 'POSTFLIGHT_RPC_SECURITY_MISMATCH';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=v_guard AND NOT prosecdef
      AND proowner=to_regrole(current_user)::oid
      AND proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]) THEN
    RAISE EXCEPTION 'POSTFLIGHT_GUARD_SECURITY_MISMATCH';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid=v_rpc AND a.grantee=0 AND a.privilege_type='EXECUTE')
    OR has_function_privilege('anon',v_rpc,'EXECUTE')
    OR has_function_privilege('authenticated',v_rpc,'EXECUTE') OR NOT has_function_privilege('service_role',v_rpc,'EXECUTE') THEN
    RAISE EXCEPTION 'POSTFLIGHT_RPC_ACL_MISMATCH';
  END IF;
  IF has_table_privilege('service_role','public.merchant_compliance_reviews','UPDATE') THEN
    RAISE EXCEPTION 'POSTFLIGHT_DIRECT_REVIEW_UPDATE_NOT_REVOKED';
  END IF;
  IF has_table_privilege('service_role','public.merchants','UPDATE') THEN
    RAISE EXCEPTION 'POSTFLIGHT_BROAD_MERCHANT_UPDATE_PRESENT';
  END IF;
  IF has_function_privilege('service_role',v_guard,'EXECUTE') THEN
    RAISE EXCEPTION 'POSTFLIGHT_GUARD_EXECUTE_EXPOSED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.merchant_compliance_reviews'::regclass
    AND tgname='trg_freeze_submitted_plan_review_v1' AND tgenabled='O' AND tgfoid=v_guard) THEN
    RAISE EXCEPTION 'POSTFLIGHT_IMMUTABILITY_TRIGGER_MISSING';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN
      ('public.merchant_compliance_reviews'::regclass,'public.merchant_compliance_events'::regclass)
      AND (NOT relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'POSTFLIGHT_RLS_MISMATCH';
  END IF;
END;
$postflight$;
SELECT 'PASS|migration_postflight' AS result;
