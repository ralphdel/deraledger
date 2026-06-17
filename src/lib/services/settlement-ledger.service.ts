import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AvailablePaymentMethod,
  PaymentEnvironment,
  PaymentMethod,
  PaymentProvider,
  PaymentPurpose,
  ResolvedPaymentRoute,
} from "@/lib/services/payment-routing.service";
import { listConfiguredPaymentMethodRoutes, resolvePaymentRoute } from "@/lib/services/payment-routing.service";
import { calculateProviderReportedSettlement } from "@/lib/services/provider-settlement-calculation.service";
import {
  canUseBreetCryptoCheckout,
  getMerchantBreetMappingState,
  normalizeBreetSettlementMode,
  normalizeMerchantFacingPaymentMethod,
} from "@/lib/services/breet-crypto.service";

export type SettlementProvider = PaymentProvider | "future_provider";

type SettlementAccountInput = {
  merchantId: string;
  bankName: string;
  bankCode?: string | null;
  accountNumber: string;
  accountName: string;
  settlementAccountId?: string | null;
  providerName?: PaymentProvider | null;
  providerSubaccountCode?: string | null;
  providerAccountReference?: string | null;
  providerSplitReference?: string | null;
  environment?: PaymentEnvironment;
  rawProviderResponse?: Record<string, unknown> | null;
};

export const MONNIFY_SUBACCOUNT_SETUP_SOURCE = "monnify_subaccount_setup";

export type ProviderReadinessStatus =
  | "connected"
  | "pending"
  | "degraded"
  | "temporarily_unavailable"
  | "requires_action"
  | "failed"
  | "disabled";

export type ProviderReadiness = {
  provider_name: string;
  environment: PaymentEnvironment;
  status: ProviderReadinessStatus;
  reason_code: string | null;
  merchant_message: string | null;
  admin_note: string | null;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  retryable: boolean;
  recommended_action: string | null;
  ready: boolean;
};

export type MerchantPaymentMethodStatus =
  | "ready"
  | "setup_in_progress"
  | "needs_attention"
  | "temporarily_unavailable"
  | "not_available";

export type MerchantPaymentMethodReadiness = {
  method: PaymentMethod;
  label: string;
  status: MerchantPaymentMethodStatus;
  message: string | null;
  available: boolean;
  affected: boolean;
};

export type MerchantPaymentSetupBanner = {
  show: boolean;
  title: string;
  body: string;
  affected_methods: string[];
  action_label: string;
  href: string;
};

type ProviderMappingRow = {
  provider_name?: string | null;
  provider_account_reference?: string | null;
  provider_subaccount_code?: string | null;
  provider_split_reference?: string | null;
  status?: string | null;
  environment?: PaymentEnvironment | string | null;
  raw_provider_response?: Record<string, unknown> | null;
  last_sync_at?: string | null;
};

type TransactionRow = {
  id: string;
  invoice_id: string | null;
  merchant_id: string;
  amount_paid: number | string;
  paystack_fee?: number | string | null;
  fee_absorbed_by?: string | null;
  paystack_reference?: string | null;
  processor_reference?: string | null;
  payment_method?: string | null;
  payment_rail?: string | null;
  merchant_net_amount?: number | string | null;
  settlement_status?: string | null;
  status?: string | null;
  created_at?: string | null;
};

const SETTLEMENT_TABLE_MISSING_CODES = new Set(["42P01", "42703"]);
const READY_PROVIDER_STATUSES = new Set<ProviderReadinessStatus>(["connected"]);
const PROVIDER_STATUS_VALUES = new Set<ProviderReadinessStatus>([
  "connected",
  "pending",
  "degraded",
  "temporarily_unavailable",
  "requires_action",
  "failed",
  "disabled",
]);
const MERCHANT_PAYMENT_METHOD_ORDER: PaymentMethod[] = ["card", "bank_transfer", "ussd", "crypto"];

export function getSettlementEnvironment(email?: string | null): PaymentEnvironment {
  const superAdminEmail = (process.env.SUPERADMIN_SANDBOX_EMAIL || "ralphdel14@yahoo.com").toLowerCase();
  if (email?.toLowerCase() === superAdminEmail) return "sandbox";
  const configured = process.env.PAYMENT_ENVIRONMENT?.toLowerCase();
  if (configured === "live" || configured === "sandbox") return configured;
  return process.env.NODE_ENV === "production" ? "live" : "sandbox";
}

