import type { SupabaseClient } from "@supabase/supabase-js";
import { PaymentService } from "@/lib/payment";
import type { PaymentEnvironment, PaymentMethod, PaymentProvider } from "@/lib/services/payment-routing.service";
import { getPaymentEnvironmentForMerchantEmail, resolvePaymentRoute } from "@/lib/services/payment-routing.service";
import {
  assessBreetValidationForSettlementAccount,
  fetchBreetBanks,
  getConfiguredBreetApiEnvironment,
  loadBreetRuntimeConfig,
  matchBreetBank,
  validateBreetBankAccount,
  withBreetTimeout,
} from "@/lib/services/breet-crypto.service";
import {
  ensureMerchantSettlementAccount,
  getMerchantPaymentMethodReadiness,
  MONNIFY_EXISTING_SUBACCOUNT_LINKED_SOURCE,
  MONNIFY_SUBACCOUNT_SETUP_SOURCE,
  upsertProviderNeutralSettlementAccount,
} from "@/lib/services/settlement-ledger.service";

type ActorType = "merchant" | "admin" | "system";

type ActiveSettlementAccount = {
  id: string;
  merchant_id: string;
  bank_name: string;
  bank_code: string | null;
  account_number: string;
  account_name: string;
  currency: string | null;
  is_default: boolean;
  verification_status: string;
  status: string;
  raw_verification_payload: Record<string, unknown> | null;
};

type MerchantRow = {
  id: string;
  email: string;
  business_name: string;
  payment_provider?: string | null;
  payment_subaccount_code?: string | null;
};

type RefreshResult = {
  success: boolean;
  method: PaymentMethod;
  provider: PaymentProvider | null;
  message: string;
  reasonCode?: string | null;
  adminMessage?: string | null;
};

export type BreetValidationComparison = {
  local: {
    merchant_id: string;
    settlement_account_id: string;
    bank_name: string;
    bank_code: string | null;
    account_number_raw: string;
    account_number_normalized: string | null;
    account_name_raw: string;
    account_name_normalized: string | null;
    environment: PaymentEnvironment;
  };
  mapping: {
    provider_mapping_id: string | null;
    provider_name: "breet";
    provider_account_reference: string | null;
    breet_bank_id: string | null;
    breet_bank_name: string | null;
    environment: PaymentEnvironment;
    status: string | null;
    validation_flags: {
      breet_mapping_confirmed: boolean | null;
      breet_validation_passed: boolean | null;
      breet_bank_validation_passed: boolean | null;
    };
  };
  request_sent_to_breet: {
    breet_bank_id: string | null;
    account_number: string | null;
    environment: "development" | "production";
  };
  breet_response: {
    success: boolean | null;
    message: string | null;
    bank_name: string | null;
    bank_id_or_code_if_returned: string | null;
    account_number_raw: string | null;
    account_number_normalized: string | null;
    account_name_raw: string | null;
    account_name_normalized: string | null;
    raw_field_paths_used: string[];
  };
  comparison: {
    settlement_account_match: boolean;
    environment_match: boolean;
    mapped_bank_match: boolean;
    account_number_match: boolean;
    account_name_match: boolean | null;
    sandbox_name_warning: boolean;
    final_result:
      | "passed"
      | "passed_with_warning"
      | "failed"
      | "incomplete"
      | "timed_out"
      | "provider_error";
    reason_code: string | null;
  };
};

export type PayoutSetupActionStatus =
  | "ready"
  | "setup_required"
  | "requires_action"
  | "failed"
  | "timeout";

type MerchantReadinessSnapshot = Awaited<ReturnType<typeof getMerchantPaymentMethodReadiness>>;
type MerchantReadinessMethod = MerchantReadinessSnapshot["methods"][number];

export type PayoutSetupActionResult = {
  success: boolean;
  method: PaymentMethod;
  provider: PaymentProvider | null;
  status: PayoutSetupActionStatus;
  ready: boolean;
  reason_code: string | null;
  warning_reason_code?: string | null;
  merchant_message: string;
  admin_message: string | null;
  readiness: {
    method: PaymentMethod;
    label: string;
    status: string;
    ready: boolean;
  };
  payment_method_readiness: MerchantReadinessSnapshot["methods"];
  readiness_banner: MerchantReadinessSnapshot["banner"];
  has_payout_account: boolean;
  actorType: ActorType;
  environment: PaymentEnvironment;
};

export type BreetPayoutValidationResult = {
  success: boolean;
  ready: boolean;
  status: "ready" | "requires_action" | "failed" | "timeout";
  reason_code: string | null;
  warning_reason_code: string | null;
  admin_message: string | null;
  merchant_message: string;
  comparison: BreetValidationComparison;
  validation: Awaited<ReturnType<typeof validateBreetBankAccount>> | null;
  account: ActiveSettlementAccount;
  mapping: Awaited<ReturnType<typeof loadExistingProviderMapping>>;
};

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

