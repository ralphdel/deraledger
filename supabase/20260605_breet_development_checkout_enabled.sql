-- ============================================================
-- Breet development checkout flag
-- Allows sandbox/development Breet checkout on deployed domains
-- without enabling live production checkout.
-- ============================================================

INSERT INTO public.platform_settings (key, value)
VALUES ('breet_development_checkout_enabled', 'true')
ON CONFLICT (key) DO UPDATE
SET value = COALESCE(NULLIF(public.platform_settings.value, ''), EXCLUDED.value);
