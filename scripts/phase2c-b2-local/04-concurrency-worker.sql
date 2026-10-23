\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
BEGIN;
SET LOCAL statement_timeout='90s';
SET LOCAL lock_timeout='60s';
SELECT pg_catalog.set_config('application_name','phase2c_b2_'||:'scenario'||'_'||:'worker',true);
SELECT 'B2_BACKEND|'||:'scenario'||'|'||:'worker'||'|'||pg_catalog.pg_backend_pid();
\if :probe
SELECT p.id FROM public.merchant_compliance_profiles p JOIN public.b2_rehearsal_cases c
  ON c.profile_id=p.id WHERE c.scenario=:'scenario' FOR UPDATE OF p;
\elif :revoke
UPDATE public.merchants m SET is_super_admin=false FROM public.b2_rehearsal_cases c
  WHERE c.scenario=:'scenario' AND m.id=c.authority_merchant_id;
SELECT 'B2_WORKER_RESULT|'||:'scenario'||'|'||:'worker'||'|revoked';
\else
SET LOCAL ROLE service_role;
SELECT 'B2_WORKER_RESULT|'||:'scenario'||'|'||:'worker'||'|'||
  (public.b2_rehearsal_invoke(:'scenario',:'worker')->>'kind');
RESET ROLE;
\endif
\if :hold
-- Readiness is published only AFTER the real RPC/lock/update has succeeded.
SELECT pg_catalog.set_config('application_name','phase2c_b2_'||:'scenario'||'_'||:'worker'||'_ready',true);
SELECT 'B2_LOCK_READY|'||:'scenario'||'|'||:'worker'||'|'||pg_catalog.pg_backend_pid();
SELECT pg_catalog.set_config('phase2c_b2.scenario',:'scenario',true);
DO $barrier$
DECLARE v_started timestamptz:=pg_catalog.clock_timestamp(); v_released boolean;
BEGIN
  LOOP
    SELECT released INTO STRICT v_released FROM public.b2_rehearsal_cases
    WHERE scenario=pg_catalog.current_setting('phase2c_b2.scenario');
    EXIT WHEN v_released;
    IF pg_catalog.clock_timestamp()-v_started>interval '45 seconds' THEN
      RAISE EXCEPTION 'B2_BARRIER_TIMEOUT';
    END IF;
    -- Polling delay is not overlap proof; the runner requires pg_blocking_pids.
    PERFORM pg_catalog.pg_sleep(0.05);
  END LOOP;
END;
$barrier$;
\endif
\if :probe
-- B is proven blocked on this profile while holding merchant NO KEY UPDATE.
-- The merchant FK KEY SHARE must remain compatible with B's merchant lock.
INSERT INTO public.merchant_compliance_events(
  merchant_id,profile_id,event_type,from_state,to_state,actor_type,source_type,source_id,
  policy_version,idempotency_key,resulting_row_version)
SELECT merchant_id,profile_id,'b2_mixed_writer_probe','{}','{}','system',
  'solo_lite_review',review_id,'2c-2b-draft-v1','b2-probe-'||scenario,expected_version
FROM public.b2_rehearsal_cases WHERE scenario=:'scenario';
SELECT 'B2_WORKER_RESULT|'||:'scenario'||'|'||:'worker'||'|probe_inserted';
\endif
COMMIT;
SELECT 'B2_COMMITTED|'||:'scenario'||'|'||:'worker';
