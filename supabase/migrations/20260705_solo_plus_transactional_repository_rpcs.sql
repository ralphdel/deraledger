-- ============================================================
-- Solo Plus transactional repository RPCs
-- Narrow transactional functions for the Commit 4 repository contract.
-- No runtime routing, payment initialization, approval, activation,
-- or feature-flag changes are introduced here.
-- ============================================================

CREATE OR REPLACE FUNCTION public.solo_plus_contains_prohibited_key_v1(
  p_value JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry RECORD;
  v_item JSONB;
BEGIN
  IF p_value IS NULL THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(p_value) = 'object' THEN
    FOR v_entry IN
      SELECT key, value
      FROM jsonb_each(p_value)
    LOOP
      IF lower(v_entry.key) IN (
        'bvn',
        'account_number',
        'accountnumber',
        'raw_document',
        'rawdocument',
        'selfie',
        'provider_payload',
        'providerpayload',
        'id_number',
        'idnumber'
      ) THEN
        RETURN true;
      END IF;

      IF jsonb_typeof(v_entry.value) IN ('object', 'array')
         AND public.solo_plus_contains_prohibited_key_v1(v_entry.value) THEN
        RETURN true;
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(p_value) = 'array' THEN
    FOR v_item IN
      SELECT value
      FROM jsonb_array_elements(p_value) AS t(value)
    LOOP
      IF jsonb_typeof(v_item) IN ('object', 'array')
         AND public.solo_plus_contains_prohibited_key_v1(v_item) THEN
        RETURN true;
      END IF;
    END LOOP;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.solo_plus_assert_safe_snapshot_v1(
  p_snapshot JSONB
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'Solo Plus requirements snapshot must be a JSON object';
  END IF;

  IF public.solo_plus_contains_prohibited_key_v1(p_snapshot) THEN
    RAISE EXCEPTION 'Solo Plus requirements snapshot contains a prohibited sensitive key';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.solo_plus_assert_amount_v1(
  p_expected_amount TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trimmed_amount TEXT;
  v_numeric_amount NUMERIC(18,2);
BEGIN
  IF p_expected_amount IS NULL THEN
    RAISE EXCEPTION 'Solo Plus expected amount is required';
  END IF;

  v_trimmed_amount := btrim(p_expected_amount);

  IF v_trimmed_amount = '' THEN
    RAISE EXCEPTION 'Solo Plus expected amount is required';
  END IF;

  IF v_trimmed_amount !~ '^(0|[1-9][0-9]{0,15})(\.[0-9]{1,2})?$' THEN
    RAISE EXCEPTION 'Solo Plus expected amount must be a non-negative numeric(18,2)-compatible decimal string with at most two decimal places';
  END IF;

  v_numeric_amount := v_trimmed_amount::NUMERIC(18,2);

  IF v_numeric_amount > 9999999999999999.99 THEN
    RAISE EXCEPTION 'Solo Plus expected amount must fit numeric(18,2)';
  END IF;

  RETURN v_numeric_amount;
END;
$$;

CREATE OR REPLACE FUNCTION public.solo_plus_case_bundle_payload_v1(
  p_case_id UUID
)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'case',
    (
      SELECT jsonb_build_object(
        'id', c.id,
        'merchant_id', c.merchant_id,
        'onboarding_session_id', c.onboarding_session_id,
        'flow_origin', c.flow_origin,
        'source_plan', c.source_plan,
        'target_plan', c.target_plan,
        'case_status', c.case_status,
        'payment_status', c.payment_status,
        'refund_status', c.refund_status,
        'payment_record_id', c.payment_record_id,
        'payment_provider', c.payment_provider,
        'payment_reference', c.payment_reference,
        'expected_amount', c.expected_amount::text,
        'payment_currency', c.payment_currency,
        'requirements_policy_version', c.requirements_policy_version,
        'requirements_snapshot', c.requirements_snapshot,
        'active_plan_snapshot', c.active_plan_snapshot,
        'rejection_reason', c.rejection_reason,
        'approved_at', c.approved_at,
        'rejected_at', c.rejected_at,
        'reopened_at', c.reopened_at,
        'idempotency_key', c.idempotency_key,
        'activation_idempotency_key', c.activation_idempotency_key,
        'refund_idempotency_key', c.refund_idempotency_key,
        'row_version', c.row_version,
        'created_at', c.created_at,
        'updated_at', c.updated_at
      )
      FROM public.solo_plus_cases c
      WHERE c.id = p_case_id
    ),
    'requirements',
    COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(r) ORDER BY r.requirement_code)
        FROM public.solo_plus_case_requirements r
        WHERE r.case_id = p_case_id
      ),
      '[]'::jsonb
    ),
    'created_event',
    (
      SELECT to_jsonb(e)
      FROM public.solo_plus_case_events e
      WHERE e.case_id = p_case_id
        AND e.event_type = 'case_created'
      ORDER BY e.created_at ASC, e.id ASC
      LIMIT 1
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.create_solo_plus_case_bundle_v1(
  p_flow_origin TEXT,
  p_merchant_id UUID,
  p_onboarding_session_id UUID,
  p_source_plan TEXT,
  p_target_plan TEXT,
  p_expected_amount TEXT,
  p_payment_currency TEXT,
  p_requirements_policy_version TEXT,
  p_requirements_snapshot JSONB,
  p_active_plan_snapshot TEXT,
  p_idempotency_key TEXT,
  p_actor_type TEXT,
  p_actor_id UUID,
  p_access_mode TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_case public.solo_plus_cases%ROWTYPE;
  v_active_case public.solo_plus_cases%ROWTYPE;
  v_inserted_case public.solo_plus_cases%ROWTYPE;
  v_inserted_event public.solo_plus_case_events%ROWTYPE;
  v_expected_amount NUMERIC(18,2);
  v_payload JSONB;
BEGIN
  IF p_flow_origin NOT IN ('onboarding', 'upgrade') THEN
    RAISE EXCEPTION 'Solo Plus flow origin must be onboarding or upgrade';
  END IF;

  IF p_actor_type NOT IN ('merchant', 'admin') THEN
    RAISE EXCEPTION 'Solo Plus actor type must be merchant or admin';
  END IF;

  IF p_access_mode NOT IN ('public', 'internal_test') THEN
    RAISE EXCEPTION 'Solo Plus access mode must be public or internal_test';
  END IF;

  IF p_target_plan <> 'solo_plus' THEN
    RAISE EXCEPTION 'Solo Plus target plan must be solo_plus';
  END IF;

  IF p_payment_currency <> 'NGN' THEN
    RAISE EXCEPTION 'Solo Plus payment currency must be NGN';
  END IF;

  IF p_requirements_policy_version IS NULL OR btrim(p_requirements_policy_version) = '' THEN
    RAISE EXCEPTION 'Solo Plus requirements policy version is required';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Solo Plus idempotency key is required';
  END IF;

  v_expected_amount := public.solo_plus_assert_amount_v1(p_expected_amount);
  PERFORM public.solo_plus_assert_safe_snapshot_v1(p_requirements_snapshot);

  IF p_flow_origin = 'onboarding' THEN
    IF p_onboarding_session_id IS NULL THEN
      RAISE EXCEPTION 'Solo Plus onboarding case requires onboarding_session_id';
    END IF;

    IF p_source_plan IS NOT NULL THEN
      RAISE EXCEPTION 'Solo Plus onboarding case source_plan must be null';
    END IF;
  ELSE
    IF p_merchant_id IS NULL THEN
      RAISE EXCEPTION 'Solo Plus upgrade case requires merchant_id';
    END IF;

    IF p_onboarding_session_id IS NOT NULL THEN
      RAISE EXCEPTION 'Solo Plus upgrade case onboarding_session_id must be null';
    END IF;

    IF p_source_plan <> 'solo_lite' THEN
      RAISE EXCEPTION 'Solo Plus upgrade case source_plan must be solo_lite';
    END IF;

    IF p_active_plan_snapshot <> 'solo_lite' THEN
      RAISE EXCEPTION 'Solo Plus upgrade case active_plan_snapshot must be solo_lite';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('solo_plus:create:idempotency:' || p_idempotency_key, 0)
  );

  IF p_flow_origin = 'onboarding' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'solo_plus:create:onboarding:' || p_onboarding_session_id::text,
        0
      )
    );
  ELSE
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'solo_plus:create:merchant:' || p_merchant_id::text,
        0
      )
    );
  END IF;

  SELECT *
  INTO v_existing_case
  FROM public.solo_plus_cases
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_case.flow_origin = p_flow_origin
       AND v_existing_case.merchant_id IS NOT DISTINCT FROM p_merchant_id
       AND v_existing_case.onboarding_session_id IS NOT DISTINCT FROM p_onboarding_session_id
       AND v_existing_case.source_plan IS NOT DISTINCT FROM p_source_plan
       AND v_existing_case.target_plan = 'solo_plus'
       AND v_existing_case.expected_amount = v_expected_amount
       AND v_existing_case.payment_currency = 'NGN'
       AND v_existing_case.requirements_policy_version = p_requirements_policy_version
       AND v_existing_case.requirements_snapshot = p_requirements_snapshot
       AND v_existing_case.active_plan_snapshot IS NOT DISTINCT FROM p_active_plan_snapshot THEN
      v_payload := public.solo_plus_case_bundle_payload_v1(v_existing_case.id);
      RETURN jsonb_build_object(
        'kind', 'idempotent_replay',
        'case', v_payload->'case',
        'requirements', v_payload->'requirements',
        'event', v_payload->'created_event'
      );
    END IF;

    RETURN jsonb_build_object(
      'kind', 'idempotency_conflict',
      'case', public.solo_plus_case_bundle_payload_v1(v_existing_case.id)->'case'
    );
  END IF;

  IF p_flow_origin = 'onboarding' THEN
    SELECT *
    INTO v_active_case
    FROM public.solo_plus_cases
    WHERE onboarding_session_id = p_onboarding_session_id
      AND flow_origin = 'onboarding'
      AND case_status IN ('draft', 'awaiting_payment', 'verification_pending', 'manual_review')
    ORDER BY created_at ASC, id ASC
    LIMIT 1
    FOR UPDATE;
  ELSE
    SELECT *
    INTO v_active_case
    FROM public.solo_plus_cases
    WHERE merchant_id = p_merchant_id
      AND case_status IN ('draft', 'awaiting_payment', 'verification_pending', 'manual_review')
    ORDER BY created_at ASC, id ASC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF FOUND THEN
    IF v_active_case.flow_origin = p_flow_origin
       AND v_active_case.merchant_id IS NOT DISTINCT FROM p_merchant_id
       AND v_active_case.onboarding_session_id IS NOT DISTINCT FROM p_onboarding_session_id
       AND v_active_case.source_plan IS NOT DISTINCT FROM p_source_plan
       AND v_active_case.target_plan = 'solo_plus'
       AND v_active_case.expected_amount = v_expected_amount
       AND v_active_case.payment_currency = 'NGN'
       AND v_active_case.requirements_policy_version = p_requirements_policy_version
       AND v_active_case.requirements_snapshot = p_requirements_snapshot
       AND v_active_case.active_plan_snapshot IS NOT DISTINCT FROM p_active_plan_snapshot THEN
      v_payload := public.solo_plus_case_bundle_payload_v1(v_active_case.id);
      RETURN jsonb_build_object(
        'kind', 'existing_active_case',
        'case', v_payload->'case',
        'requirements', v_payload->'requirements',
        'event', v_payload->'created_event'
      );
    END IF;

    RETURN jsonb_build_object(
      'kind', 'active_case_conflict',
      'case', public.solo_plus_case_bundle_payload_v1(v_active_case.id)->'case'
    );
  END IF;

  INSERT INTO public.solo_plus_cases (
    merchant_id,
    onboarding_session_id,
    flow_origin,
    source_plan,
    target_plan,
    case_status,
    payment_status,
    refund_status,
    payment_record_id,
    payment_provider,
    payment_reference,
    expected_amount,
    payment_currency,
    requirements_policy_version,
    requirements_snapshot,
    active_plan_snapshot,
    rejection_reason,
    approved_at,
    approved_by_admin_id,
    rejected_at,
    rejected_by_admin_id,
    reopened_at,
    reopened_by_admin_id,
    idempotency_key,
    activation_idempotency_key,
    refund_idempotency_key,
    row_version,
    audit_metadata
  )
  VALUES (
    p_merchant_id,
    p_onboarding_session_id,
    p_flow_origin,
    p_source_plan,
    'solo_plus',
    'draft',
    'pending',
    'none',
    NULL,
    NULL,
    NULL,
    v_expected_amount,
    'NGN',
    p_requirements_policy_version,
    p_requirements_snapshot,
    p_active_plan_snapshot,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    p_idempotency_key,
    NULL,
    NULL,
    0,
    '{}'::jsonb
  )
  RETURNING * INTO v_inserted_case;

  INSERT INTO public.solo_plus_case_requirements (
    case_id,
    requirement_code,
    requirement_state,
    verification_log_id,
    evidence_source_type,
    evidence_source_id,
    evidence_reference,
    original_completed_at,
    reuse_decision_at,
    reuse_reason,
    policy_rule_applied,
    reviewed_by_admin_id,
    review_note,
    provider_name,
    provider_reference,
    failure_reason,
    completed_at,
    metadata
  )
  SELECT
    v_inserted_case.id,
    required_code,
    'not_started',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    '{}'::jsonb
  FROM unnest(ARRAY[
    'bvn',
    'selfie_liveness',
    'id_document',
    'proof_of_address',
    'settlement_account',
    'activity_profile'
  ]) AS required_code;

  INSERT INTO public.solo_plus_case_events (
    case_id,
    event_type,
    previous_state,
    new_state,
    actor_type,
    actor_id,
    request_idempotency_key,
    reason,
    policy_version
  )
  VALUES (
    v_inserted_case.id,
    'case_created',
    '{}'::jsonb,
    jsonb_build_object(
      'flowOrigin', p_flow_origin,
      'targetPlan', 'solo_plus',
      'caseStatus', 'draft',
      'paymentStatus', 'pending',
      'refundStatus', 'none',
      'accessMode', p_access_mode
    ),
    p_actor_type,
    p_actor_id,
    NULL,
    'Solo Plus case created.',
    p_requirements_policy_version
  )
  RETURNING * INTO v_inserted_event;

  v_payload := public.solo_plus_case_bundle_payload_v1(v_inserted_case.id);
  RETURN jsonb_build_object(
    'kind', 'created',
    'case', v_payload->'case',
    'requirements', v_payload->'requirements',
    'event', to_jsonb(v_inserted_event)
  );
