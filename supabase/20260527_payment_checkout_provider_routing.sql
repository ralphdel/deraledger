-- ============================================================
-- DeraLedger Payment Checkout & Provider Routing
-- Adds provider registry, routing rules, and method visibility
-- without breaking existing Paystack-first payment flows.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.payment_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name TEXT NOT NULL
    CHECK (provider_name IN ('paystack', 'monnify', 'breet')),
  environment TEXT NOT NULL
    CHECK (environment IN ('sandbox', 'live')),
  status TEXT NOT NULL DEFAULT 'inactive'
    CHECK (status IN ('active', 'inactive', 'degraded', 'down', 'pending_live_approval', 'sandbox_only')),
  allow_degraded_routing BOOLEAN NOT NULL DEFAULT false,
  supports_card BOOLEAN NOT NULL DEFAULT false,
  supports_bank_transfer BOOLEAN NOT NULL DEFAULT false,
  supports_ussd BOOLEAN NOT NULL DEFAULT false,
  supports_crypto BOOLEAN NOT NULL DEFAULT false,
  public_key_hint TEXT,
  merchant_id_hint TEXT,
  webhook_secret_hint TEXT,
  last_health_check_at TIMESTAMPTZ,
  last_successful_webhook_at TIMESTAMPTZ,
  last_failed_webhook_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_name, environment)
);

CREATE TABLE IF NOT EXISTS public.payment_method_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_purpose TEXT NOT NULL
    CHECK (payment_purpose IN ('plan_subscription', 'plan_upgrade', 'invoice_payment', 'payment_link', 'crypto_payment')),
  payment_method TEXT NOT NULL
    CHECK (payment_method IN ('card', 'bank_transfer', 'ussd', 'crypto')),
  environment TEXT NOT NULL
    CHECK (environment IN ('sandbox', 'live')),
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  display_label TEXT NOT NULL,
  display_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_purpose, payment_method, environment)
);

CREATE TABLE IF NOT EXISTS public.payment_provider_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_purpose TEXT NOT NULL
    CHECK (payment_purpose IN ('plan_subscription', 'plan_upgrade', 'invoice_payment', 'payment_link', 'crypto_payment')),
  payment_method TEXT NOT NULL
    CHECK (payment_method IN ('card', 'bank_transfer', 'ussd', 'crypto')),
  primary_provider TEXT NOT NULL
    CHECK (primary_provider IN ('paystack', 'monnify', 'breet')),
  fallback_provider TEXT
    CHECK (fallback_provider IN ('paystack', 'monnify', 'breet')),
  environment TEXT NOT NULL
    CHECK (environment IN ('sandbox', 'live')),
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_purpose, payment_method, environment)
);

CREATE INDEX IF NOT EXISTS idx_payment_providers_environment_status
  ON public.payment_providers(environment, status);

CREATE INDEX IF NOT EXISTS idx_payment_method_configs_lookup
  ON public.payment_method_configs(payment_purpose, environment, is_enabled);

CREATE INDEX IF NOT EXISTS idx_payment_provider_routes_lookup
  ON public.payment_provider_routes(payment_purpose, payment_method, environment, is_enabled);

DROP TRIGGER IF EXISTS trg_payment_providers_updated_at ON public.payment_providers;
CREATE TRIGGER trg_payment_providers_updated_at
BEFORE UPDATE ON public.payment_providers
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_payment_method_configs_updated_at ON public.payment_method_configs;
CREATE TRIGGER trg_payment_method_configs_updated_at
BEFORE UPDATE ON public.payment_method_configs
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_payment_provider_routes_updated_at ON public.payment_provider_routes;
CREATE TRIGGER trg_payment_provider_routes_updated_at
BEFORE UPDATE ON public.payment_provider_routes
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.payment_providers (
  provider_name,
  environment,
  status,
  supports_card,
  supports_bank_transfer,
  supports_ussd,
  supports_crypto,
  public_key_hint,
  merchant_id_hint,
  webhook_secret_hint
)
VALUES
  ('paystack', 'sandbox', 'active', true, true, true, false, 'NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY', NULL, 'PAYSTACK_SECRET_KEY'),
  ('paystack', 'live', 'pending_live_approval', true, true, true, false, 'NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY', NULL, 'PAYSTACK_SECRET_KEY'),
  ('monnify', 'sandbox', 'sandbox_only', true, true, true, false, 'MONNIFY_API_KEY', 'MONNIFY_CONTRACT_CODE', 'MONNIFY_SECRET_KEY'),
  ('monnify', 'live', 'pending_live_approval', true, true, true, false, 'MONNIFY_API_KEY', 'MONNIFY_CONTRACT_CODE', 'MONNIFY_SECRET_KEY'),
  ('breet', 'sandbox', 'sandbox_only', false, false, false, true, 'BREET_APP_ID', NULL, 'BREET_APP_SECRET'),
  ('breet', 'live', 'inactive', false, false, false, true, 'BREET_APP_ID', NULL, 'BREET_APP_SECRET')
