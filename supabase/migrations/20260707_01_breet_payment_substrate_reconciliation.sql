BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_table_exists(p_table_name TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_regclass(format('public.%I', p_table_name)) IS NULL THEN
    RAISE EXCEPTION 'Migration A prerequisite missing: public.% does not exist', p_table_name;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_function_exists(
  p_function_name TEXT,
  p_identity_arguments TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = p_function_name
      AND (
        p_identity_arguments IS NULL
        OR pg_get_function_identity_arguments(p.oid) = p_identity_arguments
      )
  )
  INTO v_exists;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'Migration A prerequisite missing: public.% (%) does not exist',
      p_function_name,
      COALESCE(p_identity_arguments, '');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_column_type(
  p_table_name TEXT,
  p_column_name TEXT,
  p_udt_name TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_udt_name TEXT;
BEGIN
  SELECT t.typname
  INTO v_udt_name
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_type t ON t.oid = a.atttypid
  WHERE n.nspname = 'public'
    AND c.relname = p_table_name
    AND a.attname = p_column_name
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_udt_name IS NULL THEN
    RAISE EXCEPTION 'Expected public.%.% to exist before reconciliation', p_table_name, p_column_name;
  END IF;

  IF v_udt_name <> p_udt_name THEN
    RAISE EXCEPTION 'public.%.% has type %, expected %',
      p_table_name,
      p_column_name,
      v_udt_name,
      p_udt_name;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_relation_kind(
  p_table_name TEXT,
  p_expected_kind "char" DEFAULT 'r'
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_relkind "char";
BEGIN
  SELECT c.relkind
  INTO v_relkind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = p_table_name;

  IF v_relkind IS NULL THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=% expected=relation_kind:% actual=missing',
      p_table_name,
      p_expected_kind;
  END IF;

  IF v_relkind <> p_expected_kind THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=% expected=relation_kind:% actual=relation_kind:%',
      p_table_name,
      p_expected_kind,
      v_relkind;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_column_definition(
  p_table_name TEXT,
  p_column_name TEXT,
  p_udt_name TEXT,
  p_not_null BOOLEAN,
  p_default_fragment TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_udt_name TEXT;
  v_not_null BOOLEAN;
  v_default_expr TEXT;
BEGIN
  SELECT
    t.typname,
    a.attnotnull,
    pg_get_expr(d.adbin, d.adrelid)
  INTO
    v_udt_name,
    v_not_null,
    v_default_expr
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_type t ON t.oid = a.atttypid
  LEFT JOIN pg_attrdef d
    ON d.adrelid = a.attrelid
   AND d.adnum = a.attnum
  WHERE n.nspname = 'public'
    AND c.relname = p_table_name
    AND a.attname = p_column_name
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_udt_name IS NULL THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=%.% expected=column actual=missing',
      p_table_name,
      p_column_name;
  END IF;

  IF v_udt_name <> p_udt_name THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=%.% expected=type:% actual=type:%',
      p_table_name,
      p_column_name,
      p_udt_name,
      v_udt_name;
  END IF;

  IF v_not_null IS DISTINCT FROM p_not_null THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=%.% expected=not_null:% actual=not_null:%',
      p_table_name,
      p_column_name,
      p_not_null,
      v_not_null;
  END IF;

  IF p_default_fragment IS NULL THEN
    IF v_default_expr IS NOT NULL THEN
      RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=%.% expected=no default actual=%',
        p_table_name,
        p_column_name,
        v_default_expr;
    END IF;
  ELSIF (
       v_default_expr IS NULL
       OR position(lower(p_default_fragment) in lower(v_default_expr)) = 0
     ) THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=%.% expected=default contains "%" actual=%',
      p_table_name,
      p_column_name,
      p_default_fragment,
      COALESCE(v_default_expr, 'NULL');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.normalize_catalog_sql(p_input TEXT)
RETURNS TEXT
LANGUAGE sql
AS $$
  SELECT trim(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(p_input, '')), '\s+', ' ', 'g'),
        '\(\s+',
        '(',
        'g'
      ),
      '\s+\)',
      ')',
      'g'
    )
  );
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_payment_events_processor_legacy_compatible()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_udt_name TEXT;
  v_not_null BOOLEAN;
  v_default_expr TEXT;
