-- Migration 019: close the remaining core merchant/application contract gaps.
-- SQL-Editor compatible. This migration is additive and contains no business-row DML.
-- Prerequisites: the baseline/onboarding schema and migration 018 have been applied.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

-- Fail closed if a prerequisite table is absent or is not an ordinary table.
DO $$
DECLARE
  v_table text;
  v_relation regclass;
  v_relkind "char";
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'merchants', 'workspaces', 'merchant_team', 'roles', 'clients',
    'invoices', 'line_items', 'references', 'item_catalog', 'discount_templates'
  ]
  LOOP
    v_relation := to_regclass(format('public.%I', v_table));
    IF v_relation IS NULL THEN
      RAISE EXCEPTION
        'Migration 019 prerequisite missing: public.% must exist (apply the baseline and migration 018 first)',
        v_table;
    END IF;

    SELECT relkind INTO v_relkind FROM pg_class WHERE oid = v_relation;
    IF v_relkind <> 'r' THEN
      RAISE EXCEPTION
        'Migration 019 compatibility failure: public.% is relkind %, expected ordinary table',
        v_table,
        v_relkind;
    END IF;
  END LOOP;
END;
$$;

-- Missing columns below are repairable. Existing columns with an incompatible type
-- are not rewritten: abort and inspect instead.
DO $$
DECLARE
  v_expected record;
  v_actual_type text;
BEGIN
  FOR v_expected IN
    SELECT *
    FROM (VALUES
      ('clients'::text, 'deleted_at'::text, 'timestamp with time zone'::text),
      ('invoices', 'invoice_type', 'text'),
      ('invoices', 'payment_notes', 'text'),
      ('invoices', 'send_reminders', 'boolean'),
      ('invoices', 'allow_partial_payment', 'boolean'),
      ('invoices', 'partial_payment_pct', 'numeric'),
      ('invoices', 'is_archived', 'boolean'),
      ('invoices', 'archived_at', 'timestamp with time zone'),
      ('invoices', 'payment_provider', 'text'),
      ('invoices', 'invoice_hash', 'text'),
      ('invoices', 'payment_url', 'text'),
      ('merchant_team', 'must_change_password', 'boolean'),
      ('roles', 'merchant_id', 'uuid')
    ) AS expected(table_name, column_name, formatted_type)
  LOOP
    SELECT format_type(attribute.atttypid, attribute.atttypmod)
      INTO v_actual_type
    FROM pg_attribute attribute
    WHERE attribute.attrelid = to_regclass(format('public.%I', v_expected.table_name))
      AND attribute.attname = v_expected.column_name
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped;

    IF v_actual_type IS NOT NULL AND v_actual_type <> v_expected.formatted_type THEN
      RAISE EXCEPTION
        'Migration 019 compatibility failure: public.%.% is %, expected %',
        v_expected.table_name,
        v_expected.column_name,
        v_actual_type,
        v_expected.formatted_type;
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS invoice_type TEXT NOT NULL DEFAULT 'collection',
  ADD COLUMN IF NOT EXISTS payment_notes TEXT,
  ADD COLUMN IF NOT EXISTS send_reminders BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_partial_payment BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS partial_payment_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  -- createInvoiceAction always persists this compatibility value. Adding the
  -- column does not configure or enable a provider or collection capability.
  ADD COLUMN IF NOT EXISTS payment_provider TEXT DEFAULT 'paystack',
  ADD COLUMN IF NOT EXISTS invoice_hash TEXT,
  ADD COLUMN IF NOT EXISTS payment_url TEXT;

ALTER TABLE public.merchant_team
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS merchant_id UUID;

DO $$
DECLARE
  v_constraint pg_constraint%ROWTYPE;
BEGIN
  SELECT * INTO v_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.invoices'::regclass
    AND conname = 'valid_invoice_type';

  IF FOUND THEN
    IF v_constraint.contype <> 'c'
      OR NOT v_constraint.convalidated
      OR pg_get_constraintdef(v_constraint.oid, true) NOT LIKE '%invoice_type%record%collection%'
    THEN
      RAISE EXCEPTION
        'Migration 019 compatibility failure: public.invoices.valid_invoice_type is incompatible: %',
        pg_get_constraintdef(v_constraint.oid, true);
    END IF;
  ELSE
    ALTER TABLE public.invoices
      ADD CONSTRAINT valid_invoice_type
      CHECK (invoice_type IN ('record', 'collection')) NOT VALID;
    ALTER TABLE public.invoices VALIDATE CONSTRAINT valid_invoice_type;
  END IF;

  SELECT * INTO v_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.roles'::regclass
    AND conname = 'roles_merchant_id_fkey';

  IF FOUND THEN
    IF v_constraint.contype <> 'f'
      OR NOT v_constraint.convalidated
      OR v_constraint.confrelid <> 'public.merchants'::regclass
    THEN
      RAISE EXCEPTION
        'Migration 019 compatibility failure: public.roles.roles_merchant_id_fkey is incompatible: %',
        pg_get_constraintdef(v_constraint.oid, true);
    END IF;
  ELSE
    ALTER TABLE public.roles
      ADD CONSTRAINT roles_merchant_id_fkey
      FOREIGN KEY (merchant_id) REFERENCES public.merchants(id)
      NOT VALID;
    ALTER TABLE public.roles VALIDATE CONSTRAINT roles_merchant_id_fkey;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_clients_is_deleted
  ON public.clients (merchant_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_invoices_is_archived
  ON public.invoices (merchant_id, is_archived);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_hash
  ON public.invoices (invoice_hash);
CREATE INDEX IF NOT EXISTS idx_roles_merchant
  ON public.roles (merchant_id);

-- No RLS or grant changes are required: no table is created here and migration
-- 018 already establishes the browser-read/service-write policy for merchant data.
-- No role rows, subscriptions, provider configuration, or business rows are changed.

COMMIT;
