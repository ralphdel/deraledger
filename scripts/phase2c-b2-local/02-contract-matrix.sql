\set ON_ERROR_STOP on
-- All additional fixtures and positive mutations are rolled back, so this matrix
-- contributes ZERO to the durable behavior/concurrency arithmetic.
BEGIN;
UPDATE auth.users SET raw_app_meta_data='{"is_super_admin":true}'::jsonb
WHERE id='10000000-0000-4000-8000-000000000034';
CREATE TABLE public.b2_matrix_cases (
  merchant_id uuid,workspace_id uuid,profile_id uuid,review_id uuid,owner_id uuid,snapshot jsonb
);
DO $seed$
DECLARE v_result jsonb; v_snapshot jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES('10000000-0000-4000-8000-000000000060');
  INSERT INTO public.merchants(id,user_id,business_name,email,subscription_plan)
  VALUES('20000000-0000-4000-8000-000000000060','10000000-0000-4000-8000-000000000060',
    'Matrix','matrix@example.invalid','solo_lite');
  INSERT INTO public.workspaces(id,owner_user_id,merchant_id,display_name)
  VALUES('30000000-0000-4000-8000-000000000060','10000000-0000-4000-8000-000000000060',
    '20000000-0000-4000-8000-000000000060','Matrix');
  INSERT INTO public.merchant_canonical_workspaces(merchant_id,workspace_id,reconcile_idempotency_key,created_by)
  VALUES('20000000-0000-4000-8000-000000000060','30000000-0000-4000-8000-000000000060',
    'b2-matrix-workspace','10000000-0000-4000-8000-000000000060');
  INSERT INTO public.merchant_compliance_profiles(id,merchant_id,plan_code)
  VALUES('40000000-0000-4000-8000-000000000060','20000000-0000-4000-8000-000000000060','solo_lite');
  v_snapshot:=pg_catalog.jsonb_build_object(
    'schemaVersion','phase2c-review-v1','policyId','solo_lite_evidence','policyVersion','2c-2b-draft-v1',
    'policyStatus','draft','adapterVersion','2c-2b-v1','evaluatedAt','2026-10-22T12:00:00Z',
    'findings',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('code','legal_name','status','unknown','reasonCode','evidence_unknown',
        'sourceType',NULL,'sourceId',NULL,'sourceVersion',NULL),
      pg_catalog.jsonb_build_object('code','phone','status','unknown','reasonCode','evidence_unknown',
        'sourceType',NULL,'sourceId',NULL,'sourceVersion',NULL)));
  v_result:=public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000060',
    '30000000-0000-4000-8000-000000000060',1,'10000000-0000-4000-8000-000000000060',
    '2c-2b-draft-v1',v_snapshot,'b2-matrix-submit');
  IF v_result->>'kind' IS DISTINCT FROM 'applied' THEN RAISE EXCEPTION 'B2_MATRIX_SETUP_FAILED'; END IF;
  INSERT INTO public.b2_matrix_cases VALUES('20000000-0000-4000-8000-000000000060',
    '30000000-0000-4000-8000-000000000060','40000000-0000-4000-8000-000000000060',
    (v_result->>'review_id')::uuid,'10000000-0000-4000-8000-000000000060',v_snapshot);
END;
$seed$;
GRANT SELECT ON public.b2_matrix_cases TO service_role;
SET LOCAL ROLE service_role;
DO $matrix$
DECLARE c public.b2_matrix_cases%ROWTYPE; v_result jsonb; v_codes text[];
  v_snapshot jsonb; v_bad jsonb; v_n integer:=0;
