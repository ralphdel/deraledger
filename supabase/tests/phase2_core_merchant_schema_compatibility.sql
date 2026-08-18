BEGIN;

DO $$
DECLARE
  v_table text;
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
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'core merchant tables must exist: public.%', v_table;
    END IF;
  END LOOP;

  IF to_regclass('public.invoice_items') IS NOT NULL THEN
    RAISE NOTICE 'invoice_items is legacy/extra; the application contract remains public.line_items';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'clients'
      AND column_name = 'reminder_channels'
      AND udt_name = '_text'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'clients.reminder_channels must be non-null text[]';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'references'
      AND column_name = 'project_total_value'
      AND udt_name = 'numeric'
  ) THEN
    RAISE EXCEPTION 'references.project_total_value must exist as numeric';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoices'
      AND column_name = 'reference_id'
      AND udt_name = 'uuid'
  ) THEN
    RAISE EXCEPTION 'invoices.reference_id must exist as uuid';
  END IF;
END;
$$;

DO $$
DECLARE
  v_table text;
  v_privilege text;
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
    IF EXISTS (
      SELECT 1
      FROM information_schema.table_privileges privilege_row
      WHERE privilege_row.table_schema = 'public'
        AND privilege_row.table_name = v_table
        AND privilege_row.grantee IN ('PUBLIC', 'anon')
    ) THEN
      RAISE EXCEPTION 'anonymous access must be clear for public.%', v_table;
    END IF;

    IF NOT has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT') THEN
      RAISE EXCEPTION 'authenticated must read public.% through RLS', v_table;
    END IF;

    FOREACH v_privilege IN ARRAY ARRAY[
      'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]
    LOOP
      IF has_table_privilege('authenticated', format('public.%I', v_table), v_privilege) THEN
        RAISE EXCEPTION
          'authenticated must not write core merchant tables directly: public.% privilege=%',
          v_table,
          v_privilege;
      END IF;
    END LOOP;

    FOREACH v_privilege IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]
    LOOP
      IF NOT has_table_privilege('service_role', format('public.%I', v_table), v_privilege) THEN
        RAISE EXCEPTION
          'service_role must retain core merchant table access: public.% privilege=%',
          v_table,
          v_privilege;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'clients', 'invoices', 'line_items', 'references', 'item_catalog', 'discount_templates'
      )
      AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
      AND (
        cmd <> 'SELECT'
        OR policyname NOT IN (
          'authenticated_read_merchant_clients',
          'authenticated_read_merchant_invoices',
          'authenticated_read_merchant_line_items',
          'authenticated_read_merchant_references',
          'authenticated_read_merchant_item_catalog',
          'authenticated_read_merchant_discount_templates'
        )
      )
  ) THEN
    RAISE EXCEPTION 'core merchant tables must expose only named authenticated SELECT policies';
  END IF;
END;
$$;

ROLLBACK;
