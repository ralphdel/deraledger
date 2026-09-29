BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_table_exists_m010(p_table_name TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_regclass(format('public.%I', p_table_name)) IS NULL THEN
    RAISE EXCEPTION 'Migration B prerequisite missing: public.% does not exist', p_table_name;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_column_exists_m010(
  p_table_name TEXT,
  p_column_name TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = p_table_name
      AND a.attname = p_column_name
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Migration B prerequisite missing: public.%.% does not exist', p_table_name, p_column_name;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_function_exists_m010(
  p_function_name TEXT,
  p_identity_arguments TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = p_function_name
      AND pg_get_function_identity_arguments(p.oid) = p_identity_arguments
  ) THEN
    RAISE EXCEPTION 'Migration B prerequisite missing: public.% (%) does not exist',
      p_function_name,
      p_identity_arguments;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_relation_kind_m010(
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
    RAISE EXCEPTION 'Migration B prerequisite missing: public.% relation does not exist', p_table_name;
  END IF;

  IF v_relkind <> p_expected_kind THEN
    RAISE EXCEPTION 'Migration B compatibility failure: public.% expected relation kind %, actual %',
      p_table_name,
      p_expected_kind,
      v_relkind;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_column_type_m010(
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
    RAISE EXCEPTION 'Migration B prerequisite missing: public.%.% does not exist', p_table_name, p_column_name;
  END IF;

  IF v_udt_name <> p_udt_name THEN
    RAISE EXCEPTION 'Migration B compatibility failure: public.%.% expected type %, actual %',
      p_table_name,
      p_column_name,
      p_udt_name,
      v_udt_name;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.normalize_catalog_sql_m010(p_input TEXT)
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

CREATE OR REPLACE FUNCTION pg_temp.assert_public_column_definition_m010(
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
    RAISE EXCEPTION 'Migration B prerequisite missing: public.%.% does not exist', p_table_name, p_column_name;
  END IF;

  IF v_udt_name <> p_udt_name THEN
    RAISE EXCEPTION 'Migration B compatibility failure: public.%.% expected type %, actual %',
      p_table_name,
      p_column_name,
      p_udt_name,
      v_udt_name;
  END IF;

  IF v_not_null IS DISTINCT FROM p_not_null THEN
    RAISE EXCEPTION 'Migration B compatibility failure: public.%.% expected not_null %, actual %',
      p_table_name,
      p_column_name,
      p_not_null,
      v_not_null;
  END IF;

  IF p_default_fragment IS NULL THEN
    IF v_default_expr IS NOT NULL THEN
      RAISE EXCEPTION 'Migration B compatibility failure: public.%.% expected no default, actual %',
        p_table_name,
        p_column_name,
        v_default_expr;
    END IF;
  ELSIF v_default_expr IS NULL OR position(lower(p_default_fragment) in lower(v_default_expr)) = 0 THEN
    RAISE EXCEPTION 'Migration B compatibility failure: public.%.% expected default containing %, actual %',
      p_table_name,
      p_column_name,
      p_default_fragment,
      COALESCE(v_default_expr, 'NULL');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_constraint_contains_m010(
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
    RAISE EXCEPTION 'Migration B prerequisite missing: public.%.% constraint does not exist',
      p_table_name,
      p_constraint_name;
  END IF;

  FOREACH v_fragment IN ARRAY p_expected_fragments
  LOOP
    IF v_fragment IS NOT NULL AND position(lower(v_fragment) in lower(v_definition)) = 0 THEN
      RAISE EXCEPTION 'Migration B compatibility failure: public.%.% expected "%" actual %',
        p_table_name,
        p_constraint_name,
        v_fragment,
        v_definition;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_constraint_definition_one_of_m010(
  p_table_name TEXT,
  p_constraint_name TEXT,
  p_constraint_type "char",
  p_expected_definitions TEXT[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_definition TEXT;
  v_expected_definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO v_definition
  FROM pg_constraint
  WHERE conrelid = format('public.%I', p_table_name)::regclass
    AND conname = p_constraint_name
    AND contype = p_constraint_type;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Migration B prerequisite missing: public.%.% constraint does not exist',
      p_table_name,
      p_constraint_name;
  END IF;

  FOREACH v_expected_definition IN ARRAY p_expected_definitions
  LOOP
    IF pg_temp.normalize_catalog_sql_m010(v_definition) = pg_temp.normalize_catalog_sql_m010(v_expected_definition) THEN
      RETURN;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'Migration B compatibility failure: public.%.% expected one of %, actual %',
    p_table_name,
    p_constraint_name,
    p_expected_definitions,
    v_definition;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_foreign_key_m010(
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
  v_actual_ref_table TEXT;
  v_actual_ref_columns TEXT[];
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
    RAISE EXCEPTION 'Migration B prerequisite missing: public.%.% foreign key does not exist',
      p_table_name,
      p_constraint_name;
  END IF;

  IF v_actual_columns <> p_expected_columns THEN
    RAISE EXCEPTION 'Migration B compatibility failure: public.%.% expected columns %, actual %',
      p_table_name,
      p_constraint_name,
      p_expected_columns,
      v_actual_columns;
  END IF;

  IF v_actual_ref_table <> p_expected_ref_table THEN
    RAISE EXCEPTION 'Migration B compatibility failure: public.%.% expected references public.%, actual public.%',
      p_table_name,
      p_constraint_name,
      p_expected_ref_table,
      v_actual_ref_table;
  END IF;

  IF v_actual_ref_columns <> p_expected_ref_columns THEN
    RAISE EXCEPTION 'Migration B compatibility failure: public.%.% expected referenced columns %, actual %',
      p_table_name,
      p_constraint_name,
      p_expected_ref_columns,
      v_actual_ref_columns;
  END IF;

  IF upper(v_actual_delete_action) <> upper(p_expected_delete_action) THEN
    RAISE EXCEPTION 'Migration B compatibility failure: public.%.% expected on delete %, actual %',
      p_table_name,
      p_constraint_name,
      p_expected_delete_action,
      v_actual_delete_action;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_index_contains_m010(
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
    RAISE EXCEPTION 'Migration B prerequisite missing: public.% index does not exist', p_index_name;
  END IF;

  FOREACH v_fragment IN ARRAY p_expected_fragments
  LOOP
    IF v_fragment IS NOT NULL AND position(lower(v_fragment) in lower(v_definition)) = 0 THEN
      RAISE EXCEPTION 'Migration B compatibility failure: public.% expected "%" actual %',
        p_index_name,
        v_fragment,
        v_definition;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_index_definition_m010(
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
  v_unique BOOLEAN;
  v_valid BOOLEAN;
BEGIN
  SELECT
    pg_get_indexdef(idx.indexrelid),
    pg_get_expr(idx.indpred, idx.indrelid, true),
    idx.indisunique,
    idx.indisvalid
  INTO
    v_definition,
    v_predicate,
    v_unique,
    v_valid
  FROM pg_index idx
  WHERE idx.indexrelid = format('public.%I', p_index_name)::regclass;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Migration B prerequisite missing: public.% index does not exist', p_index_name;
  END IF;

  IF pg_temp.normalize_catalog_sql_m010(v_definition) <> pg_temp.normalize_catalog_sql_m010(p_expected_indexdef) THEN
    RAISE EXCEPTION 'Migration B compatibility failure: public.% expected indexdef % actual %',
      p_index_name,
      p_expected_indexdef,
      v_definition;
  END IF;

  IF pg_temp.normalize_catalog_sql_m010(v_predicate) IS DISTINCT FROM pg_temp.normalize_catalog_sql_m010(p_expected_predicate) THEN
    RAISE EXCEPTION 'Migration B compatibility failure: public.% expected predicate % actual %',
      p_index_name,
      COALESCE(p_expected_predicate, 'NULL'),
      COALESCE(v_predicate, 'NULL');
  END IF;

  IF v_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Migration B compatibility failure: public.% index is invalid', p_index_name;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_public_function_execute_grants_m010(
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
    RAISE EXCEPTION 'Migration B prerequisite missing: public.% (%) does not exist',
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
    RAISE EXCEPTION 'Migration B compatibility failure: public.% (%) expected execute grantees % actual %',
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
    RAISE EXCEPTION 'Migration B compatibility failure: public.% (%) expected no execute for role PUBLIC actual granted',
      p_function_name,
      p_identity_arguments;
  END IF;

  FOREACH v_denied_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF has_function_privilege(v_denied_role, v_function_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Migration B compatibility failure: public.% (%) expected no execute for role % actual granted',
        p_function_name,
        p_identity_arguments,
        v_denied_role;
    END IF;
  END LOOP;
END;
$$;

DO $$
BEGIN
  PERFORM pg_temp.assert_public_table_exists_m010('payment_records');
  PERFORM pg_temp.assert_public_table_exists_m010('payment_sessions');
  PERFORM pg_temp.assert_public_table_exists_m010('crypto_payment_sessions');
  PERFORM pg_temp.assert_public_table_exists_m010('settlement_records');
  PERFORM pg_temp.assert_public_table_exists_m010('onboarding_sessions');
  PERFORM pg_temp.assert_public_table_exists_m010('solo_plus_cases');
  PERFORM pg_temp.assert_public_table_exists_m010('solo_plus_case_events');
  PERFORM pg_temp.assert_public_relation_kind_m010('payment_records');
  PERFORM pg_temp.assert_public_relation_kind_m010('payment_sessions');
  PERFORM pg_temp.assert_public_relation_kind_m010('crypto_payment_sessions');
  PERFORM pg_temp.assert_public_relation_kind_m010('settlement_records');
  PERFORM pg_temp.assert_public_relation_kind_m010('onboarding_sessions');
  PERFORM pg_temp.assert_public_relation_kind_m010('solo_plus_cases');
  PERFORM pg_temp.assert_public_relation_kind_m010('solo_plus_case_events');

  PERFORM pg_temp.assert_public_column_exists_m010('payment_records', 'expected_amount');
  PERFORM pg_temp.assert_public_column_exists_m010('payment_records', 'processing_status');
  PERFORM pg_temp.assert_public_column_exists_m010('payment_records', 'account_setup_status');
  PERFORM pg_temp.assert_public_column_exists_m010('payment_records', 'reconciliation_status');
  PERFORM pg_temp.assert_public_column_exists_m010('payment_records', 'created_at');
  PERFORM pg_temp.assert_public_column_exists_m010('payment_records', 'payment_status');
  PERFORM pg_temp.assert_public_column_exists_m010('payment_records', 'provider_name');
  PERFORM pg_temp.assert_public_column_exists_m010('payment_records', 'provider_reference');
  PERFORM pg_temp.assert_public_column_exists_m010('settlement_records', 'settlement_recipient_type');
  PERFORM pg_temp.assert_public_column_exists_m010('settlement_records', 'settlement_mode');
  PERFORM pg_temp.assert_public_column_exists_m010('settlement_records', 'provider_fee_source');
  PERFORM pg_temp.assert_public_column_exists_m010('crypto_payment_sessions', 'settlement_recipient_type');
  PERFORM pg_temp.assert_public_column_exists_m010('crypto_payment_sessions', 'settlement_mode');
  PERFORM pg_temp.assert_public_column_exists_m010('solo_plus_cases', 'payment_record_id');
  PERFORM pg_temp.assert_public_column_exists_m010('solo_plus_cases', 'payment_provider');
  PERFORM pg_temp.assert_public_column_exists_m010('solo_plus_cases', 'payment_reference');
  PERFORM pg_temp.assert_public_column_exists_m010('solo_plus_case_events', 'request_idempotency_key');

  PERFORM pg_temp.assert_public_constraint_definition_one_of_m010(
    'solo_plus_cases',
    'solo_plus_cases_payment_provider_check',
    'c',
    ARRAY[
      'CHECK (((payment_provider IS NULL) OR (payment_provider = ANY (ARRAY[''paystack''::text, ''monnify''::text]))))',
      'CHECK (((payment_provider IS NULL) OR (payment_provider = ANY (ARRAY[''paystack''::text, ''monnify''::text, ''breet''::text]))))'
    ]
  );
  PERFORM pg_temp.assert_public_index_contains_m010(
    'idx_solo_plus_case_events_request_idempotency',
    ARRAY['public.solo_plus_case_events', 'case_id', 'event_type', 'request_idempotency_key', 'where']
  );

  PERFORM pg_temp.assert_public_function_exists_m010(
    'process_breet_invoice_confirmation',
    'p_payment_session_id uuid, p_event_type text, p_processor_reference text, p_blockchain_tx_hash text, p_breet_reference text, p_source_amount numeric, p_exchange_rate numeric, p_payment_rail text, p_source_currency text, p_gross_ngn numeric, p_platform_fee numeric, p_network_fee numeric, p_merchant_net_ngn numeric, p_confirmation_count integer, p_expected_confirmations integer, p_raw_payload jsonb'
  );
  PERFORM pg_temp.assert_public_function_exists_m010(
    'queue_pending_crypto_settlements',
    'p_merchant_id uuid, p_payout_provider text'
  );
  PERFORM pg_temp.assert_public_function_exists_m010(
    'update_settlement_batch_status',
    'p_batch_id uuid, p_action text, p_failure_reason text'
  );
  PERFORM pg_temp.assert_public_function_exists_m010(
    'solo_plus_assert_amount_v1',
    'p_expected_amount text'
  );
  PERFORM pg_temp.assert_public_function_exists_m010(
    'solo_plus_case_bundle_payload_v1',
    'p_case_id uuid'
  );

  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'payment_records'
      AND a.attname = 'onboarding_session_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    PERFORM pg_temp.assert_public_column_definition_m010('payment_records', 'onboarding_session_id', 'uuid', false, NULL);
    PERFORM pg_temp.assert_public_foreign_key_m010(
      'payment_records',
      'payment_records_onboarding_session_id_fkey',
      ARRAY['onboarding_session_id'],
      'onboarding_sessions',
      ARRAY['id'],
      'SET NULL'
    );
    IF (
      SELECT count(*)
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid
       AND att.attnum = con.conkey[1]
      WHERE con.conrelid = 'public.payment_records'::regclass
        AND con.contype = 'f'
        AND cardinality(con.conkey) = 1
        AND att.attname = 'onboarding_session_id'
    ) <> 1 THEN
      RAISE EXCEPTION 'Migration B compatibility failure: public.payment_records.onboarding_session_id must have exactly one canonical foreign key';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'payment_records'
      AND a.attname = 'solo_plus_case_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    PERFORM pg_temp.assert_public_column_definition_m010('payment_records', 'solo_plus_case_id', 'uuid', false, NULL);
    PERFORM pg_temp.assert_public_foreign_key_m010(
      'payment_records',
      'payment_records_solo_plus_case_id_fkey',
      ARRAY['solo_plus_case_id'],
      'solo_plus_cases',
      ARRAY['id'],
      'SET NULL'
    );
    IF (
      SELECT count(*)
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid
       AND att.attnum = con.conkey[1]
      WHERE con.conrelid = 'public.payment_records'::regclass
        AND con.contype = 'f'
        AND cardinality(con.conkey) = 1
        AND att.attname = 'solo_plus_case_id'
    ) <> 1 THEN
      RAISE EXCEPTION 'Migration B compatibility failure: public.payment_records.solo_plus_case_id must have exactly one canonical foreign key';
    END IF;
  END IF;

  IF to_regclass('public.idx_payment_records_onboarding_session') IS NOT NULL THEN
    PERFORM pg_temp.assert_public_index_definition_m010(
      'idx_payment_records_onboarding_session',
      'CREATE INDEX idx_payment_records_onboarding_session ON public.payment_records USING btree (onboarding_session_id, created_at DESC)',
      NULL
    );
  END IF;

  IF to_regclass('public.idx_payment_records_solo_plus_case') IS NOT NULL THEN
    PERFORM pg_temp.assert_public_index_definition_m010(
      'idx_payment_records_solo_plus_case',
      'CREATE INDEX idx_payment_records_solo_plus_case ON public.payment_records USING btree (solo_plus_case_id, created_at DESC)',
      NULL
    );
  END IF;

  IF to_regclass('public.idx_payment_records_solo_plus_pending_case') IS NOT NULL THEN
    PERFORM pg_temp.assert_public_index_definition_m010(
      'idx_payment_records_solo_plus_pending_case',
      'CREATE UNIQUE INDEX idx_payment_records_solo_plus_pending_case ON public.payment_records USING btree (solo_plus_case_id) WHERE ((solo_plus_case_id IS NOT NULL) AND ((payment_status)::text = ''pending''::text))',
      'solo_plus_case_id IS NOT NULL AND payment_status::text = ''pending''::text'
    );
  END IF;

  IF to_regclass('public.idx_payment_records_solo_plus_provider_reference') IS NOT NULL THEN
    PERFORM pg_temp.assert_public_index_definition_m010(
      'idx_payment_records_solo_plus_provider_reference',
      'CREATE UNIQUE INDEX idx_payment_records_solo_plus_provider_reference ON public.payment_records USING btree (provider_name, provider_reference) WHERE ((solo_plus_case_id IS NOT NULL) AND (provider_reference IS NOT NULL))',
      'solo_plus_case_id IS NOT NULL AND provider_reference IS NOT NULL'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'crypto_payment_sessions'
      AND a.attname = 'payment_record_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    PERFORM pg_temp.assert_public_column_definition_m010('crypto_payment_sessions', 'payment_record_id', 'uuid', false, NULL);
    PERFORM pg_temp.assert_public_foreign_key_m010(
      'crypto_payment_sessions',
      'crypto_payment_sessions_payment_record_id_fkey',
      ARRAY['payment_record_id'],
      'payment_records',
      ARRAY['id'],
      'SET NULL'
    );
  END IF;
END;
$$;

ALTER TABLE public.payment_records
  ADD COLUMN IF NOT EXISTS onboarding_session_id UUID REFERENCES public.onboarding_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS solo_plus_case_id UUID REFERENCES public.solo_plus_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payment_records_onboarding_session
  ON public.payment_records(onboarding_session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_records_solo_plus_case
  ON public.payment_records(solo_plus_case_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_records_solo_plus_pending_case
  ON public.payment_records(solo_plus_case_id)
  WHERE solo_plus_case_id IS NOT NULL
    AND payment_status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_records_solo_plus_provider_reference
  ON public.payment_records(provider_name, provider_reference)
  WHERE solo_plus_case_id IS NOT NULL
    AND provider_reference IS NOT NULL;

ALTER TABLE public.crypto_payment_sessions
  ADD COLUMN IF NOT EXISTS payment_record_id UUID REFERENCES public.payment_records(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_crypto_payment_sessions_payment_record_id
  ON public.crypto_payment_sessions(payment_record_id)
  WHERE payment_record_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.solo_plus_cases'::regclass
      AND conname = 'solo_plus_cases_payment_provider_check'
  ) THEN
    ALTER TABLE public.solo_plus_cases
      DROP CONSTRAINT solo_plus_cases_payment_provider_check;
  END IF;

  ALTER TABLE public.solo_plus_cases
    ADD CONSTRAINT solo_plus_cases_payment_provider_check
    CHECK (payment_provider IS NULL OR payment_provider IN ('paystack', 'monnify', 'breet'));
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_solo_plus_payment_v1(
  p_internal_reference TEXT,
  p_provider TEXT,
  p_provider_reference TEXT,
  p_payment_purpose TEXT,
  p_paid_amount TEXT,
  p_currency TEXT,
  p_merchant_id UUID DEFAULT NULL,
  p_onboarding_session_id UUID DEFAULT NULL,
  p_platform_directed BOOLEAN DEFAULT NULL,
  p_raw_provider_payload JSONB DEFAULT '{}'::jsonb,
  p_request_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment public.payment_records%ROWTYPE;
  v_case public.solo_plus_cases%ROWTYPE;
  v_event public.solo_plus_case_events%ROWTYPE;
  v_paid_amount NUMERIC(18,2);
  v_provider_reference TEXT;
  v_bundle JSONB;
  v_previous_state JSONB;
  v_new_state JSONB;
BEGIN
  IF p_internal_reference IS NULL OR btrim(p_internal_reference) = '' THEN
    RAISE EXCEPTION 'Solo Plus payment internal reference is required';
  END IF;

  IF p_provider NOT IN ('paystack', 'monnify', 'breet') THEN
    RAISE EXCEPTION 'Solo Plus payment provider must be paystack, monnify, or breet';
  END IF;

  IF p_payment_purpose NOT IN ('plan_subscription', 'plan_upgrade', 'plan_renewal') THEN
    RAISE EXCEPTION 'Solo Plus payment purpose is invalid';
  END IF;

  IF p_currency <> 'NGN' THEN
    RETURN jsonb_build_object(
      'kind', 'currency_conflict',
      'message', 'Solo Plus payment currency must be NGN.'
    );
  END IF;

  v_provider_reference := COALESCE(NULLIF(btrim(p_provider_reference), ''), btrim(p_internal_reference));
  v_paid_amount := public.solo_plus_assert_amount_v1(p_paid_amount);

  PERFORM pg_advisory_xact_lock(
    hashtextextended('solo_plus:payment:' || btrim(p_internal_reference), 0)
  );

  SELECT *
  INTO v_payment
  FROM public.payment_records
  WHERE internal_reference = btrim(p_internal_reference)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'kind', 'not_found',
      'message', 'Solo Plus payment record was not found.'
    );
  END IF;

  IF v_payment.solo_plus_case_id IS NULL THEN
    RETURN jsonb_build_object(
      'kind', 'not_solo_plus',
      'message', 'Payment record is not linked to a Solo Plus case.'
    );
  END IF;

  IF p_payment_purpose = 'plan_renewal' OR v_payment.payment_purpose = 'plan_renewal' THEN
    RETURN jsonb_build_object(
      'kind', 'purpose_conflict',
      'message', 'Solo Plus renewal remains deferred in Commit 7.'
    );
  END IF;

  IF p_payment_purpose NOT IN ('plan_subscription', 'plan_upgrade')
     OR v_payment.payment_purpose NOT IN ('plan_subscription', 'plan_upgrade')
     OR v_payment.payment_purpose <> p_payment_purpose THEN
    RETURN jsonb_build_object(
      'kind', 'purpose_conflict',
      'message', 'Solo Plus payment purpose mismatch.'
    );
  END IF;

  IF v_payment.provider_name IS DISTINCT FROM p_provider THEN
    RETURN jsonb_build_object(
      'kind', 'provider_conflict',
      'message', 'Solo Plus payment provider mismatch.'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payment_records pr
    WHERE pr.provider_name = p_provider
      AND pr.provider_reference = v_provider_reference
      AND pr.id <> v_payment.id
  ) THEN
    RETURN jsonb_build_object(
      'kind', 'duplicate_provider_reference',
      'message', 'Provider reference is already associated with a different payment record.'
    );
  END IF;

  SELECT *
  INTO v_case
  FROM public.solo_plus_cases
  WHERE id = v_payment.solo_plus_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'kind', 'not_found',
      'message', 'Solo Plus case was not found.'
    );
  END IF;

  IF v_case.id IS DISTINCT FROM v_payment.solo_plus_case_id THEN
    RETURN jsonb_build_object(
      'kind', 'ownership_conflict',
      'message', 'Solo Plus payment linkage is inconsistent.'
    );
  END IF;

  IF v_case.flow_origin = 'upgrade' THEN
    IF v_case.merchant_id IS NULL
       OR v_payment.merchant_id IS DISTINCT FROM v_case.merchant_id
       OR (p_merchant_id IS NOT NULL AND p_merchant_id IS DISTINCT FROM v_case.merchant_id) THEN
      RETURN jsonb_build_object(
        'kind', 'ownership_conflict',
        'message', 'Solo Plus upgrade ownership mismatch.'
      );
    END IF;
  ELSE
    IF v_case.onboarding_session_id IS NULL
       OR v_payment.onboarding_session_id IS DISTINCT FROM v_case.onboarding_session_id
       OR (p_onboarding_session_id IS NOT NULL AND p_onboarding_session_id IS DISTINCT FROM v_case.onboarding_session_id) THEN
      RETURN jsonb_build_object(
        'kind', 'ownership_conflict',
        'message', 'Solo Plus onboarding-session ownership mismatch.'
      );
    END IF;
  END IF;

  IF v_payment.currency IS DISTINCT FROM 'NGN' OR v_case.payment_currency IS DISTINCT FROM 'NGN' THEN
    RETURN jsonb_build_object(
      'kind', 'currency_conflict',
      'message', 'Solo Plus payment currency mismatch.'
    );
  END IF;

  IF v_payment.expected_amount IS DISTINCT FROM v_paid_amount
     OR v_case.expected_amount IS DISTINCT FROM v_paid_amount THEN
    RETURN jsonb_build_object(
      'kind', 'amount_mismatch',
      'message', 'Solo Plus payment amount mismatch.'
    );
  END IF;

  IF p_provider = 'breet' AND p_platform_directed IS DISTINCT FROM true THEN
    RETURN jsonb_build_object(
      'kind', 'platform_conflict',
      'message', 'Solo Plus Breet plan payments must be platform directed.'
    );
  END IF;

  IF v_payment.payment_status = 'successful'
     OR (v_case.payment_status = 'paid' AND v_case.case_status = 'verification_pending') THEN
    IF v_case.payment_record_id = v_payment.id
       AND v_case.payment_provider = p_provider
       AND v_case.payment_reference = v_provider_reference
       AND v_payment.provider_reference = v_provider_reference THEN
      v_bundle := public.solo_plus_case_bundle_payload_v1(v_case.id);
      RETURN jsonb_build_object(
        'kind', 'idempotent_replay',
        'case', v_bundle->'case',
        'requirements', v_bundle->'requirements',
        'event',
        (
          SELECT to_jsonb(e)
          FROM public.solo_plus_case_events e
          WHERE e.case_id = v_case.id
            AND e.event_type = 'payment_confirmed'
          ORDER BY e.created_at DESC, e.id DESC
          LIMIT 1
        )
      );
    END IF;

    RETURN jsonb_build_object(
      'kind', 'conflicting_replay',
      'message', 'Solo Plus payment was already confirmed with different details.'
    );
  END IF;

  IF v_case.case_status <> 'awaiting_payment' OR v_case.payment_status <> 'pending' THEN
    RETURN jsonb_build_object(
      'kind', 'state_conflict',
      'message', 'Solo Plus case is not awaiting payment confirmation.'
    );
  END IF;

  v_previous_state := jsonb_build_object(
    'caseStatus', v_case.case_status,
    'paymentStatus', v_case.payment_status,
    'paymentProvider', v_case.payment_provider,
    'paymentReference', v_case.payment_reference,
    'paymentRecordId', v_case.payment_record_id
  );

  UPDATE public.payment_records
  SET
    provider_reference = v_provider_reference,
    amount_paid = v_paid_amount,
    currency = 'NGN',
    payment_status = 'successful',
    processing_status = 'paid_pending_verification',
    account_setup_status = 'verification_pending',
    failure_reason = NULL,
    raw_provider_payload = COALESCE(p_raw_provider_payload, '{}'::jsonb),
    paid_at = now(),
    updated_at = now()
  WHERE id = v_payment.id
  RETURNING * INTO v_payment;

  UPDATE public.solo_plus_cases
  SET
    payment_status = 'paid',
    payment_record_id = v_payment.id,
    payment_provider = p_provider,
    payment_reference = v_provider_reference,
    case_status = 'verification_pending',
    row_version = row_version + 1,
    updated_at = now()
  WHERE id = v_case.id
  RETURNING * INTO v_case;

  v_new_state := jsonb_build_object(
    'caseStatus', v_case.case_status,
    'paymentStatus', v_case.payment_status,
    'paymentProvider', v_case.payment_provider,
    'paymentReference', v_case.payment_reference,
    'paymentRecordId', v_case.payment_record_id
  );

  INSERT INTO public.solo_plus_case_events (
    case_id,
    event_type,
    previous_state,
    new_state,
    actor_type,
    actor_id,
    request_idempotency_key,
    reason,
    policy_version
  )
  VALUES (
    v_case.id,
    'payment_confirmed',
    v_previous_state,
    v_new_state,
    'provider',
    NULL,
    p_request_idempotency_key,
    'Solo Plus payment confirmed.',
    v_case.requirements_policy_version
  )
  ON CONFLICT (case_id, event_type, request_idempotency_key)
  WHERE request_idempotency_key IS NOT NULL
  DO UPDATE SET new_state = EXCLUDED.new_state
  RETURNING * INTO v_event;

  v_bundle := public.solo_plus_case_bundle_payload_v1(v_case.id);
  RETURN jsonb_build_object(
    'kind', 'confirmed',
    'case', v_bundle->'case',
    'requirements', v_bundle->'requirements',
    'event', to_jsonb(v_event)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_solo_plus_payment_v1(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID, BOOLEAN, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_solo_plus_payment_v1(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID, BOOLEAN, JSONB, TEXT) TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'payment_records'
      AND a.attname = 'onboarding_session_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Migration B verification failed: public.payment_records.onboarding_session_id was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'payment_records'
      AND a.attname = 'solo_plus_case_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Migration B verification failed: public.payment_records.solo_plus_case_id was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'crypto_payment_sessions'
      AND a.attname = 'payment_record_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Migration B verification failed: public.crypto_payment_sessions.payment_record_id was not created';
  END IF;

  PERFORM pg_temp.assert_public_index_contains_m010(
    'idx_payment_records_onboarding_session',
    ARRAY['public.payment_records', 'onboarding_session_id', 'created_at']
  );
  PERFORM pg_temp.assert_public_index_contains_m010(
    'idx_payment_records_solo_plus_case',
    ARRAY['public.payment_records', 'solo_plus_case_id', 'created_at']
  );
  PERFORM pg_temp.assert_public_index_contains_m010(
    'idx_payment_records_solo_plus_pending_case',
    ARRAY['public.payment_records', 'solo_plus_case_id', 'payment_status', 'pending']
  );
  PERFORM pg_temp.assert_public_index_contains_m010(
    'idx_payment_records_solo_plus_provider_reference',
    ARRAY['public.payment_records', 'provider_name', 'provider_reference', 'solo_plus_case_id']
  );
  PERFORM pg_temp.assert_public_index_contains_m010(
    'idx_crypto_payment_sessions_payment_record_id',
    ARRAY['public.crypto_payment_sessions', 'payment_record_id', 'where']
  );
  PERFORM pg_temp.assert_public_foreign_key_m010(
    'payment_records',
    'payment_records_onboarding_session_id_fkey',
    ARRAY['onboarding_session_id'],
    'onboarding_sessions',
    ARRAY['id'],
    'SET NULL'
  );
  PERFORM pg_temp.assert_public_foreign_key_m010(
    'payment_records',
    'payment_records_solo_plus_case_id_fkey',
    ARRAY['solo_plus_case_id'],
    'solo_plus_cases',
    ARRAY['id'],
    'SET NULL'
  );
  PERFORM pg_temp.assert_public_foreign_key_m010(
    'crypto_payment_sessions',
    'crypto_payment_sessions_payment_record_id_fkey',
    ARRAY['payment_record_id'],
    'payment_records',
    ARRAY['id'],
    'SET NULL'
  );
  PERFORM pg_temp.assert_public_function_exists_m010(
    'confirm_solo_plus_payment_v1',
    'p_internal_reference text, p_provider text, p_provider_reference text, p_payment_purpose text, p_paid_amount text, p_currency text, p_merchant_id uuid, p_onboarding_session_id uuid, p_platform_directed boolean, p_raw_provider_payload jsonb, p_request_idempotency_key text'
  );
  PERFORM pg_temp.assert_public_function_execute_grants_m010(
    'confirm_solo_plus_payment_v1',
    'p_internal_reference text, p_provider text, p_provider_reference text, p_payment_purpose text, p_paid_amount text, p_currency text, p_merchant_id uuid, p_onboarding_session_id uuid, p_platform_directed boolean, p_raw_provider_payload jsonb, p_request_idempotency_key text',
    ARRAY['service_role']
  );

  IF EXISTS (
    SELECT 1
    FROM public.platform_settings
    WHERE key IN (
      'plan_migration_solo_lite_enabled',
      'solo_plus_enabled',
      'solo_plus_kyc_enabled'
    )
      AND value = 'true'
  ) THEN
    RAISE EXCEPTION 'Migration B verification failed: a protected feature flag is enabled';
  END IF;
END;
$$;

COMMIT;