export async function upsertProviderNeutralSettlementAccount(
  supabase: SupabaseClient,
  input: SettlementAccountInput
) {
  const environment = input.environment || getSettlementEnvironment();

  const accountId =
    input.settlementAccountId ||
    (await ensureMerchantSettlementAccount(supabase, {
      merchantId: input.merchantId,
      bankName: input.bankName,
      bankCode: input.bankCode,
      accountNumber: input.accountNumber,
      accountName: input.accountName,
    }));

  if (!accountId) {
    return null;
  }

  const { data: existingMapping } = await supabase
    .from("merchant_provider_settlement_accounts")
    .select("provider_account_reference, provider_subaccount_code, provider_split_reference, status, raw_provider_response")
    .eq("settlement_account_id", accountId)
    .eq("provider_name", input.providerName || "paystack")
    .eq("environment", environment)
    .maybeSingle();

  const mergedRawProviderResponse = {
    ...((existingMapping?.raw_provider_response as Record<string, unknown> | null | undefined) || {}),
    ...(input.rawProviderResponse || {}),
  };
  const mergedProviderSubaccountCode =
    input.providerSubaccountCode ||
    (typeof existingMapping?.provider_subaccount_code === "string" ? existingMapping.provider_subaccount_code : null) ||
    null;
  const mergedProviderAccountReference =
    input.providerAccountReference ||
    input.providerSubaccountCode ||
    (typeof existingMapping?.provider_account_reference === "string" ? existingMapping.provider_account_reference : null) ||
    mergedProviderSubaccountCode;
  const mergedProviderSplitReference =
    input.providerSplitReference ||
    (typeof existingMapping?.provider_split_reference === "string" ? existingMapping.provider_split_reference : null) ||
    null;
  const mergedStatus = normalizeProviderAccountStatus(
    input.rawProviderResponse,
    input.providerSubaccountCode,
    existingMapping?.status
  );

  await supabase
    .from("merchant_provider_settlement_accounts")
    .upsert(
      {
        merchant_id: input.merchantId,
        settlement_account_id: accountId,
        provider_name: input.providerName || "paystack",
        provider_account_reference: mergedProviderAccountReference,
        provider_subaccount_code: mergedProviderSubaccountCode,
        provider_split_reference: mergedProviderSplitReference,
        status: mergedStatus,
        environment,
        raw_provider_response:
          Object.keys(mergedRawProviderResponse).length > 0
            ? mergedRawProviderResponse
            : { source: "settlement_settings" },
        last_sync_at: new Date().toISOString(),
      },
      { onConflict: "settlement_account_id,provider_name,environment" }
    )
    .throwOnError();

  return accountId as string;
}

export async function ensureMerchantSettlementAccount(
  supabase: SupabaseClient,
  input: Pick<
    SettlementAccountInput,
    "merchantId" | "bankName" | "bankCode" | "accountNumber" | "accountName"
  >
) {
  let lookup = supabase
    .from("merchant_settlement_accounts")
    .select("id")
    .eq("merchant_id", input.merchantId)
    .eq("account_number", input.accountNumber)
    .limit(1);

  if (input.bankCode) {
    lookup = lookup.eq("bank_code", input.bankCode);
  } else {
    lookup = lookup.eq("bank_name", input.bankName);
  }

  const { data: existingAccount, error: lookupError } = await lookup.maybeSingle();

  if (lookupError) {
    if (!SETTLEMENT_TABLE_MISSING_CODES.has(lookupError.code || "")) {
      console.error("Failed to look up settlement account:", lookupError.message);
    }
    return null;
  }

  const accountMutation = existingAccount?.id
    ? supabase
        .from("merchant_settlement_accounts")
        .update(
          {
            bank_name: input.bankName,
            bank_code: input.bankCode,
            account_number: input.accountNumber,
            account_name: input.accountName,
            currency: "NGN",
            is_default: true,
            verification_status: "verified",
            status: "active",
            raw_verification_payload: {
              source: "settlement_settings",
            },
          }
        )
        .eq("id", existingAccount.id)
    : supabase
        .from("merchant_settlement_accounts")
        .insert(
          {
            merchant_id: input.merchantId,
            bank_name: input.bankName,
            bank_code: input.bankCode,
            account_number: input.accountNumber,
            account_name: input.accountName,
            currency: "NGN",
            is_default: true,
            verification_status: "verified",
            status: "active",
            raw_verification_payload: {
              source: "settlement_settings",
            },
          }
        );

  const { data: account, error: accountError } = await accountMutation
    .select("id")
    .single();

  if (accountError) {
    if (!SETTLEMENT_TABLE_MISSING_CODES.has(accountError.code || "")) {
      console.error("Failed to upsert settlement account:", accountError.message);
    }
    return null;
  }

  if (!account?.id) return null;

  const { data: otherDefaults } = await supabase
    .from("merchant_settlement_accounts")
    .select("id")
    .eq("merchant_id", input.merchantId)
    .eq("is_default", true)
    .neq("id", account.id);

  if (otherDefaults && otherDefaults.length > 0) {
    await supabase
      .from("merchant_settlement_accounts")
      .update({ is_default: false })
      .in("id", otherDefaults.map((row: { id: string }) => row.id));
  }
  return account.id as string;
}

