BEGIN;

-- Migration 030 is additive. It leaves M028 v1 fail-closed and adds v2
-- canonical-context RPCs that require M029's immutable workspace authority.
DO $migration_030_prerequisites$
DECLARE
  v_service_role_oid oid := to_regrole('service_role');
  v_anon_oid oid := to_regrole('anon');
  v_authenticated_oid oid := to_regrole('authenticated');
  v_approval_oid oid := to_regprocedure('public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)');
  v_issue_v1_oid oid := to_regprocedure('public.issue_canonical_approval_decision_request_v1(uuid,uuid,text,text,text)');
  v_snapshot_v1_oid oid := to_regprocedure('public.read_canonical_approval_snapshot_v1(uuid)');
  v_reconcile_oid oid := to_regprocedure('public.reconcile_canonical_merchant_workspace_link_v1(uuid,uuid,text)');
  v_issue_v2_oid oid := to_regprocedure('public.issue_canonical_approval_decision_request_v2(uuid,uuid,text,text,text)');
  v_snapshot_v2_oid oid := to_regprocedure('public.read_canonical_approval_snapshot_v2(uuid)');
  v_workspaces_oid regclass := to_regclass('public.workspaces');
  v_canonical_link_oid regclass := to_regclass('public.merchant_canonical_workspaces');
  v_workspace_id_attnum smallint;
  v_workspace_merchant_id_attnum smallint;
  v_link_merchant_id_attnum smallint;
  v_link_workspace_id_attnum smallint;
  v_m029_authority_valid boolean := false;
  v_rpc_oid oid;
  v_table_oid oid;
  v_required_table text;
  v_public_execute boolean;
  v_anon_execute boolean;
  v_authenticated_execute boolean;
  v_service_execute boolean;
