import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isProviderSettlementReady,
  getSettlementEnvironment,
} from "@/lib/services/settlement-ledger.service";

export type BreetSettlementMode = "provider_direct" | "treasury_manual" | "disabled";

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
  "breet_invoice_crypto_enabled",
  "breet_subscription_crypto_enabled",
  "breet_webhook_url",
  "breet_supported_assets",
  "breet_supported_networks",
  "breet_treasury_settlement_account_reference",
  "breet_treasury_settlement_account_label",
  "breet_live_enabled",
  "crypto_session_ttl_minutes",
  "crypto_rate_lock_minutes",
  "crypto_underpayment_tolerance_bps",
  "crypto_overpayment_action",
  "crypto_manual_review_threshold_bps",
  "crypto_settlement_currency",
] as const;

export type BreetRuntimeConfig = {
  settlementMode: BreetSettlementMode;
  invoiceCryptoEnabled: boolean;
  subscriptionCryptoEnabled: boolean;
  webhookUrl: string | null;
  supportedAssets: string[];
  supportedNetworks: string[];
  treasurySettlementAccountReference: string | null;
  treasurySettlementAccountLabel: string | null;
  liveEnabled: boolean;
  sessionTtlMinutes: number;
  rateLockMinutes: number;
  underpaymentToleranceBps: number;
  manualReviewThresholdBps: number;
  overpaymentAction: "manual_review" | "accept" | "reject";
  settlementCurrency: string;
};

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

export function normalizeBreetSettlementMode(value?: string | null): BreetSettlementMode {
  const normalized = String(value || "disabled").toLowerCase();
  if (normalized === "provider_direct") return "provider_direct";
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

export async function loadBreetRuntimeConfig(supabase: SupabaseClient): Promise<BreetRuntimeConfig> {
  const { data } = await supabase
    .from("platform_settings")
    .select("key, value")
    .in("key", BREET_PLATFORM_SETTING_KEYS as unknown as string[]);

  const map = new Map((data || []).map((row) => [row.key, String(row.value || "")]));
  return {
    settlementMode: normalizeBreetSettlementMode(settingValue(map, "breet_settlement_mode", "disabled")),
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

  if (config.settlementMode === "treasury_manual" && !config.treasurySettlementAccountReference) {
    return {
      allowed: false,
      reason: "Treasury/manual settlement is not configured.",
      settlementMode: config.settlementMode,
      config,
    } as const;
  }

  if (input.purpose === "invoice_payment" || input.purpose === "payment_link" || input.purpose === "crypto_payment") {
    if (!config.invoiceCryptoEnabled) {
      return { allowed: false, reason: "Crypto payments are disabled for invoice checkout.", settlementMode: config.settlementMode, config } as const;
    }

    if (config.settlementMode === "provider_direct") {
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

  }

  if (input.purpose === "plan_subscription" || input.purpose === "plan_upgrade") {
    if (!config.subscriptionCryptoEnabled) {
      return { allowed: false, reason: "Crypto payments are disabled for subscription checkout.", settlementMode: config.settlementMode, config } as const;
    }
  }

  return { allowed: true, settlementMode: config.settlementMode, config } as const;
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
