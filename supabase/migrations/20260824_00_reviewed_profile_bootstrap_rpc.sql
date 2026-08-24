BEGIN;

DO $preflight$
DECLARE
  v_table text;
  v_column text;
BEGIN
  FOR v_table, v_column IN
    SELECT * FROM (VALUES
      ('merchant_compliance_profiles','merchant_id'),
      ('merchant_compliance_profiles','plan_code'),
      ('merchant_compliance_profiles','compliance_status'),
      ('merchant_compliance_profiles','activation_status'),
      ('merchant_compliance_profiles','restriction_state'),
      ('merchant_compliance_reviews','merchant_id'),
      ('merchant_compliance_reviews','profile_id'),
      ('merchant_compliance_reviews','idempotency_key'),
      ('merchant_compliance_events','merchant_id'),
      ('merchant_compliance_events','profile_id'),
      ('merchant_compliance_events','idempotency_key'),
      ('solo_plus_cases','id'),
      ('solo_plus_cases','merchant_id')
    ) AS expected(table_name, column_name)
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = to_regclass(format('public.%I', v_table))
        AND attname = v_column AND attnum > 0 AND NOT attisdropped
    ) THEN
      RAISE EXCEPTION 'Migration 025 prerequisite missing: public.%.%', v_table, v_column;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.oid IN (
      'public.merchant_compliance_profiles'::regclass,
      'public.merchant_compliance_reviews'::regclass,
      'public.merchant_compliance_events'::regclass
    ) AND (NOT c.relrowsecurity OR c.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'Migration 025 prerequisite failed: compliance table RLS state is incompatible';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public'
      AND g.table_name IN ('merchant_compliance_profiles','merchant_compliance_reviews','merchant_compliance_events')
      AND g.grantee IN ('PUBLIC','anon','authenticated')
  ) THEN
    RAISE EXCEPTION 'Migration 025 prerequisite failed: browser/public compliance-table grant exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'bootstrap_reviewed_profile_v1'
      AND p.oid <> COALESCE(to_regprocedure('public.bootstrap_reviewed_profile_v1(uuid,uuid,text,text,text,text,text,uuid,uuid,timestamptz)')::oid, 0)
  ) THEN
    RAISE EXCEPTION 'Migration 025 prerequisite failed: unexpected bootstrap_reviewed_profile_v1 overload';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.bootstrap_reviewed_profile_v1(
  p_merchant_id uuid,
  p_workspace_id uuid,
  p_plan_code text,
  p_compliance_status text,
  p_activation_status text,
  p_restriction_state text,
  p_bootstrap_key text,
  p_review_source_id uuid,
  p_reviewed_by uuid,
  p_reviewed_at timestamptz
)
RETURNS TABLE(result_code text, profile_id uuid, review_id uuid, event_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $bootstrap_reviewed_profile_v1$
DECLARE
  v_profile public.merchant_compliance_profiles%ROWTYPE;
  v_profile_id uuid := gen_random_uuid();
  v_review_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_source_type text;
  v_source_id uuid;
  v_review_status text;
  v_count integer;
BEGIN
  IF p_merchant_id IS NULL OR p_workspace_id IS NULL OR p_reviewed_by IS NULL
    OR p_review_source_id IS NULL OR p_reviewed_at IS NULL
    OR p_bootstrap_key IS NULL OR length(btrim(p_bootstrap_key)) = 0 THEN
    RETURN QUERY SELECT 'bootstrap_payload_invalid', NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  IF p_plan_code NOT IN ('solo_lite','solo_plus','business')
    OR (p_plan_code = 'solo_lite' AND p_compliance_status <> 'lite_pending')
    OR (p_plan_code = 'solo_plus' AND p_compliance_status <> 'enhanced_pending')
    OR (p_plan_code = 'business' AND p_compliance_status <> 'business_pending')
    OR p_activation_status NOT IN ('test_mode','restricted','suspended')
    OR p_restriction_state = 'active'
    OR (p_activation_status = 'test_mode' AND p_restriction_state IS NOT NULL)
    OR (p_activation_status = 'restricted' AND p_restriction_state <> 'restricted')
    OR (p_activation_status = 'suspended' AND p_restriction_state <> 'suspended') THEN
    RETURN QUERY SELECT 'bootstrap_payload_invalid', NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  SELECT count(*) INTO v_count FROM public.merchant_compliance_events
  WHERE merchant_id = p_merchant_id AND idempotency_key = p_bootstrap_key || ':bootstrap';
  IF v_count > 1 THEN RETURN QUERY SELECT 'bootstrap_event_ambiguous', NULL::uuid, NULL::uuid, NULL::uuid; RETURN; END IF;
  IF v_count = 1 THEN
    SELECT e.profile_id, NULL::uuid, e.id INTO profile_id, review_id, event_id
    FROM public.merchant_compliance_events e
    WHERE e.merchant_id = p_merchant_id AND e.idempotency_key = p_bootstrap_key || ':bootstrap';
    result_code := 'bootstrap_existing_result'; RETURN NEXT; RETURN;
  END IF;

  IF p_plan_code IN ('solo_lite','business') THEN
    SELECT count(*) INTO v_count FROM public.merchant_compliance_reviews
    WHERE merchant_id = p_merchant_id AND idempotency_key = p_bootstrap_key;
    IF v_count > 1 THEN RETURN QUERY SELECT 'bootstrap_review_ambiguous', NULL::uuid, NULL::uuid, NULL::uuid; RETURN; END IF;
    IF v_count = 1 THEN
      SELECT r.profile_id, r.id, NULL::uuid INTO profile_id, review_id, event_id
      FROM public.merchant_compliance_reviews r WHERE r.merchant_id = p_merchant_id AND r.idempotency_key = p_bootstrap_key;
      result_code := 'bootstrap_existing_result'; RETURN NEXT; RETURN;
    END IF;
  END IF;

  SELECT count(*) INTO v_count FROM public.merchant_compliance_profiles WHERE merchant_id = p_merchant_id;
  IF v_count > 1 THEN RETURN QUERY SELECT 'bootstrap_profile_ambiguous', NULL::uuid, NULL::uuid, NULL::uuid; RETURN; END IF;
  IF v_count = 1 THEN
    SELECT * INTO v_profile FROM public.merchant_compliance_profiles WHERE merchant_id = p_merchant_id FOR UPDATE;
    IF v_profile.compliance_status IN ('lite_verified','enhanced_verified','business_verified','rejected','restricted')
      OR v_profile.restriction_state IN ('restricted','suspended') THEN
      RETURN QUERY SELECT 'bootstrap_profile_preserved', v_profile.id, NULL::uuid, NULL::uuid; RETURN;
    END IF;
    RETURN QUERY SELECT 'bootstrap_profile_ambiguous', NULL::uuid, NULL::uuid, NULL::uuid; RETURN;
  END IF;

  IF p_plan_code = 'solo_plus' THEN
    PERFORM 1 FROM public.solo_plus_cases WHERE id = p_review_source_id AND merchant_id = p_merchant_id;
    IF NOT FOUND THEN RETURN QUERY SELECT 'bootstrap_source_invalid', NULL::uuid, NULL::uuid, NULL::uuid; RETURN; END IF;
    v_source_type := 'solo_plus_case'; v_source_id := p_review_source_id; v_review_id := NULL;
  ELSIF p_plan_code = 'business' THEN
    v_source_type := 'business_kyb_review'; v_source_id := v_review_id;
  ELSE
    v_source_type := 'solo_lite_review'; v_source_id := v_review_id;
  END IF;

  INSERT INTO public.merchant_compliance_profiles (
    id, merchant_id, plan_code, compliance_status, activation_status, restriction_state,
    can_collect_payments, can_use_instant_sale, can_use_receivable_sale, can_use_storefront,
    can_activate_settlement, can_use_deposit_balance, decision_source_type, decision_source_id,
    last_reviewed_at, reviewed_by
  ) VALUES (
    v_profile_id, p_merchant_id, p_plan_code, p_compliance_status, p_activation_status, p_restriction_state,
    false, false, false, false, false, false, v_source_type, v_source_id, p_reviewed_at, p_reviewed_by
  );

  IF p_plan_code IN ('solo_lite','business') THEN
    v_review_status := CASE WHEN p_activation_status = 'test_mode' THEN 'pending' ELSE 'needs_attention' END;
    INSERT INTO public.merchant_compliance_reviews (
      id, merchant_id, profile_id, review_type, target_plan_code, review_status,
      evidence_snapshot, reviewed_at, reviewed_by, idempotency_key
    ) VALUES (
      v_review_id, p_merchant_id, v_profile_id,
      CASE WHEN p_plan_code = 'business' THEN 'business_kyb' ELSE 'solo_lite' END,
      p_plan_code, v_review_status, jsonb_build_object('source','reviewed_profile_bootstrap'),
      p_reviewed_at, p_reviewed_by, p_bootstrap_key
    );
  END IF;

  INSERT INTO public.merchant_compliance_events (
    id, merchant_id, profile_id, event_type, from_state, to_state, actor_type, actor_id,
    source_type, source_id, idempotency_key, resulting_row_version, metadata
  ) VALUES (
    v_event_id, p_merchant_id, v_profile_id, 'reviewed_profile_bootstrap_v1', '{}'::jsonb,
    jsonb_build_object('compliance_status',p_compliance_status,'activation_status',p_activation_status,'restriction_state',p_restriction_state,
      'merchant_entitlements',jsonb_build_object('canCollectPayments',false,'canUseInstantSale',false,'canUseReceivableSale',false,'canUseStorefront',false,'canActivateSettlement',false,'canUseDepositBalance',false)),
    'admin', p_reviewed_by, v_source_type, v_source_id, p_bootstrap_key || ':bootstrap', 1,
    jsonb_build_object('source','reviewed_profile_bootstrap')
  );
  RETURN QUERY SELECT 'bootstrap_created', v_profile_id, v_review_id, v_event_id;
END;
$bootstrap_reviewed_profile_v1$;

REVOKE ALL ON FUNCTION public.bootstrap_reviewed_profile_v1(uuid,uuid,text,text,text,text,text,uuid,uuid,timestamptz) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bootstrap_reviewed_profile_v1(uuid,uuid,text,text,text,text,text,uuid,uuid,timestamptz) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
