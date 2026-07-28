BEGIN READ ONLY;

SELECT
  'PASS' AS status,
  'database_identity' AS check_name,
  format(
    'db=%s user=%s version=%s search_path=%s',
    current_database(),
    current_user,
    regexp_replace(version(), '\s+', ' ', 'g'),
    current_setting('search_path')
  ) AS details;

WITH
  function_target AS (
    SELECT to_regprocedure(
      'public.recover_solo_plus_payment_attempt_v1(uuid,uuid,uuid,text,text,text,text,text)'
    )::oid AS exact_oid
  ),
  rpc_details AS (
    SELECT
      count(*) FILTER (
        WHERE oidvectortypes(p.proargtypes) =
          'uuid, uuid, uuid, text, text, text, text, text'
      ) AS exact_count,
      count(*) AS overload_count,
      max(pg_get_function_result(p.oid)) FILTER (
        WHERE oidvectortypes(p.proargtypes) =
          'uuid, uuid, uuid, text, text, text, text, text'
      ) AS return_type,
      max(CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END) FILTER (
        WHERE oidvectortypes(p.proargtypes) =
          'uuid, uuid, uuid, text, text, text, text, text'
      ) AS security_mode,
      max(pg_get_userbyid(p.proowner)) FILTER (
        WHERE oidvectortypes(p.proargtypes) =
          'uuid, uuid, uuid, text, text, text, text, text'
      ) AS owner_name,
      max(md5(pg_get_functiondef(p.oid))) FILTER (
        WHERE oidvectortypes(p.proargtypes) =
          'uuid, uuid, uuid, text, text, text, text, text'
      ) AS definition_hash,
      bool_or(
        CASE
          WHEN p.proconfig IS NULL THEN false
          ELSE array_to_string(p.proconfig, ' ') ILIKE '%search_path=public, pg_temp%'
        END
      ) FILTER (
        WHERE oidvectortypes(p.proargtypes) =
          'uuid, uuid, uuid, text, text, text, text, text'
      ) AS search_path_ok
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'recover_solo_plus_payment_attempt_v1'
  ),
  execute_manifest AS (
    SELECT
      has_function_privilege('service_role', exact_oid, 'EXECUTE') AS service_role_execute,
      has_function_privilege('anon', exact_oid, 'EXECUTE') AS anon_execute,
      has_function_privilege('authenticated', exact_oid, 'EXECUTE') AS authenticated_execute,
      EXISTS (
        SELECT 1
        FROM pg_proc p
        LEFT JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl ON TRUE
        WHERE p.oid = exact_oid
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
          AND acl.is_grantable = false
      ) AS public_execute
    FROM function_target
  ),
  index_manifest AS (
    SELECT
      to_regclass('public.idx_payment_records_solo_plus_pending_case') IS NOT NULL
        AS pending_case_index_ok,
      to_regclass('public.idx_payment_records_solo_plus_provider_reference') IS NOT NULL
        AS provider_reference_index_ok
  ),
  table_security AS (
    SELECT
      NOT EXISTS (
        SELECT 1
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'payment_records'
          AND grantee IN ('PUBLIC', 'anon')
          AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
      ) AS browser_write_clear
  ),
  column_manifest AS (
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payment_records'
          AND column_name = 'solo_plus_case_id'
          AND udt_name = 'uuid'
      ) AS payment_case_fk_ok,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payment_records'
          AND column_name = 'provider_reference'
          AND udt_name IN ('text', 'varchar')
      ) AS payment_provider_reference_ok,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payment_records'
          AND column_name = 'metadata'
          AND udt_name = 'jsonb'
      ) AS payment_metadata_ok,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payment_records'
          AND column_name = 'payment_status'
          AND udt_name IN ('text', 'varchar')
      ) AS payment_status_ok,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payment_records'
          AND column_name = 'payment_method'
          AND udt_name IN ('text', 'varchar')
      ) AS payment_method_ok,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payment_records'
          AND column_name = 'provider_name'
          AND udt_name IN ('text', 'varchar')
      ) AS provider_name_ok,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'solo_plus_cases'
          AND column_name = 'payment_record_id'
          AND udt_name = 'uuid'
      ) AS case_payment_record_ok,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'solo_plus_cases'
          AND column_name = 'payment_provider'
          AND udt_name IN ('text', 'varchar')
      ) AS case_payment_provider_ok,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'solo_plus_cases'
          AND column_name = 'payment_reference'
          AND udt_name IN ('text', 'varchar')
      ) AS case_payment_reference_ok,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'solo_plus_cases'
          AND column_name = 'row_version'
          AND udt_name = 'int4'
      ) AS case_row_version_ok
  ),
  fixture_rows AS (
    SELECT
      (
        cm.case_payment_record_ok
        AND cm.case_payment_provider_ok
        AND cm.case_payment_reference_ok
        AND cm.case_row_version_ok
      ) AS case_fixture_schema_ready,
      (
        cm.payment_case_fk_ok
        AND cm.payment_provider_reference_ok
        AND cm.payment_metadata_ok
        AND cm.payment_status_ok
        AND cm.payment_method_ok
        AND cm.provider_name_ok
      ) AS payment_fixture_schema_ready,
      (
        SELECT to_jsonb(c)
        FROM public.solo_plus_cases c
        WHERE c.id = '8b32fb1c-144d-4013-a80c-6a8e146754f9'::uuid
      ) AS case_data,
      (
        SELECT to_jsonb(p)
        FROM public.payment_records p
        WHERE p.id = '425fa617-d714-4d1c-9db8-4f46cb98bff1'::uuid
      ) AS payment_data,
      (
        SELECT count(*)
        FROM public.payment_records p
        WHERE to_jsonb(p) ->> 'solo_plus_case_id' = '8b32fb1c-144d-4013-a80c-6a8e146754f9'
          AND to_jsonb(p) ->> 'payment_status' = 'pending'
      ) AS pending_case_payment_count
    FROM column_manifest cm
  ),
  fixture_checks AS (
    SELECT
      case_fixture_schema_ready,
      payment_fixture_schema_ready,
      (
        case_data IS NOT NULL
          AND case_data ->> 'merchant_id' = '11111111-1111-1111-1111-111111111111'
          AND case_data ->> 'flow_origin' = 'upgrade'
          AND case_data ->> 'source_plan' = 'solo_lite'
          AND case_data ->> 'target_plan' = 'solo_plus'
          AND case_data ->> 'case_status' = 'awaiting_payment'
          AND case_data ->> 'payment_status' = 'pending'
          AND case_data ->> 'refund_status' = 'none'
          AND case_data ->> 'row_version' = '1'
      ) AS case_fixture_ok,
      (
        payment_data IS NOT NULL
          AND payment_data ->> 'merchant_id' = '11111111-1111-1111-1111-111111111111'
          AND payment_data ->> 'solo_plus_case_id' = '8b32fb1c-144d-4013-a80c-6a8e146754f9'
          AND payment_data ->> 'payment_status' = 'pending'
          AND payment_data ->> 'processing_status' = 'pending_payment'
          AND payment_data ->> 'account_setup_status' = 'pending_payment'
          AND payment_data ->> 'payment_method' = 'card'
          AND payment_data ->> 'provider_name' = 'paystack'
          AND payment_data ->> 'internal_reference' = 'SPL-UPG-425FA617D7144D1C9DB84F46CB98BFF1'
          AND payment_data ->> 'provider_reference' = 'SPL-UPG-425FA617D7144D1C9DB84F46CB98BFF1'
      ) AS payment_fixture_ok,
      pending_case_payment_count,
      CASE
        WHEN case_data IS NULL OR payment_data IS NULL THEN 'missing'
        WHEN pending_case_payment_count <> 1 THEN 'conflicting'
        WHEN payment_data ->> 'merchant_id' IS DISTINCT FROM case_data ->> 'merchant_id' THEN 'conflicting'
        WHEN payment_data ->> 'solo_plus_case_id' IS DISTINCT FROM '8b32fb1c-144d-4013-a80c-6a8e146754f9' THEN 'conflicting'
        WHEN case_data ->> 'payment_record_id' = '425fa617-d714-4d1c-9db8-4f46cb98bff1'
          AND case_data ->> 'payment_provider' = 'paystack'
          AND case_data ->> 'payment_reference' = 'SPL-UPG-425FA617D7144D1C9DB84F46CB98BFF1'
        THEN 'linked'
        WHEN case_data ->> 'payment_record_id' IS NULL
          AND case_data ->> 'payment_provider' IS NULL
          AND case_data ->> 'payment_reference' IS NULL
        THEN 'legacy_unlinked'
        ELSE 'conflicting'
      END AS case_link_state
    FROM fixture_rows
  )
