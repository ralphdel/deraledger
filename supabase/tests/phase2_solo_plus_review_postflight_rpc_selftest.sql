BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.evaluate_commit9_postflight_rpc_status()
RETURNS JSONB
LANGUAGE sql
AS $$
  WITH review_rpc AS (
    SELECT
      exact_rpc.exact_oid IS NOT NULL AS exact_exists,
      NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'review_solo_plus_case_v1'
          AND p.oid <> exact_rpc.exact_oid
      ) AS no_overloads,
      exact_function.return_type = 'jsonb' AS return_type_ok,
      exact_function.security_type = 'INVOKER' AS security_ok,
      exact_function.has_hardened_search_path AS search_path_ok,
      exact_function.service_role_exists AND exact_function.service_role_can_execute AS service_role_ok,
      NOT exact_function.public_can_execute AS public_ok,
      exact_function.anon_exists AND NOT exact_function.anon_can_execute AS anon_ok,
      exact_function.authenticated_exists AND NOT exact_function.authenticated_can_execute AS authenticated_ok
    FROM (
      SELECT
        to_regprocedure('public.review_solo_plus_case_v1(uuid,bigint,text,text,uuid,text,text)')::oid AS exact_oid
    ) exact_rpc
    LEFT JOIN (
      SELECT
        p.oid,
        pg_get_function_result(p.oid) AS return_type,
        CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS security_type,
        EXISTS (
          SELECT 1
          FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg(setting)
          WHERE cfg.setting = 'search_path=public, pg_temp'
        ) AS has_hardened_search_path,
        EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') AS service_role_exists,
        EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AS anon_exists,
        EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AS authenticated_exists,
        EXISTS (
          SELECT 1
          FROM pg_proc proc_acl
          LEFT JOIN LATERAL aclexplode(COALESCE(proc_acl.proacl, acldefault('f', proc_acl.proowner))) acl ON TRUE
          WHERE proc_acl.oid = p.oid
            AND acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
        ) AS public_can_execute,
        has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'review_solo_plus_case_v1'
    ) exact_function
      ON exact_function.oid = exact_rpc.exact_oid
  )
  SELECT jsonb_build_object(
    'exact_exists', exact_exists,
    'no_overloads', no_overloads,
    'return_type_ok', return_type_ok,
    'security_ok', security_ok,
    'search_path_ok', search_path_ok,
    'service_role_ok', service_role_ok,
    'public_ok', public_ok,
    'anon_ok', anon_ok,
    'authenticated_ok', authenticated_ok,
    'status',
    CASE
      WHEN exact_exists
       AND no_overloads
       AND return_type_ok
       AND security_ok
       AND search_path_ok
       AND service_role_ok
       AND public_ok
       AND anon_ok
       AND authenticated_ok
      THEN 'PASS'
      ELSE 'FAIL'
    END
  )
  FROM review_rpc;
$$;

DO $$
DECLARE
  v_status JSONB;
BEGIN
  DROP FUNCTION IF EXISTS public.review_solo_plus_case_v1(uuid, bigint, text, text, uuid, text, text);
  DROP FUNCTION IF EXISTS public.review_solo_plus_case_v1(uuid, integer, text, text, uuid, text, text);

  CREATE FUNCTION public.review_solo_plus_case_v1(
    p_case_id uuid,
    p_expected_row_version bigint,
    p_request_idempotency_key text,
    p_decision text,
    p_reviewer_admin_id uuid,
    p_reason text default null,
    p_policy_version text default null
  )
  RETURNS jsonb
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, pg_temp
  AS $fn$
    SELECT jsonb_build_object('kind', 'fixture');
  $fn$;

  REVOKE ALL ON FUNCTION public.review_solo_plus_case_v1(uuid, bigint, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.review_solo_plus_case_v1(uuid, bigint, text, text, uuid, text, text) TO service_role;

  v_status := pg_temp.evaluate_commit9_postflight_rpc_status();
  IF v_status ->> 'status' <> 'PASS' THEN
    RAISE EXCEPTION 'expected secure named-argument function to PASS, received %', v_status;
  END IF;

  CREATE FUNCTION public.review_solo_plus_case_v1(
    p_case_id uuid,
    p_expected_row_version integer,
    p_request_idempotency_key text,
    p_decision text,
    p_reviewer_admin_id uuid,
    p_reason text default null,
    p_policy_version text default null
  )
  RETURNS jsonb
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, pg_temp
  AS $fn$
    SELECT jsonb_build_object('kind', 'unexpected_overload');
  $fn$;

  v_status := pg_temp.evaluate_commit9_postflight_rpc_status();
  IF v_status ->> 'status' <> 'FAIL'
     OR v_status ->> 'no_overloads' <> 'false' THEN
    RAISE EXCEPTION 'expected overload to FAIL, received %', v_status;
  END IF;

  DROP FUNCTION public.review_solo_plus_case_v1(uuid, integer, text, text, uuid, text, text);

  GRANT EXECUTE ON FUNCTION public.review_solo_plus_case_v1(uuid, bigint, text, text, uuid, text, text) TO PUBLIC;
  v_status := pg_temp.evaluate_commit9_postflight_rpc_status();
  IF v_status ->> 'status' <> 'FAIL'
     OR v_status ->> 'public_ok' <> 'false' THEN
    RAISE EXCEPTION 'expected PUBLIC execute to FAIL, received %', v_status;
  END IF;

  REVOKE EXECUTE ON FUNCTION public.review_solo_plus_case_v1(uuid, bigint, text, text, uuid, text, text) FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.review_solo_plus_case_v1(uuid, bigint, text, text, uuid, text, text) FROM service_role;
  v_status := pg_temp.evaluate_commit9_postflight_rpc_status();
  IF v_status ->> 'status' <> 'FAIL'
     OR v_status ->> 'service_role_ok' <> 'false' THEN
    RAISE EXCEPTION 'expected missing service_role execute to FAIL, received %', v_status;
  END IF;

  GRANT EXECUTE ON FUNCTION public.review_solo_plus_case_v1(uuid, bigint, text, text, uuid, text, text) TO service_role;
  ALTER FUNCTION public.review_solo_plus_case_v1(uuid, bigint, text, text, uuid, text, text) RESET ALL;
  ALTER FUNCTION public.review_solo_plus_case_v1(uuid, bigint, text, text, uuid, text, text)
    SET search_path = public;
  v_status := pg_temp.evaluate_commit9_postflight_rpc_status();
  IF v_status ->> 'status' <> 'FAIL'
     OR v_status ->> 'search_path_ok' <> 'false' THEN
    RAISE EXCEPTION 'expected incorrect search_path to FAIL, received %', v_status;
  END IF;

  ALTER FUNCTION public.review_solo_plus_case_v1(uuid, bigint, text, text, uuid, text, text)
    SET search_path = public, pg_temp;
  v_status := pg_temp.evaluate_commit9_postflight_rpc_status();
  IF v_status ->> 'status' <> 'PASS' THEN
    RAISE EXCEPTION 'expected secure exact function to PASS after restore, received %', v_status;
  END IF;
END
$$;

ROLLBACK;
