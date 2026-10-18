\set ON_ERROR_STOP on
-- Emergency abandonment only. Never run as part of a successful handoff.
\ir phase2b_approve_paid_staging_preflight.sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT set_config('deraledger.phase2b_expected_project_ref', :'expected_project_ref', true);
SELECT set_config('deraledger.phase2b_approve_run_id', :'fixture_run_id', true);
SELECT set_config('deraledger.phase2b_approve_case_id', :'fixture_case_id', true);
DO $cleanup$
DECLARE
  v_case public.solo_plus_cases%ROWTYPE;
  v_payment public.payment_records%ROWTYPE;
  v_merchant public.merchants%ROWTYPE;
  v_workspace public.workspaces%ROWTYPE;
  v_run text := current_setting('deraledger.phase2b_approve_run_id');
  v_parent record;
  v_fk record;
  v_count bigint;
  v_allowed bigint;
BEGIN
  IF current_setting('deraledger.phase2b_expected_project_ref') IS DISTINCT FROM 'fsjljliiyfchkwbjifzw'
     OR current_database() IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM 'postgres'
     OR v_run !~ '^phase2b-approve-[0-9]{8}-[a-z0-9]{3,16}$' THEN
    RAISE EXCEPTION 'BLOCKED|APPROVE_STAGING|cleanup_target';
  END IF;
  SELECT * INTO v_case FROM public.solo_plus_cases
  WHERE id = current_setting('deraledger.phase2b_approve_case_id')::uuid FOR UPDATE;
  IF NOT FOUND OR v_case.audit_metadata ->> 'fixture_scope' IS DISTINCT FROM 'phase2b_approve_acceptance'
     OR v_case.audit_metadata ->> 'fixture_run_id' IS DISTINCT FROM v_run
     OR v_case.audit_metadata ->> 'synthetic_approve_acceptance' IS DISTINCT FROM 'true'
     OR v_case.case_status NOT IN ('manual_review', 'approved')
     OR v_case.payment_status IS DISTINCT FROM 'paid' OR v_case.refund_status IS DISTINCT FROM 'none'
     OR v_case.expected_amount IS DISTINCT FROM 100.00 OR v_case.payment_currency IS DISTINCT FROM 'NGN'
     OR v_case.flow_origin IS DISTINCT FROM 'upgrade' OR v_case.source_plan IS DISTINCT FROM 'solo_lite'
     OR v_case.onboarding_session_id IS NOT NULL
     OR v_case.activation_idempotency_key IS NOT NULL
     OR v_case.refund_idempotency_key IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCKED|APPROVE_STAGING|cleanup_case_scope';
  END IF;
  SELECT * INTO v_payment FROM public.payment_records
  WHERE id = v_case.payment_record_id FOR UPDATE;
  SELECT * INTO v_merchant FROM public.merchants
  WHERE id = v_case.merchant_id FOR UPDATE;
  SELECT * INTO v_workspace FROM public.workspaces
  WHERE id = v_merchant.workspace_id FOR UPDATE;
  IF v_payment.id IS NULL OR v_payment.solo_plus_case_id IS DISTINCT FROM v_case.id
     OR v_payment.merchant_id IS DISTINCT FROM v_merchant.id
     OR v_payment.metadata ->> 'fixture_run_id' IS DISTINCT FROM v_run
     OR v_payment.metadata ->> 'fixture_scope' IS DISTINCT FROM 'phase2b_approve_acceptance'
     OR v_payment.metadata ->> 'synthetic_approve_acceptance' IS DISTINCT FROM 'true'
     OR v_payment.internal_reference IS DISTINCT FROM 'phase2b-approve:' || v_run
     OR v_payment.payment_purpose IS DISTINCT FROM 'plan_upgrade'
     OR v_payment.payment_status IS DISTINCT FROM 'successful'
     OR v_payment.amount_paid IS DISTINCT FROM 100.00 OR v_payment.expected_amount IS DISTINCT FROM 100.00
     OR v_payment.currency IS DISTINCT FROM 'NGN' OR v_payment.onboarding_session_id IS NOT NULL
     OR v_payment.provider_name IS NOT NULL OR v_payment.provider_reference IS NOT NULL
     OR v_payment.raw_provider_payload IS NOT NULL
     OR v_merchant.id IS NULL OR v_merchant.user_id IS NOT NULL
     OR v_merchant.email IS DISTINCT FROM v_run || '@example.invalid'
     OR v_merchant.business_name IS DISTINCT FROM 'Phase 2B Approve Fixture ' || v_run
     OR v_merchant.subscription_plan IS DISTINCT FROM 'solo_lite'
     OR NOT v_merchant.setup_mode OR v_merchant.live_features_enabled IS DISTINCT FROM false
     OR v_workspace.id IS NULL OR v_workspace.merchant_id IS DISTINCT FROM v_merchant.id
     OR v_workspace.owner_user_id IS NOT NULL
     OR v_workspace.display_name IS DISTINCT FROM 'Phase 2B Approve Fixture ' || v_run
     OR v_workspace.plan_type IS DISTINCT FROM 'solo_lite'
     OR v_workspace.setup_mode IS DISTINCT FROM true
     OR v_workspace.live_features_enabled IS DISTINCT FROM false
     OR v_case.audit_metadata ->> 'fixture_workspace_id' IS DISTINCT FROM v_workspace.id::text
     OR (SELECT count(*) FROM public.payment_records WHERE solo_plus_case_id = v_case.id) IS DISTINCT FROM 1
     OR (SELECT count(*) FROM public.solo_plus_case_requirements WHERE case_id = v_case.id) IS DISTINCT FROM 6
     OR EXISTS (SELECT 1 FROM public.solo_plus_case_requirements
          WHERE case_id = v_case.id AND (metadata ->> 'fixture_run_id' IS DISTINCT FROM v_run
            OR metadata ->> 'fixture_scope' IS DISTINCT FROM 'phase2b_approve_acceptance'
            OR metadata ->> 'synthetic_approve_acceptance' IS DISTINCT FROM 'true'
            OR requirement_state IS DISTINCT FROM 'passed'
            OR evidence_source_type IS DISTINCT FROM 'manual_submission'
            OR evidence_source_id IS NULL))
     OR (SELECT count(*) FROM public.solo_plus_case_events WHERE case_id = v_case.id)
        IS DISTINCT FROM CASE WHEN v_case.case_status = 'approved' THEN 1 ELSE 0 END
     OR EXISTS (SELECT 1 FROM public.solo_plus_case_events
          WHERE case_id = v_case.id AND event_type IS DISTINCT FROM 'case_approved')
     OR EXISTS (SELECT 1 FROM public.subscriptions WHERE merchant_id = v_merchant.id)
     OR EXISTS (SELECT 1 FROM public.workspace_subscriptions WHERE merchant_id = v_merchant.id)
     OR EXISTS (SELECT 1 FROM public.subscription_payments WHERE merchant_id = v_merchant.id)
     OR EXISTS (SELECT 1 FROM public.plan_migrations WHERE merchant_id = v_merchant.id)
     OR EXISTS (SELECT 1 FROM public.settlement_records WHERE payment_record_id = v_payment.id)
     OR EXISTS (SELECT 1 FROM public.settlement_batches WHERE merchant_id = v_merchant.id) THEN
    RAISE EXCEPTION 'BLOCKED|APPROVE_STAGING|cleanup_descendant_scope';
  END IF;

  -- Refuse every unrecognized FK descendant before touching a CASCADE parent.
  FOR v_parent IN SELECT * FROM (VALUES
    ('public.solo_plus_cases'::regclass, v_case.id),
    ('public.payment_records'::regclass, v_payment.id),
    ('public.workspaces'::regclass, v_workspace.id),
    ('public.merchants'::regclass, v_merchant.id)
  ) x(parent_table, parent_id) LOOP
    FOR v_fk IN
      SELECT f.conrelid, f.conkey, f.confkey,
             a.attname AS child_column
      FROM pg_constraint f
      JOIN pg_attribute a ON a.attrelid = f.conrelid AND a.attnum = f.conkey[1]
      WHERE f.contype = 'f' AND f.confrelid = v_parent.parent_table
    LOOP
      IF array_length(v_fk.conkey, 1) IS DISTINCT FROM 1 OR array_length(v_fk.confkey, 1) IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'BLOCKED|APPROVE_STAGING|cleanup_composite_fk';
      END IF;
      EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1',
        v_fk.conrelid::regclass, v_fk.child_column)
        INTO v_count USING v_parent.parent_id;
      v_allowed := CASE
        WHEN v_parent.parent_table = 'public.solo_plus_cases'::regclass
          AND v_fk.conrelid = 'public.solo_plus_case_requirements'::regclass
          AND v_fk.child_column = 'case_id' THEN 6
        WHEN v_parent.parent_table = 'public.solo_plus_cases'::regclass
          AND v_fk.conrelid = 'public.solo_plus_case_events'::regclass
          AND v_fk.child_column = 'case_id'
          THEN CASE WHEN v_case.case_status = 'approved' THEN 1 ELSE 0 END
        WHEN v_parent.parent_table = 'public.solo_plus_cases'::regclass
          AND v_fk.conrelid = 'public.payment_records'::regclass
          AND v_fk.child_column = 'solo_plus_case_id' THEN 1
        WHEN v_parent.parent_table = 'public.payment_records'::regclass
          AND v_fk.conrelid = 'public.solo_plus_cases'::regclass
          AND v_fk.child_column = 'payment_record_id' THEN 1
        WHEN v_parent.parent_table = 'public.workspaces'::regclass
          AND v_fk.conrelid = 'public.merchants'::regclass
          AND v_fk.child_column = 'workspace_id' THEN 1
        WHEN v_parent.parent_table = 'public.merchants'::regclass
          AND v_fk.conrelid = 'public.workspaces'::regclass
          AND v_fk.child_column = 'merchant_id' THEN 1
        WHEN v_parent.parent_table = 'public.merchants'::regclass
          AND v_fk.conrelid = 'public.solo_plus_cases'::regclass
          AND v_fk.child_column = 'merchant_id' THEN 1
        WHEN v_parent.parent_table = 'public.merchants'::regclass
          AND v_fk.conrelid = 'public.payment_records'::regclass
          AND v_fk.child_column = 'merchant_id' THEN 1
        ELSE 0 END;
      IF v_count IS DISTINCT FROM v_allowed THEN
        RAISE EXCEPTION 'BLOCKED|APPROVE_STAGING|cleanup_unknown_fk_descendant';
      END IF;
    END LOOP;
  END LOOP;

  DELETE FROM public.solo_plus_case_events WHERE case_id = v_case.id;
  DELETE FROM public.solo_plus_case_requirements WHERE case_id = v_case.id;
  DELETE FROM public.solo_plus_cases WHERE id = v_case.id;
  DELETE FROM public.payment_records WHERE id = v_payment.id;
  UPDATE public.merchants SET workspace_id = NULL WHERE id = v_merchant.id;
  DELETE FROM public.workspaces WHERE id = v_workspace.id;
  DELETE FROM public.merchants WHERE id = v_merchant.id;
END
$cleanup$;
COMMIT;
SELECT 'PASS|APPROVE_STAGING|emergency_cleanup_done';
