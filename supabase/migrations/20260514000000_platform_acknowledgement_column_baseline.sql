-- Source-only extraction from supabase/20260514_phase2_migration.sql.
-- Storage objects, policies, configuration rows, and superseded compatibility
-- columns are intentionally excluded from this baseline fragment.

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS last_acknowledged_version INTEGER DEFAULT 0 NOT NULL;

COMMENT ON COLUMN public.merchants.last_acknowledged_version IS
  'The last platform version this merchant acknowledged in the re-acknowledgement flow.';