EXCEPTION
  WHEN unique_violation THEN
    SELECT *
    INTO v_existing_case
    FROM public.solo_plus_cases
    WHERE idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF FOUND THEN
      IF v_existing_case.flow_origin = p_flow_origin
         AND v_existing_case.merchant_id IS NOT DISTINCT FROM p_merchant_id
         AND v_existing_case.onboarding_session_id IS NOT DISTINCT FROM p_onboarding_session_id
         AND v_existing_case.source_plan IS NOT DISTINCT FROM p_source_plan
         AND v_existing_case.target_plan = 'solo_plus'
         AND v_existing_case.expected_amount = v_expected_amount
         AND v_existing_case.payment_currency = 'NGN'
         AND v_existing_case.requirements_policy_version = p_requirements_policy_version
         AND v_existing_case.requirements_snapshot = p_requirements_snapshot
         AND v_existing_case.active_plan_snapshot IS NOT DISTINCT FROM p_active_plan_snapshot THEN
        v_payload := public.solo_plus_case_bundle_payload_v1(v_existing_case.id);
        RETURN jsonb_build_object(
          'kind', 'idempotent_replay',
          'case', v_payload->'case',
          'requirements', v_payload->'requirements',
          'event', v_payload->'created_event'
        );
      END IF;

      RETURN jsonb_build_object(
        'kind', 'idempotency_conflict',
        'case', public.solo_plus_case_bundle_payload_v1(v_existing_case.id)->'case'
      );
    END IF;

    IF p_flow_origin = 'onboarding' THEN
      SELECT *
      INTO v_active_case
      FROM public.solo_plus_cases
      WHERE onboarding_session_id = p_onboarding_session_id
        AND flow_origin = 'onboarding'
        AND case_status IN ('draft', 'awaiting_payment', 'verification_pending', 'manual_review')
      ORDER BY created_at ASC, id ASC
      LIMIT 1;
    ELSE
      SELECT *
      INTO v_active_case
      FROM public.solo_plus_cases
      WHERE merchant_id = p_merchant_id
        AND case_status IN ('draft', 'awaiting_payment', 'verification_pending', 'manual_review')
      ORDER BY created_at ASC, id ASC
      LIMIT 1;
    END IF;

    IF FOUND THEN
      IF v_active_case.flow_origin = p_flow_origin
         AND v_active_case.merchant_id IS NOT DISTINCT FROM p_merchant_id
         AND v_active_case.onboarding_session_id IS NOT DISTINCT FROM p_onboarding_session_id
         AND v_active_case.source_plan IS NOT DISTINCT FROM p_source_plan
         AND v_active_case.target_plan = 'solo_plus'
         AND v_active_case.expected_amount = v_expected_amount
         AND v_active_case.payment_currency = 'NGN'
         AND v_active_case.requirements_policy_version = p_requirements_policy_version
         AND v_active_case.requirements_snapshot = p_requirements_snapshot
         AND v_active_case.active_plan_snapshot IS NOT DISTINCT FROM p_active_plan_snapshot THEN
        v_payload := public.solo_plus_case_bundle_payload_v1(v_active_case.id);
        RETURN jsonb_build_object(
          'kind', 'existing_active_case',
          'case', v_payload->'case',
          'requirements', v_payload->'requirements',
          'event', v_payload->'created_event'
        );
      END IF;

      RETURN jsonb_build_object(
        'kind', 'active_case_conflict',
        'case', public.solo_plus_case_bundle_payload_v1(v_active_case.id)->'case'
      );
    END IF;

    RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_solo_plus_onboarding_merchant_v1(
  p_case_id UUID,
  p_onboarding_session_id UUID,
  p_merchant_id UUID,
  p_expected_row_version INTEGER,
  p_request_idempotency_key TEXT,
  p_actor_type TEXT,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_case public.solo_plus_cases%ROWTYPE;
  v_conflicting_case public.solo_plus_cases%ROWTYPE;
  v_existing_event public.solo_plus_case_events%ROWTYPE;
  v_inserted_event public.solo_plus_case_events%ROWTYPE;
  v_payload JSONB;
BEGIN
  IF p_case_id IS NULL THEN
    RAISE EXCEPTION 'Solo Plus case_id is required';
  END IF;

  IF p_onboarding_session_id IS NULL THEN
    RAISE EXCEPTION 'Solo Plus onboarding_session_id is required';
  END IF;

  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Solo Plus merchant_id is required';
  END IF;

  IF p_expected_row_version IS NULL OR p_expected_row_version < 0 THEN
    RAISE EXCEPTION 'Solo Plus expected_row_version must be a non-negative integer';
  END IF;

  IF p_request_idempotency_key IS NULL OR btrim(p_request_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Solo Plus request idempotency key is required';
  END IF;

  IF p_actor_type NOT IN ('merchant', 'admin') THEN
    RAISE EXCEPTION 'Solo Plus actor type must be merchant or admin';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('solo_plus:attach:case:' || p_case_id::text, 0)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('solo_plus:attach:merchant:' || p_merchant_id::text, 0)
  );

  SELECT *
  INTO v_case
  FROM public.solo_plus_cases
  WHERE id = p_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'not_found');
  END IF;

  SELECT *
  INTO v_existing_event
  FROM public.solo_plus_case_events
  WHERE case_id = p_case_id
    AND event_type = 'merchant_attached'
    AND request_idempotency_key = p_request_idempotency_key
  ORDER BY created_at ASC, id ASC
  LIMIT 1;

  IF FOUND THEN
    IF v_existing_event.new_state->>'merchantId' = p_merchant_id::text
       AND v_existing_event.new_state->>'onboardingSessionId' = p_onboarding_session_id::text THEN
      RETURN jsonb_build_object(
        'kind', 'idempotent_replay',
        'case', public.solo_plus_case_bundle_payload_v1(v_case.id)->'case',
        'event', to_jsonb(v_existing_event)
      );
    END IF;

    RETURN jsonb_build_object(
      'kind', 'idempotency_conflict',
      'case', public.solo_plus_case_bundle_payload_v1(v_case.id)->'case'
    );
  END IF;

  IF v_case.flow_origin <> 'onboarding' THEN
    RETURN jsonb_build_object(
      'kind', 'ownership_conflict',
      'case', public.solo_plus_case_bundle_payload_v1(v_case.id)->'case'
    );
  END IF;

  IF v_case.onboarding_session_id IS DISTINCT FROM p_onboarding_session_id THEN
    RETURN jsonb_build_object(
      'kind', 'ownership_conflict',
      'case', public.solo_plus_case_bundle_payload_v1(v_case.id)->'case'
    );
  END IF;

  IF v_case.merchant_id = p_merchant_id THEN
    RETURN jsonb_build_object(
      'kind', 'idempotent_replay',
      'case', public.solo_plus_case_bundle_payload_v1(v_case.id)->'case',
      'event', NULL
    );
  END IF;

  IF v_case.merchant_id IS NOT NULL AND v_case.merchant_id <> p_merchant_id THEN
    RETURN jsonb_build_object(
      'kind', 'ownership_conflict',
      'case', public.solo_plus_case_bundle_payload_v1(v_case.id)->'case'
    );
  END IF;

  IF v_case.case_status IN ('approved', 'rejected', 'cancelled') THEN
    RETURN jsonb_build_object(
      'kind', 'state_conflict',
      'case', public.solo_plus_case_bundle_payload_v1(v_case.id)->'case'
    );
  END IF;

  IF v_case.row_version <> p_expected_row_version THEN
    RETURN jsonb_build_object(
      'kind', 'version_conflict',
      'case', public.solo_plus_case_bundle_payload_v1(v_case.id)->'case'
    );
  END IF;

  SELECT *
  INTO v_conflicting_case
  FROM public.solo_plus_cases
  WHERE merchant_id = p_merchant_id
    AND id <> p_case_id
    AND case_status IN ('draft', 'awaiting_payment', 'verification_pending', 'manual_review')
  ORDER BY created_at ASC, id ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'kind', 'active_case_conflict',
      'case', public.solo_plus_case_bundle_payload_v1(v_conflicting_case.id)->'case'
    );
  END IF;

  UPDATE public.solo_plus_cases
  SET
    merchant_id = p_merchant_id,
    row_version = row_version + 1,
    updated_at = now()
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
    policy_version
  )
  VALUES (
    p_case_id,
    'merchant_attached',
    jsonb_build_object(
      'merchantId', NULL,
      'rowVersion', p_expected_row_version
    ),
    jsonb_build_object(
      'merchantId', p_merchant_id::text,
      'onboardingSessionId', p_onboarding_session_id::text,
      'rowVersion', v_case.row_version
    ),
    p_actor_type,
    p_actor_id,
    p_request_idempotency_key,
    'Merchant attached to onboarding case.',
    v_case.requirements_policy_version
  )
  RETURNING * INTO v_inserted_event;

  RETURN jsonb_build_object(
    'kind', 'updated',
    'case', public.solo_plus_case_bundle_payload_v1(v_case.id)->'case',
    'event', to_jsonb(v_inserted_event)
  );
