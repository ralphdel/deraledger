-- ============================================================
-- Solo Plus controlled payment recovery
-- Atomic supersede-and-create for unrecoverable unpaid attempts.
-- ============================================================

CREATE OR REPLACE FUNCTION public.recover_solo_plus_payment_attempt_v1(
  p_old_payment_record_id UUID,
  p_case_id UUID,
  p_merchant_id UUID,
  p_recovery_idempotency_key TEXT,
  p_provider_verification_category TEXT,
  p_recovery_reason TEXT,
  p_new_provider_name TEXT,
  p_new_payment_method TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old public.payment_records%ROWTYPE;
  v_case public.solo_plus_cases%ROWTYPE;
  v_existing_replacement public.payment_records%ROWTYPE;
  v_new public.payment_records%ROWTYPE;
  v_new_id UUID;
  v_new_reference TEXT;
  v_completion_mode TEXT;
  v_now TIMESTAMPTZ := now();
  v_old_metadata JSONB;
  v_new_metadata JSONB;
  v_existing_replacement_id UUID;
BEGIN
  IF p_old_payment_record_id IS NULL OR p_case_id IS NULL OR p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Solo Plus payment recovery requires payment, case, and merchant identifiers.';
  END IF;

  IF p_recovery_idempotency_key IS NULL OR btrim(p_recovery_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Solo Plus payment recovery requires a recovery idempotency key.';
  END IF;

  IF p_provider_verification_category IS DISTINCT FROM 'unpaid_unrecoverable' THEN
    RAISE EXCEPTION 'Solo Plus payment recovery is allowed only after unpaid unrecoverable provider verification.';
  END IF;

  IF p_new_provider_name NOT IN ('paystack', 'monnify') THEN
    RAISE EXCEPTION 'Solo Plus payment recovery supports only paystack or monnify replacements.';
  END IF;

  IF p_new_payment_method NOT IN ('card', 'bank_transfer', 'ussd') THEN
    RAISE EXCEPTION 'Solo Plus payment recovery supports only card, bank_transfer, or ussd.';
  END IF;

  SELECT *
  INTO v_old
  FROM public.payment_records
  WHERE id = p_old_payment_record_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solo Plus payment recovery could not find the original payment record.';
  END IF;

  IF v_old.merchant_id IS DISTINCT FROM p_merchant_id THEN
    RAISE EXCEPTION 'Solo Plus payment recovery merchant mismatch.';
  END IF;

  IF v_old.solo_plus_case_id IS DISTINCT FROM p_case_id THEN
    RAISE EXCEPTION 'Solo Plus payment recovery case mismatch.';
  END IF;

  IF v_old.payment_purpose NOT IN ('plan_upgrade', 'plan_subscription') THEN
    RAISE EXCEPTION 'Solo Plus payment recovery supports only subscription or upgrade attempts.';
  END IF;

  SELECT *
  INTO v_case
  FROM public.solo_plus_cases
  WHERE id = p_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solo Plus payment recovery case was not found.';
  END IF;

  IF v_case.merchant_id IS DISTINCT FROM p_merchant_id THEN
    RAISE EXCEPTION 'Solo Plus payment recovery case ownership mismatch.';
  END IF;

  IF v_case.flow_origin IS DISTINCT FROM 'upgrade' OR v_case.target_plan IS DISTINCT FROM 'solo_plus' THEN
    RAISE EXCEPTION 'Solo Plus payment recovery is available only for Solo Plus upgrade cases.';
  END IF;

  IF v_case.payment_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Solo Plus payment recovery requires a pending case payment state.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payment_records existing_success
    WHERE existing_success.solo_plus_case_id = p_case_id
      AND existing_success.payment_status = 'successful'
  ) THEN
    RAISE EXCEPTION 'Solo Plus payment recovery cannot supersede a case that already has a successful payment.';
  END IF;

  IF COALESCE(v_old.metadata -> 'payment_initialization' ->> 'status', '') = 'superseded' THEN
    IF COALESCE(v_old.metadata -> 'payment_recovery' ->> 'idempotencyKey', '') = p_recovery_idempotency_key THEN
      v_existing_replacement_id := NULLIF(v_old.metadata -> 'payment_recovery' ->> 'replacementPaymentRecordId', '')::uuid;

      IF v_existing_replacement_id IS NOT NULL THEN
        SELECT *
        INTO v_existing_replacement
        FROM public.payment_records
        WHERE id = v_existing_replacement_id;

        IF FOUND THEN
          RETURN jsonb_build_object(
            'kind', 'idempotent_replay',
            'old_payment', to_jsonb(v_old),
            'new_payment', to_jsonb(v_existing_replacement)
          );
        END IF;
      END IF;
    END IF;

    RAISE EXCEPTION 'Solo Plus payment recovery conflict: the current payment attempt was already superseded.';
  END IF;

  SELECT *
  INTO v_existing_replacement
  FROM public.payment_records
  WHERE solo_plus_case_id = p_case_id
    AND payment_status = 'pending'
    AND id <> v_old.id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF COALESCE(v_existing_replacement.metadata -> 'payment_recovery' ->> 'recoveryOfPaymentRecordId', '') = v_old.id::text
      AND COALESCE(v_existing_replacement.metadata -> 'payment_recovery' ->> 'idempotencyKey', '') = p_recovery_idempotency_key THEN
      RETURN jsonb_build_object(
        'kind', 'idempotent_replay',
        'old_payment', to_jsonb(v_old),
        'new_payment', to_jsonb(v_existing_replacement)
      );
    END IF;

    RAISE EXCEPTION 'Solo Plus payment recovery conflict: a newer active pending attempt already exists.';
  END IF;

  IF v_old.payment_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Solo Plus payment recovery requires the current payment attempt to remain pending.';
  END IF;

  v_new_id := gen_random_uuid();
  v_new_reference := format(
    '%s-%s',
    CASE
      WHEN v_old.payment_purpose = 'plan_subscription' THEN 'SPL-SUB'
      ELSE 'SPL-UPG'
    END,
    upper(replace(v_new_id::text, '-', ''))
  );
  v_completion_mode := CASE
    WHEN p_new_provider_name = 'paystack' THEN 'paystack_resume'
    WHEN p_new_provider_name = 'monnify' THEN 'hosted_checkout_redirect'
    ELSE NULL
  END;

  v_new_metadata := COALESCE(v_old.metadata, '{}'::jsonb);
  v_new_metadata := jsonb_set(
    v_new_metadata,
    '{payment_initialization}',
    jsonb_build_object(
      'status', 'created',
      'provider', p_new_provider_name,
      'completionMode', v_completion_mode,
      'providerReference', v_new_reference,
      'authorizationUrl', NULL,
      'accessCode', NULL,
      'checkoutUrl', NULL,
      'providerTransactionReference', NULL,
      'failureCode', NULL,
      'failureMessage', NULL,
      'initializedAt', NULL,
      'lastUpdatedAt', v_now
    ),
    true
  );
  v_new_metadata := jsonb_set(
    v_new_metadata,
    '{payment_recovery}',
    jsonb_build_object(
      'recoveryOfPaymentRecordId', v_old.id::text,
      'replacementPaymentRecordId', NULL,
      'idempotencyKey', p_recovery_idempotency_key,
      'recoveryCategory', p_provider_verification_category,
      'recoveryReason', p_recovery_reason,
      'recoveredAt', v_now,
      'supersededAt', NULL
    ),
    true
  );

  v_old_metadata := COALESCE(v_old.metadata, '{}'::jsonb);
  v_old_metadata := jsonb_set(
    v_old_metadata,
    '{payment_initialization}',
    jsonb_build_object(
      'status', 'superseded',
      'provider', v_old.provider_name,
      'completionMode', COALESCE(v_old.metadata -> 'payment_initialization' ->> 'completionMode', v_completion_mode),
      'providerReference', COALESCE(v_old.provider_reference, v_old.internal_reference),
      'authorizationUrl', NULL,
      'accessCode', NULL,
      'checkoutUrl', NULL,
      'providerTransactionReference', NULL,
      'failureCode', 'recovery_superseded',
      'failureMessage', p_recovery_reason,
      'initializedAt', COALESCE(v_old.metadata -> 'payment_initialization' -> 'initializedAt', 'null'::jsonb),
      'lastUpdatedAt', v_now
    ),
    true
  );
  v_old_metadata := jsonb_set(
    v_old_metadata,
    '{payment_recovery}',
    jsonb_build_object(
      'recoveryOfPaymentRecordId', NULL,
      'replacementPaymentRecordId', v_new_id::text,
      'idempotencyKey', p_recovery_idempotency_key,
      'recoveryCategory', p_provider_verification_category,
      'recoveryReason', p_recovery_reason,
      'recoveredAt', v_now,
      'supersededAt', v_now
    ),
    true
  );

  -- The old attempt must leave the pending-case partial unique index before
  -- the replacement pending attempt is inserted.
  UPDATE public.payment_records
  SET
    payment_status = 'abandoned',
    processing_status = 'failed',
    account_setup_status = 'failed',
    metadata = v_old_metadata,
    failure_reason = p_recovery_reason,
    updated_at = v_now
  WHERE id = v_old.id
  RETURNING *
  INTO v_old;

  INSERT INTO public.payment_records (
    id,
    user_id,
    merchant_id,
    onboarding_session_id,
    solo_plus_case_id,
    business_id,
    payment_purpose,
    payment_method,
    provider_name,
    internal_reference,
    provider_reference,
    amount_paid,
    expected_amount,
    currency,
    payment_status,
    processing_status,
    account_setup_status,
    password_setup_required,
    customer_email,
    plan_id,
    plan_name,
    metadata,
    expires_at,
    settlement_destination_source,
    reconciliation_status,
    raw_provider_payload,
    failure_reason
  )
  VALUES (
    v_new_id,
    v_old.user_id,
    v_old.merchant_id,
    v_old.onboarding_session_id,
    v_old.solo_plus_case_id,
    v_old.business_id,
    v_old.payment_purpose,
    p_new_payment_method,
    p_new_provider_name,
    v_new_reference,
    v_new_reference,
    0,
    v_old.expected_amount,
    COALESCE(v_old.currency, 'NGN'),
    'pending',
    'pending_payment',
    'pending_payment',
    COALESCE(v_old.password_setup_required, false),
    v_old.customer_email,
    v_old.plan_id,
    v_old.plan_name,
    v_new_metadata,
    v_old.expires_at,
    CASE WHEN p_new_provider_name = 'breet' THEN 'per_address_api' ELSE 'provider_dashboard' END,
    'pending_reconciliation',
    COALESCE(v_old.raw_provider_payload, '{}'::jsonb),
    NULL
  )
  RETURNING *
  INTO v_new;

  UPDATE public.solo_plus_cases
  SET
    payment_record_id = v_new.id,
    payment_provider = p_new_provider_name,
    payment_reference = v_new_reference,
    row_version = row_version + 1,
    updated_at = v_now
  WHERE id = v_case.id;

  RETURN jsonb_build_object(
    'kind', 'applied',
    'old_payment', to_jsonb(v_old),
    'new_payment', to_jsonb(v_new)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.recover_solo_plus_payment_attempt_v1(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_solo_plus_payment_attempt_v1(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
