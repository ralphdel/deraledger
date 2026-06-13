import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { normalizeMerchantFacingPaymentMethod } from "@/lib/services/breet-crypto.service";

export const dynamic = "force-dynamic";

type SettlementAccountRow = Record<string, unknown> & {
  settlement_account_id?: string | null;
  provider_settlement_account_id?: string | null;
  settlement_account_snapshot?: Record<string, unknown> | null;
  settlement_bank_name?: string | null;
  settlement_account_name?: string | null;
  settlement_account_number_masked?: string | null;
  expected_settlement_date?: string | null;
  merchant_settlement_accounts?: Record<string, unknown> | null;
  merchant_provider_settlement_accounts?: Record<string, unknown> | null;
  provider_settlement_batches?: Record<string, unknown> | null;
  settlement_status?: string | null;
  settlement_display_status?: string | null;
  expected_settlement?: number | null;
  actual_settlement?: number | null;
  settlement_display_amount?: number | null;
  gross_amount?: number | null;
  provider_fee?: number | null;
  platform_fee?: number | null;
};

export async function GET() {
  const supabase = await createClient();
  const merchantId = await resolveCurrentMerchantId(supabase);

  if (!merchantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let { data, error } = await supabase
    .from("settlement_records")
    .select(`
      *,
      payment_records(*),
      merchant_settlement_accounts(id,bank_name,account_number,account_name,currency),
      merchant_provider_settlement_accounts(provider_name,status,environment),
      provider_settlement_batches(provider_batch_reference,actual_settlement_total,settlement_status,settled_at,provider_reported_settled_at)
    `)
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    const fallback = await supabase
      .from("settlement_records")
      .select(`
        *,
        payment_records(*),
        merchant_settlement_accounts(id,bank_name,account_number,account_name,currency),
        merchant_provider_settlement_accounts(provider_name,status,environment)
      `)
      .eq("merchant_id", merchantId)
      .order("created_at", { ascending: false })
      .limit(100);

    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let rows = filterMerchantReceivableRows(data || []);

  if (rows.length === 0) {
    rows = await loadTransactionFallbackRows(supabase, merchantId);
  }

  rows = await hydrateMissingSettlementAccounts(supabase, merchantId, rows);
  rows = rows.map(normalizeMerchantSettlementDisplay);

  return NextResponse.json({
    rows,
    summary: {
      totalCollected: rows.reduce((sum, row) => sum + Number(row.gross_amount || 0), 0),
      totalProviderFees: rows.reduce((sum, row) => sum + Number(row.provider_fee || 0), 0),
      totalPlatformFees: rows.reduce((sum, row) => sum + Number(row.platform_fee || 0), 0),
      expectedSettlement: rows.reduce((sum, row) => sum + Number(row.expected_settlement || 0), 0),
      settledAmount: rows.reduce((sum, row) => sum + Number(row.settlement_display_amount || 0), 0),
      pendingSettlement: rows
        .filter((row) => isPendingSettlementStatus(row.settlement_display_status || row.settlement_status || ""))
        .reduce((sum, row) => sum + Number(row.expected_settlement || 0), 0),
      failedSettlement: rows
        .filter((row) => ["failed", "disputed", "cancelled"].includes(String(row.settlement_display_status || row.settlement_status || "").toLowerCase()))
        .reduce((sum, row) => sum + Number(row.expected_settlement || 0), 0),
    },
  });
}

async function resolveCurrentMerchantId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const cookieStore = await cookies();
  const workspaceMerchantId = cookieStore.get("purpledger_workspace_id")?.value;
  if (workspaceMerchantId) {
    const { data: workspaceMerchant } = await supabase
      .from("merchants")
      .select("id,user_id")
      .eq("id", workspaceMerchantId)
      .maybeSingle();

    if (workspaceMerchant?.user_id === user.id) return workspaceMerchant.id as string;

    const { data: activeTeamMembership } = await supabase
      .from("merchant_team")
      .select("merchant_id")
      .eq("merchant_id", workspaceMerchantId)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (activeTeamMembership?.merchant_id) return activeTeamMembership.merchant_id as string;
  }

  const { data: owned } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (owned?.id) return owned.id as string;

  const { data: teamRow } = await supabase
    .from("merchant_team")
    .select("merchant_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (teamRow?.merchant_id as string | undefined) || null;
}

async function hydrateMissingSettlementAccounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  merchantId: string,
  rows: SettlementAccountRow[]
) {
  if (rows.length === 0) return rows;

  const normalizedRows: SettlementAccountRow[] = rows.map((row) => ({
    ...row,
    payment_records: normalizeEmbeddedRow(row.payment_records) as Record<string, unknown> | null,
    merchant_settlement_accounts: normalizeEmbeddedRow(row.merchant_settlement_accounts) as Record<string, unknown> | null,
    merchant_provider_settlement_accounts: normalizeEmbeddedRow(row.merchant_provider_settlement_accounts) as Record<string, unknown> | null,
    provider_settlement_batches: normalizeEmbeddedRow(row.provider_settlement_batches) as Record<string, unknown> | null,
  }));

  if (normalizedRows.every((row) => resolveDisplayedSettlementAccount(row))) {
    return normalizedRows.map((row) => ({
      ...row,
      merchant_settlement_accounts: resolveDisplayedSettlementAccount(row),
    }));
  }

  const accountById = new Map<string, Record<string, unknown>>();
  const settlementAccountIds = Array.from(
    new Set(
      normalizedRows
        .filter((row) => !row.merchant_settlement_accounts && row.settlement_account_id)
        .map((row) => String(row.settlement_account_id))
    )
  );

  if (settlementAccountIds.length > 0) {
    const { data: accounts } = await supabase
      .from("merchant_settlement_accounts")
      .select("id,bank_name,account_number,account_name,currency")
      .in("id", settlementAccountIds);

    for (const account of accounts || []) {
      if (account?.id) accountById.set(String(account.id), account);
    }
  }

  const providerMappingIds = Array.from(
    new Set(
      normalizedRows
        .filter((row) => !row.merchant_settlement_accounts && !row.settlement_account_id && row.provider_settlement_account_id)
        .map((row) => String(row.provider_settlement_account_id))
    )
  );

  if (providerMappingIds.length > 0) {
    const { data: mappings } = await supabase
      .from("merchant_provider_settlement_accounts")
      .select("id,settlement_account_id")
      .in("id", providerMappingIds);

    const derivedAccountIds = Array.from(
      new Set(
        (mappings || [])
          .map((mapping) => mapping.settlement_account_id)
          .filter(Boolean)
          .map((id) => String(id))
      )
    );

    const missingDerivedIds = derivedAccountIds.filter((id) => !accountById.has(id));
    if (missingDerivedIds.length > 0) {
      const { data: derivedAccounts } = await supabase
        .from("merchant_settlement_accounts")
        .select("id,bank_name,account_number,account_name,currency")
        .in("id", missingDerivedIds);

      for (const account of derivedAccounts || []) {
        if (account?.id) accountById.set(String(account.id), account);
      }
    }

    for (const mapping of mappings || []) {
      const accountId = mapping?.settlement_account_id ? String(mapping.settlement_account_id) : null;
      if (!accountId) continue;
      const resolvedAccount = accountById.get(accountId);
      if (!resolvedAccount) continue;

      normalizedRows.forEach((row) => {
        if (!row.merchant_settlement_accounts && String(row.provider_settlement_account_id || "") === String(mapping.id)) {
          row.merchant_settlement_accounts = resolvedAccount;
          row.settlement_account_id = row.settlement_account_id || accountId;
        }
      });
    }
  }

  const { data: account } = await supabase
    .from("merchant_settlement_accounts")
    .select("bank_name,account_number,account_name,currency")
    .eq("merchant_id", merchantId)
    .neq("status", "disabled")
    .order("is_default", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const hydratedAccount = account || await loadLegacySettlementAccount(supabase, merchantId);
  if (!hydratedAccount) return normalizedRows;

  return normalizedRows.map((row) => ({
    ...row,
    merchant_settlement_accounts:
      resolveDisplayedSettlementAccount(row) ||
      (row.settlement_account_id ? accountById.get(String(row.settlement_account_id)) : null) ||
      hydratedAccount,
  }));
}

async function loadLegacySettlementAccount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  merchantId: string
) {
  const { data: merchant } = await supabase
    .from("merchants")
    .select("settlement_bank_name,settlement_account_number,settlement_account_name")
    .eq("id", merchantId)
    .maybeSingle();

  if (!merchant?.settlement_account_number) return null;

  return {
    bank_name: merchant.settlement_bank_name || "Settlement bank",
    account_number: merchant.settlement_account_number,
    account_name: merchant.settlement_account_name || "Settlement account",
    currency: "NGN",
  };
}

