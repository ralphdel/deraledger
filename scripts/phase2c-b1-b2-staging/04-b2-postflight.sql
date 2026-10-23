\set ON_ERROR_STOP on

BEGIN READ ONLY;

DO $b2_postflight$
DECLARE
  v_signature text;
  v_proc record;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.request_draft_plan_review_correction_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,text,text[],text)',
    'public.resubmit_corrected_draft_plan_review_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,jsonb,text)'
  ] LOOP
    SELECT p.* INTO STRICT v_proc FROM pg_catalog.pg_proc p
    WHERE p.oid = v_signature::regprocedure;
    IF NOT v_proc.prosecdef OR v_proc.proowner <> pg_catalog.to_regrole(current_user)::oid
      OR v_proc.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[]
      OR pg_catalog.has_function_privilege('anon',v_signature,'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated',v_signature,'EXECUTE')
      OR NOT pg_catalog.has_function_privilege('service_role',v_signature,'EXECUTE')
      OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(
        COALESCE(v_proc.proacl,pg_catalog.acldefault('f',v_proc.proowner))) acl
        WHERE acl.privilege_type = 'EXECUTE'
          AND acl.grantee NOT IN (v_proc.proowner,pg_catalog.to_regrole('service_role')::oid)) THEN
      RAISE EXCEPTION 'PHASE2C_STAGING_B2_FUNCTION_SECURITY_FAILED';
    END IF;
  END LOOP;
  IF pg_catalog.has_table_privilege('service_role','public.merchant_compliance_reviews','UPDATE')
    OR pg_catalog.has_table_privilege('service_role','public.merchants','UPDATE')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid = 'public.merchant_compliance_reviews'::regclass
        AND t.tgname = 'trg_freeze_submitted_plan_review_v1' AND NOT t.tgisinternal
        AND t.tgenabled = 'O' AND t.tgfoid = 'public.freeze_submitted_plan_review_v1()'::regprocedure) THEN
    RAISE EXCEPTION 'PHASE2C_STAGING_B2_TABLE_SECURITY_FAILED';
  END IF;
END;
$b2_postflight$;

SELECT 'CONTROL|B2_POSTFLIGHT|PASS';

COMMIT;
