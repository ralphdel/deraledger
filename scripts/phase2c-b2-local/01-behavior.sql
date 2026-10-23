\set ON_ERROR_STOP on

INSERT INTO auth.users(id) VALUES
  ('10000000-0000-4000-8000-000000000031'),
  ('10000000-0000-4000-8000-000000000032'),
  ('10000000-0000-4000-8000-000000000033'),
  ('10000000-0000-4000-8000-000000000034');
INSERT INTO public.merchants(id,user_id,business_name,email,subscription_plan,is_super_admin) VALUES
  ('20000000-0000-4000-8000-000000000031','10000000-0000-4000-8000-000000000031','B2 Lite','b2-lite@example.invalid','individual',false),
  ('20000000-0000-4000-8000-000000000032','10000000-0000-4000-8000-000000000032','B2 Reviewer','b2-reviewer@example.invalid','starter',true),
  ('20000000-0000-4000-8000-000000000033','10000000-0000-4000-8000-000000000033','B2 Business','b2-business@example.invalid','corporate',false),
  ('20000000-0000-4000-8000-000000000034','10000000-0000-4000-8000-000000000034','B2 Unprivileged','b2-unprivileged@example.invalid','starter',false);
INSERT INTO public.workspaces(id,owner_user_id,merchant_id,display_name) VALUES
  ('30000000-0000-4000-8000-000000000031','10000000-0000-4000-8000-000000000031','20000000-0000-4000-8000-000000000031','B2 Lite'),
  ('30000000-0000-4000-8000-000000000033','10000000-0000-4000-8000-000000000033','20000000-0000-4000-8000-000000000033','B2 Business');
INSERT INTO public.merchant_canonical_workspaces(merchant_id,workspace_id,reconcile_idempotency_key,created_by) VALUES
  ('20000000-0000-4000-8000-000000000031','30000000-0000-4000-8000-000000000031','b2-workspace-0031','10000000-0000-4000-8000-000000000031'),
  ('20000000-0000-4000-8000-000000000033','30000000-0000-4000-8000-000000000033','b2-workspace-0033','10000000-0000-4000-8000-000000000033');
INSERT INTO public.merchant_compliance_profiles(id,merchant_id,plan_code,row_version) VALUES
  ('40000000-0000-4000-8000-000000000031','20000000-0000-4000-8000-000000000031','solo_lite',1),
  ('40000000-0000-4000-8000-000000000033','20000000-0000-4000-8000-000000000033','business',1);
CREATE TABLE public.b2_rehearsal_profile_baseline AS
SELECT p.id,pg_catalog.to_jsonb(p) AS body FROM public.merchant_compliance_profiles p;
CREATE TABLE public.b2_rehearsal_workspace_baseline AS
SELECT w.id,pg_catalog.to_jsonb(w) AS body FROM public.workspaces w;
CREATE TABLE public.b2_rehearsal_artifact_baseline(id uuid PRIMARY KEY,body jsonb NOT NULL);
GRANT INSERT ON public.b2_rehearsal_artifact_baseline TO service_role;

CREATE FUNCTION public.phase2c_b2_rehearsal_fail_event_v1() RETURNS trigger
LANGUAGE plpgsql AS $failure$
BEGIN
  IF NEW.idempotency_key = 'b2-force-event-0033' THEN
    RAISE EXCEPTION 'B2_FORCED_EVENT_FAILURE';
  END IF;
  RETURN NEW;
END;
$failure$;
CREATE TRIGGER trg_phase2c_b2_rehearsal_fail_event_v1
BEFORE INSERT ON public.merchant_compliance_events
FOR EACH ROW EXECUTE FUNCTION public.phase2c_b2_rehearsal_fail_event_v1();