BEGIN
  SELECT
    t.typname,
    a.attnotnull,
    pg_get_expr(d.adbin, d.adrelid)
  INTO
    v_udt_name,
    v_not_null,
    v_default_expr
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_type t ON t.oid = a.atttypid
  LEFT JOIN pg_attrdef d
    ON d.adrelid = a.attrelid
   AND d.adnum = a.attnum
  WHERE n.nspname = 'public'
    AND c.relname = 'payment_events'
    AND a.attname = 'processor'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_udt_name IS NULL THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=payment_events.processor expected=column actual=missing';
  END IF;

  IF v_udt_name <> 'text' THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=payment_events.processor expected=type:text actual=type:%',
      v_udt_name;
  END IF;

  IF v_not_null IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=payment_events.processor expected=not_null:true actual=not_null:%',
      v_not_null;
  END IF;

  IF v_default_expr IS NOT NULL
     AND pg_temp.normalize_catalog_sql(v_default_expr) <> '''paystack''::text' THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=payment_events.processor expected=no default or default ''paystack''::text actual=%',
      v_default_expr;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_primary_key(
  p_table_name TEXT,
  p_expected_columns TEXT[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_actual_columns TEXT[];
BEGIN
  SELECT array_agg(att.attname ORDER BY ord.ordinality)
  INTO v_actual_columns
  FROM pg_constraint con
  CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid
   AND att.attnum = ord.attnum
  WHERE con.conrelid = format('public.%I', p_table_name)::regclass
    AND con.contype = 'p';

  IF v_actual_columns IS NULL THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=% expected=primary key % actual=missing',
      p_table_name,
      p_expected_columns;
  END IF;

  IF v_actual_columns <> p_expected_columns THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=% expected=primary key % actual=%',
      p_table_name,
      p_expected_columns,
      v_actual_columns;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_named_primary_key(
  p_table_name TEXT,
  p_constraint_name TEXT,
  p_expected_columns TEXT[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_actual_columns TEXT[];
BEGIN
  SELECT array_agg(att.attname ORDER BY ord.ordinality)
  INTO v_actual_columns
  FROM pg_constraint con
  CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid
   AND att.attnum = ord.attnum
  WHERE con.conrelid = format('public.%I', p_table_name)::regclass
    AND con.conname = p_constraint_name
    AND con.contype = 'p';

  IF v_actual_columns IS NULL THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=%.% expected=named primary key % actual=missing',
      p_table_name,
      p_constraint_name,
      p_expected_columns;
  END IF;

  IF v_actual_columns <> p_expected_columns THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=%.% expected=named primary key % actual=%',
      p_table_name,
      p_constraint_name,
      p_expected_columns,
      v_actual_columns;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_constraint_contains(
  p_table_name TEXT,
  p_constraint_name TEXT,
  p_constraint_type "char",
  p_expected_fragments TEXT[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_definition TEXT;
  v_fragment TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO v_definition
  FROM pg_constraint
  WHERE conrelid = format('public.%I', p_table_name)::regclass
    AND conname = p_constraint_name
    AND contype = p_constraint_type;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=%.% expected=constraint actual=missing',
      p_table_name,
      p_constraint_name;
  END IF;

  FOREACH v_fragment IN ARRAY p_expected_fragments
  LOOP
    IF v_fragment IS NOT NULL AND position(lower(v_fragment) in lower(v_definition)) = 0 THEN
      RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=%.% expected=constraint contains "%" actual=%',
        p_table_name,
        p_constraint_name,
        v_fragment,
        v_definition;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_constraint_definition(
  p_table_name TEXT,
  p_constraint_name TEXT,
  p_constraint_type "char",
  p_expected_definition TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO v_definition
  FROM pg_constraint
  WHERE conrelid = format('public.%I', p_table_name)::regclass
    AND conname = p_constraint_name
    AND contype = p_constraint_type;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=%.% expected=constraint actual=missing',
      p_table_name,
      p_constraint_name;
  END IF;

  IF pg_temp.normalize_catalog_sql(v_definition) <> pg_temp.normalize_catalog_sql(p_expected_definition) THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=%.% expected=constraintdef:% actual=%',
      p_table_name,
      p_constraint_name,
      p_expected_definition,
      v_definition;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_foreign_key(
  p_table_name TEXT,
  p_constraint_name TEXT,
  p_expected_columns TEXT[],
  p_expected_ref_table TEXT,
  p_expected_ref_columns TEXT[],
  p_expected_delete_action TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_actual_columns TEXT[];
  v_actual_ref_columns TEXT[];
  v_actual_ref_table TEXT;
  v_actual_delete_action TEXT;
BEGIN
  SELECT
    array_agg(src.attname ORDER BY src_ord.ordinality),
    conf.relname,
    array_agg(ref.attname ORDER BY ref_ord.ordinality),
    CASE con.confdeltype
      WHEN 'a' THEN 'NO ACTION'
      WHEN 'r' THEN 'RESTRICT'
      WHEN 'c' THEN 'CASCADE'
      WHEN 'n' THEN 'SET NULL'
      WHEN 'd' THEN 'SET DEFAULT'
    END
  INTO
    v_actual_columns,
    v_actual_ref_table,
    v_actual_ref_columns,
    v_actual_delete_action
  FROM pg_constraint con
  JOIN pg_class conf ON conf.oid = con.confrelid
  CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS src_ord(attnum, ordinality)
  JOIN pg_attribute src
    ON src.attrelid = con.conrelid
   AND src.attnum = src_ord.attnum
  CROSS JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS ref_ord(attnum, ordinality)
  JOIN pg_attribute ref
    ON ref.attrelid = con.confrelid
   AND ref.attnum = ref_ord.attnum
   AND ref_ord.ordinality = src_ord.ordinality
  WHERE con.conrelid = format('public.%I', p_table_name)::regclass
    AND con.conname = p_constraint_name
    AND con.contype = 'f'
  GROUP BY conf.relname, con.confdeltype;

  IF v_actual_columns IS NULL THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=%.% expected=foreign key actual=missing',
      p_table_name,
      p_constraint_name;
  END IF;

  IF v_actual_columns <> p_expected_columns THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=%.% expected=columns:% actual=%',
      p_table_name,
      p_constraint_name,
      p_expected_columns,
      v_actual_columns;
  END IF;

  IF v_actual_ref_table <> p_expected_ref_table THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=%.% expected=references public.% actual=public.%',
      p_table_name,
      p_constraint_name,
      p_expected_ref_table,
      v_actual_ref_table;
  END IF;

  IF v_actual_ref_columns <> p_expected_ref_columns THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=%.% expected=referenced columns:% actual=%',
      p_table_name,
      p_constraint_name,
      p_expected_ref_columns,
      v_actual_ref_columns;
  END IF;

  IF p_expected_delete_action IS NOT NULL
     AND upper(v_actual_delete_action) <> upper(p_expected_delete_action) THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=%.% expected=on delete % actual=%',
      p_table_name,
      p_constraint_name,
      p_expected_delete_action,
      v_actual_delete_action;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_unique_contains(
  p_table_name TEXT,
  p_expected_fragments TEXT[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_definition TEXT;
  v_fragment TEXT;
BEGIN
  SELECT pg_get_constraintdef(con.oid)
  INTO v_definition
  FROM pg_constraint con
  WHERE con.conrelid = format('public.%I', p_table_name)::regclass
    AND con.contype = 'u'
  ORDER BY con.oid
  LIMIT 1;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=% expected=unique constraint actual=missing',
      p_table_name;
  END IF;

  FOREACH v_fragment IN ARRAY p_expected_fragments
  LOOP
    IF v_fragment IS NOT NULL AND position(lower(v_fragment) in lower(v_definition)) = 0 THEN
      RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=% expected=unique contains "%" actual=%',
        p_table_name,
        v_fragment,
        v_definition;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_named_unique_constraint(
  p_table_name TEXT,
  p_constraint_name TEXT,
  p_expected_columns TEXT[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_actual_columns TEXT[];
BEGIN
  SELECT array_agg(att.attname ORDER BY ord.ordinality)
  INTO v_actual_columns
  FROM pg_constraint con
  CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid
   AND att.attnum = ord.attnum
  WHERE con.conrelid = format('public.%I', p_table_name)::regclass
    AND con.conname = p_constraint_name
    AND con.contype = 'u';

  IF v_actual_columns IS NULL THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=%.% expected=unique constraint actual=missing',
      p_table_name,
      p_constraint_name;
  END IF;

  IF v_actual_columns <> p_expected_columns THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=%.% expected=unique columns:% actual=%',
      p_table_name,
      p_constraint_name,
      p_expected_columns,
      v_actual_columns;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_index_contains(
  p_index_name TEXT,
  p_expected_fragments TEXT[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_definition TEXT;
  v_fragment TEXT;
BEGIN
  SELECT pg_get_indexdef(indexrelid)
  INTO v_definition
  FROM pg_index
  WHERE indexrelid = format('public.%I', p_index_name)::regclass;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=% expected=index actual=missing',
      p_index_name;
  END IF;

  FOREACH v_fragment IN ARRAY p_expected_fragments
  LOOP
    IF v_fragment IS NOT NULL AND position(lower(v_fragment) in lower(v_definition)) = 0 THEN
      RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=% expected=index contains "%" actual=%',
        p_index_name,
        v_fragment,
        v_definition;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_index_signature(
  p_index_name TEXT,
  p_expected_table_name TEXT,
  p_expected_columns TEXT[],
  p_expected_unique BOOLEAN,
  p_expected_predicate TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_actual_table TEXT;
  v_actual_columns TEXT[];
  v_actual_unique BOOLEAN;
  v_actual_valid BOOLEAN;
  v_actual_predicate TEXT;
  v_has_expressions BOOLEAN;
BEGIN
  SELECT
    tbl.relname,
    array_agg(att.attname ORDER BY ord.ordinality),
    idx.indisunique,
    idx.indisvalid,
    pg_temp.normalize_catalog_sql(pg_get_expr(idx.indpred, idx.indrelid, true)),
    idx.indexprs IS NOT NULL
  INTO
    v_actual_table,
    v_actual_columns,
    v_actual_unique,
    v_actual_valid,
    v_actual_predicate,
    v_has_expressions
  FROM pg_index idx
  JOIN pg_class ind ON ind.oid = idx.indexrelid
  JOIN pg_class tbl ON tbl.oid = idx.indrelid
  LEFT JOIN LATERAL unnest(idx.indkey) WITH ORDINALITY AS ord(attnum, ordinality)
    ON true
  LEFT JOIN pg_attribute att
    ON att.attrelid = idx.indrelid
   AND att.attnum = ord.attnum
  WHERE ind.oid = format('public.%I', p_index_name)::regclass
  GROUP BY tbl.relname, idx.indisunique, idx.indisvalid, idx.indpred, idx.indrelid, idx.indexprs;

  IF v_actual_table IS NULL THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=% expected=index actual=missing',
      p_index_name;
  END IF;

  IF v_actual_table <> p_expected_table_name THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=% expected=table:public.% actual=public.%',
      p_index_name,
      p_expected_table_name,
      v_actual_table;
  END IF;

  IF v_has_expressions THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=% expected=plain-column index actual=expression index',
      p_index_name;
  END IF;

  IF v_actual_columns <> p_expected_columns THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=% expected=columns:% actual=%',
      p_index_name,
      p_expected_columns,
      v_actual_columns;
  END IF;

  IF v_actual_unique IS DISTINCT FROM p_expected_unique THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=% expected=unique:% actual=%',
      p_index_name,
      p_expected_unique,
      v_actual_unique;
  END IF;

  IF v_actual_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=% expected=valid index actual=invalid',
      p_index_name;
  END IF;

  IF pg_temp.normalize_catalog_sql(v_actual_predicate)
     IS DISTINCT FROM pg_temp.normalize_catalog_sql(p_expected_predicate) THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=% expected=predicate:% actual=%',
      p_index_name,
      COALESCE(pg_temp.normalize_catalog_sql(p_expected_predicate), 'NULL'),
      COALESCE(pg_temp.normalize_catalog_sql(v_actual_predicate), 'NULL');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_index_definition(
  p_index_name TEXT,
  p_expected_indexdef TEXT,
  p_expected_predicate TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_definition TEXT;
  v_predicate TEXT;
  v_valid BOOLEAN;
BEGIN
  SELECT
    pg_get_indexdef(idx.indexrelid),
    pg_get_expr(idx.indpred, idx.indrelid, true),
    idx.indisvalid
  INTO
    v_definition,
    v_predicate,
    v_valid
  FROM pg_index idx
  WHERE idx.indexrelid = format('public.%I', p_index_name)::regclass;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=% expected=index actual=missing',
      p_index_name;
  END IF;

  IF pg_temp.normalize_catalog_sql(v_definition) <> pg_temp.normalize_catalog_sql(p_expected_indexdef) THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=% expected=indexdef:% actual=%',
      p_index_name,
      p_expected_indexdef,
      v_definition;
  END IF;

  IF pg_temp.normalize_catalog_sql(v_predicate)
     IS DISTINCT FROM pg_temp.normalize_catalog_sql(p_expected_predicate) THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=% expected=predicate:% actual=%',
      p_index_name,
      COALESCE(pg_temp.normalize_catalog_sql(p_expected_predicate), 'NULL'),
      COALESCE(pg_temp.normalize_catalog_sql(v_predicate), 'NULL');
  END IF;

  IF v_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=% expected=valid index actual=invalid',
      p_index_name;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_trigger_function(
  p_table_name TEXT,
  p_trigger_name TEXT,
  p_function_name TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_definition TEXT;
BEGIN
  SELECT pg_get_triggerdef(t.oid)
  INTO v_definition
  FROM pg_trigger t
  WHERE t.tgrelid = format('public.%I', p_table_name)::regclass
    AND t.tgname = p_trigger_name
    AND NOT t.tgisinternal;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=%.% expected=trigger actual=missing',
      p_table_name,
      p_trigger_name;
  END IF;

  IF position(lower(p_function_name) in lower(v_definition)) = 0 THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=%.% expected=trigger function % actual=%',
      p_table_name,
      p_trigger_name,
      p_function_name,
      v_definition;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_rls_state(
  p_table_name TEXT,
  p_expected_enabled BOOLEAN
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_enabled BOOLEAN;
BEGIN
  SELECT c.relrowsecurity
  INTO v_enabled
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = p_table_name;

  IF v_enabled IS NULL THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=% expected=rls actual=missing_table',
      p_table_name;
  END IF;

  IF v_enabled IS DISTINCT FROM p_expected_enabled THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=% expected=rls_enabled:% actual=rls_enabled:%',
      p_table_name,
      p_expected_enabled,
      v_enabled;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_table_privileges_absent(
  p_table_name TEXT,
  p_roles TEXT[],
  p_privileges TEXT[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_grant RECORD;
BEGIN
  FOR v_grant IN
    SELECT
      lower(grantee) AS grantee,
      lower(privilege_type) AS privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = p_table_name
      AND lower(grantee) = ANY(
        ARRAY(
          SELECT lower(role_name)
          FROM unnest(COALESCE(p_roles, ARRAY[]::TEXT[])) AS role_name
        )
      )
      AND lower(privilege_type) = ANY(
        ARRAY(
          SELECT lower(privilege_name)
          FROM unnest(COALESCE(p_privileges, ARRAY[]::TEXT[])) AS privilege_name
        )
      )
  LOOP
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=table % expected=no browser grant actual=%:%',
      p_table_name,
      v_grant.grantee,
      v_grant.privilege_type;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_table_privileges_present(
  p_table_name TEXT,
  p_roles TEXT[],
  p_privileges TEXT[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_role TEXT;
  v_privilege TEXT;
BEGIN
  FOREACH v_role IN ARRAY COALESCE(p_roles, ARRAY[]::TEXT[])
  LOOP
    FOREACH v_privilege IN ARRAY COALESCE(p_privileges, ARRAY[]::TEXT[])
    LOOP
      IF NOT has_table_privilege(v_role, format('public.%I', p_table_name), upper(v_privilege)) THEN
        RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=table % expected=grant %:% actual=missing',
          p_table_name,
          lower(v_role),
          lower(v_privilege);
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.apply_public_table_access_manifest(
  p_table_name TEXT,
  p_access_model TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_regclass(format('public.%I', p_table_name)) IS NULL THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=table % expected=manifest target actual=missing',
      p_table_name;
  END IF;

  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', p_table_name);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', p_table_name);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', p_table_name);

  IF p_access_model = 'merchant_read_select' THEN
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', p_table_name);
  ELSIF p_access_model <> 'internal' THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=table % expected=known access model actual=%',
      p_table_name,
      p_access_model;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_table_access_manifest(
  p_table_name TEXT,
  p_access_model TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_temp.assert_public_table_privileges_absent(
    p_table_name,
    ARRAY['public', 'anon'],
    ARRAY['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']
  );

  PERFORM pg_temp.assert_public_table_privileges_absent(
    p_table_name,
    ARRAY['authenticated'],
    ARRAY['insert', 'update', 'delete', 'truncate', 'references', 'trigger']
  );

  IF p_access_model = 'merchant_read_select' THEN
    PERFORM pg_temp.assert_public_table_privileges_present(
      p_table_name,
      ARRAY['authenticated'],
      ARRAY['select']
    );
  ELSIF p_access_model = 'internal' THEN
    PERFORM pg_temp.assert_public_table_privileges_absent(
      p_table_name,
      ARRAY['authenticated'],
      ARRAY['select']
    );
  ELSE
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=table % expected=known access model actual=%',
      p_table_name,
      p_access_model;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.find_equivalent_public_permissive_select_policy(
  p_table_name TEXT,
  p_canonical_policy_name TEXT,
  p_expected_roles TEXT[],
  p_expected_using TEXT,
  p_expected_with_check TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_policy RECORD;
  v_expected_roles TEXT[];
  v_actual_roles TEXT[];
BEGIN
  SELECT COALESCE(array_agg(role_name ORDER BY role_name), ARRAY[]::TEXT[])
  INTO v_expected_roles
  FROM unnest(COALESCE(p_expected_roles, ARRAY[]::TEXT[])) AS role_name;

  FOR v_policy IN
    SELECT
      pol.policyname,
      pol.roles,
      pol.qual,
      pol.with_check,
      pol.permissive
    FROM pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.tablename = p_table_name
      AND lower(pol.cmd) = 'select'
      AND pol.policyname <> p_canonical_policy_name
  LOOP
    SELECT COALESCE(array_agg(role_name ORDER BY role_name), ARRAY[]::TEXT[])
    INTO v_actual_roles
    FROM unnest(COALESCE(v_policy.roles, ARRAY[]::TEXT[])) AS role_name;

    IF upper(COALESCE(v_policy.permissive, 'PERMISSIVE')) = 'PERMISSIVE'
       AND (
         'public' = ANY(v_expected_roles)
         OR 'public' = ANY(v_actual_roles)
         OR EXISTS (
           SELECT 1
           FROM unnest(v_expected_roles) AS expected_role
           INNER JOIN unnest(v_actual_roles) AS actual_role
             ON actual_role = expected_role
         )
       )
       AND pg_temp.normalize_catalog_sql(v_policy.qual) = pg_temp.normalize_catalog_sql(p_expected_using)
       AND pg_temp.normalize_catalog_sql(v_policy.with_check) = pg_temp.normalize_catalog_sql(p_expected_with_check) THEN
      RETURN v_policy.policyname;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_permissive_select_policy_safe(
  p_table_name TEXT,
  p_canonical_policy_name TEXT,
  p_expected_roles TEXT[],
  p_expected_using TEXT,
  p_expected_with_check TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_policy RECORD;
  v_expected_roles TEXT[];
  v_actual_roles TEXT[];
  v_expected_using TEXT := pg_temp.normalize_catalog_sql(p_expected_using);
  v_expected_with_check TEXT := pg_temp.normalize_catalog_sql(p_expected_with_check);
BEGIN
  SELECT COALESCE(array_agg(role_name ORDER BY role_name), ARRAY[]::TEXT[])
  INTO v_expected_roles
  FROM unnest(COALESCE(p_expected_roles, ARRAY[]::TEXT[])) AS role_name;

  FOR v_policy IN
    SELECT
      pol.policyname,
      pol.roles,
      pol.qual,
      pol.with_check,
      pol.permissive
    FROM pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.tablename = p_table_name
      AND lower(pol.cmd) = 'select'
      AND pol.policyname <> p_canonical_policy_name
  LOOP
    SELECT COALESCE(array_agg(role_name ORDER BY role_name), ARRAY[]::TEXT[])
    INTO v_actual_roles
    FROM unnest(COALESCE(v_policy.roles, ARRAY[]::TEXT[])) AS role_name;

    IF upper(COALESCE(v_policy.permissive, 'PERMISSIVE')) = 'PERMISSIVE'
       AND (
         'public' = ANY(v_expected_roles)
         OR 'public' = ANY(v_actual_roles)
         OR EXISTS (
           SELECT 1
           FROM unnest(v_expected_roles) AS expected_role
           INNER JOIN unnest(v_actual_roles) AS actual_role
             ON actual_role = expected_role
         )
       ) THEN
      IF pg_temp.normalize_catalog_sql(v_policy.qual) <> v_expected_using
         OR pg_temp.normalize_catalog_sql(v_policy.with_check) <> v_expected_with_check THEN
        RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=policy %.% expected=no overlapping permissive SELECT policy actual=policy "%" would broaden or differ',
          p_table_name,
          p_canonical_policy_name,
          v_policy.policyname;
      END IF;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_policy_compatible(
  p_table_name TEXT,
  p_policy_name TEXT,
  p_command TEXT,
  p_expected_roles TEXT[],
  p_using_fragments TEXT[],
  p_with_check_fragments TEXT[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_cmd TEXT;
  v_roles TEXT[];
  v_qual TEXT;
  v_with_check TEXT;
BEGIN
  SELECT
    pol.cmd,
    pol.roles,
    pol.qual,
    pol.with_check
  INTO
    v_cmd,
    v_roles,
    v_qual,
    v_with_check
  FROM pg_policies pol
  WHERE pol.schemaname = 'public'
    AND pol.tablename = p_table_name
    AND pol.policyname = p_policy_name;

  IF v_cmd IS NULL THEN
    RETURN;
  END IF;

  IF lower(v_cmd) <> lower(p_command) THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=policy %.% expected=command:% actual=%',
      p_table_name,
      p_policy_name,
      p_command,
      v_cmd;
  END IF;

  IF COALESCE((SELECT array_agg(role_name ORDER BY role_name) FROM unnest(v_roles) AS role_name), ARRAY[]::TEXT[])
     <> COALESCE((SELECT array_agg(role_name ORDER BY role_name) FROM unnest(p_expected_roles) AS role_name), ARRAY[]::TEXT[]) THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=policy %.% expected=roles:% actual=%',
      p_table_name,
      p_policy_name,
      p_expected_roles,
      v_roles;
  END IF;

  IF pg_temp.normalize_catalog_sql(COALESCE(v_qual, ''))
     <> pg_temp.normalize_catalog_sql(array_to_string(COALESCE(p_using_fragments, ARRAY[]::TEXT[]), ' ')) THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=policy %.% expected=using:% actual=%',
      p_table_name,
      p_policy_name,
      array_to_string(COALESCE(p_using_fragments, ARRAY[]::TEXT[]), ' '),
      COALESCE(v_qual, 'NULL');
  END IF;

  IF pg_temp.normalize_catalog_sql(COALESCE(v_with_check, ''))
     <> pg_temp.normalize_catalog_sql(array_to_string(COALESCE(p_with_check_fragments, ARRAY[]::TEXT[]), ' ')) THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=policy %.% expected=with_check:% actual=%',
      p_table_name,
      p_policy_name,
      array_to_string(COALESCE(p_with_check_fragments, ARRAY[]::TEXT[]), ' '),
      COALESCE(v_with_check, 'NULL');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_function_execute_grants(
  p_function_name TEXT,
  p_identity_arguments TEXT,
  p_expected_grantees TEXT[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_function_oid oid;
  v_specific_name TEXT;
  v_owner_name TEXT;
  v_grantees TEXT[];
  v_explicit_grantees TEXT[];
  v_denied_role TEXT;
BEGIN
  SELECT
    p.oid,
    p.proname || '_' || p.oid::text,
    pg_get_userbyid(p.proowner)
  INTO
    v_function_oid,
    v_specific_name,
    v_owner_name
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = p_function_name
    AND pg_get_function_identity_arguments(p.oid) = p_identity_arguments;

  IF v_specific_name IS NULL THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=function % (%) expected=exists actual=missing',
      p_function_name,
      p_identity_arguments;
  END IF;

  SELECT COALESCE(array_agg(rp.grantee ORDER BY rp.grantee), ARRAY[]::TEXT[])
  INTO v_grantees
  FROM information_schema.routine_privileges rp
  WHERE rp.specific_schema = 'public'
    AND rp.specific_name = v_specific_name
    AND rp.privilege_type = 'EXECUTE';

  SELECT COALESCE(array_agg(grantee ORDER BY grantee), ARRAY[]::TEXT[])
  INTO v_explicit_grantees
  FROM unnest(v_grantees) AS grantee
  WHERE grantee <> v_owner_name;

  IF v_explicit_grantees <> p_expected_grantees THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=function % (%) expected=execute grantees:% actual=%',
      p_function_name,
      p_identity_arguments,
      p_expected_grantees,
      v_grantees;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    LEFT JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl ON TRUE
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = p_function_name
      AND pg_get_function_identity_arguments(p.oid) = p_identity_arguments
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
      AND acl.is_grantable = false
  ) THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=function % (%) expected=no execute for role PUBLIC actual=granted',
      p_function_name,
      p_identity_arguments;
  END IF;

  FOREACH v_denied_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF has_function_privilege(v_denied_role, v_function_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=function % (%) expected=no execute for role % actual=granted',
        p_function_name,
        p_identity_arguments,
        v_denied_role;
    END IF;
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_has_merchant_team BOOLEAN := to_regclass('public.merchant_team') IS NOT NULL;
  v_payment_records_policy_using TEXT;
  v_settlement_records_policy_using TEXT;
  v_settlement_accounts_policy_using TEXT;
  v_provider_settlement_accounts_policy_using TEXT;
  v_provider_batches_policy_using TEXT;
BEGIN
  PERFORM pg_temp.assert_public_table_exists('merchants');
  PERFORM pg_temp.assert_public_table_exists('invoices');
  PERFORM pg_temp.assert_public_table_exists('transactions');
  PERFORM pg_temp.assert_public_table_exists('platform_settings');
  PERFORM pg_temp.assert_public_table_exists('payment_records');
  PERFORM pg_temp.assert_public_function_exists('touch_updated_at', '');

  IF v_has_merchant_team THEN
    PERFORM pg_temp.assert_public_relation_kind('merchant_team');
    PERFORM pg_temp.assert_public_column_definition('merchant_team', 'merchant_id', 'uuid', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('merchant_team', 'user_id', 'uuid', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('merchant_team', 'role_id', 'uuid', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('merchant_team', 'is_active', 'bool', true, 'true');
    PERFORM pg_temp.assert_public_named_unique_constraint(
      'merchant_team',
      'merchant_team_merchant_id_user_id_key',
      ARRAY['merchant_id', 'user_id']
    );
    PERFORM pg_temp.assert_public_foreign_key(
      'merchant_team',
      'merchant_team_merchant_id_fkey',
      ARRAY['merchant_id'],
      'merchants',
      ARRAY['id'],
      'CASCADE'
    );
    PERFORM pg_temp.assert_public_constraint_definition(
      'merchant_team',
      'merchant_team_user_id_fkey',
      'f',
      'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'
    );
  END IF;

  v_payment_records_policy_using := CASE
    WHEN v_has_merchant_team THEN
      '((auth.role() = ''authenticated''::text) AND ((EXISTS (SELECT 1 FROM merchants m WHERE ((m.id = payment_records.merchant_id) AND (m.user_id = auth.uid())))) OR (EXISTS (SELECT 1 FROM merchant_team mt WHERE ((mt.merchant_id = payment_records.merchant_id) AND (mt.user_id = auth.uid()) AND (COALESCE(mt.is_active, false) = true))))))'
    ELSE
      '((auth.role() = ''authenticated''::text) AND (EXISTS (SELECT 1 FROM merchants m WHERE ((m.id = payment_records.merchant_id) AND (m.user_id = auth.uid())))))'
  END;
  v_settlement_records_policy_using := CASE
    WHEN v_has_merchant_team THEN
      '((auth.role() = ''authenticated''::text) AND ((EXISTS (SELECT 1 FROM merchants m WHERE ((m.id = settlement_records.merchant_id) AND (m.user_id = auth.uid())))) OR (EXISTS (SELECT 1 FROM merchant_team mt WHERE ((mt.merchant_id = settlement_records.merchant_id) AND (mt.user_id = auth.uid()) AND (COALESCE(mt.is_active, false) = true))))))'
    ELSE
      '((auth.role() = ''authenticated''::text) AND (EXISTS (SELECT 1 FROM merchants m WHERE ((m.id = settlement_records.merchant_id) AND (m.user_id = auth.uid())))))'
  END;
  v_settlement_accounts_policy_using := CASE
    WHEN v_has_merchant_team THEN
      '((auth.role() = ''authenticated''::text) AND ((EXISTS (SELECT 1 FROM merchants m WHERE ((m.id = merchant_settlement_accounts.merchant_id) AND (m.user_id = auth.uid())))) OR (EXISTS (SELECT 1 FROM merchant_team mt WHERE ((mt.merchant_id = merchant_settlement_accounts.merchant_id) AND (mt.user_id = auth.uid()) AND (COALESCE(mt.is_active, false) = true))))))'
    ELSE
      '((auth.role() = ''authenticated''::text) AND (EXISTS (SELECT 1 FROM merchants m WHERE ((m.id = merchant_settlement_accounts.merchant_id) AND (m.user_id = auth.uid())))))'
  END;
  v_provider_settlement_accounts_policy_using := CASE
    WHEN v_has_merchant_team THEN
      '((auth.role() = ''authenticated''::text) AND ((EXISTS (SELECT 1 FROM merchants m WHERE ((m.id = merchant_provider_settlement_accounts.merchant_id) AND (m.user_id = auth.uid())))) OR (EXISTS (SELECT 1 FROM merchant_team mt WHERE ((mt.merchant_id = merchant_provider_settlement_accounts.merchant_id) AND (mt.user_id = auth.uid()) AND (COALESCE(mt.is_active, false) = true))))))'
    ELSE
      '((auth.role() = ''authenticated''::text) AND (EXISTS (SELECT 1 FROM merchants m WHERE ((m.id = merchant_provider_settlement_accounts.merchant_id) AND (m.user_id = auth.uid())))))'
  END;
  v_provider_batches_policy_using := CASE
    WHEN v_has_merchant_team THEN
      '((auth.role() = ''authenticated''::text) AND ((EXISTS (SELECT 1 FROM merchants m WHERE ((m.id = provider_settlement_batches.merchant_id) AND (m.user_id = auth.uid())))) OR (EXISTS (SELECT 1 FROM merchant_team mt WHERE ((mt.merchant_id = provider_settlement_batches.merchant_id) AND (mt.user_id = auth.uid()) AND (COALESCE(mt.is_active, false) = true))))))'
    ELSE
      '((auth.role() = ''authenticated''::text) AND (EXISTS (SELECT 1 FROM merchants m WHERE ((m.id = provider_settlement_batches.merchant_id) AND (m.user_id = auth.uid())))))'
  END;

  PERFORM pg_temp.assert_public_relation_kind('payment_records');
  PERFORM pg_temp.assert_public_named_primary_key('payment_records', 'payment_records_pkey', ARRAY['id']);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'id', 'uuid', true, 'gen_random_uuid');
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'merchant_id', 'uuid', false, NULL);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'customer_id', 'uuid', false, NULL);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'invoice_id', 'uuid', false, NULL);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'payment_link_id', 'uuid', false, NULL);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'legacy_transaction_id', 'uuid', false, NULL);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'payment_purpose', 'varchar', true, NULL);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'payment_method', 'varchar', false, NULL);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'provider_name', 'varchar', false, NULL);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'internal_reference', 'varchar', true, NULL);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'provider_reference', 'varchar', false, NULL);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'amount_paid', 'numeric', true, '0');
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'currency', 'varchar', true, 'NGN');
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'payment_status', 'varchar', true, 'pending');
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'customer_email', 'text', false, NULL);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'raw_provider_payload', 'jsonb', false, NULL);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'paid_at', 'timestamptz', false, NULL);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'created_at', 'timestamptz', true, 'now');
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'updated_at', 'timestamptz', true, 'now');
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'user_id', 'uuid', false, NULL);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'business_id', 'uuid', false, NULL);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'plan_id', 'text', false, NULL);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'plan_name', 'text', false, NULL);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'expected_amount', 'numeric', false, NULL);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'processing_status', 'text', true, 'pending_payment');
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'account_setup_status', 'text', true, 'pending_payment');
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'password_setup_required', 'bool', true, 'false');
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'failure_reason', 'text', false, NULL);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'metadata', 'jsonb', true, '''{}''::jsonb');
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'expires_at', 'timestamptz', false, NULL);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'settlement_destination_source', 'text', false, NULL);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'reconciliation_status', 'text', true, 'pending_reconciliation');
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'setup_recovery_token_hash', 'text', false, NULL);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'setup_recovery_token_expires_at', 'timestamptz', false, NULL);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'setup_recovery_email_sent_at', 'timestamptz', false, NULL);
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'setup_recovery_email_count', 'int4', true, '0');
  PERFORM pg_temp.assert_public_column_definition('payment_records', 'setup_completed_at', 'timestamptz', false, NULL);
  PERFORM pg_temp.assert_public_named_unique_constraint(
    'payment_records',
    'payment_records_internal_reference_key',
    ARRAY['internal_reference']
  );
  PERFORM pg_temp.assert_public_foreign_key(
    'payment_records',
    'payment_records_merchant_id_fkey',
    ARRAY['merchant_id'],
    'merchants',
    ARRAY['id'],
    'SET NULL'
  );
  PERFORM pg_temp.assert_public_foreign_key(
    'payment_records',
    'payment_records_invoice_id_fkey',
    ARRAY['invoice_id'],
    'invoices',
    ARRAY['id'],
    'SET NULL'
  );
  PERFORM pg_temp.assert_public_foreign_key(
    'payment_records',
    'payment_records_legacy_transaction_id_fkey',
    ARRAY['legacy_transaction_id'],
    'transactions',
    ARRAY['id'],
    'SET NULL'
  );
  PERFORM pg_temp.assert_public_constraint_contains(
    'payment_records',
    'payment_records_payment_status_check',
    'c',
    ARRAY['pending', 'successful', 'failed', 'abandoned', 'reversed', 'refunded']
  );
  PERFORM pg_temp.assert_public_index_definition(
    'idx_payment_records_merchant',
    'CREATE INDEX idx_payment_records_merchant ON public.payment_records USING btree (merchant_id, payment_status, created_at DESC)',
    NULL
  );
  PERFORM pg_temp.assert_public_index_definition(
    'idx_payment_records_provider_reference',
    'CREATE INDEX idx_payment_records_provider_reference ON public.payment_records USING btree (provider_name, provider_reference)',
    NULL
  );
  PERFORM pg_temp.assert_public_index_definition(
    'idx_payment_records_plan_recovery',
    'CREATE INDEX idx_payment_records_plan_recovery ON public.payment_records USING btree (payment_purpose, processing_status, account_setup_status, created_at DESC)',
    NULL
  );
  PERFORM pg_temp.assert_public_index_definition(
    'idx_payment_records_customer_email',
    'CREATE INDEX idx_payment_records_customer_email ON public.payment_records USING btree (customer_email, created_at DESC)',
    NULL
  );
  PERFORM pg_temp.assert_public_trigger_function('payment_records', 'trg_payment_records_updated_at', 'touch_updated_at');
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'payment_records'
      AND lower(cmd) <> 'select'
  ) THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=table payment_records expected=select-only RLS policy set actual=non-select policy present';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'payment_records'
  ) THEN
    PERFORM pg_temp.assert_public_permissive_select_policy_safe(
      'payment_records',
      'merchant_read_payment_records',
      ARRAY['public'],
      v_payment_records_policy_using
    );
    IF EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'payment_records'
        AND policyname = 'merchant_read_payment_records'
    ) THEN
      PERFORM pg_temp.assert_public_policy_compatible(
        'payment_records',
        'merchant_read_payment_records',
        'SELECT',
        ARRAY['public'],
        ARRAY[v_payment_records_policy_using]
      );
    END IF;
  END IF;

  IF to_regclass('public.payment_events') IS NOT NULL THEN
    PERFORM pg_temp.assert_public_relation_kind('payment_events');
    PERFORM pg_temp.assert_public_named_primary_key('payment_events', 'payment_events_pkey', ARRAY['id']);
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'id', 'uuid', true, 'gen_random_uuid');
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'merchant_id', 'uuid', false, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'invoice_id', 'uuid', false, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'transaction_id', 'uuid', false, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'event_type', 'text', true, NULL);
    PERFORM pg_temp.assert_payment_events_processor_legacy_compatible();
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'processor_ref', 'text', false, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'amount_kobo', 'int8', false, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'raw_payload', 'jsonb', false, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'processed_at', 'timestamptz', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'idempotency_key', 'text', false, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'payment_method', 'text', false, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'payment_purpose', 'text', false, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'payment_reference', 'text', false, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'provider_reference', 'text', false, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'expected_amount', 'numeric', false, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'paid_amount', 'numeric', false, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'currency', 'text', true, 'NGN');
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'fee', 'numeric', false, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'plan_id', 'text', false, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'subscription_id', 'uuid', false, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'business_id', 'uuid', false, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'customer_email', 'text', false, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'processing_status', 'text', true, 'received');
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'failure_reason', 'text', false, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'settlement_destination_source', 'text', false, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'reconciliation_status', 'text', false, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'created_at', 'timestamptz', true, 'now');
    PERFORM pg_temp.assert_public_column_definition('payment_events', 'updated_at', 'timestamptz', true, 'now');
    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'public.payment_events'::regclass
        AND conname = 'payment_events_merchant_id_fkey'
    ) THEN
      PERFORM pg_temp.assert_public_foreign_key(
        'payment_events',
        'payment_events_merchant_id_fkey',
        ARRAY['merchant_id'],
        'merchants',
        ARRAY['id'],
        NULL
      );
    ELSE
      RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=payment_events.payment_events_merchant_id_fkey expected=foreign key actual=missing';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'public.payment_events'::regclass
        AND conname = 'payment_events_invoice_id_fkey'
    ) THEN
      PERFORM pg_temp.assert_public_foreign_key(
        'payment_events',
        'payment_events_invoice_id_fkey',
        ARRAY['invoice_id'],
        'invoices',
        ARRAY['id'],
        'SET NULL'
      );
    ELSE
      RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=payment_events.payment_events_invoice_id_fkey expected=foreign key actual=missing';
    END IF;
    PERFORM pg_temp.assert_public_index_definition(
      'idx_payment_events_created_at',
      'CREATE INDEX idx_payment_events_created_at ON public.payment_events USING btree (created_at DESC)',
      NULL
    );
    PERFORM pg_temp.assert_public_index_definition(
      'idx_payment_events_payment_reference',
      'CREATE INDEX idx_payment_events_payment_reference ON public.payment_events USING btree (payment_reference, provider_reference, created_at DESC)',
      NULL
    );
    PERFORM pg_temp.assert_public_index_definition(
      'idx_payment_events_processor_ref',
      'CREATE INDEX idx_payment_events_processor_ref ON public.payment_events USING btree (processor, processor_ref)',
      NULL
    );
    PERFORM pg_temp.assert_public_index_definition(
      'idx_payment_events_idempotency',
      'CREATE UNIQUE INDEX idx_payment_events_idempotency ON public.payment_events USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL)',
      'idempotency_key IS NOT NULL'
    );
    PERFORM pg_temp.assert_public_trigger_function('payment_events', 'trg_payment_events_updated_at', 'touch_updated_at');
    -- Canonical state: payment_events is an internal service-side audit/recovery table.
    -- It must not rely on browser-facing RLS policies and must not expose direct table
    -- privileges to anon/authenticated/public roles. Browser-role grants are repaired
    -- later through the shared table-access manifest so staging default privileges
    -- cannot block compatible structural reconciliation.
    PERFORM pg_temp.assert_public_rls_state('payment_events', false);
    IF EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'payment_events'
    ) THEN
      RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=table payment_events expected=no RLS policies actual=policy present';
    END IF;
  END IF;

  IF to_regclass('public.payment_providers') IS NOT NULL THEN
    PERFORM pg_temp.assert_public_relation_kind('payment_providers');
    PERFORM pg_temp.assert_public_column_definition('payment_providers', 'id', 'uuid', true, 'gen_random_uuid');
    PERFORM pg_temp.assert_public_column_definition('payment_providers', 'provider_name', 'text', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_providers', 'environment', 'text', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_providers', 'status', 'text', true, 'inactive');
    PERFORM pg_temp.assert_public_column_definition('payment_providers', 'supports_crypto', 'bool', true, 'false');
    PERFORM pg_temp.assert_public_primary_key('payment_providers', ARRAY['id']);
    PERFORM pg_temp.assert_public_unique_contains('payment_providers', ARRAY['provider_name', 'environment']);
    PERFORM pg_temp.assert_public_constraint_contains('payment_providers', 'payment_providers_provider_name_check', 'c', ARRAY['paystack', 'monnify', 'breet']);
    PERFORM pg_temp.assert_public_constraint_contains('payment_providers', 'payment_providers_environment_check', 'c', ARRAY['sandbox', 'live']);
    PERFORM pg_temp.assert_public_constraint_contains('payment_providers', 'payment_providers_status_check', 'c', ARRAY['active', 'inactive', 'degraded', 'pending_live_approval', 'sandbox_only']);
    PERFORM pg_temp.assert_public_index_contains('idx_payment_providers_environment_status', ARRAY['public.payment_providers', 'environment', 'status']);
    PERFORM pg_temp.assert_public_trigger_function('payment_providers', 'trg_payment_providers_updated_at', 'touch_updated_at');
  END IF;

  IF to_regclass('public.payment_method_configs') IS NOT NULL THEN
    PERFORM pg_temp.assert_public_relation_kind('payment_method_configs');
    PERFORM pg_temp.assert_public_column_definition('payment_method_configs', 'id', 'uuid', true, 'gen_random_uuid');
    PERFORM pg_temp.assert_public_column_definition('payment_method_configs', 'payment_purpose', 'text', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_method_configs', 'payment_method', 'text', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_method_configs', 'environment', 'text', true, NULL);
    PERFORM pg_temp.assert_public_primary_key('payment_method_configs', ARRAY['id']);
    PERFORM pg_temp.assert_public_unique_contains('payment_method_configs', ARRAY['payment_purpose', 'payment_method', 'environment']);
    PERFORM pg_temp.assert_public_constraint_contains('payment_method_configs', 'payment_method_configs_payment_purpose_check', 'c', ARRAY['plan_subscription', 'plan_upgrade', 'plan_renewal', 'invoice_payment']);
    PERFORM pg_temp.assert_public_constraint_contains('payment_method_configs', 'payment_method_configs_payment_method_check', 'c', ARRAY['card', 'bank_transfer', 'ussd', 'crypto']);
    PERFORM pg_temp.assert_public_constraint_contains('payment_method_configs', 'payment_method_configs_environment_check', 'c', ARRAY['sandbox', 'live']);
    PERFORM pg_temp.assert_public_index_contains('idx_payment_method_configs_lookup', ARRAY['public.payment_method_configs', 'payment_purpose', 'environment', 'is_enabled']);
    PERFORM pg_temp.assert_public_trigger_function('payment_method_configs', 'trg_payment_method_configs_updated_at', 'touch_updated_at');
  END IF;

  IF to_regclass('public.payment_provider_routes') IS NOT NULL THEN
    PERFORM pg_temp.assert_public_relation_kind('payment_provider_routes');
    PERFORM pg_temp.assert_public_column_definition('payment_provider_routes', 'id', 'uuid', true, 'gen_random_uuid');
    PERFORM pg_temp.assert_public_column_definition('payment_provider_routes', 'payment_purpose', 'text', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_provider_routes', 'payment_method', 'text', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_provider_routes', 'primary_provider', 'text', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_provider_routes', 'environment', 'text', true, NULL);
    PERFORM pg_temp.assert_public_primary_key('payment_provider_routes', ARRAY['id']);
    PERFORM pg_temp.assert_public_unique_contains('payment_provider_routes', ARRAY['payment_purpose', 'payment_method', 'environment']);
    PERFORM pg_temp.assert_public_constraint_contains('payment_provider_routes', 'payment_provider_routes_payment_purpose_check', 'c', ARRAY['plan_subscription', 'plan_upgrade', 'plan_renewal', 'invoice_payment']);
    PERFORM pg_temp.assert_public_constraint_contains('payment_provider_routes', 'payment_provider_routes_payment_method_check', 'c', ARRAY['card', 'bank_transfer', 'ussd', 'crypto']);
    PERFORM pg_temp.assert_public_constraint_contains('payment_provider_routes', 'payment_provider_routes_primary_provider_check', 'c', ARRAY['paystack', 'monnify', 'breet']);
    PERFORM pg_temp.assert_public_constraint_contains('payment_provider_routes', 'payment_provider_routes_environment_check', 'c', ARRAY['sandbox', 'live']);
    PERFORM pg_temp.assert_public_index_contains('idx_payment_provider_routes_lookup', ARRAY['public.payment_provider_routes', 'payment_purpose', 'payment_method', 'environment', 'is_enabled']);
    PERFORM pg_temp.assert_public_trigger_function('payment_provider_routes', 'trg_payment_provider_routes_updated_at', 'touch_updated_at');
  END IF;

  IF to_regclass('public.merchant_wallets') IS NOT NULL THEN
    PERFORM pg_temp.assert_public_relation_kind('merchant_wallets');
    PERFORM pg_temp.assert_public_column_definition('merchant_wallets', 'id', 'uuid', true, 'gen_random_uuid');
    PERFORM pg_temp.assert_public_column_definition('merchant_wallets', 'merchant_id', 'uuid', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('merchant_wallets', 'currency', 'varchar', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('merchant_wallets', 'available_balance', 'numeric', true, '0');
    PERFORM pg_temp.assert_public_primary_key('merchant_wallets', ARRAY['id']);
    PERFORM pg_temp.assert_public_unique_contains('merchant_wallets', ARRAY['merchant_id', 'currency']);
    PERFORM pg_temp.assert_public_foreign_key(
      'merchant_wallets',
      'merchant_wallets_merchant_id_fkey',
      ARRAY['merchant_id'],
      'merchants',
      ARRAY['id'],
      'CASCADE'
    );
  END IF;

  IF to_regclass('public.payment_sessions') IS NOT NULL THEN
    PERFORM pg_temp.assert_public_relation_kind('payment_sessions');
    PERFORM pg_temp.assert_public_column_definition('payment_sessions', 'id', 'uuid', true, 'gen_random_uuid');
    PERFORM pg_temp.assert_public_column_definition('payment_sessions', 'invoice_id', 'uuid', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_sessions', 'merchant_id', 'uuid', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('payment_sessions', 'provider_name', 'varchar', true, 'breet');
    PERFORM pg_temp.assert_public_column_definition('payment_sessions', 'payment_purpose', 'varchar', true, 'invoice_payment');
    PERFORM pg_temp.assert_public_column_definition('payment_sessions', 'settlement_mode', 'varchar', true, 'disabled');
    PERFORM pg_temp.assert_public_column_definition('payment_sessions', 'reference', 'text', true, NULL);
    PERFORM pg_temp.assert_public_primary_key('payment_sessions', ARRAY['id']);
    PERFORM pg_temp.assert_public_foreign_key(
      'payment_sessions',
      'payment_sessions_invoice_id_fkey',
      ARRAY['invoice_id'],
      'invoices',
      ARRAY['id'],
      'CASCADE'
    );
    PERFORM pg_temp.assert_public_foreign_key(
      'payment_sessions',
      'payment_sessions_merchant_id_fkey',
      ARRAY['merchant_id'],
      'merchants',
      ARRAY['id'],
      'CASCADE'
    );
    PERFORM pg_temp.assert_public_constraint_contains('payment_sessions', 'payment_sessions_status_check', 'c', ARRAY['PENDING', 'SETTLEMENT_PENDING', 'SETTLED']);
    PERFORM pg_temp.assert_public_constraint_contains('payment_sessions', 'payment_sessions_crypto_status_check', 'c', ARRAY['crypto_payment_initialized', 'crypto_settlement_completed', 'failed']);
    PERFORM pg_temp.assert_public_constraint_contains('payment_sessions', 'payment_sessions_settlement_mode_check', 'c', ARRAY['breet_auto_settlement', 'platform_auto_settlement', 'treasury_manual', 'disabled']);
    PERFORM pg_temp.assert_public_index_contains('idx_payment_sessions_invoice_status', ARRAY['public.payment_sessions', 'invoice_id', 'status']);
    PERFORM pg_temp.assert_public_index_contains('idx_payment_sessions_merchant_status', ARRAY['public.payment_sessions', 'merchant_id', 'status']);
    PERFORM pg_temp.assert_public_index_contains('idx_payment_sessions_provider_status', ARRAY['public.payment_sessions', 'provider_name', 'crypto_status']);
    PERFORM pg_temp.assert_public_index_contains('idx_payment_sessions_payment_purpose', ARRAY['public.payment_sessions', 'payment_purpose']);
    PERFORM pg_temp.assert_public_trigger_function('payment_sessions', 'trg_payment_sessions_updated_at', 'touch_updated_at');
  END IF;

  IF to_regclass('public.treasury_transactions') IS NOT NULL THEN
    PERFORM pg_temp.assert_public_relation_kind('treasury_transactions');
    PERFORM pg_temp.assert_public_column_definition('treasury_transactions', 'id', 'uuid', true, 'gen_random_uuid');
    PERFORM pg_temp.assert_public_column_definition('treasury_transactions', 'payment_session_id', 'uuid', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('treasury_transactions', 'status', 'varchar', true, 'INITIATED');
    PERFORM pg_temp.assert_public_primary_key('treasury_transactions', ARRAY['id']);
    PERFORM pg_temp.assert_public_unique_contains('treasury_transactions', ARRAY['payment_session_id']);
    PERFORM pg_temp.assert_public_foreign_key(
      'treasury_transactions',
      'treasury_transactions_payment_session_id_fkey',
      ARRAY['payment_session_id'],
      'payment_sessions',
      ARRAY['id'],
      'CASCADE'
    );
    PERFORM pg_temp.assert_public_constraint_contains('treasury_transactions', 'treasury_transactions_status_check', 'c', ARRAY['INITIATED', 'SETTLEMENT_QUEUED', 'SETTLED', 'REVERSED']);
    PERFORM pg_temp.assert_public_index_contains('idx_treasury_transactions_merchant_created', ARRAY['public.treasury_transactions', 'merchant_id', 'created_at']);
    PERFORM pg_temp.assert_public_index_contains('idx_treasury_transactions_status', ARRAY['public.treasury_transactions', 'status', 'created_at']);
    PERFORM pg_temp.assert_public_trigger_function('treasury_transactions', 'trg_treasury_transactions_updated_at', 'touch_updated_at');
  END IF;

  IF to_regclass('public.settlement_batches') IS NOT NULL THEN
    PERFORM pg_temp.assert_public_relation_kind('settlement_batches');
    PERFORM pg_temp.assert_public_column_definition('settlement_batches', 'id', 'uuid', true, 'gen_random_uuid');
    PERFORM pg_temp.assert_public_column_definition('settlement_batches', 'merchant_id', 'uuid', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('settlement_batches', 'status', 'varchar', true, 'queued');
    PERFORM pg_temp.assert_public_primary_key('settlement_batches', ARRAY['id']);
    PERFORM pg_temp.assert_public_foreign_key(
      'settlement_batches',
      'settlement_batches_merchant_id_fkey',
      ARRAY['merchant_id'],
      'merchants',
      ARRAY['id'],
      'CASCADE'
    );
    PERFORM pg_temp.assert_public_constraint_contains('settlement_batches', 'settlement_batches_status_check', 'c', ARRAY['queued', 'processing', 'settled', 'failed', 'held', 'reversed']);
    PERFORM pg_temp.assert_public_index_contains('idx_settlement_batches_merchant_status', ARRAY['public.settlement_batches', 'merchant_id', 'status']);
    PERFORM pg_temp.assert_public_trigger_function('settlement_batches', 'trg_settlement_batches_updated_at', 'touch_updated_at');
  END IF;

  IF to_regclass('public.treasury_webhook_logs') IS NOT NULL THEN
    PERFORM pg_temp.assert_public_relation_kind('treasury_webhook_logs');
    PERFORM pg_temp.assert_public_column_definition('treasury_webhook_logs', 'id', 'uuid', true, 'gen_random_uuid');
    PERFORM pg_temp.assert_public_column_definition('treasury_webhook_logs', 'provider', 'varchar', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('treasury_webhook_logs', 'event_type', 'text', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('treasury_webhook_logs', 'status', 'varchar', true, 'received');
    PERFORM pg_temp.assert_public_primary_key('treasury_webhook_logs', ARRAY['id']);
    PERFORM pg_temp.assert_public_constraint_contains('treasury_webhook_logs', 'treasury_webhook_logs_status_check', 'c', ARRAY['received', 'processed', 'duplicate', 'failed', 'under_review']);
    PERFORM pg_temp.assert_public_index_contains('idx_treasury_webhook_logs_provider_created', ARRAY['public.treasury_webhook_logs', 'provider', 'created_at']);
    PERFORM pg_temp.assert_public_index_contains('idx_treasury_webhook_logs_status', ARRAY['public.treasury_webhook_logs', 'status', 'created_at']);
  END IF;

  IF to_regclass('public.crypto_payment_sessions') IS NOT NULL THEN
    PERFORM pg_temp.assert_public_relation_kind('crypto_payment_sessions');
    PERFORM pg_temp.assert_public_column_definition('crypto_payment_sessions', 'id', 'uuid', true, 'gen_random_uuid');
    PERFORM pg_temp.assert_public_column_definition('crypto_payment_sessions', 'payment_purpose', 'varchar', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('crypto_payment_sessions', 'provider_name', 'varchar', true, 'breet');
    PERFORM pg_temp.assert_public_column_definition('crypto_payment_sessions', 'internal_reference', 'text', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('crypto_payment_sessions', 'expected_ngn_amount', 'numeric', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('crypto_payment_sessions', 'settlement_mode', 'varchar', true, 'disabled');
    PERFORM pg_temp.assert_public_column_definition('crypto_payment_sessions', 'settlement_status', 'varchar', true, 'pending');
    PERFORM pg_temp.assert_public_primary_key('crypto_payment_sessions', ARRAY['id']);
    PERFORM pg_temp.assert_public_constraint_contains('crypto_payment_sessions', 'crypto_payment_sessions_payment_purpose_check', 'c', ARRAY['plan_subscription', 'plan_upgrade', 'plan_renewal']);
    PERFORM pg_temp.assert_public_constraint_contains('crypto_payment_sessions', 'crypto_payment_sessions_provider_name_check', 'c', ARRAY['breet', 'paystack', 'monnify']);
    PERFORM pg_temp.assert_public_constraint_contains('crypto_payment_sessions', 'crypto_payment_sessions_settlement_mode_check', 'c', ARRAY['breet_auto_settlement', 'platform_auto_settlement', 'treasury_manual', 'disabled']);
    PERFORM pg_temp.assert_public_constraint_contains('crypto_payment_sessions', 'crypto_payment_sessions_settlement_status_check', 'c', ARRAY['pending', 'processing', 'completed', 'failed', 'manual_review', 'not_applicable']);
    PERFORM pg_temp.assert_public_index_contains('idx_crypto_payment_sessions_merchant_status', ARRAY['public.crypto_payment_sessions', 'merchant_id', 'crypto_status']);
    PERFORM pg_temp.assert_public_index_contains('idx_crypto_payment_sessions_provider_reference', ARRAY['public.crypto_payment_sessions', 'provider_name', 'provider_reference']);
    PERFORM pg_temp.assert_public_index_contains('idx_crypto_payment_sessions_provider_reference_unique', ARRAY['public.crypto_payment_sessions', 'provider_name', 'provider_reference', 'where']);
    PERFORM pg_temp.assert_public_index_contains('idx_crypto_payment_sessions_internal_reference', ARRAY['public.crypto_payment_sessions', 'internal_reference']);
    PERFORM pg_temp.assert_public_trigger_function('crypto_payment_sessions', 'trg_crypto_payment_sessions_updated_at', 'touch_updated_at');
  END IF;

  IF to_regclass('public.merchant_settlement_accounts') IS NOT NULL THEN
    PERFORM pg_temp.assert_public_relation_kind('merchant_settlement_accounts');
    PERFORM pg_temp.assert_public_column_definition('merchant_settlement_accounts', 'id', 'uuid', true, 'gen_random_uuid');
    PERFORM pg_temp.assert_public_column_definition('merchant_settlement_accounts', 'merchant_id', 'uuid', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('merchant_settlement_accounts', 'account_number', 'varchar', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('merchant_settlement_accounts', 'is_default', 'bool', true, 'false');
    PERFORM pg_temp.assert_public_column_definition('merchant_settlement_accounts', 'verification_status', 'varchar', true, 'pending');
    PERFORM pg_temp.assert_public_column_definition('merchant_settlement_accounts', 'status', 'varchar', true, 'active');
    PERFORM pg_temp.assert_public_primary_key('merchant_settlement_accounts', ARRAY['id']);
    PERFORM pg_temp.assert_public_foreign_key(
      'merchant_settlement_accounts',
      'merchant_settlement_accounts_merchant_id_fkey',
      ARRAY['merchant_id'],
      'merchants',
      ARRAY['id'],
      'CASCADE'
    );
    PERFORM pg_temp.assert_public_constraint_contains('merchant_settlement_accounts', 'merchant_settlement_accounts_verification_status_check', 'c', ARRAY['pending', 'verified', 'failed', 'manual_review']);
    PERFORM pg_temp.assert_public_constraint_contains('merchant_settlement_accounts', 'merchant_settlement_accounts_status_check', 'c', ARRAY['active', 'inactive', 'disabled']);
    PERFORM pg_temp.assert_public_index_contains('idx_merchant_settlement_accounts_default', ARRAY['public.merchant_settlement_accounts', 'merchant_id', 'where']);
    PERFORM pg_temp.assert_public_index_contains('idx_merchant_settlement_accounts_merchant', ARRAY['public.merchant_settlement_accounts', 'merchant_id', 'status', 'verification_status']);
    PERFORM pg_temp.assert_public_trigger_function('merchant_settlement_accounts', 'trg_merchant_settlement_accounts_updated_at', 'touch_updated_at');
    PERFORM pg_temp.assert_public_rls_state('merchant_settlement_accounts', true);
    PERFORM pg_temp.assert_public_permissive_select_policy_safe(
      'merchant_settlement_accounts',
      'merchant_read_settlement_accounts',
      ARRAY['public'],
      v_settlement_accounts_policy_using
    );
    PERFORM pg_temp.assert_public_policy_compatible(
      'merchant_settlement_accounts',
      'merchant_read_settlement_accounts',
      'SELECT',
      ARRAY['public'],
      ARRAY[v_settlement_accounts_policy_using]
    );
  END IF;

  IF to_regclass('public.merchant_provider_settlement_accounts') IS NOT NULL THEN
    PERFORM pg_temp.assert_public_relation_kind('merchant_provider_settlement_accounts');
    PERFORM pg_temp.assert_public_column_definition('merchant_provider_settlement_accounts', 'id', 'uuid', true, 'gen_random_uuid');
    PERFORM pg_temp.assert_public_column_definition('merchant_provider_settlement_accounts', 'merchant_id', 'uuid', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('merchant_provider_settlement_accounts', 'settlement_account_id', 'uuid', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('merchant_provider_settlement_accounts', 'provider_name', 'varchar', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('merchant_provider_settlement_accounts', 'status', 'varchar', true, 'pending');
    PERFORM pg_temp.assert_public_column_definition('merchant_provider_settlement_accounts', 'environment', 'varchar', true, 'sandbox');
    PERFORM pg_temp.assert_public_primary_key('merchant_provider_settlement_accounts', ARRAY['id']);
    PERFORM pg_temp.assert_public_unique_contains('merchant_provider_settlement_accounts', ARRAY['settlement_account_id', 'provider_name', 'environment']);
    PERFORM pg_temp.assert_public_foreign_key(
      'merchant_provider_settlement_accounts',
      'mpsa_settlement_account_id_fkey',
      ARRAY['settlement_account_id'],
      'merchant_settlement_accounts',
      ARRAY['id'],
      'CASCADE'
    );
    PERFORM pg_temp.assert_public_constraint_contains('merchant_provider_settlement_accounts', 'merchant_provider_settlement_accounts_provider_name_check', 'c', ARRAY['paystack', 'monnify', 'breet', 'future_provider']);
    PERFORM pg_temp.assert_public_constraint_contains('merchant_provider_settlement_accounts', 'merchant_provider_settlement_accounts_status_check', 'c', ARRAY['pending', 'connected', 'active', 'temporarily_unavailable']);
    PERFORM pg_temp.assert_public_constraint_contains('merchant_provider_settlement_accounts', 'merchant_provider_settlement_accounts_environment_check', 'c', ARRAY['sandbox', 'live']);
    PERFORM pg_temp.assert_public_index_contains('idx_merchant_provider_settlement_accounts_merchant', ARRAY['public.merchant_provider_settlement_accounts', 'merchant_id', 'provider_name', 'environment', 'status']);
    PERFORM pg_temp.assert_public_trigger_function('merchant_provider_settlement_accounts', 'trg_merchant_provider_settlement_accounts_updated_at', 'touch_updated_at');
    PERFORM pg_temp.assert_public_rls_state('merchant_provider_settlement_accounts', true);
    PERFORM pg_temp.assert_public_permissive_select_policy_safe(
      'merchant_provider_settlement_accounts',
      'merchant_read_provider_settlement_accounts',
      ARRAY['public'],
      v_provider_settlement_accounts_policy_using
    );
    PERFORM pg_temp.assert_public_policy_compatible(
      'merchant_provider_settlement_accounts',
      'merchant_read_provider_settlement_accounts',
      'SELECT',
      ARRAY['public'],
      ARRAY[v_provider_settlement_accounts_policy_using]
    );
  END IF;

  IF to_regclass('public.settlement_records') IS NOT NULL THEN
    PERFORM pg_temp.assert_public_relation_kind('settlement_records');
    PERFORM pg_temp.assert_public_column_definition('settlement_records', 'id', 'uuid', true, 'gen_random_uuid');
    PERFORM pg_temp.assert_public_column_definition('settlement_records', 'payment_record_id', 'uuid', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('settlement_records', 'merchant_id', 'uuid', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('settlement_records', 'provider_name', 'varchar', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('settlement_records', 'settlement_currency', 'varchar', true, 'NGN');
    PERFORM pg_temp.assert_public_column_definition('settlement_records', 'settlement_status', 'varchar', true, 'pending');
    PERFORM pg_temp.assert_public_column_definition('settlement_records', 'settlement_mode', 'text', true, 'provider_direct');
    PERFORM pg_temp.assert_public_column_definition('settlement_records', 'settlement_owner', 'text', true, 'provider');
    PERFORM pg_temp.assert_public_primary_key('settlement_records', ARRAY['id']);
    PERFORM pg_temp.assert_public_unique_contains('settlement_records', ARRAY['payment_record_id']);
    PERFORM pg_temp.assert_public_foreign_key(
      'settlement_records',
      'settlement_records_payment_record_id_fkey',
      ARRAY['payment_record_id'],
      'payment_records',
      ARRAY['id'],
      'CASCADE'
    );
    PERFORM pg_temp.assert_public_constraint_contains('settlement_records', 'settlement_records_settlement_status_check', 'c', ARRAY['pending', 'processing', 'completed', 'manual_review']);
    PERFORM pg_temp.assert_public_constraint_contains('settlement_records', 'settlement_records_settlement_mode_check', 'c', ARRAY['provider_direct', 'breet_auto_settlement', 'platform_auto_settlement', 'treasury_manual', 'treasury_payout_required', 'disabled']);
    PERFORM pg_temp.assert_public_constraint_contains('settlement_records', 'settlement_records_settlement_owner_check', 'c', ARRAY['provider', 'deraledger_treasury', 'manual_review']);
    PERFORM pg_temp.assert_public_index_contains('idx_settlement_records_merchant', ARRAY['public.settlement_records', 'merchant_id', 'settlement_status']);
    PERFORM pg_temp.assert_public_index_contains('idx_settlement_records_provider', ARRAY['public.settlement_records', 'provider_name', 'provider_settlement_reference']);
    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'public.settlement_records'::regclass
        AND conname = 'settlement_records_provider_settlement_batch_id_fkey'
    ) THEN
      PERFORM pg_temp.assert_public_foreign_key(
        'settlement_records',
        'settlement_records_provider_settlement_batch_id_fkey',
        ARRAY['provider_settlement_batch_id'],
        'provider_settlement_batches',
        ARRAY['id'],
        'SET NULL'
      );
    END IF;
    PERFORM pg_temp.assert_public_trigger_function('settlement_records', 'trg_settlement_records_updated_at', 'touch_updated_at');
    PERFORM pg_temp.assert_public_rls_state('settlement_records', true);
    PERFORM pg_temp.assert_public_permissive_select_policy_safe(
      'settlement_records',
      'merchant_read_settlement_records',
      ARRAY['public'],
      v_settlement_records_policy_using
    );
    PERFORM pg_temp.assert_public_policy_compatible(
      'settlement_records',
      'merchant_read_settlement_records',
      'SELECT',
      ARRAY['public'],
      ARRAY[v_settlement_records_policy_using]
    );
  END IF;

  IF to_regclass('public.settlement_reconciliation_logs') IS NOT NULL THEN
    PERFORM pg_temp.assert_public_relation_kind('settlement_reconciliation_logs');
    PERFORM pg_temp.assert_public_column_definition('settlement_reconciliation_logs', 'id', 'uuid', true, 'gen_random_uuid');
    PERFORM pg_temp.assert_public_column_definition('settlement_reconciliation_logs', 'provider_name', 'varchar', true, NULL);
    PERFORM pg_temp.assert_public_primary_key('settlement_reconciliation_logs', ARRAY['id']);
    PERFORM pg_temp.assert_public_constraint_contains('settlement_reconciliation_logs', 'settlement_reconciliation_logs_checked_by_check', 'c', ARRAY['system', 'admin', 'scheduled_job', 'webhook']);
    PERFORM pg_temp.assert_public_index_contains('idx_settlement_reconciliation_logs_record', ARRAY['public.settlement_reconciliation_logs', 'settlement_record_id', 'created_at']);
  END IF;

  IF to_regclass('public.provider_settlement_batches') IS NOT NULL THEN
    PERFORM pg_temp.assert_public_relation_kind('provider_settlement_batches');
    PERFORM pg_temp.assert_public_column_definition('provider_settlement_batches', 'id', 'uuid', true, 'gen_random_uuid');
    PERFORM pg_temp.assert_public_column_definition('provider_settlement_batches', 'provider_name', 'text', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('provider_settlement_batches', 'merchant_id', 'uuid', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('provider_settlement_batches', 'settlement_mode', 'text', true, 'provider_direct');
    PERFORM pg_temp.assert_public_column_definition('provider_settlement_batches', 'settlement_owner', 'text', true, 'provider');
    PERFORM pg_temp.assert_public_column_definition('provider_settlement_batches', 'settlement_status', 'text', true, 'pending');
    PERFORM pg_temp.assert_public_primary_key('provider_settlement_batches', ARRAY['id']);
    PERFORM pg_temp.assert_public_constraint_contains('provider_settlement_batches', 'provider_settlement_batches_provider_name_check', 'c', ARRAY['paystack', 'monnify', 'breet', 'future_provider']);
    PERFORM pg_temp.assert_public_constraint_contains('provider_settlement_batches', 'provider_settlement_batches_settlement_mode_check', 'c', ARRAY['provider_direct', 'treasury_payout_required']);
    PERFORM pg_temp.assert_public_constraint_contains('provider_settlement_batches', 'provider_settlement_batches_settlement_owner_check', 'c', ARRAY['provider', 'deraledger_treasury', 'manual_review']);
    PERFORM pg_temp.assert_public_constraint_contains('provider_settlement_batches', 'provider_settlement_batches_settlement_status_check', 'c', ARRAY['pending', 'processing', 'completed', 'failed', 'disputed', 'manual_review']);
    PERFORM pg_temp.assert_public_index_contains('idx_provider_settlement_batches_provider_ref', ARRAY['public.provider_settlement_batches', 'provider_name', 'provider_batch_reference', 'where']);
    PERFORM pg_temp.assert_public_index_contains('idx_provider_settlement_batches_merchant', ARRAY['public.provider_settlement_batches', 'merchant_id', 'settlement_status']);
    PERFORM pg_temp.assert_public_index_contains('idx_provider_settlement_batches_account', ARRAY['public.provider_settlement_batches', 'settlement_account_id', 'created_at']);
    PERFORM pg_temp.assert_public_trigger_function('provider_settlement_batches', 'trg_provider_settlement_batches_updated_at', 'touch_updated_at');
    PERFORM pg_temp.assert_public_rls_state('provider_settlement_batches', true);
    PERFORM pg_temp.assert_public_permissive_select_policy_safe(
      'provider_settlement_batches',
      'merchant_read_provider_batches',
      ARRAY['public'],
      v_provider_batches_policy_using
    );
    PERFORM pg_temp.assert_public_policy_compatible(
      'provider_settlement_batches',
      'merchant_read_provider_batches',
      'SELECT',
      ARRAY['public'],
      ARRAY[v_provider_batches_policy_using]
    );
  END IF;

  IF to_regclass('public.provider_settlement_batch_items') IS NOT NULL THEN
    PERFORM pg_temp.assert_public_relation_kind('provider_settlement_batch_items');
    PERFORM pg_temp.assert_public_column_definition('provider_settlement_batch_items', 'id', 'uuid', true, 'gen_random_uuid');
    PERFORM pg_temp.assert_public_column_definition('provider_settlement_batch_items', 'provider_settlement_batch_id', 'uuid', true, NULL);
    PERFORM pg_temp.assert_public_column_definition('provider_settlement_batch_items', 'settlement_record_id', 'uuid', true, NULL);
    PERFORM pg_temp.assert_public_primary_key('provider_settlement_batch_items', ARRAY['id']);
    PERFORM pg_temp.assert_public_unique_contains('provider_settlement_batch_items', ARRAY['settlement_record_id']);
    PERFORM pg_temp.assert_public_foreign_key(
      'provider_settlement_batch_items',
      'psbi_provider_batch_id_fkey',
      ARRAY['provider_settlement_batch_id'],
      'provider_settlement_batches',
      ARRAY['id'],
      'CASCADE'
    );
    PERFORM pg_temp.assert_public_foreign_key(
      'provider_settlement_batch_items',
      'provider_settlement_batch_items_settlement_record_id_fkey',
      ARRAY['settlement_record_id'],
      'settlement_records',
      ARRAY['id'],
      'CASCADE'
    );
    PERFORM pg_temp.assert_public_index_contains('idx_provider_settlement_batch_items_batch', ARRAY['public.provider_settlement_batch_items', 'provider_settlement_batch_id', 'created_at']);
  END IF;

  IF to_regclass('public.payment_records') IS NOT NULL THEN
    NULL;
  END IF;
END;
$$;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_provider TEXT DEFAULT 'paystack',
  ADD COLUMN IF NOT EXISTS crypto_deposit_address TEXT,
  ADD COLUMN IF NOT EXISTS crypto_asset TEXT,
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'PENDING';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_payment_status_check'
  ) THEN
    ALTER TABLE public.invoices DROP CONSTRAINT invoices_payment_status_check;
  END IF;

  ALTER TABLE public.invoices
    ADD CONSTRAINT invoices_payment_status_check
    CHECK (payment_status IN (
      'PENDING',
      'AWAITING_CONFIRMATION',
      'CONFIRMED',
      'UNDER_REVIEW',
      'SETTLEMENT_PENDING',
      'SETTLED',
      'FAILED',
      'EXPIRED',
      'REFUNDED'
    ));
END;
$$;

CREATE INDEX IF NOT EXISTS idx_invoices_payment_status
  ON public.invoices(merchant_id, payment_status, updated_at DESC);

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS payment_rail TEXT,
  ADD COLUMN IF NOT EXISTS settlement_status TEXT,
  ADD COLUMN IF NOT EXISTS processor_reference TEXT,
  ADD COLUMN IF NOT EXISTS source_currency TEXT,
  ADD COLUMN IF NOT EXISTS source_amount NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS fx_rate NUMERIC(20,4),
  ADD COLUMN IF NOT EXISTS merchant_net_amount NUMERIC(20,2),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.transactions'::regclass
      AND conname = 'transactions_payment_method_check'
  ) THEN
    ALTER TABLE public.transactions DROP CONSTRAINT transactions_payment_method_check;
  END IF;

  ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_payment_method_check
    CHECK (payment_method IN ('card', 'bank_transfer', 'ussd', 'crypto', 'usdt', 'usdc', 'btc', 'eth'));
END;
$$;

ALTER TABLE public.payment_records
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS business_id UUID,
  ADD COLUMN IF NOT EXISTS plan_id TEXT,
  ADD COLUMN IF NOT EXISTS plan_name TEXT,
  ADD COLUMN IF NOT EXISTS expected_amount NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'pending_payment',
  ADD COLUMN IF NOT EXISTS account_setup_status TEXT NOT NULL DEFAULT 'pending_payment',
  ADD COLUMN IF NOT EXISTS password_setup_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settlement_destination_source TEXT,
  ADD COLUMN IF NOT EXISTS reconciliation_status TEXT NOT NULL DEFAULT 'pending_reconciliation',
  ADD COLUMN IF NOT EXISTS setup_recovery_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS setup_recovery_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS setup_recovery_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS setup_recovery_email_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS setup_completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_payment_records_merchant
  ON public.payment_records(merchant_id, payment_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_records_provider_reference
  ON public.payment_records(provider_name, provider_reference);

CREATE INDEX IF NOT EXISTS idx_payment_records_plan_recovery
  ON public.payment_records(payment_purpose, processing_status, account_setup_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_records_customer_email
  ON public.payment_records(customer_email, created_at DESC);

DROP TRIGGER IF EXISTS trg_payment_records_updated_at ON public.payment_records;
CREATE TRIGGER trg_payment_records_updated_at
BEFORE UPDATE ON public.payment_records
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID,
  invoice_id UUID,
  transaction_id UUID,
  event_type TEXT NOT NULL,
  processor TEXT NOT NULL,
  processor_ref TEXT,
  amount_kobo BIGINT,
  raw_payload JSONB,
  processed_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT,
  payment_method TEXT,
  payment_purpose TEXT,
  payment_reference TEXT,
  provider_reference TEXT,
  expected_amount NUMERIC(18,2),
  paid_amount NUMERIC(18,2),
  currency TEXT NOT NULL DEFAULT 'NGN',
  fee NUMERIC(18,2),
  plan_id TEXT,
  subscription_id UUID,
  business_id UUID,
  customer_email TEXT,
  processing_status TEXT NOT NULL DEFAULT 'received',
  failure_reason TEXT,
  settlement_destination_source TEXT,
  reconciliation_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_events_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE,
  CONSTRAINT payment_events_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL
);

ALTER TABLE public.payment_events
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS amount_kobo BIGINT,
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS payment_purpose TEXT,
  ADD COLUMN IF NOT EXISTS payment_reference TEXT,
  ADD COLUMN IF NOT EXISTS provider_reference TEXT,
  ADD COLUMN IF NOT EXISTS expected_amount NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS fee NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS plan_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_id UUID,
  ADD COLUMN IF NOT EXISTS business_id UUID,
  ADD COLUMN IF NOT EXISTS customer_email TEXT,
  ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'received',
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS settlement_destination_source TEXT,
  ADD COLUMN IF NOT EXISTS reconciliation_status TEXT;

DO $$
DECLARE
  v_actual_columns TEXT[];
  v_actual_ref_schema TEXT;
  v_actual_ref_table TEXT;
  v_actual_ref_columns TEXT[];
  v_actual_delete_action TEXT;
BEGIN
  SELECT
    array_agg(src.attname ORDER BY src_ord.ordinality),
    ref_ns.nspname,
    ref_cls.relname,
    array_agg(ref.attname ORDER BY ref_ord.ordinality),
    CASE con.confdeltype
      WHEN 'a' THEN 'NO ACTION'
      WHEN 'r' THEN 'RESTRICT'
      WHEN 'c' THEN 'CASCADE'
      WHEN 'n' THEN 'SET NULL'
      WHEN 'd' THEN 'SET DEFAULT'
    END
  INTO
    v_actual_columns,
    v_actual_ref_schema,
    v_actual_ref_table,
    v_actual_ref_columns,
    v_actual_delete_action
  FROM pg_constraint con
  JOIN pg_class ref_cls ON ref_cls.oid = con.confrelid
  JOIN pg_namespace ref_ns ON ref_ns.oid = ref_cls.relnamespace
  CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS src_ord(attnum, ordinality)
  JOIN pg_attribute src
    ON src.attrelid = con.conrelid
   AND src.attnum = src_ord.attnum
  CROSS JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS ref_ord(attnum, ordinality)
  JOIN pg_attribute ref
    ON ref.attrelid = con.confrelid
   AND ref.attnum = ref_ord.attnum
   AND ref_ord.ordinality = src_ord.ordinality
  WHERE con.conrelid = 'public.payment_events'::regclass
    AND con.conname = 'payment_events_merchant_id_fkey'
    AND con.contype = 'f'
  GROUP BY ref_ns.nspname, ref_cls.relname, con.confdeltype;

  IF v_actual_columns IS NULL THEN
    ALTER TABLE public.payment_events
      ADD CONSTRAINT payment_events_merchant_id_fkey
      FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;
    RETURN;
  END IF;

  IF v_actual_columns <> ARRAY['merchant_id']
     OR v_actual_ref_schema <> 'public'
     OR v_actual_ref_table <> 'merchants'
     OR v_actual_ref_columns <> ARRAY['id'] THEN
    RAISE EXCEPTION 'Migration A compatibility failure: schema=public object=payment_events.payment_events_merchant_id_fkey expected=merchant_id references public.merchants(id) actual=%.%(%)->%',
      v_actual_ref_schema,
      v_actual_ref_table,
      v_actual_ref_columns,
      v_actual_columns;
  END IF;

  IF v_actual_delete_action <> 'CASCADE' THEN
    ALTER TABLE public.payment_events
      DROP CONSTRAINT payment_events_merchant_id_fkey;
    ALTER TABLE public.payment_events
      ADD CONSTRAINT payment_events_merchant_id_fkey
      FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_payment_events_created_at
  ON public.payment_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_events_payment_reference
  ON public.payment_events(payment_reference, provider_reference, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_events_processor_ref
  ON public.payment_events(processor, processor_ref);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_events_idempotency
  ON public.payment_events(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP TRIGGER IF EXISTS trg_payment_events_updated_at ON public.payment_events;
CREATE TRIGGER trg_payment_events_updated_at
BEFORE UPDATE ON public.payment_events
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.payment_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name TEXT NOT NULL,
  environment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'inactive',
  allow_degraded_routing BOOLEAN NOT NULL DEFAULT false,
  supports_card BOOLEAN NOT NULL DEFAULT false,
  supports_bank_transfer BOOLEAN NOT NULL DEFAULT false,
  supports_ussd BOOLEAN NOT NULL DEFAULT false,
  supports_crypto BOOLEAN NOT NULL DEFAULT false,
  public_key_hint TEXT,
  merchant_id_hint TEXT,
  webhook_secret_hint TEXT,
  last_health_check_at TIMESTAMPTZ,
  last_successful_webhook_at TIMESTAMPTZ,
  last_failed_webhook_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_name, environment)
);

ALTER TABLE public.payment_providers
  ADD COLUMN IF NOT EXISTS allow_degraded_routing BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supports_card BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supports_bank_transfer BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supports_ussd BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supports_crypto BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_key_hint TEXT,
  ADD COLUMN IF NOT EXISTS merchant_id_hint TEXT,
  ADD COLUMN IF NOT EXISTS webhook_secret_hint TEXT,
  ADD COLUMN IF NOT EXISTS last_health_check_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_successful_webhook_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_failed_webhook_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payment_providers'::regclass
      AND conname = 'payment_providers_provider_name_check'
  ) THEN
    ALTER TABLE public.payment_providers DROP CONSTRAINT payment_providers_provider_name_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payment_providers'::regclass
      AND conname = 'payment_providers_environment_check'
  ) THEN
    ALTER TABLE public.payment_providers DROP CONSTRAINT payment_providers_environment_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payment_providers'::regclass
      AND conname = 'payment_providers_status_check'
  ) THEN
    ALTER TABLE public.payment_providers DROP CONSTRAINT payment_providers_status_check;
  END IF;

  ALTER TABLE public.payment_providers
    ADD CONSTRAINT payment_providers_provider_name_check
    CHECK (provider_name IN ('paystack', 'monnify', 'breet'));

  ALTER TABLE public.payment_providers
    ADD CONSTRAINT payment_providers_environment_check
    CHECK (environment IN ('sandbox', 'live'));

  ALTER TABLE public.payment_providers
    ADD CONSTRAINT payment_providers_status_check
    CHECK (status IN ('active', 'inactive', 'degraded', 'down', 'pending_live_approval', 'sandbox_only'));
END;
$$;

CREATE INDEX IF NOT EXISTS idx_payment_providers_environment_status
  ON public.payment_providers(environment, status);

DROP TRIGGER IF EXISTS trg_payment_providers_updated_at ON public.payment_providers;
CREATE TRIGGER trg_payment_providers_updated_at
BEFORE UPDATE ON public.payment_providers
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.payment_method_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_purpose TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  environment TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  display_label TEXT NOT NULL,
  display_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_purpose, payment_method, environment)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payment_method_configs'::regclass
      AND conname = 'payment_method_configs_payment_purpose_check'
  ) THEN
    ALTER TABLE public.payment_method_configs DROP CONSTRAINT payment_method_configs_payment_purpose_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payment_method_configs'::regclass
      AND conname = 'payment_method_configs_payment_method_check'
  ) THEN
    ALTER TABLE public.payment_method_configs DROP CONSTRAINT payment_method_configs_payment_method_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payment_method_configs'::regclass
      AND conname = 'payment_method_configs_environment_check'
  ) THEN
    ALTER TABLE public.payment_method_configs DROP CONSTRAINT payment_method_configs_environment_check;
  END IF;

  ALTER TABLE public.payment_method_configs
    ADD CONSTRAINT payment_method_configs_payment_purpose_check
    CHECK (payment_purpose IN ('plan_subscription', 'plan_upgrade', 'plan_renewal', 'invoice_payment', 'payment_link', 'crypto_payment'));

  ALTER TABLE public.payment_method_configs
    ADD CONSTRAINT payment_method_configs_payment_method_check
    CHECK (payment_method IN ('card', 'bank_transfer', 'ussd', 'crypto'));

  ALTER TABLE public.payment_method_configs
    ADD CONSTRAINT payment_method_configs_environment_check
    CHECK (environment IN ('sandbox', 'live'));
END;
$$;

CREATE INDEX IF NOT EXISTS idx_payment_method_configs_lookup
  ON public.payment_method_configs(payment_purpose, environment, is_enabled);

DROP TRIGGER IF EXISTS trg_payment_method_configs_updated_at ON public.payment_method_configs;
CREATE TRIGGER trg_payment_method_configs_updated_at
BEFORE UPDATE ON public.payment_method_configs
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.payment_provider_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_purpose TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  primary_provider TEXT NOT NULL,
  fallback_provider TEXT,
  environment TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_purpose, payment_method, environment)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payment_provider_routes'::regclass
      AND conname = 'payment_provider_routes_payment_purpose_check'
  ) THEN
    ALTER TABLE public.payment_provider_routes DROP CONSTRAINT payment_provider_routes_payment_purpose_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payment_provider_routes'::regclass
      AND conname = 'payment_provider_routes_payment_method_check'
  ) THEN
    ALTER TABLE public.payment_provider_routes DROP CONSTRAINT payment_provider_routes_payment_method_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payment_provider_routes'::regclass
      AND conname = 'payment_provider_routes_primary_provider_check'
  ) THEN
    ALTER TABLE public.payment_provider_routes DROP CONSTRAINT payment_provider_routes_primary_provider_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payment_provider_routes'::regclass
      AND conname = 'payment_provider_routes_fallback_provider_check'
  ) THEN
    ALTER TABLE public.payment_provider_routes DROP CONSTRAINT payment_provider_routes_fallback_provider_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payment_provider_routes'::regclass
      AND conname = 'payment_provider_routes_environment_check'
  ) THEN
    ALTER TABLE public.payment_provider_routes DROP CONSTRAINT payment_provider_routes_environment_check;
  END IF;

  ALTER TABLE public.payment_provider_routes
    ADD CONSTRAINT payment_provider_routes_payment_purpose_check
    CHECK (payment_purpose IN ('plan_subscription', 'plan_upgrade', 'plan_renewal', 'invoice_payment', 'payment_link', 'crypto_payment'));

  ALTER TABLE public.payment_provider_routes
    ADD CONSTRAINT payment_provider_routes_payment_method_check
    CHECK (payment_method IN ('card', 'bank_transfer', 'ussd', 'crypto'));

  ALTER TABLE public.payment_provider_routes
    ADD CONSTRAINT payment_provider_routes_primary_provider_check
    CHECK (primary_provider IN ('paystack', 'monnify', 'breet'));

  ALTER TABLE public.payment_provider_routes
    ADD CONSTRAINT payment_provider_routes_fallback_provider_check
    CHECK (fallback_provider IS NULL OR fallback_provider IN ('paystack', 'monnify', 'breet'));

  ALTER TABLE public.payment_provider_routes
    ADD CONSTRAINT payment_provider_routes_environment_check
    CHECK (environment IN ('sandbox', 'live'));
END;
$$;

CREATE INDEX IF NOT EXISTS idx_payment_provider_routes_lookup
  ON public.payment_provider_routes(payment_purpose, payment_method, environment, is_enabled);

DROP TRIGGER IF EXISTS trg_payment_provider_routes_updated_at ON public.payment_provider_routes;
CREATE TRIGGER trg_payment_provider_routes_updated_at
BEFORE UPDATE ON public.payment_provider_routes
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.merchant_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  currency VARCHAR(10) NOT NULL,
  available_balance NUMERIC(20,2) NOT NULL DEFAULT 0,
  pending_balance NUMERIC(20,2) NOT NULL DEFAULT 0,
  locked_balance NUMERIC(20,2) NOT NULL DEFAULT 0,
  total_settled NUMERIC(20,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, currency)
);

CREATE TABLE IF NOT EXISTS public.payment_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  payment_rail VARCHAR(50) NOT NULL,
  provider_name VARCHAR(50) NOT NULL DEFAULT 'breet',
  payment_purpose VARCHAR(50) NOT NULL DEFAULT 'invoice_payment',
  payment_method VARCHAR(50) NOT NULL DEFAULT 'crypto',
  settlement_mode VARCHAR(50) NOT NULL DEFAULT 'disabled',
  settlement_recipient_type TEXT,
  source_currency VARCHAR(10) NOT NULL,
  destination_currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  amount_ngn NUMERIC(20,2) NOT NULL,
  amount_crypto NUMERIC(20,8) NOT NULL,
  exchange_rate NUMERIC(20,4) NOT NULL,
  wallet_address TEXT NOT NULL,
  wallet_provider_id TEXT,
  provider_wallet_id TEXT,
  network VARCHAR(50),
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  crypto_status VARCHAR(50) NOT NULL DEFAULT 'crypto_payment_initialized',
  confirmation_count INTEGER NOT NULL DEFAULT 0,
  expected_confirmations INTEGER NOT NULL DEFAULT 0,
  reference TEXT NOT NULL UNIQUE,
  provider_reference TEXT,
  tx_hash TEXT,
  crypto_amount_received NUMERIC(20,8),
  converted_ngn_amount NUMERIC(20,2),
  provider_fee NUMERIC(20,2) NOT NULL DEFAULT 0,
  settlement_fee NUMERIC(20,2) NOT NULL DEFAULT 0,
  expected_settlement_ngn NUMERIC(20,2),
  actual_settlement_ngn NUMERIC(20,2),
  amount_settled NUMERIC(20,2),
  settlement_currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  settlement_account_reference TEXT,
  settlement_account_snapshot JSONB,
  webhook_status TEXT NOT NULL DEFAULT 'pending',
  manual_review_reason TEXT,
  raw_webhook_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF to_regclass('public.payment_sessions') IS NOT NULL THEN
    PERFORM pg_temp.assert_public_column_type('payment_sessions', 'id', 'uuid');
    PERFORM pg_temp.assert_public_column_type('payment_sessions', 'invoice_id', 'uuid');
    PERFORM pg_temp.assert_public_column_type('payment_sessions', 'merchant_id', 'uuid');
    PERFORM pg_temp.assert_public_column_type('payment_sessions', 'reference', 'text');
  END IF;
END;
$$;

ALTER TABLE public.payment_sessions
  ADD COLUMN IF NOT EXISTS provider_name VARCHAR(50) NOT NULL DEFAULT 'breet',
  ADD COLUMN IF NOT EXISTS payment_purpose VARCHAR(50) NOT NULL DEFAULT 'invoice_payment',
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) NOT NULL DEFAULT 'crypto',
  ADD COLUMN IF NOT EXISTS settlement_mode VARCHAR(50) NOT NULL DEFAULT 'disabled',
  ADD COLUMN IF NOT EXISTS settlement_recipient_type TEXT,
  ADD COLUMN IF NOT EXISTS crypto_status VARCHAR(50) NOT NULL DEFAULT 'crypto_payment_initialized',
  ADD COLUMN IF NOT EXISTS crypto_amount_received NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS converted_ngn_amount NUMERIC(20,2),
  ADD COLUMN IF NOT EXISTS provider_fee NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settlement_fee NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_settlement_ngn NUMERIC(20,2),
  ADD COLUMN IF NOT EXISTS actual_settlement_ngn NUMERIC(20,2),
  ADD COLUMN IF NOT EXISTS amount_settled NUMERIC(20,2),
  ADD COLUMN IF NOT EXISTS settlement_currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS provider_wallet_id TEXT,
  ADD COLUMN IF NOT EXISTS settlement_account_reference TEXT,
  ADD COLUMN IF NOT EXISTS settlement_account_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS webhook_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS manual_review_reason TEXT,
  ADD COLUMN IF NOT EXISTS raw_webhook_payload JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payment_sessions'::regclass
      AND conname = 'payment_sessions_status_check'
  ) THEN
    ALTER TABLE public.payment_sessions DROP CONSTRAINT payment_sessions_status_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payment_sessions'::regclass
      AND conname = 'payment_sessions_crypto_status_check'
  ) THEN
    ALTER TABLE public.payment_sessions DROP CONSTRAINT payment_sessions_crypto_status_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payment_sessions'::regclass
      AND conname = 'payment_sessions_settlement_mode_check'
  ) THEN
    ALTER TABLE public.payment_sessions DROP CONSTRAINT payment_sessions_settlement_mode_check;
  END IF;

  ALTER TABLE public.payment_sessions
    ADD CONSTRAINT payment_sessions_status_check
    CHECK (status IN ('PENDING', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'UNDER_REVIEW', 'SETTLEMENT_PENDING', 'SETTLED', 'FAILED', 'EXPIRED', 'REFUNDED'));

  ALTER TABLE public.payment_sessions
    ADD CONSTRAINT payment_sessions_crypto_status_check
    CHECK (crypto_status IN (
      'crypto_payment_initialized',
      'crypto_payment_waiting',
      'crypto_payment_detected',
      'crypto_payment_confirming',
      'crypto_payment_confirmed',
      'crypto_underpaid',
      'crypto_overpaid',
      'crypto_expired',
      'crypto_converted_to_ngn',
      'crypto_settlement_pending',
      'crypto_settlement_completed',
      'crypto_settlement_failed',
      'manual_review',
      'failed'
    ));

  ALTER TABLE public.payment_sessions
    ADD CONSTRAINT payment_sessions_settlement_mode_check
    CHECK (settlement_mode IN ('breet_auto_settlement', 'platform_auto_settlement', 'treasury_manual', 'disabled'));
END;
$$;

CREATE INDEX IF NOT EXISTS idx_payment_sessions_invoice_status
  ON public.payment_sessions(invoice_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_sessions_merchant_status
  ON public.payment_sessions(merchant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_sessions_provider_status
  ON public.payment_sessions(provider_name, crypto_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_sessions_payment_purpose
  ON public.payment_sessions(payment_purpose, created_at DESC);

DROP TRIGGER IF EXISTS trg_payment_sessions_updated_at ON public.payment_sessions;
CREATE TRIGGER trg_payment_sessions_updated_at
BEFORE UPDATE ON public.payment_sessions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.treasury_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  payment_session_id UUID NOT NULL REFERENCES public.payment_sessions(id) ON DELETE CASCADE,
  payment_rail VARCHAR(50),
  source_currency VARCHAR(10),
  source_amount NUMERIC(20,8),
  exchange_rate NUMERIC(20,4),
  gross_ngn NUMERIC(20,2),
  platform_fee NUMERIC(20,2) NOT NULL DEFAULT 0,
  network_fee NUMERIC(20,2) NOT NULL DEFAULT 0,
  merchant_net_ngn NUMERIC(20,2),
  blockchain_tx_hash TEXT,
  breet_reference TEXT,
  settlement_reference TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'INITIATED',
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_session_id)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.treasury_transactions'::regclass
      AND conname = 'treasury_transactions_status_check'
  ) THEN
    ALTER TABLE public.treasury_transactions DROP CONSTRAINT treasury_transactions_status_check;
  END IF;

  ALTER TABLE public.treasury_transactions
    ADD CONSTRAINT treasury_transactions_status_check
    CHECK (status IN ('INITIATED', 'PAYMENT_DETECTED', 'BLOCKCHAIN_CONFIRMED', 'FX_CONVERTED', 'MERCHANT_PENDING', 'SETTLEMENT_QUEUED', 'SETTLED', 'FAILED', 'REVERSED'));
END;
$$;

CREATE INDEX IF NOT EXISTS idx_treasury_transactions_merchant_created
  ON public.treasury_transactions(merchant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_treasury_transactions_status
  ON public.treasury_transactions(status, created_at DESC);

DROP TRIGGER IF EXISTS trg_treasury_transactions_updated_at ON public.treasury_transactions;
CREATE TRIGGER trg_treasury_transactions_updated_at
BEFORE UPDATE ON public.treasury_transactions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.settlement_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  total_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  payout_provider VARCHAR(50),
  payout_reference TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'queued',
  processed_at TIMESTAMPTZ,
  failure_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.settlement_batches'::regclass
      AND conname = 'settlement_batches_status_check'
  ) THEN
    ALTER TABLE public.settlement_batches DROP CONSTRAINT settlement_batches_status_check;
  END IF;

  ALTER TABLE public.settlement_batches
    ADD CONSTRAINT settlement_batches_status_check
    CHECK (status IN ('queued', 'processing', 'settled', 'failed', 'held', 'reversed'));
END;
$$;

CREATE INDEX IF NOT EXISTS idx_settlement_batches_merchant_status
  ON public.settlement_batches(merchant_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_settlement_batches_updated_at ON public.settlement_batches;
CREATE TRIGGER trg_settlement_batches_updated_at
BEFORE UPDATE ON public.settlement_batches
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.treasury_webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(50) NOT NULL,
  event_type TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'received',
  processor_reference TEXT,
  merchant_id UUID REFERENCES public.merchants(id) ON DELETE SET NULL,
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  payment_session_id UUID REFERENCES public.payment_sessions(id) ON DELETE SET NULL,
  response_code INTEGER,
  error_message TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.treasury_webhook_logs'::regclass
      AND conname = 'treasury_webhook_logs_status_check'
  ) THEN
    ALTER TABLE public.treasury_webhook_logs DROP CONSTRAINT treasury_webhook_logs_status_check;
  END IF;

  ALTER TABLE public.treasury_webhook_logs
    ADD CONSTRAINT treasury_webhook_logs_status_check
    CHECK (status IN ('received', 'processed', 'duplicate', 'failed', 'under_review'));
END;
$$;

CREATE INDEX IF NOT EXISTS idx_treasury_webhook_logs_provider_created
  ON public.treasury_webhook_logs(provider, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_treasury_webhook_logs_status
  ON public.treasury_webhook_logs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.crypto_payment_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES public.merchants(id) ON DELETE SET NULL,
  user_id UUID,
  business_id UUID,
  plan_id TEXT,
  payment_purpose VARCHAR(50) NOT NULL,
  provider_name VARCHAR(50) NOT NULL DEFAULT 'breet',
  internal_reference TEXT NOT NULL UNIQUE,
  provider_reference TEXT,
  payment_method VARCHAR(50) NOT NULL DEFAULT 'crypto',
  expected_ngn_amount NUMERIC(20,2) NOT NULL,
  crypto_asset VARCHAR(20) NOT NULL,
  crypto_network VARCHAR(50) NOT NULL,
  crypto_amount_expected NUMERIC(20,8) NOT NULL,
  crypto_amount_received NUMERIC(20,8),
  converted_ngn_amount NUMERIC(20,2),
  conversion_rate NUMERIC(20,4),
  provider_fee NUMERIC(20,2) NOT NULL DEFAULT 0,
  settlement_fee NUMERIC(20,2) NOT NULL DEFAULT 0,
  expected_settlement_ngn NUMERIC(20,2),
  actual_settlement_ngn NUMERIC(20,2),
  amount_settled NUMERIC(20,2),
  settlement_mode VARCHAR(50) NOT NULL DEFAULT 'disabled',
  settlement_recipient_type TEXT,
  settlement_currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  provider_wallet_id TEXT,
  settlement_account_snapshot JSONB,
  crypto_status VARCHAR(50) NOT NULL DEFAULT 'crypto_payment_initialized',
  settlement_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  webhook_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  payment_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  payment_session_reference TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_webhook_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  manual_review_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF to_regclass('public.crypto_payment_sessions') IS NOT NULL THEN
    PERFORM pg_temp.assert_public_column_type('crypto_payment_sessions', 'id', 'uuid');
    PERFORM pg_temp.assert_public_column_type('crypto_payment_sessions', 'internal_reference', 'text');
    PERFORM pg_temp.assert_public_column_type('crypto_payment_sessions', 'expected_ngn_amount', 'numeric');
  END IF;
END;
$$;

ALTER TABLE public.crypto_payment_sessions
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS business_id UUID,
  ADD COLUMN IF NOT EXISTS plan_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_purpose VARCHAR(50) NOT NULL DEFAULT 'plan_subscription',
  ADD COLUMN IF NOT EXISTS provider_name VARCHAR(50) NOT NULL DEFAULT 'breet',
  ADD COLUMN IF NOT EXISTS provider_reference TEXT,
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) NOT NULL DEFAULT 'crypto',
  ADD COLUMN IF NOT EXISTS expected_ngn_amount NUMERIC(20,2),
  ADD COLUMN IF NOT EXISTS crypto_asset VARCHAR(20),
  ADD COLUMN IF NOT EXISTS crypto_network VARCHAR(50),
  ADD COLUMN IF NOT EXISTS crypto_amount_expected NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS crypto_amount_received NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS converted_ngn_amount NUMERIC(20,2),
  ADD COLUMN IF NOT EXISTS conversion_rate NUMERIC(20,4),
  ADD COLUMN IF NOT EXISTS provider_fee NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settlement_fee NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_settlement_ngn NUMERIC(20,2),
  ADD COLUMN IF NOT EXISTS actual_settlement_ngn NUMERIC(20,2),
  ADD COLUMN IF NOT EXISTS amount_settled NUMERIC(20,2),
  ADD COLUMN IF NOT EXISTS settlement_mode VARCHAR(50) NOT NULL DEFAULT 'disabled',
  ADD COLUMN IF NOT EXISTS settlement_recipient_type TEXT,
  ADD COLUMN IF NOT EXISTS settlement_currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS provider_wallet_id TEXT,
  ADD COLUMN IF NOT EXISTS settlement_account_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS crypto_status VARCHAR(50) NOT NULL DEFAULT 'crypto_payment_initialized',
  ADD COLUMN IF NOT EXISTS settlement_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS webhook_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payment_session_reference TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS raw_webhook_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS manual_review_reason TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.crypto_payment_sessions'::regclass
      AND conname = 'crypto_payment_sessions_payment_purpose_check'
  ) THEN
    ALTER TABLE public.crypto_payment_sessions DROP CONSTRAINT crypto_payment_sessions_payment_purpose_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.crypto_payment_sessions'::regclass
      AND conname = 'crypto_payment_sessions_provider_name_check'
  ) THEN
    ALTER TABLE public.crypto_payment_sessions DROP CONSTRAINT crypto_payment_sessions_provider_name_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.crypto_payment_sessions'::regclass
      AND conname = 'crypto_payment_sessions_settlement_mode_check'
  ) THEN
    ALTER TABLE public.crypto_payment_sessions DROP CONSTRAINT crypto_payment_sessions_settlement_mode_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.crypto_payment_sessions'::regclass
      AND conname = 'crypto_payment_sessions_crypto_status_check'
  ) THEN
    ALTER TABLE public.crypto_payment_sessions DROP CONSTRAINT crypto_payment_sessions_crypto_status_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.crypto_payment_sessions'::regclass
      AND conname = 'crypto_payment_sessions_settlement_status_check'
  ) THEN
    ALTER TABLE public.crypto_payment_sessions DROP CONSTRAINT crypto_payment_sessions_settlement_status_check;
  END IF;

  ALTER TABLE public.crypto_payment_sessions
    ADD CONSTRAINT crypto_payment_sessions_payment_purpose_check
    CHECK (payment_purpose IN ('plan_subscription', 'plan_upgrade', 'plan_renewal'));

  ALTER TABLE public.crypto_payment_sessions
    ADD CONSTRAINT crypto_payment_sessions_provider_name_check
    CHECK (provider_name IN ('breet', 'paystack', 'monnify'));

  ALTER TABLE public.crypto_payment_sessions
    ADD CONSTRAINT crypto_payment_sessions_settlement_mode_check
    CHECK (settlement_mode IN ('breet_auto_settlement', 'platform_auto_settlement', 'treasury_manual', 'disabled'));

  ALTER TABLE public.crypto_payment_sessions
    ADD CONSTRAINT crypto_payment_sessions_crypto_status_check
    CHECK (crypto_status IN (
      'crypto_payment_initialized',
      'crypto_payment_waiting',
      'crypto_payment_detected',
      'crypto_payment_confirming',
      'crypto_payment_confirmed',
      'crypto_underpaid',
      'crypto_overpaid',
      'crypto_expired',
      'crypto_converted_to_ngn',
      'crypto_settlement_pending',
      'crypto_settlement_completed',
      'crypto_settlement_failed',
      'manual_review',
      'failed'
    ));

  ALTER TABLE public.crypto_payment_sessions
    ADD CONSTRAINT crypto_payment_sessions_settlement_status_check
    CHECK (settlement_status IN ('pending', 'processing', 'completed', 'failed', 'manual_review', 'not_applicable'));
