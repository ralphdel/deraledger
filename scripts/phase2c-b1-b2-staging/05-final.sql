\set ON_ERROR_STOP on

BEGIN READ ONLY;
SELECT pg_catalog.set_config('deraledger.phase2c_expected_merchants_acl_fingerprint',
  :'expected_merchants_acl_fingerprint', true) AS final_expected_merchants_acl_fingerprint \gset

DO $final$
DECLARE
  v_proc record;
  v_actual_merchants_acl_fingerprint text;
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
$final$;

SELECT 'CONTROL|MERCHANTS_ACL_FINAL|fingerprint=' ||
  current_setting('deraledger.phase2c_actual_merchants_acl_fingerprint');
SELECT 'CONTROL|FINAL|PASS';

COMMIT;