export async function filterMethodsBySettlementReadiness(
  supabase: SupabaseClient,
  merchantId: string | null | undefined,
  methods: AvailablePaymentMethod[],
  environment: PaymentEnvironment,
  purpose?: PaymentPurpose
) {
  if (!merchantId) return methods;
  if (methods.length === 0) return methods;

  const collectionMethods = methods.filter((method) => method.method !== "crypto");
  const cryptoMethods = methods.filter((method) => method.method === "crypto");

  const readinessChecks = await Promise.all(
    collectionMethods.map(async (method) => ({
      method,
      ready: await isProviderSettlementReady(supabase, {
        merchantId,
        provider: method.provider,
        environment,
      }),
    }))
  );

  const cryptoChecks = await Promise.all(
    cryptoMethods.map(async (method) => ({
      method,
      ready: method.provider === "breet"
        ? (await canUseBreetCryptoCheckout({
            supabase,
            purpose: purpose || "invoice_payment",
            merchantId,
            environment,
          })).allowed
        : await isProviderSettlementReady(supabase, {
            merchantId,
            provider: method.provider,
            environment,
            requireCryptoMapping: true,
          }),
    }))
  );

  return [...readinessChecks, ...cryptoChecks]
    .filter((check) => check.ready)
    .map((check) => check.method);
}

export async function isProviderSettlementReady(
  supabase: SupabaseClient,
  input: {
    merchantId: string;
    provider: SettlementProvider;
    environment: PaymentEnvironment;
    requireCryptoMapping?: boolean;
  }
) {
  const { data: account, error: accountError } = await supabase
    .from("merchant_settlement_accounts")
    .select("id, verification_status, status")
    .eq("merchant_id", input.merchantId)
    .eq("is_default", true)
    .eq("status", "active")
    .maybeSingle();

  if (accountError) {
    if (SETTLEMENT_TABLE_MISSING_CODES.has(accountError.code || "")) {
      return await hasLegacySettlementReadiness(supabase, input.merchantId, input.provider);
    }
    console.error("Settlement readiness account lookup failed:", accountError.message);
    return false;
  }

  if (!account || account.verification_status !== "verified") {
    return await hasLegacySettlementReadiness(supabase, input.merchantId, input.provider);
  }

  const { data: mapping, error: mappingError } = await supabase
    .from("merchant_provider_settlement_accounts")
    .select("id, status, provider_account_reference, provider_subaccount_code, raw_provider_response")
    .eq("settlement_account_id", account.id)
    .eq("provider_name", input.provider)
    .eq("environment", input.environment)
    .in("status", input.requireCryptoMapping ? ["connected", "active"] : ["connected", "active"])
    .maybeSingle();

  if (mappingError) {
    console.error("Settlement readiness mapping lookup failed:", mappingError.message);
    return false;
  }

  if (mapping) {
    const readiness = getProviderReadiness(input.provider, {
      ...mapping,
      environment: input.environment,
    }, {
      requireCryptoMapping: input.requireCryptoMapping,
    });

    return readiness.ready;
  }

  return await hasLegacySettlementReadiness(supabase, input.merchantId, input.provider);
}

export async function getProviderSettlementMapping(
  supabase: SupabaseClient,
  input: {
    merchantId: string;
    provider: SettlementProvider;
    environment: PaymentEnvironment;
    requireCryptoMapping?: boolean;
  }
) {
  const { data: account, error: accountError } = await supabase
    .from("merchant_settlement_accounts")
    .select("id, bank_name, bank_code, account_number, account_name, verification_status, status")
    .eq("merchant_id", input.merchantId)
    .eq("is_default", true)
    .eq("status", "active")
    .maybeSingle();

  if (accountError || !account) {
    return {
      account: null,
      mapping: null,
      ready: false,
    };
  }

  const { data: mapping, error: mappingError } = await supabase
    .from("merchant_provider_settlement_accounts")
    .select("id, provider_name, provider_account_reference, provider_subaccount_code, provider_split_reference, status, environment, raw_provider_response, last_sync_at")
    .eq("settlement_account_id", account.id)
    .eq("provider_name", input.provider)
    .eq("environment", input.environment)
    .in("status", ["connected", "active", "pending", "degraded", "temporarily_unavailable", "requires_action", "failed", "disabled"])
    .maybeSingle();

  if (mappingError) {
    console.error("Provider settlement mapping lookup failed:", mappingError.message);
    return {
      account,
      mapping: null,
      ready: false,
    };
  }

  const readiness = mapping
    ? getProviderReadiness(input.provider, {
        ...mapping,
        environment: input.environment,
      }, {
        requireCryptoMapping: input.requireCryptoMapping,
      })
    : null;

  if (!mapping && input.provider === "paystack") {
    const legacyReady = await hasLegacySettlementReadiness(supabase, input.merchantId, input.provider);
    if (legacyReady) {
      return {
        account,
        mapping: null,
        readiness: {
          provider_name: "paystack",
          environment: input.environment,
          status: "connected" as const,
          reason_code: null,
          merchant_message: null,
          admin_note: null,
          last_checked_at: null,
          last_success_at: null,
          last_failure_at: null,
          retryable: false,
          recommended_action: null,
          ready: true,
        },
        ready: true,
      };
    }
  }

  return {
    account,
    mapping: mapping || null,
    readiness,
    ready: readiness?.ready || false,
  };
}

