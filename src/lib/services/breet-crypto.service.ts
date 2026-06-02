import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isProviderSettlementReady,
  getSettlementEnvironment,
} from "@/lib/services/settlement-ledger.service";

export type BreetSettlementMode = "breet_auto_settlement" | "platform_auto_settlement" | "treasury_manual" | "disabled";
export type BreetSettlementModeV2 = BreetSettlementMode;

export type CryptoPaymentLifecycleStatus =
  | "crypto_payment_initialized"
  | "crypto_payment_waiting"
  | "crypto_payment_detected"
  | "crypto_payment_confirming"
  | "crypto_payment_confirmed"
  | "crypto_underpaid"
  | "crypto_overpaid"
  | "crypto_expired"
  | "crypto_converted_to_ngn"
  | "crypto_settlement_pending"
  | "crypto_settlement_completed"
  | "crypto_settlement_failed"
  | "manual_review"
  | "failed";

export const BREET_PLATFORM_SETTING_KEYS = [
  "breet_settlement_mode",
  "breet_auto_settlement_enabled",
  "breet_merchant_auto_settlement_enabled",
  "breet_invoice_crypto_enabled",
  "breet_subscription_crypto_enabled",
  "breet_webhook_url",
  "breet_supported_assets",
  "breet_supported_networks",
  "breet_treasury_settlement_account_reference",
  "breet_treasury_settlement_account_label",
  "breet_platform_bank_id",
  "breet_platform_bank_code",
  "breet_platform_bank_name",
  "breet_platform_account_number",
  "breet_platform_account_name",
  "breet_default_receive_currency",
  "breet_sandbox_force_platform_settlement",
  "breet_live_enabled",
  "crypto_session_ttl_minutes",
  "crypto_rate_lock_minutes",
  "crypto_underpayment_tolerance_bps",
  "crypto_overpayment_action",
  "crypto_manual_review_threshold_bps",
  "crypto_settlement_currency",
] as const;

export type BreetRuntimeConfig = {
  settlementMode: BreetSettlementModeV2;
  merchantAutoSettlementEnabled: boolean;
  platformAutoSettlementEnabled: boolean;
  invoiceCryptoEnabled: boolean;
  subscriptionCryptoEnabled: boolean;
  webhookUrl: string | null;
  supportedAssets: string[];
  supportedNetworks: string[];
  treasurySettlementAccountReference: string | null;
  treasurySettlementAccountLabel: string | null;
  platformSettlementBankAccount: BreetSettlementBankAccount | null;
  liveEnabled: boolean;
  sessionTtlMinutes: number;
  rateLockMinutes: number;
  underpaymentToleranceBps: number;
  manualReviewThresholdBps: number;
  overpaymentAction: "manual_review" | "accept" | "reject";
  settlementCurrency: string;
};

export type BreetSettlementBankAccount = {
  bank_name?: string | null;
  bank_code?: string | null;
  bank_id?: string | null;
  account_number?: string | null;
  account_name?: string | null;
  currency?: string | null;
  verification_status?: string | null;
  status?: string | null;
  is_default?: boolean | null;
  raw_verification_payload?: Record<string, unknown> | null;
};

export type BreetProviderMode = "invoice" | "platform";