BEGIN
  IF v_service_role_oid IS NULL OR v_anon_oid IS NULL OR v_authenticated_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 030 prerequisite failed: required managed roles are unavailable';
  END IF;

  FOREACH v_required_table IN ARRAY ARRAY[
    'public.merchant_compliance_profiles',
    'public.merchant_compliance_reviews',
    'public.solo_plus_cases',
    'public.approval_policy_versions',
    'public.approval_decision_requests',
    'public.merchant_canonical_workspaces',
    'public.workspaces',
    'auth.users'
  ] LOOP
    IF to_regclass(v_required_table) IS NULL THEN
      RAISE EXCEPTION 'Migration 030 prerequisite failed: required relation % is unavailable', v_required_table;
    END IF;
  END LOOP;

  IF v_approval_oid IS NULL OR v_issue_v1_oid IS NULL OR v_snapshot_v1_oid IS NULL OR v_reconcile_oid IS NULL
    OR EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'review_compliance_profile_decision_v1',
          'issue_canonical_approval_decision_request_v1',
          'read_canonical_approval_snapshot_v1',
          'reconcile_canonical_merchant_workspace_link_v1'
        )
        AND p.oid NOT IN (v_approval_oid, v_issue_v1_oid, v_snapshot_v1_oid, v_reconcile_oid)
    ) THEN
    RAISE EXCEPTION 'Migration 030 prerequisite failed: M026-M029 RPC signatures are unavailable or ambiguous';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    WHERE p.oid IN (v_approval_oid, v_issue_v1_oid, v_snapshot_v1_oid, v_reconcile_oid)
      AND (
        p.prosecdef
        OR NOT COALESCE(p.proconfig @> ARRAY['search_path=pg_catalog, public'], false)
      )
  ) THEN
    RAISE EXCEPTION 'Migration 030 prerequisite failed: M026-M029 RPC security posture is incompatible';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_issue_v1_oid AND pg_get_functiondef(p.oid) ~ 'canonical_request_workspace_linkage_unavailable')
    OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_snapshot_v1_oid AND pg_get_functiondef(p.oid) ~ 'canonical_snapshot_workspace_linkage_unavailable')
    OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_approval_oid AND pg_get_functiondef(p.oid) ~ 'LOCAL_APPROVAL_BRANCH|LOCAL_APPROVAL_EXCEPTION|deraledger\.local_approval_rehearsal_diagnostics|approval_rpc_internal_diagnostics|GET STACKED DIAGNOSTICS') THEN
    RAISE EXCEPTION 'Migration 030 prerequisite failed: M026/M028 v1 function body posture is incompatible';
  END IF;

  FOREACH v_rpc_oid IN ARRAY ARRAY[v_approval_oid, v_issue_v1_oid, v_snapshot_v1_oid, v_reconcile_oid]
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) privilege_state
      WHERE p.oid = v_rpc_oid
        AND privilege_state.grantee = 0
        AND privilege_state.privilege_type = 'EXECUTE'
    ) INTO v_public_execute;
    SELECT has_function_privilege(v_anon_oid, v_rpc_oid, 'EXECUTE') INTO v_anon_execute;
    SELECT has_function_privilege(v_authenticated_oid, v_rpc_oid, 'EXECUTE') INTO v_authenticated_execute;
    SELECT has_function_privilege(v_service_role_oid, v_rpc_oid, 'EXECUTE') INTO v_service_execute;
    IF v_public_execute OR v_anon_execute OR v_authenticated_execute OR NOT v_service_execute THEN
      RAISE EXCEPTION 'Migration 030 prerequisite failed: M026-M029 RPC grants are incompatible';
    END IF;
  END LOOP;

  FOREACH v_table_oid IN ARRAY ARRAY[
    to_regclass('public.merchant_compliance_profiles'),
    to_regclass('public.merchant_compliance_reviews'),
    to_regclass('public.merchant_compliance_events'),
    to_regclass('public.approval_policy_versions'),
    to_regclass('public.approval_decision_requests'),
    to_regclass('public.merchant_canonical_workspaces')
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = v_table_oid AND c.relrowsecurity AND NOT c.relforcerowsecurity)
      OR EXISTS (
        SELECT 1
        FROM pg_class c
        CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) privilege_state
        WHERE c.oid = v_table_oid AND privilege_state.grantee = 0
      )
      OR has_table_privilege(v_anon_oid, v_table_oid, 'SELECT')
      OR has_table_privilege(v_anon_oid, v_table_oid, 'INSERT')
      OR has_table_privilege(v_anon_oid, v_table_oid, 'UPDATE')
      OR has_table_privilege(v_anon_oid, v_table_oid, 'DELETE')
      OR has_table_privilege(v_authenticated_oid, v_table_oid, 'SELECT')
      OR has_table_privilege(v_authenticated_oid, v_table_oid, 'INSERT')
      OR has_table_privilege(v_authenticated_oid, v_table_oid, 'UPDATE')
      OR has_table_privilege(v_authenticated_oid, v_table_oid, 'DELETE') THEN
      RAISE EXCEPTION 'Migration 030 prerequisite failed: M028/M029/compliance table browser security is incompatible';
    END IF;
  END LOOP;

  IF NOT has_table_privilege(v_service_role_oid, to_regclass('public.merchant_compliance_profiles'), 'SELECT')
    OR NOT has_table_privilege(v_service_role_oid, to_regclass('public.merchant_compliance_reviews'), 'SELECT')
    OR NOT has_table_privilege(v_service_role_oid, to_regclass('public.solo_plus_cases'), 'SELECT')
    OR NOT has_table_privilege(v_service_role_oid, to_regclass('public.approval_policy_versions'), 'SELECT')
    OR NOT has_table_privilege(v_service_role_oid, to_regclass('public.approval_decision_requests'), 'SELECT')
    OR NOT has_table_privilege(v_service_role_oid, to_regclass('public.approval_decision_requests'), 'INSERT')
    OR NOT has_table_privilege(v_service_role_oid, to_regclass('public.merchant_canonical_workspaces'), 'SELECT')
    OR NOT has_table_privilege(v_service_role_oid, to_regclass('public.workspaces'), 'SELECT')
    OR NOT has_table_privilege(v_service_role_oid, to_regclass('auth.users'), 'SELECT') THEN
    RAISE EXCEPTION 'Migration 030 prerequisite failed: service_role lacks a required v2 prerequisite read or request insert grant';
  END IF;

  SELECT a.attnum INTO v_workspace_id_attnum
  FROM pg_attribute a
  WHERE a.attrelid = v_workspaces_oid AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT a.attnum INTO v_workspace_merchant_id_attnum
  FROM pg_attribute a
  WHERE a.attrelid = v_workspaces_oid AND a.attname = 'merchant_id' AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT a.attnum INTO v_link_merchant_id_attnum
  FROM pg_attribute a
  WHERE a.attrelid = v_canonical_link_oid AND a.attname = 'merchant_id' AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT a.attnum INTO v_link_workspace_id_attnum
  FROM pg_attribute a
  WHERE a.attrelid = v_canonical_link_oid AND a.attname = 'workspace_id' AND a.attnum > 0 AND NOT a.attisdropped;

  SELECT COALESCE(
    EXISTS (
      SELECT 1
      FROM pg_index index_state
      WHERE index_state.indexrelid = to_regclass('public.merchant_canonical_workspace_supporting_owner_key')
        AND index_state.indrelid = v_workspaces_oid
        AND index_state.indisunique
        AND index_state.indisvalid
        AND index_state.indisready
        AND index_state.indpred IS NULL
        AND index_state.indnkeyatts = 2
        AND index_state.indnatts = 2
        AND ARRAY(
          SELECT key_state.attnum
          FROM unnest(index_state.indkey::smallint[]) WITH ORDINALITY AS key_state(attnum, ordinal_position)
          ORDER BY key_state.ordinal_position
        ) = ARRAY[v_workspace_id_attnum, v_workspace_merchant_id_attnum]::smallint[]
    )
    AND EXISTS (
      SELECT 1
      FROM pg_constraint constraint_state
      WHERE constraint_state.conrelid = v_canonical_link_oid
        AND constraint_state.conname = 'merchant_canonical_workspaces_pkey'
        AND constraint_state.contype = 'p'::"char"
        AND constraint_state.convalidated
        AND ARRAY(
          SELECT key_state.attnum
          FROM unnest(constraint_state.conkey) WITH ORDINALITY AS key_state(attnum, ordinal_position)
          ORDER BY key_state.ordinal_position
        ) = ARRAY[v_link_merchant_id_attnum]::smallint[]
    )
    AND EXISTS (
      SELECT 1
      FROM pg_constraint constraint_state
      WHERE constraint_state.conrelid = v_canonical_link_oid
        AND constraint_state.conname = 'merchant_canonical_workspaces_workspace_key'
        AND constraint_state.contype = 'u'::"char"
        AND constraint_state.convalidated
        AND ARRAY(
          SELECT key_state.attnum
          FROM unnest(constraint_state.conkey) WITH ORDINALITY AS key_state(attnum, ordinal_position)
          ORDER BY key_state.ordinal_position
        ) = ARRAY[v_link_workspace_id_attnum]::smallint[]
    )
    AND EXISTS (
      SELECT 1
      FROM pg_constraint constraint_state
      WHERE constraint_state.conrelid = v_canonical_link_oid
        AND constraint_state.conname = 'merchant_canonical_workspaces_workspace_owner_fkey'
        AND constraint_state.contype = 'f'::"char"
        AND constraint_state.convalidated
        AND constraint_state.confrelid = v_workspaces_oid
        AND constraint_state.confupdtype = 'a'::"char"
        AND constraint_state.confdeltype = 'r'::"char"
        AND constraint_state.confmatchtype = 's'::"char"
        AND ARRAY(
          SELECT key_state.attnum
          FROM unnest(constraint_state.conkey) WITH ORDINALITY AS key_state(attnum, ordinal_position)
          ORDER BY key_state.ordinal_position
        ) = ARRAY[v_link_workspace_id_attnum, v_link_merchant_id_attnum]::smallint[]
        AND ARRAY(
          SELECT key_state.attnum
          FROM unnest(constraint_state.confkey) WITH ORDINALITY AS key_state(attnum, ordinal_position)
          ORDER BY key_state.ordinal_position
        ) = ARRAY[v_workspace_id_attnum, v_workspace_merchant_id_attnum]::smallint[]
    ),
    false
  ) INTO v_m029_authority_valid;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=to_regclass('public.approval_decision_requests') AND c.conname='approval_decision_requests_fingerprint_unique' AND c.contype='u'::"char" AND c.convalidated)
    OR NOT v_m029_authority_valid THEN
    RAISE EXCEPTION 'Migration 030 prerequisite failed: M028 request or M029 ownership authority is incompatible';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('issue_canonical_approval_decision_request_v2', 'read_canonical_approval_snapshot_v2')
      AND p.oid NOT IN (v_issue_v2_oid, v_snapshot_v2_oid)
  ) THEN
    RAISE EXCEPTION 'Migration 030 prerequisite failed: conflicting v2 approval RPC overload exists';
  END IF;