ON CONFLICT (provider_name, environment) DO NOTHING;

INSERT INTO public.payment_method_configs (
  payment_purpose,
  payment_method,
  environment,
  is_enabled,
  display_label,
  display_description
)
VALUES
  ('plan_subscription', 'card', 'sandbox', true, 'Card', 'Pay securely with your debit or credit card'),
  ('plan_subscription', 'bank_transfer', 'sandbox', true, 'Bank Transfer', 'Transfer from your bank app or virtual account'),
  ('plan_subscription', 'ussd', 'sandbox', true, 'USSD', 'Pay using your bank USSD code'),
  ('plan_subscription', 'crypto', 'sandbox', false, 'Crypto', 'Pay with crypto when this rail is active'),
  ('plan_upgrade', 'card', 'sandbox', true, 'Card', 'Pay securely with your debit or credit card'),
  ('plan_upgrade', 'bank_transfer', 'sandbox', true, 'Bank Transfer', 'Transfer from your bank app or virtual account'),
  ('plan_upgrade', 'ussd', 'sandbox', true, 'USSD', 'Pay using your bank USSD code'),
  ('plan_upgrade', 'crypto', 'sandbox', false, 'Crypto', 'Pay with crypto when this rail is active'),
  ('invoice_payment', 'card', 'sandbox', true, 'Card', 'Pay invoice securely with your debit or credit card'),
  ('invoice_payment', 'bank_transfer', 'sandbox', true, 'Bank Transfer', 'Transfer exactly the amount shown'),
  ('invoice_payment', 'ussd', 'sandbox', true, 'USSD', 'Pay using your bank USSD code'),
  ('invoice_payment', 'crypto', 'sandbox', true, 'Crypto', 'Pay with crypto when this rail is active'),
  ('payment_link', 'card', 'sandbox', true, 'Card', 'Pay securely with your debit or credit card'),
  ('payment_link', 'bank_transfer', 'sandbox', true, 'Bank Transfer', 'Transfer from your bank app or virtual account'),
  ('payment_link', 'ussd', 'sandbox', true, 'USSD', 'Pay using your bank USSD code'),
  ('payment_link', 'crypto', 'sandbox', true, 'Crypto', 'Pay with crypto when this rail is active'),
  ('plan_subscription', 'card', 'live', true, 'Card', 'Pay securely with your debit or credit card'),
  ('plan_subscription', 'bank_transfer', 'live', true, 'Bank Transfer', 'Transfer from your bank app or virtual account'),
  ('plan_subscription', 'ussd', 'live', true, 'USSD', 'Pay using your bank USSD code'),
  ('plan_subscription', 'crypto', 'live', false, 'Crypto', 'Pay with crypto when this rail is active'),
  ('plan_upgrade', 'card', 'live', true, 'Card', 'Pay securely with your debit or credit card'),
  ('plan_upgrade', 'bank_transfer', 'live', true, 'Bank Transfer', 'Transfer from your bank app or virtual account'),
  ('plan_upgrade', 'ussd', 'live', true, 'USSD', 'Pay using your bank USSD code'),
  ('plan_upgrade', 'crypto', 'live', false, 'Crypto', 'Pay with crypto when this rail is active'),
  ('invoice_payment', 'card', 'live', true, 'Card', 'Pay invoice securely with your debit or credit card'),
  ('invoice_payment', 'bank_transfer', 'live', true, 'Bank Transfer', 'Transfer exactly the amount shown'),
  ('invoice_payment', 'ussd', 'live', true, 'USSD', 'Pay using your bank USSD code'),
  ('invoice_payment', 'crypto', 'live', false, 'Crypto', 'Pay with crypto when this rail is active'),
  ('payment_link', 'card', 'live', true, 'Card', 'Pay securely with your debit or credit card'),
  ('payment_link', 'bank_transfer', 'live', true, 'Bank Transfer', 'Transfer from your bank app or virtual account'),
  ('payment_link', 'ussd', 'live', true, 'USSD', 'Pay using your bank USSD code'),
  ('payment_link', 'crypto', 'live', false, 'Crypto', 'Pay with crypto when this rail is active')