export async function getMerchantPaymentMethodReadiness(
  supabase: SupabaseClient,
  input: {
    merchantId: string;
    environment: PaymentEnvironment;
    purpose?: PaymentPurpose;
  }
) {
  const purpose = input.purpose || "invoice_payment";
  const configuredRoutes = await listConfiguredPaymentMethodRoutes(purpose, input.environment);
  const configuredRouteMap = new Map(
    configuredRoutes.map((route) => [route.method, route])
  );

  const { data: account } = await supabase
    .from("merchant_settlement_accounts")
    .select("id, verification_status, status")
    .eq("merchant_id", input.merchantId)
    .eq("is_default", true)
    .eq("status", "active")
    .maybeSingle();

  const hasVerifiedPayoutAccount = Boolean(account && account.verification_status === "verified");

  const methods = await Promise.all(
    MERCHANT_PAYMENT_METHOD_ORDER.map(async (method) => {
      const route = configuredRouteMap.get(method) || null;
      if (!route || !route.enabled) {
        return {
          method,
          label: getMerchantPaymentMethodLabel(method),
          status: "not_available" as const,
          message: null,
          available: false,
          affected: false,
        };
      }

      if (!hasVerifiedPayoutAccount) {
        return {
          method,
          label: getMerchantPaymentMethodLabel(method),
          status: "needs_attention" as const,
          message: "Add a payout account before customers can use this payment option.",
          available: false,
          affected: true,
        };
      }

      let selectedRoute: ResolvedPaymentRoute | null = null;
      try {
        selectedRoute = await resolvePaymentRoute(purpose, method, input.environment);
      } catch {
        selectedRoute = null;
      }

      if (!selectedRoute) {
        return {
          method,
          label: getMerchantPaymentMethodLabel(method),
          status: "not_available" as const,
          message: null,
          available: false,
          affected: false,
        };
      }

      const providerMapping = await getProviderSettlementMapping(supabase, {
        merchantId: input.merchantId,
        provider: selectedRoute.provider,
        environment: input.environment,
        requireCryptoMapping: method === "crypto",
      });

      const readiness =
        providerMapping.readiness ||
        getProviderReadiness(selectedRoute.provider, null, {
          requireCryptoMapping: method === "crypto",
        });

      if (readiness.ready) {
        return {
          method,
          label: getMerchantPaymentMethodLabel(method),
          status: "ready" as const,
          message: null,
          available: true,
          affected: false,
        };
      }

      const status = mapProviderReadinessToMerchantStatus([readiness]);
      return {
        method,
        label: getMerchantPaymentMethodLabel(method),
        status,
        message: getMerchantPaymentMethodMessage(method, status),
        available: false,
        affected: status !== "not_available",
      };
    })
  );

  const banner = buildMerchantPaymentSetupBanner({
    methods,
    hasVerifiedPayoutAccount,
  });

  return {
    has_payout_account: hasVerifiedPayoutAccount,
    methods,
    banner,
  };
}