END;
$migration_030_prerequisites$;

CREATE OR REPLACE FUNCTION public.issue_canonical_approval_decision_request_v2(
  p_profile_id uuid,
  p_reviewer_id uuid,
  p_target_compliance_status text,
  p_policy_version text,
  p_reason_code text
)
RETURNS TABLE(result_code text, decision_request_id uuid, decision_idempotency_key text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $issue_canonical_approval_decision_request_v2$
DECLARE
  v_profile public.merchant_compliance_profiles%ROWTYPE;
  v_case public.solo_plus_cases%ROWTYPE;
  v_request public.approval_decision_requests%ROWTYPE;
  v_workspace_id uuid;
  v_workspace_link_count bigint := 0;
  v_review_source_count bigint := 0;
  v_reviewed_at timestamptz;
  v_reason_code text;
  v_policy_version text;
  v_source_type text;
BEGIN
  v_reason_code := NULLIF(btrim(COALESCE(p_reason_code, '')), '');
  v_policy_version := NULLIF(btrim(COALESCE(p_policy_version, '')), '');
  IF p_profile_id IS NULL OR p_reviewer_id IS NULL OR v_policy_version IS NULL
    OR p_target_compliance_status NOT IN ('lite_verified', 'enhanced_verified', 'business_verified', 'needs_attention', 'restricted', 'rejected') THEN
    RETURN QUERY SELECT 'canonical_request_v2_payload_invalid', NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users reviewer WHERE reviewer.id = p_reviewer_id) THEN
    RETURN QUERY SELECT 'canonical_request_v2_reviewer_invalid', NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO v_profile
  FROM public.merchant_compliance_profiles profile
  WHERE profile.id = p_profile_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'canonical_request_v2_profile_missing', NULL::uuid, NULL::text;
    RETURN;
  END IF;

  v_source_type := v_profile.decision_source_type;
  IF v_profile.plan_code NOT IN ('solo_lite', 'solo_plus', 'business')
    OR v_profile.row_version <= 0
    OR v_profile.decision_source_id IS NULL
    OR v_profile.decision_source_version IS NULL
    OR v_profile.decision_source_version <= 0
    OR NOT COALESCE(
      (v_profile.plan_code = 'solo_lite' AND v_profile.compliance_status IN ('lite_pending', 'needs_attention') AND v_source_type = 'solo_lite_review')
      OR (v_profile.plan_code = 'solo_plus' AND v_profile.compliance_status IN ('enhanced_pending', 'needs_attention') AND v_source_type = 'solo_plus_case')
      OR (v_profile.plan_code = 'business' AND v_profile.compliance_status IN ('business_pending', 'needs_attention') AND v_source_type = 'business_kyb_review'),
      false
    )
    OR (p_target_compliance_status IN ('lite_verified', 'enhanced_verified', 'business_verified')
      AND p_target_compliance_status <> CASE v_profile.plan_code WHEN 'solo_lite' THEN 'lite_verified' WHEN 'solo_plus' THEN 'enhanced_verified' WHEN 'business' THEN 'business_verified' END)
    OR (p_target_compliance_status IN ('needs_attention', 'restricted', 'rejected')
      AND v_reason_code NOT IN ('evidence_incomplete', 'evidence_expired', 'evidence_mismatch', 'review_rejected', 'reviewer_requested_correction', 'policy_restriction', 'risk_restricted', 'risk_suspended'))
    OR (p_target_compliance_status IN ('lite_verified', 'enhanced_verified', 'business_verified') AND v_reason_code IS NOT NULL) THEN
    RETURN QUERY SELECT 'canonical_request_v2_profile_state_invalid', NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT count(*), min(canonical_link.workspace_id)
  INTO v_workspace_link_count, v_workspace_id
  FROM public.merchant_canonical_workspaces canonical_link
  JOIN public.workspaces workspace_owner
    ON workspace_owner.id = canonical_link.workspace_id
   AND workspace_owner.merchant_id = canonical_link.merchant_id
  WHERE canonical_link.merchant_id = v_profile.merchant_id
    AND canonical_link.link_version = 1;
  IF v_workspace_link_count = 0 THEN
    RETURN QUERY SELECT 'canonical_request_v2_workspace_linkage_unavailable', NULL::uuid, NULL::text;
    RETURN;
  ELSIF v_workspace_link_count <> 1 OR v_workspace_id IS NULL THEN
    RETURN QUERY SELECT 'canonical_request_v2_workspace_linkage_conflict', NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.approval_policy_versions policy
    WHERE policy.policy_version = v_policy_version
      AND policy.plan_code = v_profile.plan_code
      AND policy.source_type = v_source_type
      AND policy.policy_state = 'published'
  ) THEN
    RETURN QUERY SELECT 'canonical_request_v2_policy_invalid', NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_profile.plan_code IN ('solo_lite', 'business') THEN
    SELECT count(*) INTO v_review_source_count
    FROM public.merchant_compliance_reviews review_source
    WHERE review_source.id = v_profile.decision_source_id
      AND review_source.merchant_id = v_profile.merchant_id
      AND review_source.profile_id = v_profile.id
      AND review_source.review_type = CASE v_source_type WHEN 'solo_lite_review' THEN 'solo_lite' WHEN 'business_kyb_review' THEN 'business_kyb' END
      AND review_source.target_plan_code = v_profile.plan_code
      AND review_source.review_status IN ('pending', 'needs_attention')
      AND review_source.row_version = v_profile.decision_source_version;
    IF v_review_source_count <> 1 THEN
      RETURN QUERY SELECT 'canonical_request_v2_source_invalid', NULL::uuid, NULL::text;
      RETURN;
    END IF;
    v_reviewed_at := now();
  ELSE
    SELECT * INTO v_case
    FROM public.solo_plus_cases source_case
    WHERE source_case.id = v_profile.decision_source_id
      AND source_case.merchant_id = v_profile.merchant_id;
    IF NOT FOUND OR v_case.target_plan <> 'solo_plus'
      OR v_case.row_version::bigint <> v_profile.decision_source_version
      OR v_case.requirements_policy_version <> v_policy_version THEN
      RETURN QUERY SELECT 'canonical_request_v2_source_invalid', NULL::uuid, NULL::text;
      RETURN;
    END IF;
    IF p_target_compliance_status IN ('enhanced_verified', 'restricted')
      AND v_case.case_status = 'approved'
      AND v_case.approved_by_admin_id = p_reviewer_id
      AND v_case.approved_at IS NOT NULL THEN
      v_reviewed_at := v_case.approved_at;
    ELSIF p_target_compliance_status = 'rejected'
      AND v_case.case_status = 'rejected'
      AND v_case.rejected_by_admin_id = p_reviewer_id
      AND v_case.rejected_at IS NOT NULL THEN
      v_reviewed_at := v_case.rejected_at;
    ELSIF p_target_compliance_status = 'needs_attention'
      AND v_case.case_status IN ('verification_pending', 'manual_review') THEN
      v_reviewed_at := now();
    ELSE
      RETURN QUERY SELECT 'canonical_request_v2_source_invalid', NULL::uuid, NULL::text;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO v_request
  FROM public.approval_decision_requests existing_request
  WHERE existing_request.reviewer_id = p_reviewer_id
    AND existing_request.merchant_id = v_profile.merchant_id
    AND existing_request.workspace_id = v_workspace_id
    AND existing_request.profile_id = v_profile.id
    AND existing_request.plan_code = v_profile.plan_code
    AND existing_request.source_type = v_source_type
    AND existing_request.source_id = v_profile.decision_source_id
    AND existing_request.source_version = v_profile.decision_source_version
    AND existing_request.expected_profile_row_version = v_profile.row_version
    AND existing_request.target_compliance_status = p_target_compliance_status
    AND existing_request.policy_version = v_policy_version
    AND existing_request.reason_code IS NOT DISTINCT FROM v_reason_code;
  IF FOUND THEN
    RETURN QUERY SELECT 'canonical_request_v2_idempotent_replay', v_request.id, v_request.decision_idempotency_key;
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.approval_decision_requests (
      reviewer_id, merchant_id, workspace_id, profile_id, plan_code, source_type,
      source_id, source_version, expected_profile_row_version,
      target_compliance_status, policy_version, reason_code, reviewed_at
    ) VALUES (
      p_reviewer_id, v_profile.merchant_id, v_workspace_id, v_profile.id,
      v_profile.plan_code, v_source_type, v_profile.decision_source_id,
      v_profile.decision_source_version, v_profile.row_version,
      p_target_compliance_status, v_policy_version, v_reason_code, v_reviewed_at
    )
    RETURNING * INTO v_request;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_request
    FROM public.approval_decision_requests existing_request
    WHERE existing_request.reviewer_id = p_reviewer_id
      AND existing_request.merchant_id = v_profile.merchant_id
      AND existing_request.workspace_id = v_workspace_id
      AND existing_request.profile_id = v_profile.id
      AND existing_request.plan_code = v_profile.plan_code
      AND existing_request.source_type = v_source_type
      AND existing_request.source_id = v_profile.decision_source_id
      AND existing_request.source_version = v_profile.decision_source_version
      AND existing_request.expected_profile_row_version = v_profile.row_version
      AND existing_request.target_compliance_status = p_target_compliance_status
      AND existing_request.policy_version = v_policy_version
      AND existing_request.reason_code IS NOT DISTINCT FROM v_reason_code;
    IF FOUND THEN
      RETURN QUERY SELECT 'canonical_request_v2_idempotent_replay', v_request.id, v_request.decision_idempotency_key;
    ELSE
      RETURN QUERY SELECT 'canonical_request_v2_idempotency_conflict', NULL::uuid, NULL::text;
    END IF;
    RETURN;
  WHEN OTHERS THEN
    RETURN QUERY SELECT 'canonical_request_v2_failed', NULL::uuid, NULL::text;
    RETURN;
  END;

  RETURN QUERY SELECT 'canonical_request_v2_created', v_request.id, v_request.decision_idempotency_key;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT 'canonical_request_v2_failed', NULL::uuid, NULL::text;
