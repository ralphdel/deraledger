\set ON_ERROR_STOP on
\ir phase2c_b4p_local_target_gate.sql

-- LOCAL DISPOSABLE DATABASE ONLY. This fixture intentionally commits so two
-- independent psql workers can race the same merchant. Run the cleanup file
-- after verification even when a worker fails.
BEGIN;

CREATE SCHEMA phase2c_b4p_rehearsal;
CREATE TABLE phase2c_b4p_rehearsal.results (
  worker text PRIMARY KEY,
  result jsonb NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL
);
CREATE TABLE phase2c_b4p_rehearsal.barrier (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  worker_a_ready_observed boolean NOT NULL DEFAULT false,
  worker_b_blocked_observed boolean NOT NULL DEFAULT false,
  release_worker_a boolean NOT NULL DEFAULT false,
  released_at timestamptz
);
INSERT INTO phase2c_b4p_rehearsal.barrier(singleton) VALUES (true);
GRANT USAGE ON SCHEMA phase2c_b4p_rehearsal TO service_role;
GRANT SELECT, INSERT ON TABLE phase2c_b4p_rehearsal.results TO service_role;
GRANT SELECT ON TABLE phase2c_b4p_rehearsal.barrier TO service_role;

INSERT INTO auth.users(id)
VALUES ('b4b40000-0000-4000-8000-000000000001');

INSERT INTO public.merchants (
  id, user_id, email, business_name, subscription_plan, merchant_tier
) VALUES (
  'b4b40000-0000-4000-8000-000000000002',
  'b4b40000-0000-4000-8000-000000000001',
  'b4p-concurrency@example.invalid',
  'B4P Concurrency Rehearsal',
  'individual',
  'individual'
);

INSERT INTO public.subscriptions (
  merchant_id, plan_type, amount_paid, start_date, expiry_date, status
) VALUES (
  'b4b40000-0000-4000-8000-000000000002',
  'solo_lite', 5000, now(), now() + interval '30 days', 'active'
);

INSERT INTO public.workspaces (
  id, owner_user_id, merchant_id, workspace_type, display_name, plan_type,
  onboarding_status, setup_mode, live_features_enabled
) VALUES (
  'b4b40000-0000-4000-8000-000000000003',
  'b4b40000-0000-4000-8000-000000000001',
  'b4b40000-0000-4000-8000-000000000002',
  'business', 'B4P Concurrency Rehearsal', 'individual', 'active', false, false
);

INSERT INTO public.merchant_canonical_workspaces (
  merchant_id, workspace_id, link_version, reconcile_idempotency_key, created_by
) VALUES (
  'b4b40000-0000-4000-8000-000000000002',
  'b4b40000-0000-4000-8000-000000000003',
  1,
  'phase2c-b4p-local-concurrency',
  'b4b40000-0000-4000-8000-000000000001'
);

COMMIT;
