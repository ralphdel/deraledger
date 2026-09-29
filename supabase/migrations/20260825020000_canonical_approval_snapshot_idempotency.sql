BEGIN;

-- Migration 028 is additive. It issues canonical approval requests and reads
-- their validated snapshots; it never executes an approval decision itself.
DO $migration_028_prerequisites$
DECLARE
  v_required_columns text[][2] := ARRAY[
    ARRAY['merchant_compliance_profiles','id'], ARRAY['merchant_compliance_profiles','merchant_id'],
    ARRAY['merchant_compliance_profiles','plan_code'], ARRAY['merchant_compliance_profiles','compliance_status'],
    ARRAY['merchant_compliance_profiles','decision_source_type'], ARRAY['merchant_compliance_profiles','decision_source_id'],
    ARRAY['merchant_compliance_profiles','decision_source_version'], ARRAY['merchant_compliance_profiles','row_version'],
    ARRAY['merchant_compliance_reviews','id'], ARRAY['merchant_compliance_reviews','merchant_id'],
    ARRAY['merchant_compliance_reviews','profile_id'], ARRAY['merchant_compliance_reviews','review_type'],
    ARRAY['merchant_compliance_reviews','target_plan_code'], ARRAY['merchant_compliance_reviews','review_status'], ARRAY['merchant_compliance_reviews','row_version'],
    ARRAY['merchant_compliance_events','id'], ARRAY['merchant_compliance_events','merchant_id'], ARRAY['merchant_compliance_events','profile_id'],
    ARRAY['merchant_compliance_events','idempotency_key'], ARRAY['merchant_compliance_events','source_type'], ARRAY['merchant_compliance_events','source_id'],
    ARRAY['merchant_compliance_events','policy_version'], ARRAY['merchant_compliance_events','expected_row_version'], ARRAY['merchant_compliance_events','resulting_row_version'],
    ARRAY['solo_plus_cases','id'], ARRAY['solo_plus_cases','merchant_id'], ARRAY['solo_plus_cases','target_plan'], ARRAY['solo_plus_cases','case_status'],
    ARRAY['solo_plus_cases','requirements_policy_version'], ARRAY['solo_plus_cases','approved_at'], ARRAY['solo_plus_cases','approved_by_admin_id'],
    ARRAY['solo_plus_cases','rejected_at'], ARRAY['solo_plus_cases','rejected_by_admin_id'], ARRAY['solo_plus_cases','row_version'],
    ARRAY['merchants','id']
  ];
  v_column text[];
  v_bootstrap_signature text := 'public.bootstrap_reviewed_profile_v1(uuid,uuid,text,text,text,text,text,uuid,uuid,timestamptz)';
  v_approval_signature text := 'public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)';
BEGIN
  IF to_regrole('service_role') IS NULL OR to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL THEN
    RAISE EXCEPTION 'Migration 028 prerequisite failed: required managed roles are unavailable';
  END IF;
  FOREACH v_column SLICE 1 IN ARRAY v_required_columns LOOP
    IF to_regclass(format('public.%I', v_column[1])) IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass(format('public.%I', v_column[1]))
        AND a.attname = v_column[2] AND a.attnum > 0 AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION 'Migration 028 prerequisite failed: required column public.%.% is unavailable', v_column[1], v_column[2];
    END IF;
  END LOOP;
  IF to_regprocedure(v_bootstrap_signature) IS NULL OR EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'bootstrap_reviewed_profile_v1'
      AND p.oid <> to_regprocedure(v_bootstrap_signature)::oid
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_bootstrap_signature)
      AND (p.prosecdef OR NOT (p.proconfig @> ARRAY['search_path=pg_catalog, public']))
  ) OR has_function_privilege('anon', v_bootstrap_signature, 'EXECUTE')
    OR has_function_privilege('authenticated', v_bootstrap_signature, 'EXECUTE')
    OR NOT has_function_privilege('service_role', v_bootstrap_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 028 prerequisite failed: M025 bootstrap RPC security/grant posture is incompatible';
  END IF;
  IF to_regprocedure(v_approval_signature) IS NULL OR EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'review_compliance_profile_decision_v1'
      AND p.oid <> to_regprocedure(v_approval_signature)::oid
  ) THEN
    RAISE EXCEPTION 'Migration 028 prerequisite failed: M026/M027 approval RPC is unavailable or ambiguous';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_approval_signature)
      AND (p.prosecdef OR NOT (p.proconfig @> ARRAY['search_path=pg_catalog, public'])
        OR pg_get_functiondef(p.oid) ~ 'LOCAL_APPROVAL_BRANCH|LOCAL_APPROVAL_EXCEPTION|deraledger\.local_approval_rehearsal_diagnostics|approval_rpc_internal_diagnostics|GET STACKED DIAGNOSTICS')
  ) THEN
    RAISE EXCEPTION 'Migration 028 prerequisite failed: M027 approval RPC security/cleanup state is incompatible';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c WHERE c.oid IN (to_regclass('public.merchant_compliance_profiles'),to_regclass('public.merchant_compliance_reviews'),to_regclass('public.merchant_compliance_events'))
      AND (NOT c.relrowsecurity OR c.relforcerowsecurity)
  ) OR EXISTS (
    SELECT 1 FROM information_schema.role_table_grants g WHERE g.table_schema='public'
      AND g.table_name IN ('merchant_compliance_profiles','merchant_compliance_reviews','merchant_compliance_events')
      AND g.grantee IN ('PUBLIC','anon','authenticated')
  ) OR EXISTS (
    SELECT 1 FROM pg_policy p WHERE p.polrelid IN (to_regclass('public.merchant_compliance_profiles'),to_regclass('public.merchant_compliance_reviews'),to_regclass('public.merchant_compliance_events'))
  ) THEN
    RAISE EXCEPTION 'Migration 028 prerequisite failed: compliance RLS/grant/policy posture is incompatible';
  END IF;
