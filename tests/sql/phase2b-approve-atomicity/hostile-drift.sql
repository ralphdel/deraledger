-- One scenario per fresh disposable clone of the canonical pre-cutover DB.
-- Pass -v scenario=<name>. Never run this file on a shared or protected DB.
\set ON_ERROR_STOP on
SELECT set_config('phase2b.disposable_hostile_scenario', :'scenario', false);
DO $$
DECLARE
  v_name text := current_setting('phase2b.disposable_hostile_scenario');
  v_definition text;
  v_replacement text;
BEGIN
  CASE v_name
    WHEN 'v1_body' THEN
      SELECT pg_get_functiondef(to_regprocedure('public.review_solo_plus_case_v1(uuid,bigint,text,text,uuid,text,text)')) INTO v_definition;
      v_replacement := replace(v_definition, 'v_target_status := ''approved'';', 'v_target_status := ''rejected'';');
      IF v_replacement = v_definition THEN RAISE EXCEPTION 'FAIL|HOSTILE_SETUP|v1_body'; END IF;
      EXECUTE v_replacement;
    WHEN 'v1_defaults' THEN
      SELECT pg_get_functiondef(to_regprocedure('public.review_solo_plus_case_v1(uuid,bigint,text,text,uuid,text,text)')) INTO v_definition;
      v_replacement := replace(v_definition, 'DEFAULT NULL::text', 'DEFAULT ''''::text');
      IF v_replacement = v_definition THEN RAISE EXCEPTION 'FAIL|HOSTILE_SETUP|v1_defaults'; END IF;
      EXECUTE v_replacement;
    WHEN 'overload' THEN
      EXECUTE 'CREATE FUNCTION public.review_solo_plus_case_v1(integer) RETURNS jsonb LANGUAGE sql AS $body$ SELECT ''{}''::jsonb $body$';
    WHEN 'policy_roles' THEN
      EXECUTE 'ALTER POLICY merchant_read_solo_plus_cases ON public.solo_plus_cases TO authenticated';
    WHEN 'policy_using' THEN
      EXECUTE 'ALTER POLICY merchant_read_solo_plus_cases ON public.solo_plus_cases USING (false)';
    WHEN 'policy_with_check' THEN
      -- SELECT policies cannot carry WITH CHECK. This valid DDL also changes
      -- command/roles; the semantic WITH CHECK guard itself is static-only.
      EXECUTE 'DROP POLICY merchant_read_solo_plus_cases ON public.solo_plus_cases';
      EXECUTE 'CREATE POLICY merchant_read_solo_plus_cases ON public.solo_plus_cases FOR ALL TO PUBLIC USING (true) WITH CHECK (true)';
    WHEN 'check_expression' THEN
      EXECUTE 'ALTER TABLE public.solo_plus_cases DROP CONSTRAINT solo_plus_cases_case_status_check';
      EXECUTE 'ALTER TABLE public.solo_plus_cases ADD CONSTRAINT solo_plus_cases_case_status_check CHECK (case_status IN (''draft'', ''manual_review''))';
    WHEN 'check_requirement_code' THEN
      EXECUTE 'ALTER TABLE public.solo_plus_case_requirements DROP CONSTRAINT solo_plus_case_requirements_requirement_code_check';
      EXECUTE 'ALTER TABLE public.solo_plus_case_requirements ADD CONSTRAINT solo_plus_case_requirements_requirement_code_check CHECK (requirement_code IN (''bvn'', ''id_document''))';
    WHEN 'check_requirement_state' THEN
      EXECUTE 'ALTER TABLE public.solo_plus_case_requirements DROP CONSTRAINT solo_plus_case_requirements_requirement_state_check';
      EXECUTE 'ALTER TABLE public.solo_plus_case_requirements ADD CONSTRAINT solo_plus_case_requirements_requirement_state_check CHECK (requirement_state IN (''not_started'', ''passed''))';
    WHEN 'fk_target' THEN
      EXECUTE 'ALTER TABLE public.solo_plus_cases DROP CONSTRAINT solo_plus_cases_payment_record_id_fkey';
      EXECUTE 'ALTER TABLE public.solo_plus_cases ADD CONSTRAINT solo_plus_cases_payment_record_id_fkey FOREIGN KEY (payment_record_id) REFERENCES public.merchants(id) ON DELETE SET NULL';
    WHEN 'fk_columns' THEN
      EXECUTE 'ALTER TABLE public.solo_plus_cases DROP CONSTRAINT solo_plus_cases_payment_record_id_fkey';
      EXECUTE 'ALTER TABLE public.solo_plus_cases ADD CONSTRAINT solo_plus_cases_payment_record_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.payment_records(id) ON DELETE SET NULL';
    WHEN 'fk_actions' THEN
      EXECUTE 'ALTER TABLE public.solo_plus_cases DROP CONSTRAINT solo_plus_cases_payment_record_id_fkey';
      EXECUTE 'ALTER TABLE public.solo_plus_cases ADD CONSTRAINT solo_plus_cases_payment_record_id_fkey FOREIGN KEY (payment_record_id) REFERENCES public.payment_records(id) ON DELETE CASCADE';
    WHEN 'index_key' THEN
      EXECUTE 'DROP INDEX public.idx_solo_plus_case_events_review_request_intent';
      EXECUTE 'CREATE UNIQUE INDEX idx_solo_plus_case_events_review_request_intent ON public.solo_plus_case_events(event_type) WHERE request_idempotency_key IS NOT NULL AND event_type IN (''case_review_requested_more_information'', ''case_approved'', ''case_rejected'', ''case_reopened'')';
    WHEN 'index_predicate' THEN
      EXECUTE 'DROP INDEX public.idx_solo_plus_case_events_review_request_intent';
      EXECUTE 'CREATE UNIQUE INDEX idx_solo_plus_case_events_review_request_intent ON public.solo_plus_case_events(request_idempotency_key) WHERE request_idempotency_key IS NOT NULL AND event_type = ''case_approved''';
    WHEN 'index_collation' THEN
      EXECUTE 'DROP INDEX public.idx_solo_plus_case_events_review_request_intent';
      EXECUTE 'CREATE UNIQUE INDEX idx_solo_plus_case_events_review_request_intent ON public.solo_plus_case_events(request_idempotency_key COLLATE "C") WHERE request_idempotency_key IS NOT NULL AND event_type IN (''case_review_requested_more_information'', ''case_approved'', ''case_rejected'', ''case_reopened'')';
    WHEN 'index_opclass' THEN
      EXECUTE 'DROP INDEX public.idx_solo_plus_case_events_review_request_intent';
      EXECUTE 'CREATE UNIQUE INDEX idx_solo_plus_case_events_review_request_intent ON public.solo_plus_case_events(request_idempotency_key text_pattern_ops) WHERE request_idempotency_key IS NOT NULL AND event_type IN (''case_review_requested_more_information'', ''case_approved'', ''case_rejected'', ''case_reopened'')';
    ELSE
      RAISE EXCEPTION 'FAIL|HOSTILE_SETUP|unknown_scenario';
  END CASE;
END $$;
CREATE TABLE local_phase2b_hostile_snapshot AS
SELECT md5(replace(replace(p.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) AS old_body_hash,
       to_regprocedure('public.review_solo_plus_case_approve_atomic_v1(uuid,bigint,text,text,uuid,text,text,text)')::oid AS new_rpc_oid
FROM pg_proc p
WHERE p.oid = to_regprocedure('public.review_solo_plus_case_v1(uuid,bigint,text,text,uuid,text,text)');
\echo PASS|APPROVE_ATOMICITY|hostile_setup_complete
