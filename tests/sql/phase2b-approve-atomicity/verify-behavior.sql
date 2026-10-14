-- Disposable only. All synthetic rows and RMI/reject probes roll back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-00000000f013');
INSERT INTO public.merchants(id, business_name, email)
VALUES ('00000000-0000-4000-8000-00000000f011', 'Local synthetic approve probe', 'probe.invalid@example.invalid');
INSERT INTO public.solo_plus_cases(
  id, merchant_id, flow_origin, source_plan, case_status, payment_status,
  expected_amount, requirements_policy_version, idempotency_key, row_version,
  audit_metadata
) VALUES (
  '00000000-0000-4000-8000-00000000f010',
  '00000000-0000-4000-8000-00000000f011',
  'upgrade', 'solo_lite', 'manual_review', 'paid', 100.00, 'local-approve-probe',
  'local-approve-case', 1,
  '{"fixture_scope":"phase2b_approve_acceptance","fixture_run_id":"phase2b-approve-20261014-local001","synthetic_approve_acceptance":true}'::jsonb
);
INSERT INTO public.payment_records(
  id, merchant_id, solo_plus_case_id, payment_purpose, internal_reference,
  amount_paid, expected_amount, currency, payment_status, metadata
) VALUES (
  '00000000-0000-4000-8000-00000000f012',
  '00000000-0000-4000-8000-00000000f011',
  '00000000-0000-4000-8000-00000000f010',
  'plan_upgrade', 'local-approve-payment', 100.00, 100.00, 'NGN', 'successful',
  '{"fixture_scope":"phase2b_approve_acceptance","fixture_run_id":"phase2b-approve-20261014-local001","synthetic_approve_acceptance":true}'::jsonb
);
UPDATE public.solo_plus_cases
SET payment_record_id = '00000000-0000-4000-8000-00000000f012'
WHERE id = '00000000-0000-4000-8000-00000000f010';
INSERT INTO public.solo_plus_case_requirements(
  case_id, requirement_code, requirement_state, evidence_source_type,
  evidence_source_id, completed_at, metadata
)
SELECT
  '00000000-0000-4000-8000-00000000f010'::uuid,
  code, 'passed', 'manual_submission', gen_random_uuid(), now(),
  '{"fixture_scope":"phase2b_approve_acceptance","fixture_run_id":"phase2b-approve-20261014-local001","synthetic_approve_acceptance":true}'::jsonb
FROM unnest(ARRAY[
  'activity_profile', 'bvn', 'id_document', 'proof_of_address',
  'selfie_liveness', 'settlement_account'
]) AS code;

CREATE TEMP TABLE local_approve_snapshot AS
SELECT to_jsonb(c) AS case_row,
       (SELECT to_jsonb(p) FROM public.payment_records p WHERE p.id = c.payment_record_id) AS payment_row,
       (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.requirement_code)
        FROM public.solo_plus_case_requirements r WHERE r.case_id = c.id) AS requirement_rows,
       (SELECT to_jsonb(m) FROM public.merchants m WHERE m.id = c.merchant_id) AS merchant_row
FROM public.solo_plus_cases c WHERE c.id = '00000000-0000-4000-8000-00000000f010';
CREATE TEMP TABLE local_public_table_fingerprints (
  table_oid oid PRIMARY KEY,
  row_digest text NOT NULL
);
DO $$
DECLARE
  v_table record;
  v_digest text;
