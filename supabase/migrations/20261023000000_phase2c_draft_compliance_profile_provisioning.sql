BEGIN;

-- Rollback boundary: before first use, this additive slice can be disabled by
-- revoking/dropping only this RPC. After any successful provisioning call,
-- created canonical profiles are business records and must be preserved;
-- remediation is forward-fix only and must never delete or downgrade them.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $phase2c_b4p_prerequisites$
DECLARE
  v_relation text;
  v_column record;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'public.merchants',
    'public.subscriptions',
    'public.workspaces',
    'public.merchant_canonical_workspaces',
    'public.merchant_compliance_profiles',
    'public.merchant_compliance_reviews',
    'public.merchant_compliance_events'
  ]
  LOOP
    IF to_regclass(v_relation) IS NULL THEN
      RAISE EXCEPTION 'B4P prerequisite failed: required relation % is unavailable', v_relation;
    END IF;
  END LOOP;

  FOR v_column IN
    SELECT * FROM (VALUES
      ('public.merchants'::text, 'id'::text),
      ('public.merchants', 'user_id'),
      ('public.merchants', 'subscription_plan'),
      ('public.subscriptions', 'merchant_id'),
      ('public.subscriptions', 'plan_type'),
      ('public.subscriptions', 'status'),
      ('public.merchant_canonical_workspaces', 'merchant_id'),
      ('public.merchant_canonical_workspaces', 'workspace_id'),
      ('public.workspaces', 'id'),
      ('public.workspaces', 'merchant_id'),
      ('public.merchant_compliance_profiles', 'merchant_id'),
      ('public.merchant_compliance_profiles', 'plan_code'),
      ('public.merchant_compliance_profiles', 'compliance_status'),
      ('public.merchant_compliance_profiles', 'activation_status'),
      ('public.merchant_compliance_profiles', 'row_version')
    ) AS required(relation_name, column_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_attribute a
      WHERE a.attrelid = to_regclass(v_column.relation_name)
        AND a.attname = v_column.column_name
        AND a.attnum > 0
        AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION 'B4P prerequisite failed: required column %.% is unavailable',
        v_column.relation_name, v_column.column_name;
    END IF;
  END LOOP;

  IF to_regrole('service_role') IS NULL
    OR to_regrole('anon') IS NULL
    OR to_regrole('authenticated') IS NULL THEN
    RAISE EXCEPTION 'B4P prerequisite failed: service_role is unavailable';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.merchants', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.merchants', 'UPDATE')
    OR NOT has_table_privilege('service_role', 'public.subscriptions', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.subscriptions', 'UPDATE')
    OR NOT has_table_privilege('service_role', 'public.workspaces', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.merchant_canonical_workspaces', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.merchant_compliance_profiles', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.merchant_compliance_profiles', 'INSERT')
    OR NOT has_table_privilege('service_role', 'public.merchant_compliance_profiles', 'UPDATE')
    OR NOT has_table_privilege('service_role', 'public.merchant_compliance_reviews', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.merchant_compliance_events', 'SELECT') THEN
    RAISE EXCEPTION 'B4P prerequisite failed: service-role table privileges are incompatible';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'ensure_draft_compliance_profile_v1'
      AND p.oid <> COALESCE(
        to_regprocedure('public.ensure_draft_compliance_profile_v1(uuid)')::oid,
        0::oid
      )
  ) THEN
    RAISE EXCEPTION 'B4P prerequisite failed: unexpected ensure RPC overload exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.merchant_compliance_profiles'::regclass
      AND c.conname = 'uq_merchant_compliance_profiles_merchant_id'
      AND c.contype = 'u'::"char"
      AND c.convalidated
  ) THEN
    RAISE EXCEPTION 'B4P prerequisite failed: one-profile-per-merchant constraint is unavailable';
  END IF;
END;
$phase2c_b4p_prerequisites$;

CREATE OR REPLACE FUNCTION public.ensure_draft_compliance_profile_v1(
  p_merchant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_merchant public.merchants%ROWTYPE;
  v_subscription public.subscriptions%ROWTYPE;
  v_profile public.merchant_compliance_profiles%ROWTYPE;
  v_plan text;
  v_subscription_plan text;
  v_workspace_id uuid;
  v_workspace_owner uuid;
  v_created boolean := false;
  v_has_review boolean := false;
  v_has_event boolean := false;
BEGIN
  IF p_merchant_id IS NULL THEN
    RETURN jsonb_build_object('kind', 'draft_profile_state_incompatible');
  END IF;

  SELECT m.*
  INTO v_merchant
  FROM public.merchants m
  WHERE m.id = p_merchant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'kind', 'draft_profile_merchant_missing',
      'merchant_id', p_merchant_id
    );
  END IF;

  IF v_merchant.user_id IS NULL THEN
    RETURN jsonb_build_object(
      'kind', 'draft_profile_owner_required',
      'merchant_id', p_merchant_id
    );
  END IF;

  v_plan := CASE lower(btrim(COALESCE(v_merchant.subscription_plan, '')))
    WHEN 'individual' THEN 'solo_lite'
    WHEN 'solo_lite' THEN 'solo_lite'
    WHEN 'corporate' THEN 'business'
    WHEN 'business' THEN 'business'
    ELSE NULL
  END;

  IF v_plan IS NULL THEN
    RETURN jsonb_build_object(
      'kind', 'draft_profile_plan_not_eligible',
      'merchant_id', p_merchant_id
    );
  END IF;

  SELECT s.*
  INTO v_subscription
  FROM public.subscriptions s
  WHERE s.merchant_id = p_merchant_id
  FOR SHARE;

  IF NOT FOUND OR lower(btrim(COALESCE(v_subscription.status, ''))) <> 'active' THEN
    RETURN jsonb_build_object(
      'kind', 'draft_profile_subscription_inactive',
      'merchant_id', p_merchant_id,
      'plan_code', v_plan
    );
  END IF;

  v_subscription_plan := CASE lower(btrim(COALESCE(v_subscription.plan_type, '')))
    WHEN 'individual' THEN 'solo_lite'
    WHEN 'solo_lite' THEN 'solo_lite'
    WHEN 'corporate' THEN 'business'
    WHEN 'business' THEN 'business'
    ELSE NULL
  END;

  IF v_subscription_plan IS DISTINCT FROM v_plan THEN
    RETURN jsonb_build_object(
      'kind', 'draft_profile_subscription_plan_mismatch',
      'merchant_id', p_merchant_id,
      'plan_code', v_plan
    );
  END IF;

  SELECT mcw.workspace_id, w.merchant_id
  INTO v_workspace_id, v_workspace_owner
  FROM public.merchant_canonical_workspaces mcw
  LEFT JOIN public.workspaces w ON w.id = mcw.workspace_id
  WHERE mcw.merchant_id = p_merchant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'kind', 'draft_profile_canonical_workspace_missing',
      'merchant_id', p_merchant_id,
      'plan_code', v_plan
    );
  END IF;

  IF v_workspace_id IS NULL OR v_workspace_owner IS DISTINCT FROM p_merchant_id THEN
    RETURN jsonb_build_object(
      'kind', 'draft_profile_canonical_workspace_conflict',
      'merchant_id', p_merchant_id,
      'plan_code', v_plan
    );
  END IF;

  SELECT p.*
  INTO v_profile
  FROM public.merchant_compliance_profiles p
  WHERE p.merchant_id = p_merchant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.merchant_compliance_profiles (
        merchant_id,
        plan_code,
        business_type,
        compliance_status,
        activation_status,
        risk_rating,
        restriction_state,
        restriction_reason_code,
        restriction_notes,
        restriction_effective_at,
        restriction_review_due_at,
        collection_limit_basis,
        approved_monthly_volume,
        cumulative_collection_cap,
        cumulative_collection_used,
        hidden_daily_velocity_limit,
        single_transaction_limit,
        outstanding_receivable_cap,
        collection_limit_approved,
        limits_approved_at,
        limits_approved_by,
        can_collect_payments,
        can_use_instant_sale,
        can_use_receivable_sale,
        can_use_storefront,
        can_activate_settlement,
        can_use_deposit_balance,
        policy_version,
        decision_source_type,
        decision_source_id,
        decision_source_version,
        last_reviewed_at,
        next_review_due_at,
        reviewed_by,
        row_version
      ) VALUES (
        p_merchant_id,
        v_plan,
        NULL,
        'draft',
        'test_mode',
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
        false,
        NULL,
        NULL,
        false,
        false,
        false,
        false,
        false,
        false,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        1
      )
      ON CONFLICT (merchant_id) DO NOTHING
    RETURNING * INTO v_profile;
    v_created := FOUND;

    IF NOT v_created THEN
      SELECT p.*
      INTO v_profile
      FROM public.merchant_compliance_profiles p
      WHERE p.merchant_id = p_merchant_id
      FOR UPDATE;
    END IF;
  END IF;

  IF v_profile.id IS NULL THEN
    RETURN jsonb_build_object(
      'kind', 'draft_profile_state_incompatible',
      'merchant_id', p_merchant_id,
      'plan_code', v_plan
    );
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.merchant_compliance_reviews r WHERE r.profile_id = v_profile.id
  ) INTO v_has_review;
  SELECT EXISTS (
    SELECT 1 FROM public.merchant_compliance_events e WHERE e.profile_id = v_profile.id
  ) INTO v_has_event;

  IF v_profile.plan_code IS DISTINCT FROM v_plan
    OR v_profile.compliance_status IS DISTINCT FROM 'draft'
    OR v_profile.activation_status IS DISTINCT FROM 'test_mode'
    OR v_profile.row_version IS DISTINCT FROM 1
    OR v_profile.business_type IS NOT NULL
    OR v_profile.risk_rating IS NOT NULL
    OR v_profile.restriction_state IS NOT NULL
    OR v_profile.restriction_reason_code IS NOT NULL
    OR v_profile.restriction_notes IS NOT NULL
    OR v_profile.restriction_effective_at IS NOT NULL
    OR v_profile.restriction_review_due_at IS NOT NULL
    OR v_profile.collection_limit_basis IS NOT NULL
    OR v_profile.approved_monthly_volume IS NOT NULL
    OR v_profile.cumulative_collection_cap IS NOT NULL
    OR v_profile.cumulative_collection_used IS NOT NULL
    OR v_profile.hidden_daily_velocity_limit IS NOT NULL
    OR v_profile.single_transaction_limit IS NOT NULL
    OR v_profile.outstanding_receivable_cap IS NOT NULL
    OR v_profile.collection_limit_approved
    OR v_profile.limits_approved_at IS NOT NULL
    OR v_profile.limits_approved_by IS NOT NULL
    OR v_profile.can_collect_payments
    OR v_profile.can_use_instant_sale
    OR v_profile.can_use_receivable_sale
    OR v_profile.can_use_storefront
    OR v_profile.can_activate_settlement
    OR v_profile.can_use_deposit_balance
    OR v_profile.policy_version IS NOT NULL
    OR v_profile.decision_source_type IS NOT NULL
    OR v_profile.decision_source_id IS NOT NULL
    OR v_profile.decision_source_version IS NOT NULL
    OR v_profile.last_reviewed_at IS NOT NULL
    OR v_profile.next_review_due_at IS NOT NULL
    OR v_profile.reviewed_by IS NOT NULL
    OR v_has_review
    OR v_has_event THEN
    RETURN jsonb_build_object(
      'kind', 'draft_profile_existing_conflict',
      'merchant_id', p_merchant_id,
      'profile_id', v_profile.id,
      'plan_code', v_plan
    );
  END IF;

  RETURN jsonb_build_object(
    'kind', CASE WHEN v_created THEN 'draft_profile_created' ELSE 'draft_profile_existing_exact' END,
    'merchant_id', p_merchant_id,
    'profile_id', v_profile.id,
    'plan_code', v_plan,
    'row_version', 1
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_draft_compliance_profile_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_draft_compliance_profile_v1(uuid)
  TO service_role;

DO $phase2c_b4p_postconditions$
DECLARE
  v_rpc regprocedure := to_regprocedure('public.ensure_draft_compliance_profile_v1(uuid)');
BEGIN
  IF v_rpc IS NULL THEN
    RAISE EXCEPTION 'B4P postcondition failed: ensure RPC is unavailable';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    WHERE p.oid = v_rpc
      AND (
        p.prosecdef
        OR NOT COALESCE(p.proconfig @> ARRAY['search_path=pg_catalog, public'], false)
      )
  ) THEN
    RAISE EXCEPTION 'B4P postcondition failed: ensure RPC security posture is incompatible';
  END IF;
  IF has_function_privilege('anon', v_rpc, 'EXECUTE')
    OR has_function_privilege('authenticated', v_rpc, 'EXECUTE')
    OR NOT has_function_privilege('service_role', v_rpc, 'EXECUTE') THEN
    RAISE EXCEPTION 'B4P postcondition failed: ensure RPC grants are incompatible';
  END IF;
END;
$phase2c_b4p_postconditions$;

COMMIT;