export function getProviderReadiness(
  provider: SettlementProvider,
  mapping: ProviderMappingRow | null | undefined,
  options?: { requireCryptoMapping?: boolean }
): ProviderReadiness {
  const environment = normalizeReadinessEnvironment(mapping?.environment);
  const raw = (mapping?.raw_provider_response as Record<string, unknown> | null | undefined) || null;
  const explicitStatus = normalizeReadinessStatus(mapping?.status, raw);
  const explicitReasonCode = stringValue(raw?.reason_code);
  const source = stringValue(raw?.source);
  const lastCheckedAt =
    stringValue(raw?.last_checked_at) ||
    stringValue(raw?.checkedAt) ||
    stringValue(mapping?.last_sync_at) ||
    null;
  const lastSuccessAt =
    stringValue(raw?.last_success_at) ||
    stringValue(raw?.successAt) ||
    null;
  const lastFailureAt =
    stringValue(raw?.last_failure_at) ||
    stringValue(raw?.failedAt) ||
    null;
  const lastError = stringValue(raw?.lastError);

  if (!mapping) {
    return {
      provider_name: provider,
      environment,
      status: "pending",
      reason_code: "missing_provider_mapping",
      merchant_message: null,
      admin_note: null,
      last_checked_at: null,
      last_success_at: null,
      last_failure_at: null,
      retryable: false,
      recommended_action: "Complete settlement setup for this provider.",
      ready: false,
    };
  }

  if (provider === "monnify") {
    if (
      source === MONNIFY_SUBACCOUNT_SETUP_SOURCE &&
      typeof mapping.provider_subaccount_code === "string" &&
      mapping.provider_subaccount_code.trim() &&
      explicitStatus === "connected"
    ) {
      return {
        provider_name: provider,
        environment,
        status: "connected",
        reason_code: null,
        merchant_message: null,
        admin_note: null,
        last_checked_at: lastCheckedAt,
        last_success_at: lastSuccessAt || lastCheckedAt,
        last_failure_at: lastFailureAt,
        retryable: false,
        recommended_action: null,
        ready: true,
      };
    }

    const monnifyFailure = classifyMonnifyFailure(explicitReasonCode, lastError);
    if (monnifyFailure) {
      return {
        provider_name: provider,
        environment,
        status: monnifyFailure.status,
        reason_code: monnifyFailure.reason_code,
        merchant_message: monnifyFailure.merchant_message,
        admin_note: monnifyFailure.admin_note,
        last_checked_at: lastCheckedAt,
        last_success_at: lastSuccessAt,
        last_failure_at: lastFailureAt || lastCheckedAt,
        retryable: monnifyFailure.retryable,
        recommended_action: monnifyFailure.recommended_action,
        ready: false,
      };
    }

    if (!stringValue(mapping.provider_subaccount_code)) {
      return {
        provider_name: provider,
        environment,
        status: explicitStatus === "disabled" ? "disabled" : "pending",
        reason_code: explicitReasonCode,
        merchant_message: null,
        admin_note: stringValue(raw?.admin_note) || null,
        last_checked_at: lastCheckedAt,
        last_success_at: lastSuccessAt,
        last_failure_at: lastFailureAt,
        retryable: true,
        recommended_action:
          stringValue(raw?.recommended_action) ||
          "Retry Monnify subaccount setup after confirming the provider is available.",
        ready: false,
      };
    }
  }

  if (provider === "breet" && options?.requireCryptoMapping) {
    const mappingState = getMerchantBreetMappingState(
      {
        raw_verification_payload: null,
        bank_id: typeof mapping.provider_account_reference === "string" ? mapping.provider_account_reference : null,
      },
      {
        provider_account_reference: typeof mapping.provider_account_reference === "string" ? mapping.provider_account_reference : null,
        raw_provider_response: raw,
        status: mapping.status || null,
      }
    );

    const ready = mappingState.hasMappedBankId && (mappingState.mappingConfirmed || mappingState.validationPassed);
    return {
      provider_name: provider,
      environment,
      status: ready ? "connected" : "requires_action",
      reason_code: ready ? null : "breet_mapping_incomplete",
      merchant_message: ready ? null : "Breet settlement mapping needs to be confirmed before crypto collections can use this account.",
      admin_note: ready ? null : "Validate the merchant account and confirm the Breet bank mapping.",
      last_checked_at: lastCheckedAt,
      last_success_at: ready ? (lastSuccessAt || lastCheckedAt) : lastSuccessAt,
      last_failure_at: ready ? lastFailureAt : (lastFailureAt || lastCheckedAt),
      retryable: !ready,
      recommended_action: ready ? null : "Validate the account and confirm the mapped Breet bank.",
      ready,
    };
  }

  return {
    provider_name: provider,
    environment,
    status: explicitStatus,
    reason_code: explicitReasonCode,
    merchant_message: stringValue(raw?.merchant_message) || null,
    admin_note: stringValue(raw?.admin_note) || null,
    last_checked_at: lastCheckedAt,
    last_success_at: explicitStatus === "connected" ? (lastSuccessAt || lastCheckedAt) : lastSuccessAt,
    last_failure_at: READY_PROVIDER_STATUSES.has(explicitStatus) ? lastFailureAt : (lastFailureAt || lastCheckedAt),
    retryable: booleanValue(raw?.retryable) ?? !READY_PROVIDER_STATUSES.has(explicitStatus),
    recommended_action: stringValue(raw?.recommended_action) || null,
    ready: READY_PROVIDER_STATUSES.has(explicitStatus),
  };
}

function getMerchantPaymentMethodLabel(method: PaymentMethod) {
  if (method === "card") return "Card payments";
  if (method === "bank_transfer") return "Bank transfer";
  if (method === "ussd") return "USSD";
  return "Crypto payments";
}

function mapProviderReadinessToMerchantStatus(
  readiness: ProviderReadiness[]
): MerchantPaymentMethodStatus {
  if (readiness.some((entry) => entry.status === "temporarily_unavailable")) {
    return "temporarily_unavailable";
  }
  if (readiness.some((entry) => entry.status === "pending")) {
    return "setup_in_progress";
  }
  if (
    readiness.some((entry) =>
      ["requires_action", "failed", "disabled", "degraded"].includes(entry.status)
    )
  ) {
    return "needs_attention";
  }
  return "not_available";
}

function getMerchantPaymentMethodMessage(
  method: PaymentMethod,
  status: MerchantPaymentMethodStatus
) {
  const label = getMerchantPaymentMethodLabel(method);
  const verb = method === "bank_transfer" || method === "ussd" ? "is" : "are";

  if (status === "temporarily_unavailable") {
    return `${label} cannot settle to this payout account right now. Please add another bank account or try again later.`;
  }
  if (status === "setup_in_progress") {
    return `${label} ${verb} still being prepared for this payout account. Please check back shortly or add another bank account if needed.`;
  }
  if (status === "needs_attention") {
    return `${label} ${verb} not ready for this payout account yet. Please add another bank account or update your payout setup.`;
  }
  return null;
}

