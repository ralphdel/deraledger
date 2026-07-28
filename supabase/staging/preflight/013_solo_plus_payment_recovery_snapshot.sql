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
  table_manifest AS (
    SELECT
      EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'payment_records'
          AND c.relkind = 'r'
      ) AS payment_records_ok,
      EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'solo_plus_cases'
          AND c.relkind = 'r'
      ) AS solo_plus_cases_ok
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
  index_manifest AS (
    SELECT
      to_regclass('public.idx_payment_records_solo_plus_pending_case') IS NOT NULL
        AS pending_case_index_ok,
      to_regclass('public.idx_payment_records_solo_plus_provider_reference') IS NOT NULL
        AS provider_reference_index_ok
  ),
  rpc_manifest AS (
    SELECT
      count(*) FILTER (
        WHERE p.proname = 'recover_solo_plus_payment_attempt_v1'
      ) AS overload_count,
      count(*) FILTER (
        WHERE p.proname = 'recover_solo_plus_payment_attempt_v1'
          AND oidvectortypes(p.proargtypes) =
            'uuid, uuid, uuid, text, text, text, text, text'
      ) AS exact_count,
      max(
        CASE
          WHEN oidvectortypes(p.proargtypes) =
            'uuid, uuid, uuid, text, text, text, text, text'
          THEN pg_get_function_result(p.oid)
        END
      ) AS return_type,
      max(
        CASE
          WHEN oidvectortypes(p.proargtypes) =
            'uuid, uuid, uuid, text, text, text, text, text'
          THEN CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END
        END
      ) AS security_mode
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'recover_solo_plus_payment_attempt_v1'
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
      WHEN payment_records_ok AND solo_plus_cases_ok THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    'prerequisite_tables' AS check_name,
    format(
      'payment_records_ok=%s solo_plus_cases_ok=%s',
      payment_records_ok,
      solo_plus_cases_ok
    ) AS details
  FROM table_manifest

  UNION ALL

  SELECT
    CASE
      WHEN payment_case_fk_ok
        AND payment_provider_reference_ok
        AND payment_metadata_ok
        AND payment_status_ok
        AND payment_method_ok
        AND provider_name_ok
        AND case_payment_record_ok
        AND case_payment_provider_ok
        AND case_payment_reference_ok
        AND case_row_version_ok
      THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    'prerequisite_columns' AS check_name,
    format(
      'payment_case_fk_ok=%s payment_provider_reference_ok=%s payment_metadata_ok=%s payment_status_ok=%s payment_method_ok=%s provider_name_ok=%s case_payment_record_ok=%s case_payment_provider_ok=%s case_payment_reference_ok=%s case_row_version_ok=%s',
      payment_case_fk_ok,
      payment_provider_reference_ok,
      payment_metadata_ok,
      payment_status_ok,
      payment_method_ok,
      provider_name_ok,
      case_payment_record_ok,
      case_payment_provider_ok,
      case_payment_reference_ok,
      case_row_version_ok
    ) AS details
  FROM column_manifest

  UNION ALL

  SELECT
    CASE
      WHEN pending_case_index_ok AND provider_reference_index_ok THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    'prerequisite_indexes' AS check_name,
    format(
      'pending_case_index_ok=%s provider_reference_index_ok=%s',
      pending_case_index_ok,
      provider_reference_index_ok
    ) AS details
  FROM index_manifest

  UNION ALL

  SELECT
    CASE
      WHEN overload_count = 0 THEN 'PASS'
      WHEN overload_count = 1
        AND exact_count = 1
        AND return_type = 'jsonb'
        AND security_mode = 'DEFINER'
      THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    'existing_rpc_shape' AS check_name,
    format(
      'overload_count=%s exact_count=%s return_type=%s security_mode=%s',
      overload_count,
      exact_count,
      COALESCE(return_type, 'absent'),
      COALESCE(security_mode, 'absent')
    ) AS details
  FROM rpc_manifest

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
    'live_payment_fixture_snapshot' AS check_name,
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