async function loadTransactionFallbackRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  merchantId: string
) {
  const { data: transactions, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("status", "success")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error || !transactions) {
    if (error) console.error("Merchant settlement transaction fallback failed:", error.message);
    return [];
  }

  return transactions
    .filter((transaction) => transaction.invoice_id)
    .map((transaction) => {
    const grossAmount = Number(transaction.amount_paid || 0);
    const providerFee = Number(transaction.paystack_fee || 0);
    const expectedSettlement =
      transaction.merchant_net_amount === null || transaction.merchant_net_amount === undefined
        ? transaction.fee_absorbed_by === "customer"
          ? grossAmount
          : Math.max(0, grossAmount - providerFee)
        : Number(transaction.merchant_net_amount);
    const hasExpectedSettlement = Number.isFinite(expectedSettlement) && expectedSettlement >= 0;

    return {
      id: `transaction-${transaction.id}`,
      created_at: transaction.created_at,
      merchant_id: transaction.merchant_id,
      provider_name: inferProviderName(transaction),
      payment_method: normalizeMerchantFacingPaymentMethod(transaction.payment_method || transaction.payment_rail || "payment"),
      gross_amount: grossAmount,
      provider_fee: providerFee,
      platform_fee: 0,
      customer_fee: transaction.fee_absorbed_by === "customer" ? providerFee : 0,
      merchant_fee: transaction.fee_absorbed_by === "business" ? providerFee : 0,
      expected_settlement: expectedSettlement,
      actual_settlement: null,
      settlement_difference: null,
      fee_payer: transaction.fee_absorbed_by === "customer" ? "customer_pays_fee" : "merchant_pays_fee",
      settlement_status: hasExpectedSettlement ? "processing" : (transaction.settlement_status || "manual_review"),
      settlement_mode: "provider_direct",
      settlement_owner: hasExpectedSettlement ? "provider" : "manual_review",
      provider_fee_source: providerFee > 0 ? "provider_fee" : "legacy_transaction",
      expected_settlement_source: transaction.merchant_net_amount !== null && transaction.merchant_net_amount !== undefined
        ? "legacy_transaction"
        : providerFee > 0
          ? "provider_fee"
          : "legacy_transaction",
      provider_settlement_reference: transaction.processor_reference || transaction.paystack_reference || transaction.id,
      settled_at: null,
      payment_records: {
        provider_reference: transaction.processor_reference || transaction.paystack_reference || transaction.id,
        payment_purpose: "invoice_payment",
        paid_at: transaction.created_at,
      },
      merchant_settlement_accounts: null,
      merchant_provider_settlement_accounts: null,
      provider_settlement_batches: null,
    };
    });
}