function booleanValue(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

async function loadMerchant(supabase: SupabaseClient, merchantId: string) {
  const { data, error } = await supabase
    .from("merchants")
    .select("id,email,business_name,payment_provider,payment_subaccount_code")
    .eq("id", merchantId)
    .maybeSingle();

  if (error || !data) {
    throw new Error("Merchant not found.");
  }

  return data as MerchantRow;
}

async function loadActiveSettlementAccount(supabase: SupabaseClient, merchantId: string) {
  const { data, error } = await supabase
    .from("merchant_settlement_accounts")
    .select("id,merchant_id,bank_name,bank_code,account_number,account_name,currency,is_default,verification_status,status,raw_verification_payload")
    .eq("merchant_id", merchantId)
    .eq("is_default", true)
    .eq("status", "active")
    .maybeSingle();

  if (error || !data) {
    throw new Error("Active payout account not found.");
  }

  if (String(data.verification_status || "").toLowerCase() !== "verified") {
    throw new Error("The active payout account is not verified.");
  }

  return data as ActiveSettlementAccount;
}

async function loadExistingProviderMapping(
  supabase: SupabaseClient,
  settlementAccountId: string,
  provider: PaymentProvider,
  environment: PaymentEnvironment
) {
  const { data, error } = await supabase
    .from("merchant_provider_settlement_accounts")
    .select("id,provider_name,provider_subaccount_code,provider_account_reference,status,environment,raw_provider_response,updated_at,last_sync_at")
    .eq("settlement_account_id", settlementAccountId)
    .eq("provider_name", provider)
    .eq("environment", environment)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as {
    id?: string | null;
    provider_name?: string | null;
    provider_subaccount_code?: string | null;
    provider_account_reference?: string | null;
    status?: string | null;
    environment?: string | null;
    raw_provider_response?: Record<string, unknown> | null;
    updated_at?: string | null;
    last_sync_at?: string | null;
  } | null;
}

async function loadSettlementAccountByIdOrActive(
  supabase: SupabaseClient,
  merchantId: string,
  settlementAccountId?: string | null
) {
  let query = supabase
    .from("merchant_settlement_accounts")
    .select("id,merchant_id,bank_name,bank_code,account_number,account_name,currency,is_default,verification_status,status,raw_verification_payload")
    .eq("merchant_id", merchantId)
    .eq("status", "active");

  if (settlementAccountId) {
    query = query.eq("id", settlementAccountId);
  } else {
    query = query.eq("is_default", true);
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data) {
    throw new Error("Active payout account not found.");
  }

  return data as ActiveSettlementAccount;
}

function pickString(source: Record<string, unknown> | null | undefined, keys: string[]) {
  const record = source || null;
  if (!record) return { value: null, path: null as string | null };
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) {
      return { value, path: key };
    }
  }
  return { value: null, path: null as string | null };
}

function normalizeEnvironmentForBreet(environment: PaymentEnvironment) {
  return environment === "live" ? "production" : "development";
}

