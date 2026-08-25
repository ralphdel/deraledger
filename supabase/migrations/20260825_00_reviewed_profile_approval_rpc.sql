BEGIN;

DO $migration_026_prerequisites$
DECLARE
  v_table text;
  v_column text;
  v_expected_signature text :=
    'public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)';
BEGIN
  FOR v_table, v_column IN
    SELECT * FROM (VALUES
      ('merchant_compliance_profiles', 'id'),
      ('merchant_compliance_profiles', 'merchant_id'),
      ('merchant_compliance_profiles', 'plan_code'),
      ('merchant_compliance_profiles', 'compliance_status'),
      ('merchant_compliance_profiles', 'activation_status'),
      ('merchant_compliance_profiles', 'restriction_state'),
      ('merchant_compliance_profiles', 'restriction_reason_code'),
      ('merchant_compliance_profiles', 'decision_source_type'),
      ('merchant_compliance_profiles', 'decision_source_id'),
      ('merchant_compliance_profiles', 'decision_source_version'),
      ('merchant_compliance_profiles', 'last_reviewed_at'),
      ('merchant_compliance_profiles', 'reviewed_by'),
      ('merchant_compliance_profiles', 'policy_version'),
      ('merchant_compliance_profiles', 'row_version'),
      ('merchant_compliance_profiles', 'updated_at'),
      ('merchant_compliance_reviews', 'id'),
      ('merchant_compliance_reviews', 'merchant_id'),
      ('merchant_compliance_reviews', 'profile_id'),
      ('merchant_compliance_reviews', 'review_type'),
      ('merchant_compliance_reviews', 'target_plan_code'),
      ('merchant_compliance_reviews', 'review_status'),
      ('merchant_compliance_reviews', 'reviewed_at'),
      ('merchant_compliance_reviews', 'reviewed_by'),
      ('merchant_compliance_reviews', 'row_version'),
      ('merchant_compliance_events', 'id'),
      ('merchant_compliance_events', 'merchant_id'),
      ('merchant_compliance_events', 'profile_id'),
      ('merchant_compliance_events', 'event_type'),
      ('merchant_compliance_events', 'from_state'),
      ('merchant_compliance_events', 'to_state'),
      ('merchant_compliance_events', 'reason_code'),
      ('merchant_compliance_events', 'actor_type'),
      ('merchant_compliance_events', 'actor_id'),
      ('merchant_compliance_events', 'source_type'),
      ('merchant_compliance_events', 'source_id'),
      ('merchant_compliance_events', 'policy_version'),
      ('merchant_compliance_events', 'idempotency_key'),
      ('merchant_compliance_events', 'expected_row_version'),
      ('merchant_compliance_events', 'resulting_row_version'),
      ('merchant_compliance_events', 'metadata'),
      ('solo_plus_cases', 'id'),
      ('solo_plus_cases', 'merchant_id'),
      ('solo_plus_cases', 'target_plan'),
      ('solo_plus_cases', 'case_status'),
      ('solo_plus_cases', 'requirements_policy_version'),
      ('solo_plus_cases', 'approved_at'),
      ('solo_plus_cases', 'approved_by_admin_id'),
      ('solo_plus_cases', 'rejected_at'),
      ('solo_plus_cases', 'rejected_by_admin_id'),
      ('solo_plus_cases', 'row_version')
    ) AS expected(table_name, column_name)
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL OR NOT EXISTS (
      SELECT 1
      FROM pg_attribute attribute
      WHERE attribute.attrelid = to_regclass(format('public.%I', v_table))
        AND attribute.attname = v_column
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    ) THEN
      RAISE EXCEPTION 'Migration 026 prerequisite missing: public.%.%', v_table, v_column;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_class relation
    WHERE relation.oid IN (
      'public.merchant_compliance_profiles'::regclass,
      'public.merchant_compliance_reviews'::regclass,
      'public.merchant_compliance_events'::regclass
    )
      AND (NOT relation.relrowsecurity OR relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'Migration 026 prerequisite failed: compliance table RLS state is incompatible';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policy policy_state
    WHERE policy_state.polrelid IN (
      'public.merchant_compliance_profiles'::regclass,
      'public.merchant_compliance_reviews'::regclass,
      'public.merchant_compliance_events'::regclass
    )
  ) THEN
    RAISE EXCEPTION 'Migration 026 prerequisite failed: compliance tables must retain zero browser policies';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants grant_state
    WHERE grant_state.table_schema = 'public'
      AND grant_state.table_name IN (
        'merchant_compliance_profiles',
        'merchant_compliance_reviews',
        'merchant_compliance_events'
      )
      AND grant_state.grantee IN ('PUBLIC', 'anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'Migration 026 prerequisite failed: browser/public compliance-table grant exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc procedure_state
    WHERE procedure_state.oid = to_regprocedure(
      'public.bootstrap_reviewed_profile_v1(uuid,uuid,text,text,text,text,text,uuid,uuid,timestamptz)'
    )
      AND NOT procedure_state.prosecdef
      AND procedure_state.proconfig @> ARRAY['search_path=pg_catalog, public']
  ) OR EXISTS (
    SELECT 1
    FROM information_schema.routine_privileges privilege_state
    WHERE privilege_state.routine_schema = 'public'
      AND privilege_state.routine_name = 'bootstrap_reviewed_profile_v1'
      AND privilege_state.grantee IN ('PUBLIC', 'anon', 'authenticated')
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.routine_privileges privilege_state
    WHERE privilege_state.routine_schema = 'public'
      AND privilege_state.routine_name = 'bootstrap_reviewed_profile_v1'
      AND privilege_state.grantee = 'service_role'
      AND privilege_state.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Migration 026 prerequisite failed: Migration 025 bootstrap RPC security manifest is incompatible';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc procedure_state
    JOIN pg_namespace namespace_state ON namespace_state.oid = procedure_state.pronamespace
    WHERE namespace_state.nspname = 'public'
      AND procedure_state.proname = 'review_compliance_profile_decision_v1'
      AND procedure_state.oid <> COALESCE(to_regprocedure(v_expected_signature)::oid, 0)
  ) THEN
    RAISE EXCEPTION 'Migration 026 prerequisite failed: unexpected review_compliance_profile_decision_v1 overload';
  END IF;
