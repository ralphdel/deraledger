import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AvailablePaymentMethod,
  PaymentEnvironment,
  PaymentProvider,
} from "@/lib/services/payment-routing.service";
import { calculateProviderReportedSettlement } from "@/lib/services/provider-settlement-calculation.service";

type SettlementProvider = PaymentProvider | "future_provider";

type SettlementAccountInput = {
  merchantId: string;
  bankName: string;
  bankCode?: string | null;
  accountNumber: string;
  accountName: string;
  paystackSubaccountCode?: string | null;
  environment?: PaymentEnvironment;
  rawProviderResponse?: Record<string, unknown> | null;
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

  const { data: existingAccount, error: lookupError } = await supabase
    .from("merchant_settlement_accounts")
    .select("id")
    .eq("merchant_id", input.merchantId)
    .eq("is_default", true)
    .eq("status", "active")
    .maybeSingle();

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

  await supabase
    .from("merchant_provider_settlement_accounts")
    .upsert(
      {
        merchant_id: input.merchantId,
        settlement_account_id: account.id,
        provider_name: "paystack",
        provider_account_reference: input.paystackSubaccountCode,
        provider_subaccount_code: input.paystackSubaccountCode,
        status: input.paystackSubaccountCode ? "connected" : "pending",
        environment,
        raw_provider_response: input.rawProviderResponse || { source: "settlement_settings" },
        last_sync_at: new Date().toISOString(),
      },
      { onConflict: "settlement_account_id,provider_name,environment" }
    )
    .throwOnError();

  if (environment === "sandbox") {
    await supabase
      .from("merchant_provider_settlement_accounts")
      .upsert(
        {
          merchant_id: input.merchantId,
          settlement_account_id: account.id,
          provider_name: "monnify",
          status: "connected",
          environment,
          raw_provider_response: {
            source: "settlement_settings",
            note: "sandbox settlement mapping placeholder; live provider sync still required",
          },
          last_sync_at: new Date().toISOString(),
        },
        { onConflict: "settlement_account_id,provider_name,environment" }
      );
  }

  return account.id as string;
}

export async function filterMethodsBySettlementReadiness(
  supabase: SupabaseClient,
  merchantId: string | null | undefined,
  methods: AvailablePaymentMethod[],
  environment: PaymentEnvironment
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
      ready: await isProviderSettlementReady(supabase, {
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
    .select("id, status")
    .eq("settlement_account_id", account.id)
    .eq("provider_name", input.provider)
    .eq("environment", input.environment)
    .in("status", input.requireCryptoMapping ? ["connected", "active"] : ["connected", "active"])
    .maybeSingle();

  if (mappingError) {
    console.error("Settlement readiness mapping lookup failed:", mappingError.message);
    return false;
  }

  if (mapping) return true;

  return await hasLegacySettlementReadiness(supabase, input.merchantId, input.provider);
}

export async function upsertSettlementLedgerForTransaction(
  supabase: SupabaseClient,
  transactionId: string,
  options?: {
    provider?: PaymentProvider;
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
    rawProviderPayload?: Record<string, unknown> | null;
  }
) {
  if (transaction.status && transaction.status !== "success") return;

  const provider = options?.provider || (await inferProviderForTransaction(supabase, transaction));
  const providerReference = transaction.processor_reference || transaction.paystack_reference || transaction.id;
  const amountPaid = Number(transaction.amount_paid || 0);
  const feeAbsorbedBy = transaction.fee_absorbed_by || "business";
  const paymentMethod = transaction.payment_rail || transaction.payment_method || "card";
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
  const settlementOwner = settlementStatus === "manual_review" ? "manual_review" : "provider";

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
        settlement_mode: "provider_direct",
        settlement_owner: settlementOwner,
        payout_action_required: false,
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

function normalizeSettlementStatus(status: string | null | undefined, hasSettlementMapping: boolean) {
  if (!hasSettlementMapping) return "manual_review";
  if (status === "failed" || status === "disputed" || status === "manual_review") return status;
  if (status === "processing") return "processing";
  if (status === "pending") return "pending";
  return "pending";
}