function buildMerchantPaymentSetupBanner(input: {
  methods: MerchantPaymentMethodReadiness[];
  hasVerifiedPayoutAccount: boolean;
}): MerchantPaymentSetupBanner {
  const affectedMethods = input.methods.filter((method) => method.affected);
  if (!input.hasVerifiedPayoutAccount) {
    const eligibleMethods = input.methods.filter((method) => method.status !== "not_available");
    if (eligibleMethods.length === 0) {
      return emptyMerchantPaymentSetupBanner();
    }

    return {
      show: true,
      title: "Payment setup needs attention",
      body: "Some customer payment options cannot settle to your current payout account yet. Add another bank account to keep all payment methods available.",
      affected_methods: eligibleMethods.map((method) => method.label),
      action_label: "Review payout account",
      href: "/settings/settlement",
    };
  }

  if (affectedMethods.length === 0) {
    return emptyMerchantPaymentSetupBanner();
  }

  return {
    show: true,
    title: "Payment setup needs attention",
    body: "Some customer payment options cannot settle to your current payout account yet. Add another bank account to keep all payment methods available.",
    affected_methods: affectedMethods.map((method) => method.label),
    action_label: "Review payout account",
    href: "/settings/settlement",
  };
}

function emptyMerchantPaymentSetupBanner(): MerchantPaymentSetupBanner {
  return {
    show: false,
    title: "Payment setup needs attention",
    body: "",
    affected_methods: [],
    action_label: "Review payout account",
    href: "/settings/settlement",
  };
}

function classifyMonnifyFailure(reasonCode: string | null, lastError: string | null) {
  const normalizedError = (lastError || "").toLowerCase();

  if (
    reasonCode === "opay_beneficiary_unavailable" ||
    normalizedError.includes("beneficiary not available")
  ) {
    return {
      status: "temporarily_unavailable" as const,
      reason_code: "opay_beneficiary_unavailable",
      merchant_message:
        "OPay is temporarily unavailable for Monnify subaccount setup. Please add another bank account for Monnify collections or use another available provider while this is being resolved.",
      admin_note:
        "Monnify confirmed intermittent 'Beneficiary not available' errors from OPay/PAYCOM. Retry after Monnify confirms bank issue is resolved.",
      retryable: true,
      recommended_action:
        "Retry Monnify setup after Monnify confirms the OPay/PAYCOM beneficiary issue is resolved, or use another bank account.",
    };
  }

  if (
    reasonCode === "invalid_account_details" ||
    normalizedError.includes("invalid account details")
  ) {
    return {
      status: "requires_action" as const,
      reason_code: "invalid_account_details",
      merchant_message:
        "This bank account could not be verified for Monnify subaccount setup. Please confirm the bank details or add another bank account.",
      admin_note:
        "Monnify rejected the bank details for subaccount setup. Verify the bank code and account number before retrying.",
      retryable: false,
      recommended_action:
        "Confirm the bank code and account number, then retry Monnify subaccount setup.",
    };
  }

  if (
    reasonCode === "generic_provider_error" ||
    stringValue(reasonCode) ||
    normalizedError
  ) {
    return {
      status: "degraded" as const,
      reason_code: reasonCode || "generic_provider_error",
      merchant_message:
        "Monnify settlement setup is temporarily experiencing provider issues. Please use another available provider while this is being resolved.",
      admin_note:
        "Monnify subaccount setup failed with a provider-side error. Retry after Monnify confirms the issue is resolved.",
      retryable: true,
      recommended_action:
        "Retry Monnify subaccount setup after confirming provider availability.",
    };
  }

  return null;
}

function normalizeReadinessStatus(status: unknown, raw: Record<string, unknown> | null): ProviderReadinessStatus {
  const explicitStatus = stringValue(status)?.toLowerCase();
  if (explicitStatus === "active") return "connected";
  if (explicitStatus && PROVIDER_STATUS_VALUES.has(explicitStatus as ProviderReadinessStatus)) {
    return explicitStatus as ProviderReadinessStatus;
  }

  const rawStatus = stringValue(raw?.status)?.toLowerCase();
  if (rawStatus === "active") return "connected";
  if (rawStatus && PROVIDER_STATUS_VALUES.has(rawStatus as ProviderReadinessStatus)) {
    return rawStatus as ProviderReadinessStatus;
  }

  return "pending";
}

function normalizeReadinessEnvironment(environment: unknown): PaymentEnvironment {
  return environment === "live" ? "live" : "sandbox";
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return null;
}

function normalizeProviderAccountStatus(
  rawProviderResponse: Record<string, unknown> | null | undefined,
  providerSubaccountCode: string | null | undefined,
  existingStatus: unknown
) {
  const explicitStatus = stringValue(rawProviderResponse?.status)?.toLowerCase();
  if (explicitStatus === "active") return "connected";
  if (explicitStatus && PROVIDER_STATUS_VALUES.has(explicitStatus as ProviderReadinessStatus)) {
    return explicitStatus;
  }
  if (providerSubaccountCode) return "connected";
  const normalizedExistingStatus = stringValue(existingStatus)?.toLowerCase();
  if (normalizedExistingStatus === "active") return "connected";
  if (normalizedExistingStatus && PROVIDER_STATUS_VALUES.has(normalizedExistingStatus as ProviderReadinessStatus)) {
    return normalizedExistingStatus;
  }
  return "pending";
}

