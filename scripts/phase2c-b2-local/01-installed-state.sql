\set ON_ERROR_STOP on
DO $postflight$
DECLARE v_signature text; v_proc record;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.request_draft_plan_review_correction_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,text,text[],text)',
    'public.resubmit_corrected_draft_plan_review_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,jsonb,text)'
  ] LOOP
    SELECT p.* INTO STRICT v_proc FROM pg_catalog.pg_proc p
    WHERE p.oid=pg_catalog.to_regprocedure(v_signature);
    IF NOT v_proc.prosecdef OR v_proc.proowner<>pg_catalog.to_regrole(current_user)::oid
      OR v_proc.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[]
      OR has_function_privilege('anon',v_signature,'EXECUTE')
      OR has_function_privilege('authenticated',v_signature,'EXECUTE')
      OR NOT has_function_privilege('service_role',v_signature,'EXECUTE')
      OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(
        COALESCE(v_proc.proacl,pg_catalog.acldefault('f',v_proc.proowner))) acl
        WHERE acl.privilege_type='EXECUTE'
          AND acl.grantee NOT IN (v_proc.proowner,pg_catalog.to_regrole('service_role')::oid)) THEN
      RAISE EXCEPTION 'B2_POSTFLIGHT_FUNCTION_SECURITY';
    END IF;
  END LOOP;
  IF has_table_privilege('service_role','public.merchant_compliance_reviews','UPDATE')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid='public.merchant_compliance_reviews'::regclass
        AND tgname='trg_freeze_submitted_plan_review_v1' AND tgenabled='O' AND NOT tgisinternal)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class
      WHERE oid IN ('public.merchant_compliance_profiles'::regclass,
        'public.merchant_compliance_reviews'::regclass,'public.merchant_compliance_events'::regclass)
        AND (NOT relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'B2_POSTFLIGHT_TABLE_SECURITY';
  END IF;
END;
$postflight$;
-- Structural only: no review/profile data enters the installed-state digest.
SELECT 'CONTROL|'||pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
  (SELECT pg_catalog.string_agg(
    pg_catalog.pg_get_functiondef(p.oid)||'|'||p.proowner::text||'|'||
    COALESCE(p.proacl::text,'NULL')||'|'||COALESCE(p.proconfig::text,'NULL'),E'\n' ORDER BY p.proname)
   FROM pg_catalog.pg_proc p WHERE p.oid IN (
     'public.request_draft_plan_review_correction_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,text,text[],text)'::regprocedure,
     'public.resubmit_corrected_draft_plan_review_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,jsonb,text)'::regprocedure,
     'public.submit_draft_plan_review_v1(uuid,uuid,bigint,uuid,text,jsonb,text)'::regprocedure,
     'public.freeze_submitted_plan_review_v1()'::regprocedure))||'|'||
  (SELECT pg_catalog.string_agg(c.oid::text||'|'||c.relowner::text||'|'||
    c.relrowsecurity::text||'|'||c.relforcerowsecurity::text||'|'||
    COALESCE(c.relacl::text,'NULL'),E'\n' ORDER BY c.oid)
   FROM pg_catalog.pg_class c WHERE c.oid IN (
     'public.merchant_compliance_profiles'::regclass,'public.merchant_compliance_reviews'::regclass,
     'public.merchant_compliance_events'::regclass))||'|'||
  (SELECT pg_catalog.pg_get_triggerdef(t.oid)||'|'||t.tgenabled::text FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid='public.merchant_compliance_reviews'::regclass
     AND t.tgname='trg_freeze_submitted_plan_review_v1'),'UTF8')),'hex');
