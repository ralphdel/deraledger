import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MONNIFY_BASE_URL = process.env.MONNIFY_BASE_URL || "https://sandbox.monnify.com";
const MONNIFY_API_KEY = process.env.MONNIFY_API_KEY;
const MONNIFY_SECRET_KEY = process.env.MONNIFY_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase env vars.");
}

if (!MONNIFY_API_KEY || !MONNIFY_SECRET_KEY) {
  throw new Error("Missing Monnify sandbox credentials.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes("--apply");
const MONNIFY_SOURCE = "monnify_subaccount_setup";
const OPAY_UNAVAILABLE_REASON = "opay_beneficiary_unavailable";

async function getAccessToken() {
  const basic = Buffer.from(`${MONNIFY_API_KEY}:${MONNIFY_SECRET_KEY}`).toString("base64");
  const response = await fetch(`${MONNIFY_BASE_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
    },
  });

  const payload = await response.json().catch(() => ({}));
  const token = payload?.responseBody?.accessToken;

  if (!response.ok || !token) {
    throw new Error(payload?.responseMessage || "Monnify authentication failed.");
  }

  return token;
}

async function createMonnifySubaccount(token, record) {
  const body = [
    {
      bankCode: record.bank_code,
      accountNumber: record.account_number,
      accountName: record.account_name,
      currencyCode: "NGN",
      email: record.merchant_email,
      defaultSplitPercentage: 100,
    },
  ];

  const response = await fetch(`${MONNIFY_BASE_URL}/api/v1/sub-accounts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  const row = Array.isArray(payload?.responseBody) ? payload.responseBody[0] : payload?.responseBody;

  if (!response.ok || payload?.requestSuccessful === false || !row?.subAccountCode) {
    throw new Error(payload?.responseMessage || "Monnify subaccount creation failed.");
  }

  return {
    providerSubaccountCode: row.subAccountCode,
    providerAccountReference: row.subAccountCode,
    rawProviderResponse: {
      status: "connected",
      reason_code: null,
      merchant_message: null,
      admin_note: null,
      recommended_action: null,
      retryable: false,
      last_checked_at: new Date().toISOString(),
      last_success_at: new Date().toISOString(),
      source: MONNIFY_SOURCE,
      subaccount: row,
      request: {
        bankCode: record.bank_code,
        accountNumberMasked: maskAccountNumber(record.account_number),
        accountName: record.account_name,
        currencyCode: "NGN",
        email: record.merchant_email,
        defaultSplitPercentage: 100,
      },
    },
  };
}

async function validateMonnifyAccount(token, record) {
  const params = new URLSearchParams({
    bankCode: String(record.bank_code || ""),
    accountNumber: String(record.account_number || ""),
  });
  const response = await fetch(`${MONNIFY_BASE_URL}/api/v1/disbursements/account/validate?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload?.requestSuccessful === false || !payload?.responseBody?.accountName) {
    throw new Error(payload?.responseMessage || "Monnify account validation failed.");
  }

  return payload.responseBody;
}

function maskAccountNumber(value) {
  const digits = String(value || "");
  if (digits.length <= 4) return digits;
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function classifyMonnifyFailure(error) {
  const message = error instanceof Error ? error.message : "Unknown error";
  const lowered = String(message).toLowerCase();

  if (lowered.includes("beneficiary not available")) {
    return {
      classification: OPAY_UNAVAILABLE_REASON,
      status: "temporarily_unavailable",
      reason_code: OPAY_UNAVAILABLE_REASON,
      merchant_message:
        "OPay is temporarily unavailable for Monnify subaccount setup. Please add another bank account for Monnify collections or use another available provider while this is being resolved.",
      admin_note:
        "Monnify confirmed intermittent 'Beneficiary not available' errors from OPay/PAYCOM. Retry after Monnify confirms bank issue is resolved.",
      recommended_action: "Retry Monnify subaccount setup after Monnify confirms OPay/PAYCOM recovery.",
      retryable: true,
    };
  }

  if (lowered.includes("invalid account")) {
    return {
      classification: "invalid_account_details",
      status: "requires_action",
      reason_code: "invalid_account_details",
      merchant_message:
        "Monnify could not verify this bank account. Please confirm the account details or add another bank account for Monnify collections.",
      admin_note:
        "Monnify rejected the submitted account details during subaccount setup. Verify bank code, account number, and account name before retrying.",
      recommended_action: "Verify the settlement account details, then retry Monnify subaccount setup.",
      retryable: true,
    };
  }

  return {
    classification: "generic_provider_error",
    status: "degraded",
    reason_code: "generic_provider_error",
    merchant_message:
      "Monnify subaccount setup is temporarily unavailable for this bank account. Please try again later or use another available provider.",
    admin_note:
      "Monnify subaccount creation failed with a provider-side error. Retry after Monnify support confirms the issue is resolved.",
    recommended_action: "Retry Monnify subaccount setup after checking provider status.",
    retryable: true,
  };
}

function summarize(record) {
  const monnifyMapping = (record.merchant_provider_settlement_accounts || []).find(
    (row) => row.provider_name === "monnify" && row.environment === "sandbox"
  );
  const source = String(monnifyMapping?.raw_provider_response?.source || "");
  const ready = Boolean(monnifyMapping?.provider_subaccount_code && source === MONNIFY_SOURCE);
  const missingDetails = [];

  if (!record.bank_code) missingDetails.push("missing_bank_code");
  if (!record.account_number) missingDetails.push("missing_account_number");
  if (!record.account_name) missingDetails.push("missing_account_name");
  if (!record.merchant_email) missingDetails.push("missing_merchant_email");

  return {
    settlement_account_id: record.id,
    merchant_id: record.merchant_id,
    merchant_email: record.merchant_email,
    bank_name: record.bank_name,
    bank_code: record.bank_code,
    account_name: record.account_name,
    account_number_masked: maskAccountNumber(record.account_number),
    monnify_mapping_status: monnifyMapping?.status || null,
    monnify_mapping_source: source || null,
    monnify_subaccount_code: monnifyMapping?.provider_subaccount_code || null,
    ready,
    missing_details: missingDetails,
    should_create: !ready && missingDetails.length === 0,
  };
}

async function run() {
  const { data, error } = await supabase
    .from("merchant_settlement_accounts")
    .select(`
      id,
      merchant_id,
      bank_name,
      bank_code,
      account_number,
      account_name,
      verification_status,
      status,
      is_default,
      merchants!inner(email),
      merchant_provider_settlement_accounts(
        provider_name,
        environment,
        status,
        provider_subaccount_code,
        raw_provider_response
      )
    `)
    .eq("status", "active")
    .eq("verification_status", "verified")
    .eq("is_default", true)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  const rows = (data || []).map((row) => ({
    ...row,
    merchant_email: row.merchants?.email || null,
  }));
  const summaryRows = rows.map(summarize);
  const alreadyConnected = summaryRows.filter((row) => row.ready);
  const missing = summaryRows.filter((row) => row.should_create);
  const skipped = summaryRows.filter((row) => !row.ready && !row.should_create);

  console.log(JSON.stringify({
    mode: APPLY ? "apply" : "dry-run",
    totals: {
      eligible: summaryRows.length,
      already_connected: alreadyConnected.length,
      missing_monnify_subaccount: missing.length,
      skipped: skipped.length,
    },
    rows: summaryRows,
  }, null, 2));

  if (!APPLY || missing.length === 0) {
    return;
  }

  const token = await getAccessToken();
  const results = [];
  const failures = [];

  for (const row of rows) {
    const summary = summarize(row);
    if (!summary.should_create) continue;

    try {
      const validation = await validateMonnifyAccount(token, row);
      const created = await createMonnifySubaccount(token, {
        ...row,
        account_name: validation.accountName || row.account_name,
      });
      const { error: upsertError } = await supabase
        .from("merchant_provider_settlement_accounts")
        .upsert(
          {
            merchant_id: row.merchant_id,
            settlement_account_id: row.id,
            provider_name: "monnify",
            provider_account_reference: created.providerAccountReference,
            provider_subaccount_code: created.providerSubaccountCode,
            status: "connected",
            environment: "sandbox",
            raw_provider_response: created.rawProviderResponse,
            last_sync_at: new Date().toISOString(),
          },
          { onConflict: "settlement_account_id,provider_name,environment" }
        );

      if (upsertError) {
        throw upsertError;
      }

      results.push({
        settlement_account_id: row.id,
        merchant_id: row.merchant_id,
        classification: "created",
        provider_subaccount_code: created.providerSubaccountCode,
      });
    } catch (error) {
      const failure = classifyMonnifyFailure(error);
      const failedAt = new Date().toISOString();
      await supabase
        .from("merchant_provider_settlement_accounts")
        .upsert(
          {
            merchant_id: row.merchant_id,
            settlement_account_id: row.id,
            provider_name: "monnify",
            provider_account_reference: null,
            provider_subaccount_code: null,
            status: failure.status,
            environment: "sandbox",
            raw_provider_response: {
              source: "monnify_subaccount_setup_failed",
              status: failure.status,
              reason_code: failure.reason_code,
              merchant_message: failure.merchant_message,
              admin_note: failure.admin_note,
              recommended_action: failure.recommended_action,
              retryable: failure.retryable,
              lastError: error instanceof Error ? error.message : "Unknown error",
              last_checked_at: failedAt,
              last_failure_at: failedAt,
            },
            last_sync_at: failedAt,
          },
          { onConflict: "settlement_account_id,provider_name,environment" }
        );

      failures.push({
        settlement_account_id: row.id,
        merchant_id: row.merchant_id,
        classification: failure.classification,
        reason: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  console.log(JSON.stringify({
    mode: "apply",
    createdCount: results.length,
    created: results,
    failedCount: failures.length,
    failures,
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
