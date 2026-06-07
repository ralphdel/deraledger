-- ============================================================
-- Breet development pending fallback flag
-- Exists for sandbox policy control only. Disabled by default.
-- ============================================================

INSERT INTO public.platform_settings (key, value)
VALUES ('breet_allow_pending_as_completed_in_development', 'false')
ON CONFLICT (key) DO NOTHING;