BEGIN
  FOR v_table IN
    SELECT c.oid, c.oid::regclass AS relation
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format(
      'SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, ''|'' ORDER BY to_jsonb(x)::text), '''')) FROM %s x',
      v_table.relation
    ) INTO v_digest;
    INSERT INTO local_public_table_fingerprints VALUES (v_table.oid, v_digest);
  END LOOP;
END $$;

DO $$
DECLARE
  v_old jsonb;
  v_new jsonb;
BEGIN
  v_old := public.review_solo_plus_case_v1(
    '00000000-0000-4000-8000-00000000f010', 1, 'local-approve-old',
    'approve', '00000000-0000-4000-8000-00000000f013',
    'synthetic reason', 'local-approve-probe');
  v_new := public.review_solo_plus_case_approve_atomic_v1(
    '00000000-0000-4000-8000-00000000f010', 1, 'local-approve-new',
    'approve', '00000000-0000-4000-8000-00000000f013',
    'synthetic reason', 'local-approve-probe', 'phase2b-approve-20261014-local001');
  IF v_old->>'kind' <> 'state_conflict' OR v_new->>'kind' <> 'state_conflict' THEN
    RAISE EXCEPTION 'FAIL|APPROVE_ATOMICITY|approve_rpc_not_fail_closed';
  END IF;
  IF (public.review_solo_plus_case_approve_atomic_v1(
    '00000000-0000-4000-8000-00000000f010', 0, 'local-approve-stale',
    'approve', '00000000-0000-4000-8000-00000000f013',
    'synthetic reason', 'local-approve-probe', 'phase2b-approve-20261014-local001')->>'kind') <> 'version_conflict' THEN
    RAISE EXCEPTION 'FAIL|APPROVE_ATOMICITY|stale_version_not_rejected';
  END IF;
  IF (public.review_solo_plus_case_approve_atomic_v1(
    '00000000-0000-4000-8000-00000000f010', 1, 'local-approve-wrong-run',
    'approve', '00000000-0000-4000-8000-00000000f013',
    'synthetic reason', 'local-approve-probe', 'phase2b-approve-20261014-local002')->>'kind') <> 'state_conflict' THEN
    RAISE EXCEPTION 'FAIL|APPROVE_ATOMICITY|run_id_not_rejected';
  END IF;
END $$;

-- Each historical decision is tested inside its own savepoint and discarded.
SAVEPOINT rmi_probe;
DO $$ BEGIN
  IF (public.review_solo_plus_case_v1(
    '00000000-0000-4000-8000-00000000f010', 1, 'local-rmi-probe',
    'request_more_information', '00000000-0000-4000-8000-00000000f013',
    'synthetic reason', 'local-approve-probe')->>'kind') <> 'updated' THEN
    RAISE EXCEPTION 'FAIL|APPROVE_ATOMICITY|rmi_regression';
  END IF;
END $$;
ROLLBACK TO SAVEPOINT rmi_probe;
SAVEPOINT reject_probe;
DO $$ BEGIN
  IF (public.review_solo_plus_case_v1(
    '00000000-0000-4000-8000-00000000f010', 1, 'local-reject-probe',
    'reject', '00000000-0000-4000-8000-00000000f013',
    'synthetic reason', 'local-approve-probe')->>'kind') <> 'updated' THEN
    RAISE EXCEPTION 'FAIL|APPROVE_ATOMICITY|reject_regression';
  END IF;
END $$;
ROLLBACK TO SAVEPOINT reject_probe;

DO $$ BEGIN
  IF (SELECT count(*) FROM public.solo_plus_cases
      WHERE id = '00000000-0000-4000-8000-00000000f010') <> 1
     OR (SELECT count(*) FROM public.solo_plus_case_requirements
         WHERE case_id = '00000000-0000-4000-8000-00000000f010') <> 6
     OR EXISTS (
    SELECT 1 FROM public.solo_plus_cases c, local_approve_snapshot s
    WHERE c.id = '00000000-0000-4000-8000-00000000f010'
      AND (to_jsonb(c) IS DISTINCT FROM s.case_row
        OR (SELECT to_jsonb(p) FROM public.payment_records p WHERE p.id = c.payment_record_id)
           IS DISTINCT FROM s.payment_row
        OR (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.requirement_code)
            FROM public.solo_plus_case_requirements r WHERE r.case_id = c.id)
           IS DISTINCT FROM s.requirement_rows
        OR (SELECT to_jsonb(m) FROM public.merchants m WHERE m.id = c.merchant_id)
           IS DISTINCT FROM s.merchant_row)
  ) OR EXISTS (
    SELECT 1 FROM public.solo_plus_case_events
    WHERE case_id = '00000000-0000-4000-8000-00000000f010'
  ) THEN
    RAISE EXCEPTION 'FAIL|APPROVE_ATOMICITY|unexpected_mutation';
  END IF;
END $$;
DO $$
DECLARE
  v_table record;
  v_digest text;
BEGIN
  FOR v_table IN SELECT f.table_oid, f.row_digest FROM local_public_table_fingerprints f LOOP
    EXECUTE format(
      'SELECT md5(COALESCE(string_agg(to_jsonb(x)::text, ''|'' ORDER BY to_jsonb(x)::text), '''')) FROM %s x',
      v_table.table_oid::regclass
    ) INTO v_digest;
    IF v_digest IS DISTINCT FROM v_table.row_digest THEN
      RAISE EXCEPTION 'FAIL|APPROVE_ATOMICITY|public_table_mutation';
    END IF;
  END LOOP;
END $$;
ROLLBACK;
\echo PASS|APPROVE_ATOMICITY|fail_closed_behavior_and_rollback