-- Calls run as the transport role, never as the migration owner.
SET ROLE service_role;
DO $behavior$
DECLARE
  v_lite jsonb := pg_catalog.jsonb_build_object(
    'schemaVersion','phase2c-review-v1','policyId','solo_lite_evidence',
    'policyVersion','2c-2b-draft-v1','policyStatus','draft',
    'adapterVersion','2c-2b-v1','evaluatedAt','2026-10-22T12:00:00Z',
    'findings',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'code','legal_name','status','unknown','reasonCode','evidence_unknown',
      'sourceType',NULL,'sourceId',NULL,'sourceVersion',NULL)));
  v_business jsonb := pg_catalog.jsonb_build_object(
    'schemaVersion','phase2c-review-v1','policyId','business_kyb_evidence',
    'policyVersion','2c-2b-draft-v1','policyStatus','draft',
    'adapterVersion','2c-2b-v1','evaluatedAt','2026-10-22T12:00:00Z',
    'findings',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'code','registration_number','status','unknown','reasonCode','evidence_unknown',
      'sourceType',NULL,'sourceId',NULL,'sourceVersion',NULL)));
  v_new_lite jsonb;
  v_new_business jsonb;
  v_lite_review uuid;
  v_business_review uuid;
  v_result jsonb;
  v_failed boolean := false;
