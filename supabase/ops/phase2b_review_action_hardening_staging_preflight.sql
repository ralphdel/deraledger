\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

SELECT CASE
  WHEN to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN 'true'
  ELSE 'false'
END AS ledger_exists \gset

SELECT CASE
  WHEN to_regclass('public.solo_plus_cases') IS NOT NULL
   AND to_regclass('public.solo_plus_case_requirements') IS NOT NULL
   AND to_regclass('public.solo_plus_case_events') IS NOT NULL
   AND to_regclass('public.payment_records') IS NOT NULL
  THEN 'true'
  ELSE 'false'
END AS prerequisites_exist \gset

\if :ledger_exists
  \if :prerequisites_exist
WITH
expected AS (
  SELECT
    '((request_idempotency_key IS NOT NULL) AND (event_type = ANY (ARRAY[''case_review_requested_more_information''::text, ''case_approved''::text, ''case_rejected''::text, ''case_reopened''::text])))'::TEXT AS predicate_text
),
same_name_object AS (
  SELECT c.oid, c.relkind::TEXT AS relkind
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'idx_solo_plus_case_events_review_request_intent'
),
index_state AS (
  SELECT
    i.indisunique,
    i.indisvalid,
    i.indisready,
    i.indislive,
    i.indnkeyatts,
    i.indnatts,
    i.indexprs IS NULL AS has_no_expressions,
    am.amname,
    table_namespace.nspname AS table_schema,
    table_class.relname AS table_name,
    ARRAY(
      SELECT attribute.attname::TEXT
      FROM unnest(i.indkey::SMALLINT[]) WITH ORDINALITY AS key_column(attnum, ordinal)
      JOIN pg_catalog.pg_attribute attribute
        ON attribute.attrelid = i.indrelid
       AND attribute.attnum = key_column.attnum
      WHERE key_column.ordinal <= i.indnkeyatts
      ORDER BY key_column.ordinal
    ) AS key_columns,
    regexp_replace(
      pg_catalog.pg_get_expr(i.indpred, i.indrelid, false),
      '[[:space:]]+',
      ' ',
      'g'
    ) AS predicate_text
  FROM same_name_object named
  JOIN pg_catalog.pg_index i ON i.indexrelid = named.oid
  JOIN pg_catalog.pg_class index_class ON index_class.oid = i.indexrelid
  JOIN pg_catalog.pg_class table_class ON table_class.oid = i.indrelid
  JOIN pg_catalog.pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
  JOIN pg_catalog.pg_am am ON am.oid = index_class.relam
),
index_check AS (
  SELECT
    NOT EXISTS (SELECT 1 FROM same_name_object) AS is_absent,
    COALESCE((
      SELECT
        state.indisunique
        AND state.indisvalid
        AND state.indisready
        AND state.indislive
        AND state.indnkeyatts = 1
        AND state.indnatts = 1
        AND state.has_no_expressions
        AND state.amname = 'btree'
        AND state.table_schema = 'public'
        AND state.table_name = 'solo_plus_case_events'
        AND state.key_columns = ARRAY['request_idempotency_key']::TEXT[]
        AND state.predicate_text = expected.predicate_text
      FROM index_state state
      CROSS JOIN expected
    ), false) AS is_compatible
),
duplicate_state AS (
  SELECT count(*)::BIGINT AS duplicate_key_count
  FROM (
    SELECT request_idempotency_key
    FROM public.solo_plus_case_events
    WHERE request_idempotency_key IS NOT NULL
      AND event_type IN (
        'case_review_requested_more_information',
        'case_approved',
        'case_rejected',
        'case_reopened'
      )
    GROUP BY request_idempotency_key
    HAVING count(*) > 1
  ) duplicates
),
rpc_state AS (
  SELECT
    count(*) FILTER (
      WHERE pg_catalog.oidvectortypes(p.proargtypes) = 'uuid, bigint, text, text, uuid, text, text'
    )::INTEGER AS exact_signature_count,
    count(*)::INTEGER AS overload_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'review_solo_plus_case_v1'
),
exact_rpc AS (
  SELECT p.oid, p.proacl, p.proowner
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'review_solo_plus_case_v1'
    AND pg_catalog.oidvectortypes(p.proargtypes) = 'uuid, bigint, text, text, uuid, text, text'
),
permission_state AS (
  SELECT
    EXISTS (
      SELECT 1
      FROM exact_rpc rpc
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(rpc.proacl, pg_catalog.acldefault('f', rpc.proowner))
      ) acl
      WHERE acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    ) AS public_execute,
    COALESCE((
      SELECT pg_catalog.has_function_privilege(role.oid, rpc.oid, 'EXECUTE')
      FROM pg_catalog.pg_roles role
      CROSS JOIN exact_rpc rpc
      WHERE role.rolname = 'anon'
    ), false) AS anon_execute,
    COALESCE((
      SELECT pg_catalog.has_function_privilege(role.oid, rpc.oid, 'EXECUTE')
      FROM pg_catalog.pg_roles role
      CROSS JOIN exact_rpc rpc
      WHERE role.rolname = 'authenticated'
    ), false) AS authenticated_execute,
    COALESCE((
      SELECT pg_catalog.has_function_privilege(role.oid, rpc.oid, 'EXECUTE')
      FROM pg_catalog.pg_roles role
      CROSS JOIN exact_rpc rpc
      WHERE role.rolname = 'service_role'
    ), false) AS service_role_execute
),
checks AS (
  SELECT
    current_database() = 'postgres' AS database_ok,
    current_user IN ('postgres', 'service_role') AS session_role_ok,
    (
      SELECT count(*) = 3
      FROM pg_catalog.pg_roles
      WHERE rolname IN ('anon', 'authenticated', 'service_role')
    ) AS roles_ok,
    NOT EXISTS (
      SELECT 1
      FROM supabase_migrations.schema_migrations
      WHERE version::TEXT = '20260930000000'
    ) AS migration_not_applied,
    index_check.is_absent AS index_absent,
    index_check.is_compatible AS index_compatible,
    duplicate_state.duplicate_key_count,
    rpc_state.exact_signature_count,
    rpc_state.overload_count,
    permission_state.public_execute,
    permission_state.anon_execute,
    permission_state.authenticated_execute,
    permission_state.service_role_execute,
    (SELECT count(*) FROM public.solo_plus_cases)::BIGINT AS case_count,
    (SELECT count(*) FROM public.solo_plus_case_requirements)::BIGINT AS requirement_count,
    (SELECT count(*) FROM public.solo_plus_case_events)::BIGINT AS event_count,
    (SELECT count(*) FROM public.payment_records)::BIGINT AS payment_count
  FROM index_check
  CROSS JOIN duplicate_state
  CROSS JOIN rpc_state
  CROSS JOIN permission_state
),
evidence AS (
  SELECT output.ordinal, output.line
  FROM checks
  CROSS JOIN LATERAL (
    VALUES
      (10, CASE WHEN checks.database_ok
        THEN 'PASS|SESSION|database|postgres'
        ELSE 'BLOCKED|SESSION|database|unexpected' END),
      (20, CASE WHEN checks.session_role_ok
        THEN 'PASS|SESSION|role|' || current_user
        ELSE 'BLOCKED|SESSION|role|unexpected' END),
      (30, 'PASS|PREREQUISITES|required_tables_present'),
      (40, CASE WHEN checks.roles_ok
        THEN 'PASS|ROLES|required_present'
        ELSE 'BLOCKED|ROLES|required_missing' END),
      (50, CASE WHEN checks.migration_not_applied
        THEN 'PASS|MIGRATION_HISTORY|20260930000000|not_applied'
        ELSE 'BLOCKED|MIGRATION_HISTORY|20260930000000|already_applied' END),
      (60, CASE
        WHEN checks.index_absent THEN 'PASS|INDEX|absent_ready_for_create'
        WHEN checks.index_compatible THEN 'PASS|INDEX|compatible_existing_but_unrecorded'
        ELSE 'BLOCKED|INDEX|same_name_incompatible' END),
      (70, CASE WHEN checks.duplicate_key_count = 0
        THEN 'PASS|IDEMPOTENCY_KEYS|no_duplicates'
        ELSE 'BLOCKED|IDEMPOTENCY_KEYS|duplicates_present' END),
      (80, CASE WHEN checks.exact_signature_count = 1 AND checks.overload_count = 1
        THEN 'PASS|RPC_SIGNATURE|exact'
        ELSE 'BLOCKED|RPC_SIGNATURE|missing_or_unexpected_overload' END),
      (90, 'PASS|RPC_PERMISSIONS|observed|public=' || checks.public_execute::TEXT
        || '|anon=' || checks.anon_execute::TEXT
        || '|authenticated=' || checks.authenticated_execute::TEXT
        || '|service_role=' || checks.service_role_execute::TEXT),
      (100, 'PASS|BUSINESS_ROW_COUNTS|cases=' || checks.case_count::TEXT
        || '|requirements=' || checks.requirement_count::TEXT
        || '|events=' || checks.event_count::TEXT
        || '|payments=' || checks.payment_count::TEXT),
      (110, CASE WHEN checks.database_ok
          AND checks.session_role_ok
          AND checks.roles_ok
          AND checks.migration_not_applied
          AND checks.index_absent
          AND checks.duplicate_key_count = 0
          AND checks.exact_signature_count = 1
          AND checks.overload_count = 1
        THEN 'PASS|DECISION|READY_FOR_STAGING_REVIEW_HARDENING_APPLY'
        ELSE 'BLOCKED|DECISION|STAGING_REVIEW_HARDENING_PREFLIGHT_BLOCKED' END)
  ) output(ordinal, line)
)
SELECT line
FROM evidence
ORDER BY ordinal;
  \else
SELECT 'BLOCKED|PREREQUISITES|required_tables_missing';
SELECT 'BLOCKED|DECISION|STAGING_REVIEW_HARDENING_PREFLIGHT_BLOCKED';
  \endif
\else
SELECT 'BLOCKED|MIGRATION_HISTORY_TABLE|missing';
SELECT 'BLOCKED|DECISION|STAGING_REVIEW_HARDENING_PREFLIGHT_BLOCKED';
\endif

ROLLBACK;
