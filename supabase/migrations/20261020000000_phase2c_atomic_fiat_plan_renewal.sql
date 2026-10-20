-- Phase 2C-1B-A: service-only atomic fiat plan renewal substrate.
--
-- This migration is additive. No existing runtime path invokes this RPC in
-- this package, and this migration performs no business-row backfill.

BEGIN;

SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

CREATE OR REPLACE FUNCTION pg_temp.phase2c_assert_column(
  p_relation regclass,
  p_column text,
  p_type text,
  p_not_null boolean
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $helper$
DECLARE
  v_type text;
  v_not_null boolean;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull
  INTO v_type, v_not_null
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = p_relation
    AND a.attname = p_column
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF NOT FOUND OR v_type IS DISTINCT FROM p_type OR v_not_null IS DISTINCT FROM p_not_null THEN
    RAISE EXCEPTION
      'Phase 2C atomic renewal prerequisite incompatible: %.% expected type=% not_null=%, actual type=% not_null=%',
      p_relation, p_column, p_type, p_not_null,
      COALESCE(v_type, '<missing>'), COALESCE(v_not_null::text, '<missing>');
  END IF;
END;
$helper$;

CREATE OR REPLACE FUNCTION pg_temp.phase2c_assert_key(
  p_relation regclass,
  p_type "char",
  p_columns text[]
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $helper$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = p_relation
      AND c.contype = p_type
      AND c.convalidated
      AND NOT c.condeferrable
      AND NOT c.condeferred
      AND ARRAY(
        SELECT a.attname::text
        FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ordinality)
        JOIN pg_catalog.pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        ORDER BY k.ordinality
      ) = p_columns
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_index i
        WHERE i.indexrelid = c.conindid
          AND i.indisunique
          AND i.indisvalid
          AND i.indisready
          AND i.indislive
          AND i.indpred IS NULL
          AND i.indexprs IS NULL
          AND i.indnkeyatts = pg_catalog.cardinality(p_columns)
      )
  ) THEN
    RAISE EXCEPTION
      'Phase 2C atomic renewal prerequisite incompatible: % requires validated key type=% columns=%',
      p_relation, p_type, p_columns;
  END IF;
END;
$helper$;

CREATE OR REPLACE FUNCTION pg_temp.phase2c_assert_fk(
  p_relation regclass,
  p_columns text[],
  p_target regclass,
  p_target_columns text[],
  p_delete_action "char"
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $helper$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = p_relation
      AND c.contype = 'f'
      AND c.convalidated
      AND c.confrelid = p_target
      AND c.confupdtype = 'a'
      AND c.confdeltype = p_delete_action
      AND c.confmatchtype = 's'
      AND NOT c.condeferrable
      AND NOT c.condeferred
      AND ARRAY(
        SELECT a.attname::text
        FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ordinality)
        JOIN pg_catalog.pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        ORDER BY k.ordinality
      ) = p_columns
      AND ARRAY(
        SELECT a.attname::text
        FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ordinality)
        JOIN pg_catalog.pg_attribute a
          ON a.attrelid = c.confrelid AND a.attnum = k.attnum
        ORDER BY k.ordinality
      ) = p_target_columns
  ) THEN
    RAISE EXCEPTION
      'Phase 2C atomic renewal prerequisite incompatible: % requires validated foreign key % -> %',
      p_relation, p_columns, p_target_columns;
  END IF;
END;
$helper$;