BEGIN
  v_new_lite := pg_catalog.jsonb_set(v_lite, '{evaluatedAt}', '"2026-10-22T13:00:00Z"'::jsonb);
  v_new_business := pg_catalog.jsonb_set(v_business, '{evaluatedAt}', '"2026-10-22T13:00:00Z"'::jsonb);

  v_result := public.submit_draft_plan_review_v1(
    '20000000-0000-4000-8000-000000000031','30000000-0000-4000-8000-000000000031',1,
    '10000000-0000-4000-8000-000000000031','2c-2b-draft-v1',v_lite,'b2-submit-lite-0031');
  IF v_result ->> 'kind' IS DISTINCT FROM 'applied' THEN RAISE EXCEPTION 'B2_LITE_SUBMISSION_FAILED:%',v_result ->> 'kind'; END IF;
  v_lite_review := (v_result ->> 'review_id')::uuid;
  INSERT INTO public.b2_rehearsal_artifact_baseline
  SELECT r.id,pg_catalog.to_jsonb(r)-ARRAY['review_status','decision_reason_code','decision_notes',
    'reviewed_by','reviewed_at','row_version','updated_at'] FROM public.merchant_compliance_reviews r
  WHERE r.id=v_lite_review;
  v_result := public.request_draft_plan_review_correction_v1(
    '20000000-0000-4000-8000-000000000031','30000000-0000-4000-8000-000000000031',
    '40000000-0000-4000-8000-000000000031',v_lite_review,1,1,
    '10000000-0000-4000-8000-000000000034','2c-2b-draft-v1',
    'evidence_incomplete',ARRAY['legal_name'],'b2-unauthorized-0031');
  IF v_result ->> 'kind' IS DISTINCT FROM 'reviewer_unauthorized' THEN RAISE EXCEPTION 'B2_UNAUTHORIZED_REVIEWER_ACCEPTED'; END IF;
  v_result := public.request_draft_plan_review_correction_v1(
    '20000000-0000-4000-8000-000000000031','30000000-0000-4000-8000-000000000031',
    '40000000-0000-4000-8000-000000000031',v_lite_review,1,1,
    '10000000-0000-4000-8000-000000000032','2c-2b-draft-v1',
    'evidence_incomplete',ARRAY['legal_name'],'b2-rmi-lite-0031');
  IF v_result ->> 'kind' IS DISTINCT FROM 'applied' OR (v_result ->> 'row_version')::bigint <> 2 THEN
    RAISE EXCEPTION 'B2_LITE_RMI_FAILED:%',v_result ->> 'kind'; END IF;
  v_result := public.request_draft_plan_review_correction_v1(
    '20000000-0000-4000-8000-000000000031','30000000-0000-4000-8000-000000000031',
    '40000000-0000-4000-8000-000000000031',v_lite_review,1,1,
    '10000000-0000-4000-8000-000000000032','2c-2b-draft-v1',
    'evidence_incomplete',ARRAY['legal_name'],'b2-rmi-lite-0031');
  IF v_result ->> 'kind' IS DISTINCT FROM 'already_processed' THEN RAISE EXCEPTION 'B2_RMI_REPLAY_FAILED'; END IF;
  v_result := public.request_draft_plan_review_correction_v1(
    '20000000-0000-4000-8000-000000000031','30000000-0000-4000-8000-000000000031',
    '40000000-0000-4000-8000-000000000031',v_lite_review,1,1,
    '10000000-0000-4000-8000-000000000032','2c-2b-draft-v1',
    'evidence_mismatch',ARRAY['legal_name'],'b2-rmi-lite-0031');
  IF v_result ->> 'kind' IS DISTINCT FROM 'state_conflict' THEN RAISE EXCEPTION 'B2_RMI_CHANGED_REPLAY_ACCEPTED'; END IF;
  v_result := public.request_draft_plan_review_correction_v1(
    '20000000-0000-4000-8000-000000000031','30000000-0000-4000-8000-000000000031',
    '40000000-0000-4000-8000-000000000031',v_lite_review,1,1,
    '10000000-0000-4000-8000-000000000032','2c-2b-draft-v1',
    'evidence_incomplete',ARRAY['legal_name'],'b2-stale-review-0031');
  IF v_result ->> 'kind' IS DISTINCT FROM 'version_conflict' THEN RAISE EXCEPTION 'B2_STALE_REVIEW_VERSION_ACCEPTED'; END IF;
  v_result := public.request_draft_plan_review_correction_v1(
    '20000000-0000-4000-8000-000000000031','30000000-0000-4000-8000-000000000031',
    '40000000-0000-4000-8000-000000000031',v_lite_review,2,2,
    '10000000-0000-4000-8000-000000000032','2c-2b-draft-v1',
    'evidence_incomplete',ARRAY['legal_name'],'b2-stale-profile-0031');
  IF v_result ->> 'kind' IS DISTINCT FROM 'version_conflict' THEN RAISE EXCEPTION 'B2_STALE_PROFILE_VERSION_ACCEPTED'; END IF;
  v_result := public.resubmit_corrected_draft_plan_review_v1(
    '20000000-0000-4000-8000-000000000031','30000000-0000-4000-8000-000000000031',
    '40000000-0000-4000-8000-000000000031',v_lite_review,2,1,
    '10000000-0000-4000-8000-000000000031','2c-2b-draft-v1',v_new_lite,'b2-resubmit-lite-0031');
  IF v_result ->> 'kind' IS DISTINCT FROM 'applied' OR (v_result ->> 'old_row_version')::bigint <> 3
    OR (v_result ->> 'new_row_version')::bigint <> 1 THEN RAISE EXCEPTION 'B2_LITE_RESUBMIT_FAILED:%',v_result ->> 'kind'; END IF;
  v_result := public.resubmit_corrected_draft_plan_review_v1(
    '20000000-0000-4000-8000-000000000031','30000000-0000-4000-8000-000000000031',
    '40000000-0000-4000-8000-000000000031',v_lite_review,2,1,
    '10000000-0000-4000-8000-000000000031','2c-2b-draft-v1',v_new_lite,'b2-resubmit-lite-0031');
  IF v_result ->> 'kind' IS DISTINCT FROM 'already_processed' THEN RAISE EXCEPTION 'B2_RESUBMIT_REPLAY_FAILED:%',v_result ->> 'kind'; END IF;
  v_result := public.resubmit_corrected_draft_plan_review_v1(
    '20000000-0000-4000-8000-000000000031','30000000-0000-4000-8000-000000000031',
    '40000000-0000-4000-8000-000000000031',v_lite_review,2,1,
    '10000000-0000-4000-8000-000000000031','2c-2b-draft-v1',
    pg_catalog.jsonb_set(v_new_lite,'{evaluatedAt}','"2026-10-22T14:00:00Z"'::jsonb),
    'b2-resubmit-lite-0031');
  IF v_result ->> 'kind' IS DISTINCT FROM 'state_conflict' THEN RAISE EXCEPTION 'B2_RESUBMIT_CHANGED_REPLAY_ACCEPTED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.merchant_compliance_reviews
      WHERE id=v_lite_review AND evidence_snapshot=v_lite AND review_status='cancelled'
        AND decision_reason_code='superseded_by_corrected_submission')
    OR NOT EXISTS (SELECT 1 FROM public.merchant_compliance_reviews
      WHERE merchant_id='20000000-0000-4000-8000-000000000031'
        AND id<>v_lite_review AND evidence_snapshot=v_new_lite AND review_status='pending') THEN
    RAISE EXCEPTION 'B2_OLD_SNAPSHOT_OR_REPLACEMENT_NOT_PRESERVED';
  END IF;
  v_result := public.request_draft_plan_review_correction_v1(
    '20000000-0000-4000-8000-000000000031','30000000-0000-4000-8000-000000000031',
    '40000000-0000-4000-8000-000000000031',v_lite_review,1,1,
    '10000000-0000-4000-8000-000000000032','2c-2b-draft-v1',
    'evidence_incomplete',ARRAY['legal_name'],'b2-rmi-lite-0031');
  IF v_result ->> 'kind' IS DISTINCT FROM 'already_processed' THEN
    RAISE EXCEPTION 'B2_HISTORICAL_RMI_REPLAY_FAILED';
  END IF;

  v_result := public.submit_draft_plan_review_v1(
    '20000000-0000-4000-8000-000000000033','30000000-0000-4000-8000-000000000033',1,
    '10000000-0000-4000-8000-000000000033','2c-2b-draft-v1',v_business,'b2-submit-business-0033');
  IF v_result ->> 'kind' IS DISTINCT FROM 'applied' THEN RAISE EXCEPTION 'B2_BUSINESS_SUBMISSION_FAILED:%',v_result ->> 'kind'; END IF;
  v_business_review := (v_result ->> 'review_id')::uuid;
  INSERT INTO public.b2_rehearsal_artifact_baseline
  SELECT r.id,pg_catalog.to_jsonb(r)-ARRAY['review_status','decision_reason_code','decision_notes',
    'reviewed_by','reviewed_at','row_version','updated_at'] FROM public.merchant_compliance_reviews r
  WHERE r.id=v_business_review;
  v_result := public.request_draft_plan_review_correction_v1(
    '20000000-0000-4000-8000-000000000033','30000000-0000-4000-8000-000000000033',
    '40000000-0000-4000-8000-000000000033',v_business_review,1,1,
    '10000000-0000-4000-8000-000000000032','2c-2b-draft-v1',
    'evidence_incomplete',ARRAY['registration_number'],'b2-rmi-business-0033');
  IF v_result ->> 'kind' IS DISTINCT FROM 'applied' THEN RAISE EXCEPTION 'B2_BUSINESS_RMI_FAILED:%',v_result ->> 'kind'; END IF;
  BEGIN
    v_result := public.resubmit_corrected_draft_plan_review_v1(
      '20000000-0000-4000-8000-000000000033','30000000-0000-4000-8000-000000000033',
      '40000000-0000-4000-8000-000000000033',v_business_review,2,1,
      '10000000-0000-4000-8000-000000000033','2c-2b-draft-v1',v_new_business,'b2-force-event-0033');
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'B2_FORCED_EVENT_FAILURE';
  END;
  IF NOT v_failed OR NOT EXISTS (SELECT 1 FROM public.merchant_compliance_reviews
      WHERE id=v_business_review AND review_status='needs_attention' AND row_version=2)
    OR (SELECT count(*) FROM public.merchant_compliance_reviews
      WHERE merchant_id='20000000-0000-4000-8000-000000000033') <> 1
    OR EXISTS (SELECT 1 FROM public.merchant_compliance_events
      WHERE merchant_id='20000000-0000-4000-8000-000000000033'
        AND idempotency_key IN ('b2-force-event-0033','b2-force-event-0033:new')) THEN
    RAISE EXCEPTION 'B2_SUPERSESSION_EVENT_ROLLBACK_FAILED';
  END IF;
  v_failed := false;
  v_result := public.resubmit_corrected_draft_plan_review_v1(
    '20000000-0000-4000-8000-000000000033','30000000-0000-4000-8000-000000000033',
    '40000000-0000-4000-8000-000000000033',v_business_review,2,1,
    '10000000-0000-4000-8000-000000000033','2c-2b-draft-v1',v_new_business,'b2-resubmit-business-0033');
  IF v_result ->> 'kind' IS DISTINCT FROM 'applied' THEN RAISE EXCEPTION 'B2_BUSINESS_RESUBMIT_FAILED:%',v_result ->> 'kind'; END IF;

  -- Exercise an injected late event failure on the replacement Business review.
  BEGIN
    v_result := public.request_draft_plan_review_correction_v1(
      '20000000-0000-4000-8000-000000000033','30000000-0000-4000-8000-000000000033',
      '40000000-0000-4000-8000-000000000033',
      (SELECT id FROM public.merchant_compliance_reviews WHERE merchant_id='20000000-0000-4000-8000-000000000033'
        AND review_status='pending'),1,1,
      '10000000-0000-4000-8000-000000000032','2c-2b-draft-v1',
      'evidence_incomplete',ARRAY['registration_number'],'b2-force-event-0033');
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'B2_FORCED_EVENT_FAILURE';
  END;
  IF NOT v_failed OR (SELECT count(*) FROM public.merchant_compliance_reviews
      WHERE merchant_id='20000000-0000-4000-8000-000000000033' AND review_status='pending') <> 1
    OR EXISTS (SELECT 1 FROM public.merchant_compliance_events WHERE idempotency_key='b2-force-event-0033') THEN
    RAISE EXCEPTION 'B2_EVENT_ROLLBACK_FAILED';
  END IF;
  BEGIN
    UPDATE public.merchant_compliance_reviews SET decision_notes='not allowed' WHERE false;
    RAISE EXCEPTION 'B2_DIRECT_SERVICE_ROLE_UPDATE_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$behavior$;