END;
$migration_028_prerequisites$;

CREATE TABLE IF NOT EXISTS public.approval_policy_versions (
  policy_version text NOT NULL,
  plan_code text NOT NULL,
  source_type text NOT NULL,
  policy_state text NOT NULL DEFAULT 'published',
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_policy_versions_pkey PRIMARY KEY (policy_version),
  CONSTRAINT approval_policy_versions_version_check CHECK (length(btrim(policy_version)) > 0),
  CONSTRAINT approval_policy_versions_plan_source_check CHECK (
    (plan_code = 'solo_lite' AND source_type = 'solo_lite_review')
    OR (plan_code = 'solo_plus' AND source_type = 'solo_plus_case')
    OR (plan_code = 'business' AND source_type = 'business_kyb_review')
  ),
  CONSTRAINT approval_policy_versions_state_check CHECK (policy_state = 'published')
);

CREATE TABLE IF NOT EXISTS public.approval_decision_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  decision_idempotency_key text NOT NULL DEFAULT gen_random_uuid()::text,
  reviewer_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  workspace_id uuid,
  profile_id uuid NOT NULL,
  plan_code text NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  source_version bigint NOT NULL,
  expected_profile_row_version bigint NOT NULL,
  target_compliance_status text NOT NULL,
  policy_version text NOT NULL,
  reason_code text,
  reviewed_at timestamptz NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_decision_requests_pkey PRIMARY KEY (id),
  CONSTRAINT approval_decision_requests_key_unique UNIQUE (decision_idempotency_key),
  CONSTRAINT approval_decision_requests_fingerprint_unique UNIQUE NULLS NOT DISTINCT (
    reviewer_id, merchant_id, workspace_id, profile_id, plan_code, source_type, source_id, source_version,
    expected_profile_row_version, target_compliance_status, policy_version, reason_code
  ),
  CONSTRAINT approval_decision_requests_reviewer_fkey FOREIGN KEY (reviewer_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT approval_decision_requests_merchant_fkey FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE RESTRICT,
  CONSTRAINT approval_decision_requests_profile_fkey FOREIGN KEY (profile_id) REFERENCES public.merchant_compliance_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT approval_decision_requests_policy_fkey FOREIGN KEY (policy_version) REFERENCES public.approval_policy_versions(policy_version) ON DELETE RESTRICT,
  CONSTRAINT approval_decision_requests_key_check CHECK (length(btrim(decision_idempotency_key)) > 0),
  CONSTRAINT approval_decision_requests_versions_check CHECK (source_version > 0 AND expected_profile_row_version > 0),
  CONSTRAINT approval_decision_requests_plan_source_check CHECK (
    (plan_code = 'solo_lite' AND source_type = 'solo_lite_review')
    OR (plan_code = 'solo_plus' AND source_type = 'solo_plus_case')
    OR (plan_code = 'business' AND source_type = 'business_kyb_review')
  ),
  CONSTRAINT approval_decision_requests_target_check CHECK (
    (plan_code = 'solo_lite' AND target_compliance_status IN ('lite_verified','needs_attention','restricted','rejected'))
    OR (plan_code = 'solo_plus' AND target_compliance_status IN ('enhanced_verified','needs_attention','restricted','rejected'))
    OR (plan_code = 'business' AND target_compliance_status IN ('business_verified','needs_attention','restricted','rejected'))
  ),
  CONSTRAINT approval_decision_requests_reason_check CHECK (
    (target_compliance_status IN ('lite_verified','enhanced_verified','business_verified') AND reason_code IS NULL)
    OR (target_compliance_status IN ('needs_attention','restricted','rejected') AND reason_code IN ('evidence_incomplete','evidence_expired','evidence_mismatch','review_rejected','reviewer_requested_correction','policy_restriction','risk_restricted','risk_suspended'))
  )
);

