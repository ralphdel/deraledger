\set ON_ERROR_STOP on
BEGIN READ ONLY;
SELECT set_config('deraledger.phase2b_expected_project_ref', :'expected_project_ref', true);
SELECT set_config('deraledger.phase2b_reopen_case_id', :'fixture_case_id', true);
SELECT set_config('deraledger.phase2b_reopen_run_id', :'fixture_run_id', true);
\ir phase2b_reopen_staging_boundary.sql
SELECT set_config('deraledger.phase2b_reopen_boundary', :'reopen_boundary', true);
DO $guard$
DECLARE
  v_rpc oid := to_regprocedure('public.review_solo_plus_case_v1(uuid,bigint,text,text,uuid,text,text)')::oid;
  v_case public.solo_plus_cases%ROWTYPE;
  v_reject public.solo_plus_case_events%ROWTYPE;
BEGIN
  IF current_setting('deraledger.phase2b_expected_project_ref') IS DISTINCT FROM 'fsjljliiyfchkwbjifzw'
     OR current_database() IS DISTINCT FROM 'postgres'
     OR current_user IS DISTINCT FROM 'postgres'
     OR v_rpc IS NULL
     OR (SELECT count(*) FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'review_solo_plus_case_v1') IS DISTINCT FROM 1
     OR (SELECT md5(replace(replace(prosrc,E'\r\n',E'\n'),E'\r',E'\n'))
         FROM pg_proc WHERE oid = v_rpc) IS DISTINCT FROM '27710a7819d8413aa8764d8762a6a0ca'
     OR (SELECT prosecdef FROM pg_proc WHERE oid = v_rpc)
     OR (SELECT prorettype FROM pg_proc WHERE oid = v_rpc) IS DISTINCT FROM 'jsonb'::regtype
     OR (SELECT replace(proconfig[1], ' ', '') FROM pg_proc WHERE oid = v_rpc)
        IS DISTINCT FROM 'search_path=public,pg_temp'
     OR to_regrole('service_role') IS NULL
     OR NOT has_function_privilege('service_role', v_rpc, 'EXECUTE')
     OR has_function_privilege('anon', v_rpc, 'EXECUTE')
     OR has_function_privilege('authenticated', v_rpc, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p,
          LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
          WHERE p.oid = v_rpc AND a.privilege_type = 'EXECUTE'
            AND a.grantee NOT IN (p.proowner, to_regrole('service_role')::oid)) THEN
    RAISE EXCEPTION 'BLOCKED|REOPEN_PREFLIGHT|target_or_rpc_drift';
  END IF;

  SELECT * INTO v_case FROM public.solo_plus_cases
  WHERE id = current_setting('deraledger.phase2b_reopen_case_id')::uuid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BLOCKED|REOPEN_PREFLIGHT|fixture_missing';
  END IF;
  IF v_case.audit_metadata ->> 'fixture_scope' NOT IN (
       'phase2b_admin_detail_smoke', 'phase2b_reopen_acceptance'
     )
     OR v_case.audit_metadata ->> 'fixture_run_id'
        IS DISTINCT FROM current_setting('deraledger.phase2b_reopen_run_id')
     OR v_case.audit_metadata ->> 'synthetic_read_only_admin_smoke' IS DISTINCT FROM 'true'
     OR (v_case.audit_metadata ->> 'fixture_scope' = 'phase2b_reopen_acceptance'
       AND (v_case.audit_metadata ->> 'fixture_origin_scope' IS DISTINCT FROM 'phase2b_admin_detail_smoke'
         OR v_case.audit_metadata ->> 'synthetic_reopen_acceptance' IS DISTINCT FROM 'true')) THEN
    RAISE EXCEPTION 'BLOCKED|REOPEN_PREFLIGHT|fixture_marker_mismatch';
  END IF;
  IF v_case.case_status IS DISTINCT FROM 'rejected'
     OR v_case.row_version < 1
     OR v_case.payment_status IS DISTINCT FROM 'pending'
     OR v_case.refund_status IS DISTINCT FROM 'none'
     OR v_case.payment_record_id IS NOT NULL
     OR v_case.payment_provider IS NOT NULL
     OR v_case.payment_reference IS NOT NULL
     OR v_case.activation_idempotency_key IS NOT NULL
     OR v_case.refund_idempotency_key IS NOT NULL
     OR v_case.approved_at IS NOT NULL
     OR v_case.approved_by_admin_id IS NOT NULL
     OR v_case.rejected_at IS NULL
     OR v_case.rejected_by_admin_id IS NULL
     OR NULLIF(btrim(v_case.rejection_reason), '') IS NULL
     OR v_case.reopened_at IS NOT NULL
     OR v_case.reopened_by_admin_id IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCKED|REOPEN_PREFLIGHT|rejected_case_state_mismatch';
  END IF;
  IF (SELECT array_agg(r.requirement_code ORDER BY r.requirement_code)
      FROM public.solo_plus_case_requirements r WHERE r.case_id = v_case.id)
       IS DISTINCT FROM ARRAY['activity_profile','bvn','id_document','proof_of_address','selfie_liveness','settlement_account']::text[]
     OR EXISTS (SELECT 1 FROM public.solo_plus_case_requirements r
       WHERE r.case_id = v_case.id AND (r.requirement_state IS DISTINCT FROM 'not_started'
         OR r.verification_log_id IS NOT NULL OR r.evidence_source_type IS NOT NULL
         OR r.evidence_source_id IS NOT NULL OR r.evidence_reference IS NOT NULL
         OR r.original_completed_at IS NOT NULL OR r.reuse_decision_at IS NOT NULL
         OR r.reuse_reason IS NOT NULL OR r.policy_rule_applied IS NOT NULL
         OR r.reviewed_by_admin_id IS NOT NULL OR r.review_note IS NOT NULL
         OR r.provider_name IS NOT NULL OR r.provider_reference IS NOT NULL
         OR r.failure_reason IS NOT NULL OR r.completed_at IS NOT NULL
         OR r.metadata IS DISTINCT FROM '{}'::jsonb))
     OR EXISTS (SELECT 1 FROM public.payment_records p WHERE p.solo_plus_case_id = v_case.id)
     OR (SELECT count(*) FROM public.solo_plus_case_events e
         WHERE e.case_id = v_case.id AND e.event_type = 'case_reopened') IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'BLOCKED|REOPEN_PREFLIGHT|fixture_descendant_mismatch';
  END IF;
  SELECT * INTO v_reject FROM public.solo_plus_case_events e
  WHERE e.case_id = v_case.id AND e.event_type = 'case_rejected';
  IF NOT FOUND
     OR (SELECT count(*) FROM public.solo_plus_case_events e
         WHERE e.case_id = v_case.id AND e.event_type = 'case_rejected') IS DISTINCT FROM 1
     OR v_reject.actor_type IS DISTINCT FROM 'admin'
     OR v_reject.actor_id IS DISTINCT FROM v_case.rejected_by_admin_id
     OR v_reject.reason IS DISTINCT FROM v_case.rejection_reason
     OR v_reject.request_idempotency_key IS NULL
     OR v_reject.previous_state ->> 'caseStatus' IS DISTINCT FROM 'manual_review'
     OR v_reject.new_state ->> 'caseStatus' IS DISTINCT FROM 'rejected'
     OR v_reject.new_state ->> 'rowVersion' IS DISTINCT FROM (
       CASE WHEN v_case.audit_metadata ->> 'fixture_scope' = 'phase2b_reopen_acceptance'
         THEN v_case.row_version - 1 ELSE v_case.row_version END
     )::text THEN
    RAISE EXCEPTION 'BLOCKED|REOPEN_PREFLIGHT|reject_history_mismatch';
  END IF;
  IF current_setting('deraledger.phase2b_reopen_boundary', true) !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'BLOCKED|REOPEN_PREFLIGHT|boundary_unavailable';
  END IF;
END
$guard$;
SELECT 'PASS|REOPEN_PREFLIGHT|' ||
       CASE WHEN c.audit_metadata ->> 'fixture_scope' = 'phase2b_reopen_acceptance'
         THEN 'ready' ELSE 'candidate_requires_preparation' END ||
       '|row_version=' || c.row_version::text ||
       '|boundary=' || current_setting('deraledger.phase2b_reopen_boundary')
FROM public.solo_plus_cases c
WHERE c.id = :'fixture_case_id'::uuid;
ROLLBACK;
