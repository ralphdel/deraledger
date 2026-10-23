\set ON_ERROR_STOP on
-- Disposable instrumentation only. No helper is installed by the B2 migration.
CREATE TABLE public.b2_rehearsal_cases (
  scenario text PRIMARY KEY, merchant_id uuid NOT NULL, workspace_id uuid NOT NULL,
  profile_id uuid NOT NULL, review_id uuid NOT NULL, owner_id uuid NOT NULL,
  reviewer_id uuid NOT NULL, authority_merchant_id uuid NOT NULL,
  action_a text NOT NULL, action_b text NOT NULL,
  key_a text NOT NULL, key_b text NOT NULL, reason_b text NOT NULL,
  snapshot_a jsonb NOT NULL, snapshot_b jsonb NOT NULL,
  expected_version bigint NOT NULL, released boolean NOT NULL DEFAULT false,
  expected_reviews integer NOT NULL, expected_events integer NOT NULL
);
DO $fixtures$
DECLARE
  v record; v_n integer:=80; v_suffix text; v_owner uuid; v_admin uuid;
  v_merchant uuid; v_authority uuid; v_workspace uuid; v_profile uuid;
  v_snapshot jsonb; v_receipt jsonb; v_review uuid; v_key text; v_needs boolean;
BEGIN
  FOR v IN SELECT * FROM (VALUES
    ('rmi_same','rmi','rmi',true,false,1,2),
    ('rmi_changed','rmi','rmi',true,false,1,2),
    ('rmi_different','rmi','rmi',false,false,1,2),
    ('resubmit_same','resubmit','resubmit',true,true,2,4),
    ('resubmit_changed','resubmit','resubmit',true,true,2,4),
    ('resubmit_different','resubmit','resubmit',false,true,2,4),
    ('cross_pending','rmi','resubmit',false,false,1,2),
    ('cross_retry','rmi_replay','resubmit',false,true,2,4),
    ('authority_revoked','revoke','rmi',false,false,1,1),
    ('mixed_rmi','probe','rmi',false,false,1,3),
    ('mixed_resubmit','probe','resubmit',false,true,2,5)
  ) AS x(scenario,action_a,action_b,same_key,needs_attention,review_count,event_count)
  LOOP
    v_suffix:=pg_catalog.lpad(v_n::text,12,'0');
    v_owner:=('10000000-0000-4000-8000-'||v_suffix)::uuid;
    v_admin:=('60000000-0000-4000-8000-'||v_suffix)::uuid;
    v_merchant:=('20000000-0000-4000-8000-'||v_suffix)::uuid;
    v_authority:=('50000000-0000-4000-8000-'||v_suffix)::uuid;
    v_workspace:=('30000000-0000-4000-8000-'||v_suffix)::uuid;
    v_profile:=('40000000-0000-4000-8000-'||v_suffix)::uuid;
    INSERT INTO auth.users(id) VALUES(v_owner),(v_admin);
    INSERT INTO public.merchants(id,user_id,business_name,email,subscription_plan,is_super_admin)
    VALUES(v_merchant,v_owner,'B2 race','race@example.invalid','solo_lite',false),
      (v_authority,v_admin,'B2 authority','authority@example.invalid','starter',true);
    INSERT INTO public.workspaces(id,owner_user_id,merchant_id,display_name)
    VALUES(v_workspace,v_owner,v_merchant,'B2 race');
    INSERT INTO public.merchant_canonical_workspaces(merchant_id,workspace_id,reconcile_idempotency_key,created_by)
    VALUES(v_merchant,v_workspace,'b2-workspace-'||v.scenario,v_owner);
    INSERT INTO public.merchant_compliance_profiles(id,merchant_id,plan_code)
    VALUES(v_profile,v_merchant,'solo_lite');
    v_snapshot:=pg_catalog.jsonb_build_object(
      'schemaVersion','phase2c-review-v1','policyId','solo_lite_evidence',
      'policyVersion','2c-2b-draft-v1','policyStatus','draft','adapterVersion','2c-2b-v1',
      'evaluatedAt','2026-10-22T12:00:00Z','findings',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('code','legal_name','status','unknown',
          'reasonCode','evidence_unknown','sourceType',NULL,'sourceId',NULL,'sourceVersion',NULL)));
    v_receipt:=public.submit_draft_plan_review_v1(v_merchant,v_workspace,1,v_owner,
      '2c-2b-draft-v1',v_snapshot,'b2-seed-'||v.scenario);
    IF v_receipt->>'kind' IS DISTINCT FROM 'applied' THEN RAISE EXCEPTION 'B2_RACE_SEED:%',v.scenario; END IF;
    v_review:=(v_receipt->>'review_id')::uuid;
    INSERT INTO public.b2_rehearsal_artifact_baseline
    SELECT r.id,pg_catalog.to_jsonb(r)-ARRAY['review_status','decision_reason_code','decision_notes',
      'reviewed_by','reviewed_at','row_version','updated_at'] FROM public.merchant_compliance_reviews r
    WHERE r.id=v_review;
    v_key:='b2-race-'||v.scenario;
    v_needs:=v.needs_attention;
    IF v_needs THEN
      v_receipt:=public.request_draft_plan_review_correction_v1(v_merchant,v_workspace,v_profile,
        v_review,1,1,v_admin,'2c-2b-draft-v1','evidence_incomplete',ARRAY['legal_name'],
        CASE WHEN v.scenario='cross_retry' THEN v_key ELSE 'b2-seed-rmi-'||v.scenario END);
      IF v_receipt->>'kind' IS DISTINCT FROM 'applied' THEN RAISE EXCEPTION 'B2_RACE_RMI_SEED:%',v.scenario; END IF;
    END IF;
    INSERT INTO public.b2_rehearsal_cases VALUES(
      v.scenario,v_merchant,v_workspace,v_profile,v_review,v_owner,v_admin,v_authority,
      v.action_a,v.action_b,v_key,CASE WHEN v.same_key THEN v_key ELSE v_key||'-b' END,
      CASE WHEN v.scenario='rmi_changed' THEN 'evidence_mismatch' ELSE 'evidence_incomplete' END,
      pg_catalog.jsonb_set(v_snapshot,'{evaluatedAt}','"2026-10-22T13:00:00Z"'::jsonb),
      pg_catalog.jsonb_set(v_snapshot,'{evaluatedAt}',
        CASE WHEN v.scenario='resubmit_changed' THEN '"2026-10-22T14:00:00Z"'::jsonb
          ELSE '"2026-10-22T13:00:00Z"'::jsonb END),
      CASE WHEN v_needs THEN 2 ELSE 1 END,false,v.review_count,v.event_count);
    v_n:=v_n+1;
  END LOOP;