CREATE INDEX IF NOT EXISTS idx_approval_decision_requests_profile_source ON public.approval_decision_requests (profile_id, source_id, issued_at);
ALTER TABLE public.approval_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_decision_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_policy_versions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.approval_decision_requests NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.approval_policy_versions, public.approval_decision_requests FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.approval_policy_versions TO service_role;
GRANT SELECT, INSERT ON TABLE public.approval_decision_requests TO service_role;

CREATE OR REPLACE FUNCTION public.issue_canonical_approval_decision_request_v1(
  p_profile_id uuid, p_reviewer_id uuid, p_target_compliance_status text, p_policy_version text, p_reason_code text
)
RETURNS TABLE(result_code text, decision_request_id uuid, decision_idempotency_key text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO pg_catalog, public
AS $issue_canonical_approval_decision_request_v1$
DECLARE
  v_profile public.merchant_compliance_profiles%ROWTYPE;
  v_reason_code text;
BEGIN
  IF p_profile_id IS NULL OR p_reviewer_id IS NULL OR NULLIF(btrim(COALESCE(p_target_compliance_status,'')), '') IS NULL OR NULLIF(btrim(COALESCE(p_policy_version,'')), '') IS NULL THEN
    RETURN QUERY SELECT 'canonical_request_payload_invalid', NULL::uuid, NULL::text; RETURN;
  END IF;
  v_reason_code := NULLIF(btrim(COALESCE(p_reason_code, '')), '');
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_reviewer_id) THEN RETURN QUERY SELECT 'canonical_request_reviewer_invalid', NULL::uuid, NULL::text; RETURN; END IF;
  SELECT * INTO v_profile FROM public.merchant_compliance_profiles p WHERE p.id = p_profile_id;
  IF NOT FOUND THEN RETURN QUERY SELECT 'canonical_request_profile_missing', NULL::uuid, NULL::text; RETURN; END IF;
  IF v_profile.plan_code NOT IN ('solo_lite','solo_plus','business') OR v_profile.row_version <= 0
    OR NOT COALESCE(
      (v_profile.plan_code='solo_lite' AND v_profile.compliance_status IN ('lite_pending','needs_attention'))
      OR (v_profile.plan_code='solo_plus' AND v_profile.compliance_status IN ('enhanced_pending','needs_attention'))
      OR (v_profile.plan_code='business' AND v_profile.compliance_status IN ('business_pending','needs_attention')),
      false
    )
    OR v_profile.decision_source_type NOT IN ('solo_lite_review','solo_plus_case','business_kyb_review') OR v_profile.decision_source_id IS NULL
    OR (v_profile.plan_code='solo_lite' AND v_profile.decision_source_type <> 'solo_lite_review') OR (v_profile.plan_code='solo_plus' AND v_profile.decision_source_type <> 'solo_plus_case') OR (v_profile.plan_code='business' AND v_profile.decision_source_type <> 'business_kyb_review') THEN
    RETURN QUERY SELECT 'canonical_request_profile_state_invalid', NULL::uuid, NULL::text; RETURN;
  END IF;
  RETURN QUERY SELECT 'canonical_request_workspace_linkage_unavailable', NULL::uuid, NULL::text; RETURN;
EXCEPTION WHEN OTHERS THEN RETURN QUERY SELECT 'canonical_request_failed',NULL::uuid,NULL::text;
END;
$issue_canonical_approval_decision_request_v1$;

