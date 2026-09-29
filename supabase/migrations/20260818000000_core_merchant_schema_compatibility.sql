-- ============================================================
-- Core merchant schema compatibility
--
-- Consolidates the plan-neutral schema contracts previously kept in:
--   - purpledger_v2_1_migration.sql
--   - supabase/20260514_kyc_references_collections.sql
--   - reference_financial_engine_migration.sql
--
-- This migration is additive and transactional. It intentionally does not
-- create subscriptions, collect payments, or change provider configuration.
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION pg_temp.assert_column_m018(
  p_relation regclass,
  p_column text,
  p_type regtype,
  p_not_null boolean,
  p_allowed_defaults text[] DEFAULT NULL,
  p_allow_missing boolean DEFAULT false,
  p_expected_formatted_type text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_type oid;
  v_formatted_type text;
  v_not_null boolean;
  v_default text;
BEGIN
  SELECT
    attribute.atttypid,
    format_type(attribute.atttypid, attribute.atttypmod),
    attribute.attnotnull,
    pg_get_expr(default_value.adbin, default_value.adrelid, true)
  INTO v_type, v_formatted_type, v_not_null, v_default
  FROM pg_attribute attribute
  LEFT JOIN pg_attrdef default_value
    ON default_value.adrelid = attribute.attrelid
   AND default_value.adnum = attribute.attnum
  WHERE attribute.attrelid = p_relation
    AND attribute.attname = p_column
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  IF NOT FOUND THEN
    IF p_allow_missing THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Migration 018 compatibility failure: %.% is missing', p_relation, p_column;
  END IF;

  IF v_type <> p_type::oid THEN
    RAISE EXCEPTION
      'Migration 018 compatibility failure: %.% expected type %, actual %',
      p_relation,
      p_column,
      p_type::text,
      format_type(v_type, NULL);
  END IF;

  IF p_expected_formatted_type IS NOT NULL
     AND v_formatted_type <> p_expected_formatted_type THEN
    RAISE EXCEPTION
      'Migration 018 compatibility failure: %.% expected formatted type %, actual %',
      p_relation,
      p_column,
      p_expected_formatted_type,
      v_formatted_type;
  END IF;

  IF v_not_null <> p_not_null THEN
    RAISE EXCEPTION
      'Migration 018 compatibility failure: %.% expected not_null %, actual %',
      p_relation,
      p_column,
      p_not_null,
      v_not_null;
  END IF;

  IF p_allowed_defaults IS NOT NULL
     AND NOT (COALESCE(v_default, '<NULL>') = ANY (p_allowed_defaults)) THEN
    RAISE EXCEPTION
      'Migration 018 compatibility failure: %.% expected default one of %, actual %',
      p_relation,
      p_column,
      p_allowed_defaults,
      COALESCE(v_default, '<NULL>');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_key_m018(
  p_relation regclass,
  p_constraint text,
  p_type "char",
  p_columns text[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_columns text[];
  v_type "char";
  v_validated boolean;
BEGIN
  SELECT
    constraint_row.contype,
    constraint_row.convalidated,
    ARRAY(
      SELECT attribute.attname::text
      FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
      JOIN pg_attribute attribute
        ON attribute.attrelid = constraint_row.conrelid
       AND attribute.attnum = key_column.attnum
      ORDER BY key_column.ordinality
    )
  INTO v_type, v_validated, v_columns
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = p_relation
    AND constraint_row.conname = p_constraint;

  IF NOT FOUND
     OR v_type <> p_type
     OR NOT v_validated
     OR v_columns <> p_columns THEN
    RAISE EXCEPTION
      'Migration 018 compatibility failure: %.% expected type % columns %, actual type % columns % validated %',
      p_relation,
      p_constraint,
      p_type::text,
      p_columns,
      COALESCE(v_type::text, '<MISSING>'),
      COALESCE(v_columns, ARRAY[]::text[]),
      COALESCE(v_validated, false);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_fk_m018(
  p_relation regclass,
  p_constraint text,
  p_column text,
  p_referenced_relation regclass,
  p_referenced_column text,
  p_delete_action "char"
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_local_columns text[];
  v_referenced_columns text[];
  v_referenced_relation oid;
  v_delete_action "char";
  v_validated boolean;
BEGIN
  SELECT
    constraint_row.confrelid,
    constraint_row.confdeltype,
    constraint_row.convalidated,
    ARRAY(
      SELECT attribute.attname::text
      FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
      JOIN pg_attribute attribute
        ON attribute.attrelid = constraint_row.conrelid
       AND attribute.attnum = key_column.attnum
      ORDER BY key_column.ordinality
    ),
    ARRAY(
      SELECT attribute.attname::text
      FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key_column(attnum, ordinality)
      JOIN pg_attribute attribute
        ON attribute.attrelid = constraint_row.confrelid
       AND attribute.attnum = key_column.attnum
      ORDER BY key_column.ordinality
    )
  INTO
    v_referenced_relation,
    v_delete_action,
    v_validated,
    v_local_columns,
    v_referenced_columns
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = p_relation
    AND constraint_row.conname = p_constraint
    AND constraint_row.contype = 'f';

  IF NOT FOUND
     OR v_referenced_relation <> p_referenced_relation::oid
     OR v_delete_action <> p_delete_action
     OR NOT v_validated
     OR v_local_columns <> ARRAY[p_column]::text[]
     OR v_referenced_columns <> ARRAY[p_referenced_column]::text[] THEN
    RAISE EXCEPTION
      'Migration 018 compatibility failure: %.% is not the expected validated foreign key',
      p_relation,
      p_constraint;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_check_m018(
  p_relation regclass,
  p_constraint text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = p_relation
      AND constraint_row.conname = p_constraint
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
  ) THEN
    RAISE EXCEPTION
      'Migration 018 compatibility failure: %.% expected validated check constraint',
      p_relation,
      p_constraint;
  END IF;
END;
$$;

DO $$
DECLARE
  v_relation text;
  v_relkind text;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'public.merchants',
    'public.merchant_team',
    'public.clients',
    'public.invoices'
  ]
  LOOP
    IF to_regclass(v_relation) IS NULL THEN
      RAISE EXCEPTION 'Migration 018 prerequisite missing: %', v_relation;
    END IF;

    SELECT relation.relkind::text
    INTO v_relkind
    FROM pg_class relation
    WHERE relation.oid = to_regclass(v_relation);

    IF v_relkind <> 'r' THEN
      RAISE EXCEPTION
        'Migration 018 compatibility failure: % expected ordinary table, actual relkind %',
        v_relation,
        v_relkind;
    END IF;
  END LOOP;

  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'Migration 018 prerequisite missing: auth.users';
  END IF;

  IF to_regprocedure('public.can_read_merchant_row_v1(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'Migration 018 prerequisite missing: public.can_read_merchant_row_v1(uuid) from authorization hardening';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'Migration 018 prerequisite missing: expected Supabase database roles';
  END IF;

  -- The clean-launch clients table is an accepted legacy baseline. These
  -- columns are additive; any pre-existing version must already be canonical.
  PERFORM pg_temp.assert_column_m018('public.clients', 'address', 'text', false, NULL, true);
  PERFORM pg_temp.assert_column_m018('public.clients', 'whatsapp_number', 'text', false, NULL, true);
  PERFORM pg_temp.assert_column_m018('public.clients', 'reminder_enabled', 'boolean', true, ARRAY['false'], true);
  PERFORM pg_temp.assert_column_m018(
    'public.clients',
    'reminder_channels',
    'text[]',
    true,
    ARRAY['''{}''::text[]', 'ARRAY[]::text[]'],
    true
  );

  -- Invoice linkage columns are likewise allowed to be absent, but not to
  -- exist with a guessed or incompatible type.
  PERFORM pg_temp.assert_column_m018('public.invoices', 'reference_id', 'uuid', false, NULL, true);
  PERFORM pg_temp.assert_column_m018('public.invoices', 'handled_by', 'uuid', false, NULL, true);
  PERFORM pg_temp.assert_column_m018(
    'public.invoices',
    'invoice_stage',
    'text',
    false,
    ARRAY['''standard''::text'],
    true
  );

  -- CREATE TABLE IF NOT EXISTS must never accept an unrelated relation or a
  -- partial table silently. Existing target tables must match the committed
  -- column contract; project_total_value is the one known additive legacy gap.
  FOREACH v_relation IN ARRAY ARRAY[
    'public.references',
    'public.item_catalog',
    'public.discount_templates',
    'public.line_items'
  ]
  LOOP
    IF to_regclass(v_relation) IS NOT NULL THEN
      SELECT relation.relkind::text
      INTO v_relkind
      FROM pg_class relation
      WHERE relation.oid = to_regclass(v_relation);

      IF v_relkind <> 'r' THEN
        RAISE EXCEPTION
          'Migration 018 compatibility failure: % expected ordinary table, actual relkind %',
          v_relation,
          v_relkind;
      END IF;
    END IF;
  END LOOP;

  IF to_regclass('public.references') IS NOT NULL THEN
    PERFORM pg_temp.assert_column_m018('public.references', 'id', 'uuid', true, ARRAY['gen_random_uuid()']);
    PERFORM pg_temp.assert_column_m018('public.references', 'merchant_id', 'uuid', true);
    PERFORM pg_temp.assert_column_m018('public.references', 'name', 'text', true);
    PERFORM pg_temp.assert_column_m018('public.references', 'description', 'text', false);
    PERFORM pg_temp.assert_column_m018('public.references', 'handled_by', 'uuid', false);
    PERFORM pg_temp.assert_column_m018('public.references', 'created_at', 'timestamp with time zone', true, ARRAY['now()']);
    PERFORM pg_temp.assert_column_m018('public.references', 'updated_at', 'timestamp with time zone', true, ARRAY['now()']);
    PERFORM pg_temp.assert_column_m018('public.references', 'project_total_value', 'numeric', false, ARRAY['0'], true);
    PERFORM pg_temp.assert_key_m018('public.references', 'references_pkey', 'p', ARRAY['id']::text[]);
    PERFORM pg_temp.assert_key_m018(
      'public.references',
      'references_merchant_id_name_key',
      'u',
      ARRAY['merchant_id', 'name']::text[]
    );
    PERFORM pg_temp.assert_fk_m018(
      'public.references',
      'references_merchant_id_fkey',
      'merchant_id',
      'public.merchants',
      'id',
      'c'
    );
    PERFORM pg_temp.assert_fk_m018(
      'public.references',
      'references_handled_by_fkey',
      'handled_by',
      'auth.users',
      'id',
      'a'
    );
  END IF;

  IF to_regclass('public.item_catalog') IS NOT NULL THEN
    PERFORM pg_temp.assert_column_m018('public.item_catalog', 'id', 'uuid', true, ARRAY['gen_random_uuid()']);
    PERFORM pg_temp.assert_column_m018('public.item_catalog', 'merchant_id', 'uuid', true);
    PERFORM pg_temp.assert_column_m018('public.item_catalog', 'item_name', 'text', true);
    PERFORM pg_temp.assert_column_m018('public.item_catalog', 'default_rate', 'numeric', true, NULL, false, 'numeric(12,2)');
    PERFORM pg_temp.assert_column_m018('public.item_catalog', 'description', 'text', false);
    PERFORM pg_temp.assert_column_m018('public.item_catalog', 'is_active', 'boolean', true, ARRAY['true']);
    PERFORM pg_temp.assert_column_m018('public.item_catalog', 'usage_count', 'integer', true, ARRAY['0']);
    PERFORM pg_temp.assert_column_m018('public.item_catalog', 'created_at', 'timestamp with time zone', true, ARRAY['now()']);
    PERFORM pg_temp.assert_column_m018('public.item_catalog', 'updated_at', 'timestamp with time zone', true, ARRAY['now()']);
    PERFORM pg_temp.assert_key_m018('public.item_catalog', 'item_catalog_pkey', 'p', ARRAY['id']::text[]);
    PERFORM pg_temp.assert_fk_m018(
      'public.item_catalog',
      'item_catalog_merchant_id_fkey',
      'merchant_id',
      'public.merchants',
      'id',
      'c'
    );
    PERFORM pg_temp.assert_check_m018('public.item_catalog', 'item_name_len');
    PERFORM pg_temp.assert_check_m018('public.item_catalog', 'item_catalog_default_rate_check');
  END IF;

  IF to_regclass('public.discount_templates') IS NOT NULL THEN
    PERFORM pg_temp.assert_column_m018('public.discount_templates', 'id', 'uuid', true, ARRAY['gen_random_uuid()']);
    PERFORM pg_temp.assert_column_m018('public.discount_templates', 'merchant_id', 'uuid', true);
    PERFORM pg_temp.assert_column_m018('public.discount_templates', 'name', 'text', true);
    PERFORM pg_temp.assert_column_m018('public.discount_templates', 'percentage', 'numeric', true, NULL, false, 'numeric(5,2)');
    PERFORM pg_temp.assert_column_m018('public.discount_templates', 'is_active', 'boolean', true, ARRAY['true']);
    PERFORM pg_temp.assert_column_m018('public.discount_templates', 'created_at', 'timestamp with time zone', true, ARRAY['now()']);
    PERFORM pg_temp.assert_key_m018('public.discount_templates', 'discount_templates_pkey', 'p', ARRAY['id']::text[]);
    PERFORM pg_temp.assert_fk_m018(
      'public.discount_templates',
      'discount_templates_merchant_id_fkey',
      'merchant_id',
      'public.merchants',
      'id',
      'c'
    );
    PERFORM pg_temp.assert_check_m018('public.discount_templates', 'discount_name_len');
    PERFORM pg_temp.assert_check_m018('public.discount_templates', 'discount_templates_percentage_check');
  END IF;

  IF to_regclass('public.line_items') IS NOT NULL THEN
    PERFORM pg_temp.assert_column_m018('public.line_items', 'id', 'uuid', true, ARRAY['gen_random_uuid()']);
    PERFORM pg_temp.assert_column_m018('public.line_items', 'invoice_id', 'uuid', true);
    PERFORM pg_temp.assert_column_m018('public.line_items', 'item_name', 'text', true);
    PERFORM pg_temp.assert_column_m018('public.line_items', 'quantity', 'numeric', true, ARRAY['1'], false, 'numeric(10,3)');
    PERFORM pg_temp.assert_column_m018('public.line_items', 'unit_rate', 'numeric', true, ARRAY['0'], false, 'numeric(12,2)');
    PERFORM pg_temp.assert_column_m018('public.line_items', 'line_total', 'numeric', true, ARRAY['0'], false, 'numeric(12,2)');
    PERFORM pg_temp.assert_column_m018('public.line_items', 'sort_order', 'integer', true, ARRAY['0']);
    PERFORM pg_temp.assert_key_m018('public.line_items', 'line_items_pkey', 'p', ARRAY['id']::text[]);
    PERFORM pg_temp.assert_fk_m018(
      'public.line_items',
      'line_items_invoice_id_fkey',
      'invoice_id',
      'public.invoices',
      'id',
      'c'
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.invoices'::regclass
      AND attname = 'reference_id'
      AND attnum > 0
      AND NOT attisdropped
  ) THEN
    PERFORM pg_temp.assert_fk_m018(
      'public.invoices',
      'invoices_reference_id_fkey',
      'reference_id',
      'public.references',
      'id',
      'n'
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.invoices'::regclass
      AND attname = 'handled_by'
      AND attnum > 0
      AND NOT attisdropped
  ) THEN
    PERFORM pg_temp.assert_fk_m018(
      'public.invoices',
      'invoices_handled_by_fkey',
      'handled_by',
      'auth.users',
      'id',
      'a'
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.invoices'::regclass
      AND attname = 'invoice_stage'
      AND attnum > 0
      AND NOT attisdropped
  ) THEN
    PERFORM pg_temp.assert_check_m018('public.invoices', 'invoices_invoice_stage_check');
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public."references" (
  id UUID CONSTRAINT references_pkey PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL
    CONSTRAINT references_merchant_id_fkey REFERENCES public.merchants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  handled_by UUID
    CONSTRAINT references_handled_by_fkey REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_total_value NUMERIC DEFAULT 0,
  CONSTRAINT references_merchant_id_name_key UNIQUE (merchant_id, name)
);

CREATE TABLE IF NOT EXISTS public.item_catalog (
  id UUID CONSTRAINT item_catalog_pkey PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL
    CONSTRAINT item_catalog_merchant_id_fkey REFERENCES public.merchants(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL
    CONSTRAINT item_name_len CHECK (char_length(item_name) <= 200),
  default_rate NUMERIC(12,2) NOT NULL
    CONSTRAINT item_catalog_default_rate_check CHECK (default_rate >= 0),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.discount_templates (
  id UUID CONSTRAINT discount_templates_pkey PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL
    CONSTRAINT discount_templates_merchant_id_fkey REFERENCES public.merchants(id) ON DELETE CASCADE,
  name TEXT NOT NULL
    CONSTRAINT discount_name_len CHECK (char_length(name) <= 100),
  percentage NUMERIC(5,2) NOT NULL
    CONSTRAINT discount_templates_percentage_check CHECK (percentage > 0 AND percentage <= 100),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.line_items (
  id UUID CONSTRAINT line_items_pkey PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL
    CONSTRAINT line_items_invoice_id_fkey REFERENCES public.invoices(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  quantity NUMERIC(10,3) NOT NULL DEFAULT 1,
  unit_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_number TEXT
    CONSTRAINT whatsapp_format CHECK (
      whatsapp_number IS NULL OR whatsapp_number ~ '^[0-9]{10,15}$'
    ),
  ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_channels TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public."references"
  ADD COLUMN IF NOT EXISTS project_total_value NUMERIC DEFAULT 0;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS reference_id UUID
    CONSTRAINT invoices_reference_id_fkey
    REFERENCES public."references"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS handled_by UUID
    CONSTRAINT invoices_handled_by_fkey
    REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS invoice_stage TEXT DEFAULT 'standard';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'public.invoices'::regclass
      AND constraint_row.conname = 'invoices_invoice_stage_check'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_invoice_stage_check
      CHECK (invoice_stage IN ('deposit', 'milestone', 'balance', 'standard'));
  END IF;
END;
$$;

DO $$
DECLARE
  v_index_definition text;
  v_index_kind text;
BEGIN
  SELECT index_class.relkind::text, pg_get_indexdef(index_class.oid)
  INTO v_index_kind, v_index_definition
  FROM pg_class index_class
  JOIN pg_namespace index_namespace ON index_namespace.oid = index_class.relnamespace
  WHERE index_namespace.nspname = 'public'
    AND index_class.relname = 'idx_item_catalog_merchant';

  IF v_index_kind IS NOT NULL
     AND (
       v_index_kind <> 'i'
       OR v_index_definition <> 'CREATE INDEX idx_item_catalog_merchant ON public.item_catalog USING btree (merchant_id, is_active)'
     ) THEN
    RAISE EXCEPTION
      'Migration 018 compatibility failure: idx_item_catalog_merchant has an incompatible definition: %',
      v_index_definition;
  END IF;

  v_index_kind := NULL;
  v_index_definition := NULL;

  SELECT index_class.relkind::text, pg_get_indexdef(index_class.oid)
  INTO v_index_kind, v_index_definition
  FROM pg_class index_class
  JOIN pg_namespace index_namespace ON index_namespace.oid = index_class.relnamespace
  WHERE index_namespace.nspname = 'public'
    AND index_class.relname = 'idx_references_merchant';

  IF v_index_kind IS NOT NULL
     AND (
       v_index_kind <> 'i'
       OR v_index_definition <> 'CREATE INDEX idx_references_merchant ON public."references" USING btree (merchant_id, created_at DESC)'
     ) THEN
    RAISE EXCEPTION
      'Migration 018 compatibility failure: idx_references_merchant has an incompatible definition: %',
      v_index_definition;
  END IF;

  v_index_kind := NULL;
  v_index_definition := NULL;

  SELECT index_class.relkind::text, pg_get_indexdef(index_class.oid)
  INTO v_index_kind, v_index_definition
  FROM pg_class index_class
  JOIN pg_namespace index_namespace ON index_namespace.oid = index_class.relnamespace
  WHERE index_namespace.nspname = 'public'
    AND index_class.relname = 'idx_invoices_reference';

  IF v_index_kind IS NOT NULL
     AND (
       v_index_kind <> 'i'
       OR v_index_definition <> 'CREATE INDEX idx_invoices_reference ON public.invoices USING btree (reference_id)'
     ) THEN
    RAISE EXCEPTION
      'Migration 018 compatibility failure: idx_invoices_reference has an incompatible definition: %',
      v_index_definition;
  END IF;

  v_index_kind := NULL;
  v_index_definition := NULL;

  SELECT index_class.relkind::text, pg_get_indexdef(index_class.oid)
  INTO v_index_kind, v_index_definition
  FROM pg_class index_class
  JOIN pg_namespace index_namespace ON index_namespace.oid = index_class.relnamespace
  WHERE index_namespace.nspname = 'public'
    AND index_class.relname = 'idx_invoices_handled_by';

  IF v_index_kind IS NOT NULL
     AND (
       v_index_kind <> 'i'
       OR v_index_definition <> 'CREATE INDEX idx_invoices_handled_by ON public.invoices USING btree (handled_by)'
     ) THEN
    RAISE EXCEPTION
      'Migration 018 compatibility failure: idx_invoices_handled_by has an incompatible definition: %',
      v_index_definition;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_item_catalog_merchant
  ON public.item_catalog(merchant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_references_merchant
  ON public."references"(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_reference
  ON public.invoices(reference_id);
CREATE INDEX IF NOT EXISTS idx_invoices_handled_by
  ON public.invoices(handled_by);

DO $$
DECLARE
  v_table text;
  v_policy record;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'clients',
    'invoices',
    'line_items',
    'references',
    'item_catalog',
    'discount_templates'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);

    FOR v_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = v_table
        AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_policy.policyname, v_table);
    END LOOP;

    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM service_role', v_table);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_table);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_table);
  END LOOP;
END;
$$;

CREATE POLICY authenticated_read_merchant_clients
  ON public.clients
  FOR SELECT
  TO authenticated
  USING (public.can_read_merchant_row_v1(merchant_id));

CREATE POLICY authenticated_read_merchant_invoices
  ON public.invoices
  FOR SELECT
  TO authenticated
  USING (public.can_read_merchant_row_v1(merchant_id));

CREATE POLICY authenticated_read_merchant_line_items
  ON public.line_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.invoices invoice_row
      WHERE invoice_row.id = line_items.invoice_id
        AND public.can_read_merchant_row_v1(invoice_row.merchant_id)
    )
  );

CREATE POLICY authenticated_read_merchant_references
  ON public."references"
  FOR SELECT
  TO authenticated
  USING (public.can_read_merchant_row_v1(merchant_id));

CREATE POLICY authenticated_read_merchant_item_catalog
  ON public.item_catalog
  FOR SELECT
  TO authenticated
  USING (public.can_read_merchant_row_v1(merchant_id));

CREATE POLICY authenticated_read_merchant_discount_templates
  ON public.discount_templates
  FOR SELECT
  TO authenticated
  USING (public.can_read_merchant_row_v1(merchant_id));

COMMENT ON TABLE public."references" IS
  'Plan-neutral merchant project/reference groups. Feature availability remains enforced by application capabilities.';
COMMENT ON TABLE public.item_catalog IS
  'Plan-neutral merchant item catalogue used by invoice creation.';
COMMENT ON TABLE public.discount_templates IS
  'Plan-neutral merchant discount presets used by invoice creation.';

COMMIT;