END;
$$;

CREATE INDEX IF NOT EXISTS idx_crypto_payment_sessions_merchant_status
  ON public.crypto_payment_sessions(merchant_id, crypto_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_crypto_payment_sessions_provider_reference
  ON public.crypto_payment_sessions(provider_name, provider_reference);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crypto_payment_sessions_provider_reference_unique
  ON public.crypto_payment_sessions(provider_name, provider_reference)
  WHERE provider_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crypto_payment_sessions_internal_reference
  ON public.crypto_payment_sessions(internal_reference);

DROP TRIGGER IF EXISTS trg_crypto_payment_sessions_updated_at ON public.crypto_payment_sessions;
CREATE TRIGGER trg_crypto_payment_sessions_updated_at
BEFORE UPDATE ON public.crypto_payment_sessions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.merchant_settlement_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  bank_name VARCHAR(255) NOT NULL,
  bank_code VARCHAR(50),
  account_number VARCHAR(30) NOT NULL,
  account_name VARCHAR(255) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  is_default BOOLEAN NOT NULL DEFAULT false,
  verification_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  raw_verification_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.merchant_settlement_accounts'::regclass
      AND conname = 'merchant_settlement_accounts_verification_status_check'
  ) THEN
    ALTER TABLE public.merchant_settlement_accounts DROP CONSTRAINT merchant_settlement_accounts_verification_status_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.merchant_settlement_accounts'::regclass
      AND conname = 'merchant_settlement_accounts_status_check'
  ) THEN
    ALTER TABLE public.merchant_settlement_accounts DROP CONSTRAINT merchant_settlement_accounts_status_check;
  END IF;

  ALTER TABLE public.merchant_settlement_accounts
    ADD CONSTRAINT merchant_settlement_accounts_verification_status_check
    CHECK (verification_status IN ('pending', 'verified', 'failed', 'manual_review'));

  ALTER TABLE public.merchant_settlement_accounts
    ADD CONSTRAINT merchant_settlement_accounts_status_check
    CHECK (status IN ('active', 'inactive', 'disabled'));
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_settlement_accounts_default
  ON public.merchant_settlement_accounts(merchant_id)
  WHERE is_default = true AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_merchant_settlement_accounts_merchant
  ON public.merchant_settlement_accounts(merchant_id, status, verification_status);

