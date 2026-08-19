-- Read-only SQL Editor postflight for Migration 022.
BEGIN;
SET TRANSACTION READ ONLY;

WITH expected(column_name) AS (
  VALUES
    ('business_street'::text),
    ('business_city'),
    ('business_state'),
    ('business_country')
), relation_state AS (
  SELECT
    to_regclass('public.merchants') AS relation_oid,
    relation.relkind
  FROM (VALUES (1)) AS seed(value)
  LEFT JOIN pg_class relation
    ON relation.oid = to_regclass('public.merchants')
), column_state AS (
  SELECT
    expected.column_name,
    format_type(attribute.atttypid, attribute.atttypmod) AS actual_type,
    attribute.attnotnull AS actual_not_null,
    pg_get_expr(default_value.adbin, default_value.adrelid, true) AS actual_default
  FROM expected
  CROSS JOIN relation_state
  LEFT JOIN pg_attribute attribute
    ON attribute.attrelid = relation_state.relation_oid
   AND attribute.attname = expected.column_name
   AND attribute.attnum > 0
   AND NOT attribute.attisdropped
  LEFT JOIN pg_attrdef default_value
    ON default_value.adrelid = attribute.attrelid
   AND default_value.adnum = attribute.attnum
), security_state AS (
  SELECT
    COALESCE(relation.relrowsecurity, false) AS rls_enabled,
    (SELECT count(*) FROM pg_policy WHERE polrelid = relation.oid) AS policy_count,
    COALESCE(array_to_string(relation.relacl, ', '), '<default privileges>') AS grants
  FROM relation_state
  LEFT JOIN pg_class relation ON relation.oid = relation_state.relation_oid
), checks AS (
  SELECT
    'table.public.merchants'::text AS check_name,
    'table'::text AS object_type,
    'existing ordinary table'::text AS expected,
    CASE
      WHEN relation_oid IS NULL THEN 'missing'
      ELSE format('oid=%s relkind=%s', relation_oid, relkind)
    END AS actual,
    CASE WHEN relation_oid IS NOT NULL AND relkind = 'r' THEN 'PASS' ELSE 'FAIL' END AS status,
    'Migration 022 must preserve the existing merchants table.'::text AS details
  FROM relation_state

  UNION ALL

  SELECT
    'column.public.merchants.' || column_name,
    'column',
    'nullable text; no default',
    CASE
      WHEN actual_type IS NULL THEN 'missing'
      ELSE format(
        'type=%s nullable=%s default=%s',
        actual_type,
        NOT actual_not_null,
        COALESCE(actual_default, '<NULL>')
      )
    END,
    CASE
      WHEN actual_type = 'text' AND NOT actual_not_null AND actual_default IS NULL THEN 'PASS'
      ELSE 'FAIL'
    END,
    'All four address fields must match the nullable text application contract.'
  FROM column_state

  UNION ALL

  SELECT
    'security.public.merchants',
    'rls/policy/grant',
    'observed only; unchanged by Migration 022',
    format('rls=%s policies=%s grants=%s', rls_enabled, policy_count, grants),
    'PASS',
    'Migration 022 does not change existing RLS policies or table grants.'
  FROM security_state
)
SELECT check_name, object_type, expected, actual, status, details
FROM checks
ORDER BY CASE status WHEN 'FAIL' THEN 0 WHEN 'WARN' THEN 1 ELSE 2 END, check_name;

ROLLBACK;
