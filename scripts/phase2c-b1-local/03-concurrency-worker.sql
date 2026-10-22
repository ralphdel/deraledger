\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '45s';
SET LOCAL lock_timeout = '30s';
SELECT set_config('application_name','phase2c_b1_' || :'label', true);
SELECT set_config('phase2c_b1.scenario', :'scenario', true);
SELECT set_config('phase2c_b1.wait_for_release', :'wait_for_release', true);
SET LOCAL ROLE service_role;
SELECT 'B1_WORKER_RESULT|' || :'scenario' || '|' || :'worker' || '|' || (public.submit_draft_plan_review_v1(
  :'merchant_id'::uuid, :'workspace_id'::uuid, 1, :'actor_id'::uuid,
  '2c-2b-draft-v1',
  jsonb_build_object(
    'schemaVersion','phase2c-review-v1','policyId',:'policy_id','policyVersion','2c-2b-draft-v1',
    'policyStatus','draft','adapterVersion','2c-2b-v1','evaluatedAt',:'evaluated_at',
    'findings',jsonb_build_array(jsonb_build_object(
      'code','legal_name','status',:'finding_status','reasonCode',:'reason_code',
      'sourceType',NULL,'sourceId',NULL,'sourceVersion',NULL))),
  :'idempotency_key'
)->>'kind') AS result;
SELECT set_config('application_name','phase2c_b1_' || :'label' || '_lock_held', true);
SELECT 'B1_WORKER_LOCK_READY|' || :'scenario' || '|' || :'worker' || '|' || pg_backend_pid() AS proof;
RESET ROLE;
-- The runner releases this disposable barrier only after pg_blocking_pids proves overlap.
DO $release_barrier$
DECLARE
  v_deadline timestamptz := clock_timestamp() + interval '25 seconds';
  v_released boolean;
BEGIN
  IF current_setting('phase2c_b1.wait_for_release') = '1' THEN
    LOOP
      SELECT released INTO v_released FROM public.phase2c_b1_rehearsal_barriers
        WHERE scenario = current_setting('phase2c_b1.scenario');
      IF v_released IS TRUE THEN EXIT; END IF;
      IF clock_timestamp() >= v_deadline THEN RAISE EXCEPTION 'B1_RELEASE_BARRIER_TIMEOUT'; END IF;
      PERFORM pg_catalog.pg_sleep(0.05);
    END LOOP;
  END IF;
END;
$release_barrier$;
SELECT 'B1_WORKER_RELEASED|' || :'scenario' || '|' || :'worker' AS proof
  WHERE :'wait_for_release' = '1';
COMMIT;