DROP TRIGGER IF EXISTS trg_merchant_settlement_accounts_updated_at ON public.merchant_settlement_accounts;
CREATE TRIGGER trg_merchant_settlement_accounts_updated_at
BEFORE UPDATE ON public.merchant_settlement_accounts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.merchant_provider_settlement_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  settlement_account_id UUID NOT NULL CONSTRAINT mpsa_settlement_account_id_fkey REFERENCES public.merchant_settlement_accounts(id) ON DELETE CASCADE,
  provider_name VARCHAR(50) NOT NULL,
  provider_account_reference VARCHAR(255),
  provider_subaccount_code VARCHAR(255),
  provider_split_reference VARCHAR(255),
  provider_recipient_reference VARCHAR(255),
  provider_auto_settlement_reference VARCHAR(255),
  provider_wallet_reference VARCHAR(255),
  provider_collection_address_reference VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  environment VARCHAR(20) NOT NULL DEFAULT 'sandbox',
  raw_provider_response JSONB,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (settlement_account_id, provider_name, environment)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.merchant_provider_settlement_accounts'::regclass
      AND conname = 'merchant_provider_settlement_account_settlement_account_id_fkey'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.merchant_provider_settlement_accounts'::regclass
      AND conname = 'mpsa_settlement_account_id_fkey'
  ) THEN
    ALTER TABLE public.merchant_provider_settlement_accounts
      RENAME CONSTRAINT merchant_provider_settlement_account_settlement_account_id_fkey
      TO mpsa_settlement_account_id_fkey;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.merchant_provider_settlement_accounts'::regclass
      AND conname = 'merchant_provider_settlement_accounts_provider_name_check'
  ) THEN
    ALTER TABLE public.merchant_provider_settlement_accounts DROP CONSTRAINT merchant_provider_settlement_accounts_provider_name_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.merchant_provider_settlement_accounts'::regclass
      AND conname = 'merchant_provider_settlement_accounts_status_check'
  ) THEN
    ALTER TABLE public.merchant_provider_settlement_accounts DROP CONSTRAINT merchant_provider_settlement_accounts_status_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.merchant_provider_settlement_accounts'::regclass
      AND conname = 'merchant_provider_settlement_accounts_environment_check'
  ) THEN
    ALTER TABLE public.merchant_provider_settlement_accounts DROP CONSTRAINT merchant_provider_settlement_accounts_environment_check;
  END IF;

  ALTER TABLE public.merchant_provider_settlement_accounts
    ADD CONSTRAINT merchant_provider_settlement_accounts_provider_name_check
    CHECK (provider_name IN ('paystack', 'monnify', 'breet', 'future_provider'));

  ALTER TABLE public.merchant_provider_settlement_accounts
    ADD CONSTRAINT merchant_provider_settlement_accounts_status_check
    CHECK (status IN (
      'pending',
      'connected',
      'active',
      'failed',
      'disabled',
      'not_supported',
      'requires_live_approval',
      'requires_action',
      'degraded',
      'temporarily_unavailable'
    ));

  ALTER TABLE public.merchant_provider_settlement_accounts
    ADD CONSTRAINT merchant_provider_settlement_accounts_environment_check
    CHECK (environment IN ('sandbox', 'live'));
