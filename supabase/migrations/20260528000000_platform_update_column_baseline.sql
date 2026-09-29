-- Source-only extraction from
-- supabase/20260528_platform_update_controls.sql.
-- Environment-specific platform-setting values are intentionally excluded.

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS last_update_logout_version INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.merchants.last_update_logout_version IS
  'Last platform version for which this merchant was forced to log out before re-acknowledgement.';