BEGIN
  SELECT * INTO STRICT c FROM public.b2_matrix_cases;
  -- Owners and app-metadata-only actors have no persisted platform authority.
  v_result:=public.request_draft_plan_review_correction_v1(c.merchant_id,c.workspace_id,c.profile_id,
    c.review_id,1,1,c.owner_id,'2c-2b-draft-v1','evidence_incomplete',ARRAY['legal_name'],'b2-matrix-owner');
  IF v_result->>'kind' IS DISTINCT FROM 'reviewer_unauthorized' THEN RAISE EXCEPTION 'B2_OWNER_AS_REVIEWER'; END IF;
  PERFORM pg_catalog.set_config('request.jwt.claims','{"app_metadata":{"is_super_admin":true}}',true);
  v_result:=public.request_draft_plan_review_correction_v1(c.merchant_id,c.workspace_id,c.profile_id,
    c.review_id,1,1,'10000000-0000-4000-8000-000000000034','2c-2b-draft-v1',
    'evidence_incomplete',ARRAY['legal_name'],'b2-matrix-metadata');
  IF v_result->>'kind' IS DISTINCT FROM 'reviewer_unauthorized' THEN RAISE EXCEPTION 'B2_METADATA_AUTHORITY'; END IF;
  FOR v_bad IN SELECT value FROM pg_catalog.jsonb_array_elements(
    '[null,[],["unknown"],["legal_name","legal_name"]]'::jsonb) LOOP
    v_codes:=CASE WHEN v_bad='null'::jsonb THEN NULL ELSE
      ARRAY(SELECT value FROM pg_catalog.jsonb_array_elements_text(v_bad)) END;
    v_result:=public.request_draft_plan_review_correction_v1(c.merchant_id,c.workspace_id,c.profile_id,
      c.review_id,1,1,'10000000-0000-4000-8000-000000000032','2c-2b-draft-v1',
      'evidence_incomplete',v_codes,'b2-matrix-bad-codes');
    IF v_result->>'kind' IS DISTINCT FROM 'invalid_transition' THEN RAISE EXCEPTION 'B2_FINDING_SHAPE_ACCEPTED'; END IF;
  END LOOP;
  v_result:=public.request_draft_plan_review_correction_v1(c.merchant_id,c.workspace_id,c.profile_id,
    c.review_id,1,1,'10000000-0000-4000-8000-000000000032','2c-2b-draft-v1',
    'evidence_incomplete',ARRAY[['legal_name'],['phone']],'b2-matrix-multidim');
  IF v_result->>'kind' IS DISTINCT FROM 'invalid_transition' THEN RAISE EXCEPTION 'B2_MULTIDIM_CODES'; END IF;
  v_result:=public.request_draft_plan_review_correction_v1(c.merchant_id,c.workspace_id,c.profile_id,
    c.review_id,1,1,'10000000-0000-4000-8000-000000000032','2c-2b-draft-v1',
    'evidence_incomplete',pg_catalog.array_fill('legal_name'::text,ARRAY[33]),'b2-matrix-excessive');
  IF v_result->>'kind' IS DISTINCT FROM 'invalid_transition' THEN RAISE EXCEPTION 'B2_EXCESSIVE_CODES'; END IF;
  v_result:=public.request_draft_plan_review_correction_v1(c.merchant_id,c.workspace_id,c.profile_id,
    c.review_id,1,1,'10000000-0000-4000-8000-000000000032','2c-2b-draft-v1',
    'arbitrary free text',ARRAY['legal_name'],'b2-matrix-reason');
  IF v_result->>'kind' IS DISTINCT FROM 'invalid_transition' THEN RAISE EXCEPTION 'B2_UNKNOWN_REASON'; END IF;
  v_result:=public.request_draft_plan_review_correction_v1(c.merchant_id,
    '30000000-0000-4000-8000-000000000031',c.profile_id,
    c.review_id,1,1,'10000000-0000-4000-8000-000000000032','2c-2b-draft-v1',
    'evidence_incomplete',ARRAY['legal_name'],'b2-matrix-workspace');
  IF v_result->>'kind' IS DISTINCT FROM 'state_conflict' THEN RAISE EXCEPTION 'B2_WRONG_WORKSPACE'; END IF;
  v_result:=public.request_draft_plan_review_correction_v1(c.merchant_id,c.workspace_id,c.profile_id,
    c.review_id,1,1,'10000000-0000-4000-8000-000000000032','2c-2b-draft-v1',
    'evidence_incomplete',ARRAY['phone','legal_name'],'b2-rmi-lite-0031');
  IF v_result->>'kind' IS DISTINCT FROM 'applied' THEN RAISE EXCEPTION 'B2_MERCHANT_SCOPED_KEY'; END IF;
  v_result:=public.request_draft_plan_review_correction_v1(c.merchant_id,c.workspace_id,c.profile_id,
    c.review_id,1,1,'10000000-0000-4000-8000-000000000032','2c-2b-draft-v1',
    'evidence_incomplete',ARRAY['legal_name','phone'],'b2-rmi-lite-0031');
  IF v_result->>'kind' IS DISTINCT FROM 'already_processed' THEN RAISE EXCEPTION 'B2_CODE_ORDER_REPLAY'; END IF;
  v_snapshot:=pg_catalog.jsonb_set(c.snapshot,'{evaluatedAt}','"2026-10-22T13:00:00Z"'::jsonb);
  FOR v_bad IN SELECT value FROM (VALUES
    ('{}'::jsonb),
    (pg_catalog.jsonb_set(v_snapshot,'{policyId}','"business_kyb_evidence"'::jsonb)),
    (pg_catalog.jsonb_set(v_snapshot,'{policyVersion}','"future-approved-v1"'::jsonb)),
    (pg_catalog.jsonb_set(v_snapshot,'{policyStatus}','"approved"'::jsonb)),
    (pg_catalog.jsonb_set(v_snapshot,'{schemaVersion}','"wrong"'::jsonb)),
    (pg_catalog.jsonb_set(v_snapshot,'{adapterVersion}','"wrong"'::jsonb)),
    (v_snapshot||pg_catalog.jsonb_build_object('extra',pg_catalog.repeat('x',17000)))
  ) AS invalid(value) LOOP
    v_n:=v_n+1;
    v_result:=public.resubmit_corrected_draft_plan_review_v1(c.merchant_id,c.workspace_id,c.profile_id,
      c.review_id,2,1,c.owner_id,'2c-2b-draft-v1',v_bad,'b2-matrix-invalid-'||v_n);
    IF v_result->>'kind' IS DISTINCT FROM 'evidence_conflict'
      OR NOT EXISTS (SELECT 1 FROM public.merchant_compliance_reviews
        WHERE id=c.review_id AND review_status='needs_attention' AND row_version=2)
      OR (SELECT count(*) FROM public.merchant_compliance_reviews WHERE merchant_id=c.merchant_id)<>1 THEN
      RAISE EXCEPTION 'B2_NESTED_BOUNDED_RESULT_COMMITTED:%',v_n;
    END IF;
  END LOOP;
  v_result:=public.resubmit_corrected_draft_plan_review_v1(c.merchant_id,c.workspace_id,c.profile_id,
    c.review_id,2,1,c.owner_id,'2c-2b-draft-v1',v_snapshot,'b2-resubmit-lite-0031');
  IF v_result->>'kind' IS DISTINCT FROM 'applied' THEN RAISE EXCEPTION 'B2_RESUBMIT_MERCHANT_SCOPED_KEY'; END IF;
  v_result:=public.resubmit_corrected_draft_plan_review_v1(c.merchant_id,c.workspace_id,c.profile_id,
    c.review_id,2,1,c.owner_id,'2c-2b-draft-v1',v_snapshot,'b2-resubmit-lite-0031');
  IF v_result->>'kind' IS DISTINCT FROM 'already_processed' THEN RAISE EXCEPTION 'B2_MATRIX_RESUBMIT_REPLAY'; END IF;
  -- Current outer receipts, not current lifecycle state, determine historical replay.
  v_result:=public.resubmit_corrected_draft_plan_review_v1(
    '20000000-0000-4000-8000-000000000031','30000000-0000-4000-8000-000000000031',
    '40000000-0000-4000-8000-000000000031',
    (SELECT id FROM public.merchant_compliance_reviews
      WHERE merchant_id='20000000-0000-4000-8000-000000000031' AND review_status='cancelled'),
    3,1,'10000000-0000-4000-8000-000000000031','2c-2b-draft-v1',
    (SELECT evidence_snapshot FROM public.merchant_compliance_reviews
      WHERE merchant_id='20000000-0000-4000-8000-000000000031' AND review_status='pending'),
    'b2-resubmit-lite-0031');
  IF v_result->>'kind' IS DISTINCT FROM 'state_conflict' THEN RAISE EXCEPTION 'B2_CHANGED_VERSION_REPLAY'; END IF;
