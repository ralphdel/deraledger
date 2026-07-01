CREATE TABLE IF NOT EXISTS public.plan_migrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  source_table TEXT NOT NULL,
  source_record_id TEXT,
  old_plan_code TEXT NOT NULL,
  new_plan_code TEXT NOT NULL,
  migration_type TEXT NOT NULL CHECK (migration_type IN ('compatibility_alias')),
  migration_key TEXT NOT NULL UNIQUE,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_migrations_merchant_created
  ON public.plan_migrations(merchant_id, created_at DESC);

INSERT INTO public.platform_settings (key, value)
VALUES
  ('plan_migration_solo_lite_enabled', 'false'),
  ('solo_plus_enabled', 'false'),
  ('solo_plus_kyc_enabled', 'false')
ON CONFLICT (key) DO UPDATE
SET value = COALESCE(NULLIF(public.platform_settings.value, ''), EXCLUDED.value);

ALTER TABLE public.onboarding_sessions
  DROP CONSTRAINT IF EXISTS onboarding_sessions_plan_check;

ALTER TABLE public.onboarding_sessions
  ADD CONSTRAINT onboarding_sessions_plan_check
  CHECK (plan IN ('starter', 'individual', 'corporate', 'solo_plus'));

ALTER TABLE public.workspaces
  DROP CONSTRAINT IF EXISTS workspaces_plan_type_check;

ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_plan_type_check
  CHECK (plan_type IN ('starter', 'individual', 'corporate', 'solo_plus'));

ALTER TABLE public.workspace_subscriptions
  DROP CONSTRAINT IF EXISTS workspace_subscriptions_plan_type_check;

ALTER TABLE public.workspace_subscriptions
  ADD CONSTRAINT workspace_subscriptions_plan_type_check
  CHECK (plan_type IN ('starter', 'individual', 'corporate', 'solo_plus'));