function inferProviderName(transaction: Record<string, unknown>) {
  const paymentProvider = String(transaction.payment_provider || "").toLowerCase();
  if (paymentProvider) return paymentProvider;

  const paymentMethod = String(transaction.payment_method || transaction.payment_rail || "").toLowerCase();
  if (["crypto", "usdt", "usdc", "btc", "eth"].includes(paymentMethod)) return "breet";

  const reference = String(transaction.processor_reference || transaction.paystack_reference || "").toLowerCase();
  if (reference.includes("mnfy")) return "monnify";
  if (reference.includes("paystack")) return "paystack";

  return transaction.processor_reference ? "monnify" : "paystack";
}

function normalizeEmbeddedRow(value: unknown) {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

function filterMerchantReceivableRows(rows: SettlementAccountRow[]) {
  return rows.filter((row) => {
    const paymentRecord = normalizeEmbeddedRow(row.payment_records) as Record<string, unknown> | null;
    const purpose = String(paymentRecord?.payment_purpose || "").toLowerCase();
    const recipientType = String(row.settlement_recipient_type || "").toLowerCase();
    const hasInvoiceId = Boolean(paymentRecord?.invoice_id);

    if (recipientType === "platform") return false;
    if (["plan_subscription", "plan_upgrade", "plan_renewal", "subscription", "upgrade", "renewal", "plan_payment", "platform_billing"].includes(purpose)) {
      return false;
    }
    if (recipientType === "merchant") return true;
    if (!recipientType) return purpose === "invoice_payment" && hasInvoiceId;
    return false;
  });
}

function resolveDisplayedSettlementAccount(row: SettlementAccountRow) {
  const snapshot = normalizeEmbeddedRow(row.settlement_account_snapshot) as Record<string, unknown> | null;
  if (
    snapshot ||
    row.settlement_bank_name ||
    row.settlement_account_name ||
    row.settlement_account_number_masked
  ) {
    return {
      bank_name: stringValue(row.settlement_bank_name) || stringValue(snapshot?.bank_name) || "Settlement bank",
      account_number:
        stringValue(row.settlement_account_number_masked) ||
        stringValue(snapshot?.account_number_masked) ||
        stringValue(snapshot?.account_number),
      account_name: stringValue(row.settlement_account_name) || stringValue(snapshot?.account_name) || "Settlement account",
      currency: stringValue(snapshot?.currency) || "NGN",
    };
  }

  return row.merchant_settlement_accounts || null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeMerchantSettlementDisplay(row: SettlementAccountRow) {
  const batch = normalizeEmbeddedRow(row.provider_settlement_batches) as Record<string, unknown> | null;
  const rawStatus = String(row.settlement_status || "").toLowerCase();
  const batchStatus = String(batch?.settlement_status || "").toLowerCase();
  const hasCompletedSignal =
    ["completed", "settled", "successful", "success"].includes(batchStatus) ||
    ["completed", "settled", "successful", "success"].includes(rawStatus) ||
    Boolean(batch?.settled_at || batch?.provider_reported_settled_at || row.settled_at);

  const settlement_display_status = hasCompletedSignal
    ? "completed"
    : rawStatus === "settlement_pending"
      ? "settlement_pending"
      : rawStatus || "processing";

  const settlement_display_amount =
    row.actual_settlement !== null && row.actual_settlement !== undefined
      ? Number(row.actual_settlement)
      : settlement_display_status === "completed" && row.expected_settlement !== null && row.expected_settlement !== undefined
        ? Number(row.expected_settlement)
        : null;

  return {
    ...row,
    settlement_display_status,
    settlement_display_amount,
  };
}

function isPendingSettlementStatus(status: string) {
  return ["pending", "processing", "manual_review", "settlement_pending"].includes(status.toLowerCase());
}