END;
$$;

CREATE INDEX IF NOT EXISTS idx_merchant_provider_settlement_accounts_merchant
  ON public.merchant_provider_settlement_accounts(merchant_id, provider_name, environment, status);

DROP TRIGGER IF EXISTS trg_merchant_provider_settlement_accounts_updated_at ON public.merchant_provider_settlement_accounts;
CREATE TRIGGER trg_merchant_provider_settlement_accounts_updated_at
BEFORE UPDATE ON public.merchant_provider_settlement_accounts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.settlement_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_record_id UUID NOT NULL REFERENCES public.payment_records(id) ON DELETE CASCADE,
  legacy_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  settlement_account_id UUID REFERENCES public.merchant_settlement_accounts(id) ON DELETE SET NULL,
  provider_settlement_account_id UUID REFERENCES public.merchant_provider_settlement_accounts(id) ON DELETE SET NULL,
  provider_settlement_batch_id UUID,
  provider_name VARCHAR(50) NOT NULL,
  payment_method VARCHAR(50),
  settlement_recipient_type TEXT,
  settlement_currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  gross_amount NUMERIC(18,2) NOT NULL,
  provider_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
  platform_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
  customer_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
  merchant_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
  expected_settlement NUMERIC(18,2),
  actual_settlement NUMERIC(18,2),
  settlement_difference NUMERIC(18,2),
  fee_payer VARCHAR(50),
  settlement_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  settlement_mode TEXT NOT NULL DEFAULT 'provider_direct',
  settlement_owner TEXT NOT NULL DEFAULT 'provider',
  payout_action_required BOOLEAN NOT NULL DEFAULT false,
  provider_settlement_reference VARCHAR(255),
  provider_fee_source TEXT,
  expected_settlement_source TEXT,
  expected_settlement_date TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  last_reconciled_at TIMESTAMPTZ,
  reconciliation_notes TEXT,
  settlement_account_snapshot JSONB,
  settlement_bank_name TEXT,
  settlement_account_name TEXT,
  settlement_account_number_masked TEXT,
  provider_bank_id TEXT,
  wallet_address TEXT,
  tx_hash TEXT,
  raw_settlement_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_record_id)
);

