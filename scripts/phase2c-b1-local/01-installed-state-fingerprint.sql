\set ON_ERROR_STOP on

-- One bounded catalog fingerprint. No business rows or credentials are read.
WITH objects AS (
  SELECT
    'public.submit_draft_plan_review_v1(uuid,uuid,bigint,uuid,text,jsonb,text)'::regprocedure AS rpc_oid,
    'public.freeze_submitted_plan_review_v1()'::regprocedure AS guard_oid,
    'public.merchant_compliance_reviews'::regclass AS review_oid
), state AS (
  SELECT pg_catalog.jsonb_build_object(
    'rpc', pg_catalog.jsonb_build_object(
      'identity', o.rpc_oid::text,
      'definition', pg_catalog.pg_get_functiondef(o.rpc_oid),
      'owner', pg_catalog.pg_get_userbyid(rpc.proowner),
      'security_definer', rpc.prosecdef,
      'config', rpc.proconfig,
      'acl', rpc.proacl,
      'public_execute', EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(COALESCE(rpc.proacl,
          pg_catalog.acldefault('f',rpc.proowner))) a
        WHERE a.grantee=0 AND a.privilege_type='EXECUTE'),
      'anon_execute', pg_catalog.has_function_privilege('anon',o.rpc_oid,'EXECUTE'),
      'authenticated_execute', pg_catalog.has_function_privilege('authenticated',o.rpc_oid,'EXECUTE'),
      'service_execute', pg_catalog.has_function_privilege('service_role',o.rpc_oid,'EXECUTE')),
    'guard', pg_catalog.jsonb_build_object(
      'identity', o.guard_oid::text,
      'definition', pg_catalog.pg_get_functiondef(o.guard_oid),
      'owner', pg_catalog.pg_get_userbyid(guard.proowner),
      'security_definer', guard.prosecdef,
      'config', guard.proconfig,
      'acl', guard.proacl,
      'service_execute', pg_catalog.has_function_privilege('service_role',o.guard_oid,'EXECUTE')),
    'trigger', pg_catalog.jsonb_build_object(
      'name', review_trigger.tgname,
      'definition', pg_catalog.pg_get_triggerdef(review_trigger.oid),
      'enabled', review_trigger.tgenabled,
      'function', review_trigger.tgfoid::regprocedure::text),
    'reviews', pg_catalog.jsonb_build_object(
      'owner', pg_catalog.pg_get_userbyid(reviews.relowner),
      'acl', reviews.relacl,
      'rls', reviews.relrowsecurity,
      'force_rls', reviews.relforcerowsecurity,
      'service_select', pg_catalog.has_table_privilege('service_role',o.review_oid,'SELECT'),
      'service_insert', pg_catalog.has_table_privilege('service_role',o.review_oid,'INSERT'),
      'service_update', pg_catalog.has_table_privilege('service_role',o.review_oid,'UPDATE'),
      'anon_update', pg_catalog.has_table_privilege('anon',o.review_oid,'UPDATE'),
      'authenticated_update', pg_catalog.has_table_privilege('authenticated',o.review_oid,'UPDATE')),
    'events', pg_catalog.jsonb_build_object(
      'acl', events.relacl, 'rls', events.relrowsecurity,
      'force_rls', events.relforcerowsecurity,
      'service_insert', pg_catalog.has_table_privilege('service_role',events.oid,'INSERT')),
    'profiles', pg_catalog.jsonb_build_object(
      'acl', profiles.relacl, 'rls', profiles.relrowsecurity,
      'force_rls', profiles.relforcerowsecurity),
    'canonical_workspaces', pg_catalog.jsonb_build_object(
      'acl', workspaces.relacl, 'rls', workspaces.relrowsecurity,
      'force_rls', workspaces.relforcerowsecurity),
    'merchants', pg_catalog.jsonb_build_object(
      'acl', merchants.relacl,
      'service_update', pg_catalog.has_table_privilege('service_role',merchants.oid,'UPDATE'))
  ) AS manifest
  FROM objects o
  JOIN pg_catalog.pg_proc rpc ON rpc.oid=o.rpc_oid
  JOIN pg_catalog.pg_proc guard ON guard.oid=o.guard_oid
  JOIN pg_catalog.pg_class reviews ON reviews.oid=o.review_oid
  JOIN pg_catalog.pg_class events ON events.oid='public.merchant_compliance_events'::regclass
  JOIN pg_catalog.pg_class profiles ON profiles.oid='public.merchant_compliance_profiles'::regclass
  JOIN pg_catalog.pg_class workspaces ON workspaces.oid='public.merchant_canonical_workspaces'::regclass
  JOIN pg_catalog.pg_class merchants ON merchants.oid='public.merchants'::regclass
  JOIN pg_catalog.pg_trigger review_trigger ON review_trigger.tgrelid=o.review_oid
    AND review_trigger.tgname='trg_freeze_submitted_plan_review_v1' AND NOT review_trigger.tgisinternal
)
SELECT 'B1_FINGERPRINT|' || pg_catalog.encode(
  pg_catalog.sha256(pg_catalog.convert_to(manifest::text,'UTF8')),'hex')
FROM state;
