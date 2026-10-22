\set ON_ERROR_STOP on

CREATE TEMP TABLE rehearsal_results(name text PRIMARY KEY, actual text NOT NULL);
GRANT SELECT, INSERT, UPDATE ON rehearsal_results TO service_role;
CREATE TEMP TABLE rehearsal_receipts(name text PRIMARY KEY, body jsonb NOT NULL);
GRANT SELECT, INSERT ON rehearsal_receipts TO service_role;
CREATE TEMP TABLE rehearsal_snapshots(name text PRIMARY KEY, body jsonb NOT NULL);
GRANT SELECT ON rehearsal_snapshots TO service_role;
INSERT INTO rehearsal_snapshots VALUES
('lite', '{"schemaVersion":"phase2c-review-v1","policyId":"solo_lite_evidence","policyVersion":"2c-2b-draft-v1","policyStatus":"draft","adapterVersion":"2c-2b-v1","evaluatedAt":"2026-10-22T12:00:00Z","findings":[{"code":"legal_name","status":"unknown","reasonCode":"evidence_unknown","sourceType":null,"sourceId":null,"sourceVersion":null}]}'::jsonb),
('business', '{"schemaVersion":"phase2c-review-v1","policyId":"business_kyb_evidence","policyVersion":"2c-2b-draft-v1","policyStatus":"draft","adapterVersion":"2c-2b-v1","evaluatedAt":"2026-10-22T12:00:00+01:00","findings":[{"code":"legal_name","status":"unknown","reasonCode":"evidence_unknown","sourceType":null,"sourceId":null,"sourceVersion":null}]}'::jsonb),
('lite_changed', '{"schemaVersion":"phase2c-review-v1","policyId":"solo_lite_evidence","policyVersion":"2c-2b-draft-v1","policyStatus":"draft","adapterVersion":"2c-2b-v1","evaluatedAt":"2026-10-22T12:01:00Z","findings":[{"code":"legal_name","status":"missing","reasonCode":"evidence_missing","sourceType":null,"sourceId":null,"sourceVersion":null}]}'::jsonb);
-- Keep the alternate request internally coherent; B1 still rejects its unsupported policy argument.
INSERT INTO rehearsal_snapshots(name, body)
SELECT 'business_future_policy', jsonb_set(body, '{policyVersion}', '"future-approved-v1"'::jsonb)
FROM rehearsal_snapshots WHERE name='business';

