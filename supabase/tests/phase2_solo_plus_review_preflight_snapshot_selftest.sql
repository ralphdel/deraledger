BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.evaluate_commit9_preflight_statuses(
  p_checks JSONB
)
RETURNS JSONB
LANGUAGE sql
AS $$
  WITH checks AS (
    SELECT
      item ->> 'category' AS category,
      item ->> 'status' AS status
    FROM jsonb_array_elements(p_checks) AS item
  )
  SELECT jsonb_build_object(
    'prerequisite_schema_status',
    CASE
      WHEN EXISTS (SELECT 1 FROM checks WHERE category = 'prerequisite' AND status = 'FAIL') THEN 'FAIL'
      WHEN EXISTS (SELECT 1 FROM checks WHERE category = 'prerequisite' AND status = 'WARN') THEN 'WARN'
      ELSE 'PASS'
    END,
    'security_manifest_status',
    CASE
      WHEN EXISTS (SELECT 1 FROM checks WHERE category = 'security' AND status = 'FAIL') THEN 'FAIL'
      WHEN EXISTS (SELECT 1 FROM checks WHERE category = 'security' AND status = 'WARN') THEN 'WARN'
      ELSE 'PASS'
    END,
    'rpc_status',
    CASE
      WHEN EXISTS (SELECT 1 FROM checks WHERE category = 'rpc' AND status = 'FAIL') THEN 'FAIL'
      WHEN EXISTS (SELECT 1 FROM checks WHERE category = 'rpc' AND status = 'WARN') THEN 'WARN'
      ELSE 'PASS'
    END,
    'overall_preflight_status',
    CASE
      WHEN EXISTS (SELECT 1 FROM checks WHERE status = 'FAIL') THEN 'FAIL'
      WHEN EXISTS (SELECT 1 FROM checks WHERE status = 'WARN') THEN 'WARN'
      ELSE 'PASS'
    END
  );
$$;

DO $$
DECLARE
  v_summary JSONB;
  v_column_detail TEXT;
  v_grant_detail TEXT;