export async function upsertSettlementLedgerForTransaction(
  supabase: SupabaseClient,
  transactionId: string,
  options?: {
    provider?: PaymentProvider;
    settlementMode?: string | null;
    rawProviderPayload?: Record<string, unknown> | null;
  }
) {
  const { data: transaction, error: transactionError } = await supabase
    .from("transactions")
    .select("*")
    .eq("id", transactionId)
    .maybeSingle();

  if (transactionError || !transaction) {
    if (transactionError) console.error("Failed to load transaction for settlement ledger:", transactionError.message);
    return;
  }

  await upsertSettlementLedgerFromTransaction(supabase, transaction as TransactionRow, options);
}

export async function upsertSettlementLedgerFromTransaction(
  supabase: SupabaseClient,
  transaction: TransactionRow,
  options?: {
    provider?: PaymentProvider;
    settlementMode?: string | null;
    rawProviderPayload?: Record<string, unknown> | null;
  }
) {
  if (transaction.status && transaction.status !== "success") return;

  const provider = options?.provider || (await inferProviderForTransaction(supabase, transaction));
  const providerReference = transaction.processor_reference || transaction.paystack_reference || transaction.id;
  const amountPaid = Number(transaction.amount_paid || 0);
  const feeAbsorbedBy = transaction.fee_absorbed_by || "business";
  const paymentMethod = normalizeMerchantFacingPaymentMethod(
    transaction.payment_method || transaction.payment_rail || "card"
  );
  const settlementMode = options?.settlementMode
    ? normalizeBreetSettlementMode(options.settlementMode)
    : provider === "breet"
      ? "breet_auto_settlement"
      : "provider_direct";
  const createdAt = transaction.created_at || new Date().toISOString();

  const { data: event } = await supabase
    .from("payment_events")
    .select("raw_payload")
    .eq("processor_ref", providerReference)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const rawPayload = chooseBestProviderPayload(provider, options?.rawProviderPayload || null, event?.raw_payload || null);
  const providerReportedSettlement = calculateProviderReportedSettlement({
    grossAmount: amountPaid,
    feePayer: feeAbsorbedBy,
    providerFeesKobo: extractProviderFeeKobo(provider, rawPayload, transaction),
    providerSettlementAmountKobo: extractProviderSettlementAmountKobo(provider, rawPayload),
  });
  const providerFee = providerReportedSettlement.providerFee ?? Number(transaction.paystack_fee || 0);
  const expectedSettlement = providerReportedSettlement.expectedSettlement;
  const { data: merchant } = await supabase
    .from("merchants")
    .select("id, email")
    .eq("id", transaction.merchant_id)
    .maybeSingle();
  const environment = getSettlementEnvironment(merchant?.email);

  const { data: paymentRecord, error: paymentError } = await supabase
    .from("payment_records")
    .upsert(
      {
        merchant_id: transaction.merchant_id,
        invoice_id: transaction.invoice_id,
        legacy_transaction_id: transaction.id,
        payment_purpose: "invoice_payment",
        payment_method: paymentMethod,
        provider_name: provider,
        internal_reference: providerReference,
        provider_reference: providerReference,
        amount_paid: amountPaid,
        currency: "NGN",
        payment_status: "successful",
        raw_provider_payload: rawPayload,
        paid_at: createdAt,
      },
      { onConflict: "internal_reference" }
    )
    .select("id")
    .single();

  if (paymentError) {
    if (!SETTLEMENT_TABLE_MISSING_CODES.has(paymentError.code || "")) {
      console.error("Failed to upsert payment record:", paymentError.message);
    }
    return;
  }

  const settlementRefs = await resolveSettlementReferences(supabase, {
    merchantId: transaction.merchant_id,
    provider,
    environment,
  });

  const settlementStatus = !settlementRefs.accountId
    ? "manual_review"
    : providerReportedSettlement.settlementStatus;
  const settlementOwner = settlementStatus === "manual_review" || settlementMode === "treasury_manual"
    ? "manual_review"
    : "provider";

  const { error: settlementError } = await supabase
    .from("settlement_records")
    .upsert(
      {
        payment_record_id: paymentRecord.id,
        legacy_transaction_id: transaction.id,
        merchant_id: transaction.merchant_id,
        settlement_account_id: settlementRefs.accountId,
        provider_settlement_account_id: settlementRefs.providerMappingId,
        provider_name: provider,
        payment_method: paymentMethod,
        settlement_recipient_type: "merchant",
        settlement_currency: "NGN",
        gross_amount: amountPaid,
        provider_fee: providerFee,
        platform_fee: 0,
        customer_fee: feeAbsorbedBy === "customer" ? providerFee : 0,
        merchant_fee: feeAbsorbedBy === "business" ? providerFee : 0,
        expected_settlement: expectedSettlement,
        actual_settlement: null,
        settlement_difference: null,
        fee_payer: feeAbsorbedBy === "customer" ? "customer_pays_fee" : "merchant_pays_fee",
        settlement_status: settlementStatus,
        settlement_mode: settlementMode,
        settlement_owner: settlementOwner,
        payout_action_required: settlementOwner !== "provider",
        provider_settlement_reference: providerReference,
        provider_fee_source: providerReportedSettlement.providerFeeSource,
        expected_settlement_source: providerReportedSettlement.expectedSettlementSource,
        raw_settlement_payload: rawPayload,
      },
      { onConflict: "payment_record_id" }
    );

  if (settlementError && !SETTLEMENT_TABLE_MISSING_CODES.has(settlementError.code || "")) {
    console.error("Failed to upsert settlement record:", settlementError.message);
  }
}

