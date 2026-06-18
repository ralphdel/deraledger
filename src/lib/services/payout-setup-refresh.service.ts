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
    .select("provider_name,provider_subaccount_code,provider_account_reference,status,environment,raw_provider_response")
    .eq("settlement_account_id", settlementAccountId)
    .eq("provider_name", provider)
    .eq("environment", environment)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as {
    provider_name?: string | null;
    provider_subaccount_code?: string | null;
    provider_account_reference?: string | null;
    status?: string | null;
    environment?: string | null;
    raw_provider_response?: Record<string, unknown> | null;
  } | null;
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
  const runtimeConfig = await loadBreetRuntimeConfig(supabase);
  const effectiveBreetEnvironment = runtimeConfig.apiEnvironment || getConfiguredBreetApiEnvironment();
  const banks = await withBreetTimeout(fetchBreetBanks("ngn", effectiveBreetEnvironment), "Breet bank lookup timed out.");
  const matchedBank = matchBreetBank(
    {
      bank_name: account.bank_name,
      bank_code: account.bank_code,
      account_number: account.account_number,
      account_name: account.account_name,
      raw_verification_payload: {},
    },
    banks
  );

  if (!matchedBank) {
    const failedAt = new Date().toISOString();
    await supabase
      .from("merchant_provider_settlement_accounts")
      .upsert(
        {
          merchant_id: merchant.id,
          settlement_account_id: account.id,
          provider_name: "breet",
          provider_account_reference: null,
          provider_subaccount_code: null,
          status: "requires_action",
          environment,
          raw_provider_response: {
            source: "breet_payout_setup_refresh_failed",
            status: "requires_action",
            reason_code: "unsupported_bank",
            merchant_message:
              "This bank is temporarily unavailable for this payment method. Please use another bank or try again later.",
            admin_note:
              "Breet bank matching could not find a destination bank for the active payout account.",
            recommended_action:
              "Choose a supported bank or retry after Breet updates its bank directory.",
            retryable: true,
            lastError: "No matching Breet bank found for the active payout account.",
            last_checked_at: failedAt,
            last_failure_at: failedAt,
          },
          last_sync_at: failedAt,
        },
        { onConflict: "settlement_account_id,provider_name,environment" }
      );

    return {
      success: false,
      method: "crypto",
      provider: "breet",
      message: "Crypto payout setup could not be matched to this bank account.",
    };
  }

  try {
    const validation = await withBreetTimeout(validateBreetBankAccount(
      {
        bankId: matchedBank.id,
        accountNumber: account.account_number,
      },
      effectiveBreetEnvironment
    ), "Breet validation timed out.");
    const validatedAt = new Date().toISOString();
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
        env: effectiveBreetEnvironment,
        expectedBankId: matchedBank.id,
        validation,
      }
    );

    const nextAccountPayload = {
      ...(account.raw_verification_payload || {}),
      breet_bank_id: matchedBank.id,
      breet_bank_name: matchedBank.name || account.bank_name,
      breet_bank_validation_payload: validation.raw,
      breet_bank_validation_passed: assessment.passed,
      breet_validation_passed: assessment.passed,
      breet_bank_validation_at: validatedAt,
      validated_account_number: validation.accountNumber || account.account_number,
      breet_returned_account_name: validation.accountName || null,
      breet_validation_reason_code: assessment.reasonCode,
      breet_validation_warning_code: assessment.warningReasonCode,
      breet_mapping_confirmed: true,
      payout_setup_refreshed_at: validatedAt,
    };

    await supabase
      .from("merchant_settlement_accounts")
      .update({
        raw_verification_payload: nextAccountPayload,
        updated_at: new Date().toISOString(),
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
      providerAccountReference: matchedBank.id,
      environment,
      rawProviderResponse: {
        status: assessment.passed ? "connected" : "requires_action",
        source: "merchant_payout_setup_refresh",
        reason_code: assessment.reasonCode,
        warning_reason_code: assessment.warningReasonCode,
        merchant_message: assessment.passed ? null : "Crypto payments are not yet connected to this payout account.",
        admin_note: assessment.passed
          ? null
          : "Breet account validation did not confirm the active payout account for this settlement account.",
        recommended_action: assessment.passed
          ? null
          : "Validate the active payout account against Breet again before allowing crypto collections.",
        retryable: !assessment.passed,
        lastError: assessment.passed ? null : "Breet validation did not confirm the active payout account.",
        last_checked_at: validatedAt,
        last_success_at: assessment.passed ? validatedAt : null,
        last_failure_at: assessment.passed ? null : validatedAt,
        breet_bank_id: matchedBank.id,
        breet_bank_name: matchedBank.name || account.bank_name,
        breet_bank_validation_payload: validation.raw,
        breet_bank_validation_passed: assessment.passed,
        breet_validation_passed: assessment.passed,
        breet_bank_validation_at: validatedAt,
        breet_mapping_confirmed: true,
      },
    });

    if (!assessment.passed) {
      return {
        success: false,
        method: "crypto",
        provider: "breet",
        message: "Crypto payouts could not be activated for this account. Please try again or contact support.",
      };
    }

    return {
      success: true,
      method: "crypto",
      provider: "breet",
      message: "Crypto payouts are now connected to this payout account.",
    };
  } catch (error) {
    const lastError = error instanceof Error ? error.message : "Unknown Breet provider error";
    const failedAt = new Date().toISOString();
    const reasonCode = lastError.toLowerCase().includes("timed out")
      ? "breet_validation_timeout"
      : "breet_validation_failed";
    await supabase
      .from("merchant_provider_settlement_accounts")
      .upsert(
        {
          merchant_id: merchant.id,
          settlement_account_id: account.id,
          provider_name: "breet",
          provider_account_reference: matchedBank.id,
          provider_subaccount_code: null,
          status: "requires_action",
          environment,
          raw_provider_response: {
            source: "breet_payout_setup_refresh_failed",
            status: "requires_action",
            reason_code: reasonCode,
            merchant_message: "Crypto payments are not yet connected to this payout account.",
            admin_note:
              reasonCode === "breet_validation_timeout"
                ? "Breet validation for the active payout account timed out."
                : "Breet validation for the active payout account failed before confirming the settlement details.",
            recommended_action:
              "Retry Breet validation for the active payout account and confirm the saved bank mapping.",
            retryable: true,
            lastError,
            last_checked_at: failedAt,
            last_failure_at: failedAt,
            breet_bank_id: matchedBank.id,
            breet_bank_name: matchedBank.name || account.bank_name,
          },
          last_sync_at: failedAt,
        },
        { onConflict: "settlement_account_id,provider_name,environment" }
      );

    return {
      success: false,
      method: "crypto",
      provider: "breet",
      message: "Crypto payouts could not be activated for this account. Please try again or contact support.",
    };
  }
}

export async function refreshPayoutMethodSetup(
  supabase: SupabaseClient,
  input: {
    merchantId: string;
    method: PaymentMethod;
    actorType: ActorType;
    environment?: PaymentEnvironment;
  }
) {
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

  return {
    ...refreshResult,
    method: input.method,
    actorType: input.actorType,
    environment,
    readiness,
  };
}

export async function refreshAllPayoutMethodSetup(
  supabase: SupabaseClient,
  input: {
    merchantId: string;
    actorType: ActorType;
    environment?: PaymentEnvironment;
  }
) {
  const merchant = await loadMerchant(supabase, input.merchantId);
  const environment = input.environment || getPaymentEnvironmentForMerchantEmail(merchant.email);
  const methods: PaymentMethod[] = ["card", "bank_transfer", "ussd", "crypto"];
  const results: RefreshResult[] = [];

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
      results.push({
        success: result.success,
        method,
        provider: result.provider,
        message: result.message,
      });
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
    readiness,
  };
}