ON CONFLICT (payment_purpose, payment_method, environment) DO NOTHING;

INSERT INTO public.payment_provider_routes (
  payment_purpose,
  payment_method,
  primary_provider,
  fallback_provider,
  environment,
  is_enabled
)
VALUES
  ('plan_subscription', 'card', 'paystack', 'monnify', 'sandbox', true),
  ('plan_subscription', 'bank_transfer', 'paystack', 'monnify', 'sandbox', true),
  ('plan_subscription', 'ussd', 'paystack', 'monnify', 'sandbox', true),
  ('plan_subscription', 'crypto', 'breet', NULL, 'sandbox', false),
  ('plan_upgrade', 'card', 'paystack', 'monnify', 'sandbox', true),
  ('plan_upgrade', 'bank_transfer', 'paystack', 'monnify', 'sandbox', true),
  ('plan_upgrade', 'ussd', 'paystack', 'monnify', 'sandbox', true),
  ('plan_upgrade', 'crypto', 'breet', NULL, 'sandbox', false),
  ('invoice_payment', 'card', 'paystack', 'monnify', 'sandbox', true),
  ('invoice_payment', 'bank_transfer', 'paystack', 'monnify', 'sandbox', true),
  ('invoice_payment', 'ussd', 'paystack', 'monnify', 'sandbox', true),
  ('invoice_payment', 'crypto', 'breet', NULL, 'sandbox', true),
  ('payment_link', 'card', 'paystack', 'monnify', 'sandbox', true),
  ('payment_link', 'bank_transfer', 'paystack', 'monnify', 'sandbox', true),
  ('payment_link', 'ussd', 'paystack', 'monnify', 'sandbox', true),
  ('payment_link', 'crypto', 'breet', NULL, 'sandbox', true),
  ('plan_subscription', 'card', 'monnify', 'paystack', 'live', true),
  ('plan_subscription', 'bank_transfer', 'monnify', 'paystack', 'live', true),
  ('plan_subscription', 'ussd', 'monnify', 'paystack', 'live', true),
  ('plan_subscription', 'crypto', 'breet', NULL, 'live', false),
  ('plan_upgrade', 'card', 'monnify', 'paystack', 'live', true),
  ('plan_upgrade', 'bank_transfer', 'monnify', 'paystack', 'live', true),
  ('plan_upgrade', 'ussd', 'monnify', 'paystack', 'live', true),
  ('plan_upgrade', 'crypto', 'breet', NULL, 'live', false),
  ('invoice_payment', 'card', 'monnify', 'paystack', 'live', true),
  ('invoice_payment', 'bank_transfer', 'monnify', 'paystack', 'live', true),
  ('invoice_payment', 'ussd', 'monnify', 'paystack', 'live', true),
  ('invoice_payment', 'crypto', 'breet', NULL, 'live', false),
  ('payment_link', 'card', 'monnify', 'paystack', 'live', true),
  ('payment_link', 'bank_transfer', 'monnify', 'paystack', 'live', true),
  ('payment_link', 'ussd', 'monnify', 'paystack', 'live', true),
  ('payment_link', 'crypto', 'breet', NULL, 'live', false)
ON CONFLICT (payment_purpose, payment_method, environment) DO NOTHING;