BEGIN
  v_summary := pg_temp.evaluate_commit9_preflight_statuses(
    '[
      {"category":"prerequisite","status":"FAIL"},
      {"category":"security","status":"PASS"},
      {"category":"rpc","status":"PASS"}
    ]'::jsonb
  );
  IF v_summary ->> 'prerequisite_schema_status' <> 'FAIL'
     OR v_summary ->> 'overall_preflight_status' <> 'FAIL' THEN
    RAISE EXCEPTION 'expected failed prerequisite summary to force overall FAIL, received %', v_summary;
  END IF;

  v_summary := pg_temp.evaluate_commit9_preflight_statuses(
    '[
      {"category":"prerequisite","status":"PASS"},
      {"category":"security","status":"FAIL"},
      {"category":"rpc","status":"PASS"}
    ]'::jsonb
  );
  IF v_summary ->> 'security_manifest_status' <> 'FAIL'
     OR v_summary ->> 'overall_preflight_status' <> 'FAIL' THEN
    RAISE EXCEPTION 'expected failed grant/security summary to force overall FAIL, received %', v_summary;
  END IF;

  v_summary := pg_temp.evaluate_commit9_preflight_statuses(
    '[
      {"category":"prerequisite","status":"FAIL"},
      {"category":"security","status":"PASS"},
      {"category":"rpc","status":"WARN"}
    ]'::jsonb
  );
  IF v_summary ->> 'prerequisite_schema_status' <> 'FAIL'
     OR v_summary ->> 'rpc_status' <> 'WARN'
     OR v_summary ->> 'overall_preflight_status' <> 'FAIL' THEN
    RAISE EXCEPTION 'expected missing RPC warning to preserve prerequisite FAIL, received %', v_summary;
  END IF;

  v_summary := pg_temp.evaluate_commit9_preflight_statuses(
    '[
      {"category":"prerequisite","status":"PASS"},
      {"category":"security","status":"FAIL"},
      {"category":"rpc","status":"WARN"},
      {"category":"default_privilege","status":"WARN"}
    ]'::jsonb
  );
  IF v_summary ->> 'overall_preflight_status' <> 'FAIL' THEN
    RAISE EXCEPTION 'expected mixed PASS/WARN/FAIL to resolve to FAIL, received %', v_summary;
  END IF;

  v_summary := pg_temp.evaluate_commit9_preflight_statuses(
    '[
      {"category":"prerequisite","status":"FAIL"},
      {"category":"security","status":"FAIL"},
      {"category":"rpc","status":"WARN"}
    ]'::jsonb
  );
  IF v_summary ->> 'prerequisite_schema_status' <> 'FAIL'
     OR v_summary ->> 'security_manifest_status' <> 'FAIL'
     OR v_summary ->> 'overall_preflight_status' <> 'FAIL' THEN
    RAISE EXCEPTION 'expected simultaneous schema and grant failures to resolve to FAIL, received %', v_summary;
  END IF;

  v_summary := pg_temp.evaluate_commit9_preflight_statuses(
    '[
      {"category":"prerequisite","status":"PASS"},
      {"category":"security","status":"PASS"},
      {"category":"rpc","status":"WARN"},
      {"category":"default_privilege","status":"WARN"}
    ]'::jsonb
  );
  IF v_summary ->> 'overall_preflight_status' <> 'WARN' THEN
    RAISE EXCEPTION 'expected mixed PASS/WARN to resolve to WARN, received %', v_summary;
  END IF;

  v_summary := pg_temp.evaluate_commit9_preflight_statuses(
    '[
      {"category":"prerequisite","status":"PASS"},
      {"category":"security","status":"PASS"},
      {"category":"rpc","status":"PASS"}
    ]'::jsonb
  );
  IF v_summary ->> 'overall_preflight_status' <> 'PASS' THEN
    RAISE EXCEPTION 'expected all PASS to resolve to PASS, received %', v_summary;
  END IF;

  WITH
    expected_columns AS (
      SELECT *
      FROM (
        VALUES
          ('flow_origin', 'text', 'NO', '<none>'),
          ('row_version', 'int4', 'NO', '0'),
          ('payment_currency', 'varchar', 'NO', '''NGN''::character varying'),
          ('refund_status', 'text', 'NO', '''none''::text')
      ) AS t(column_name, expected_type, expected_nullable, expected_default)
    ),
    actual_columns AS (
      SELECT *
      FROM (
        VALUES
          ('row_version', 'text', 'NO', '0'),
          ('payment_currency', 'varchar', 'YES', '''NGN''::character varying'),
          ('refund_status', 'text', 'NO', '''review_required''::text')
      ) AS t(column_name, actual_type, actual_nullable, actual_default)
    ),
    diffs AS (
      SELECT
        e.column_name,
        e.expected_type,
        a.actual_type,
        e.expected_nullable,
        a.actual_nullable,
        e.expected_default,
        COALESCE(a.actual_default, '<none>') AS actual_default,
        a.column_name IS NULL AS is_missing,
        a.column_name IS NOT NULL AND a.actual_type <> e.expected_type AS type_mismatch,
        a.column_name IS NOT NULL AND a.actual_nullable <> e.expected_nullable AS nullability_mismatch,
        a.column_name IS NOT NULL AND COALESCE(a.actual_default, '<none>') <> e.expected_default AS default_mismatch
      FROM expected_columns e
      LEFT JOIN actual_columns a
        ON a.column_name = e.column_name
    )
  SELECT format(
    'classification=UNSAFE_SCHEMA_DRIFT; missing=[%s]; incompatible=[%s]; nullability=[%s]; defaults=[%s]',
    COALESCE((SELECT string_agg(column_name, ',' ORDER BY column_name) FROM diffs WHERE is_missing), ''),
    COALESCE((SELECT string_agg(format('%s:%s/%s', column_name, expected_type, actual_type), ',' ORDER BY column_name) FROM diffs WHERE type_mismatch), ''),
    COALESCE((SELECT string_agg(format('%s:%s/%s', column_name, expected_nullable, actual_nullable), ',' ORDER BY column_name) FROM diffs WHERE nullability_mismatch), ''),
    COALESCE((SELECT string_agg(format('%s:%s/%s', column_name, expected_default, actual_default), ',' ORDER BY column_name) FROM diffs WHERE default_mismatch), '')
  )
  INTO v_column_detail;

  IF v_column_detail NOT LIKE '%missing=[flow_origin]%'
     OR v_column_detail NOT LIKE '%incompatible=[row_version:int4/text]%'
     OR v_column_detail NOT LIKE '%nullability=[payment_currency:NO/YES]%'
     OR v_column_detail NOT LIKE '%defaults=[refund_status:''none''::text/''review_required''::text]%' THEN
    RAISE EXCEPTION 'unexpected compact column drift detail output: %', v_column_detail;
  END IF;

  WITH grant_diffs AS (
    SELECT *
    FROM (
      VALUES
        ('solo_plus_cases', 'PUBLIC', ARRAY[]::text[], ARRAY[]::text[]),
        ('solo_plus_cases', 'anon', ARRAY['DELETE','INSERT','UPDATE']::text[], ARRAY[]::text[]),
        ('solo_plus_cases', 'authenticated', ARRAY['INSERT','UPDATE']::text[], ARRAY['SELECT']::text[])
    ) AS t(table_name, grantee, unexpected_privileges, missing_privileges)
  )
  SELECT format(
    'classification=SAFE_REPAIRABLE_DRIFT; unexpected_public=[%s]; unexpected_anon=[%s]; unexpected_authenticated=[%s]; missing_authenticated=[%s]',
    COALESCE((SELECT array_to_string(unexpected_privileges, ',') FROM grant_diffs WHERE grantee = 'PUBLIC'), ''),
    COALESCE((SELECT array_to_string(unexpected_privileges, ',') FROM grant_diffs WHERE grantee = 'anon'), ''),
    COALESCE((SELECT array_to_string(unexpected_privileges, ',') FROM grant_diffs WHERE grantee = 'authenticated'), ''),
    COALESCE((SELECT array_to_string(missing_privileges, ',') FROM grant_diffs WHERE grantee = 'authenticated'), '')
  )
  INTO v_grant_detail;

  IF v_grant_detail <> 'classification=SAFE_REPAIRABLE_DRIFT; unexpected_public=[]; unexpected_anon=[DELETE,INSERT,UPDATE]; unexpected_authenticated=[INSERT,UPDATE]; missing_authenticated=[SELECT]' THEN
    RAISE EXCEPTION 'unexpected compact grant drift detail output: %', v_grant_detail;
  END IF;
END
$$;

ROLLBACK;
