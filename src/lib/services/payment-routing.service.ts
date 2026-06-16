import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export type PaymentPurpose =
  | "plan_subscription"
  | "plan_upgrade"
  | "invoice_payment"
  | "payment_link"
  | "crypto_payment";

export type PaymentMethod = "card" | "bank_transfer" | "ussd" | "crypto";
export type PaymentProvider = "paystack" | "monnify" | "breet";
export type PaymentEnvironment = "sandbox" | "live";
export type PaymentProviderStatus =
  | "active"
  | "inactive"
  | "degraded"
  | "down"
  | "pending_live_approval"
  | "sandbox_only";

type PaymentProviderRecord = {
  id: string;
  provider_name: PaymentProvider;
  environment: PaymentEnvironment;
  status: PaymentProviderStatus;
  allow_degraded_routing: boolean;
  supports_card: boolean;
  supports_bank_transfer: boolean;
  supports_ussd: boolean;
  supports_crypto: boolean;
  public_key_hint: string | null;
  merchant_id_hint: string | null;
  webhook_secret_hint: string | null;
  last_health_check_at: string | null;
  last_successful_webhook_at: string | null;
  last_failed_webhook_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type PaymentMethodConfigRecord = {
  id: string;
  payment_purpose: PaymentPurpose;
  payment_method: PaymentMethod;
  environment: PaymentEnvironment;
  is_enabled: boolean;
  display_label: string;
  display_description: string | null;
  created_at: string;
  updated_at: string;
};

type PaymentProviderRouteRecord = {
  id: string;
  payment_purpose: PaymentPurpose;
  payment_method: PaymentMethod;
  primary_provider: PaymentProvider;
  fallback_provider: PaymentProvider | null;
  environment: PaymentEnvironment;
  is_enabled: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type AvailablePaymentMethod = {
  method: PaymentMethod;
  label: string;
  description: string;
  enabled: boolean;
  provider: PaymentProvider;
  fallbackProvider: PaymentProvider | null;
};

export type ConfiguredPaymentMethodRoute = {
  method: PaymentMethod;
  label: string;
  description: string;
  enabled: boolean;
  primaryProvider: PaymentProvider | null;
  fallbackProvider: PaymentProvider | null;
  configuredProviders: PaymentProvider[];
  availableProviders: PaymentProvider[];
};

export type ResolvedPaymentRoute = {
  purpose: PaymentPurpose;
  method: PaymentMethod;
  environment: PaymentEnvironment;
  provider: PaymentProvider;
  fallbackProvider: PaymentProvider | null;
};

export const SUPERADMIN_SANDBOX_EMAIL =
  (process.env.SUPERADMIN_SANDBOX_EMAIL || "ralphdel14@yahoo.com").toLowerCase();

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DEFAULT_LABELS: Record<PaymentMethod, { label: string; description: string }> = {
  card: {
    label: "Card",
    description: "Pay securely with your debit or credit card",
  },
  bank_transfer: {
    label: "Bank Transfer",
    description: "Transfer from your bank app or virtual account",
  },
  ussd: {
    label: "USSD",
    description: "Pay using your bank USSD code",
  },
  crypto: {
    label: "Crypto",
    description: "Pay with crypto when this rail is active",
  },
};

function getRuntimeEnvironment(): PaymentEnvironment {
  const env = process.env.PAYMENT_ENVIRONMENT?.toLowerCase();
  if (env === "live" || env === "sandbox") {
    return env;
  }
  return process.env.NODE_ENV === "production" ? "live" : "sandbox";
}

export function getPaymentEnvironmentForMerchantEmail(email?: string | null): PaymentEnvironment {
  if (email?.toLowerCase() === SUPERADMIN_SANDBOX_EMAIL) return "sandbox";
  return getRuntimeEnvironment();
}

function isProviderStatusUsable(
  status: PaymentProviderStatus,
  environment: PaymentEnvironment,
  allowDegraded: boolean
) {
  if (status === "active") return true;
  if (status === "degraded") return allowDegraded;
  if (status === "sandbox_only") return environment === "sandbox";
  if (status === "pending_live_approval") return environment === "sandbox";
  return false;
}

function providerSupportsMethod(provider: PaymentProviderRecord, method: PaymentMethod) {
  switch (method) {
    case "card":
      return provider.supports_card;
    case "bank_transfer":
      return provider.supports_bank_transfer;
    case "ussd":
      return provider.supports_ussd;
    case "crypto":
      return provider.supports_crypto;
    default:
      return false;
  }
}

function providerHasCredentials(provider: PaymentProvider) {
  if (provider === "paystack") {
    return Boolean(process.env.PAYSTACK_SECRET_KEY && process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY);
  }
  if (provider === "monnify") {
    return Boolean(
      process.env.MONNIFY_API_KEY &&
      process.env.MONNIFY_SECRET_KEY &&
      process.env.MONNIFY_CONTRACT_CODE
    );
  }
  return Boolean(process.env.BREET_APP_ID && process.env.BREET_APP_SECRET);
}

async function fetchRoutingState(environment: PaymentEnvironment) {
  const [providersRes, routesRes, methodsRes] = await Promise.all([
    supabase
      .from("payment_providers")
      .select("*")
      .eq("environment", environment)
      .order("provider_name", { ascending: true }),
    supabase
      .from("payment_provider_routes")
      .select("*")
      .eq("environment", environment)
      .order("payment_purpose", { ascending: true }),
    supabase
      .from("payment_method_configs")
      .select("*")
      .eq("environment", environment)
      .order("payment_purpose", { ascending: true }),
  ]);

  if (providersRes.error) {
    throw new Error(providersRes.error.message);
  }
  if (routesRes.error) {
    throw new Error(routesRes.error.message);
  }
  if (methodsRes.error) {
    throw new Error(methodsRes.error.message);
  }

  return {
    providers: (providersRes.data || []) as PaymentProviderRecord[],
    routes: (routesRes.data || []) as PaymentProviderRouteRecord[],
    methods: (methodsRes.data || []) as PaymentMethodConfigRecord[],
  };
}

function resolveProviderCandidate(
  providerName: PaymentProvider | null | undefined,
  providers: PaymentProviderRecord[],
  method: PaymentMethod,
  environment: PaymentEnvironment
) {
  if (!providerName) return null;
  const provider = providers.find((row) => row.provider_name === providerName && row.environment === environment);
  if (!provider) return null;
  if (!providerSupportsMethod(provider, method)) return null;
  if (!providerHasCredentials(providerName)) return null;
  if (!isProviderStatusUsable(provider.status, environment, provider.allow_degraded_routing)) return null;
  return provider;
}

export async function getPaymentRoutingSnapshot(environment = getRuntimeEnvironment()) {
  return fetchRoutingState(environment);
}

export async function listAvailablePaymentMethods(
  purpose: PaymentPurpose,
  environment = getRuntimeEnvironment()
): Promise<AvailablePaymentMethod[]> {
  const { providers, routes, methods } = await fetchRoutingState(environment);
  const purposeMethods = methods.filter(
    (row) => row.payment_purpose === purpose && row.environment === environment && row.is_enabled
  );

  const available = purposeMethods
    .map((methodConfig): AvailablePaymentMethod | null => {
      const route = routes.find(
        (row) =>
          row.payment_purpose === purpose &&
          row.payment_method === methodConfig.payment_method &&
          row.environment === environment &&
          row.is_enabled
      );

      if (!route) return null;

      const primary = resolveProviderCandidate(
        route.primary_provider,
        providers,
        methodConfig.payment_method,
        environment
      );
      const fallback = resolveProviderCandidate(
        route.fallback_provider,
        providers,
        methodConfig.payment_method,
        environment
      );
      const selected = primary || fallback;

      if (!selected) return null;

      return {
        method: methodConfig.payment_method,
        label: methodConfig.display_label || DEFAULT_LABELS[methodConfig.payment_method].label,
        description:
          methodConfig.display_description || DEFAULT_LABELS[methodConfig.payment_method].description,
        enabled: true,
        provider: selected.provider_name,
        fallbackProvider: route.fallback_provider,
      };
    })
    .filter((value): value is AvailablePaymentMethod => value !== null);

  return available;
}

export async function listConfiguredPaymentMethodRoutes(
  purpose: PaymentPurpose,
  environment = getRuntimeEnvironment()
): Promise<ConfiguredPaymentMethodRoute[]> {
  const { providers, routes, methods } = await fetchRoutingState(environment);
  const purposeMethods = methods.filter(
    (row) => row.payment_purpose === purpose && row.environment === environment && row.is_enabled
  );

  return purposeMethods.map((methodConfig) => {
    const route = routes.find(
      (row) =>
        row.payment_purpose === purpose &&
        row.payment_method === methodConfig.payment_method &&
        row.environment === environment &&
        row.is_enabled
    );

    const configuredProviders = route
      ? [route.primary_provider, route.fallback_provider].filter(
          (provider): provider is PaymentProvider => Boolean(provider)
        )
      : [];

    const availableProviders = route
      ? configuredProviders.filter((providerName, index, providersList) => {
          if (providersList.indexOf(providerName) !== index) return false;
          return Boolean(
            resolveProviderCandidate(
              providerName,
              providers,
              methodConfig.payment_method,
              environment
            )
          );
        })
      : [];

    return {
      method: methodConfig.payment_method,
      label: methodConfig.display_label || DEFAULT_LABELS[methodConfig.payment_method].label,
      description:
        methodConfig.display_description || DEFAULT_LABELS[methodConfig.payment_method].description,
      enabled: Boolean(route),
      primaryProvider: route?.primary_provider || null,
      fallbackProvider: route?.fallback_provider || null,
      configuredProviders,
      availableProviders,
    };
  });
}

export async function resolvePaymentRoute(
  purpose: PaymentPurpose,
  method: PaymentMethod,
  environment = getRuntimeEnvironment()
): Promise<ResolvedPaymentRoute> {
  const { providers, routes } = await fetchRoutingState(environment);
  const route = routes.find(
    (row) =>
      row.payment_purpose === purpose &&
      row.payment_method === method &&
      row.environment === environment &&
      row.is_enabled
  );

  if (!route) {
    throw new Error(`No active payment route for ${purpose} via ${method} in ${environment}.`);
  }

  const primary = resolveProviderCandidate(route.primary_provider, providers, method, environment);
  const fallback = resolveProviderCandidate(route.fallback_provider, providers, method, environment);
  const selected = primary || fallback;

  if (!selected) {
    throw new Error(`No available provider for ${purpose} via ${method} in ${environment}.`);
  }

  return {
    purpose,
    method,
    environment,
    provider: selected.provider_name,
    fallbackProvider: route.fallback_provider,
  };
}

export function getPaymentEnvironment() {
  return getRuntimeEnvironment();
}
