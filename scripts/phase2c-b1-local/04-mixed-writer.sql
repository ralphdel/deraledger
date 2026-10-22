\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '45s';
SET LOCAL lock_timeout = '30s';
SELECT id FROM public.merchant_compliance_profiles
WHERE merchant_id=:'merchant_id'::uuid FOR UPDATE;
SELECT set_config('application_name','phase2c_b1_mixed_writer_profile_locked', true);
SELECT 'MILESTONE|mixed_writer|profile_locked|' || pg_backend_pid() AS proof;
-- B1 must hold its merchant lock while blocked on the profile held here.
DO $mixed_release_barrier$
DECLARE
  v_deadline timestamptz := clock_timestamp() + interval '25 seconds';
  v_released boolean;
BEGIN
  LOOP
    SELECT released INTO v_released FROM public.phase2c_b1_rehearsal_barriers
      WHERE scenario = 'mixed_writer';
    IF v_released IS TRUE THEN EXIT; END IF;
    IF clock_timestamp() >= v_deadline THEN RAISE EXCEPTION 'MIXED_WRITER_RELEASE_BARRIER_TIMEOUT'; END IF;
    PERFORM pg_catalog.pg_sleep(0.05);
  END LOOP;
END;
$mixed_release_barrier$;
SELECT 'MILESTONE|mixed_writer|b_waiting_on_profile' AS proof;
INSERT INTO public.merchant_compliance_events(
  id,merchant_id,profile_id,event_type,from_state,to_state,actor_type,actor_id,
  source_type,source_id,policy_version,idempotency_key,resulting_row_version,metadata
) VALUES (
  gen_random_uuid(),:'merchant_id'::uuid,:'profile_id'::uuid,'mixed_writer_probe','{}','{}',
  'system',NULL,'system_reconciliation',gen_random_uuid(),'mixed-writer-v1',
  'mixed-writer-event-0018',1,'{}'
);
SELECT 'MILESTONE|mixed_writer|event_inserted' AS proof;
COMMIT;
SELECT 'RESULT|mixed_writer|committed' AS result;
