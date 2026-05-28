-- ============================================================
-- Payment Events Timestamp Compatibility
-- Adds timestamps expected by the admin payment operations view.
-- Safe for older databases where payment_events predates provider routing.
-- ============================================================

ALTER TABLE public.payment_events
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_payment_events_created_at
  ON public.payment_events(created_at DESC);

DROP TRIGGER IF EXISTS trg_payment_events_updated_at ON public.payment_events;
CREATE TRIGGER trg_payment_events_updated_at
BEFORE UPDATE ON public.payment_events
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