ALTER TABLE public.settlement_records
  ADD COLUMN IF NOT EXISTS legacy_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS settlement_account_id UUID REFERENCES public.merchant_settlement_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_settlement_account_id UUID REFERENCES public.merchant_provider_settlement_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_settlement_batch_id UUID,
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50),
  ADD COLUMN IF NOT EXISTS settlement_recipient_type TEXT,
  ADD COLUMN IF NOT EXISTS settlement_currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS provider_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS merchant_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_settlement NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS actual_settlement NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS settlement_difference NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS fee_payer VARCHAR(50),
  ADD COLUMN IF NOT EXISTS settlement_mode TEXT NOT NULL DEFAULT 'provider_direct',
  ADD COLUMN IF NOT EXISTS settlement_owner TEXT NOT NULL DEFAULT 'provider',
  ADD COLUMN IF NOT EXISTS payout_action_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS provider_settlement_reference VARCHAR(255),
  ADD COLUMN IF NOT EXISTS provider_fee_source TEXT,
  ADD COLUMN IF NOT EXISTS expected_settlement_source TEXT,
  ADD COLUMN IF NOT EXISTS expected_settlement_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reconciled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciliation_notes TEXT,
  ADD COLUMN IF NOT EXISTS settlement_account_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS settlement_bank_name TEXT,
  ADD COLUMN IF NOT EXISTS settlement_account_name TEXT,
  ADD COLUMN IF NOT EXISTS settlement_account_number_masked TEXT,
  ADD COLUMN IF NOT EXISTS provider_bank_id TEXT,
  ADD COLUMN IF NOT EXISTS wallet_address TEXT,
  ADD COLUMN IF NOT EXISTS tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS raw_settlement_payload JSONB,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.settlement_records'::regclass
      AND conname = 'settlement_records_settlement_status_check'
  ) THEN
    ALTER TABLE public.settlement_records DROP CONSTRAINT settlement_records_settlement_status_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.settlement_records'::regclass
      AND conname = 'settlement_records_settlement_mode_check'
  ) THEN
    ALTER TABLE public.settlement_records DROP CONSTRAINT settlement_records_settlement_mode_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.settlement_records'::regclass
      AND conname = 'settlement_records_settlement_owner_check'
  ) THEN
    ALTER TABLE public.settlement_records DROP CONSTRAINT settlement_records_settlement_owner_check;
  END IF;

  ALTER TABLE public.settlement_records
    ADD CONSTRAINT settlement_records_settlement_status_check
    CHECK (settlement_status IN ('pending', 'processing', 'completed', 'failed', 'disputed', 'manual_review', 'not_applicable'));

  ALTER TABLE public.settlement_records
    ADD CONSTRAINT settlement_records_settlement_mode_check
    CHECK (settlement_mode IN ('provider_direct', 'breet_auto_settlement', 'platform_auto_settlement', 'treasury_manual', 'treasury_payout_required', 'disabled'));

  ALTER TABLE public.settlement_records
    ADD CONSTRAINT settlement_records_settlement_owner_check
    CHECK (settlement_owner IN ('provider', 'deraledger_treasury', 'manual_review'));
END;
$$;

CREATE INDEX IF NOT EXISTS idx_settlement_records_merchant
  ON public.settlement_records(merchant_id, settlement_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_settlement_records_provider
  ON public.settlement_records(provider_name, provider_settlement_reference);

CREATE INDEX IF NOT EXISTS idx_settlement_records_provider_batch
  ON public.settlement_records(provider_settlement_batch_id);

DROP TRIGGER IF EXISTS trg_settlement_records_updated_at ON public.settlement_records;
CREATE TRIGGER trg_settlement_records_updated_at
BEFORE UPDATE ON public.settlement_records
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.settlement_reconciliation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_record_id UUID REFERENCES public.settlement_records(id) ON DELETE SET NULL,
  provider_name VARCHAR(50) NOT NULL,
  provider_reference VARCHAR(255),
  reconciliation_status VARCHAR(50),
  expected_amount NUMERIC(18,2),
  provider_reported_amount NUMERIC(18,2),
  difference NUMERIC(18,2),
  raw_provider_payload JSONB,
  checked_by VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.settlement_reconciliation_logs'::regclass
      AND conname = 'settlement_reconciliation_logs_checked_by_check'
  ) THEN
    ALTER TABLE public.settlement_reconciliation_logs DROP CONSTRAINT settlement_reconciliation_logs_checked_by_check;
  END IF;

  ALTER TABLE public.settlement_reconciliation_logs
    ADD CONSTRAINT settlement_reconciliation_logs_checked_by_check
    CHECK (checked_by IS NULL OR checked_by IN ('system', 'admin', 'scheduled_job', 'webhook'));
END;
$$;

CREATE INDEX IF NOT EXISTS idx_settlement_reconciliation_logs_record
  ON public.settlement_reconciliation_logs(settlement_record_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.provider_settlement_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name TEXT NOT NULL,
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  settlement_account_id UUID REFERENCES public.merchant_settlement_accounts(id) ON DELETE SET NULL,
  provider_settlement_account_id UUID REFERENCES public.merchant_provider_settlement_accounts(id) ON DELETE SET NULL,
  provider_batch_reference TEXT,
  settlement_mode TEXT NOT NULL DEFAULT 'provider_direct',
  settlement_owner TEXT NOT NULL DEFAULT 'provider',
  gross_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  expected_settlement_total NUMERIC(18,2),
  actual_settlement_total NUMERIC(18,2),
  settlement_difference NUMERIC(18,2),
  settlement_status TEXT NOT NULL DEFAULT 'pending',
  settlement_account_snapshot JSONB,
  provider_reported_settled_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  raw_provider_payload JSONB,
  reconciliation_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.provider_settlement_batches'::regclass
      AND conname = 'provider_settlement_batches_provider_name_check'
  ) THEN
    ALTER TABLE public.provider_settlement_batches DROP CONSTRAINT provider_settlement_batches_provider_name_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.provider_settlement_batches'::regclass
      AND conname = 'provider_settlement_batches_settlement_mode_check'
  ) THEN
    ALTER TABLE public.provider_settlement_batches DROP CONSTRAINT provider_settlement_batches_settlement_mode_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.provider_settlement_batches'::regclass
      AND conname = 'provider_settlement_batches_settlement_owner_check'
  ) THEN
    ALTER TABLE public.provider_settlement_batches DROP CONSTRAINT provider_settlement_batches_settlement_owner_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.provider_settlement_batches'::regclass
      AND conname = 'provider_settlement_batches_settlement_status_check'
  ) THEN
    ALTER TABLE public.provider_settlement_batches DROP CONSTRAINT provider_settlement_batches_settlement_status_check;
  END IF;

  ALTER TABLE public.provider_settlement_batches
    ADD CONSTRAINT provider_settlement_batches_provider_name_check
    CHECK (provider_name IN ('paystack', 'monnify', 'breet', 'future_provider'));

  ALTER TABLE public.provider_settlement_batches
    ADD CONSTRAINT provider_settlement_batches_settlement_mode_check
    CHECK (settlement_mode IN ('provider_direct', 'treasury_payout_required'));

  ALTER TABLE public.provider_settlement_batches
    ADD CONSTRAINT provider_settlement_batches_settlement_owner_check
    CHECK (settlement_owner IN ('provider', 'deraledger_treasury', 'manual_review'));

  ALTER TABLE public.provider_settlement_batches
    ADD CONSTRAINT provider_settlement_batches_settlement_status_check
    CHECK (settlement_status IN ('pending', 'processing', 'completed', 'failed', 'disputed', 'manual_review'));
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_settlement_batches_provider_ref
  ON public.provider_settlement_batches(provider_name, provider_batch_reference)
  WHERE provider_batch_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provider_settlement_batches_merchant
  ON public.provider_settlement_batches(merchant_id, settlement_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_settlement_batches_account
  ON public.provider_settlement_batches(settlement_account_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_provider_settlement_batches_updated_at ON public.provider_settlement_batches;
CREATE TRIGGER trg_provider_settlement_batches_updated_at
BEFORE UPDATE ON public.provider_settlement_batches
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.settlement_records'::regclass
      AND conname = 'settlement_records_provider_settlement_batch_id_fkey'
  ) THEN
    ALTER TABLE public.settlement_records
      ADD CONSTRAINT settlement_records_provider_settlement_batch_id_fkey
      FOREIGN KEY (provider_settlement_batch_id)
      REFERENCES public.provider_settlement_batches(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.provider_settlement_batch_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_settlement_batch_id UUID NOT NULL CONSTRAINT psbi_provider_batch_id_fkey REFERENCES public.provider_settlement_batches(id) ON DELETE CASCADE,
  settlement_record_id UUID NOT NULL REFERENCES public.settlement_records(id) ON DELETE CASCADE,
  payment_record_id UUID REFERENCES public.payment_records(id) ON DELETE SET NULL,
  expected_settlement NUMERIC(18,2),
  actual_settlement NUMERIC(18,2),
  settlement_difference NUMERIC(18,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (settlement_record_id)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.provider_settlement_batch_items'::regclass
      AND conname = 'provider_settlement_batch_ite_provider_settlement_batch_id_fkey'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.provider_settlement_batch_items'::regclass
      AND conname = 'psbi_provider_batch_id_fkey'
  ) THEN
    ALTER TABLE public.provider_settlement_batch_items
      RENAME CONSTRAINT provider_settlement_batch_ite_provider_settlement_batch_id_fkey
      TO psbi_provider_batch_id_fkey;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_provider_settlement_batch_items_batch
  ON public.provider_settlement_batch_items(provider_settlement_batch_id, created_at DESC);

ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_settlement_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_provider_settlement_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_settlement_batches ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_has_merchant_team BOOLEAN := to_regclass('public.merchant_team') IS NOT NULL;
  v_team_payment_records TEXT := '';
  v_team_settlement_records TEXT := '';
  v_team_settlement_accounts TEXT := '';
  v_team_provider_settlement_accounts TEXT := '';
  v_team_provider_batches TEXT := '';
  v_payment_records_policy_using TEXT;
  v_settlement_records_policy_using TEXT;
  v_settlement_accounts_policy_using TEXT;
  v_provider_settlement_accounts_policy_using TEXT;
  v_provider_batches_policy_using TEXT;
BEGIN
  IF v_has_merchant_team THEN
    v_team_payment_records := '
      OR EXISTS (
        SELECT 1
        FROM public.merchant_team mt
        WHERE mt.merchant_id = public.payment_records.merchant_id
          AND mt.user_id = auth.uid()
          AND COALESCE(mt.is_active, false) = true
      )';
    v_team_settlement_records := '
      OR EXISTS (
        SELECT 1
        FROM public.merchant_team mt
        WHERE mt.merchant_id = public.settlement_records.merchant_id
          AND mt.user_id = auth.uid()
          AND COALESCE(mt.is_active, false) = true
      )';
    v_team_settlement_accounts := '
      OR EXISTS (
        SELECT 1
        FROM public.merchant_team mt
        WHERE mt.merchant_id = public.merchant_settlement_accounts.merchant_id
          AND mt.user_id = auth.uid()
          AND COALESCE(mt.is_active, false) = true
      )';
    v_team_provider_settlement_accounts := '
      OR EXISTS (
        SELECT 1
        FROM public.merchant_team mt
        WHERE mt.merchant_id = public.merchant_provider_settlement_accounts.merchant_id
          AND mt.user_id = auth.uid()
          AND COALESCE(mt.is_active, false) = true
      )';
    v_team_provider_batches := '
      OR EXISTS (
        SELECT 1
        FROM public.merchant_team mt
        WHERE mt.merchant_id = public.provider_settlement_batches.merchant_id
          AND mt.user_id = auth.uid()
          AND COALESCE(mt.is_active, false) = true
      )';
  END IF;

  v_payment_records_policy_using := format(
    'auth.role() = ''authenticated'' AND ( EXISTS ( SELECT 1 FROM public.merchants m WHERE m.id = public.payment_records.merchant_id AND m.user_id = auth.uid() )%s )',
    v_team_payment_records
  );
  v_settlement_records_policy_using := format(
    'auth.role() = ''authenticated'' AND ( EXISTS ( SELECT 1 FROM public.merchants m WHERE m.id = public.settlement_records.merchant_id AND m.user_id = auth.uid() )%s )',
    v_team_settlement_records
  );
  v_settlement_accounts_policy_using := format(
    'auth.role() = ''authenticated'' AND ( EXISTS ( SELECT 1 FROM public.merchants m WHERE m.id = public.merchant_settlement_accounts.merchant_id AND m.user_id = auth.uid() )%s )',
    v_team_settlement_accounts
  );
  v_provider_settlement_accounts_policy_using := format(
    'auth.role() = ''authenticated'' AND ( EXISTS ( SELECT 1 FROM public.merchants m WHERE m.id = public.merchant_provider_settlement_accounts.merchant_id AND m.user_id = auth.uid() )%s )',
    v_team_provider_settlement_accounts
  );
  v_provider_batches_policy_using := format(
    'auth.role() = ''authenticated'' AND ( EXISTS ( SELECT 1 FROM public.merchants m WHERE m.id = public.provider_settlement_batches.merchant_id AND m.user_id = auth.uid() )%s )',
    v_team_provider_batches
  );

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'payment_records'
      AND policyname = 'merchant_read_payment_records'
  ) AND pg_temp.find_equivalent_public_permissive_select_policy(
    'payment_records',
    'merchant_read_payment_records',
    ARRAY['public'],
    v_payment_records_policy_using
  ) IS NULL THEN
    EXECUTE format(
      'CREATE POLICY "merchant_read_payment_records" ON public.payment_records FOR SELECT USING (
        auth.role() = ''authenticated''
        AND (
          EXISTS (
            SELECT 1
            FROM public.merchants m
            WHERE m.id = public.payment_records.merchant_id
              AND m.user_id = auth.uid()
          )%s
        )
      )',
      v_team_payment_records
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'settlement_records'
      AND policyname = 'merchant_read_settlement_records'
  ) AND pg_temp.find_equivalent_public_permissive_select_policy(
    'settlement_records',
    'merchant_read_settlement_records',
    ARRAY['public'],
    v_settlement_records_policy_using
  ) IS NULL THEN
    EXECUTE format(
      'CREATE POLICY "merchant_read_settlement_records" ON public.settlement_records FOR SELECT USING (
        auth.role() = ''authenticated''
        AND (
          EXISTS (
            SELECT 1
            FROM public.merchants m
            WHERE m.id = public.settlement_records.merchant_id
              AND m.user_id = auth.uid()
          )%s
        )
      )',
      v_team_settlement_records
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'merchant_settlement_accounts'
      AND policyname = 'merchant_read_settlement_accounts'
  ) AND pg_temp.find_equivalent_public_permissive_select_policy(
    'merchant_settlement_accounts',
    'merchant_read_settlement_accounts',
    ARRAY['public'],
    v_settlement_accounts_policy_using
  ) IS NULL THEN
    EXECUTE format(
      'CREATE POLICY "merchant_read_settlement_accounts" ON public.merchant_settlement_accounts FOR SELECT USING (
        auth.role() = ''authenticated''
        AND (
          EXISTS (
            SELECT 1
            FROM public.merchants m
            WHERE m.id = public.merchant_settlement_accounts.merchant_id
              AND m.user_id = auth.uid()
          )%s
        )
      )',
      v_team_settlement_accounts
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'merchant_provider_settlement_accounts'
      AND policyname = 'merchant_read_provider_settlement_accounts'
  ) AND pg_temp.find_equivalent_public_permissive_select_policy(
    'merchant_provider_settlement_accounts',
    'merchant_read_provider_settlement_accounts',
    ARRAY['public'],
    v_provider_settlement_accounts_policy_using
  ) IS NULL THEN
    EXECUTE format(
      'CREATE POLICY "merchant_read_provider_settlement_accounts" ON public.merchant_provider_settlement_accounts FOR SELECT USING (
        auth.role() = ''authenticated''
        AND (
          EXISTS (
            SELECT 1
            FROM public.merchants m
            WHERE m.id = public.merchant_provider_settlement_accounts.merchant_id
              AND m.user_id = auth.uid()
          )%s
        )
      )',
      v_team_provider_settlement_accounts
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'provider_settlement_batches'
      AND policyname = 'merchant_read_provider_batches'
  ) AND pg_temp.find_equivalent_public_permissive_select_policy(
    'provider_settlement_batches',
    'merchant_read_provider_batches',
    ARRAY['public'],
    v_provider_batches_policy_using
  ) IS NULL THEN
    EXECUTE format(
      'CREATE POLICY "merchant_read_provider_batches" ON public.provider_settlement_batches FOR SELECT USING (
        auth.role() = ''authenticated''
        AND (
          EXISTS (
            SELECT 1
            FROM public.merchants m
            WHERE m.id = public.provider_settlement_batches.merchant_id
              AND m.user_id = auth.uid()
          )%s
        )
      )',
      v_team_provider_batches
    );
  END IF;