function settingValue(settings: Map<string, string>, key: string, fallback = "") {
  const value = settings.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function parseNumberSetting(settings: Map<string, string>, key: string, fallback: number) {
  const parsed = Number(settings.get(key));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseBooleanSetting(settings: Map<string, string>, key: string, fallback = false) {
  const raw = settings.get(key);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

export function normalizeBreetSettlementMode(value?: string | null): BreetSettlementModeV2 {
  const normalized = String(value || "disabled").toLowerCase();
  if (normalized === "provider_direct" || normalized === "breet_auto_settlement") return "breet_auto_settlement";
  if (normalized === "platform_auto_settlement") return "platform_auto_settlement";
  if (normalized === "treasury_manual") return "treasury_manual";
  return "disabled";
}

export function normalizeCryptoLifecycleStatus(value?: string | null): CryptoPaymentLifecycleStatus {
  const normalized = String(value || "").toLowerCase();
  if (
    normalized === "crypto_payment_initialized" ||
    normalized === "crypto_payment_waiting" ||
    normalized === "crypto_payment_detected" ||
    normalized === "crypto_payment_confirming" ||
    normalized === "crypto_payment_confirmed" ||
    normalized === "crypto_underpaid" ||
    normalized === "crypto_overpaid" ||
    normalized === "crypto_expired" ||
    normalized === "crypto_converted_to_ngn" ||
    normalized === "crypto_settlement_pending" ||
    normalized === "crypto_settlement_completed" ||
    normalized === "crypto_settlement_failed" ||
    normalized === "manual_review" ||
    normalized === "failed"
  ) {
    return normalized as CryptoPaymentLifecycleStatus;
  }

  if (normalized.includes("underpaid")) return "crypto_underpaid";
  if (normalized.includes("overpaid")) return "crypto_overpaid";
  if (normalized.includes("expired")) return "crypto_expired";
  if (normalized.includes("confirm")) return "crypto_payment_confirming";
  if (normalized.includes("detect")) return "crypto_payment_detected";
  if (normalized.includes("settle") && normalized.includes("fail")) return "crypto_settlement_failed";
  if (normalized.includes("settle") && normalized.includes("complete")) return "crypto_settlement_completed";
  if (normalized.includes("review")) return "manual_review";
  if (normalized.includes("fail")) return "failed";

  return "crypto_payment_initialized";
}

export function mapBreetEventToCryptoStatus(
  eventType: string,
  rawStatus?: string | null,
  payload?: Record<string, unknown> | null
): CryptoPaymentLifecycleStatus {
  const event = String(eventType || "").toLowerCase();
  const status = String(rawStatus || "").toLowerCase();
  const payloadStatus =
    typeof payload?.status === "string" ? payload.status.toLowerCase() : "";

  if (event.includes("expired") || status.includes("expired") || payloadStatus.includes("expired")) {
    return "crypto_expired";
  }
  if (event.includes("under") || status.includes("under") || payloadStatus.includes("under")) {
    return "crypto_underpaid";
  }
  if (event.includes("over") || status.includes("over") || payloadStatus.includes("over")) {
    return "crypto_overpaid";
  }
  if (event.includes("confirm") || status.includes("confirm") || payloadStatus.includes("confirm")) {
    return "crypto_payment_confirming";
  }
  if (event.includes("detect") || event.includes("received") || status.includes("detect")) {
    return "crypto_payment_detected";
  }
  if (event.includes("settlement") && event.includes("complete")) {
    return "crypto_settlement_completed";
  }
  if (event.includes("settlement") && event.includes("fail")) {
    return "crypto_settlement_failed";
  }
  if (event.includes("convert")) {
    return "crypto_converted_to_ngn";
  }
  if (event.includes("success") || status === "paid") {
    return "crypto_payment_confirmed";
  }

  return "crypto_payment_waiting";
}

export function buildBreetWebhookIdempotencyKey(providerReference: string, eventType: string) {
  const reference = providerReference.trim();
  const event = eventType.trim();
  return reference ? `breet:${reference}:${event}` : null;
}

export function buildSettlementBankPayload(bankAccount: BreetSettlementBankAccount) {
  const currency = String(bankAccount.currency || "NGN").toUpperCase();
  return {
    bank_name: bankAccount.bank_name || null,
    bank_code: bankAccount.bank_code || bankAccount.bank_id || null,
    bank_id: bankAccount.bank_id || bankAccount.bank_code || null,
    account_number: bankAccount.account_number || null,
    account_name: bankAccount.account_name || null,
    currency,
    settlement_currency: currency,
  };
}

export function validateSettlementAccountForBreet(
  bankAccount: BreetSettlementBankAccount,
  options?: { requireDefault?: boolean }
) {
  const verificationStatus = String(bankAccount.verification_status || "").toLowerCase();
  const status = String(bankAccount.status || "").toLowerCase();
  const currency = String(bankAccount.currency || "NGN").toUpperCase();

  if (!bankAccount.bank_name || (!bankAccount.bank_code && !bankAccount.bank_id) || !bankAccount.account_number || !bankAccount.account_name) {
    return { valid: false, reason: "Settlement account is incomplete." } as const;
  }

  if (currency !== "NGN") {
    return { valid: false, reason: "Settlement account currency must be NGN." } as const;
  }

  if (verificationStatus !== "verified") {
    return { valid: false, reason: "Settlement account is not verified." } as const;
  }

  if (status && status !== "active") {
    return { valid: false, reason: "Settlement account is not active." } as const;
  }

  if (options?.requireDefault && !bankAccount.is_default) {
    return { valid: false, reason: "Settlement account is not the default account." } as const;
  }

  return { valid: true } as const;
}

function readEnvBoolean(value: string | undefined, fallback = false) {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export async function loadBreetRuntimeConfig(supabase: SupabaseClient): Promise<BreetRuntimeConfig> {
  const { data } = await supabase
    .from("platform_settings")
    .select("key, value")
    .in("key", BREET_PLATFORM_SETTING_KEYS as unknown as string[]);

  const map = new Map((data || []).map((row) => [row.key, String(row.value || "")]));
  const envMerchantAutoSettlement = readEnvBoolean(process.env.BREET_MERCHANT_AUTO_SETTLEMENT_ENABLED, true);
  const envPlatformAutoSettlement = readEnvBoolean(process.env.BREET_AUTO_SETTLEMENT_ENABLED, true);
  const envForcePlatformSettlement = readEnvBoolean(process.env.BREET_SANDBOX_FORCE_PLATFORM_SETTLEMENT, false);
  const envFallbackMode =
    envMerchantAutoSettlement ? "breet_auto_settlement" :
    envPlatformAutoSettlement ? "platform_auto_settlement" :
    "disabled";
  const platformBankAccount = {
    bank_name: settingValue(map, "breet_platform_bank_name", process.env.BREET_PLATFORM_BANK_NAME || "") || null,
    bank_code: settingValue(map, "breet_platform_bank_code", process.env.BREET_PLATFORM_BANK_CODE || "") || null,
    bank_id: settingValue(map, "breet_platform_bank_id", "") || null,
    account_number: settingValue(map, "breet_platform_account_number", process.env.BREET_PLATFORM_ACCOUNT_NUMBER || "") || null,
    account_name: settingValue(map, "breet_platform_account_name", process.env.BREET_PLATFORM_ACCOUNT_NAME || "") || null,
    currency: settingValue(map, "breet_default_receive_currency", process.env.BREET_DEFAULT_RECEIVE_CURRENCY || "NGN") || "NGN",
    verification_status: "verified",
    status: "active",
    is_default: true,
  } satisfies BreetSettlementBankAccount;

  return {
    settlementMode: normalizeBreetSettlementMode(settingValue(map, "breet_settlement_mode", envFallbackMode)),
    merchantAutoSettlementEnabled: parseBooleanSetting(map, "breet_merchant_auto_settlement_enabled", envMerchantAutoSettlement),
    platformAutoSettlementEnabled:
      envForcePlatformSettlement ||
      parseBooleanSetting(map, "breet_auto_settlement_enabled", envPlatformAutoSettlement) ||
      parseBooleanSetting(map, "breet_sandbox_force_platform_settlement", false),
    invoiceCryptoEnabled: parseBooleanSetting(map, "breet_invoice_crypto_enabled", false),
    subscriptionCryptoEnabled: parseBooleanSetting(map, "breet_subscription_crypto_enabled", false),
    webhookUrl: settingValue(map, "breet_webhook_url", "") || null,
    supportedAssets: settingValue(map, "breet_supported_assets", "USDT,USDC,BTC,ETH")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
    supportedNetworks: settingValue(map, "breet_supported_networks", "TRON,ETHEREUM,BITCOIN")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
    treasurySettlementAccountReference:
      settingValue(map, "breet_treasury_settlement_account_reference", "") || null,
    treasurySettlementAccountLabel:
      settingValue(map, "breet_treasury_settlement_account_label", "") || null,
    platformSettlementBankAccount: platformBankAccount.bank_name &&
      platformBankAccount.account_number &&
      platformBankAccount.account_name
      ? platformBankAccount
      : null,
    liveEnabled: parseBooleanSetting(map, "breet_live_enabled", false),
    sessionTtlMinutes: parseNumberSetting(map, "crypto_session_ttl_minutes", 30),
    rateLockMinutes: parseNumberSetting(map, "crypto_rate_lock_minutes", 15),
    underpaymentToleranceBps: parseNumberSetting(map, "crypto_underpayment_tolerance_bps", 100),
    manualReviewThresholdBps: parseNumberSetting(map, "crypto_manual_review_threshold_bps", 100),
    overpaymentAction: (() => {
      const value = settingValue(map, "crypto_overpayment_action", "manual_review").toLowerCase();
      return value === "accept" || value === "reject" ? value : "manual_review";
    })(),
    settlementCurrency: settingValue(map, "crypto_settlement_currency", "NGN").toUpperCase(),
  };
}

export function isBreetRuntimeConfigured() {
  return Boolean(process.env.BREET_APP_ID && process.env.BREET_APP_SECRET);
}

export function isBreetWebhookConfigured(config?: Pick<BreetRuntimeConfig, "webhookUrl">) {
  return Boolean(process.env.BREET_WEBHOOK_SECRET || config?.webhookUrl);
}

export function getBreetSettlementMode(config: Pick<BreetRuntimeConfig, "settlementMode">) {
  return config.settlementMode;
}

export async function getSupportedAssets(supabase?: SupabaseClient) {
  if (!supabase) {
    return ["USDT", "USDC", "BTC", "ETH"];
  }

  const { data } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "breet_supported_assets")
    .maybeSingle();

  const raw = String(data?.value || "USDT,USDC,BTC,ETH");
  return raw
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
}

export async function getSupportedNetworks(supabase?: SupabaseClient) {
  if (!supabase) {
    return ["TRON", "ETHEREUM", "BITCOIN"];
  }

  const { data } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "breet_supported_networks")
    .maybeSingle();

  const raw = String(data?.value || "TRON,ETHEREUM,BITCOIN");
  return raw
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
}

export function buildBreetSettlementAccountSnapshot(
  bankAccount: BreetSettlementBankAccount,
  overrides?: { recipientType?: "merchant" | "platform"; settlementMode?: BreetSettlementModeV2 }
) {
  return {
    recipient_type: overrides?.recipientType || "merchant",
    settlement_mode: overrides?.settlementMode || "breet_auto_settlement",
    bank_name: bankAccount.bank_name || null,
    bank_code: bankAccount.bank_code || bankAccount.bank_id || null,
    bank_id: bankAccount.bank_id || bankAccount.bank_code || null,
    account_number: bankAccount.account_number || null,
    account_name: bankAccount.account_name || null,
    currency: String(bankAccount.currency || "NGN").toUpperCase(),
  };
}

export function mapBreetStatusToLocalStatus(status?: string | null) {
  return normalizeCryptoLifecycleStatus(status);
}

export async function canUseBreetCryptoCheckout(input: {
  supabase: SupabaseClient;
  purpose: "invoice_payment" | "payment_link" | "crypto_payment" | "plan_subscription" | "plan_upgrade";
  merchantId?: string | null;
  environment: "sandbox" | "live";
  requireMerchantSettlementMapping?: boolean;
}) {
  const config = await loadBreetRuntimeConfig(input.supabase);
  if (!isBreetRuntimeConfigured()) {
    return { allowed: false, reason: "Breet credentials are incomplete.", settlementMode: config.settlementMode, config } as const;
  }

  if (!isBreetWebhookConfigured(config)) {
    return { allowed: false, reason: "Breet webhook is not configured.", settlementMode: config.settlementMode, config } as const;
  }

  if (input.environment === "live" && !config.liveEnabled) {
    return {
      allowed: false,
      reason: "Breet live checkout is disabled.",
      settlementMode: config.settlementMode,
      config,
    } as const;
  }

  if (config.settlementMode === "disabled") {
    return { allowed: false, reason: "Breet settlement mode is disabled.", settlementMode: config.settlementMode, config } as const;
  }

  const effectiveMode = resolveBreetSettlementModeForPurpose(input.purpose, config.settlementMode);

  if (effectiveMode === "treasury_manual" && !config.treasurySettlementAccountReference) {
    return {
      allowed: false,
      reason: "Treasury/manual settlement is not configured.",
      settlementMode: effectiveMode,
      config,
    } as const;
  }

  if (effectiveMode === "treasury_manual" && !config.platformSettlementBankAccount) {
    return {
      allowed: false,
      reason: "Treasury/manual settlement bank account is not configured.",
      settlementMode: effectiveMode,
      config,
    } as const;
  }

  if (input.purpose === "invoice_payment" || input.purpose === "payment_link" || input.purpose === "crypto_payment") {
    if (!config.invoiceCryptoEnabled) {
      return { allowed: false, reason: "Crypto payments are disabled for invoice checkout.", settlementMode: config.settlementMode, config } as const;
    }

    if (config.settlementMode !== "treasury_manual" && !config.merchantAutoSettlementEnabled) {
      return {
        allowed: false,
        reason: "Merchant crypto auto-settlement is disabled.",
        settlementMode: effectiveMode,
        config,
      } as const;
    }

    if (effectiveMode === "treasury_manual" && config.settlementMode !== "treasury_manual") {
      return {
        allowed: false,
        reason: "Crypto settlement setup is incomplete for this merchant.",
        settlementMode: effectiveMode,
        config,
      } as const;
    }

    if (!input.merchantId) {
      return { allowed: false, reason: "Crypto settlement setup is incomplete for this merchant.", settlementMode: config.settlementMode, config } as const;
    }

    const ready = await isProviderSettlementReady(input.supabase, {
      merchantId: input.merchantId,
      provider: "breet",
      environment: input.environment,
      requireCryptoMapping: true,
    });

    if (!ready) {
      return { allowed: false, reason: "Crypto settlement setup is incomplete for this merchant.", settlementMode: config.settlementMode, config } as const;
    }

  }

  if (input.purpose === "plan_subscription" || input.purpose === "plan_upgrade") {
    if (!config.subscriptionCryptoEnabled) {
      return { allowed: false, reason: "Crypto payments are disabled for subscription checkout.", settlementMode: config.settlementMode, config } as const;
    }

    if (config.settlementMode !== "treasury_manual" && !config.platformAutoSettlementEnabled) {
      return {
        allowed: false,
        reason: "Platform crypto auto-settlement is disabled.",
        settlementMode: effectiveMode,
        config,
      } as const;
    }

    if (effectiveMode === "breet_auto_settlement") {
      return {
        allowed: false,
        reason: "Merchant settlement mode cannot be used for platform crypto payments.",
        settlementMode: effectiveMode,
        config,
      } as const;
    }

    if (effectiveMode === "platform_auto_settlement") {
      const platformConfigured =
        Boolean(config.platformSettlementBankAccount?.bank_name) &&
        Boolean(config.platformSettlementBankAccount?.account_number) &&
        Boolean(config.platformSettlementBankAccount?.account_name) &&
        String(config.platformSettlementBankAccount?.currency || "NGN").toUpperCase() === "NGN";

      if (!platformConfigured) {
        return {
          allowed: false,
          reason: "Platform settlement account is not configured.",
          settlementMode: effectiveMode,
          config,
        } as const;
      }
    }
  }

  return { allowed: true, settlementMode: effectiveMode, config } as const;
}

export function resolveBreetSettlementModeForPurpose(
  purpose: "invoice_payment" | "payment_link" | "crypto_payment" | "plan_subscription" | "plan_upgrade",
  currentMode: BreetSettlementModeV2
) {
  if (currentMode === "treasury_manual" || currentMode === "disabled") return currentMode;

  if (purpose === "invoice_payment" || purpose === "payment_link" || purpose === "crypto_payment") {
    return "breet_auto_settlement";
  }

  return "platform_auto_settlement";
}

export function getSettlementRecipientTypeForPurpose(
  purpose: "invoice_payment" | "payment_link" | "crypto_payment" | "plan_subscription" | "plan_upgrade"
) {
  return purpose === "invoice_payment" || purpose === "payment_link" || purpose === "crypto_payment"
    ? "merchant"
    : "platform";
}

export function isAutoSettlementMode(mode?: string | null) {
  const normalized = normalizeBreetSettlementMode(mode);
  return normalized === "breet_auto_settlement" || normalized === "platform_auto_settlement";
}

export function getBreetProviderHealth() {
  return {
    configured: isBreetRuntimeConfigured(),
    webhookConfigured: isBreetWebhookConfigured(),
    env: process.env.BREET_ENV || "development",
    baseUrl: process.env.BREET_BASE_URL || "https://api.breet.io/v1",
  };
}

export function isCryptoRail(rail?: string | null) {
  const normalized = String(rail || "").toUpperCase();
  return ["USDT", "USDC", "BTC", "ETH"].includes(normalized);
}

export function normalizeMerchantFacingPaymentMethod(method?: string | null) {
  const normalized = String(method || "").toLowerCase();
  if (normalized === "crypto") return "crypto";
  if (isCryptoRail(normalized)) return "crypto";
  return normalized || "card";
}

export function getBreetSettlementEnvironment(email?: string | null) {
  return getSettlementEnvironment(email);
}
