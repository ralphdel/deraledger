-- ============================================================
-- Generic verification step state for tier-driven verification
-- Keeps current merchant-level status columns intact while
-- adding reusable per-step state for future tiers.
-- ============================================================

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS verification_step_state JSONB NOT NULL DEFAULT '{}'::jsonb;
