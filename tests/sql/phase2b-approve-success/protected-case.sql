-- Two isolated synthetic fixtures; every attempted mutation is rolled back.
BEGIN;
\ir fixture.sql
DO $$
DECLARE v_field text;
v_expr text;
v_message text;
v_before integer;
BEGIN
  SELECT row_version INTO v_before FROM public.solo_plus_cases
    WHERE id = '00000000-0000-4000-8000-00000000e010';
  FOR v_field, v_expr IN
    SELECT * FROM (VALUES
      ('payment_record_id', '''00000000-0000-4000-8000-00000000e099'''),
      ('merchant_id', '''00000000-0000-4000-8000-00000000e098'''),
      ('flow_origin', '''onboarding'''),
      ('onboarding_session_id', '''00000000-0000-4000-8000-00000000e097'''),
      ('source_plan', 'NULL'),
      ('expected_amount', '101'),
      ('payment_currency', '''USD''')
    ) changes(field_name, expression_sql)
  LOOP
    BEGIN
      EXECUTE format('UPDATE public.solo_plus_cases SET %I = %s, row_version = row_version + 1 WHERE id = %L',
        v_field, v_expr, '00000000-0000-4000-8000-00000000e010');
      RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|protected_%', v_field;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      IF v_message NOT LIKE 'Phase 2B approve case writer blocked: paid payment relink%'
         AND v_message NOT LIKE 'Phase 2B approve case writer blocked: protected payment definition%' THEN
        RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|protected_wrong_error_%', v_field;
      END IF;
    END;
  END LOOP;
  IF (SELECT row_version FROM public.solo_plus_cases
      WHERE id = '00000000-0000-4000-8000-00000000e010') <> v_before THEN
    RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|protected_version_boundary';
  END IF;
END $$;
ROLLBACK;
\echo PASS|APPROVE_SUCCESS|protected_fields_and_version_bypass

BEGIN;
INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-00000000e033');
INSERT INTO public.merchants(id, business_name, email)
VALUES ('00000000-0000-4000-8000-00000000e031', 'Local initial link probe', 'link.invalid@example.invalid');
INSERT INTO public.solo_plus_cases(id, merchant_id, flow_origin, source_plan,
  case_status, payment_status, expected_amount, requirements_policy_version,
  idempotency_key, row_version, audit_metadata)
VALUES ('00000000-0000-4000-8000-00000000e030',
  '00000000-0000-4000-8000-00000000e031', 'upgrade', 'solo_lite',
  'awaiting_payment', 'pending', 100, 'local-approve-success', 'local-link-case', 1,
  '{"fixture_scope":"phase2b_approve_acceptance","fixture_run_id":"phase2b-approve-20261016-local003","synthetic_approve_acceptance":true}'::jsonb);
INSERT INTO public.payment_records(id, merchant_id, solo_plus_case_id,
  payment_purpose, internal_reference, amount_paid, expected_amount, currency,
  payment_status, metadata)
VALUES ('00000000-0000-4000-8000-00000000e032',
  '00000000-0000-4000-8000-00000000e031',
  '00000000-0000-4000-8000-00000000e030', 'plan_upgrade',
  'local-link-payment', 100, 100, 'NGN', 'successful', '{}'::jsonb);
INSERT INTO public.onboarding_sessions(id, email, business_name, plan)
VALUES ('00000000-0000-4000-8000-00000000e034',
  'session.invalid@example.invalid', 'Local wrong-session probe', 'solo_plus');
DO $$
DECLARE v_label text;
v_sql text;
v_message text;
BEGIN
  FOR v_label, v_sql IN
    SELECT * FROM (VALUES
      ('wrong_merchant', 'merchant_id = NULL'),
      ('wrong_purpose', 'payment_purpose = ''plan_subscription'''),
      ('wrong_case_linkage', 'solo_plus_case_id = NULL'),
      ('wrong_session_linkage', 'onboarding_session_id = ''00000000-0000-4000-8000-00000000e034'''),
      ('wrong_amount', 'expected_amount = 99'),
      ('wrong_currency', 'currency = ''USD''')
    ) changes(label, update_sql)
  LOOP
    BEGIN
      EXECUTE format('UPDATE public.payment_records SET %s WHERE id = %L',
        v_sql, '00000000-0000-4000-8000-00000000e032');
      UPDATE public.solo_plus_cases
      SET payment_record_id = '00000000-0000-4000-8000-00000000e032',
          row_version = row_version + 1
      WHERE id = '00000000-0000-4000-8000-00000000e030';
      RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|initial_link_%', v_label;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      IF v_message NOT LIKE 'Phase 2B approve case writer blocked: payment linkage%' THEN
        RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|initial_link_wrong_error_%', v_label;
      END IF;
    END;
  END LOOP;
  BEGIN
    UPDATE public.solo_plus_cases SET flow_origin = 'onboarding', source_plan = NULL,
      payment_record_id = '00000000-0000-4000-8000-00000000e032',
      row_version = row_version + 1
    WHERE id = '00000000-0000-4000-8000-00000000e030';
    RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|missing_onboarding_session';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message NOT LIKE 'Phase 2B approve case writer blocked: payment linkage%' THEN
      RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|missing_session_wrong_error';
    END IF;
  END;
  UPDATE public.solo_plus_cases
  SET payment_record_id = '00000000-0000-4000-8000-00000000e032',
      row_version = row_version + 1
  WHERE id = '00000000-0000-4000-8000-00000000e030';
  IF (SELECT payment_record_id FROM public.solo_plus_cases
      WHERE id = '00000000-0000-4000-8000-00000000e030')
      IS DISTINCT FROM '00000000-0000-4000-8000-00000000e032'::uuid THEN
    RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|valid_initial_link';
  END IF;
  BEGIN
    INSERT INTO public.payment_records(id, merchant_id, solo_plus_case_id,
      payment_purpose, internal_reference, amount_paid, expected_amount,
      currency, payment_status)
    VALUES ('00000000-0000-4000-8000-00000000e035',
      '00000000-0000-4000-8000-00000000e031',
      '00000000-0000-4000-8000-00000000e030', 'plan_upgrade',
      'local-duplicate-success', 100, 100, 'NGN', 'successful');
    UPDATE public.solo_plus_cases
    SET payment_status = 'paid', row_version = row_version + 1
    WHERE id = '00000000-0000-4000-8000-00000000e030';
    RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|duplicate_success';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message NOT LIKE 'Phase 2B approve case writer blocked: ambiguous successful payment%' THEN
      RAISE EXCEPTION 'FAIL|APPROVE_SUCCESS|duplicate_wrong_error';
    END IF;
  END;
END $$;
ROLLBACK;
\echo PASS|APPROVE_SUCCESS|initial_link_validation_and_rollback