CREATE OR REPLACE FUNCTION public.read_canonical_approval_snapshot_v1(p_decision_request_id uuid)
RETURNS TABLE(result_code text,decision_request_id uuid,decision_idempotency_key text,merchant_id uuid,workspace_id uuid,profile_id uuid,plan_code text,current_compliance_status text,source_type text,source_id uuid,source_version bigint,expected_profile_row_version bigint,policy_version text,reviewer_id uuid,reviewed_at timestamptz,reason_code text,target_compliance_status text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO pg_catalog, public
AS $read_canonical_approval_snapshot_v1$
DECLARE
  v_request public.approval_decision_requests%ROWTYPE; v_profile public.merchant_compliance_profiles%ROWTYPE;
BEGIN
  IF p_decision_request_id IS NULL THEN RETURN QUERY SELECT 'canonical_snapshot_payload_invalid',NULL::uuid,NULL::text,NULL::uuid,NULL::uuid,NULL::uuid,NULL::text,NULL::text,NULL::text,NULL::uuid,NULL::bigint,NULL::bigint,NULL::text,NULL::uuid,NULL::timestamptz,NULL::text,NULL::text; RETURN; END IF;
  SELECT * INTO v_request FROM public.approval_decision_requests r WHERE r.id=p_decision_request_id;
  IF NOT FOUND THEN RETURN QUERY SELECT 'canonical_snapshot_request_missing',NULL::uuid,NULL::text,NULL::uuid,NULL::uuid,NULL::uuid,NULL::text,NULL::text,NULL::text,NULL::uuid,NULL::bigint,NULL::bigint,NULL::text,NULL::uuid,NULL::timestamptz,NULL::text,NULL::text; RETURN; END IF;
  SELECT * INTO v_profile FROM public.merchant_compliance_profiles p WHERE p.id=v_request.profile_id AND p.merchant_id=v_request.merchant_id;
  IF NOT FOUND THEN RETURN QUERY SELECT 'canonical_snapshot_profile_missing',v_request.id,NULL::text,NULL::uuid,NULL::uuid,NULL::uuid,NULL::text,NULL::text,NULL::text,NULL::uuid,NULL::bigint,NULL::bigint,NULL::text,NULL::uuid,NULL::timestamptz,NULL::text,NULL::text; RETURN; END IF;
  IF v_profile.row_version<>v_request.expected_profile_row_version OR v_profile.plan_code<>v_request.plan_code OR NOT COALESCE(
    (v_profile.plan_code='solo_lite' AND v_profile.compliance_status IN ('lite_pending','needs_attention'))
    OR (v_profile.plan_code='solo_plus' AND v_profile.compliance_status IN ('enhanced_pending','needs_attention'))
    OR (v_profile.plan_code='business' AND v_profile.compliance_status IN ('business_pending','needs_attention')),
    false
  ) THEN
    RETURN QUERY SELECT 'canonical_snapshot_stale_or_conflicting',v_request.id,NULL::text,NULL::uuid,NULL::uuid,NULL::uuid,NULL::text,NULL::text,NULL::text,NULL::uuid,NULL::bigint,NULL::bigint,NULL::text,NULL::uuid,NULL::timestamptz,NULL::text,NULL::text; RETURN;
  END IF;
  RETURN QUERY SELECT 'canonical_snapshot_workspace_linkage_unavailable',v_request.id,NULL::text,NULL::uuid,NULL::uuid,NULL::uuid,NULL::text,NULL::text,NULL::text,NULL::uuid,NULL::bigint,NULL::bigint,NULL::text,NULL::uuid,NULL::timestamptz,NULL::text,NULL::text; RETURN;
EXCEPTION WHEN OTHERS THEN RETURN QUERY SELECT 'canonical_snapshot_failed',NULL::uuid,NULL::text,NULL::uuid,NULL::uuid,NULL::uuid,NULL::text,NULL::text,NULL::text,NULL::uuid,NULL::bigint,NULL::bigint,NULL::text,NULL::uuid,NULL::timestamptz,NULL::text,NULL::text;
END;
$read_canonical_approval_snapshot_v1$;

REVOKE ALL ON FUNCTION public.issue_canonical_approval_decision_request_v1(uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_canonical_approval_snapshot_v1(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_canonical_approval_decision_request_v1(uuid,uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_canonical_approval_snapshot_v1(uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