EXCEPTION
  WHEN unique_violation THEN
    SELECT *
    INTO v_existing_event
    FROM public.solo_plus_case_events
    WHERE case_id = p_case_id
      AND event_type = 'merchant_attached'
      AND request_idempotency_key = p_request_idempotency_key
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    IF FOUND THEN
      SELECT *
      INTO v_case
      FROM public.solo_plus_cases
      WHERE id = p_case_id;

      IF v_existing_event.new_state->>'merchantId' = p_merchant_id::text
         AND v_existing_event.new_state->>'onboardingSessionId' = p_onboarding_session_id::text THEN
        RETURN jsonb_build_object(
          'kind', 'idempotent_replay',
          'case', public.solo_plus_case_bundle_payload_v1(v_case.id)->'case',
          'event', to_jsonb(v_existing_event)
        );
      END IF;

      RETURN jsonb_build_object(
        'kind', 'idempotency_conflict',
        'case', public.solo_plus_case_bundle_payload_v1(v_case.id)->'case'
      );
    END IF;

    SELECT *
    INTO v_conflicting_case
    FROM public.solo_plus_cases
    WHERE merchant_id = p_merchant_id
      AND id <> p_case_id
      AND case_status IN ('draft', 'awaiting_payment', 'verification_pending', 'manual_review')
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'kind', 'active_case_conflict',
        'case', public.solo_plus_case_bundle_payload_v1(v_conflicting_case.id)->'case'
      );
    END IF;

    RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_solo_plus_case_awaiting_payment_v1(
  p_case_id UUID,
  p_expected_row_version INTEGER,
  p_request_idempotency_key TEXT,
  p_actor_type TEXT,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_case public.solo_plus_cases%ROWTYPE;
  v_existing_event public.solo_plus_case_events%ROWTYPE;
  v_inserted_event public.solo_plus_case_events%ROWTYPE;
BEGIN
  IF p_case_id IS NULL THEN
    RAISE EXCEPTION 'Solo Plus case_id is required';
  END IF;

  IF p_expected_row_version IS NULL OR p_expected_row_version < 0 THEN
    RAISE EXCEPTION 'Solo Plus expected_row_version must be a non-negative integer';
  END IF;

  IF p_request_idempotency_key IS NULL OR btrim(p_request_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Solo Plus request idempotency key is required';
  END IF;

  IF p_actor_type NOT IN ('merchant', 'admin') THEN
    RAISE EXCEPTION 'Solo Plus actor type must be merchant or admin';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('solo_plus:awaiting_payment:case:' || p_case_id::text, 0)
  );

  SELECT *
  INTO v_case
  FROM public.solo_plus_cases
  WHERE id = p_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'not_found');
  END IF;

  SELECT *
  INTO v_existing_event
  FROM public.solo_plus_case_events
  WHERE case_id = p_case_id
    AND event_type = 'case_marked_awaiting_payment'
    AND request_idempotency_key = p_request_idempotency_key
  ORDER BY created_at ASC, id ASC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'kind', 'idempotent_replay',
      'case', public.solo_plus_case_bundle_payload_v1(v_case.id)->'case',
      'event', to_jsonb(v_existing_event)
    );
  END IF;

  IF v_case.case_status <> 'draft' THEN
    RETURN jsonb_build_object(
      'kind', 'state_conflict',
      'case', public.solo_plus_case_bundle_payload_v1(v_case.id)->'case'
    );
  END IF;

  IF v_case.row_version <> p_expected_row_version THEN
    RETURN jsonb_build_object(
      'kind', 'version_conflict',
      'case', public.solo_plus_case_bundle_payload_v1(v_case.id)->'case'
    );
  END IF;

  IF v_case.payment_status <> 'pending'
     OR v_case.payment_provider IS NOT NULL
     OR v_case.payment_reference IS NOT NULL
     OR v_case.payment_record_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'kind', 'state_conflict',
      'case', public.solo_plus_case_bundle_payload_v1(v_case.id)->'case'
    );
  END IF;

  UPDATE public.solo_plus_cases
  SET
    case_status = 'awaiting_payment',
    payment_status = 'pending',
    payment_provider = NULL,
    payment_reference = NULL,
    payment_record_id = NULL,
    row_version = row_version + 1,
    updated_at = now()
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
    policy_version
  )
  VALUES (
    p_case_id,
    'case_marked_awaiting_payment',
    jsonb_build_object(
      'caseStatus', 'draft',
      'paymentStatus', 'pending',
      'paymentProvider', NULL,
      'paymentReference', NULL,
      'paymentRecordId', NULL,
      'rowVersion', p_expected_row_version
    ),
    jsonb_build_object(
      'caseStatus', 'awaiting_payment',
      'paymentStatus', 'pending',
      'paymentProvider', NULL,
      'paymentReference', NULL,
      'paymentRecordId', NULL,
      'rowVersion', v_case.row_version
    ),
    p_actor_type,
    p_actor_id,
    p_request_idempotency_key,
    'Solo Plus case moved to awaiting payment.',
    v_case.requirements_policy_version
  )
  RETURNING * INTO v_inserted_event;

  RETURN jsonb_build_object(
    'kind', 'updated',
    'case', public.solo_plus_case_bundle_payload_v1(v_case.id)->'case',
    'event', to_jsonb(v_inserted_event)
  );
