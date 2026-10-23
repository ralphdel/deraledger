\set ON_ERROR_STOP on

BEGIN READ ONLY;

WITH expected AS (
  SELECT
    pg_catalog.to_regprocedure('public.submit_draft_plan_review_v1(uuid,uuid,bigint,uuid,text,jsonb,text)') AS b1_rpc,
    pg_catalog.to_regprocedure('public.freeze_submitted_plan_review_v1()') AS b1_guard,
    pg_catalog.to_regprocedure('public.request_draft_plan_review_correction_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,text,text[],text)') AS b2_rmi,
    pg_catalog.to_regprocedure('public.resubmit_corrected_draft_plan_review_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,jsonb,text)') AS b2_resubmit
), counts AS (
  SELECT
    count(*) FILTER (WHERE p.proname IN ('submit_draft_plan_review_v1','freeze_submitted_plan_review_v1')) AS b1_named,
    count(*) FILTER (WHERE p.proname IN ('request_draft_plan_review_correction_v1','resubmit_corrected_draft_plan_review_v1')) AS b2_named
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
), exact AS (
  SELECT e.*, c.*,
    (e.b1_rpc IS NOT NULL AND e.b1_guard IS NOT NULL
      AND c.b1_named = 2
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid = e.b1_rpc AND p.prosecdef AND p.proowner = pg_catalog.to_regrole(current_user)::oid
          AND p.prolang = (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
          AND p.prorettype = 'jsonb'::regtype AND p.prokind = 'f' AND p.provolatile = 'v'
          AND p.proparallel = 'u' AND NOT p.proisstrict AND NOT p.proleakproof
          AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]
          AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
            pg_catalog.replace(p.prosrc, pg_catalog.chr(13), ''), 'UTF8')), 'hex')
            = '409afc2d25dbeb698de5bfbfba65c64860e75d570a1d7499fb8c9710f9fd40cd'
          AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
          AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.aclexplode(
              COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
            WHERE acl.privilege_type = 'EXECUTE'
              AND acl.grantee NOT IN (p.proowner, pg_catalog.to_regrole('service_role')::oid)
          )
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid = e.b1_guard AND NOT p.prosecdef
          AND p.proowner = pg_catalog.to_regrole(current_user)::oid
          AND p.prolang = (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
          AND p.prorettype = 'trigger'::regtype AND p.prokind = 'f' AND p.provolatile = 'v'
          AND p.proparallel = 'u' AND NOT p.proisstrict AND NOT p.proleakproof
          AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]
          AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
            pg_catalog.replace(p.prosrc, pg_catalog.chr(13), ''), 'UTF8')), 'hex')
            = '3ab9e2fbeb9d503865b1beedd7cfbe5663bbb34c0ddd289398b53e8e0b11d26f'
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.aclexplode(
              COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
            WHERE acl.privilege_type = 'EXECUTE' AND acl.grantee <> p.proowner
          )
      )
      AND (SELECT count(*) FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = pg_catalog.to_regclass('public.merchant_compliance_reviews')
          AND t.tgname = 'trg_freeze_submitted_plan_review_v1' AND NOT t.tgisinternal) = 1
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = pg_catalog.to_regclass('public.merchant_compliance_reviews')
          AND t.tgname = 'trg_freeze_submitted_plan_review_v1'
          AND NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgtype = 19
          AND t.tgqual IS NULL AND t.tgattr = ''::int2vector AND t.tgfoid = e.b1_guard
      )
      AND (SELECT count(*) FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid IN (pg_catalog.to_regclass('public.merchant_compliance_profiles'),
          pg_catalog.to_regclass('public.merchant_compliance_reviews'),
          pg_catalog.to_regclass('public.merchant_compliance_events')) AND NOT t.tgisinternal) = 1
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
        WHERE c.oid IN (pg_catalog.to_regclass('public.merchant_compliance_profiles'),
          pg_catalog.to_regclass('public.merchant_compliance_reviews'),
          pg_catalog.to_regclass('public.merchant_compliance_events'))
          AND (NOT c.relrowsecurity OR c.relforcerowsecurity))
      AND NOT pg_catalog.has_table_privilege('anon','public.merchant_compliance_reviews','INSERT')
      AND NOT pg_catalog.has_table_privilege('anon','public.merchant_compliance_reviews','UPDATE')
      AND NOT pg_catalog.has_table_privilege('authenticated','public.merchant_compliance_reviews','INSERT')
      AND NOT pg_catalog.has_table_privilege('authenticated','public.merchant_compliance_reviews','UPDATE')
      AND NOT pg_catalog.has_table_privilege('anon','public.merchant_compliance_events','INSERT')
      AND NOT pg_catalog.has_table_privilege('authenticated','public.merchant_compliance_events','INSERT')
      AND NOT pg_catalog.has_table_privilege('service_role','public.merchant_compliance_reviews','UPDATE')
    ) AS b1_exact,
    (e.b2_rmi IS NOT NULL AND e.b2_resubmit IS NOT NULL
      AND c.b2_named = 2
      AND NOT pg_catalog.has_table_privilege('service_role','public.merchant_compliance_reviews','UPDATE')
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid = e.b2_rmi AND p.prosecdef AND p.proowner = pg_catalog.to_regrole(current_user)::oid
          AND p.prolang = (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
          AND p.prorettype = 'jsonb'::regtype AND p.prokind = 'f' AND p.provolatile = 'v'
          AND p.proparallel = 'u' AND NOT p.proisstrict AND NOT p.proleakproof
          AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]
          AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
            pg_catalog.replace(p.prosrc, pg_catalog.chr(13), ''), 'UTF8')), 'hex')
            = '9d3b4e4b0d580287322947471e9e2631674f5cc688d472c631c3cbe295d54569'
          AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
          AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.aclexplode(
              COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
            WHERE acl.privilege_type = 'EXECUTE'
              AND acl.grantee NOT IN (p.proowner, pg_catalog.to_regrole('service_role')::oid)
          )
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid = e.b2_resubmit AND p.prosecdef AND p.proowner = pg_catalog.to_regrole(current_user)::oid
          AND p.prolang = (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
          AND p.prorettype = 'jsonb'::regtype AND p.prokind = 'f' AND p.provolatile = 'v'
          AND p.proparallel = 'u' AND NOT p.proisstrict AND NOT p.proleakproof
          AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]
          AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
            pg_catalog.replace(p.prosrc, pg_catalog.chr(13), ''), 'UTF8')), 'hex')
            = 'b8093b4402828ae6b7b47aebcaf912f12ca65d0b326c37ebb28aecc3f82f0e88'
          AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
          AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.aclexplode(
              COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
            WHERE acl.privilege_type = 'EXECUTE'
              AND acl.grantee NOT IN (p.proowner, pg_catalog.to_regrole('service_role')::oid)
          )
      )
    ) AS b2_exact
  FROM expected e CROSS JOIN counts c
), states AS (
  SELECT
    CASE
      WHEN b1_named = 0 AND b1_rpc IS NULL AND b1_guard IS NULL
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
          WHERE t.tgrelid = pg_catalog.to_regclass('public.merchant_compliance_reviews')
            AND t.tgname = 'trg_freeze_submitted_plan_review_v1' AND NOT t.tgisinternal)
        THEN 'ABSENT'
      WHEN b1_exact THEN 'EXACTLY_INSTALLED'
      WHEN b1_rpc IS NULL OR b1_guard IS NULL
        OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
          WHERE t.tgrelid = pg_catalog.to_regclass('public.merchant_compliance_reviews')
            AND t.tgname = 'trg_freeze_submitted_plan_review_v1' AND NOT t.tgisinternal)
        THEN 'PARTIALLY_INSTALLED'
      ELSE 'INCOMPATIBLE'
    END AS b1_state,
    CASE
      WHEN b2_named = 0 AND b2_rmi IS NULL AND b2_resubmit IS NULL THEN 'ABSENT'
      WHEN b2_exact THEN 'EXACTLY_INSTALLED'
      WHEN b2_rmi IS NULL OR b2_resubmit IS NULL THEN 'PARTIALLY_INSTALLED'
      ELSE 'INCOMPATIBLE'
    END AS b2_state
  FROM exact
)
SELECT 'CONTROL|B1_STATE|' || b1_state FROM states
UNION ALL
SELECT 'CONTROL|B2_STATE|' || b2_state FROM states;