function getNestedValue(payload: Record<string, unknown> | null, path: string[]) {
  let current: unknown = payload;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function chooseBestProviderPayload(
  provider: PaymentProvider,
  preferred: Record<string, unknown> | null,
  fallback: Record<string, unknown> | null
) {
  if (hasProviderSettlementSignal(provider, preferred)) return preferred;
  if (hasProviderSettlementSignal(provider, fallback)) return fallback;
  return preferred || fallback || null;
}

function hasProviderSettlementSignal(provider: PaymentProvider, payload: Record<string, unknown> | null) {
  if (!payload) return false;
  if (provider === "monnify") {
    return Boolean(
      getNestedValue(payload, ["eventData", "settlementAmount"]) ??
      getNestedValue(payload, ["settlementAmount"])
    );
  }
  return Boolean(
    getNestedValue(payload, ["data", "fees"]) ??
    getNestedValue(payload, ["fees"])
  );
}

function extractProviderSettlementAmountKobo(provider: PaymentProvider, payload: Record<string, unknown> | null) {
  if (provider !== "monnify") return null;
  const settlementAmount = Number(
    getNestedValue(payload, ["eventData", "settlementAmount"]) ??
    getNestedValue(payload, ["settlementAmount"]) ??
    0
  );
  return Number.isFinite(settlementAmount) && settlementAmount > 0
    ? Math.round(settlementAmount * 100)
    : null;
}

function extractProviderFeeKobo(
  provider: PaymentProvider,
  payload: Record<string, unknown> | null,
  transaction: TransactionRow
) {
  const payloadFee = Number(
    getNestedValue(payload, ["data", "fees"]) ??
    getNestedValue(payload, ["fees"]) ??
    0
  );
  if (Number.isFinite(payloadFee) && payloadFee > 0) return Math.round(payloadFee);

  const transactionFee = Number(transaction.paystack_fee || 0);
  if (provider === "paystack" && transactionFee > 0) return Math.round(transactionFee * 100);

  return null;
}

async function hasLegacySettlementReadiness(
  supabase: SupabaseClient,
  merchantId: string,
  provider: SettlementProvider
) {
  if (provider !== "paystack") return false;
  const { data: merchant } = await supabase
    .from("merchants")
    .select("payment_subaccount_code, subaccount_verified")
    .eq("id", merchantId)
    .maybeSingle();

  return Boolean(merchant?.payment_subaccount_code && merchant?.subaccount_verified);
}

async function inferProviderForTransaction(
  supabase: SupabaseClient,
  transaction: TransactionRow
): Promise<PaymentProvider> {
  const reference = transaction.processor_reference || transaction.paystack_reference;
  if (reference) {
    const { data: event } = await supabase
      .from("payment_events")
      .select("processor")
      .eq("processor_ref", reference)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (event?.processor === "monnify" || event?.processor === "paystack") {
      return event.processor;
    }
  }

  if (transaction.processor_reference && transaction.processor_reference !== transaction.paystack_reference) {
    return "monnify";
  }

  return "paystack";
}

async function resolveSettlementReferences(
  supabase: SupabaseClient,
  input: {
    merchantId: string;
    provider: PaymentProvider;
    environment: PaymentEnvironment;
  }
) {
  const { data: account, error: accountError } = await supabase
    .from("merchant_settlement_accounts")
    .select("id")
    .eq("merchant_id", input.merchantId)
    .eq("is_default", true)
    .eq("status", "active")
    .maybeSingle();

  if (accountError || !account?.id) {
    return { accountId: null, providerMappingId: null };
  }

  const { data: mapping } = await supabase
    .from("merchant_provider_settlement_accounts")
    .select("id")
    .eq("settlement_account_id", account.id)
    .eq("provider_name", input.provider)
    .eq("environment", input.environment)
    .in("status", ["connected", "active"])
    .maybeSingle();

  return {
    accountId: account.id as string,
    providerMappingId: (mapping?.id as string | undefined) || null,
  };
}