EXCEPTION
  WHEN unique_violation THEN
    SELECT *
    INTO v_existing_event
    FROM public.solo_plus_case_events
    WHERE case_id = p_case_id
      AND event_type = 'case_marked_awaiting_payment'
      AND request_idempotency_key = p_request_idempotency_key
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    IF FOUND THEN
      SELECT *
      INTO v_case
      FROM public.solo_plus_cases
      WHERE id = p_case_id;

      RETURN jsonb_build_object(
        'kind', 'idempotent_replay',
        'case', public.solo_plus_case_bundle_payload_v1(v_case.id)->'case',
        'event', to_jsonb(v_existing_event)
      );
    END IF;

    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.solo_plus_contains_prohibited_key_v1(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.solo_plus_assert_safe_snapshot_v1(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.solo_plus_assert_amount_v1(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.solo_plus_case_bundle_payload_v1(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_solo_plus_case_bundle_v1(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_solo_plus_onboarding_merchant_v1(UUID, UUID, UUID, INTEGER, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_solo_plus_case_awaiting_payment_v1(UUID, INTEGER, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.solo_plus_contains_prohibited_key_v1(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.solo_plus_assert_safe_snapshot_v1(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.solo_plus_assert_amount_v1(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.solo_plus_case_bundle_payload_v1(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_solo_plus_case_bundle_v1(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_solo_plus_onboarding_merchant_v1(UUID, UUID, UUID, INTEGER, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_solo_plus_case_awaiting_payment_v1(UUID, INTEGER, TEXT, TEXT, UUID) TO service_role;
