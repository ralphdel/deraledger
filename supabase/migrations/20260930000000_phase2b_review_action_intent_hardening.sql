-- Phase 2B review-action intent and approval eligibility hardening.
-- Source-only package: rollout requires the separately reviewed staging migration gate.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.review_solo_plus_case_v1(uuid,bigint,text,text,uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Phase 2B review hardening prerequisite missing: review_solo_plus_case_v1';
  END IF;

  IF to_regclass('public.solo_plus_cases') IS NULL
     OR to_regclass('public.solo_plus_case_requirements') IS NULL
     OR to_regclass('public.solo_plus_case_events') IS NULL
     OR to_regclass('public.payment_records') IS NULL THEN
    RAISE EXCEPTION 'Phase 2B review hardening prerequisite tables are missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.solo_plus_case_events
    WHERE request_idempotency_key IS NOT NULL
      AND event_type IN (
        'case_review_requested_more_information',
        'case_approved',
        'case_rejected',
        'case_reopened'
      )
    GROUP BY request_idempotency_key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Phase 2B review hardening blocked: duplicate review idempotency keys exist';
  END IF;
END;
$$;

-- Build the expected predicate through PostgreSQL itself so compatibility
-- checks compare canonical catalog expressions rather than hand-normalized
-- SQL text. This object is session-local and is dropped at COMMIT.
CREATE TEMP TABLE phase2b_review_intent_index_expected_shape (
  request_idempotency_key TEXT,
  event_type TEXT
) ON COMMIT DROP;

CREATE UNIQUE INDEX phase2b_review_intent_index_expected_shape_idx
  ON phase2b_review_intent_index_expected_shape (request_idempotency_key)
  WHERE request_idempotency_key IS NOT NULL
    AND event_type IN (
      'case_review_requested_more_information',
      'case_approved',
      'case_rejected',
      'case_reopened'
    );

CREATE OR REPLACE FUNCTION pg_temp.assert_phase2b_review_intent_index(
  p_require_exists BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_index_oid OID;
  v_is_unique BOOLEAN;
  v_is_valid BOOLEAN;
  v_is_ready BOOLEAN;
  v_is_live BOOLEAN;
  v_key_count INTEGER;
  v_attribute_count INTEGER;
  v_has_no_expressions BOOLEAN;
  v_access_method TEXT;
  v_table_schema TEXT;
  v_table_name TEXT;
  v_key_columns TEXT[];
  v_actual_predicate TEXT;
  v_expected_predicate TEXT;
BEGIN
  SELECT c.oid
  INTO v_index_oid
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'idx_solo_plus_case_events_review_request_intent';

  IF v_index_oid IS NULL THEN
    IF p_require_exists THEN
      RAISE EXCEPTION 'Phase 2B review hardening verification failed: intent index missing';
    END IF;
    RETURN;
  END IF;

  SELECT
    i.indisunique,
    i.indisvalid,
    i.indisready,
    i.indislive,
    i.indnkeyatts,
    i.indnatts,
    i.indexprs IS NULL,
    am.amname,
    table_namespace.nspname,
    table_class.relname,
    ARRAY(
      SELECT attribute.attname
      FROM unnest(i.indkey::SMALLINT[]) WITH ORDINALITY AS key_column(attnum, ordinal)
      JOIN pg_catalog.pg_attribute attribute
        ON attribute.attrelid = i.indrelid
       AND attribute.attnum = key_column.attnum
      WHERE key_column.ordinal <= i.indnkeyatts
      ORDER BY key_column.ordinal
    ),
    regexp_replace(
      pg_catalog.pg_get_expr(i.indpred, i.indrelid, false),
      '[[:space:]]+',
      ' ',
      'g'
    )
  INTO
    v_is_unique,
    v_is_valid,
    v_is_ready,
    v_is_live,
    v_key_count,
    v_attribute_count,
    v_has_no_expressions,
    v_access_method,
    v_table_schema,
    v_table_name,
    v_key_columns,
    v_actual_predicate
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class index_class ON index_class.oid = i.indexrelid
  JOIN pg_catalog.pg_class table_class ON table_class.oid = i.indrelid
  JOIN pg_catalog.pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
  JOIN pg_catalog.pg_am am ON am.oid = index_class.relam
  WHERE i.indexrelid = v_index_oid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phase 2B review hardening blocked: intent index name belongs to a non-index object';
  END IF;

  SELECT regexp_replace(
    pg_catalog.pg_get_expr(i.indpred, i.indrelid, false),
    '[[:space:]]+',
    ' ',
    'g'
  )
  INTO STRICT v_expected_predicate
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class index_class ON index_class.oid = i.indexrelid
  WHERE index_class.relnamespace = pg_catalog.pg_my_temp_schema()
    AND index_class.relname = 'phase2b_review_intent_index_expected_shape_idx';

  IF v_table_schema <> 'public'
     OR v_table_name <> 'solo_plus_case_events'
     OR v_is_unique IS NOT TRUE
     OR v_is_valid IS NOT TRUE
     OR v_is_ready IS NOT TRUE
     OR v_is_live IS NOT TRUE
     OR v_access_method <> 'btree'
     OR v_key_count <> 1
     OR v_attribute_count <> 1
     OR v_has_no_expressions IS NOT TRUE
     OR v_key_columns IS DISTINCT FROM ARRAY['request_idempotency_key']::TEXT[]
     OR v_actual_predicate IS DISTINCT FROM v_expected_predicate THEN
    RAISE EXCEPTION 'Phase 2B review hardening blocked: incompatible review intent index definition';
  END IF;
END;
$$;

DO $$
BEGIN
  -- IF NOT EXISTS is permitted only after a same-name object has been proven
  -- structurally and predicate-equivalent to the intended index.
  PERFORM pg_temp.assert_phase2b_review_intent_index(false);
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_solo_plus_case_events_review_request_intent
  ON public.solo_plus_case_events (request_idempotency_key)
  WHERE request_idempotency_key IS NOT NULL
    AND event_type IN (
      'case_review_requested_more_information',
      'case_approved',
      'case_rejected',
      'case_reopened'
    );

CREATE OR REPLACE FUNCTION public.review_solo_plus_case_v1(
  p_case_id UUID,
  p_expected_row_version BIGINT,
  p_request_idempotency_key TEXT,
  p_decision TEXT,
  p_reviewer_admin_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_policy_version TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_case public.solo_plus_cases%ROWTYPE;
  v_previous_case public.solo_plus_cases%ROWTYPE;
  v_existing_event public.solo_plus_case_events%ROWTYPE;
  v_inserted_event public.solo_plus_case_events%ROWTYPE;
  v_now TIMESTAMPTZ := now();
  v_decision TEXT;
  v_reason TEXT;
  v_effective_policy_version TEXT;
  v_event_type TEXT;
  v_target_status TEXT;
  v_target_refund_status TEXT;
  v_reason_required BOOLEAN := false;
  v_requirement_count INTEGER;
  v_satisfied_requirement_count INTEGER;
BEGIN
  IF p_case_id IS NULL THEN
    RAISE EXCEPTION 'Solo Plus review case_id is required';
  END IF;

  IF p_expected_row_version IS NULL OR p_expected_row_version < 0 THEN
    RAISE EXCEPTION 'Solo Plus review expected_row_version must be a non-negative integer';
  END IF;

  IF p_request_idempotency_key IS NULL OR btrim(p_request_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Solo Plus review request idempotency key is required';
  END IF;

  IF p_reviewer_admin_id IS NULL THEN
    RAISE EXCEPTION 'Solo Plus reviewer_admin_id is required';
  END IF;

  v_decision := lower(btrim(COALESCE(p_decision, '')));
  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');

  IF v_reason IS NOT NULL AND char_length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'Solo Plus review reason must be at most 1000 characters';
  END IF;

  CASE v_decision
    WHEN 'request_more_information' THEN
      v_event_type := 'case_review_requested_more_information';
      v_target_status := 'verification_pending';
      v_reason_required := true;
    WHEN 'approve' THEN
      v_event_type := 'case_approved';
      v_target_status := 'approved';
    WHEN 'reject' THEN
      v_event_type := 'case_rejected';
      v_target_status := 'rejected';
      v_reason_required := true;
    WHEN 'reopen' THEN
      v_event_type := 'case_reopened';
      v_target_status := 'verification_pending';
    ELSE
      RAISE EXCEPTION 'Solo Plus review decision must be one of request_more_information, approve, reject, or reopen';
  END CASE;

  IF v_reason_required AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Solo Plus review reason is required for %', v_decision;
  END IF;

  SELECT *
  INTO v_case
  FROM public.solo_plus_cases
  WHERE id = p_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'not_found');
  END IF;

  v_effective_policy_version := COALESCE(
    NULLIF(btrim(COALESCE(p_policy_version, '')), ''),
    v_case.requirements_policy_version
  );

  SELECT *
  INTO v_existing_event
  FROM public.solo_plus_case_events
  WHERE request_idempotency_key = p_request_idempotency_key
    AND event_type IN (
      'case_review_requested_more_information',
      'case_approved',
      'case_rejected',
      'case_reopened'
    )
  ORDER BY created_at ASC, id ASC
  LIMIT 1;

  IF FOUND THEN
    IF v_existing_event.case_id = p_case_id
       AND v_existing_event.event_type = v_event_type
       AND v_existing_event.actor_type = 'admin'
       AND v_existing_event.actor_id IS NOT DISTINCT FROM p_reviewer_admin_id
       AND v_existing_event.reason IS NOT DISTINCT FROM v_reason
       AND v_existing_event.policy_version = v_effective_policy_version
       AND v_existing_event.previous_state ->> 'rowVersion' = p_expected_row_version::text THEN
      RETURN jsonb_build_object(
        'kind', 'idempotent_replay',
        'case', to_jsonb(v_case),
        'event', to_jsonb(v_existing_event)
      );
    END IF;

    RETURN jsonb_build_object(
      'kind', 'idempotency_conflict',
      'case', to_jsonb(v_case)
    );
  END IF;

  IF v_case.row_version::BIGINT <> p_expected_row_version THEN
    RETURN jsonb_build_object(
      'kind', 'version_conflict',
      'case', to_jsonb(v_case)
    );
  END IF;

  IF (v_decision IN ('request_more_information', 'approve', 'reject') AND v_case.case_status <> 'manual_review')
     OR (v_decision = 'reopen' AND v_case.case_status <> 'rejected') THEN
    RETURN jsonb_build_object(
      'kind', 'state_conflict',
      'case', to_jsonb(v_case)
    );
  END IF;

  IF v_decision = 'approve' THEN
    SELECT
      count(*)::INTEGER,
      count(*) FILTER (
        WHERE requirement_code IN (
          'bvn',
          'selfie_liveness',
          'id_document',
          'proof_of_address',
          'settlement_account',
          'activity_profile'
        )
          AND requirement_state IN ('passed', 'reused', 'waived')
      )::INTEGER
    INTO v_requirement_count, v_satisfied_requirement_count
    FROM public.solo_plus_case_requirements
    WHERE case_id = p_case_id;

    IF v_case.payment_status <> 'paid'
       OR v_case.payment_record_id IS NULL
       OR v_requirement_count <> 6
       OR v_satisfied_requirement_count <> 6
       OR NOT EXISTS (
         SELECT 1
         FROM public.payment_records p
         WHERE p.id = v_case.payment_record_id
           AND p.solo_plus_case_id = p_case_id
           AND p.payment_status = 'successful'
       ) THEN
      RETURN jsonb_build_object(
        'kind', 'state_conflict',
        'case', to_jsonb(v_case)
      );
    END IF;
  END IF;

  v_target_refund_status := CASE
    WHEN v_decision = 'request_more_information' THEN v_case.refund_status
    WHEN v_decision = 'approve' THEN 'none'
    WHEN v_decision = 'reject' THEN CASE WHEN v_case.payment_status = 'paid' THEN 'review_required' ELSE 'none' END
    WHEN v_decision = 'reopen' THEN 'none'
    ELSE v_case.refund_status
  END;

  v_previous_case := v_case;

  UPDATE public.solo_plus_cases
  SET
    case_status = v_target_status,
    refund_status = v_target_refund_status,
    approved_at = CASE WHEN v_decision = 'approve' THEN v_now ELSE approved_at END,
    approved_by_admin_id = CASE WHEN v_decision = 'approve' THEN p_reviewer_admin_id ELSE approved_by_admin_id END,
    rejected_at = CASE
      WHEN v_decision = 'reject' THEN v_now
      WHEN v_decision = 'reopen' THEN NULL
      ELSE rejected_at
    END,
    rejected_by_admin_id = CASE
      WHEN v_decision = 'reject' THEN p_reviewer_admin_id
      WHEN v_decision = 'reopen' THEN NULL
      ELSE rejected_by_admin_id
    END,
    reopened_at = CASE WHEN v_decision = 'reopen' THEN v_now ELSE reopened_at END,
    reopened_by_admin_id = CASE WHEN v_decision = 'reopen' THEN p_reviewer_admin_id ELSE reopened_by_admin_id END,
    rejection_reason = CASE
      WHEN v_decision = 'reject' THEN v_reason
      WHEN v_decision = 'reopen' THEN NULL
      ELSE rejection_reason
    END,
    refund_idempotency_key = CASE WHEN v_decision = 'reopen' THEN NULL ELSE refund_idempotency_key END,
    row_version = row_version + 1,
    updated_at = v_now
  WHERE id = p_case_id
  RETURNING * INTO v_case;

  INSERT INTO public.solo_plus_case_events (
    case_id,
    event_type,
    previous_state,
    new_state,
    actor_type,
    actor_id,
    request_idempotency_key,
    reason,
    policy_version,
    created_at
  )
  VALUES (
    p_case_id,
    v_event_type,
    jsonb_build_object(
      'caseStatus', v_previous_case.case_status,
      'refundStatus', v_previous_case.refund_status,
      'approvedAt', v_previous_case.approved_at,
      'approvedByAdminId', v_previous_case.approved_by_admin_id,
      'rejectedAt', v_previous_case.rejected_at,
      'rejectedByAdminId', v_previous_case.rejected_by_admin_id,
      'reopenedAt', v_previous_case.reopened_at,
      'reopenedByAdminId', v_previous_case.reopened_by_admin_id,
      'rejectionReason', v_previous_case.rejection_reason,
      'rowVersion', p_expected_row_version
    ),
    jsonb_build_object(
      'caseStatus', v_case.case_status,
      'refundStatus', v_case.refund_status,
      'approvedAt', v_case.approved_at,
      'approvedByAdminId', v_case.approved_by_admin_id,
      'rejectedAt', v_case.rejected_at,
      'rejectedByAdminId', v_case.rejected_by_admin_id,
      'reopenedAt', v_case.reopened_at,
      'reopenedByAdminId', v_case.reopened_by_admin_id,
      'rejectionReason', v_case.rejection_reason,
      'rowVersion', v_case.row_version
    ),
    'admin',
    p_reviewer_admin_id,
    p_request_idempotency_key,
    v_reason,
    v_effective_policy_version,
    v_now
  )
  RETURNING * INTO v_inserted_event;

  RETURN jsonb_build_object(
    'kind', 'updated',
    'case', to_jsonb(v_case),
    'event', to_jsonb(v_inserted_event)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.review_solo_plus_case_v1(UUID, BIGINT, TEXT, TEXT, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_solo_plus_case_v1(UUID, BIGINT, TEXT, TEXT, UUID, TEXT, TEXT)
  TO service_role;

DO $$
BEGIN
  -- Re-run the complete catalog and canonical-predicate assertion after
  -- creation. This proves IF NOT EXISTS did not accept an incompatible object.
  PERFORM pg_temp.assert_phase2b_review_intent_index(true);

  IF NOT has_function_privilege(
    'service_role',
    'public.review_solo_plus_case_v1(uuid,bigint,text,text,uuid,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Phase 2B review hardening verification failed: service_role execute missing';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.review_solo_plus_case_v1(uuid,bigint,text,text,uuid,text,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.review_solo_plus_case_v1(uuid,bigint,text,text,uuid,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Phase 2B review hardening verification failed: browser execute present';
  END IF;
END;
$$;

COMMIT;
