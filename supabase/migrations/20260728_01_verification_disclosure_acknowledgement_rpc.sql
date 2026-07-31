-- ============================================================
-- Verification disclosure acknowledgement RPC
-- Atomically records disclosure acceptance and merchant summary.
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_verification_disclosure_acceptance_v1(
  p_user_id UUID,
  p_merchant_id UUID,
  p_onboarding_session_id UUID,
  p_plan_type TEXT,
  p_context TEXT,
  p_disclosure_version TEXT,
  p_ip_address TEXT,
  p_user_agent TEXT,
  p_device_metadata JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan_type TEXT := NULLIF(btrim(COALESCE(p_plan_type, '')), '');
  v_context TEXT := NULLIF(btrim(COALESCE(p_context, '')), '');
  v_disclosure_version TEXT := NULLIF(btrim(COALESCE(p_disclosure_version, '')), '');
  v_device_metadata JSONB := COALESCE(p_device_metadata, '{}'::jsonb);
  v_now TIMESTAMPTZ := now();
  v_merchant public.merchants%ROWTYPE;
  v_session_id UUID;
  v_existing public.verification_disclosures%ROWTYPE;
  v_created public.verification_disclosures%ROWTYPE;
BEGIN
  IF v_plan_type IS NULL
     OR v_context IS NULL
     OR v_disclosure_version IS NULL
     OR v_context NOT IN ('onboarding', 'upgrade', 'renewal')
     OR jsonb_typeof(v_device_metadata) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('kind', 'invalid_input');
  END IF;

  IF p_merchant_id IS NULL AND p_onboarding_session_id IS NULL THEN
    RETURN jsonb_build_object('kind', 'invalid_input');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'verification-disclosure:' ||
      COALESCE(p_merchant_id::text, 'no-merchant') || ':' ||
      COALESCE(p_onboarding_session_id::text, 'no-session') || ':' ||
      COALESCE(p_user_id::text, 'no-user') || ':' ||
      v_plan_type || ':' ||
      v_context || ':' ||
      v_disclosure_version,
      0
    )
  );

  IF p_merchant_id IS NOT NULL THEN
    SELECT *
    INTO v_merchant
    FROM public.merchants
    WHERE id = p_merchant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('kind', 'merchant_not_found');
    END IF;

    IF p_user_id IS NOT NULL
       AND v_merchant.user_id IS NOT NULL
       AND v_merchant.user_id IS DISTINCT FROM p_user_id THEN
      RETURN jsonb_build_object('kind', 'merchant_user_mismatch');
    END IF;

    IF v_merchant.verification_disclosure_version IS NOT NULL
       AND v_merchant.verification_disclosure_version IS DISTINCT FROM v_disclosure_version THEN
      RETURN jsonb_build_object(
        'kind', 'version_conflict',
        'currentVersion', v_merchant.verification_disclosure_version,
        'requestedVersion', v_disclosure_version
      );
    END IF;
  ELSIF p_onboarding_session_id IS NOT NULL THEN
    SELECT os.id
    INTO v_session_id
    FROM public.onboarding_sessions os
    WHERE os.id = p_onboarding_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('kind', 'onboarding_session_not_found');
    END IF;
  END IF;

  IF p_onboarding_session_id IS NOT NULL THEN
    SELECT *
    INTO v_existing
    FROM public.verification_disclosures
    WHERE onboarding_session_id = p_onboarding_session_id
      AND plan_type = v_plan_type
      AND context = v_context
      AND disclosure_version = v_disclosure_version
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE;
  ELSE
    SELECT *
    INTO v_existing
    FROM public.verification_disclosures
    WHERE merchant_id = p_merchant_id
      AND user_id IS NOT DISTINCT FROM p_user_id
      AND plan_type = v_plan_type
      AND context = v_context
      AND disclosure_version = v_disclosure_version
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF FOUND THEN
    IF p_merchant_id IS NOT NULL THEN
      UPDATE public.merchants
      SET
        verification_disclosure_acknowledged_at =
          COALESCE(public.merchants.verification_disclosure_acknowledged_at, v_existing.acknowledged_at),
        verification_disclosure_version = v_disclosure_version
      WHERE id = p_merchant_id;
    END IF;

    RETURN jsonb_build_object(
      'kind', 'replayed',
      'disclosureId', v_existing.id,
      'acknowledgedAt', v_existing.acknowledged_at
    );
  END IF;

  INSERT INTO public.verification_disclosures (
    user_id,
    merchant_id,
    onboarding_session_id,
    plan_type,
    context,
    disclosure_version,
    acknowledged_at,
    ip_address,
    user_agent,
    device_metadata
  )
  VALUES (
    p_user_id,
    p_merchant_id,
    p_onboarding_session_id,
    v_plan_type,
    v_context,
    v_disclosure_version,
    v_now,
    NULLIF(btrim(COALESCE(p_ip_address, '')), ''),
    NULLIF(btrim(COALESCE(p_user_agent, '')), ''),
    v_device_metadata
  )
  RETURNING *
  INTO v_created;

  IF p_merchant_id IS NOT NULL THEN
    UPDATE public.merchants
    SET
      verification_disclosure_acknowledged_at = v_created.acknowledged_at,
      verification_disclosure_version = v_disclosure_version
    WHERE id = p_merchant_id;
  END IF;

  RETURN jsonb_build_object(
    'kind', 'created',
    'disclosureId', v_created.id,
    'acknowledgedAt', v_created.acknowledged_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_verification_disclosure_acceptance_v1(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_verification_disclosure_acceptance_v1(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