END;
$matrix$;
RESET ROLE;
-- Privileged tampering is rolled back per subtransaction; malformed receipts never replay.
DO $receipts$
DECLARE v_review uuid; v_new_event uuid; v_snapshot jsonb; v_result jsonb; v_field text; v_plan text;
BEGIN
  SELECT id INTO STRICT v_review FROM public.merchant_compliance_reviews
  WHERE merchant_id='20000000-0000-4000-8000-000000000031' AND review_status='cancelled';
  SELECT id INTO STRICT v_new_event FROM public.merchant_compliance_events
  WHERE merchant_id='20000000-0000-4000-8000-000000000031' AND idempotency_key='b2-resubmit-lite-0031:new';
  SELECT evidence_snapshot INTO STRICT v_snapshot FROM public.merchant_compliance_reviews
  WHERE merchant_id='20000000-0000-4000-8000-000000000031' AND review_status='pending';
  FOREACH v_field IN ARRAY ARRAY['profile','source','actor','policy','version','from_state',
    'metadata','expected','reason','to_state','type','notes'] LOOP
    BEGIN
      UPDATE public.merchant_compliance_events SET
        profile_id=CASE WHEN v_field='profile' THEN '40000000-0000-4000-8000-000000000033'::uuid ELSE profile_id END,
        source_id=CASE WHEN v_field='source' THEN v_review ELSE source_id END,
        actor_id=CASE WHEN v_field='actor' THEN '10000000-0000-4000-8000-000000000034'::uuid ELSE actor_id END,
        policy_version=CASE WHEN v_field='policy' THEN 'wrong' ELSE policy_version END,
        resulting_row_version=CASE WHEN v_field='version' THEN 2 ELSE resulting_row_version END,
        expected_row_version=CASE WHEN v_field='expected' THEN 1 ELSE expected_row_version END,
        reason_code=CASE WHEN v_field='reason' THEN 'evidence_incomplete' ELSE reason_code END,
        event_type=CASE WHEN v_field='type' THEN 'wrong_submission' ELSE event_type END,
        notes=CASE WHEN v_field='notes' THEN 'not canonical' ELSE notes END,
        to_state=CASE WHEN v_field='to_state' THEN '{"review_status":"draft"}'::jsonb ELSE to_state END,
        from_state=CASE WHEN v_field='from_state' THEN '{"review_status":"draft"}'::jsonb ELSE from_state END,
        metadata=CASE WHEN v_field='metadata' THEN '{}'::jsonb ELSE metadata END
      WHERE id=v_new_event;
      v_result:=public.resubmit_corrected_draft_plan_review_v1(
        '20000000-0000-4000-8000-000000000031','30000000-0000-4000-8000-000000000031',
        '40000000-0000-4000-8000-000000000031',v_review,2,1,
        '10000000-0000-4000-8000-000000000031','2c-2b-draft-v1',v_snapshot,'b2-resubmit-lite-0031');
      IF v_result->>'kind' IS DISTINCT FROM 'state_conflict' THEN RAISE EXCEPTION 'B2_TAMPERED_REPLAY:%',v_field; END IF;
      RAISE EXCEPTION USING ERRCODE='P2T01',MESSAGE='restore tamper fixture';
    EXCEPTION WHEN SQLSTATE 'P2T01' THEN NULL;
    END;
  END LOOP;
  FOREACH v_plan IN ARRAY ARRAY['starter','solo_plus','unknown'] LOOP
    BEGIN
      UPDATE public.merchants SET subscription_plan=v_plan
      WHERE id='20000000-0000-4000-8000-000000000031';
      v_result:=public.request_draft_plan_review_correction_v1(
        '20000000-0000-4000-8000-000000000031','30000000-0000-4000-8000-000000000031',
        '40000000-0000-4000-8000-000000000031',v_review,1,1,
        '10000000-0000-4000-8000-000000000032','2c-2b-draft-v1',
        'evidence_incomplete',ARRAY['legal_name'],'b2-rmi-lite-0031');
      IF v_result->>'kind' IS DISTINCT FROM 'state_conflict' THEN RAISE EXCEPTION 'B2_UNSUPPORTED_PLAN:%',v_plan; END IF;
      v_result:=public.resubmit_corrected_draft_plan_review_v1(
        '20000000-0000-4000-8000-000000000031','30000000-0000-4000-8000-000000000031',
        '40000000-0000-4000-8000-000000000031',v_review,2,1,
        '10000000-0000-4000-8000-000000000031','2c-2b-draft-v1',v_snapshot,'b2-resubmit-lite-0031');
      IF v_result->>'kind' IS DISTINCT FROM 'state_conflict' THEN RAISE EXCEPTION 'B2_UNSUPPORTED_RESUBMIT_PLAN:%',v_plan; END IF;
      RAISE EXCEPTION USING ERRCODE='P2T01',MESSAGE='restore plan fixture';
    EXCEPTION WHEN SQLSTATE 'P2T01' THEN NULL;
    END;
  END LOOP;
  -- Equivalent canonical aliases replay the original individual/corporate operations.
  UPDATE public.merchants SET subscription_plan='solo_lite'
  WHERE id='20000000-0000-4000-8000-000000000031';
  v_result:=public.resubmit_corrected_draft_plan_review_v1(
    '20000000-0000-4000-8000-000000000031','30000000-0000-4000-8000-000000000031',
    '40000000-0000-4000-8000-000000000031',v_review,2,1,
    '10000000-0000-4000-8000-000000000031','2c-2b-draft-v1',v_snapshot,'b2-resubmit-lite-0031');
  IF v_result->>'kind' IS DISTINCT FROM 'already_processed' THEN RAISE EXCEPTION 'B2_LITE_ALIAS_REPLAY'; END IF;
  UPDATE public.merchants SET subscription_plan='business'
  WHERE id='20000000-0000-4000-8000-000000000033';
  v_result:=public.resubmit_corrected_draft_plan_review_v1(
    '20000000-0000-4000-8000-000000000033','30000000-0000-4000-8000-000000000033',
    '40000000-0000-4000-8000-000000000033',
    (SELECT id FROM public.merchant_compliance_reviews
      WHERE merchant_id='20000000-0000-4000-8000-000000000033' AND review_status='cancelled'),2,1,
    '10000000-0000-4000-8000-000000000033','2c-2b-draft-v1',
    (SELECT evidence_snapshot FROM public.merchant_compliance_reviews
      WHERE merchant_id='20000000-0000-4000-8000-000000000033' AND review_status='pending'),
    'b2-resubmit-business-0033');
  IF v_result->>'kind' IS DISTINCT FROM 'already_processed' THEN RAISE EXCEPTION 'B2_BUSINESS_ALIAS_REPLAY'; END IF;
  BEGIN
    UPDATE public.merchant_compliance_reviews SET evidence_snapshot='{}'::jsonb WHERE id=v_review;
    RAISE EXCEPTION 'B2_OLD_SNAPSHOT_MUTATION_ALLOWED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'Submitted review source is immutable' THEN RAISE; END IF;
  END;
END;
$receipts$;
SET LOCAL ROLE anon;
DO $acl$
BEGIN
  BEGIN PERFORM public.request_draft_plan_review_correction_v1(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
    RAISE EXCEPTION 'B2_ANON_RMI_ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.resubmit_corrected_draft_plan_review_v1(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
    RAISE EXCEPTION 'B2_ANON_RESUBMIT_ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$acl$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $acl$
BEGIN
  BEGIN PERFORM public.request_draft_plan_review_correction_v1(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
    RAISE EXCEPTION 'B2_AUTH_RMI_ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.resubmit_corrected_draft_plan_review_v1(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
    RAISE EXCEPTION 'B2_AUTH_RESUBMIT_ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$acl$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS|b2_contract_matrix_rolled_back' AS result;