RESET ROLE;

-- Owner-only, disposable-harness verification. This block is read-only and
-- intentionally runs after the service-role transport/ACL tests complete.
DO $owner_verification$
BEGIN
  IF (SELECT count(*) FROM public.merchant_compliance_reviews WHERE merchant_id IN
      ('20000000-0000-4000-8000-000000000031','20000000-0000-4000-8000-000000000033')) <> 4
    OR (SELECT count(*) FROM public.merchant_compliance_reviews WHERE review_status='pending') <> 2
    OR (SELECT count(*) FROM public.merchant_compliance_reviews WHERE review_status='cancelled'
      AND decision_reason_code='superseded_by_corrected_submission') <> 2
    OR (SELECT count(*) FROM public.merchant_compliance_events WHERE merchant_id IN
      ('20000000-0000-4000-8000-000000000031','20000000-0000-4000-8000-000000000033')) <> 8
    OR (SELECT count(*) FROM public.merchant_compliance_events
      WHERE event_type='phase2c_draft_review_submit_v1') <> 4
    OR (SELECT count(*) FROM public.merchant_compliance_events
      WHERE event_type='phase2c_draft_review_needs_attention_v1') <> 2
    OR (SELECT count(*) FROM public.merchant_compliance_events
      WHERE event_type='phase2c_draft_review_superseded_v1') <> 2
    OR EXISTS (SELECT 1 FROM public.merchant_compliance_events e
      JOIN public.merchant_compliance_reviews r ON r.id=e.source_id
      WHERE e.event_type IN ('phase2c_draft_review_submit_v1',
        'phase2c_draft_review_needs_attention_v1','phase2c_draft_review_superseded_v1')
        AND (e.merchant_id<>r.merchant_id OR e.profile_id<>r.profile_id
          OR e.resulting_row_version>r.row_version))
    OR EXISTS (SELECT 1 FROM public.merchant_compliance_profiles WHERE merchant_id IN
      ('20000000-0000-4000-8000-000000000031','20000000-0000-4000-8000-000000000033')
      AND (row_version <> 1 OR compliance_status <> 'draft' OR activation_status <> 'test_mode'
        OR can_collect_payments OR can_activate_settlement))
    OR EXISTS (SELECT 1 FROM public.workspaces WHERE merchant_id IN
      ('20000000-0000-4000-8000-000000000031','20000000-0000-4000-8000-000000000033')
      AND (NOT setup_mode OR live_features_enabled)) THEN
    RAISE EXCEPTION 'B2_PERSISTENCE_OR_PROFILE_FIREWALL_FAILED';
  END IF;
