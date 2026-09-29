-- Source-only extraction from supabase/setup_trigger.sql.
-- The auth.users trigger and SECURITY DEFINER function are intentionally
-- excluded pending an explicit auth-provisioning security decision.

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS is_test_mode BOOLEAN DEFAULT false;