function buildBreetValidationComparison(input: {
  merchant: MerchantRow;
  account: ActiveSettlementAccount;
  mapping: Awaited<ReturnType<typeof loadExistingProviderMapping>>;
  environment: PaymentEnvironment;
  breetEnvironment: "development" | "production";
  matchedBank: { id: string; name: string } | null;
  validation?: Awaited<ReturnType<typeof validateBreetBankAccount>> | null;
  reasonCode?: string | null;
  finalResult: BreetValidationComparison["comparison"]["final_result"];
}) {
  const raw = (input.mapping?.raw_provider_response as Record<string, unknown> | null | undefined) || null;
  const validationRaw = (input.validation?.raw as Record<string, unknown> | null | undefined) || null;
  const validationData = asRecord(validationRaw?.data) || validationRaw;
  const responseAccountNumber =
    pickString(validationData, ["accountNumber", "account_number"]).value ||
    pickString(validationRaw, ["accountNumber", "account_number"]).value;
  const responseAccountName =
    pickString(validationData, ["accountName", "account_name"]).value ||
    pickString(validationRaw, ["accountName", "account_name"]).value;
  const responseBankName =
    pickString(validationData, ["bankName", "bank_name"]).value ||
    pickString(validationRaw, ["bankName", "bank_name"]).value ||
    stringValue(raw?.breet_bank_name);
  const responseBankId =
    pickString(validationData, ["id", "bankId", "bank_id"]).value ||
    pickString(validationRaw, ["id", "bankId", "bank_id"]).value ||
    stringValue(raw?.breet_bank_id) ||
    stringValue(input.mapping?.provider_account_reference) ||
    input.matchedBank?.id ||
    null;
  const mappedBankId =
    stringValue(input.mapping?.provider_account_reference) ||
    stringValue(raw?.breet_bank_id) ||
    input.matchedBank?.id ||
    null;
  const mappedBankName =
    stringValue(raw?.breet_bank_name) ||
    input.matchedBank?.name ||
    input.account.bank_name;
  const accountNumberNormalized = normalizeDigits(input.account.account_number);
  const responseAccountNumberNormalized = normalizeDigits(responseAccountNumber);
  const accountNameNormalized = normalizeLooseText(input.account.account_name);
  const responseAccountNameNormalized = normalizeLooseText(responseAccountName);
  const responseBankNameNormalized = normalizeLooseText(responseBankName);
  const mappedBankNameNormalized = normalizeLooseText(mappedBankName);
  const environmentMatch = normalizeEnvironmentForBreet(input.environment) === input.breetEnvironment;
  const mappedBankMatch = Boolean(
    mappedBankId &&
    responseBankId &&
    mappedBankId === responseBankId
  ) || Boolean(
    mappedBankNameNormalized &&
    responseBankNameNormalized &&
    mappedBankNameNormalized === responseBankNameNormalized
  );
  const accountNumberMatch = Boolean(
    accountNumberNormalized &&
    responseAccountNumberNormalized &&
    accountNumberNormalized === responseAccountNumberNormalized
  );
  const accountNameMatch =
    accountNameNormalized && responseAccountNameNormalized
      ? accountNameNormalized === responseAccountNameNormalized
      : null;
  const sandboxNameWarning =
    input.breetEnvironment === "development" &&
    accountNumberMatch &&
    mappedBankMatch &&
    accountNameMatch === false;

  const rawFieldPathsUsed = [
    pickString(validationData, ["bankName", "bank_name"]).path ? `data.${pickString(validationData, ["bankName", "bank_name"]).path}` : null,
    pickString(validationData, ["accountNumber", "account_number"]).path ? `data.${pickString(validationData, ["accountNumber", "account_number"]).path}` : null,
    pickString(validationData, ["accountName", "account_name"]).path ? `data.${pickString(validationData, ["accountName", "account_name"]).path}` : null,
  ].filter(Boolean) as string[];

  return {
    local: {
      merchant_id: input.merchant.id,
      settlement_account_id: input.account.id,
      bank_name: input.account.bank_name,
      bank_code: input.account.bank_code,
      account_number_raw: input.account.account_number,
      account_number_normalized: accountNumberNormalized,
      account_name_raw: input.account.account_name,
      account_name_normalized: accountNameNormalized,
      environment: input.environment,
    },
    mapping: {
      provider_mapping_id: stringValue(input.mapping?.id) || null,
      provider_name: "breet",
      provider_account_reference: stringValue(input.mapping?.provider_account_reference) || null,
      breet_bank_id: mappedBankId,
      breet_bank_name: mappedBankName,
      environment: input.environment,
      status: stringValue(input.mapping?.status) || null,
      validation_flags: {
        breet_mapping_confirmed: booleanValue(raw?.breet_mapping_confirmed),
        breet_validation_passed: booleanValue(raw?.breet_validation_passed),
        breet_bank_validation_passed: booleanValue(raw?.breet_bank_validation_passed),
      },
    },
    request_sent_to_breet: {
      breet_bank_id: input.matchedBank?.id || mappedBankId,
      account_number: input.account.account_number,
      environment: input.breetEnvironment,
    },
    breet_response: {
      success: typeof validationRaw?.success === "boolean" ? validationRaw.success as boolean : null,
      message: stringValue(validationRaw?.message) || null,
      bank_name: responseBankName,
      bank_id_or_code_if_returned: responseBankId,
      account_number_raw: responseAccountNumber,
      account_number_normalized: responseAccountNumberNormalized,
      account_name_raw: responseAccountName,
      account_name_normalized: responseAccountNameNormalized,
      raw_field_paths_used: rawFieldPathsUsed,
    },
    comparison: {
      settlement_account_match: Boolean(input.account.id && input.account.merchant_id === input.merchant.id),
      environment_match: environmentMatch,
      mapped_bank_match: mappedBankMatch,
      account_number_match: accountNumberMatch,
      account_name_match: accountNameMatch,
      sandbox_name_warning: sandboxNameWarning,
      final_result: input.finalResult,
      reason_code: input.reasonCode || null,
    },
  } satisfies BreetValidationComparison;
}

