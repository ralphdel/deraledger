\set ON_ERROR_STOP on
BEGIN;
DO $apply$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.confirm_fiat_plan_renewal_v1(
    '00000000-0000-4000-8000-00000002c603', 'paystack', 'phase2c-renewal-race',
    'race-provider-ref', 500000, 'NGN', '00000000-0000-4000-8000-00000002c601',
    'solo_lite', '{"session":"a"}'::jsonb
  );

  IF v_result IS NULL OR v_result->>'kind' IS DISTINCT FROM 'applied' THEN
    RAISE EXCEPTION 'FAIL|PHASE2C_RENEWAL|concurrency_session_a|%', COALESCE(v_result::text, '<null>');
  END IF;

  RAISE NOTICE 'PASS|PHASE2C_RENEWAL|concurrency_session_a_applied';
END;
$apply$;

-- This transaction-scoped advisory lock is a disposable-test rendezvous only.
-- Session B must observe this lock before it attempts the same renewal RPC.
SELECT pg_catalog.pg_advisory_xact_lock(20261020, 1);
SELECT 'PASS|PHASE2C_RENEWAL|concurrency_session_a_holding|backend_pid=' || pg_catalog.pg_backend_pid()::text;

-- Keep the payment-row lock and rendezvous lock open long enough for B to
-- contend. B independently proves an actual wait of at least three seconds.
SELECT pg_catalog.pg_sleep(8);
COMMIT;
\echo PASS|PHASE2C_RENEWAL|concurrency_session_a_committed