DO $guard$
DECLARE
  v_relation text;
  v_rpc_count integer;
  v_rpc record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'Phase 2C atomic renewal prerequisite missing: service_role, anon, and authenticated roles are required';
  END IF;

  FOREACH v_relation IN ARRAY ARRAY[
    'public.payment_records',
    'public.merchants',
    'public.subscriptions',
    'public.subscription_payments'
  ] LOOP
    IF pg_catalog.to_regclass(v_relation) IS NULL THEN
      RAISE EXCEPTION 'Phase 2C atomic renewal prerequisite missing: %', v_relation;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class c
      WHERE c.oid = pg_catalog.to_regclass(v_relation)
        AND c.relkind = 'r'
        AND c.relrowsecurity
        AND NOT c.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'Phase 2C atomic renewal prerequisite incompatible: % must be an RLS-enabled ordinary table without FORCE RLS', v_relation;
    END IF;
  END LOOP;

  PERFORM pg_temp.phase2c_assert_column('public.payment_records', 'id', 'uuid', true);
  PERFORM pg_temp.phase2c_assert_column('public.payment_records', 'merchant_id', 'uuid', false);
  PERFORM pg_temp.phase2c_assert_column('public.payment_records', 'payment_purpose', 'character varying(50)', true);
  PERFORM pg_temp.phase2c_assert_column('public.payment_records', 'provider_name', 'character varying(50)', false);
  PERFORM pg_temp.phase2c_assert_column('public.payment_records', 'internal_reference', 'character varying(255)', true);
  PERFORM pg_temp.phase2c_assert_column('public.payment_records', 'provider_reference', 'character varying(255)', false);
  PERFORM pg_temp.phase2c_assert_column('public.payment_records', 'expected_amount', 'numeric(18,2)', false);
  PERFORM pg_temp.phase2c_assert_column('public.payment_records', 'amount_paid', 'numeric(18,2)', true);
  PERFORM pg_temp.phase2c_assert_column('public.payment_records', 'currency', 'character varying(10)', true);
  PERFORM pg_temp.phase2c_assert_column('public.payment_records', 'payment_status', 'character varying(50)', true);
  PERFORM pg_temp.phase2c_assert_column('public.payment_records', 'processing_status', 'text', true);
  PERFORM pg_temp.phase2c_assert_column('public.payment_records', 'account_setup_status', 'text', true);
  PERFORM pg_temp.phase2c_assert_column('public.payment_records', 'plan_id', 'text', false);
  PERFORM pg_temp.phase2c_assert_column('public.payment_records', 'plan_name', 'text', false);
  PERFORM pg_temp.phase2c_assert_column('public.payment_records', 'solo_plus_case_id', 'uuid', false);
  PERFORM pg_temp.phase2c_assert_column('public.payment_records', 'raw_provider_payload', 'jsonb', false);
  PERFORM pg_temp.phase2c_assert_column('public.payment_records', 'failure_reason', 'text', false);
  PERFORM pg_temp.phase2c_assert_column('public.payment_records', 'paid_at', 'timestamp with time zone', false);
  PERFORM pg_temp.phase2c_assert_column('public.payment_records', 'updated_at', 'timestamp with time zone', true);

  PERFORM pg_temp.phase2c_assert_column('public.merchants', 'id', 'uuid', true);
  PERFORM pg_temp.phase2c_assert_column('public.merchants', 'subscription_plan', 'text', true);

  PERFORM pg_temp.phase2c_assert_column('public.subscriptions', 'id', 'uuid', true);
  PERFORM pg_temp.phase2c_assert_column('public.subscriptions', 'merchant_id', 'uuid', true);
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.subscriptions'::regclass
      AND a.attname = 'plan_type' AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attnotnull
  ) THEN
    RAISE EXCEPTION 'Phase 2C atomic renewal prerequisite incompatible: subscriptions.plan_type must exist and be NOT NULL';
  END IF;
  PERFORM pg_temp.phase2c_assert_column('public.subscriptions', 'amount_paid', 'numeric(10,2)', true);
  PERFORM pg_temp.phase2c_assert_column('public.subscriptions', 'start_date', 'timestamp with time zone', true);
  PERFORM pg_temp.phase2c_assert_column('public.subscriptions', 'expiry_date', 'timestamp with time zone', true);
  PERFORM pg_temp.phase2c_assert_column('public.subscriptions', 'status', 'text', true);
  PERFORM pg_temp.phase2c_assert_column('public.subscriptions', 'last_notified_at', 'timestamp with time zone', false);
  PERFORM pg_temp.phase2c_assert_column('public.subscriptions', 'is_banner_dismissed', 'boolean', true);
  PERFORM pg_temp.phase2c_assert_column('public.subscriptions', 'updated_at', 'timestamp with time zone', true);

  PERFORM pg_temp.phase2c_assert_column('public.subscription_payments', 'id', 'uuid', true);
  PERFORM pg_temp.phase2c_assert_column('public.subscription_payments', 'merchant_id', 'uuid', true);
  PERFORM pg_temp.phase2c_assert_column('public.subscription_payments', 'plan', 'text', true);
  PERFORM pg_temp.phase2c_assert_column('public.subscription_payments', 'amount_ngn', 'numeric(10,2)', true);
  PERFORM pg_temp.phase2c_assert_column('public.subscription_payments', 'period_start', 'timestamp with time zone', true);
  PERFORM pg_temp.phase2c_assert_column('public.subscription_payments', 'period_end', 'timestamp with time zone', true);
  PERFORM pg_temp.phase2c_assert_column('public.subscription_payments', 'paystack_ref', 'text', true);
  PERFORM pg_temp.phase2c_assert_column('public.subscription_payments', 'payment_type', 'text', true);
  PERFORM pg_temp.phase2c_assert_column('public.subscription_payments', 'status', 'text', true);

  PERFORM pg_temp.phase2c_assert_key('public.payment_records', 'u', ARRAY['internal_reference']);
  PERFORM pg_temp.phase2c_assert_key('public.subscriptions', 'u', ARRAY['merchant_id']);
  PERFORM pg_temp.phase2c_assert_key('public.subscription_payments', 'u', ARRAY['paystack_ref']);
  PERFORM pg_temp.phase2c_assert_fk('public.payment_records', ARRAY['merchant_id'], 'public.merchants', ARRAY['id'], 'n');
  PERFORM pg_temp.phase2c_assert_fk('public.subscriptions', ARRAY['merchant_id'], 'public.merchants', ARRAY['id'], 'c');
  PERFORM pg_temp.phase2c_assert_fk('public.subscription_payments', ARRAY['merchant_id'], 'public.merchants', ARRAY['id'], 'c');

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.payment_records'::regclass
      AND c.conname = 'payment_records_payment_status_check'
      AND c.contype = 'c'
      AND c.convalidated
      AND pg_catalog.regexp_replace(
        pg_catalog.btrim(pg_catalog.pg_get_expr(c.conbin, c.conrelid, false)),
        '[[:space:]]+', ' ', 'g'
      ) = $check$((payment_status)::text = ANY ((ARRAY['pending'::character varying, 'successful'::character varying, 'failed'::character varying, 'abandoned'::character varying, 'reversed'::character varying, 'refunded'::character varying])::text[]))$check$
  ) THEN
    RAISE EXCEPTION 'Phase 2C atomic renewal prerequisite incompatible: payment status CHECK expression drifted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) acl
    WHERE c.oid IN (
      'public.payment_records'::regclass,
      'public.merchants'::regclass,
      'public.subscriptions'::regclass,
      'public.subscription_payments'::regclass
    )
      AND acl.grantee IN (
        0,
        pg_catalog.to_regrole('anon')::oid,
        pg_catalog.to_regrole('authenticated')::oid
      )
      AND acl.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
  ) THEN
    RAISE EXCEPTION 'Phase 2C atomic renewal prerequisite incompatible: browser-role table write grant drifted';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.payment_records', 'SELECT,UPDATE')
     OR NOT has_table_privilege('service_role', 'public.merchants', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.subscriptions', 'SELECT,UPDATE')
     OR NOT has_table_privilege('service_role', 'public.subscription_payments', 'SELECT,INSERT') THEN
    RAISE EXCEPTION 'Phase 2C atomic renewal prerequisite incompatible: service_role table privileges drifted';
  END IF;

  SELECT count(*) INTO v_rpc_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'confirm_fiat_plan_renewal_v1';

  IF v_rpc_count > 0 THEN
    IF v_rpc_count <> 1 OR pg_catalog.to_regprocedure(
      'public.confirm_fiat_plan_renewal_v1(uuid,text,text,text,bigint,text,uuid,text,jsonb)'
    ) IS NULL THEN
      RAISE EXCEPTION 'Phase 2C atomic renewal unsafe drift: unexpected confirm_fiat_plan_renewal_v1 overload';
    END IF;

    SELECT p.oid, p.prosecdef, p.proconfig,
           pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,
           pg_catalog.md5(pg_catalog.replace(p.prosrc, pg_catalog.chr(13), '')) AS body_hash
    INTO v_rpc
    FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.confirm_fiat_plan_renewal_v1(uuid,text,text,text,bigint,text,uuid,text,jsonb)'::regprocedure;

    IF v_rpc.owner_name IS DISTINCT FROM current_user
       OR NOT v_rpc.prosecdef
       OR v_rpc.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, pg_temp']::text[]
       OR v_rpc.body_hash <> '3535c8145b90ba3f24a6a2bae5b21d02' THEN
      RAISE EXCEPTION 'Phase 2C atomic renewal unsafe drift: existing RPC body or security definition differs';
    END IF;

    IF NOT has_function_privilege('service_role', v_rpc.oid, 'EXECUTE')
       OR has_function_privilege('anon', v_rpc.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_rpc.oid, 'EXECUTE')
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.aclexplode(COALESCE(
           (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = v_rpc.oid),
           pg_catalog.acldefault('f', (SELECT p.proowner FROM pg_catalog.pg_proc p WHERE p.oid = v_rpc.oid))
         )) acl
         WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Phase 2C atomic renewal unsafe drift: existing RPC execute grants differ';
    END IF;
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.confirm_fiat_plan_renewal_v1(
  p_payment_record_id uuid,
  p_provider text,
  p_internal_reference text,
  p_provider_reference text,
  p_amount_kobo bigint,
  p_currency text,
  p_merchant_id uuid,
  p_canonical_plan text,
  p_raw_provider_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $renewal$
DECLARE
  v_payment public.payment_records%ROWTYPE;
  v_merchant public.merchants%ROWTYPE;
  v_subscription public.subscriptions%ROWTYPE;
  v_ledger public.subscription_payments%ROWTYPE;
  v_now timestamptz := pg_catalog.now();
  v_payment_plan_id text;
  v_payment_plan_name text;
  v_merchant_plan text;
  v_subscription_plan text;
  v_ledger_plan text;
  v_expected_amount_ngn numeric(10,2);
  v_expected_amount_kobo bigint;
  v_daily_rate numeric;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_subscription_count integer;
BEGIN
  IF p_payment_record_id IS NULL
     OR p_merchant_id IS NULL
     OR p_canonical_plan NOT IN ('solo_lite', 'business')
     OR lower(pg_catalog.btrim(COALESCE(p_provider, ''))) NOT IN ('paystack', 'monnify')
     OR NULLIF(pg_catalog.btrim(COALESCE(p_internal_reference, '')), '') IS NULL
     OR NULLIF(pg_catalog.btrim(COALESCE(p_provider_reference, '')), '') IS NULL
     OR upper(pg_catalog.btrim(COALESCE(p_currency, ''))) <> 'NGN'
     OR p_amount_kobo IS NULL
     OR p_amount_kobo <= 0 THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict', 'reason', 'request_invalid');
  END IF;

  SELECT * INTO v_payment
  FROM public.payment_records
  WHERE id = p_payment_record_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict', 'reason', 'payment_record_not_found');
  END IF;

  IF v_payment.payment_purpose IS DISTINCT FROM 'plan_renewal' THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict', 'reason', 'payment_purpose_invalid');
  END IF;

  IF v_payment.solo_plus_case_id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict', 'reason', 'solo_plus_renewal_deferred');
  END IF;

  v_payment_plan_id := CASE lower(pg_catalog.btrim(COALESCE(v_payment.plan_id, '')))
    WHEN 'individual' THEN 'solo_lite'
    WHEN 'solo_lite' THEN 'solo_lite'
    WHEN 'corporate' THEN 'business'
    WHEN 'business' THEN 'business'
    ELSE NULL
  END;
  v_payment_plan_name := CASE lower(pg_catalog.btrim(COALESCE(v_payment.plan_name, '')))
    WHEN 'individual' THEN 'solo_lite'
    WHEN 'solo_lite' THEN 'solo_lite'
    WHEN 'corporate' THEN 'business'
    WHEN 'business' THEN 'business'
    ELSE NULL
  END;

  IF v_payment_plan_id IS NULL
     OR v_payment_plan_name IS NULL
     OR v_payment_plan_id IS DISTINCT FROM v_payment_plan_name
     OR v_payment_plan_id IS DISTINCT FROM p_canonical_plan THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict', 'reason', 'plan_mismatch');
  END IF;

  v_expected_amount_ngn := CASE p_canonical_plan
    WHEN 'solo_lite' THEN 5000.00
    WHEN 'business' THEN 20000.00
  END;
  v_expected_amount_kobo := (v_expected_amount_ngn * 100)::bigint;
  v_daily_rate := v_expected_amount_ngn / 30.0;

  IF v_payment.merchant_id IS DISTINCT FROM p_merchant_id
     OR v_payment.expected_amount IS DISTINCT FROM v_expected_amount_ngn
     OR p_amount_kobo IS DISTINCT FROM v_expected_amount_kobo
     OR upper(pg_catalog.btrim(v_payment.currency)) <> 'NGN'
     OR lower(pg_catalog.btrim(COALESCE(v_payment.provider_name, ''))) IS DISTINCT FROM lower(pg_catalog.btrim(p_provider))
     OR v_payment.internal_reference IS DISTINCT FROM pg_catalog.btrim(p_internal_reference)
     OR (
       v_payment.provider_reference IS NOT NULL
       AND v_payment.provider_reference IS DISTINCT FROM v_payment.internal_reference
       AND v_payment.provider_reference IS DISTINCT FROM pg_catalog.btrim(p_provider_reference)
     ) THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict', 'reason', 'payment_observation_mismatch');
  END IF;

  SELECT * INTO v_merchant
  FROM public.merchants
  WHERE id = v_payment.merchant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict', 'reason', 'merchant_not_found');
  END IF;

  v_merchant_plan := CASE lower(pg_catalog.btrim(COALESCE(v_merchant.subscription_plan, '')))
    WHEN 'individual' THEN 'solo_lite'
    WHEN 'solo_lite' THEN 'solo_lite'
    WHEN 'corporate' THEN 'business'
    WHEN 'business' THEN 'business'
    ELSE NULL
  END;

  IF v_merchant_plan IS DISTINCT FROM p_canonical_plan THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict', 'reason', 'merchant_plan_mismatch');
  END IF;

  PERFORM 1
  FROM public.subscriptions s
  WHERE s.merchant_id = v_payment.merchant_id
  ORDER BY s.id
  FOR UPDATE;

  SELECT count(*) INTO v_subscription_count
  FROM public.subscriptions s
  WHERE s.merchant_id = v_payment.merchant_id
    AND lower(pg_catalog.btrim(s.status)) IN ('active', 'expired')
    AND CASE lower(pg_catalog.btrim(s.plan_type::text))
      WHEN 'individual' THEN 'solo_lite'
      WHEN 'solo_lite' THEN 'solo_lite'
      WHEN 'corporate' THEN 'business'
      WHEN 'business' THEN 'business'
      ELSE NULL
    END = p_canonical_plan;

  IF v_subscription_count <> 1 THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict', 'reason', 'subscription_ambiguous_or_missing');
  END IF;

  SELECT * INTO v_subscription
  FROM public.subscriptions s
  WHERE s.merchant_id = v_payment.merchant_id
    AND lower(pg_catalog.btrim(s.status)) IN ('active', 'expired')
    AND CASE lower(pg_catalog.btrim(s.plan_type::text))
      WHEN 'individual' THEN 'solo_lite'
      WHEN 'solo_lite' THEN 'solo_lite'
      WHEN 'corporate' THEN 'business'
      WHEN 'business' THEN 'business'
      ELSE NULL
    END = p_canonical_plan;

  v_subscription_plan := CASE lower(pg_catalog.btrim(v_subscription.plan_type::text))
    WHEN 'individual' THEN 'solo_lite'
    WHEN 'solo_lite' THEN 'solo_lite'
    WHEN 'corporate' THEN 'business'
    WHEN 'business' THEN 'business'
    ELSE NULL
  END;

  SELECT * INTO v_ledger
  FROM public.subscription_payments
  WHERE paystack_ref = v_payment.internal_reference
  FOR UPDATE;

  IF FOUND THEN
    v_ledger_plan := CASE lower(pg_catalog.btrim(v_ledger.plan))
      WHEN 'individual' THEN 'solo_lite'
      WHEN 'solo_lite' THEN 'solo_lite'
      WHEN 'corporate' THEN 'business'
      WHEN 'business' THEN 'business'
      ELSE NULL
    END;

    IF v_payment.payment_status = 'successful'
       AND v_payment.processing_status = 'processed'
       AND v_payment.account_setup_status = 'active'
       AND v_payment.provider_reference IS NOT DISTINCT FROM pg_catalog.btrim(p_provider_reference)
       AND v_payment.amount_paid IS NOT DISTINCT FROM v_expected_amount_ngn
       AND v_payment.paid_at IS NOT NULL
       AND v_ledger.merchant_id = v_payment.merchant_id
       AND v_ledger_plan = p_canonical_plan
       AND v_ledger.amount_ngn = v_expected_amount_ngn
       AND lower(pg_catalog.btrim(v_ledger.payment_type)) = 'renewal'
       AND lower(pg_catalog.btrim(v_ledger.status)) = 'paid'
       AND v_ledger.period_end > v_ledger.period_start
       AND v_subscription_plan = p_canonical_plan
       AND v_subscription.expiry_date >= v_ledger.period_end THEN
      RETURN pg_catalog.jsonb_build_object(
        'kind', 'already_processed',
        'payment_record_id', v_payment.id,
        'subscription_id', v_subscription.id,
        'renewal_payment_id', v_ledger.id,
        'plan', p_canonical_plan,
        'period_start', v_ledger.period_start,
        'period_end', v_ledger.period_end
      );
    END IF;

    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict', 'reason', 'processed_state_inconsistent');
  END IF;

  IF v_payment.payment_status <> 'pending'
     OR v_payment.processing_status <> 'pending_payment'
     OR v_payment.account_setup_status <> 'pending_payment'
     OR v_payment.amount_paid <> 0
     OR v_payment.paid_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict', 'reason', 'payment_record_not_pending');
  END IF;

  v_period_start := CASE
    WHEN v_subscription.expiry_date > v_now THEN v_subscription.expiry_date
    ELSE v_now
  END;
  v_period_end := v_period_start + ((v_expected_amount_ngn / v_daily_rate) * interval '1 day');

  UPDATE public.subscriptions
  SET amount_paid = v_expected_amount_ngn,
      start_date = v_now,
      expiry_date = v_period_end,
      status = 'active',
      last_notified_at = NULL,
      is_banner_dismissed = false,
      updated_at = v_now
  WHERE id = v_subscription.id;

  INSERT INTO public.subscription_payments (
    merchant_id, plan, amount_ngn, period_start, period_end,
    paystack_ref, payment_type, status
  ) VALUES (
    v_payment.merchant_id, v_subscription.plan_type::text,
    v_expected_amount_ngn, v_period_start, v_period_end,
    v_payment.internal_reference, 'renewal', 'paid'
  )
  RETURNING * INTO v_ledger;

  UPDATE public.payment_records
  SET provider_reference = pg_catalog.btrim(p_provider_reference),
      amount_paid = v_expected_amount_ngn,
      payment_status = 'successful',
      processing_status = 'processed',
      account_setup_status = 'active',
      failure_reason = NULL,
      raw_provider_payload = COALESCE(p_raw_provider_payload, raw_provider_payload, '{}'::jsonb),
      paid_at = v_now,
      updated_at = v_now
  WHERE id = v_payment.id;

  RETURN pg_catalog.jsonb_build_object(
    'kind', 'applied',
    'payment_record_id', v_payment.id,
    'subscription_id', v_subscription.id,
    'renewal_payment_id', v_ledger.id,
    'merchant_id', v_payment.merchant_id,
    'plan', p_canonical_plan,
    'period_start', v_period_start,
    'period_end', v_period_end
  );
END;
$renewal$;

REVOKE ALL ON FUNCTION public.confirm_fiat_plan_renewal_v1(uuid,text,text,text,bigint,text,uuid,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_fiat_plan_renewal_v1(uuid,text,text,text,bigint,text,uuid,text,jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.confirm_fiat_plan_renewal_v1(uuid,text,text,text,bigint,text,uuid,text,jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_fiat_plan_renewal_v1(uuid,text,text,text,bigint,text,uuid,text,jsonb) TO service_role;

DO $postflight$
DECLARE
  v_rpc record;
  v_owner text;
  v_non_owner_grantees text[];
BEGIN
  SELECT p.oid, p.prosecdef, p.proconfig,
         pg_catalog.md5(pg_catalog.replace(p.prosrc, pg_catalog.chr(13), '')) AS body_hash,
         pg_catalog.pg_get_userbyid(p.proowner) AS owner_name
  INTO v_rpc
  FROM pg_catalog.pg_proc p
  WHERE p.oid = 'public.confirm_fiat_plan_renewal_v1(uuid,text,text,text,bigint,text,uuid,text,jsonb)'::regprocedure;

  IF v_rpc.oid IS NULL
     OR v_rpc.owner_name IS DISTINCT FROM current_user
     OR NOT v_rpc.prosecdef
     OR v_rpc.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, pg_temp']::text[]
     OR v_rpc.body_hash <> '3535c8145b90ba3f24a6a2bae5b21d02' THEN
    RAISE EXCEPTION 'Phase 2C atomic renewal postflight failed: RPC body or security definition differs';
  END IF;

  v_owner := v_rpc.owner_name;
  SELECT COALESCE(array_agg(DISTINCT privilege.grantee ORDER BY privilege.grantee), ARRAY[]::text[])
  INTO v_non_owner_grantees
  FROM information_schema.routine_privileges privilege
  WHERE privilege.specific_schema = 'public'
    AND privilege.routine_name = 'confirm_fiat_plan_renewal_v1'
    AND privilege.privilege_type = 'EXECUTE'
    AND privilege.grantee <> v_owner;

  IF v_non_owner_grantees IS DISTINCT FROM ARRAY['service_role']::text[]
     OR NOT has_function_privilege('service_role', v_rpc.oid, 'EXECUTE')
     OR has_function_privilege('anon', v_rpc.oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_rpc.oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.aclexplode(COALESCE(
         (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = v_rpc.oid),
         pg_catalog.acldefault('f', (SELECT p.proowner FROM pg_catalog.pg_proc p WHERE p.oid = v_rpc.oid))
       )) acl
       WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Phase 2C atomic renewal postflight failed: RPC execute grants are not service-role-only';
  END IF;
END;
$postflight$;

COMMIT;
