-- ============================================================
-- Platform Update Controls
-- Tracks one-time forced logout per platform version and stores
-- admin-managed update messaging.
-- ============================================================

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS last_update_logout_version INTEGER NOT NULL DEFAULT 0;

INSERT INTO public.platform_settings (key, value)
VALUES
  ('force_logout_on_update', 'true'),
  ('platform_update_title', 'Platform Update'),
  ('platform_update_summary', 'We made important updates to account verification, setup mode, payment routing, and live collection controls. Review the notes and acknowledge before continuing.'),
  ('platform_update_required_action', 'Please review your profile, subscription, verification, and settlement setup after signing back in.'),
  ('superadmin_sandbox_email', 'ralphdel14@yahoo.com')
ON CONFLICT (key) DO NOTHING;

COMMENT ON COLUMN public.merchants.last_update_logout_version IS
  'Last platform version for which this merchant was forced to log out before re-acknowledgement.';