END;
$$;

DO $$
DECLARE
  -- Merchant-facing browser reads are allowed only on the narrow merchant/team-scoped
  -- RLS tables below. All other Migration A substrate tables are internal/service-side
  -- only and must not retain Supabase default browser grants.
  v_merchant_read_tables TEXT[] := ARRAY[
    'payment_records',
    'settlement_records',
    'merchant_settlement_accounts',
    'merchant_provider_settlement_accounts',
    'provider_settlement_batches'
  ];
  v_internal_tables TEXT[] := ARRAY[
    'payment_events',
    'payment_providers',
    'payment_method_configs',
    'payment_provider_routes',
    'merchant_wallets',
    'payment_sessions',
    'treasury_transactions',
    'settlement_batches',
    'treasury_webhook_logs',
    'crypto_payment_sessions',
    'settlement_reconciliation_logs',
    'provider_settlement_batch_items'
  ];
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY v_internal_tables
  LOOP
    PERFORM pg_temp.apply_public_table_access_manifest(v_table, 'internal');
  END LOOP;

  FOREACH v_table IN ARRAY v_merchant_read_tables
  LOOP
    PERFORM pg_temp.apply_public_table_access_manifest(v_table, 'merchant_read_select');
  END LOOP;
END;
$$;

INSERT INTO public.platform_settings (key, value) VALUES
  ('crypto_usdt_ngn_rate', '1650'),
  ('crypto_usdc_ngn_rate', '1650'),
  ('crypto_btc_ngn_rate', '100000000'),
  ('crypto_eth_ngn_rate', '5000000'),
  ('crypto_session_ttl_minutes', '30'),
  ('crypto_rate_lock_minutes', '15'),
  ('crypto_rate_slippage_bps', '100'),
  ('crypto_underpayment_tolerance_bps', '100'),
  ('crypto_manual_review_threshold_bps', '100'),
  ('crypto_overpayment_action', 'manual_review'),
  ('crypto_settlement_currency', 'NGN'),
  ('crypto_platform_fee_bps', '0'),
  ('crypto_btc_confirmations', '3'),
  ('crypto_eth_confirmations', '12'),
  ('crypto_usdt_confirmations', '12'),
  ('crypto_usdc_confirmations', '12'),
  ('breet_scaffold_enabled', 'false'),
  ('breet_settlement_mode', 'disabled'),
  ('breet_auto_settlement_enabled', 'false'),
  ('breet_merchant_auto_settlement_enabled', 'false'),
  ('breet_invoice_crypto_enabled', 'false'),
  ('breet_subscription_crypto_enabled', 'false'),
  ('breet_development_checkout_enabled', 'false'),
  ('breet_allow_pending_as_completed_in_development', 'false'),
  ('breet_min_auto_settlement_ngn', '2500'),
  ('breet_api_environment', 'development'),
  ('breet_webhook_url', ''),
  ('breet_supported_assets', 'USDT,USDC,BTC,ETH'),
  ('breet_supported_networks', 'TRON,ETHEREUM,BITCOIN'),
  ('breet_treasury_settlement_account_reference', ''),
  ('breet_treasury_settlement_account_label', ''),
  ('breet_platform_bank_validated', 'false'),
  ('breet_platform_bank_id', ''),
  ('breet_platform_bank_code', ''),
  ('breet_platform_bank_name', ''),
  ('breet_platform_account_number', ''),
  ('breet_platform_account_name', ''),
  ('breet_default_receive_currency', 'NGN'),
  ('breet_sandbox_force_platform_settlement', 'false'),
  ('breet_live_enabled', 'false'),
  ('breet_quote_fallback_buffer_bps', '300')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.payment_providers (
  provider_name,
  environment,
  status,
  supports_card,
  supports_bank_transfer,
  supports_ussd,
  supports_crypto,
  public_key_hint,
  merchant_id_hint,
  webhook_secret_hint
)
VALUES
  ('paystack', 'sandbox', 'active', true, true, true, false, 'NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY', NULL, 'PAYSTACK_SECRET_KEY'),
  ('paystack', 'live', 'pending_live_approval', true, true, true, false, 'NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY', NULL, 'PAYSTACK_SECRET_KEY'),
  ('monnify', 'sandbox', 'sandbox_only', true, true, true, false, 'MONNIFY_API_KEY', 'MONNIFY_CONTRACT_CODE', 'MONNIFY_SECRET_KEY'),
  ('monnify', 'live', 'pending_live_approval', true, true, true, false, 'MONNIFY_API_KEY', 'MONNIFY_CONTRACT_CODE', 'MONNIFY_SECRET_KEY'),
  ('breet', 'sandbox', 'sandbox_only', false, false, false, true, 'BREET_APP_ID', NULL, 'BREET_APP_SECRET'),
  ('breet', 'live', 'inactive', false, false, false, true, 'BREET_APP_ID', NULL, 'BREET_APP_SECRET')
ON CONFLICT (provider_name, environment) DO NOTHING;

INSERT INTO public.payment_method_configs (
  payment_purpose,
  payment_method,
  environment,
  is_enabled,
  display_label,
  display_description
)
VALUES
  ('plan_subscription', 'card', 'sandbox', true, 'Card', 'Pay securely with your debit or credit card'),
  ('plan_subscription', 'bank_transfer', 'sandbox', true, 'Bank Transfer', 'Transfer from your bank app or virtual account'),
  ('plan_subscription', 'ussd', 'sandbox', true, 'USSD', 'Pay using your bank USSD code'),
  ('plan_subscription', 'crypto', 'sandbox', false, 'Crypto', 'Pay with crypto when this rail is active'),
  ('plan_upgrade', 'card', 'sandbox', true, 'Card', 'Pay securely with your debit or credit card'),
  ('plan_upgrade', 'bank_transfer', 'sandbox', true, 'Bank Transfer', 'Transfer from your bank app or virtual account'),
  ('plan_upgrade', 'ussd', 'sandbox', true, 'USSD', 'Pay using your bank USSD code'),
  ('plan_upgrade', 'crypto', 'sandbox', false, 'Crypto', 'Pay with crypto when this rail is active'),
  ('plan_renewal', 'card', 'sandbox', true, 'Card', 'Pay securely with your debit or credit card'),
  ('plan_renewal', 'bank_transfer', 'sandbox', true, 'Bank Transfer', 'Transfer from your bank app or virtual account'),
  ('plan_renewal', 'ussd', 'sandbox', true, 'USSD', 'Pay using your bank USSD code'),
  ('plan_renewal', 'crypto', 'sandbox', false, 'Crypto', 'Pay with crypto when this rail is active'),
  ('invoice_payment', 'card', 'sandbox', true, 'Card', 'Pay invoice securely with your debit or credit card'),
  ('invoice_payment', 'bank_transfer', 'sandbox', true, 'Bank Transfer', 'Transfer exactly the amount shown'),
  ('invoice_payment', 'ussd', 'sandbox', true, 'USSD', 'Pay using your bank USSD code'),
  ('invoice_payment', 'crypto', 'sandbox', true, 'Crypto', 'Pay with crypto when this rail is active'),
  ('payment_link', 'card', 'sandbox', true, 'Card', 'Pay securely with your debit or credit card'),
  ('payment_link', 'bank_transfer', 'sandbox', true, 'Bank Transfer', 'Transfer from your bank app or virtual account'),
  ('payment_link', 'ussd', 'sandbox', true, 'USSD', 'Pay using your bank USSD code'),
  ('payment_link', 'crypto', 'sandbox', true, 'Crypto', 'Pay with crypto when this rail is active'),
  ('plan_subscription', 'card', 'live', true, 'Card', 'Pay securely with your debit or credit card'),
  ('plan_subscription', 'bank_transfer', 'live', true, 'Bank Transfer', 'Transfer from your bank app or virtual account'),
  ('plan_subscription', 'ussd', 'live', true, 'USSD', 'Pay using your bank USSD code'),
  ('plan_subscription', 'crypto', 'live', false, 'Crypto', 'Pay with crypto when this rail is active'),
  ('plan_upgrade', 'card', 'live', true, 'Card', 'Pay securely with your debit or credit card'),
  ('plan_upgrade', 'bank_transfer', 'live', true, 'Bank Transfer', 'Transfer from your bank app or virtual account'),
  ('plan_upgrade', 'ussd', 'live', true, 'USSD', 'Pay using your bank USSD code'),
  ('plan_upgrade', 'crypto', 'live', false, 'Crypto', 'Pay with crypto when this rail is active'),
  ('plan_renewal', 'card', 'live', true, 'Card', 'Pay securely with your debit or credit card'),
  ('plan_renewal', 'bank_transfer', 'live', true, 'Bank Transfer', 'Transfer from your bank app or virtual account'),
  ('plan_renewal', 'ussd', 'live', true, 'USSD', 'Pay using your bank USSD code'),
  ('plan_renewal', 'crypto', 'live', false, 'Crypto', 'Pay with crypto when this rail is active'),
  ('invoice_payment', 'card', 'live', true, 'Card', 'Pay invoice securely with your debit or credit card'),
  ('invoice_payment', 'bank_transfer', 'live', true, 'Bank Transfer', 'Transfer exactly the amount shown'),
  ('invoice_payment', 'ussd', 'live', true, 'USSD', 'Pay using your bank USSD code'),
  ('invoice_payment', 'crypto', 'live', false, 'Crypto', 'Pay with crypto when this rail is active'),
  ('payment_link', 'card', 'live', true, 'Card', 'Pay securely with your debit or credit card'),
  ('payment_link', 'bank_transfer', 'live', true, 'Bank Transfer', 'Transfer from your bank app or virtual account'),
  ('payment_link', 'ussd', 'live', true, 'USSD', 'Pay using your bank USSD code'),
  ('payment_link', 'crypto', 'live', false, 'Crypto', 'Pay with crypto when this rail is active')
ON CONFLICT (payment_purpose, payment_method, environment) DO NOTHING;

INSERT INTO public.payment_provider_routes (
  payment_purpose,
  payment_method,
  primary_provider,
  fallback_provider,
  environment,
  is_enabled
)
VALUES
  ('plan_subscription', 'card', 'paystack', 'monnify', 'sandbox', true),
  ('plan_subscription', 'bank_transfer', 'paystack', 'monnify', 'sandbox', true),
  ('plan_subscription', 'ussd', 'paystack', 'monnify', 'sandbox', true),
  ('plan_subscription', 'crypto', 'breet', NULL, 'sandbox', false),
  ('plan_upgrade', 'card', 'paystack', 'monnify', 'sandbox', true),
  ('plan_upgrade', 'bank_transfer', 'paystack', 'monnify', 'sandbox', true),
  ('plan_upgrade', 'ussd', 'paystack', 'monnify', 'sandbox', true),
  ('plan_upgrade', 'crypto', 'breet', NULL, 'sandbox', false),
  ('plan_renewal', 'card', 'paystack', 'monnify', 'sandbox', true),
  ('plan_renewal', 'bank_transfer', 'paystack', 'monnify', 'sandbox', true),
  ('plan_renewal', 'ussd', 'paystack', 'monnify', 'sandbox', true),
  ('plan_renewal', 'crypto', 'breet', NULL, 'sandbox', false),
  ('invoice_payment', 'card', 'paystack', 'monnify', 'sandbox', true),
  ('invoice_payment', 'bank_transfer', 'paystack', 'monnify', 'sandbox', true),
  ('invoice_payment', 'ussd', 'paystack', 'monnify', 'sandbox', true),
  ('invoice_payment', 'crypto', 'breet', NULL, 'sandbox', true),
  ('payment_link', 'card', 'paystack', 'monnify', 'sandbox', true),
  ('payment_link', 'bank_transfer', 'paystack', 'monnify', 'sandbox', true),
  ('payment_link', 'ussd', 'paystack', 'monnify', 'sandbox', true),
  ('payment_link', 'crypto', 'breet', NULL, 'sandbox', true),
  ('plan_subscription', 'card', 'monnify', 'paystack', 'live', true),
  ('plan_subscription', 'bank_transfer', 'monnify', 'paystack', 'live', true),
  ('plan_subscription', 'ussd', 'monnify', 'paystack', 'live', true),
  ('plan_subscription', 'crypto', 'breet', NULL, 'live', false),
  ('plan_upgrade', 'card', 'monnify', 'paystack', 'live', true),
  ('plan_upgrade', 'bank_transfer', 'monnify', 'paystack', 'live', true),
  ('plan_upgrade', 'ussd', 'monnify', 'paystack', 'live', true),
  ('plan_upgrade', 'crypto', 'breet', NULL, 'live', false),
  ('plan_renewal', 'card', 'monnify', 'paystack', 'live', true),
  ('plan_renewal', 'bank_transfer', 'monnify', 'paystack', 'live', true),
  ('plan_renewal', 'ussd', 'monnify', 'paystack', 'live', true),
  ('plan_renewal', 'crypto', 'breet', NULL, 'live', false),
  ('invoice_payment', 'card', 'monnify', 'paystack', 'live', true),
  ('invoice_payment', 'bank_transfer', 'monnify', 'paystack', 'live', true),
  ('invoice_payment', 'ussd', 'monnify', 'paystack', 'live', true),
  ('invoice_payment', 'crypto', 'breet', NULL, 'live', false),
  ('payment_link', 'card', 'monnify', 'paystack', 'live', true),
  ('payment_link', 'bank_transfer', 'monnify', 'paystack', 'live', true),
  ('payment_link', 'ussd', 'monnify', 'paystack', 'live', true),
  ('payment_link', 'crypto', 'breet', NULL, 'live', false)
ON CONFLICT (payment_purpose, payment_method, environment) DO NOTHING;