SELECT *
FROM (
  SELECT
    CASE
      WHEN exact_oid IS NOT NULL
        AND exact_count = 1
        AND overload_count = 1
        AND return_type = 'jsonb'
        AND security_mode = 'DEFINER'
        AND search_path_ok
      THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    'recover_solo_plus_payment_attempt_v1_signature' AS check_name,
    format(
      'exact_exists=%s exact_count=%s overload_count=%s return_type=%s security_mode=%s owner=%s search_path_ok=%s',
      exact_oid IS NOT NULL,
      exact_count,
      overload_count,
      COALESCE(return_type, 'absent'),
      COALESCE(security_mode, 'absent'),
      COALESCE(owner_name, 'absent'),
      COALESCE(search_path_ok::text, 'false')
    ) AS details
  FROM function_target
  CROSS JOIN rpc_details

  UNION ALL

  SELECT
    CASE
      WHEN exact_oid IS NOT NULL AND definition_hash IS NOT NULL THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    'recover_solo_plus_payment_attempt_v1_definition_hash' AS check_name,
    format(
      'exact_exists=%s definition_hash=%s',
      exact_oid IS NOT NULL,
      COALESCE(definition_hash, 'absent')
    ) AS details
  FROM function_target
  CROSS JOIN rpc_details

  UNION ALL

  SELECT
    CASE
      WHEN service_role_execute
        AND NOT public_execute
        AND NOT anon_execute
        AND NOT authenticated_execute
      THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    'recover_solo_plus_payment_attempt_v1_execute_privileges' AS check_name,
    format(
      'service_role_execute=%s public_execute=%s anon_execute=%s authenticated_execute=%s',
      service_role_execute,
      public_execute,
      anon_execute,
      authenticated_execute
    ) AS details
  FROM execute_manifest

  UNION ALL

  SELECT
    CASE
      WHEN pending_case_index_ok AND provider_reference_index_ok THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    'payment_record_indexes_preserved' AS check_name,
    format(
      'pending_case_index_ok=%s provider_reference_index_ok=%s',
      pending_case_index_ok,
      provider_reference_index_ok
    ) AS details
  FROM index_manifest

  UNION ALL

  SELECT
    CASE WHEN browser_write_clear THEN 'PASS' ELSE 'FAIL' END AS status,
    'payment_records_browser_write_surface' AS check_name,
    format('browser_write_clear=%s', browser_write_clear) AS details
  FROM table_security

  UNION ALL

  SELECT
    CASE
      WHEN case_fixture_schema_ready
        AND payment_fixture_schema_ready
        AND case_fixture_ok
        AND payment_fixture_ok
        AND pending_case_payment_count = 1
        AND case_link_state IN ('linked', 'legacy_unlinked')
      THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    'live_payment_fixture_unchanged' AS check_name,
    format(
      'case_fixture_schema_ready=%s payment_fixture_schema_ready=%s case_fixture_ok=%s payment_fixture_ok=%s pending_case_payment_count=%s case_link_state=%s',
      case_fixture_schema_ready,
      payment_fixture_schema_ready,
      case_fixture_ok,
      payment_fixture_ok,
      pending_case_payment_count,
      case_link_state
    ) AS details
  FROM fixture_checks
) checks
ORDER BY check_name;

ROLLBACK;
