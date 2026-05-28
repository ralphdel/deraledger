-- ============================================================
-- Superadmin Sandbox Merchant Flag
-- Lets the platform owner keep a sandbox merchant active without
-- subscription expiry or corporate director authority gates.
-- ============================================================

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;

UPDATE public.merchants
SET is_super_admin = true
WHERE lower(email) = lower(
  COALESCE(
    (SELECT value FROM public.platform_settings WHERE key = 'superadmin_sandbox_email' LIMIT 1),
    'ralphdel14@yahoo.com'
  )
);

COMMENT ON COLUMN public.merchants.is_super_admin IS
  'Marks the platform owner sandbox merchant. This account is forced to sandbox behavior and bypasses expiry/director authority locks.';
