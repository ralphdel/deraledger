-- ============================================================
-- Breet minimum auto-settlement threshold
-- Adds a configurable NGN minimum for Breet crypto checkout.
-- ============================================================

INSERT INTO public.platform_settings (key, value)
VALUES ('breet_min_auto_settlement_ngn', '2500')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value;
