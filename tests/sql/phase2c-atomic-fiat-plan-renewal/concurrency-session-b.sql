\set ON_ERROR_STOP on
BEGIN;

-- A holds this transaction-scoped rendezvous lock only after its renewal RPC
-- has returned applied and before it commits. A sequential B launch acquires
-- the lock and fails here instead of treating an ordinary replay as a race.
DO $overlap$
BEGIN
  IF pg_catalog.pg_try_advisory_xact_lock(20261020, 1) THEN
    RAISE EXCEPTION 'FAIL|PHASE2C_RENEWAL|concurrency_overlap_missing';
  END IF;
END;
$overlap$;

DO $replay$
DECLARE
  v_started_at timestamptz;
  v_completed_at timestamptz;
  v_wait_ms numeric;
  v_result jsonb;
BEGIN
  v_started_at := pg_catalog.clock_timestamp();
  v_result := public.confirm_fiat_plan_renewal_v1(
    '00000000-0000-4000-8000-00000002c603', 'paystack', 'phase2c-renewal-race',
    'race-provider-ref', 500000, 'NGN', '00000000-0000-4000-8000-00000002c601',
    'solo_lite', '{"session":"b"}'::jsonb
  );
  v_completed_at := pg_catalog.clock_timestamp();
  v_wait_ms := EXTRACT(EPOCH FROM (v_completed_at - v_started_at)) * 1000;

  IF v_wait_ms < 3000 THEN
    RAISE EXCEPTION 'FAIL|PHASE2C_RENEWAL|concurrency_wait_insufficient|wait_ms=%', pg_catalog.floor(v_wait_ms);
  END IF;

  IF v_result->>'kind' IS DISTINCT FROM 'already_processed' THEN
    RAISE EXCEPTION 'FAIL|PHASE2C_RENEWAL|concurrency_session_b|%', v_result;
  END IF;

  RAISE NOTICE 'PASS|PHASE2C_RENEWAL|concurrency_session_b_replay|wait_ms=%', pg_catalog.floor(v_wait_ms);
END;
$replay$;

COMMIT;

DO $verify$
BEGIN
  IF (SELECT count(*) FROM public.subscription_payments WHERE paystack_ref = 'phase2c-renewal-race') <> 1 THEN
    RAISE EXCEPTION 'Concurrent renewal ledger count is not exactly one';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE id = '00000000-0000-4000-8000-00000002c602'
      AND expiry_date > now() + interval '30 days'
      AND expiry_date < now() + interval '32 days'
  ) THEN
    RAISE EXCEPTION 'Concurrent renewal expiry was not extended exactly once';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.payment_records
    WHERE id = '00000000-0000-4000-8000-00000002c603'
      AND payment_status = 'successful'
      AND processing_status = 'processed'
      AND account_setup_status = 'active'
      AND amount_paid = 5000
      AND provider_reference = 'race-provider-ref'
      AND paid_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Concurrent renewal payment state is incoherent';
  END IF;
END;
$verify$;
\echo PASS|PHASE2C_RENEWAL|concurrency_exactly_once
