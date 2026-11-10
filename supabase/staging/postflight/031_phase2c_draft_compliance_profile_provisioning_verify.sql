\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

WITH rpc AS (
  SELECT
    p.oid,
    p.proacl,
    p.proowner,
    p.prosecdef,
    p.proconfig,
    pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.oid = to_regprocedure('public.ensure_draft_compliance_profile_v1(uuid)')
    AND n.nspname = 'public'
), grant_state AS (
  SELECT
    has_function_privilege('service_role', 'public.ensure_draft_compliance_profile_v1(uuid)', 'EXECUTE') AS service_execute,
    has_function_privilege('anon', 'public.ensure_draft_compliance_profile_v1(uuid)', 'EXECUTE') AS anon_execute,
    has_function_privilege('authenticated', 'public.ensure_draft_compliance_profile_v1(uuid)', 'EXECUTE') AS authenticated_execute
), public_state AS (
  SELECT EXISTS (
    SELECT 1
    FROM rpc
    CROSS JOIN LATERAL aclexplode(
      COALESCE(rpc.proacl, acldefault('f', rpc.proowner))
    ) privilege_state
    WHERE privilege_state.grantee = 0
      AND privilege_state.privilege_type = 'EXECUTE'
  ) AS public_execute
)
SELECT
  'M031_POSTFLIGHT' AS check_group,
  CASE
    WHEN (SELECT count(*) = 1 FROM rpc)
      AND (SELECT NOT prosecdef FROM rpc)
      AND (SELECT proconfig @> ARRAY['search_path=pg_catalog, public'] FROM rpc)
      AND (SELECT service_execute AND NOT anon_execute AND NOT authenticated_execute FROM grant_state)
      AND NOT (SELECT public_execute FROM public_state)
      AND (SELECT definition LIKE '%FROM public.subscriptions s%' FROM rpc)
      AND (SELECT definition LIKE '%FROM public.merchant_canonical_workspaces mcw%' FROM rpc)
      AND (SELECT definition LIKE '%INSERT INTO public.merchant_compliance_profiles%' FROM rpc)
      AND (SELECT definition NOT LIKE '%workspace_subscriptions%' FROM rpc)
    THEN 'PASS'
    ELSE 'FAIL'
  END AS result,
  (SELECT count(*) FROM rpc) AS exact_rpc_count,
  (SELECT service_execute FROM grant_state) AS service_execute,
  (SELECT anon_execute FROM grant_state) AS anon_execute,
  (SELECT authenticated_execute FROM grant_state) AS authenticated_execute,
  (SELECT public_execute FROM public_state) AS public_execute;

ROLLBACK;