END;
$fixtures$;
GRANT SELECT ON public.b2_rehearsal_cases TO service_role;
CREATE FUNCTION public.b2_rehearsal_invoke(p_scenario text,p_worker text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $invoke$
DECLARE v_case public.b2_rehearsal_cases%ROWTYPE; v_action text; v_key text;
BEGIN
  IF p_worker NOT IN ('a','b') THEN RAISE EXCEPTION 'B2_WORKER_ID_INVALID'; END IF;
  SELECT * INTO STRICT v_case FROM public.b2_rehearsal_cases WHERE scenario=p_scenario;
  v_action:=CASE p_worker WHEN 'a' THEN v_case.action_a ELSE v_case.action_b END;
  v_key:=CASE p_worker WHEN 'a' THEN v_case.key_a ELSE v_case.key_b END;
  IF v_action IN ('rmi','rmi_replay') THEN
    RETURN public.request_draft_plan_review_correction_v1(v_case.merchant_id,v_case.workspace_id,
      v_case.profile_id,v_case.review_id,1,1,v_case.reviewer_id,'2c-2b-draft-v1',
      CASE p_worker WHEN 'a' THEN 'evidence_incomplete' ELSE v_case.reason_b END,
      ARRAY['legal_name'],v_key);
  ELSIF v_action='resubmit' THEN
    RETURN public.resubmit_corrected_draft_plan_review_v1(v_case.merchant_id,v_case.workspace_id,
      v_case.profile_id,v_case.review_id,v_case.expected_version,1,v_case.owner_id,
      '2c-2b-draft-v1',CASE p_worker WHEN 'a' THEN v_case.snapshot_a ELSE v_case.snapshot_b END,v_key);
  END IF;
  RAISE EXCEPTION 'B2_WORKER_ACTION_INVALID';
END;
$invoke$;
REVOKE ALL ON FUNCTION public.b2_rehearsal_invoke(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.b2_rehearsal_invoke(text,text) TO service_role;
-- Fingerprint WHOLE existing profile/workspace rows, including capability and version fields.
INSERT INTO public.b2_rehearsal_profile_baseline
SELECT p.id,pg_catalog.to_jsonb(p) FROM public.merchant_compliance_profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.b2_rehearsal_profile_baseline b WHERE b.id=p.id);
INSERT INTO public.b2_rehearsal_workspace_baseline
SELECT w.id,pg_catalog.to_jsonb(w) FROM public.workspaces w
WHERE NOT EXISTS (SELECT 1 FROM public.b2_rehearsal_workspace_baseline b WHERE b.id=w.id);
SELECT 'PASS|b2_concurrency_fixtures' AS result;
