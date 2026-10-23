\set ON_ERROR_STOP on

BEGIN READ ONLY;

DO $b1_postflight$
DECLARE
  v_rpc regprocedure := 'public.submit_draft_plan_review_v1(uuid,uuid,bigint,uuid,text,jsonb,text)'::regprocedure;
  v_guard regprocedure := 'public.freeze_submitted_plan_review_v1()'::regprocedure;
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
    OR pg_catalog.has_table_privilege('service_role','public.merchants','UPDATE')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid = 'public.merchant_compliance_reviews'::regclass
        AND t.tgname = 'trg_freeze_submitted_plan_review_v1' AND NOT t.tgisinternal
        AND t.tgenabled = 'O' AND t.tgfoid = v_guard) THEN
    RAISE EXCEPTION 'PHASE2C_STAGING_B1_POSTFLIGHT_FAILED';
  END IF;
END;
$b1_postflight$;

SELECT 'CONTROL|B1_POSTFLIGHT|PASS';

COMMIT;