CREATE OR REPLACE FUNCTION public.process_breet_invoice_confirmation(
  p_payment_session_id UUID,
  p_event_type TEXT,
  p_processor_reference TEXT,
  p_blockchain_tx_hash TEXT,
  p_breet_reference TEXT,
  p_source_amount NUMERIC,
  p_exchange_rate NUMERIC,
  p_payment_rail TEXT,
  p_source_currency TEXT,
  p_gross_ngn NUMERIC,
  p_platform_fee NUMERIC,
  p_network_fee NUMERIC,
  p_merchant_net_ngn NUMERIC,
  p_confirmation_count INTEGER,
  p_expected_confirmations INTEGER,
  p_raw_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.payment_sessions%ROWTYPE;
  v_invoice public.invoices%ROWTYPE;
  v_tx public.treasury_transactions%ROWTYPE;
  v_applied_ngn NUMERIC(20,2);
  v_new_amount_paid NUMERIC(20,2);
  v_new_outstanding NUMERIC(20,2);
  v_invoice_status TEXT;
  v_payment_status TEXT;
BEGIN
  SELECT *
  INTO v_session
  FROM public.payment_sessions
  WHERE id = p_payment_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'payment_session_not_found');
  END IF;

  IF v_session.status IN ('CONFIRMED', 'SETTLEMENT_PENDING', 'SETTLED') THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'session_status', v_session.status);
  END IF;

  SELECT *
  INTO v_invoice
  FROM public.invoices
  WHERE id = v_session.invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invoice_not_found');
  END IF;

  INSERT INTO public.merchant_wallets (merchant_id, currency)
  VALUES (v_session.merchant_id, 'NGN')
  ON CONFLICT (merchant_id, currency) DO NOTHING;

  v_applied_ngn := LEAST(
    COALESCE(p_gross_ngn, COALESCE(v_session.amount_ngn, 0)),
    COALESCE(v_invoice.outstanding_balance, 0)
  );
  v_new_amount_paid := COALESCE(v_invoice.amount_paid, 0) + v_applied_ngn;
  v_new_outstanding := GREATEST(COALESCE(v_invoice.outstanding_balance, 0) - v_applied_ngn, 0);
  v_invoice_status := CASE
    WHEN v_new_outstanding <= 0 THEN 'closed'
    WHEN v_applied_ngn > 0 THEN 'partially_paid'
    ELSE v_invoice.status
  END;
  v_payment_status := CASE
    WHEN COALESCE(p_expected_confirmations, 0) > 0
      AND COALESCE(p_confirmation_count, 0) < COALESCE(p_expected_confirmations, 0)
      THEN 'AWAITING_CONFIRMATION'
    ELSE 'SETTLEMENT_PENDING'
  END;

  UPDATE public.invoices
  SET
    amount_paid = v_new_amount_paid,
    outstanding_balance = v_new_outstanding,
    status = v_invoice_status,
    payment_status = v_payment_status,
    payment_provider = COALESCE(v_invoice.payment_provider, 'breet'),
    crypto_asset = COALESCE(v_invoice.crypto_asset, UPPER(p_payment_rail)),
    updated_at = now()
  WHERE id = v_invoice.id;

  INSERT INTO public.treasury_transactions (
    merchant_id,
    invoice_id,
    payment_session_id,
    payment_rail,
    source_currency,
    source_amount,
    exchange_rate,
    gross_ngn,
    platform_fee,
    network_fee,
    merchant_net_ngn,
    blockchain_tx_hash,
    breet_reference,
    settlement_reference,
    status,
    raw_payload
  )
  VALUES (
    v_session.merchant_id,
    v_session.invoice_id,
    v_session.id,
    LOWER(p_payment_rail),
    UPPER(p_source_currency),
    p_source_amount,
    p_exchange_rate,
    p_gross_ngn,
    p_platform_fee,
    p_network_fee,
    p_merchant_net_ngn,
    p_blockchain_tx_hash,
    p_breet_reference,
    'SETTLE-' || replace(v_session.id::text, '-', ''),
    CASE
      WHEN COALESCE(p_expected_confirmations, 0) > 0
        AND COALESCE(p_confirmation_count, 0) < COALESCE(p_expected_confirmations, 0)
        THEN 'PAYMENT_DETECTED'
      ELSE 'MERCHANT_PENDING'
    END,
    COALESCE(p_raw_payload, '{}'::jsonb)
  )
  ON CONFLICT (payment_session_id) DO UPDATE SET
    blockchain_tx_hash = EXCLUDED.blockchain_tx_hash,
    breet_reference = EXCLUDED.breet_reference,
    exchange_rate = EXCLUDED.exchange_rate,
    source_amount = EXCLUDED.source_amount,
    gross_ngn = EXCLUDED.gross_ngn,
    platform_fee = EXCLUDED.platform_fee,
    network_fee = EXCLUDED.network_fee,
    merchant_net_ngn = EXCLUDED.merchant_net_ngn,
    status = EXCLUDED.status,
    raw_payload = EXCLUDED.raw_payload,
    updated_at = now()
  RETURNING * INTO v_tx;

  UPDATE public.payment_sessions
  SET
    status = CASE
      WHEN COALESCE(p_expected_confirmations, 0) > 0
        AND COALESCE(p_confirmation_count, 0) < COALESCE(p_expected_confirmations, 0)
        THEN 'AWAITING_CONFIRMATION'
      ELSE 'CONFIRMED'
    END,
    provider_reference = COALESCE(p_breet_reference, p_processor_reference, provider_reference),
    tx_hash = COALESCE(p_blockchain_tx_hash, tx_hash),
    confirmation_count = GREATEST(COALESCE(confirmation_count, 0), COALESCE(p_confirmation_count, 0)),
    expected_confirmations = GREATEST(COALESCE(expected_confirmations, 0), COALESCE(p_expected_confirmations, 0)),
    paid_at = COALESCE(paid_at, now()),
    updated_at = now()
  WHERE id = v_session.id;

  UPDATE public.merchant_wallets
  SET
    pending_balance = pending_balance + CASE
      WHEN COALESCE(p_expected_confirmations, 0) > 0
        AND COALESCE(p_confirmation_count, 0) < COALESCE(p_expected_confirmations, 0)
        THEN 0
      ELSE COALESCE(p_merchant_net_ngn, 0)
    END
  WHERE merchant_id = v_session.merchant_id
    AND currency = 'NGN';

  INSERT INTO public.transactions (
    invoice_id,
    merchant_id,
    amount_paid,
    k_factor,
    tax_collected,
    discount_applied,
    paystack_fee,
    fee_absorbed_by,
    paystack_reference,
    payment_method,
    status,
    payment_rail,
    settlement_status,
    processor_reference,
    source_currency,
    source_amount,
    fx_rate,
    merchant_net_amount
  )
  SELECT
    v_invoice.id,
    v_invoice.merchant_id,
    v_applied_ngn,
    CASE
      WHEN COALESCE(v_invoice.grand_total, 0) > 0 THEN v_applied_ngn / v_invoice.grand_total
      ELSE 0
    END,
    ROUND((CASE WHEN COALESCE(v_invoice.grand_total, 0) > 0 THEN v_applied_ngn / v_invoice.grand_total ELSE 0 END) * COALESCE(v_invoice.tax_value, 0), 2),
    ROUND((CASE WHEN COALESCE(v_invoice.grand_total, 0) > 0 THEN v_applied_ngn / v_invoice.grand_total ELSE 0 END) * COALESCE(v_invoice.discount_value, 0), 2),
    COALESCE(p_platform_fee, 0) + COALESCE(p_network_fee, 0),
    'business',
    COALESCE(p_breet_reference, p_processor_reference, p_blockchain_tx_hash),
    LOWER(p_payment_rail),
    'success',
    LOWER(p_payment_rail),
    LOWER(v_payment_status),
    COALESCE(p_breet_reference, p_processor_reference, p_blockchain_tx_hash),
    UPPER(p_source_currency),
    p_source_amount,
    p_exchange_rate,
    p_merchant_net_ngn
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.transactions t
    WHERE t.processor_reference = COALESCE(p_breet_reference, p_processor_reference, p_blockchain_tx_hash)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'payment_session_id', v_session.id,
    'treasury_transaction_id', v_tx.id,
    'invoice_id', v_invoice.id,
    'invoice_status', v_invoice_status,
    'payment_status', v_payment_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_breet_invoice_confirmation(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  NUMERIC,
  NUMERIC,
  TEXT,
  TEXT,
  NUMERIC,
  NUMERIC,
  NUMERIC,
  NUMERIC,
  INTEGER,
  INTEGER,
  JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_breet_invoice_confirmation(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  NUMERIC,
  NUMERIC,
  TEXT,
  TEXT,
  NUMERIC,
  NUMERIC,
  NUMERIC,
  NUMERIC,
  INTEGER,
  INTEGER,
  JSONB
) TO service_role;

CREATE OR REPLACE FUNCTION public.queue_pending_crypto_settlements(
  p_merchant_id UUID DEFAULT NULL,
  p_payout_provider TEXT DEFAULT 'paystack'
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wallet RECORD;
  v_batch_id UUID;
  v_created_count INTEGER := 0;
BEGIN
  FOR v_wallet IN
    SELECT mw.merchant_id, mw.pending_balance
    FROM public.merchant_wallets mw
    WHERE mw.currency = 'NGN'
      AND mw.pending_balance > 0
      AND (p_merchant_id IS NULL OR mw.merchant_id = p_merchant_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.settlement_batches sb
        WHERE sb.merchant_id = mw.merchant_id
          AND sb.status IN ('queued', 'processing', 'held')
      )
    FOR UPDATE
  LOOP
    INSERT INTO public.settlement_batches (
      merchant_id,
      total_amount,
      currency,
      payout_provider,
      payout_reference,
      status,
      metadata
    )
    VALUES (
      v_wallet.merchant_id,
      v_wallet.pending_balance,
      'NGN',
      LOWER(COALESCE(p_payout_provider, 'paystack')),
      'PAYOUT-' || replace(gen_random_uuid()::text, '-', ''),
      'queued',
      jsonb_build_object('queued_from', 'treasury_engine')
    )
    RETURNING id INTO v_batch_id;

    UPDATE public.merchant_wallets
    SET
      pending_balance = pending_balance - v_wallet.pending_balance,
      locked_balance = locked_balance + v_wallet.pending_balance
    WHERE merchant_id = v_wallet.merchant_id
      AND currency = 'NGN';

    UPDATE public.treasury_transactions
    SET
      status = 'SETTLEMENT_QUEUED',
      settlement_reference = v_batch_id::text,
      updated_at = now()
    WHERE merchant_id = v_wallet.merchant_id
      AND status = 'MERCHANT_PENDING';

    v_created_count := v_created_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'created_batches', v_created_count,
    'provider', LOWER(COALESCE(p_payout_provider, 'paystack'))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.queue_pending_crypto_settlements(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_pending_crypto_settlements(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.update_settlement_batch_status(
  p_batch_id UUID,
  p_action TEXT,
  p_failure_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch public.settlement_batches%ROWTYPE;
BEGIN
  SELECT *
  INTO v_batch
  FROM public.settlement_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'batch_not_found');
  END IF;

  IF p_action = 'hold' THEN
    UPDATE public.settlement_batches
    SET status = 'held', failure_reason = p_failure_reason, updated_at = now()
    WHERE id = p_batch_id;
  ELSIF p_action = 'release' THEN
    UPDATE public.settlement_batches
    SET status = 'queued', failure_reason = NULL, updated_at = now()
    WHERE id = p_batch_id;
  ELSIF p_action = 'processing' THEN
    UPDATE public.settlement_batches
    SET status = 'processing', updated_at = now()
    WHERE id = p_batch_id;
  ELSIF p_action = 'retry' THEN
    UPDATE public.settlement_batches
    SET status = 'queued', failure_reason = NULL, updated_at = now()
    WHERE id = p_batch_id;

    UPDATE public.merchant_wallets
    SET
      pending_balance = GREATEST(pending_balance - v_batch.total_amount, 0),
      locked_balance = locked_balance + v_batch.total_amount
    WHERE merchant_id = v_batch.merchant_id
      AND currency = 'NGN'
      AND v_batch.status = 'failed';

    UPDATE public.treasury_transactions
    SET status = 'SETTLEMENT_QUEUED', updated_at = now()
    WHERE settlement_reference = p_batch_id::text
      AND status = 'MERCHANT_PENDING';
  ELSIF p_action = 'settled' THEN
    UPDATE public.settlement_batches
    SET status = 'settled', processed_at = now(), failure_reason = NULL, updated_at = now()
    WHERE id = p_batch_id;

    UPDATE public.merchant_wallets
    SET
      locked_balance = GREATEST(locked_balance - v_batch.total_amount, 0),
      total_settled = total_settled + v_batch.total_amount
    WHERE merchant_id = v_batch.merchant_id
      AND currency = 'NGN';

    UPDATE public.treasury_transactions
    SET status = 'SETTLED', updated_at = now()
    WHERE settlement_reference = p_batch_id::text
      AND status = 'SETTLEMENT_QUEUED';
  ELSIF p_action = 'fail' THEN
    UPDATE public.settlement_batches
    SET status = 'failed', failure_reason = COALESCE(p_failure_reason, failure_reason), updated_at = now()
    WHERE id = p_batch_id;

    UPDATE public.merchant_wallets
    SET
      locked_balance = GREATEST(locked_balance - v_batch.total_amount, 0),
      pending_balance = pending_balance + v_batch.total_amount
    WHERE merchant_id = v_batch.merchant_id
      AND currency = 'NGN';

    UPDATE public.treasury_transactions
    SET status = 'MERCHANT_PENDING', updated_at = now()
    WHERE settlement_reference = p_batch_id::text
      AND status = 'SETTLEMENT_QUEUED';
  ELSIF p_action = 'reverse' THEN
    UPDATE public.settlement_batches
    SET status = 'reversed', failure_reason = COALESCE(p_failure_reason, failure_reason), updated_at = now()
    WHERE id = p_batch_id;

    UPDATE public.merchant_wallets
    SET
      locked_balance = GREATEST(locked_balance - v_batch.total_amount, 0),
      available_balance = available_balance + v_batch.total_amount
    WHERE merchant_id = v_batch.merchant_id
      AND currency = 'NGN';

    UPDATE public.treasury_transactions
    SET status = 'REVERSED', updated_at = now()
    WHERE settlement_reference = p_batch_id::text;
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'unsupported_action');
  END IF;

  RETURN jsonb_build_object('ok', true, 'batch_id', p_batch_id, 'action', p_action);
END;
$$;

REVOKE ALL ON FUNCTION public.update_settlement_batch_status(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_settlement_batch_status(UUID, TEXT, TEXT) TO service_role;

DO $$
DECLARE
  v_has_merchant_team BOOLEAN := to_regclass('public.merchant_team') IS NOT NULL;
  v_team_payment_records TEXT := '';
  v_team_settlement_records TEXT := '';
  v_team_settlement_accounts TEXT := '';
  v_team_provider_settlement_accounts TEXT := '';
  v_team_provider_batches TEXT := '';
  v_payment_records_policy_using TEXT;
  v_settlement_records_policy_using TEXT;
  v_settlement_accounts_policy_using TEXT;
  v_provider_settlement_accounts_policy_using TEXT;
  v_provider_batches_policy_using TEXT;
  v_internal_tables TEXT[] := ARRAY[
    'payment_events',
    'payment_providers',
    'payment_method_configs',
    'payment_provider_routes',
    'merchant_wallets',
    'payment_sessions',
    'treasury_transactions',
    'settlement_batches',
    'treasury_webhook_logs',
    'crypto_payment_sessions',
    'settlement_reconciliation_logs',
    'provider_settlement_batch_items'
  ];
  v_merchant_read_tables TEXT[] := ARRAY[
    'payment_records',
    'settlement_records',
    'merchant_settlement_accounts',
    'merchant_provider_settlement_accounts',
    'provider_settlement_batches'
  ];
  v_table TEXT;
BEGIN
  IF to_regclass('public.payment_sessions') IS NULL THEN
    RAISE EXCEPTION 'Migration A verification failed: public.payment_sessions was not created';
  END IF;

  IF to_regclass('public.crypto_payment_sessions') IS NULL THEN
    RAISE EXCEPTION 'Migration A verification failed: public.crypto_payment_sessions was not created';
  END IF;

  IF to_regclass('public.settlement_records') IS NULL THEN
    RAISE EXCEPTION 'Migration A verification failed: public.settlement_records was not created';
  END IF;

  PERFORM pg_temp.assert_public_function_exists(
    'process_breet_invoice_confirmation',
    'p_payment_session_id uuid, p_event_type text, p_processor_reference text, p_blockchain_tx_hash text, p_breet_reference text, p_source_amount numeric, p_exchange_rate numeric, p_payment_rail text, p_source_currency text, p_gross_ngn numeric, p_platform_fee numeric, p_network_fee numeric, p_merchant_net_ngn numeric, p_confirmation_count integer, p_expected_confirmations integer, p_raw_payload jsonb'
  );
  PERFORM pg_temp.assert_public_function_exists(
    'queue_pending_crypto_settlements',
    'p_merchant_id uuid, p_payout_provider text'
  );
  PERFORM pg_temp.assert_public_function_exists(
    'update_settlement_batch_status',
    'p_batch_id uuid, p_action text, p_failure_reason text'
  );
  PERFORM pg_temp.assert_public_function_execute_grants(
    'process_breet_invoice_confirmation',
    'p_payment_session_id uuid, p_event_type text, p_processor_reference text, p_blockchain_tx_hash text, p_breet_reference text, p_source_amount numeric, p_exchange_rate numeric, p_payment_rail text, p_source_currency text, p_gross_ngn numeric, p_platform_fee numeric, p_network_fee numeric, p_merchant_net_ngn numeric, p_confirmation_count integer, p_expected_confirmations integer, p_raw_payload jsonb',
    ARRAY['service_role']
  );
  PERFORM pg_temp.assert_public_function_execute_grants(
    'queue_pending_crypto_settlements',
    'p_merchant_id uuid, p_payout_provider text',
    ARRAY['service_role']
  );
  PERFORM pg_temp.assert_public_function_execute_grants(
    'update_settlement_batch_status',
    'p_batch_id uuid, p_action text, p_failure_reason text',
    ARRAY['service_role']
  );

  IF v_has_merchant_team THEN
    v_team_payment_records := ' OR (EXISTS (SELECT 1 FROM merchant_team mt WHERE ((mt.merchant_id = payment_records.merchant_id) AND (mt.user_id = auth.uid()) AND (COALESCE(mt.is_active, false) = true))))';
    v_team_settlement_records := ' OR (EXISTS (SELECT 1 FROM merchant_team mt WHERE ((mt.merchant_id = settlement_records.merchant_id) AND (mt.user_id = auth.uid()) AND (COALESCE(mt.is_active, false) = true))))';
    v_team_settlement_accounts := ' OR (EXISTS (SELECT 1 FROM merchant_team mt WHERE ((mt.merchant_id = merchant_settlement_accounts.merchant_id) AND (mt.user_id = auth.uid()) AND (COALESCE(mt.is_active, false) = true))))';
    v_team_provider_settlement_accounts := ' OR (EXISTS (SELECT 1 FROM merchant_team mt WHERE ((mt.merchant_id = merchant_provider_settlement_accounts.merchant_id) AND (mt.user_id = auth.uid()) AND (COALESCE(mt.is_active, false) = true))))';
    v_team_provider_batches := ' OR (EXISTS (SELECT 1 FROM merchant_team mt WHERE ((mt.merchant_id = provider_settlement_batches.merchant_id) AND (mt.user_id = auth.uid()) AND (COALESCE(mt.is_active, false) = true))))';
  END IF;

  v_payment_records_policy_using := format(
    '((auth.role() = ''authenticated''::text) AND ((EXISTS (SELECT 1 FROM merchants m WHERE ((m.id = payment_records.merchant_id) AND (m.user_id = auth.uid()))))%s))',
    v_team_payment_records
  );
  v_settlement_records_policy_using := format(
    '((auth.role() = ''authenticated''::text) AND ((EXISTS (SELECT 1 FROM merchants m WHERE ((m.id = settlement_records.merchant_id) AND (m.user_id = auth.uid()))))%s))',
    v_team_settlement_records
  );
  v_settlement_accounts_policy_using := format(
    '((auth.role() = ''authenticated''::text) AND ((EXISTS (SELECT 1 FROM merchants m WHERE ((m.id = merchant_settlement_accounts.merchant_id) AND (m.user_id = auth.uid()))))%s))',
    v_team_settlement_accounts
  );
  v_provider_settlement_accounts_policy_using := format(
    '((auth.role() = ''authenticated''::text) AND ((EXISTS (SELECT 1 FROM merchants m WHERE ((m.id = merchant_provider_settlement_accounts.merchant_id) AND (m.user_id = auth.uid()))))%s))',
    v_team_provider_settlement_accounts
  );
  v_provider_batches_policy_using := format(
    '((auth.role() = ''authenticated''::text) AND ((EXISTS (SELECT 1 FROM merchants m WHERE ((m.id = provider_settlement_batches.merchant_id) AND (m.user_id = auth.uid()))))%s))',
    v_team_provider_batches
  );

  PERFORM pg_temp.assert_public_rls_state('payment_events', false);
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'payment_events'
  ) THEN
    RAISE EXCEPTION 'Migration A verification failed: public.payment_events unexpectedly has RLS policies';
  END IF;
  PERFORM pg_temp.assert_public_column_definition('payment_events', 'merchant_id', 'uuid', false, NULL);
  PERFORM pg_temp.assert_public_foreign_key(
    'payment_events',
    'payment_events_merchant_id_fkey',
    ARRAY['merchant_id'],
    'merchants',
    ARRAY['id'],
    'CASCADE'
  );
  PERFORM pg_temp.assert_public_column_definition('payment_events', 'amount_kobo', 'int8', false, NULL);
  PERFORM pg_temp.assert_public_policy_compatible(
    'payment_records',
    'merchant_read_payment_records',
    'SELECT',
    ARRAY['public'],
    ARRAY[v_payment_records_policy_using]
  );
  PERFORM pg_temp.assert_public_permissive_select_policy_safe(
    'payment_records',
    'merchant_read_payment_records',
    ARRAY['public'],
    v_payment_records_policy_using
  );

  PERFORM pg_temp.assert_public_rls_state('payment_records', true);
  PERFORM pg_temp.assert_public_rls_state('settlement_records', true);
  PERFORM pg_temp.assert_public_rls_state('merchant_settlement_accounts', true);
  PERFORM pg_temp.assert_public_rls_state('merchant_provider_settlement_accounts', true);
  PERFORM pg_temp.assert_public_rls_state('provider_settlement_batches', true);

  PERFORM pg_temp.assert_public_policy_compatible(
    'settlement_records',
    'merchant_read_settlement_records',
    'SELECT',
    ARRAY['public'],
    ARRAY[v_settlement_records_policy_using]
  );
  PERFORM pg_temp.assert_public_permissive_select_policy_safe(
    'settlement_records',
    'merchant_read_settlement_records',
    ARRAY['public'],
    v_settlement_records_policy_using
  );
  PERFORM pg_temp.assert_public_policy_compatible(
    'merchant_settlement_accounts',
    'merchant_read_settlement_accounts',
    'SELECT',
    ARRAY['public'],
    ARRAY[v_settlement_accounts_policy_using]
  );
  PERFORM pg_temp.assert_public_permissive_select_policy_safe(
    'merchant_settlement_accounts',
    'merchant_read_settlement_accounts',
    ARRAY['public'],
    v_settlement_accounts_policy_using
  );
  PERFORM pg_temp.assert_public_policy_compatible(
    'merchant_provider_settlement_accounts',
    'merchant_read_provider_settlement_accounts',
    'SELECT',
    ARRAY['public'],
    ARRAY[v_provider_settlement_accounts_policy_using]
  );
  PERFORM pg_temp.assert_public_permissive_select_policy_safe(
    'merchant_provider_settlement_accounts',
    'merchant_read_provider_settlement_accounts',
    ARRAY['public'],
    v_provider_settlement_accounts_policy_using
  );
  PERFORM pg_temp.assert_public_policy_compatible(
    'provider_settlement_batches',
    'merchant_read_provider_batches',
    'SELECT',
    ARRAY['public'],
    ARRAY[v_provider_batches_policy_using]
  );
  PERFORM pg_temp.assert_public_permissive_select_policy_safe(
    'provider_settlement_batches',
    'merchant_read_provider_batches',
    ARRAY['public'],
    v_provider_batches_policy_using
  );

  FOREACH v_table IN ARRAY v_internal_tables
  LOOP
    PERFORM pg_temp.assert_public_table_access_manifest(v_table, 'internal');
  END LOOP;

  FOREACH v_table IN ARRAY v_merchant_read_tables
  LOOP
    PERFORM pg_temp.assert_public_table_access_manifest(v_table, 'merchant_read_select');
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.platform_settings
    WHERE key IN (
      'breet_settlement_mode',
      'breet_auto_settlement_enabled',
      'breet_merchant_auto_settlement_enabled',
      'breet_invoice_crypto_enabled',
      'breet_subscription_crypto_enabled',
      'breet_development_checkout_enabled',
      'breet_allow_pending_as_completed_in_development',
      'breet_live_enabled'
    )
      AND (
        (key = 'breet_settlement_mode' AND value <> 'disabled')
        OR (key <> 'breet_settlement_mode' AND value <> 'false')
      )
  ) THEN
    RAISE EXCEPTION 'Migration A verification failed: one or more Breet settings are not disabled by default';
  END IF;
END;
$$;

COMMIT;
