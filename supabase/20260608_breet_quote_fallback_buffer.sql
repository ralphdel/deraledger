-- ============================================================
-- Breet quote fallback buffer
-- Used only when Breet does not return a provider quote/rate at
-- address generation time. Webhook payloads remain final truth.
-- ============================================================

INSERT INTO public.platform_settings (key, value)
VALUES ('breet_quote_fallback_buffer_bps', '300')
ON CONFLICT (key) DO NOTHING;