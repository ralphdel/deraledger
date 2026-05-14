-- Breet scaffold support.
-- payment_events already has idempotency_key in the v2.1 migration; this makes older DBs safe.

ALTER TABLE public.payment_events
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_events_idempotency
  ON public.payment_events(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_events_processor_ref
  ON public.payment_events(processor, processor_ref);

INSERT INTO public.platform_settings (key, value)
VALUES ('breet_scaffold_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
