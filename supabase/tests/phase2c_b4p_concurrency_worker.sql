\set ON_ERROR_STOP on
\ir phase2c_b4p_local_target_gate.sql
\if :{?worker}
\else
  \echo 'worker psql variable is required'
  \quit 3
\endif

SELECT :'worker' IN ('A', 'B') AS worker_valid \gset
\if :worker_valid
\else
  \echo 'worker must be A or B'
  \quit 3
\endif

SELECT :'worker' = 'A' AS worker_a \gset

BEGIN;
SELECT set_config('application_name', 'phase2c_b4p_worker_' || lower(:'worker'), true);
SET LOCAL ROLE service_role;

\if :worker_a
  -- Hold the exact merchant row lock used by the RPC. The coordinator will
  -- start worker B, prove through pg_blocking_pids that B is blocked by this
  -- session inside the RPC, and only then release this barrier.
  SELECT 1
  FROM public.merchants
  WHERE id = 'b4b40000-0000-4000-8000-000000000002'
  FOR UPDATE;
  SELECT pg_advisory_xact_lock(20261023, 4);
  -- The coordinator session owns this second advisory lock. Worker A cannot
  -- reach the RPC until the runner has observed worker B blocked by A.
  SELECT pg_advisory_xact_lock(20261023, 5);
\endif

WITH timing AS (
  SELECT clock_timestamp() AS started_at
), outcome AS (
  SELECT public.ensure_draft_compliance_profile_v1(
    'b4b40000-0000-4000-8000-000000000002'
  ) AS result
)
INSERT INTO phase2c_b4p_rehearsal.results(worker, result, started_at, finished_at)
SELECT :'worker', outcome.result, timing.started_at, clock_timestamp()
FROM timing, outcome;

COMMIT;