END;
$owner_verification$;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET ROLE service_role;
DO $unsupported_isolation$
DECLARE v_result jsonb;
BEGIN
  v_result := public.request_draft_plan_review_correction_v1(
    '20000000-0000-4000-8000-000000000033','30000000-0000-4000-8000-000000000033',
    '40000000-0000-4000-8000-000000000033',
    (SELECT id FROM public.merchant_compliance_reviews WHERE merchant_id='20000000-0000-4000-8000-000000000033'
      AND review_status='pending'),1,1,
    '10000000-0000-4000-8000-000000000032','2c-2b-draft-v1',
    'evidence_incomplete',ARRAY['registration_number'],'b2-repeatable-read-0033');
  IF v_result ->> 'kind' IS DISTINCT FROM 'unsupported_isolation' THEN
    RAISE EXCEPTION 'B2_REPEATABLE_READ_NOT_REJECTED';
  END IF;
  v_result:=public.resubmit_corrected_draft_plan_review_v1(
    NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
  IF v_result->>'kind' IS DISTINCT FROM 'unsupported_isolation' THEN
    RAISE EXCEPTION 'B2_RESUBMIT_REPEATABLE_READ_NOT_REJECTED';
  END IF;
END;
$unsupported_isolation$;
ROLLBACK;

BEGIN ISOLATION LEVEL SERIALIZABLE;
SET ROLE service_role;
DO $unsupported_isolation$
DECLARE v_result jsonb;
BEGIN
  v_result := public.resubmit_corrected_draft_plan_review_v1(
    '20000000-0000-4000-8000-000000000033','30000000-0000-4000-8000-000000000033',
    '40000000-0000-4000-8000-000000000033',
    (SELECT id FROM public.merchant_compliance_reviews WHERE merchant_id='20000000-0000-4000-8000-000000000033'
      AND review_status='cancelled'),2,1,
    '10000000-0000-4000-8000-000000000033','2c-2b-draft-v1',
    pg_catalog.jsonb_build_object('invalid','diagnostic'),'b2-serializable-0033');
  IF v_result ->> 'kind' IS DISTINCT FROM 'unsupported_isolation' THEN
    RAISE EXCEPTION 'B2_SERIALIZABLE_NOT_REJECTED';
  END IF;
  v_result:=public.request_draft_plan_review_correction_v1(
    NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
  IF v_result->>'kind' IS DISTINCT FROM 'unsupported_isolation' THEN
    RAISE EXCEPTION 'B2_RMI_SERIALIZABLE_NOT_REJECTED';
  END IF;
END;
$unsupported_isolation$;
ROLLBACK;

DO $security$
BEGIN
  IF has_table_privilege('service_role','public.merchant_compliance_reviews','UPDATE')
    OR has_function_privilege('anon',
      'public.request_draft_plan_review_correction_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,text,text[],text)','EXECUTE')
    OR has_function_privilege('authenticated',
      'public.resubmit_corrected_draft_plan_review_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,jsonb,text)','EXECUTE')
    OR NOT has_function_privilege('service_role',
      'public.request_draft_plan_review_correction_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,text,text[],text)','EXECUTE')
    OR NOT has_function_privilege('service_role',
      'public.resubmit_corrected_draft_plan_review_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,jsonb,text)','EXECUTE') THEN
    RAISE EXCEPTION 'B2_ACL_FAILED';
  END IF;
END;
$security$;
SELECT 'PASS|b2_draft_triage_resubmission_behavior' AS result;