END;
$migration_026_prerequisites$;

CREATE OR REPLACE FUNCTION public.review_compliance_profile_decision_v1(
  p_merchant_id uuid,
  p_profile_id uuid,
  p_plan_code text,
  p_source_type text,
  p_source_id uuid,
  p_source_version bigint,
  p_target_compliance_status text,
  p_expected_profile_row_version bigint,
  p_reviewer_id uuid,
  p_decision_idempotency_key text,
  p_policy_version text,
  p_reviewed_at timestamptz,
  p_reason_code text
)
RETURNS TABLE(result_code text, profile_id uuid, event_id uuid, resulting_row_version bigint)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $review_compliance_profile_decision_v1$
DECLARE
  v_profile public.merchant_compliance_profiles%ROWTYPE;
  v_review public.merchant_compliance_reviews%ROWTYPE;
  v_case public.solo_plus_cases%ROWTYPE;
  v_event public.merchant_compliance_events%ROWTYPE;
  v_event_id uuid := gen_random_uuid();
  v_from_compliance_status text;
  v_target_activation_status text;
  v_target_restriction_state text;
  v_reason_code text;
  v_source_valid boolean := false;
BEGIN
  BEGIN
    IF p_merchant_id IS NULL OR p_profile_id IS NULL OR p_source_id IS NULL OR p_reviewer_id IS NULL
      OR p_reviewed_at IS NULL OR p_source_version IS NULL OR p_source_version <= 0
      OR p_expected_profile_row_version IS NULL OR p_expected_profile_row_version <= 0
      OR p_plan_code NOT IN ('solo_lite', 'solo_plus', 'business')
      OR p_source_type NOT IN ('solo_lite_review', 'solo_plus_case', 'business_kyb_review')
      OR p_target_compliance_status NOT IN (
        'lite_verified', 'enhanced_verified', 'business_verified', 'needs_attention', 'restricted', 'rejected'
      )
      OR p_decision_idempotency_key IS NULL OR length(btrim(p_decision_idempotency_key)) = 0
      OR p_policy_version IS NULL OR length(btrim(p_policy_version)) = 0 THEN
      RETURN QUERY SELECT 'approval_payload_invalid', NULL::uuid, NULL::uuid, NULL::bigint;
      RETURN;
    END IF;

    IF (p_plan_code = 'solo_lite' AND p_source_type <> 'solo_lite_review')
      OR (p_plan_code = 'solo_plus' AND p_source_type <> 'solo_plus_case')
      OR (p_plan_code = 'business' AND p_source_type <> 'business_kyb_review')
      OR (p_target_compliance_status IN ('lite_verified', 'enhanced_verified', 'business_verified')
        AND p_target_compliance_status <> CASE p_plan_code
          WHEN 'solo_lite' THEN 'lite_verified'
          WHEN 'solo_plus' THEN 'enhanced_verified'
          WHEN 'business' THEN 'business_verified'
        END)
      OR (p_target_compliance_status IN ('needs_attention', 'restricted', 'rejected')
        AND (NULLIF(btrim(COALESCE(p_reason_code, '')), '') IS NULL OR NULLIF(btrim(COALESCE(p_reason_code, '')), '') NOT IN (
          'evidence_incomplete', 'evidence_expired', 'evidence_mismatch', 'review_rejected',
          'reviewer_requested_correction', 'policy_restriction', 'risk_restricted', 'risk_suspended'
        ))) THEN
      RETURN QUERY SELECT 'approval_payload_invalid', NULL::uuid, NULL::uuid, NULL::bigint;
      RETURN;
    END IF;

    v_reason_code := NULLIF(btrim(COALESCE(p_reason_code, '')), '');
    v_target_activation_status := CASE
      WHEN p_target_compliance_status = 'restricted' AND v_reason_code = 'risk_suspended' THEN 'suspended'
      WHEN p_target_compliance_status = 'restricted' THEN 'restricted'
      ELSE 'test_mode'
    END;
    v_target_restriction_state := CASE
      WHEN p_target_compliance_status = 'restricted' AND v_reason_code = 'risk_suspended' THEN 'suspended'
      WHEN p_target_compliance_status = 'restricted' THEN 'restricted'
      ELSE NULL
    END;

    SELECT * INTO v_event
    FROM public.merchant_compliance_events
    WHERE merchant_id = p_merchant_id
      AND idempotency_key = btrim(p_decision_idempotency_key);

    IF FOUND THEN
      IF v_event.profile_id = p_profile_id
        AND v_event.event_type = 'compliance_profile_approval_v1'
        AND v_event.source_type = p_source_type
        AND v_event.source_id = p_source_id
        AND v_event.actor_id = p_reviewer_id
        AND v_event.policy_version = btrim(p_policy_version)
        AND v_event.reason_code IS NOT DISTINCT FROM v_reason_code
        AND v_event.expected_row_version = p_expected_profile_row_version
        AND v_event.resulting_row_version = p_expected_profile_row_version + 1
        AND v_event.from_state ->> 'compliance_status' IN ('lite_pending', 'enhanced_pending', 'business_pending', 'needs_attention')
        AND v_event.to_state ->> 'compliance_status' = p_target_compliance_status
        AND v_event.to_state ->> 'activation_status' = v_target_activation_status
        AND v_event.to_state ->> 'restriction_state' IS NOT DISTINCT FROM v_target_restriction_state
        AND v_event.to_state @> jsonb_build_object('merchant_entitlements', jsonb_build_object(
          'canCollectPayments', false,
          'canUseInstantSale', false,
          'canUseReceivableSale', false,
          'canUseStorefront', false,
          'canActivateSettlement', false,
          'canUseDepositBalance', false
        ))
        AND v_event.metadata ->> 'plan_code' = p_plan_code
        AND v_event.metadata ->> 'source_version' = p_source_version::text THEN
        RETURN QUERY SELECT 'approval_idempotent_replay', v_event.profile_id, v_event.id, v_event.resulting_row_version;
      ELSE
        RETURN QUERY SELECT 'approval_idempotency_conflict', NULL::uuid, NULL::uuid, NULL::bigint;
      END IF;
      RETURN;
    END IF;

    SELECT * INTO v_profile
    FROM public.merchant_compliance_profiles
    WHERE id = p_profile_id
      AND merchant_id = p_merchant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN QUERY SELECT 'approval_profile_missing', NULL::uuid, NULL::uuid, NULL::bigint;
      RETURN;
    END IF;

    IF v_profile.compliance_status IN ('lite_verified', 'enhanced_verified', 'business_verified', 'rejected', 'restricted')
      OR v_profile.restriction_state IN ('restricted', 'suspended')
      OR v_profile.activation_status = 'suspended' THEN
      RETURN QUERY SELECT 'approval_profile_preserved', v_profile.id, NULL::uuid, v_profile.row_version;
      RETURN;
    END IF;

    IF v_profile.plan_code IS DISTINCT FROM p_plan_code
      OR v_profile.row_version <> p_expected_profile_row_version
      OR v_profile.decision_source_type IS DISTINCT FROM p_source_type
      OR v_profile.decision_source_id IS DISTINCT FROM p_source_id
      OR v_profile.compliance_status NOT IN ('lite_pending', 'enhanced_pending', 'business_pending', 'needs_attention')
      OR (v_profile.compliance_status <> 'needs_attention' AND v_profile.compliance_status <> CASE p_plan_code
        WHEN 'solo_lite' THEN 'lite_pending'
        WHEN 'solo_plus' THEN 'enhanced_pending'
        WHEN 'business' THEN 'business_pending'
      END)
      OR v_profile.can_collect_payments
      OR v_profile.can_use_instant_sale
      OR v_profile.can_use_receivable_sale
      OR v_profile.can_use_storefront
      OR v_profile.can_activate_settlement
      OR v_profile.can_use_deposit_balance THEN
      RETURN QUERY SELECT 'approval_profile_state_invalid', NULL::uuid, NULL::uuid, NULL::bigint;
      RETURN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_reviewer_id) THEN
      RETURN QUERY SELECT 'approval_reviewer_invalid', NULL::uuid, NULL::uuid, NULL::bigint;
      RETURN;
    END IF;

    IF p_plan_code IN ('solo_lite', 'business') THEN
      SELECT * INTO v_review
      FROM public.merchant_compliance_reviews
      WHERE id = p_source_id
        AND merchant_id = p_merchant_id
        AND profile_id = v_profile.id
      FOR UPDATE;

      v_source_valid := COALESCE(FOUND
        AND v_review.review_type = CASE WHEN p_plan_code = 'solo_lite' THEN 'solo_lite' ELSE 'business_kyb' END
        AND v_review.target_plan_code = p_plan_code
        AND v_review.review_status IN ('pending', 'needs_attention')
        AND v_review.row_version = p_source_version
        , false);
    ELSE
      SELECT * INTO v_case
      FROM public.solo_plus_cases
      WHERE id = p_source_id
        AND merchant_id = p_merchant_id
      FOR UPDATE;

      v_source_valid := COALESCE(FOUND
        AND v_case.target_plan = 'solo_plus'
        AND v_case.row_version::bigint = p_source_version
        AND v_case.requirements_policy_version = btrim(p_policy_version)
        AND (
          (p_target_compliance_status IN ('enhanced_verified', 'restricted')
            AND v_case.case_status = 'approved'
            AND v_case.approved_at = p_reviewed_at
            AND v_case.approved_by_admin_id = p_reviewer_id)
          OR (p_target_compliance_status = 'rejected'
            AND v_case.case_status = 'rejected'
            AND v_case.rejected_at = p_reviewed_at
            AND v_case.rejected_by_admin_id = p_reviewer_id)
          OR (p_target_compliance_status = 'needs_attention'
            AND v_case.case_status IN ('verification_pending', 'manual_review'))
        ), false);
    END IF;

    IF NOT v_source_valid THEN
      RETURN QUERY SELECT 'approval_source_invalid', NULL::uuid, NULL::uuid, NULL::bigint;
      RETURN;
    END IF;

    v_from_compliance_status := v_profile.compliance_status;

    UPDATE public.merchant_compliance_profiles
    SET compliance_status = p_target_compliance_status,
        activation_status = v_target_activation_status,
        restriction_state = v_target_restriction_state,
        restriction_reason_code = CASE WHEN p_target_compliance_status = 'restricted' THEN v_reason_code ELSE NULL END,
        restriction_effective_at = CASE WHEN p_target_compliance_status = 'restricted' THEN p_reviewed_at ELSE NULL END,
        decision_source_type = p_source_type,
        decision_source_id = p_source_id,
        decision_source_version = p_source_version,
        last_reviewed_at = p_reviewed_at,
        reviewed_by = p_reviewer_id,
        policy_version = btrim(p_policy_version),
        row_version = v_profile.row_version + 1,
        updated_at = now()
    WHERE id = v_profile.id
      AND merchant_id = p_merchant_id
      AND row_version = p_expected_profile_row_version
    RETURNING * INTO v_profile;

    IF NOT FOUND THEN
      RETURN QUERY SELECT 'approval_row_version_conflict', NULL::uuid, NULL::uuid, NULL::bigint;
      RETURN;
    END IF;

    INSERT INTO public.merchant_compliance_events (
      id, merchant_id, profile_id, event_type, from_state, to_state, reason_code, actor_type, actor_id,
      source_type, source_id, policy_version, idempotency_key, expected_row_version, resulting_row_version, metadata
    ) VALUES (
      v_event_id, p_merchant_id, v_profile.id, 'compliance_profile_approval_v1',
      jsonb_build_object('compliance_status', v_from_compliance_status),
      jsonb_build_object(
        'compliance_status', v_profile.compliance_status,
        'activation_status', v_profile.activation_status,
        'restriction_state', v_profile.restriction_state,
        'merchant_entitlements', jsonb_build_object(
          'canCollectPayments', false,
          'canUseInstantSale', false,
          'canUseReceivableSale', false,
          'canUseStorefront', false,
          'canActivateSettlement', false,
          'canUseDepositBalance', false
        )
      ),
      v_reason_code, 'admin', p_reviewer_id,
      p_source_type, p_source_id, btrim(p_policy_version), btrim(p_decision_idempotency_key),
      p_expected_profile_row_version, v_profile.row_version,
      jsonb_build_object(
        'transition', 'reviewed_profile_approval',
        'plan_code', p_plan_code,
        'source_version', p_source_version
      )
    );

    RETURN QUERY SELECT 'approval_applied', v_profile.id, v_event_id, v_profile.row_version;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'approval_atomic_write_failed', NULL::uuid, NULL::uuid, NULL::bigint;
  END;
END;
$review_compliance_profile_decision_v1$;

REVOKE ALL ON FUNCTION public.review_compliance_profile_decision_v1(
  uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.review_compliance_profile_decision_v1(
  uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text
) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