DO $ledger_shape$
BEGIN
  IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'PHASE2C_STAGING_MIGRATION_LEDGER_MISSING';
  END IF;
  IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = 'supabase_migrations.schema_migrations'::regclass
        AND c.contype = 'p' AND c.conkey = ARRAY[(
          SELECT attnum FROM pg_catalog.pg_attribute
          WHERE attrelid = c.conrelid AND attname = 'version'
        )]
    )
    OR EXISTS (
      SELECT 1 FROM (VALUES
        ('version','text'),('statements','ARRAY'),('name','text')
      ) expected(column_name,data_type)
      LEFT JOIN information_schema.columns c
        ON c.table_schema = 'supabase_migrations'
       AND c.table_name = 'schema_migrations'
       AND c.column_name = expected.column_name
      WHERE c.data_type IS DISTINCT FROM expected.data_type
    ) THEN
    RAISE EXCEPTION 'PHASE2C_STAGING_MIGRATION_LEDGER_INCOMPATIBLE';
  END IF;
END;
$ledger_shape$;

SELECT 'CONTROL|LEDGER|b1=' || (
    SELECT CASE WHEN count(*) = 0 THEN 'ABSENT'
      WHEN count(*) = 1 AND pg_catalog.bool_and(name IS NULL OR name = 'phase2c_nonadopted_review_substrate')
        THEN 'RECORDED' ELSE 'INCOMPATIBLE' END
    FROM supabase_migrations.schema_migrations
    WHERE version IN ('20261021000000','20261021000000_phase2c_nonadopted_review_substrate')
  ) || '|b2=' || (
    SELECT CASE WHEN count(*) = 0 THEN 'ABSENT'
      WHEN count(*) = 1 AND pg_catalog.bool_and(name IS NULL OR name = 'phase2c_nonadopted_review_triage_resubmission')
        THEN 'RECORDED' ELSE 'INCOMPATIBLE' END
    FROM supabase_migrations.schema_migrations
    WHERE version IN ('20261022000000','20261022000000_phase2c_nonadopted_review_triage_resubmission')
  );

COMMIT;
