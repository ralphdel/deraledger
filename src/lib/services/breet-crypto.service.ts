import type { SupabaseClient } from "@supabase/supabase-js";
import type { BreetBankListItem, BreetBankValidationResult } from "@/lib/payment/types";
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
  "breet_api_environment",
  "breet_development_checkout_enabled",
  "breet_auto_settlement_enabled",
  "breet_merchant_auto_settlement_enabled",
  "breet_invoice_crypto_enabled",
  "breet_subscription_crypto_enabled",
  "breet_min_auto_settlement_ngn",
  "breet_platform_bank_validated",
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
  "breet_allow_pending_as_completed_in_development",
  "crypto_session_ttl_minutes",
  "crypto_rate_lock_minutes",
  "crypto_underpayment_tolerance_bps",
  "crypto_overpayment_action",
  "crypto_manual_review_threshold_bps",
  "crypto_settlement_currency",
] as const;

export const DEFAULT_BREET_MIN_AUTO_SETTLEMENT_NGN = 2500;
export const BREET_MIN_AMOUNT_ERROR_MESSAGE =
  "Crypto payments are available for amounts from \u20A62,500 and above. Please use another payment method for smaller amounts.";

export type BreetRuntimeConfig = {
  settlementMode: BreetSettlementModeV2;
  apiEnvironment: BreetApiEnvironment;
  developmentCheckoutEnabled: boolean;
  merchantAutoSettlementEnabled: boolean;
  platformAutoSettlementEnabled: boolean;
  invoiceCryptoEnabled: boolean;
  subscriptionCryptoEnabled: boolean;
  minimumAutoSettlementNgn: number;
  platformSettlementBankValidated: boolean;
  webhookUrl: string | null;
  supportedAssets: string[];
  supportedNetworks: string[];
  defaultReceiveCurrency: string;
  forcePlatformSettlementInSandbox: boolean;
  treasurySettlementAccountReference: string | null;
  treasurySettlementAccountLabel: string | null;
  platformSettlementBankAccount: BreetSettlementBankAccount | null;
  liveEnabled: boolean;
  allowPendingAsCompletedInDevelopment: boolean;
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
export type BreetApiEnvironment = "development" | "production";
export type BreetBankSetupCandidate = Pick<
  BreetSettlementBankAccount,
  "bank_name" | "bank_code" | "bank_id" | "account_number" | "account_name" | "raw_verification_payload"
>;

export type BreetMerchantMappingState = {
  hasMappedBankId: boolean;
  mappingConfirmed: boolean;
  validationPassed: boolean;
  mappedBankId: string | null;
  validationReasonCode: string | null;
  validationWarningCode: string | null;
  validationNote: string | null;
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

function parseEnvBoolean(value: string | undefined, fallback: boolean) {
  if (typeof value !== "string") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
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
  if (event.includes("trade.pending")) {
    return "crypto_payment_detected";
  }
  if (event.includes("confirm") || status.includes("confirm") || payloadStatus.includes("confirm")) {
    return "crypto_payment_confirming";
  }
  if (event.includes("completed") || status === "completed" || payloadStatus === "completed") {
    return "crypto_payment_confirmed";
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

export function buildSettlementBankPayload(bankAccount: BreetSettlementBankAccount, narration: string) {
  const bankId = resolveBreetBankId(bankAccount);
  const accountNumber = String(bankAccount.account_number || "").trim();
  if (!bankId || !accountNumber) {
    return null;
  }

  return {
    bankId,
    accountNumber,
    narration,
    bankName: bankAccount.bank_name || null,
    accountName: bankAccount.account_name || null,
    accountNumberMasked: maskAccountNumber(accountNumber),
  };
}

function normalizeBankName(value?: string | null) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function matchBreetBank(bankAccount: BreetBankSetupCandidate, banks: BreetBankListItem[]) {
  const directBankId = resolveBreetBankId(bankAccount);
  if (directBankId) {
    const directMatch = banks.find((bank) => bank.id === directBankId);
    if (directMatch) return directMatch;
  }

  const bankCode = String(bankAccount.bank_code || "").trim();
  if (bankCode) {
    const byCode = banks.find((bank) =>
      [bank.monnifyCode, bank.anchorCode, bank.redbillerCode, bank.palmpayCode]
        .map((value) => String(value || "").trim())
        .includes(bankCode)
    );
    if (byCode) return byCode;
  }

  const normalizedName = normalizeBankName(bankAccount.bank_name);
  if (!normalizedName) return null;
  return banks.find((bank) => normalizeBankName(bank.name) === normalizedName) || null;
}

export function maskAccountNumber(accountNumber?: string | null) {
  const digits = String(accountNumber || "").replace(/\s+/g, "");
  if (!digits) return null;
  const last4 = digits.slice(-4);
  return `****${last4}`;
}

export function resolveBreetBankId(bankAccount: BreetSettlementBankAccount) {
  const candidates = [
    bankAccount.bank_id,
    stringFromUnknown(bankAccount.raw_verification_payload?.bank_id),
    stringFromUnknown(bankAccount.raw_verification_payload?.bankId),
    stringFromUnknown(bankAccount.raw_verification_payload?.breet_bank_id),
    stringFromUnknown(bankAccount.raw_verification_payload?.provider_bank_id),
  ];

  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) return value;
  }

  return null;
}

function stringFromUnknown(value: unknown) {
  return typeof value === "string" ? value : null;
}

function booleanFromUnknown(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeDigits(value: string | null | undefined) {
  const digits = String(value || "").replace(/\D/g, "").trim();
  return digits || null;
}

function normalizeLooseText(value: string | null | undefined) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function stringsMatch(actual: string | null, expected: string | null) {
  return Boolean(actual && expected && actual === expected);
}

export type BreetValidationAssessment = {
  passed: boolean;
  reasonCode: string | null;
  warningReasonCode: string | null;
  note: string | null;
  mappedBankId: string | null;
  returnedBankId: string | null;
  returnedBankName: string | null;
  returnedAccountNumber: string | null;
  returnedAccountName: string | null;
  bankMatched: boolean;
  accountNumberMatched: boolean;
  accountNameMatched: boolean | null;
};

export function assessBreetValidationForSettlementAccount(
  bankAccount: BreetBankSetupCandidate,
  options?: {
    env?: string | null;
    expectedBankId?: string | null;
    validation?: BreetBankValidationResult | null;
    mapping?: {
      provider_account_reference?: string | null;
      raw_provider_response?: Record<string, unknown> | null;
    } | null;
  }
): BreetValidationAssessment {
  const raw = {
    ...(bankAccount.raw_verification_payload || {}),
    ...(options?.mapping?.raw_provider_response || {}),
  } as Record<string, unknown>;
  const validationPayload = asRecord(raw.breet_bank_validation_payload) || asRecord(raw.bank_validation_payload);
  const validationPayloadData = asRecord(validationPayload?.data) || validationPayload;
  const hasValidationEvidence =
    booleanFromUnknown(raw.breet_validation_passed) === true ||
    booleanFromUnknown(raw.breet_bank_validation_passed) === true ||
    booleanFromUnknown(raw.validation_passed) === true ||
    booleanFromUnknown(raw.bank_validation_passed) === true ||
    Boolean(validationPayload) ||
    Boolean(options?.validation);
  const mappedBankId =
    options?.expectedBankId ||
    resolveBreetBankId({
      bank_name: bankAccount.bank_name,
      bank_code: bankAccount.bank_code,
      bank_id: bankAccount.bank_id || options?.mapping?.provider_account_reference || null,
      account_number: bankAccount.account_number,
      account_name: bankAccount.account_name,
      raw_verification_payload: raw,
    }) ||
    stringFromUnknown(options?.validation?.bankId) ||
    null;
  const returnedBankId =
    stringFromUnknown(options?.validation?.bankId) ||
    stringFromUnknown(validationPayload?.id) ||
    stringFromUnknown(validationPayloadData?.id) ||
    (hasValidationEvidence ? stringFromUnknown(raw.breet_bank_id) : null) ||
    null;
  const returnedBankName =
    stringFromUnknown(options?.validation?.bankName) ||
    stringFromUnknown(validationPayload?.bankName) ||
    stringFromUnknown(validationPayloadData?.bankName) ||
    stringFromUnknown(raw.breet_bank_name) ||
    null;
  const returnedAccountNumber =
    normalizeDigits(options?.validation?.accountNumber) ||
    normalizeDigits(stringFromUnknown(validationPayload?.accountNumber)) ||
    normalizeDigits(stringFromUnknown(validationPayloadData?.accountNumber)) ||
    normalizeDigits(stringFromUnknown(raw.validated_account_number)) ||
    null;
  const returnedAccountName =
    stringFromUnknown(options?.validation?.accountName) ||
    stringFromUnknown(validationPayload?.accountName) ||
    stringFromUnknown(validationPayloadData?.accountName) ||
    stringFromUnknown(raw.breet_returned_account_name) ||
    null;
  const localBankName = normalizeLooseText(bankAccount.bank_name);
  const localAccountNumber = normalizeDigits(bankAccount.account_number);
  const localAccountName = normalizeLooseText(bankAccount.account_name);
  const normalizedReturnedBankName = normalizeLooseText(returnedBankName);
  const normalizedReturnedAccountName = normalizeLooseText(returnedAccountName);
  const bankMatched =
    (mappedBankId && returnedBankId
      ? mappedBankId === returnedBankId
      : stringsMatch(normalizedReturnedBankName, localBankName)) ||
    (Boolean(mappedBankId) && !returnedBankId && !normalizedReturnedBankName ? false : false);
  const accountNumberMatched = Boolean(localAccountNumber && returnedAccountNumber && localAccountNumber === returnedAccountNumber);
  const accountNameMatched =
    localAccountName && normalizedReturnedAccountName
      ? localAccountName === normalizedReturnedAccountName
      : null;

  if (!hasValidationEvidence) {
    return {
      passed: false,
      reasonCode: "breet_validation_pending",
      warningReasonCode: null,
      note: null,
      mappedBankId,
      returnedBankId,
      returnedBankName,
      returnedAccountNumber,
      returnedAccountName,
      bankMatched,
      accountNumberMatched,
      accountNameMatched,
    };
  }

  if (!bankMatched || !accountNumberMatched) {
    return {
      passed: false,
      reasonCode: "breet_settlement_account_mismatch",
      warningReasonCode: null,
      note: null,
      mappedBankId,
      returnedBankId,
      returnedBankName,
      returnedAccountNumber,
      returnedAccountName,
      bankMatched,
      accountNumberMatched,
      accountNameMatched,
    };
  }

  const environment = normalizeBreetApiEnvironment(options?.env);
  if (environment === "production" && accountNameMatched !== true) {
    return {
      passed: false,
      reasonCode: "breet_validation_failed",
      warningReasonCode: null,
      note: null,
      mappedBankId,
      returnedBankId,
      returnedBankName,
      returnedAccountNumber,
      returnedAccountName,
      bankMatched,
      accountNumberMatched,
      accountNameMatched,
    };
  }

  const warningReasonCode =
    environment === "development" && accountNameMatched === false
      ? "breet_sandbox_name_mismatch_warning"
      : null;

  return {
    passed: true,
    reasonCode: null,
    warningReasonCode,
    note:
      warningReasonCode === "breet_sandbox_name_mismatch_warning"
        ? "Validation passed for sandbox. Breet returned a different account name, but bank and account number matched."
        : null,
    mappedBankId,
    returnedBankId,
    returnedBankName,
    returnedAccountNumber,
    returnedAccountName,
    bankMatched,
    accountNumberMatched,
    accountNameMatched,
  };
}

export async function withBreetTimeout<T>(
  promise: Promise<T>,
  message = "Breet validation timed out.",
  timeoutMs = 15000
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchBreetBanks(currency = "ngn", env?: BreetApiEnvironment) {
  const { PaymentService } = await import("@/lib/payment");
  return PaymentService.fetchBreetBanks(currency, env);
}

export async function validateBreetBankAccount(input: { bankId: string; accountNumber: string }, env?: BreetApiEnvironment) {
  const { PaymentService } = await import("@/lib/payment");
  return PaymentService.validateBreetBankAccount(input, env);
}

export async function addBreetIntegrationBank(input: {
  bankId: string;
  accountNumber: string;
  narration: string;
}, env?: BreetApiEnvironment) {
  const { PaymentService } = await import("@/lib/payment");
  return PaymentService.addBreetIntegrationBank(input, env);
}

export async function fetchSavedBreetIntegrationBanks(env?: BreetApiEnvironment) {
  const { PaymentService } = await import("@/lib/payment");
  return PaymentService.fetchSavedBreetIntegrationBanks(env);
}

export async function resolveAndValidateBreetBankAccount(
  bankAccount: BreetBankSetupCandidate,
  options?: { banks?: BreetBankListItem[]; env?: BreetApiEnvironment }
): Promise<{
  bankId: string | null;
  bank?: BreetBankListItem | null;
  validation?: BreetBankValidationResult | null;
}> {
  const banks = options?.banks || await fetchBreetBanks("ngn", options?.env);
  const matchedBank = matchBreetBank(bankAccount, banks);
  if (!matchedBank || !bankAccount.account_number) {
    return { bankId: null, bank: matchedBank, validation: null };
  }

  const validation = await validateBreetBankAccount({
    bankId: matchedBank.id,
    accountNumber: String(bankAccount.account_number),
  }, options?.env);

  return {
    bankId: matchedBank.id,
    bank: matchedBank,
    validation,
  };
}

export function validateSettlementAccountForBreet(
  bankAccount: BreetSettlementBankAccount,
  options?: { requireDefault?: boolean }
) {
  const verificationStatus = String(bankAccount.verification_status || "").toLowerCase();
  const status = String(bankAccount.status || "").toLowerCase();
  const currency = String(bankAccount.currency || "NGN").toUpperCase();

  if (!bankAccount.bank_name || !resolveBreetBankId(bankAccount) || !bankAccount.account_number || !bankAccount.account_name) {
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

export function normalizeBreetApiEnvironment(value?: string | null): BreetApiEnvironment {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "production" || normalized === "live") return "production";
  if (normalized === "development" || normalized === "sandbox") return "development";
  return process.env.PAYMENT_ENVIRONMENT === "live" ? "production" : "development";
}

export function getConfiguredBreetApiEnvironment(): BreetApiEnvironment {
  return normalizeBreetApiEnvironment(process.env.BREET_ENV || process.env.PAYMENT_ENVIRONMENT);
}

export function resolveBreetApiEnvironmentSetting(value?: string | null) {
  return normalizeBreetApiEnvironment(value || process.env.BREET_ENV || process.env.PAYMENT_ENVIRONMENT);
}

export function getBreetMinimumAutoSettlementNgn() {
  const parsed = Number(process.env.BREET_MIN_AUTO_SETTLEMENT_NGN);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BREET_MIN_AUTO_SETTLEMENT_NGN;
}

export function isBelowBreetMinimumAmount(amountNgn: number, minimumAmountNgn: number) {
  return Number.isFinite(amountNgn) && amountNgn < minimumAmountNgn;
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
  const envDevelopmentCheckoutEnabled = parseEnvBoolean(process.env.BREET_DEVELOPMENT_CHECKOUT_ENABLED, false);
  const envMinimumAutoSettlement = getBreetMinimumAutoSettlementNgn();
  const envFallbackMode =
    envMerchantAutoSettlement ? "breet_auto_settlement" :
    envPlatformAutoSettlement ? "platform_auto_settlement" :
    "disabled";
  const apiEnvironment = resolveBreetApiEnvironmentSetting(settingValue(map, "breet_api_environment", ""));
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
    apiEnvironment,
    developmentCheckoutEnabled: parseBooleanSetting(map, "breet_development_checkout_enabled", envDevelopmentCheckoutEnabled),
    merchantAutoSettlementEnabled: parseBooleanSetting(map, "breet_merchant_auto_settlement_enabled", envMerchantAutoSettlement),
    platformAutoSettlementEnabled:
      envForcePlatformSettlement ||
      parseBooleanSetting(map, "breet_auto_settlement_enabled", envPlatformAutoSettlement) ||
      parseBooleanSetting(map, "breet_sandbox_force_platform_settlement", false),
    invoiceCryptoEnabled: parseBooleanSetting(map, "breet_invoice_crypto_enabled", false),
    subscriptionCryptoEnabled: parseBooleanSetting(map, "breet_subscription_crypto_enabled", false),
    minimumAutoSettlementNgn: parseNumberSetting(
      map,
      "breet_min_auto_settlement_ngn",
      envMinimumAutoSettlement
    ),
    platformSettlementBankValidated: parseBooleanSetting(map, "breet_platform_bank_validated", false),
    webhookUrl: settingValue(map, "breet_webhook_url", process.env.BREET_WEBHOOK_URL || "") || null,
    supportedAssets: settingValue(map, "breet_supported_assets", "USDT,USDC,BTC,ETH")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
    supportedNetworks: settingValue(map, "breet_supported_networks", "TRON,ETHEREUM,BITCOIN")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
    defaultReceiveCurrency: settingValue(
      map,
      "breet_default_receive_currency",
      process.env.BREET_DEFAULT_RECEIVE_CURRENCY || "NGN"
    ).toUpperCase(),
    forcePlatformSettlementInSandbox:
      envForcePlatformSettlement || parseBooleanSetting(map, "breet_sandbox_force_platform_settlement", false),
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
    allowPendingAsCompletedInDevelopment: parseBooleanSetting(
      map,
      "breet_allow_pending_as_completed_in_development",
      false
    ),
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

export function isBreetWebhookConfigured() {
  // The current Breet webhook path verifies a shared-secret request header.
  // A configured callback URL alone is not enough to safely accept checkout.
  return Boolean(process.env.BREET_WEBHOOK_SECRET);
}

export function getBreetSettlementMode(config: Pick<BreetRuntimeConfig, "settlementMode">) {
  return config.settlementMode;
}

export function getBreetWebhookUrl(config: Pick<BreetRuntimeConfig, "webhookUrl">) {
  return config.webhookUrl || process.env.BREET_WEBHOOK_URL || null;
}

export function getBreetConfigWarnings(config: Pick<BreetRuntimeConfig, "apiEnvironment" | "liveEnabled" | "webhookUrl">) {
  const warnings: string[] = [];
  if (config.apiEnvironment === "production" && !config.liveEnabled) {
    warnings.push("Production environment selected, but Breet Live is disabled. Checkout remains gated.");
  }
  const webhookUrl = getBreetWebhookUrl(config);
  if (webhookUrl && webhookUrl.toLowerCase().includes("localhost")) {
    warnings.push("Breet cannot send webhooks to localhost. Use a public tunnel or deployed URL.");
  }
  return warnings;
}

export function isBreetDevelopmentCheckoutActive(
  config: Pick<BreetRuntimeConfig, "apiEnvironment" | "developmentCheckoutEnabled" | "liveEnabled">
) {
  return config.apiEnvironment === "development" && config.developmentCheckoutEnabled && !config.liveEnabled;
}

export function resolveBreetCheckoutEnvironment(
  config: Pick<BreetRuntimeConfig, "apiEnvironment" | "developmentCheckoutEnabled" | "liveEnabled">,
  requestedEnvironment: "sandbox" | "live"
) {
  if (requestedEnvironment === "live" && isBreetDevelopmentCheckoutActive(config)) {
    return "sandbox" as const;
  }
  return requestedEnvironment;
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
  const accountNumberMasked = maskAccountNumber(bankAccount.account_number);
  return {
    recipient_type: overrides?.recipientType || "merchant",
    settlement_mode: overrides?.settlementMode || "breet_auto_settlement",
    bank_name: bankAccount.bank_name || null,
    bank_code: bankAccount.bank_code || bankAccount.bank_id || null,
    bank_id: resolveBreetBankId(bankAccount),
    account_number: accountNumberMasked,
    account_number_masked: accountNumberMasked,
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
  const effectiveEnvironment = resolveBreetCheckoutEnvironment(config, input.environment);
  if (!isBreetRuntimeConfigured()) {
    return { allowed: false, reason: "Breet credentials are incomplete.", settlementMode: config.settlementMode, config, effectiveEnvironment } as const;
  }

  if (!isBreetWebhookConfigured()) {
    return { allowed: false, reason: "Breet webhook secret is missing.", settlementMode: config.settlementMode, config, effectiveEnvironment } as const;
  }

  if (!config.webhookUrl) {
    return { allowed: false, reason: "Breet webhook URL is not configured.", settlementMode: config.settlementMode, config, effectiveEnvironment } as const;
  }

  if (config.apiEnvironment === "production" && !config.liveEnabled) {
    return {
      allowed: false,
      reason: "Breet live checkout is disabled.",
      settlementMode: config.settlementMode,
      config,
      effectiveEnvironment,
    } as const;
  }

  if (input.environment === "live" && effectiveEnvironment !== "sandbox" && !config.liveEnabled) {
    return {
      allowed: false,
      reason: "Breet live checkout is disabled.",
      settlementMode: config.settlementMode,
      config,
      effectiveEnvironment,
    } as const;
  }

  if (input.environment === "live" && config.apiEnvironment === "development" && !config.liveEnabled && !config.developmentCheckoutEnabled) {
    return {
      allowed: false,
      reason: "Breet development checkout is disabled.",
      settlementMode: config.settlementMode,
      config,
      effectiveEnvironment,
    } as const;
  }

  if (config.settlementMode === "disabled") {
    return { allowed: false, reason: "Breet settlement mode is disabled.", settlementMode: config.settlementMode, config, effectiveEnvironment } as const;
  }

  const effectiveMode = resolveBreetSettlementModeForPurpose(input.purpose, config.settlementMode);

  if (effectiveMode === "treasury_manual" && !config.treasurySettlementAccountReference) {
    return {
        allowed: false,
        reason: "Treasury/manual settlement is not configured.",
        settlementMode: effectiveMode,
        config,
        effectiveEnvironment,
      } as const;
  }

  if (effectiveMode === "treasury_manual" && !config.platformSettlementBankAccount) {
    return {
        allowed: false,
        reason: "Treasury/manual settlement bank account is not configured.",
        settlementMode: effectiveMode,
        config,
        effectiveEnvironment,
      } as const;
  }

  if (input.purpose === "invoice_payment" || input.purpose === "payment_link" || input.purpose === "crypto_payment") {
    if (!config.invoiceCryptoEnabled) {
      return { allowed: false, reason: "Crypto payments are disabled for invoice checkout.", settlementMode: config.settlementMode, config, effectiveEnvironment } as const;
    }

    if (config.settlementMode !== "treasury_manual" && !config.merchantAutoSettlementEnabled) {
      return {
        allowed: false,
        reason: "Merchant crypto auto-settlement is disabled.",
        settlementMode: effectiveMode,
        config,
        effectiveEnvironment,
      } as const;
    }

    if (effectiveMode === "treasury_manual" && config.settlementMode !== "treasury_manual") {
      return {
        allowed: false,
        reason: "Crypto settlement setup is incomplete for this merchant.",
        settlementMode: effectiveMode,
        config,
        effectiveEnvironment,
      } as const;
    }

    if (!input.merchantId) {
      return { allowed: false, reason: "Crypto settlement setup is incomplete for this merchant.", settlementMode: config.settlementMode, config, effectiveEnvironment } as const;
    }

    const ready = await isProviderSettlementReady(input.supabase, {
      merchantId: input.merchantId,
      provider: "breet",
      environment: effectiveEnvironment,
      requireCryptoMapping: true,
    });

    if (!ready) {
      return { allowed: false, reason: "Crypto settlement setup is incomplete for this merchant.", settlementMode: config.settlementMode, config, effectiveEnvironment } as const;
    }

  }

  if (input.purpose === "plan_subscription" || input.purpose === "plan_upgrade") {
    if (!config.subscriptionCryptoEnabled) {
      return { allowed: false, reason: "Crypto payments are disabled for subscription checkout.", settlementMode: config.settlementMode, config, effectiveEnvironment } as const;
    }

    if (config.settlementMode !== "treasury_manual" && !config.platformAutoSettlementEnabled) {
      return {
        allowed: false,
        reason: "Platform crypto auto-settlement is disabled.",
        settlementMode: effectiveMode,
        config,
        effectiveEnvironment,
      } as const;
    }

    if (effectiveMode === "breet_auto_settlement") {
      return {
        allowed: false,
        reason: "Merchant settlement mode cannot be used for platform crypto payments.",
        settlementMode: effectiveMode,
        config,
        effectiveEnvironment,
      } as const;
    }

    if (effectiveMode === "platform_auto_settlement") {
      const platformConfigured =
        config.platformSettlementBankValidated &&
        Boolean(resolveBreetBankId(config.platformSettlementBankAccount || {})) &&
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
          effectiveEnvironment,
        } as const;
      }
    }
  }

  return { allowed: true, settlementMode: effectiveMode, config, effectiveEnvironment } as const;
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
    env: getConfiguredBreetApiEnvironment(),
    baseUrl: process.env.BREET_BASE_URL || "https://api.breet.io/v1",
  };
}

export function getMerchantBreetMappingState(
  bankAccount: Pick<
    BreetSettlementBankAccount,
    "raw_verification_payload" | "bank_name" | "bank_code" | "account_number" | "account_name"
  > & { bank_id?: string | null },
  mapping?: {
    provider_account_reference?: string | null;
    raw_provider_response?: Record<string, unknown> | null;
    status?: string | null;
  } | null,
  env?: string | null
): BreetMerchantMappingState {
  const raw = {
    ...(bankAccount.raw_verification_payload || {}),
    ...(mapping?.raw_provider_response || {}),
  } as Record<string, unknown>;
  const mappedBankId =
    resolveBreetBankId({
      bank_id: bankAccount.bank_id || mapping?.provider_account_reference || null,
      raw_verification_payload: raw,
    }) || null;
  const mappingConfirmed =
    booleanFromUnknown(raw.mapping_confirmed_by_admin) === true ||
    booleanFromUnknown(raw.breet_mapping_confirmed) === true ||
    booleanFromUnknown(raw.mapping_confirmed) === true;
  const validationAssessment = assessBreetValidationForSettlementAccount(
    {
      bank_id: bankAccount.bank_id || mapping?.provider_account_reference || null,
      raw_verification_payload: raw,
    },
    {
      env,
      expectedBankId: mappedBankId,
      mapping: mapping
        ? {
            provider_account_reference: mapping.provider_account_reference || null,
            raw_provider_response: mapping.raw_provider_response || null,
          }
        : null,
    }
  );
  const validationPassed =
    (booleanFromUnknown(raw.breet_validation_passed) === true ||
      booleanFromUnknown(raw.breet_bank_validation_passed) === true ||
      booleanFromUnknown(raw.validation_passed) === true ||
      booleanFromUnknown(raw.bank_validation_passed) === true ||
      Boolean(raw.breet_bank_validation_payload || raw.bank_validation_payload)) &&
    validationAssessment.passed;

  return {
    hasMappedBankId: Boolean(mappedBankId),
    mappingConfirmed,
    validationPassed,
    mappedBankId,
    validationReasonCode: validationAssessment.reasonCode,
    validationWarningCode: validationAssessment.warningReasonCode,
    validationNote: validationAssessment.note,
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
