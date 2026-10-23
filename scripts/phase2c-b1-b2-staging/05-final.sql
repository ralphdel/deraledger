\set ON_ERROR_STOP on

BEGIN READ ONLY;

DO $final$
DECLARE
  v_proc record;
BEGIN
  FOR v_proc IN
    SELECT p.* FROM pg_catalog.pg_proc p WHERE p.oid IN (
      'public.submit_draft_plan_review_v1(uuid,uuid,bigint,uuid,text,jsonb,text)'::regprocedure,
      'public.request_draft_plan_review_correction_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,text,text[],text)'::regprocedure,
      'public.resubmit_corrected_draft_plan_review_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,jsonb,text)'::regprocedure)
  LOOP
    IF v_proc.prosrc !~ '2c-2b-draft-v1'
      OR v_proc.prosrc ~* 'UPDATE[[:space:]]+public[.]merchant_compliance_profiles'
      OR v_proc.prosrc ~* 'UPDATE[[:space:]]+public[.]merchants'
      OR v_proc.prosrc ~* 'UPDATE[[:space:]]+public[.](subscriptions|settlements|limits)'
      OR v_proc.prosrc ~* 'lite_verified|business_verified|live_features_enabled|setup_mode' THEN
      RAISE EXCEPTION 'PHASE2C_STAGING_NONADOPTION_FIREWALL_FAILED';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.oid IN (
      'public.submit_draft_plan_review_v1(uuid,uuid,bigint,uuid,text,jsonb,text)'::regprocedure,
      'public.request_draft_plan_review_correction_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,text,text[],text)'::regprocedure,
      'public.resubmit_corrected_draft_plan_review_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,jsonb,text)'::regprocedure)) <> 3
    OR pg_catalog.has_table_privilege('service_role','public.merchant_compliance_reviews','UPDATE') THEN
    RAISE EXCEPTION 'PHASE2C_STAGING_FINAL_SECURITY_FAILED';
  END IF;
END;
$final$;

SELECT 'CONTROL|FINAL|PASS';

COMMIT;