END;
$issue_canonical_approval_decision_request_v2$;

CREATE OR REPLACE FUNCTION public.read_canonical_approval_snapshot_v2(
  p_decision_request_id uuid
)
RETURNS TABLE(
  result_code text,
  decision_request_id uuid,
  decision_idempotency_key text,
  merchant_id uuid,
  workspace_id uuid,
  profile_id uuid,
  plan_code text,
  current_compliance_status text,
  source_type text,
  source_id uuid,
  source_version bigint,
  expected_profile_row_version bigint,
  policy_version text,
  reviewer_id uuid,
  reviewed_at timestamptz,
  reason_code text,
  target_compliance_status text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $read_canonical_approval_snapshot_v2$
DECLARE
  v_request public.approval_decision_requests%ROWTYPE;
  v_profile public.merchant_compliance_profiles%ROWTYPE;
  v_case public.solo_plus_cases%ROWTYPE;
  v_workspace_id uuid;
  v_workspace_link_count bigint := 0;
  v_review_source_count bigint := 0;
BEGIN
  IF p_decision_request_id IS NULL THEN
    RETURN QUERY SELECT 'canonical_snapshot_v2_payload_invalid', NULL::uuid, NULL::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::bigint, NULL::bigint, NULL::text, NULL::uuid, NULL::timestamptz, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO v_request
  FROM public.approval_decision_requests request_row
  WHERE request_row.id = p_decision_request_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'canonical_snapshot_v2_request_missing', NULL::uuid, NULL::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::bigint, NULL::bigint, NULL::text, NULL::uuid, NULL::timestamptz, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO v_profile
  FROM public.merchant_compliance_profiles profile
  WHERE profile.id = v_request.profile_id
    AND profile.merchant_id = v_request.merchant_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'canonical_snapshot_v2_profile_missing', NULL::uuid, NULL::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::bigint, NULL::bigint, NULL::text, NULL::uuid, NULL::timestamptz, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF v_profile.row_version <> v_request.expected_profile_row_version
    OR v_profile.plan_code <> v_request.plan_code
    OR v_profile.decision_source_type <> v_request.source_type
    OR v_profile.decision_source_id <> v_request.source_id
    OR v_profile.decision_source_version <> v_request.source_version
    OR NOT COALESCE(
      (v_profile.plan_code = 'solo_lite' AND v_profile.compliance_status IN ('lite_pending', 'needs_attention') AND v_request.source_type = 'solo_lite_review')
      OR (v_profile.plan_code = 'solo_plus' AND v_profile.compliance_status IN ('enhanced_pending', 'needs_attention') AND v_request.source_type = 'solo_plus_case')
      OR (v_profile.plan_code = 'business' AND v_profile.compliance_status IN ('business_pending', 'needs_attention') AND v_request.source_type = 'business_kyb_review'),
      false
    ) THEN
    RETURN QUERY SELECT 'canonical_snapshot_v2_stale_or_conflicting', NULL::uuid, NULL::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::bigint, NULL::bigint, NULL::text, NULL::uuid, NULL::timestamptz, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT count(*), min(canonical_link.workspace_id)
  INTO v_workspace_link_count, v_workspace_id
  FROM public.merchant_canonical_workspaces canonical_link
  JOIN public.workspaces workspace_owner
    ON workspace_owner.id = canonical_link.workspace_id
   AND workspace_owner.merchant_id = canonical_link.merchant_id
  WHERE canonical_link.merchant_id = v_request.merchant_id
    AND canonical_link.link_version = 1;
  IF v_workspace_link_count = 0 THEN
    RETURN QUERY SELECT 'canonical_snapshot_v2_workspace_linkage_unavailable', NULL::uuid, NULL::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::bigint, NULL::bigint, NULL::text, NULL::uuid, NULL::timestamptz, NULL::text, NULL::text;
    RETURN;
  ELSIF v_workspace_link_count <> 1 OR v_workspace_id IS NULL OR v_request.workspace_id IS DISTINCT FROM v_workspace_id THEN
    RETURN QUERY SELECT 'canonical_snapshot_v2_workspace_linkage_conflict', NULL::uuid, NULL::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::bigint, NULL::bigint, NULL::text, NULL::uuid, NULL::timestamptz, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.approval_policy_versions policy
    WHERE policy.policy_version = v_request.policy_version
      AND policy.plan_code = v_request.plan_code
      AND policy.source_type = v_request.source_type
      AND policy.policy_state = 'published'
  ) THEN
    RETURN QUERY SELECT 'canonical_snapshot_v2_policy_invalid', NULL::uuid, NULL::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::bigint, NULL::bigint, NULL::text, NULL::uuid, NULL::timestamptz, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF v_request.plan_code IN ('solo_lite', 'business') THEN
    SELECT count(*) INTO v_review_source_count
    FROM public.merchant_compliance_reviews review_source
    WHERE review_source.id = v_request.source_id
      AND review_source.merchant_id = v_request.merchant_id
      AND review_source.profile_id = v_request.profile_id
      AND review_source.review_type = CASE v_request.source_type WHEN 'solo_lite_review' THEN 'solo_lite' WHEN 'business_kyb_review' THEN 'business_kyb' END
      AND review_source.target_plan_code = v_request.plan_code
      AND review_source.review_status IN ('pending', 'needs_attention')
      AND review_source.row_version = v_request.source_version;
    IF v_review_source_count <> 1 OR v_request.reviewed_at IS NULL THEN
      RETURN QUERY SELECT 'canonical_snapshot_v2_source_invalid', NULL::uuid, NULL::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::bigint, NULL::bigint, NULL::text, NULL::uuid, NULL::timestamptz, NULL::text, NULL::text;
      RETURN;
    END IF;
  ELSE
    SELECT * INTO v_case
    FROM public.solo_plus_cases source_case
    WHERE source_case.id = v_request.source_id
      AND source_case.merchant_id = v_request.merchant_id;
    IF NOT FOUND OR v_case.target_plan <> 'solo_plus'
      OR v_case.row_version::bigint <> v_request.source_version
      OR v_case.requirements_policy_version <> v_request.policy_version
      OR NOT COALESCE(
        (v_request.target_compliance_status IN ('enhanced_verified', 'restricted')
          AND v_case.case_status = 'approved'
          AND v_case.approved_by_admin_id = v_request.reviewer_id
          AND v_case.approved_at = v_request.reviewed_at)
        OR (v_request.target_compliance_status = 'rejected'
          AND v_case.case_status = 'rejected'
          AND v_case.rejected_by_admin_id = v_request.reviewer_id
          AND v_case.rejected_at = v_request.reviewed_at)
        OR (v_request.target_compliance_status = 'needs_attention'
          AND v_case.case_status IN ('verification_pending', 'manual_review')
          AND v_request.reviewed_at IS NOT NULL),
        false
      ) THEN
      RETURN QUERY SELECT 'canonical_snapshot_v2_source_invalid', NULL::uuid, NULL::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::bigint, NULL::bigint, NULL::text, NULL::uuid, NULL::timestamptz, NULL::text, NULL::text;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT
    'canonical_snapshot_v2_ready',
    v_request.id,
    v_request.decision_idempotency_key,
    v_request.merchant_id,
    v_request.workspace_id,
    v_request.profile_id,
    v_request.plan_code,
    v_profile.compliance_status,
    v_request.source_type,
    v_request.source_id,
    v_request.source_version,
    v_request.expected_profile_row_version,
    v_request.policy_version,
    v_request.reviewer_id,
    v_request.reviewed_at,
    v_request.reason_code,
    v_request.target_compliance_status;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT 'canonical_snapshot_v2_failed', NULL::uuid, NULL::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::bigint, NULL::bigint, NULL::text, NULL::uuid, NULL::timestamptz, NULL::text, NULL::text;
END;
$read_canonical_approval_snapshot_v2$;

REVOKE ALL ON FUNCTION public.issue_canonical_approval_decision_request_v2(uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_canonical_approval_snapshot_v2(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_canonical_approval_decision_request_v2(uuid,uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_canonical_approval_snapshot_v2(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
