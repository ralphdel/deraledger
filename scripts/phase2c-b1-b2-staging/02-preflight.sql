\set ON_ERROR_STOP on

BEGIN READ ONLY;
SELECT pg_catalog.set_config('deraledger.phase2c_b1_state', :'b1_state', true) AS preflight_b1_state \gset
SELECT pg_catalog.set_config('deraledger.phase2c_b2_state', :'b2_state', true) AS preflight_b2_state \gset

DO $preflight$
DECLARE
  v_role text;
BEGIN
  IF current_setting('deraledger.phase2c_b1_state') NOT IN ('ABSENT','EXACTLY_INSTALLED')
    OR current_setting('deraledger.phase2c_b2_state') NOT IN ('ABSENT','EXACTLY_INSTALLED')
    OR (current_setting('deraledger.phase2c_b1_state') = 'ABSENT'
      AND current_setting('deraledger.phase2c_b2_state') <> 'ABSENT') THEN
    RAISE EXCEPTION 'PHASE2C_STAGING_OBJECT_STATE_NOT_APPLICABLE';
  END IF;
  IF pg_catalog.to_regclass('public.merchants') IS NULL
    OR pg_catalog.to_regclass('public.workspaces') IS NULL
    OR pg_catalog.to_regclass('public.merchant_canonical_workspaces') IS NULL
    OR pg_catalog.to_regclass('public.merchant_compliance_profiles') IS NULL
    OR pg_catalog.to_regclass('public.merchant_compliance_reviews') IS NULL
    OR pg_catalog.to_regclass('public.merchant_compliance_events') IS NULL THEN
    RAISE EXCEPTION 'PHASE2C_STAGING_PREREQUISITE_MISSING';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('public.merchants'::regclass,'id','uuid'::regtype),
      ('public.merchants'::regclass,'user_id','uuid'::regtype),
      ('public.merchants'::regclass,'subscription_plan','text'::regtype),
      ('public.merchants'::regclass,'is_super_admin','boolean'::regtype),
      ('public.workspaces'::regclass,'id','uuid'::regtype),
      ('public.workspaces'::regclass,'merchant_id','uuid'::regtype),
      ('public.merchant_canonical_workspaces'::regclass,'merchant_id','uuid'::regtype),
      ('public.merchant_canonical_workspaces'::regclass,'workspace_id','uuid'::regtype),
      ('public.merchant_compliance_profiles'::regclass,'id','uuid'::regtype),
      ('public.merchant_compliance_profiles'::regclass,'merchant_id','uuid'::regtype),
      ('public.merchant_compliance_profiles'::regclass,'plan_code','text'::regtype),
      ('public.merchant_compliance_profiles'::regclass,'row_version','bigint'::regtype),
      ('public.merchant_compliance_reviews'::regclass,'id','uuid'::regtype),
      ('public.merchant_compliance_reviews'::regclass,'merchant_id','uuid'::regtype),
      ('public.merchant_compliance_reviews'::regclass,'profile_id','uuid'::regtype),
      ('public.merchant_compliance_reviews'::regclass,'review_type','text'::regtype),
      ('public.merchant_compliance_reviews'::regclass,'target_plan_code','text'::regtype),
      ('public.merchant_compliance_reviews'::regclass,'review_status','text'::regtype),
      ('public.merchant_compliance_reviews'::regclass,'evidence_snapshot','jsonb'::regtype),
      ('public.merchant_compliance_reviews'::regclass,'policy_version','text'::regtype),
      ('public.merchant_compliance_reviews'::regclass,'submitted_at','timestamp with time zone'::regtype),
      ('public.merchant_compliance_reviews'::regclass,'idempotency_key','text'::regtype),
      ('public.merchant_compliance_reviews'::regclass,'decision_reason_code','text'::regtype),
      ('public.merchant_compliance_reviews'::regclass,'reviewed_by','uuid'::regtype),
      ('public.merchant_compliance_reviews'::regclass,'reviewed_at','timestamp with time zone'::regtype),
      ('public.merchant_compliance_reviews'::regclass,'row_version','bigint'::regtype),
      ('public.merchant_compliance_events'::regclass,'id','uuid'::regtype),
      ('public.merchant_compliance_events'::regclass,'merchant_id','uuid'::regtype),
      ('public.merchant_compliance_events'::regclass,'profile_id','uuid'::regtype),
      ('public.merchant_compliance_events'::regclass,'event_type','text'::regtype),
      ('public.merchant_compliance_events'::regclass,'actor_id','uuid'::regtype),
      ('public.merchant_compliance_events'::regclass,'source_id','uuid'::regtype),
      ('public.merchant_compliance_events'::regclass,'idempotency_key','text'::regtype),
      ('public.merchant_compliance_events'::regclass,'metadata','jsonb'::regtype),
      ('public.merchant_compliance_events'::regclass,'resulting_row_version','bigint'::regtype)
    ) expected(table_oid,column_name,type_oid)
    LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = expected.table_oid
      AND a.attname = expected.column_name AND a.attnum > 0 AND NOT a.attisdropped
    WHERE a.atttypid IS DISTINCT FROM expected.type_oid
  ) THEN RAISE EXCEPTION 'PHASE2C_STAGING_COLUMN_PREREQUISITE_INCOMPATIBLE'; END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('public.merchant_compliance_profiles'::regclass,'uq_merchant_compliance_profiles_merchant_id',ARRAY['merchant_id']),
      ('public.merchant_compliance_reviews'::regclass,'uq_merchant_compliance_reviews_idempotency',ARRAY['merchant_id','idempotency_key']),
      ('public.merchant_compliance_events'::regclass,'uq_merchant_compliance_events_idempotency',ARRAY['merchant_id','idempotency_key']),
      ('public.merchant_canonical_workspaces'::regclass,'merchant_canonical_workspaces_pkey',ARRAY['merchant_id']),
      ('public.merchant_canonical_workspaces'::regclass,'merchant_canonical_workspaces_workspace_key',ARRAY['workspace_id'])
    ) expected(table_oid,constraint_name,column_names)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = expected.table_oid AND c.conname = expected.constraint_name
        AND c.contype IN ('p','u') AND c.convalidated AND NOT c.condeferrable
        AND c.conkey = ARRAY(SELECT a.attnum FROM pg_catalog.unnest(expected.column_names)
          WITH ORDINALITY AS wanted(name,ord)
          JOIN pg_catalog.pg_attribute a ON a.attrelid = expected.table_oid
            AND a.attname = wanted.name ORDER BY wanted.ord)
        AND EXISTS (SELECT 1 FROM pg_catalog.pg_index i
          WHERE i.indexrelid = c.conindid AND i.indisvalid AND i.indisunique)
    )
  ) THEN RAISE EXCEPTION 'PHASE2C_STAGING_UNIQUENESS_PREREQUISITE_INCOMPATIBLE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = 'public.merchant_canonical_workspaces'::regclass
        AND c.conname = 'merchant_canonical_workspaces_workspace_owner_fkey'
        AND c.contype = 'f' AND c.convalidated
        AND c.confrelid = 'public.workspaces'::regclass
        AND c.conkey = ARRAY[
          (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = c.conrelid AND attname = 'workspace_id'),
          (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = c.conrelid AND attname = 'merchant_id')]
        AND c.confkey = ARRAY[
          (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = c.confrelid AND attname = 'id'),
          (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = c.confrelid AND attname = 'merchant_id')])
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = 'public.merchant_compliance_profiles'::regclass
        AND c.conname = 'merchant_compliance_profiles_plan_code_check'
        AND c.contype = 'c' AND c.convalidated
        AND pg_catalog.pg_get_constraintdef(c.oid) ~ 'starter'
        AND pg_catalog.pg_get_constraintdef(c.oid) ~ 'solo_lite'
        AND pg_catalog.pg_get_constraintdef(c.oid) ~ 'solo_plus'
        AND pg_catalog.pg_get_constraintdef(c.oid) ~ 'business')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = 'public.merchant_compliance_reviews'::regclass
        AND c.conname = 'merchant_compliance_reviews_type_plan_check'
        AND c.contype = 'c' AND c.convalidated
        AND pg_catalog.pg_get_constraintdef(c.oid) ~ 'solo_lite'
        AND pg_catalog.pg_get_constraintdef(c.oid) ~ 'business_kyb'
        AND pg_catalog.pg_get_constraintdef(c.oid) ~ 'business')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = 'public.merchant_compliance_reviews'::regclass
        AND c.conname = 'merchant_compliance_reviews_status_check'
        AND c.contype = 'c' AND c.convalidated
        AND pg_catalog.pg_get_constraintdef(c.oid) ~ 'draft'
        AND pg_catalog.pg_get_constraintdef(c.oid) ~ 'pending'
        AND pg_catalog.pg_get_constraintdef(c.oid) ~ 'approved'
        AND pg_catalog.pg_get_constraintdef(c.oid) ~ 'rejected'
        AND pg_catalog.pg_get_constraintdef(c.oid) ~ 'needs_attention'
        AND pg_catalog.pg_get_constraintdef(c.oid) ~ 'cancelled') THEN
    RAISE EXCEPTION 'PHASE2C_STAGING_PLAN_STATUS_CONSTRAINT_INCOMPATIBLE';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF pg_catalog.to_regrole(v_role) IS NULL THEN
      RAISE EXCEPTION 'PHASE2C_STAGING_ROLE_MISSING:%', v_role;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN
      ('public.merchant_compliance_profiles'::regclass,'public.merchant_compliance_reviews'::regclass,
       'public.merchant_compliance_events'::regclass) AND (NOT relrowsecurity OR relforcerowsecurity))
    OR pg_catalog.has_table_privilege('anon','public.merchant_compliance_reviews','INSERT')
    OR pg_catalog.has_table_privilege('anon','public.merchant_compliance_reviews','UPDATE')
    OR pg_catalog.has_table_privilege('authenticated','public.merchant_compliance_reviews','INSERT')
    OR pg_catalog.has_table_privilege('authenticated','public.merchant_compliance_reviews','UPDATE')
    OR pg_catalog.has_table_privilege('anon','public.merchant_compliance_events','INSERT')
    OR pg_catalog.has_table_privilege('authenticated','public.merchant_compliance_events','INSERT')
    OR NOT pg_catalog.has_table_privilege('service_role','public.merchant_compliance_reviews','SELECT')
    OR NOT pg_catalog.has_table_privilege('service_role','public.merchant_compliance_reviews','INSERT')
    OR NOT pg_catalog.has_table_privilege('service_role','public.merchant_compliance_events','SELECT')
    OR NOT pg_catalog.has_table_privilege('service_role','public.merchant_compliance_events','INSERT')
    OR NOT pg_catalog.has_table_privilege('service_role','public.merchants','SELECT')
    OR NOT pg_catalog.has_table_privilege('service_role','public.merchant_compliance_profiles','SELECT')
    OR NOT pg_catalog.has_table_privilege('service_role','public.merchant_compliance_profiles','UPDATE')
    OR NOT pg_catalog.has_table_privilege('service_role','public.merchant_canonical_workspaces','SELECT')
    OR pg_catalog.has_table_privilege('service_role','public.merchants','UPDATE') THEN
    RAISE EXCEPTION 'PHASE2C_STAGING_TABLE_SECURITY_INCOMPATIBLE';
  END IF;
  IF (current_setting('deraledger.phase2c_b1_state') = 'ABSENT') IS DISTINCT FROM
      pg_catalog.has_table_privilege('service_role','public.merchant_compliance_reviews','UPDATE') THEN
    RAISE EXCEPTION 'PHASE2C_STAGING_REVIEW_UPDATE_POSTURE_INCOMPATIBLE';
  END IF;
  IF current_user IN ('anon','authenticated','service_role')
    OR NOT pg_catalog.has_table_privilege(current_user,'public.merchants','SELECT')
    OR NOT pg_catalog.has_table_privilege(current_user,'public.merchants','UPDATE')
    OR NOT pg_catalog.has_table_privilege(current_user,'public.merchant_canonical_workspaces','SELECT')
    OR NOT pg_catalog.has_table_privilege(current_user,'public.merchant_compliance_profiles','SELECT')
    OR NOT pg_catalog.has_table_privilege(current_user,'public.merchant_compliance_profiles','UPDATE')
    OR NOT pg_catalog.has_table_privilege(current_user,'public.merchant_compliance_reviews','SELECT')
    OR NOT pg_catalog.has_table_privilege(current_user,'public.merchant_compliance_reviews','INSERT')
    OR NOT pg_catalog.has_table_privilege(current_user,'public.merchant_compliance_reviews','UPDATE')
    OR NOT pg_catalog.has_table_privilege(current_user,'public.merchant_compliance_events','SELECT')
    OR NOT pg_catalog.has_table_privilege(current_user,'public.merchant_compliance_events','INSERT')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = current_user
      AND (r.rolsuper OR r.rolbypassrls OR NOT EXISTS (
        SELECT 1 FROM (VALUES ('public.merchants'::regclass),
          ('public.merchant_canonical_workspaces'::regclass),('public.merchant_compliance_profiles'::regclass),
          ('public.merchant_compliance_reviews'::regclass),('public.merchant_compliance_events'::regclass)) target(oid)
        JOIN pg_catalog.pg_class c ON c.oid = target.oid
        WHERE c.relowner <> r.oid OR c.relforcerowsecurity))) THEN
    RAISE EXCEPTION 'PHASE2C_STAGING_MIGRATION_OWNER_INCOMPATIBLE';
  END IF;
  IF current_setting('deraledger.phase2c_b1_state') = 'ABSENT' AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid = 'public.merchant_compliance_reviews'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'PHASE2C_STAGING_B1_TRIGGER_PREREQUISITE_INCOMPATIBLE';
  END IF;
  IF current_setting('deraledger.phase2c_b2_state') = 'ABSENT' AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid IN ('public.merchant_compliance_profiles'::regclass,
        'public.merchant_compliance_reviews'::regclass,'public.merchant_compliance_events'::regclass)
        AND NOT tgisinternal AND NOT (tgrelid = 'public.merchant_compliance_reviews'::regclass
          AND tgname = 'trg_freeze_submitted_plan_review_v1')) THEN
    RAISE EXCEPTION 'PHASE2C_STAGING_B2_TRIGGER_PREREQUISITE_INCOMPATIBLE';
  END IF;
END;
$preflight$;

SELECT 'CONTROL|PREFLIGHT|PASS';

COMMIT;