INSERT INTO auth.users(id) SELECT ('10000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid FROM generate_series(1,30) g;
INSERT INTO public.merchants(id,user_id,business_name,email,subscription_plan)
SELECT ('20000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
       ('10000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
       'Rehearsal '||g, 'rehearsal-'||g||'@example.invalid',
       (ARRAY['solo_lite','individual','business','corporate','starter','solo_plus','unknown_plan'])[((g-1)%7)+1]
FROM generate_series(1,30) g;
INSERT INTO public.workspaces(id,owner_user_id,merchant_id,display_name)
SELECT ('30000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
       ('10000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
       ('20000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid, 'Workspace '||g
FROM generate_series(1,30) g;
INSERT INTO public.merchant_canonical_workspaces(merchant_id,workspace_id,reconcile_idempotency_key,created_by)
SELECT ('20000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
       ('30000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid, 'workspace-link-'||g,
       ('10000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid
FROM generate_series(1,30) g;
INSERT INTO public.merchant_compliance_profiles(id,merchant_id,plan_code,compliance_status,activation_status,row_version)
SELECT ('40000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
       ('20000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
       CASE ((g-1)%7)+1 WHEN 1 THEN 'solo_lite' WHEN 2 THEN 'solo_lite' WHEN 3 THEN 'business'
         WHEN 4 THEN 'business' WHEN 5 THEN 'starter' WHEN 6 THEN 'solo_plus' ELSE 'starter' END,
       'draft','test_mode',1
FROM generate_series(1,30) g;

-- Deliberate fixtures for missing-profile and legacy-open-review behavior.
DELETE FROM public.merchant_compliance_profiles WHERE merchant_id='20000000-0000-4000-8000-000000000022';
INSERT INTO public.merchant_compliance_reviews(id,merchant_id,profile_id,review_type,target_plan_code,review_status,evidence_snapshot,policy_version,submitted_at,idempotency_key,row_version)
VALUES
('50000000-0000-4000-8000-000000000023','20000000-0000-4000-8000-000000000023','40000000-0000-4000-8000-000000000023','solo_lite','solo_lite','pending',(SELECT body FROM rehearsal_snapshots WHERE name='lite'),'2c-2b-draft-v1',now(),'legacy-pending-0023',1),
('50000000-0000-4000-8000-000000000024','20000000-0000-4000-8000-000000000024','40000000-0000-4000-8000-000000000024','business_kyb','business','needs_attention',(SELECT body FROM rehearsal_snapshots WHERE name='business'),'2c-2b-draft-v1',now(),'legacy-attention-0024',1);

SET ROLE service_role;
INSERT INTO rehearsal_receipts
SELECT 'solo_lite', public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',1,'10000000-0000-4000-8000-000000000001','2c-2b-draft-v1',(SELECT body FROM rehearsal_snapshots WHERE name='lite'),'behavior-lite-0001');
INSERT INTO rehearsal_results SELECT name, body->>'kind' FROM rehearsal_receipts WHERE name='solo_lite';
INSERT INTO rehearsal_results
SELECT 'individual_alias', public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002',1,'10000000-0000-4000-8000-000000000002','2c-2b-draft-v1',(SELECT body FROM rehearsal_snapshots WHERE name='lite'),'behavior-individual-0002')->>'kind';
INSERT INTO rehearsal_results
SELECT 'business', public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003',1,'10000000-0000-4000-8000-000000000003','2c-2b-draft-v1',(SELECT body FROM rehearsal_snapshots WHERE name='business'),'behavior-business-0003')->>'kind';
INSERT INTO rehearsal_results
SELECT 'corporate_alias', public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000004',1,'10000000-0000-4000-8000-000000000004','2c-2b-draft-v1',(SELECT body FROM rehearsal_snapshots WHERE name='business'),'behavior-corporate-0004')->>'kind';
INSERT INTO rehearsal_results
SELECT 'starter_reject', public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000005',1,'10000000-0000-4000-8000-000000000005','2c-2b-draft-v1',(SELECT body FROM rehearsal_snapshots WHERE name='lite'),'behavior-starter-0005')->>'kind';
INSERT INTO rehearsal_results
SELECT 'plus_reject', public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000006',1,'10000000-0000-4000-8000-000000000006','2c-2b-draft-v1',(SELECT body FROM rehearsal_snapshots WHERE name='lite'),'behavior-plus-0006')->>'kind';
INSERT INTO rehearsal_results
SELECT 'unknown_reject', public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000007',1,'10000000-0000-4000-8000-000000000007','2c-2b-draft-v1',(SELECT body FROM rehearsal_snapshots WHERE name='lite'),'behavior-unknown-0007')->>'kind';
INSERT INTO rehearsal_results
SELECT 'workspace_mismatch', public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000008','30000000-0000-4000-8000-000000000009',1,'10000000-0000-4000-8000-000000000008','2c-2b-draft-v1',(SELECT body FROM rehearsal_snapshots WHERE name='lite'),'behavior-workspace-0008')->>'kind';
INSERT INTO rehearsal_results
SELECT 'owner_mismatch', public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000008','30000000-0000-4000-8000-000000000008',1,'10000000-0000-4000-8000-000000000009','2c-2b-draft-v1',(SELECT body FROM rehearsal_snapshots WHERE name='lite'),'behavior-owner-0008')->>'kind';
INSERT INTO rehearsal_results
SELECT 'stale_version', public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000008','30000000-0000-4000-8000-000000000008',2,'10000000-0000-4000-8000-000000000008','2c-2b-draft-v1',(SELECT body FROM rehearsal_snapshots WHERE name='lite'),'behavior-stale-0008')->>'kind';
INSERT INTO rehearsal_results
SELECT 'exact_replay', public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',1,'10000000-0000-4000-8000-000000000001','2c-2b-draft-v1',(SELECT body FROM rehearsal_snapshots WHERE name='lite'),'behavior-lite-0001')->>'kind';
INSERT INTO rehearsal_results
SELECT 'changed_replay', public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',1,'10000000-0000-4000-8000-000000000001','2c-2b-draft-v1',(SELECT body FROM rehearsal_snapshots WHERE name='lite_changed'),'behavior-lite-0001')->>'kind';
INSERT INTO rehearsal_results
SELECT 'same_key_other_merchant', public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000008','30000000-0000-4000-8000-000000000008',1,'10000000-0000-4000-8000-000000000008','2c-2b-draft-v1',(SELECT body FROM rehearsal_snapshots WHERE name='lite'),'behavior-lite-0001')->>'kind';
INSERT INTO rehearsal_results
SELECT 'missing_profile', public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000022','30000000-0000-4000-8000-000000000022',1,'10000000-0000-4000-8000-000000000022','2c-2b-draft-v1',(SELECT body FROM rehearsal_snapshots WHERE name='lite'),'behavior-missing-profile')->>'kind';
INSERT INTO rehearsal_results
SELECT 'legacy_pending', public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000023','30000000-0000-4000-8000-000000000023',1,'10000000-0000-4000-8000-000000000023','2c-2b-draft-v1',(SELECT body FROM rehearsal_snapshots WHERE name='lite'),'behavior-legacy-pending')->>'kind';
INSERT INTO rehearsal_results
SELECT 'legacy_attention', public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000024','30000000-0000-4000-8000-000000000024',1,'10000000-0000-4000-8000-000000000024','2c-2b-draft-v1',(SELECT body FROM rehearsal_snapshots WHERE name='business'),'behavior-legacy-attention')->>'kind';
INSERT INTO rehearsal_results
SELECT 'malformed_snapshot', public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000009','30000000-0000-4000-8000-000000000009',1,'10000000-0000-4000-8000-000000000009','2c-2b-draft-v1','{}'::jsonb,'behavior-malformed-snapshot')->>'kind';
INSERT INTO rehearsal_results
SELECT 'oversized_snapshot', public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000010','30000000-0000-4000-8000-000000000010',1,'10000000-0000-4000-8000-000000000010','2c-2b-draft-v1',jsonb_build_object('provider_payload',repeat('x',17000)),'behavior-oversized-snapshot')->>'kind';
INSERT INTO rehearsal_results
SELECT 'policy_snapshot_mismatch', public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000018','30000000-0000-4000-8000-000000000018',1,'10000000-0000-4000-8000-000000000018','2c-2b-draft-v1',(SELECT body FROM rehearsal_snapshots WHERE name='business_future_policy'),'behavior-policy-mismatch')->>'kind';
INSERT INTO rehearsal_results
SELECT 'unsupported_policy', public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000011',1,'10000000-0000-4000-8000-000000000011','future-approved-v1',(SELECT body FROM rehearsal_snapshots WHERE name='business_future_policy'),'behavior-unsupported-policy')->>'kind';
RESET ROLE;

DO $assertions$
DECLARE
  v_probe record;
  v_review public.merchant_compliance_reviews%ROWTYPE;
  v_replay jsonb;
  v_applied jsonb;
  v_review_count integer;
  v_event_count integer;
BEGIN
  FOR v_probe IN SELECT * FROM (VALUES
    ('solo_lite','applied'),('individual_alias','applied'),('business','applied'),('corporate_alias','applied'),
    ('starter_reject','state_conflict'),('plus_reject','state_conflict'),('unknown_reject','state_conflict'),
    ('workspace_mismatch','state_conflict'),('owner_mismatch','actor_unauthorized'),('stale_version','version_conflict'),
    ('exact_replay','already_processed'),('changed_replay','state_conflict'),('same_key_other_merchant','applied'),
    ('missing_profile','state_conflict'),('legacy_pending','state_conflict'),('legacy_attention','state_conflict'),
    ('malformed_snapshot','evidence_conflict'),('oversized_snapshot','evidence_conflict'),
    ('policy_snapshot_mismatch','evidence_conflict'),('unsupported_policy','invalid_transition')) x(name,expected)
  LOOP
    IF (SELECT actual FROM rehearsal_results WHERE name=v_probe.name) IS DISTINCT FROM v_probe.expected THEN
      RAISE EXCEPTION 'BEHAVIOR_MISMATCH:%:expected=%:actual=%', v_probe.name, v_probe.expected,
        COALESCE((SELECT actual FROM rehearsal_results WHERE name=v_probe.name), '<missing>');
    END IF;
  END LOOP;
  SELECT count(*) INTO v_review_count FROM public.merchant_compliance_reviews;
  SELECT count(*) INTO v_event_count FROM public.merchant_compliance_events;
  IF v_review_count <> 7 OR v_event_count <> 5 THEN
    RAISE EXCEPTION 'BEHAVIOR_PERSISTENCE_COUNT:expected_reviews=7:actual_reviews=%:expected_events=5:actual_events=%',
      v_review_count, v_event_count;
  END IF;
  IF (SELECT count(*) FROM public.merchant_compliance_reviews review_row
    JOIN public.merchant_compliance_events event_row ON event_row.source_id=review_row.id
      AND event_row.event_type='phase2c_draft_review_submit_v1') <> 5 THEN
    RAISE EXCEPTION 'BEHAVIOR_SUBMISSION_LINK_COUNT:expected=5';
  END IF;
  IF EXISTS (SELECT 1 FROM public.merchant_compliance_reviews review_row
    JOIN public.merchant_compliance_events event_row
      ON event_row.source_id=review_row.id AND event_row.event_type='phase2c_draft_review_submit_v1'
    WHERE review_row.review_status<>'pending' OR review_row.row_version<>1
      OR review_row.reviewed_at IS NOT NULL OR review_row.reviewed_by IS NOT NULL
      OR event_row.merchant_id<>review_row.merchant_id OR event_row.profile_id<>review_row.profile_id
      OR event_row.resulting_row_version<>review_row.row_version
      OR event_row.policy_version IS DISTINCT FROM review_row.policy_version
      OR event_row.metadata->>'snapshot_sha256' IS DISTINCT FROM
        encode(sha256(convert_to(review_row.evidence_snapshot::text,'UTF8')),'hex')) THEN
    RAISE EXCEPTION 'BEHAVIOR_REVIEW_NOT_PENDING_ONLY'; END IF;
  IF EXISTS (SELECT 1 FROM public.merchant_compliance_profiles WHERE compliance_status<>'draft' OR activation_status<>'test_mode'
    OR can_collect_payments OR can_activate_settlement) THEN RAISE EXCEPTION 'BEHAVIOR_PROFILE_OR_ACTIVATION_MUTATED'; END IF;

  SELECT * INTO v_review FROM public.merchant_compliance_reviews WHERE merchant_id='20000000-0000-4000-8000-000000000001';
  SELECT body INTO v_applied FROM rehearsal_receipts WHERE name='solo_lite';
  IF v_applied->>'kind' IS DISTINCT FROM 'applied'
    OR (v_applied->>'row_version')::bigint IS DISTINCT FROM v_review.row_version
    OR (v_applied->>'review_id')::uuid IS DISTINCT FROM v_review.id
    OR NOT EXISTS (SELECT 1 FROM public.merchant_compliance_events event_row
      WHERE event_row.id=(v_applied->>'event_id')::uuid AND event_row.source_id=v_review.id
        AND event_row.resulting_row_version=v_review.row_version) THEN
    RAISE EXCEPTION 'BEHAVIOR_APPLIED_RESULT_PROVENANCE_MISMATCH';
  END IF;
  v_replay := public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',1,'10000000-0000-4000-8000-000000000001',
    '2c-2b-draft-v1',(SELECT body FROM rehearsal_snapshots WHERE name='lite'),'behavior-lite-0001');
  IF v_replay->>'kind' IS DISTINCT FROM 'already_processed'
    OR (v_replay->>'row_version')::bigint IS DISTINCT FROM v_review.row_version
    OR (v_replay->>'review_id')::uuid IS DISTINCT FROM v_review.id
    OR NOT EXISTS (SELECT 1 FROM public.merchant_compliance_events event_row
      WHERE event_row.id=(v_replay->>'event_id')::uuid AND event_row.source_id=v_review.id
        AND event_row.resulting_row_version=v_review.row_version) THEN
    RAISE EXCEPTION 'BEHAVIOR_RESULT_PROVENANCE_MISMATCH';
  END IF;
  BEGIN UPDATE public.merchant_compliance_reviews SET id=gen_random_uuid() WHERE id=v_review.id; RAISE EXCEPTION 'ID_MUTATION_ALLOWED';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Submitted review source is immutable' THEN RAISE; END IF; END;
  BEGIN UPDATE public.merchant_compliance_reviews SET merchant_id='20000000-0000-4000-8000-000000000002' WHERE id=v_review.id; RAISE EXCEPTION 'MERCHANT_MUTATION_ALLOWED';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Submitted review source is immutable' THEN RAISE; END IF; END;
  BEGIN UPDATE public.merchant_compliance_reviews SET profile_id='40000000-0000-4000-8000-000000000002' WHERE id=v_review.id; RAISE EXCEPTION 'PROFILE_MUTATION_ALLOWED';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Submitted review source is immutable' THEN RAISE; END IF; END;
  BEGIN UPDATE public.merchant_compliance_reviews SET review_type='business_kyb' WHERE id=v_review.id; RAISE EXCEPTION 'REVIEW_TYPE_MUTATION_ALLOWED';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Submitted review source is immutable' THEN RAISE; END IF; END;
  BEGIN UPDATE public.merchant_compliance_reviews SET target_plan_code='business' WHERE id=v_review.id; RAISE EXCEPTION 'PLAN_MUTATION_ALLOWED';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Submitted review source is immutable' THEN RAISE; END IF; END;
  BEGIN UPDATE public.merchant_compliance_reviews SET evidence_snapshot='{}' WHERE id=v_review.id; RAISE EXCEPTION 'SNAPSHOT_MUTATION_ALLOWED';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Submitted review source is immutable' THEN RAISE; END IF; END;
  BEGIN UPDATE public.merchant_compliance_reviews SET policy_version='changed' WHERE id=v_review.id; RAISE EXCEPTION 'POLICY_MUTATION_ALLOWED';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Submitted review source is immutable' THEN RAISE; END IF; END;
  BEGIN UPDATE public.merchant_compliance_reviews SET submitted_at=v_review.submitted_at + interval '1 second' WHERE id=v_review.id; RAISE EXCEPTION 'SUBMISSION_TIME_MUTATION_ALLOWED';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Submitted review source is immutable' THEN RAISE; END IF; END;
  BEGIN UPDATE public.merchant_compliance_reviews SET idempotency_key='changed-key' WHERE id=v_review.id; RAISE EXCEPTION 'KEY_MUTATION_ALLOWED';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Submitted review source is immutable' THEN RAISE; END IF; END;
  BEGIN UPDATE public.merchant_compliance_reviews SET review_status='draft' WHERE id=v_review.id; RAISE EXCEPTION 'PENDING_TO_DRAFT_ALLOWED';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Submitted review cannot return to draft' THEN RAISE; END IF; END;
  UPDATE public.merchant_compliance_reviews SET decision_notes='future privileged lifecycle field', review_status='needs_attention' WHERE id=v_review.id;
  IF NOT EXISTS (SELECT 1 FROM public.merchant_compliance_reviews WHERE id=v_review.id AND review_status='needs_attention') THEN
    RAISE EXCEPTION 'FUTURE_LIFECYCLE_FIELD_BLOCKED'; END IF;
END;
$assertions$;

-- A forced event failure must roll back the review inserted earlier in the RPC.
CREATE FUNCTION pg_temp.reject_b1_event() RETURNS trigger LANGUAGE plpgsql AS $reject$
BEGIN IF NEW.idempotency_key='forced-event-failure-0025' THEN RAISE EXCEPTION 'FORCED_EVENT_FAILURE'; END IF; RETURN NEW; END;
$reject$;
CREATE TRIGGER reject_b1_event BEFORE INSERT ON public.merchant_compliance_events FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_b1_event();
DO $atomicity$
DECLARE v_failed boolean := false;
BEGIN
  BEGIN
    PERFORM public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000025','30000000-0000-4000-8000-000000000025',1,'10000000-0000-4000-8000-000000000025','2c-2b-draft-v1',(SELECT body FROM rehearsal_snapshots WHERE name='business'),'forced-event-failure-0025');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'FORCED_EVENT_FAILURE' THEN RAISE; END IF;
    v_failed := true;
  END;
  IF NOT v_failed OR EXISTS (SELECT 1 FROM public.merchant_compliance_reviews WHERE merchant_id='20000000-0000-4000-8000-000000000025')
    OR EXISTS (SELECT 1 FROM public.merchant_compliance_events WHERE idempotency_key='forced-event-failure-0025') THEN
    RAISE EXCEPTION 'EVENT_FAILURE_DID_NOT_ROLL_BACK_REVIEW';
  END IF;
END;
$atomicity$;
DROP TRIGGER reject_b1_event ON public.merchant_compliance_events;

SET ROLE service_role;
DO $direct_update$
DECLARE denied boolean := false;
BEGIN
  BEGIN UPDATE public.merchant_compliance_reviews SET decision_notes='must not write' WHERE false;
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'SERVICE_ROLE_DIRECT_REVIEW_UPDATE_NOT_DENIED'; END IF;
END;
$direct_update$;
RESET ROLE;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL ROLE service_role;
DO $isolation$
DECLARE v jsonb;
BEGIN
  v := public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000015','30000000-0000-4000-8000-000000000015',1,'10000000-0000-4000-8000-000000000015','2c-2b-draft-v1',(SELECT body FROM rehearsal_snapshots WHERE name='lite'),'behavior-repeatable-0015');
  IF v->>'kind' <> 'unsupported_isolation' THEN RAISE EXCEPTION 'REPEATABLE_READ_NOT_REJECTED'; END IF;
END;
$isolation$;
ROLLBACK;

BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL ROLE service_role;
DO $isolation$
DECLARE v jsonb;
BEGIN
  v := public.submit_draft_plan_review_v1('20000000-0000-4000-8000-000000000015','30000000-0000-4000-8000-000000000015',1,'10000000-0000-4000-8000-000000000015','2c-2b-draft-v1',(SELECT body FROM rehearsal_snapshots WHERE name='lite'),'behavior-serializable-0015');
  IF v->>'kind' <> 'unsupported_isolation' THEN RAISE EXCEPTION 'SERIALIZABLE_NOT_REJECTED'; END IF;
END;
$isolation$;
ROLLBACK;

SELECT 'PASS|behavior_and_immutability' AS result;
