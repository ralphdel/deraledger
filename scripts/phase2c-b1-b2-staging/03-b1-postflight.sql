\set ON_ERROR_STOP on

BEGIN READ ONLY;
SELECT pg_catalog.set_config('deraledger.phase2c_expected_merchants_acl_fingerprint',
  :'expected_merchants_acl_fingerprint', true) AS b1_expected_merchants_acl_fingerprint \gset

DO $b1_postflight$
DECLARE
  v_rpc regprocedure := 'public.submit_draft_plan_review_v1(uuid,uuid,bigint,uuid,text,jsonb,text)'::regprocedure;
  v_guard regprocedure := 'public.freeze_submitted_plan_review_v1()'::regprocedure;
  v_actual_merchants_acl_fingerprint text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_rpc
      AND p.prosecdef AND p.proowner = pg_catalog.to_regrole(current_user)::oid
      AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[])
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_guard
      AND NOT p.prosecdef AND p.proowner = pg_catalog.to_regrole(current_user)::oid
      AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[])
    OR pg_catalog.has_function_privilege('anon',v_rpc,'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated',v_rpc,'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role',v_rpc,'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role',v_guard,'EXECUTE')
    OR pg_catalog.has_table_privilege('service_role','public.merchant_compliance_reviews','UPDATE')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid = 'public.merchant_compliance_reviews'::regclass
        AND t.tgname = 'trg_freeze_submitted_plan_review_v1' AND NOT t.tgisinternal
        AND t.tgenabled = 'O' AND t.tgfoid = v_guard) THEN
    RAISE EXCEPTION 'PHASE2C_STAGING_B1_POSTFLIGHT_FAILED';
  END IF;
  WITH normalized_acl AS (
    SELECT pg_catalog.pg_get_userbyid(c.relowner) AS owner_name,
      pg_catalog.format('%s:%s:%s:%s',
        CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
        pg_catalog.pg_get_userbyid(acl.grantor), acl.privilege_type, acl.is_grantable::text) AS acl_item
    FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl
    WHERE c.oid = 'public.merchants'::regclass
  )
  SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'owner=' || pg_catalog.min(owner_name) || ';acl=' ||
      pg_catalog.string_agg(acl_item,',' ORDER BY acl_item), 'UTF8')), 'hex')
  INTO v_actual_merchants_acl_fingerprint
  FROM normalized_acl;
  IF current_setting('deraledger.phase2c_expected_merchants_acl_fingerprint') !~ '^[0-9a-f]{64}$'
    OR v_actual_merchants_acl_fingerprint IS DISTINCT FROM
      current_setting('deraledger.phase2c_expected_merchants_acl_fingerprint') THEN
    RAISE EXCEPTION 'PHASE2C_STAGING_MERCHANTS_ACL_CHANGED';
  END IF;
  PERFORM pg_catalog.set_config('deraledger.phase2c_actual_merchants_acl_fingerprint',
    v_actual_merchants_acl_fingerprint, true);
END;
$b1_postflight$;

SELECT 'CONTROL|MERCHANTS_ACL_B1_POSTFLIGHT|fingerprint=' ||
  current_setting('deraledger.phase2c_actual_merchants_acl_fingerprint');
SELECT 'CONTROL|B1_POSTFLIGHT|PASS';

COMMIT;
