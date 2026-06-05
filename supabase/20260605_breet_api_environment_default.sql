-- ============================================================
-- Breet API environment default
-- Stores the Breet API environment used for sandbox/live headers.
-- ============================================================

INSERT INTO public.platform_settings (key, value)
VALUES ('breet_api_environment', 'development')
ON CONFLICT (key) DO UPDATE
SET value = COALESCE(NULLIF(public.platform_settings.value, ''), EXCLUDED.value);