export async function validateBreetSettlementAccountForPayout(
  supabase: SupabaseClient,
  input: {
    merchantId: string;
    settlementAccountId?: string | null;
    environment?: PaymentEnvironment;
    actorType: ActorType;
    forceProviderCall?: boolean;
  }
): Promise<BreetPayoutValidationResult> {
  const merchant = await loadMerchant(supabase, input.merchantId);
  const environment = input.environment || getPaymentEnvironmentForMerchantEmail(merchant.email);
  const account = await loadSettlementAccountByIdOrActive(supabase, input.merchantId, input.settlementAccountId || null);
  const mapping = await loadExistingProviderMapping(supabase, account.id, "breet", environment);
  const runtimeConfig = await loadBreetRuntimeConfig(supabase);
  const breetEnvironment = runtimeConfig.apiEnvironment || getConfiguredBreetApiEnvironment();
  const banks = await withBreetTimeout(fetchBreetBanks("ngn", breetEnvironment), "Breet bank lookup timed out.");
  const matchedBank = matchBreetBank(
    {
      bank_name: account.bank_name,
      bank_code: account.bank_code,
      bank_id: stringValue(mapping?.provider_account_reference) || null,
      account_number: account.account_number,
      account_name: account.account_name,
      raw_verification_payload: {
        ...(account.raw_verification_payload || {}),
        ...((mapping?.raw_provider_response as Record<string, unknown> | null) || {}),
      },
    },
    banks
  );

  const existingAssessment = assessBreetValidationForSettlementAccount(
    {
      bank_name: account.bank_name,
      bank_code: account.bank_code,
      bank_id: stringValue(mapping?.provider_account_reference) || matchedBank?.id || null,
      account_number: account.account_number,
      account_name: account.account_name,
      raw_verification_payload: {
        ...(account.raw_verification_payload || {}),
        ...((mapping?.raw_provider_response as Record<string, unknown> | null) || {}),
      },
    },
    {
      env: breetEnvironment,
      expectedBankId: stringValue(mapping?.provider_account_reference) || matchedBank?.id || null,
      mapping: mapping
        ? {
            provider_account_reference: stringValue(mapping.provider_account_reference) || null,
            raw_provider_response: (mapping.raw_provider_response as Record<string, unknown> | null) || null,
          }
        : null,
    }
  );

  if (!matchedBank) {
    return {
      success: true,
      ready: false,
      status: "requires_action" as const,
      reason_code: "breet_bank_mapping_missing",
      warning_reason_code: null,
      admin_message: "Breet validation mismatch: mapped_bank_match=false",
      merchant_message: "Crypto payouts could not be activated for this account. Please try again or contact support.",
      comparison: buildBreetValidationComparison({
        merchant,
        account,
        mapping,
        environment,
        breetEnvironment,
        matchedBank: null,
        finalResult: "failed",
        reasonCode: "breet_bank_mapping_missing",
      }),
      validation: null,
      account,
      mapping,
    };
  }

  if (!input.forceProviderCall && existingAssessment.passed) {
    return {
      success: true,
      ready: true,
      status: "ready" as const,
      reason_code: null,
      warning_reason_code: existingAssessment.warningReasonCode,
      admin_message:
        existingAssessment.warningReasonCode === "breet_sandbox_name_mismatch_warning"
          ? "Validation passed for sandbox. Breet returned a different account name, but bank and account number matched."
          : "Breet account validation passed.",
      merchant_message: "Crypto payouts are now connected to this payout account.",
      comparison: buildBreetValidationComparison({
        merchant,
        account,
        mapping,
        environment,
        breetEnvironment,
        matchedBank,
        finalResult: existingAssessment.warningReasonCode ? "passed_with_warning" : "passed",
        reasonCode: null,
      }),
      validation: null,
      account,
      mapping,
    };
  }

  try {
    const validation = await withBreetTimeout(
      validateBreetBankAccount({
        bankId: matchedBank.id,
        accountNumber: account.account_number,
      }, breetEnvironment),
      "Breet validation timed out."
    );
    const validationRaw = (validation.raw as Record<string, unknown> | null | undefined) || null;
    const validationData = asRecord(validationRaw?.data) || validationRaw;
    const responseAccountNumber =
      stringValue(validation.accountNumber) ||
      stringValue(validationData?.accountNumber) ||
      stringValue(validationData?.account_number) ||
      stringValue(validationRaw?.accountNumber) ||
      stringValue(validationRaw?.account_number) ||
      null;

    if (!responseAccountNumber) {
      const comparison = buildBreetValidationComparison({
        merchant,
        account,
        mapping,
        environment,
        breetEnvironment,
        matchedBank,
        validation,
        finalResult: existingAssessment.passed ? "passed" : "incomplete",
        reasonCode: "breet_validation_response_incomplete",
      });
      return {
        success: true,
        ready: existingAssessment.passed,
        status: existingAssessment.passed ? "ready" as const : "requires_action" as const,
        reason_code: existingAssessment.passed ? null : "breet_validation_response_incomplete",
        warning_reason_code: existingAssessment.passed ? "breet_validation_response_incomplete" : null,
        admin_message: "Breet validation response is incomplete: missing accountNumber.",
        merchant_message: existingAssessment.passed
          ? "Crypto payouts are now connected to this payout account."
          : "Crypto payouts could not be activated for this account. Please try again or contact support.",
        comparison,
        validation,
        account,
        mapping,
      };
    }

    const assessment = assessBreetValidationForSettlementAccount(
      {
        bank_name: account.bank_name,
        bank_code: account.bank_code,
        bank_id: matchedBank.id,
        account_number: account.account_number,
        account_name: account.account_name,
        raw_verification_payload: account.raw_verification_payload || {},
      },
      {
        env: breetEnvironment,
        expectedBankId: matchedBank.id,
        validation,
        mapping: mapping
          ? {
              provider_account_reference: stringValue(mapping.provider_account_reference) || null,
              raw_provider_response: (mapping.raw_provider_response as Record<string, unknown> | null) || null,
            }
          : null,
      }
    );
    const comparison = buildBreetValidationComparison({
      merchant,
      account,
      mapping,
      environment,
      breetEnvironment,
      matchedBank,
      validation,
      finalResult: assessment.passed ? (assessment.warningReasonCode ? "passed_with_warning" : "passed") : "failed",
      reasonCode: assessment.reasonCode,
    });

    return {
      success: true,
      ready: assessment.passed,
      status: assessment.passed ? "ready" as const : "requires_action" as const,
      reason_code: assessment.reasonCode,
      warning_reason_code: assessment.warningReasonCode,
      admin_message: assessment.passed
        ? (
          assessment.warningReasonCode === "breet_sandbox_name_mismatch_warning"
            ? "Validation passed for sandbox. Breet returned a different account name, but bank and account number matched."
            : "Breet account validation passed."
        )
        : `Breet validation mismatch: ${comparison.comparison.account_number_match === false
          ? "account_number_match=false"
          : comparison.comparison.mapped_bank_match === false
            ? "mapped_bank_match=false"
            : comparison.comparison.account_name_match === false
              ? "account_name_match=false"
              : "final_result=failed"}`,
      merchant_message: assessment.passed
        ? "Crypto payouts are now connected to this payout account."
        : "Crypto payouts could not be activated for this account. Please try again or contact support.",
      comparison,
      validation,
      account,
      mapping,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Breet provider error";
    const reasonCode = message.toLowerCase().includes("timed out")
      ? "breet_validation_timeout"
      : "breet_provider_unavailable";
    return {
      success: false,
      ready: existingAssessment.passed,
      status: existingAssessment.passed ? "ready" as const : (reasonCode === "breet_validation_timeout" ? "timeout" as const : "failed" as const),
      reason_code: existingAssessment.passed ? null : reasonCode,
      warning_reason_code: existingAssessment.passed ? reasonCode : null,
      admin_message: reasonCode === "breet_validation_timeout"
        ? "Breet validation timed out. Please retry."
        : `Breet validation failed: ${message}`,
      merchant_message: existingAssessment.passed
        ? "Crypto payouts are now connected to this payout account."
        : (reasonCode === "breet_validation_timeout"
          ? "Crypto setup is taking longer than expected. Please try again."
          : "Crypto payouts could not be activated for this account. Please try again or contact support."),
      comparison: buildBreetValidationComparison({
        merchant,
        account,
        mapping,
        environment,
        breetEnvironment,
        matchedBank,
        finalResult: reasonCode === "breet_validation_timeout" ? "timed_out" : "provider_error",
        reasonCode,
      }),
      validation: null,
      account,
      mapping,
    };
  }
}

async function markProviderFailure(
  supabase: SupabaseClient,
  input: {
    merchant: MerchantRow;
    account: ActiveSettlementAccount;
    provider: PaymentProvider;
    environment: PaymentEnvironment;
    status: "failed" | "degraded" | "temporarily_unavailable" | "requires_action";
    reasonCode: string;
    merchantMessage: string;
    adminNote: string;
    recommendedAction: string;
    lastError: string;
  }
) {
  await upsertProviderNeutralSettlementAccount(supabase, {
    merchantId: input.merchant.id,
    settlementAccountId: input.account.id,
    bankName: input.account.bank_name,
    bankCode: input.account.bank_code,
    accountNumber: input.account.account_number,
    accountName: input.account.account_name,
    providerName: input.provider,
    providerSubaccountCode: null,
    providerAccountReference: null,
    environment: input.environment,
    rawProviderResponse: {
      status: input.status,
      source: `${input.provider}_payout_setup_refresh_failed`,
      reason_code: input.reasonCode,
      merchant_message: input.merchantMessage,
      admin_note: input.adminNote,
      recommended_action: input.recommendedAction,
      retryable: true,
      lastError: input.lastError,
      last_checked_at: new Date().toISOString(),
      last_failure_at: new Date().toISOString(),
    },
  });
}

async function refreshMonnifySetup(
  supabase: SupabaseClient,
  merchant: MerchantRow,
  account: ActiveSettlementAccount,
  environment: PaymentEnvironment
): Promise<RefreshResult> {
  const existingMapping = await loadExistingProviderMapping(supabase, account.id, "monnify", environment);
  const existingPayload = asRecord(existingMapping?.raw_provider_response) || null;
  const existingSubaccount = asRecord(existingPayload?.subaccount);
  const existingSubaccountRaw = asRecord(existingSubaccount?.raw) || existingSubaccount;
  const existingAccountNumber = normalizeDigits(stringValue(existingSubaccountRaw?.accountNumber));
  const existingBankCode = stringValue(existingSubaccountRaw?.bankCode);
  const existingCode = stringValue(existingMapping?.provider_subaccount_code);

  if (
    existingCode &&
    existingAccountNumber === normalizeDigits(account.account_number) &&
    (!existingBankCode || existingBankCode === account.bank_code)
  ) {
    await upsertProviderNeutralSettlementAccount(supabase, {
      merchantId: merchant.id,
      settlementAccountId: account.id,
      bankName: account.bank_name,
      bankCode: account.bank_code,
      accountNumber: account.account_number,
      accountName: account.account_name,
      providerName: "monnify",
      providerSubaccountCode: existingCode,
      providerAccountReference: stringValue(existingMapping?.provider_account_reference) || existingCode,
      environment,
      rawProviderResponse: {
        ...(existingPayload || {}),
        status: "connected",
        source:
          stringValue(existingPayload?.source) ||
          MONNIFY_EXISTING_SUBACCOUNT_LINKED_SOURCE,
        reason_code: null,
        merchant_message: null,
        admin_note: null,
        recommended_action: null,
        retryable: false,
        lastError: null,
        last_checked_at: new Date().toISOString(),
        last_success_at: new Date().toISOString(),
        last_failure_at: null,
      },
    });

    return {
      success: true,
      method: "card",
      provider: "monnify",
      message: "Monnify payout setup is ready for this payout account.",
    };
  }

  try {
    const subaccount = await PaymentService.createSubaccount(
      {
        businessName: merchant.business_name,
        bankCode: account.bank_code || "",
        accountNumber: account.account_number,
        percentageCharge: 0,
        primaryContactEmail: merchant.email,
        primaryContactName: account.account_name,
        accountName: account.account_name,
        currencyCode: "NGN",
        defaultSplitPercentage: 100,
      },
      "monnify"
    );

    await upsertProviderNeutralSettlementAccount(supabase, {
      merchantId: merchant.id,
      settlementAccountId: account.id,
      bankName: account.bank_name,
      bankCode: account.bank_code,
      accountNumber: account.account_number,
      accountName: account.account_name,
      providerName: "monnify",
      providerSubaccountCode: subaccount.subaccountCode,
      providerAccountReference: subaccount.providerReference || subaccount.subaccountCode,
      environment,
      rawProviderResponse: {
        status: "connected",
        source:
          typeof subaccount.raw?.source === "string" && subaccount.raw.source.trim()
            ? subaccount.raw.source
            : MONNIFY_SUBACCOUNT_SETUP_SOURCE,
        reason_code: null,
        merchant_message: null,
        admin_note:
          subaccount.raw?.source === MONNIFY_EXISTING_SUBACCOUNT_LINKED_SOURCE
            ? "Existing Monnify subaccount was linked successfully after provider returned already-exists response."
            : null,
        recommended_action: null,
        retryable: false,
        lastError: null,
        last_checked_at: new Date().toISOString(),
        last_success_at: new Date().toISOString(),
        last_failure_at: null,
        subaccount,
      },
    });

    return {
      success: true,
      method: "card",
      provider: "monnify",
      message: "Monnify payout setup is ready for this payout account.",
    };
  } catch (error) {
    const lastError = error instanceof Error ? error.message : "Unknown Monnify provider error";
    const lowered = lastError.toLowerCase();
    if (lowered.includes("beneficiary not available")) {
      await markProviderFailure(supabase, {
        merchant,
        account,
        provider: "monnify",
        environment,
        status: "temporarily_unavailable",
        reasonCode: "opay_beneficiary_unavailable",
        merchantMessage: "This bank is temporarily unavailable for this payment method. Please use another bank or try again later.",
        adminNote: "Monnify confirmed intermittent beneficiary availability issues for this bank.",
        recommendedAction: "Retry Monnify setup after the provider confirms the bank issue is resolved.",
        lastError,
      });
    } else if (lowered.includes("already exists")) {
      await markProviderFailure(supabase, {
        merchant,
        account,
        provider: "monnify",
        environment,
        status: "requires_action",
        reasonCode: "monnify_existing_subaccount_unresolved",
        merchantMessage: "This payment method needs to be refreshed for your current payout account.",
        adminNote: "Monnify reported an existing subaccount but DeraLedger could not resolve or link it automatically.",
        recommendedAction: "List or verify the existing Monnify subaccount and link it to this payout account.",
        lastError,
      });
    } else {
      await markProviderFailure(supabase, {
        merchant,
        account,
        provider: "monnify",
        environment,
        status: "degraded",
        reasonCode: "generic_provider_error",
        merchantMessage: "Setup could not be completed. Please try again.",
        adminNote: "Monnify payout setup refresh failed with a provider-side error.",
        recommendedAction: "Retry Monnify payout setup after confirming provider availability.",
        lastError,
      });
    }

    return {
      success: false,
      method: "card",
      provider: "monnify",
      message: "Monnify payout setup could not be refreshed.",
    };
  }
}

async function refreshPaystackSetup(
  supabase: SupabaseClient,
  merchant: MerchantRow,
  account: ActiveSettlementAccount,
  environment: PaymentEnvironment
): Promise<RefreshResult> {
  const existingMapping = await loadExistingProviderMapping(supabase, account.id, "paystack", environment);
  const existingCode =
    stringValue(existingMapping?.provider_subaccount_code) ||
    stringValue(merchant.payment_subaccount_code);

  try {
    const subaccount = existingCode
      ? await PaymentService.updateSubaccount(
          existingCode,
          {
            businessName: merchant.business_name,
            bankCode: account.bank_code || "",
            accountNumber: account.account_number,
            percentageCharge: 1.5,
            accountName: account.account_name,
            primaryContactEmail: merchant.email,
            primaryContactName: account.account_name,
          },
          "paystack"
        )
      : await PaymentService.createSubaccount(
          {
            businessName: merchant.business_name,
            bankCode: account.bank_code || "",
            accountNumber: account.account_number,
            percentageCharge: 1.5,
            primaryContactEmail: merchant.email,
            primaryContactName: account.account_name,
            accountName: account.account_name,
            currencyCode: "NGN",
          },
          "paystack"
        );

    await upsertProviderNeutralSettlementAccount(supabase, {
      merchantId: merchant.id,
      settlementAccountId: account.id,
      bankName: account.bank_name,
      bankCode: account.bank_code,
      accountNumber: account.account_number,
      accountName: account.account_name,
      providerName: "paystack",
      providerSubaccountCode: subaccount.subaccountCode,
      providerAccountReference: subaccount.providerReference || subaccount.subaccountCode,
      environment,
      rawProviderResponse: {
        status: "connected",
        source: "paystack_payout_setup_refresh",
        reason_code: null,
        merchant_message: null,
        admin_note: null,
        recommended_action: null,
        retryable: false,
        lastError: null,
        last_checked_at: new Date().toISOString(),
        last_success_at: new Date().toISOString(),
        last_failure_at: null,
        subaccount,
      },
    });

    return {
      success: true,
      method: "card",
      provider: "paystack",
      message: "Paystack payout setup is ready for this payout account.",
    };
  } catch (error) {
    const lastError = error instanceof Error ? error.message : "Unknown Paystack provider error";
    await markProviderFailure(supabase, {
      merchant,
      account,
      provider: "paystack",
      environment,
      status: "failed",
      reasonCode: "generic_provider_error",
      merchantMessage: "Setup could not be completed. Please try again.",
      adminNote: "Paystack payout setup refresh failed with a provider-side error.",
      recommendedAction: "Retry Paystack payout setup after confirming provider availability.",
      lastError,
    });

    return {
      success: false,
      method: "card",
      provider: "paystack",
      message: "Paystack payout setup could not be refreshed.",
    };
  }
}

async function refreshBreetSetup(
  supabase: SupabaseClient,
  merchant: MerchantRow,
  account: ActiveSettlementAccount,
  environment: PaymentEnvironment
): Promise<RefreshResult> {
  const result = await validateBreetSettlementAccountForPayout(supabase, {
    merchantId: merchant.id,
    settlementAccountId: account.id,
    environment,
    actorType: "merchant",
    forceProviderCall: true,
  });
  const now = new Date().toISOString();
  const existingRaw = (result.mapping?.raw_provider_response as Record<string, unknown> | null | undefined) || {};
  const validationRaw = result.validation?.raw || null;

  await supabase
    .from("merchant_settlement_accounts")
    .update({
      raw_verification_payload: {
        ...(account.raw_verification_payload || {}),
        ...(result.comparison.mapping.breet_bank_id ? { breet_bank_id: result.comparison.mapping.breet_bank_id } : {}),
        ...(result.comparison.mapping.breet_bank_name ? { breet_bank_name: result.comparison.mapping.breet_bank_name } : {}),
        ...(validationRaw ? { breet_bank_validation_payload: validationRaw } : {}),
        breet_bank_validation_passed: result.ready,
        breet_validation_passed: result.ready,
        breet_validation_reason_code: result.reason_code,
        breet_validation_warning_code: result.warning_reason_code || null,
        breet_mapping_confirmed: true,
        payout_setup_refreshed_at: now,
      },
      updated_at: now,
    })
    .eq("id", account.id);

  await upsertProviderNeutralSettlementAccount(supabase, {
    merchantId: merchant.id,
    settlementAccountId: account.id,
    bankName: account.bank_name,
    bankCode: account.bank_code,
    accountNumber: account.account_number,
    accountName: account.account_name,
    providerName: "breet",
    providerSubaccountCode: null,
    providerAccountReference: result.comparison.mapping.breet_bank_id || result.comparison.mapping.provider_account_reference,
    environment,
    rawProviderResponse: {
      ...existingRaw,
      status: result.ready ? "connected" : (result.status === "ready" ? "connected" : "requires_action"),
      source: "merchant_payout_setup_refresh",
      reason_code: result.reason_code,
      warning_reason_code: result.warning_reason_code || null,
      merchant_message: result.ready ? null : "Crypto payments are not yet connected to this payout account.",
      admin_note: result.admin_message,
      recommended_action: result.ready ? null : "Validate the active payout account against Breet again before allowing crypto collections.",
      retryable: !result.ready,
      lastError: result.ready ? null : result.admin_message,
      last_checked_at: now,
      last_success_at: result.ready ? now : stringValue(existingRaw.last_success_at) || null,
      last_failure_at: result.ready ? stringValue(existingRaw.last_failure_at) || null : now,
      breet_bank_id: result.comparison.mapping.breet_bank_id,
      breet_bank_name: result.comparison.mapping.breet_bank_name,
      breet_bank_validation_payload: validationRaw,
      breet_bank_validation_passed: result.ready,
      breet_validation_passed: result.ready,
      breet_bank_validation_at: now,
      breet_mapping_confirmed: true,
      last_validation_attempt: result.comparison,
    },
  });

  return {
    success: result.success,
    method: "crypto",
    provider: "breet",
    message: result.merchant_message,
    reasonCode: result.reason_code,
    adminMessage: result.admin_message,
  };
}

function deriveActionStatus(
  readinessMethod: MerchantReadinessMethod | undefined,
  refreshResult: RefreshResult
): PayoutSetupActionStatus {
  const reasonCode = String(readinessMethod?.reason_code || refreshResult.reasonCode || "");
  if (readinessMethod?.ready) return "ready";
  if (reasonCode === "breet_validation_timeout") return "timeout";
  if (reasonCode === "breet_validation_failed") return "failed";
  if (["needs_attention", "temporarily_unavailable"].includes(String(readinessMethod?.status || ""))) {
    return "requires_action";
  }
  return "setup_required";
}

function deriveActionMessages(input: {
  method: PaymentMethod;
  ready: boolean;
  actionStatus: PayoutSetupActionStatus;
  refreshResult: RefreshResult;
  readinessMethod: MerchantReadinessMethod | undefined;
}) {
  if (input.method === "crypto") {
    if (input.ready) {
      return {
        merchant_message: "Crypto payouts are now connected to this payout account.",
        admin_message:
          input.refreshResult.adminMessage ||
          "Breet account validation passed.",
      };
    }
    if (input.actionStatus === "timeout") {
      return {
        merchant_message: "Crypto setup is taking longer than expected. Please try again.",
        admin_message:
          input.refreshResult.adminMessage ||
          "Breet validation timed out. Please retry.",
      };
    }
    if (input.actionStatus === "failed" || input.actionStatus === "requires_action") {
      return {
        merchant_message: "Crypto payouts could not be activated for this account. Please try again or contact support.",
        admin_message:
          input.refreshResult.adminMessage ||
          "Breet account validation failed.",
      };
    }
    return {
      merchant_message:
        input.readinessMethod?.message ||
        "Crypto payments are not yet connected to this payout account.",
      admin_message:
        input.refreshResult.adminMessage ||
        "Bank mapping saved. Account validation is still required.",
    };
  }

  return {
    merchant_message: input.refreshResult.message || "Payment setup refreshed for your current payout account.",
    admin_message: input.refreshResult.adminMessage || input.refreshResult.message || "Payment setup refreshed.",
  };
}

export async function refreshPayoutMethodSetup(
  supabase: SupabaseClient,
  input: {
    merchantId: string;
    method: PaymentMethod;
    actorType: ActorType;
    environment?: PaymentEnvironment;
  }
): Promise<PayoutSetupActionResult> {
  const merchant = await loadMerchant(supabase, input.merchantId);
  const environment = input.environment || getPaymentEnvironmentForMerchantEmail(merchant.email);
  const account = await loadActiveSettlementAccount(supabase, input.merchantId);
  await ensureMerchantSettlementAccount(supabase, {
    merchantId: merchant.id,
    bankName: account.bank_name,
    bankCode: account.bank_code,
    accountNumber: account.account_number,
    accountName: account.account_name,
  });

  const route = await resolvePaymentRoute("invoice_payment", input.method, environment);

  let refreshResult: RefreshResult;
  if (route.provider === "monnify") {
    refreshResult = await refreshMonnifySetup(supabase, merchant, account, environment);
  } else if (route.provider === "paystack") {
    refreshResult = await refreshPaystackSetup(supabase, merchant, account, environment);
  } else {
    refreshResult = await refreshBreetSetup(supabase, merchant, account, environment);
  }

  const readiness = await getMerchantPaymentMethodReadiness(supabase, {
    merchantId: merchant.id,
    environment,
    purpose: "invoice_payment",
  });
  const readinessMethod = readiness.methods.find((entry) => entry.method === input.method);
  const ready = Boolean(readinessMethod?.ready);
  const status = deriveActionStatus(readinessMethod, refreshResult);
  const messages = deriveActionMessages({
    method: input.method,
    ready,
    actionStatus: status,
    refreshResult,
    readinessMethod,
  });

  return {
    success: refreshResult.success,
    method: input.method,
    provider: refreshResult.provider,
    status,
    ready,
    reason_code: readinessMethod?.reason_code || refreshResult.reasonCode || null,
    warning_reason_code: null,
    merchant_message: messages.merchant_message,
    admin_message: messages.admin_message,
    readiness: {
      method: input.method,
      label: readinessMethod?.label || input.method,
      status: readinessMethod?.display_status || (ready ? "Ready" : "Setup required"),
      ready,
    },
    payment_method_readiness: readiness.methods,
    readiness_banner: readiness.banner,
    has_payout_account: readiness.has_payout_account,
    actorType: input.actorType,
    environment,
  };
}

export async function refreshAllPayoutMethodSetup(
  supabase: SupabaseClient,
  input: {
    merchantId: string;
    actorType: ActorType;
    environment?: PaymentEnvironment;
  }
): Promise<{
  success: boolean;
  results: PayoutSetupActionResult[];
  environment: PaymentEnvironment;
  payment_method_readiness: MerchantReadinessSnapshot["methods"];
  readiness_banner: MerchantReadinessSnapshot["banner"];
  has_payout_account: boolean;
  message: string;
}> {
  const merchant = await loadMerchant(supabase, input.merchantId);
  const environment = input.environment || getPaymentEnvironmentForMerchantEmail(merchant.email);
  const methods: PaymentMethod[] = ["card", "bank_transfer", "ussd", "crypto"];
  const results: PayoutSetupActionResult[] = [];

  for (const method of methods) {
    try {
      const route = await resolvePaymentRoute("invoice_payment", method, environment);
      if (!route?.provider) {
        continue;
      }
      const result = await refreshPayoutMethodSetup(supabase, {
        merchantId: input.merchantId,
        method,
        actorType: input.actorType,
        environment,
      });
      results.push(result);
    } catch {
      continue;
    }
  }

  const readiness = await getMerchantPaymentMethodReadiness(supabase, {
    merchantId: input.merchantId,
    environment,
    purpose: "invoice_payment",
  });

  return {
    success: results.every((result) => result.success),
    results,
    environment,
    payment_method_readiness: readiness.methods,
    readiness_banner: readiness.banner,
    has_payout_account: readiness.has_payout_account,
    message: readiness.banner.show
      ? "Payment setup refreshed. Some payment methods still need setup."
      : "Payment setup refreshed for your current payout account.",
  };
}
