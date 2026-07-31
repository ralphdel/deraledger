import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  canManageSettlementAccounts,
  resolveMerchantContextForUser,
} from "@/lib/merchant-context";
import {
  getMerchantPaymentMethodReadiness,
  getSettlementEnvironment,
} from "@/lib/services/settlement-ledger.service";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

const serviceRole = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const supabase = await createClient();
  const merchantContext = await resolveCurrentMerchantContext(supabase);

  if (merchantContext.status === "unauthenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (merchantContext.status !== "resolved") {
    return NextResponse.json({ error: "No authorized merchant workspace was found." }, { status: 403 });
  }

  if (!canManageSettlementAccounts(merchantContext)) {
    return NextResponse.json({ error: "Settlement account management is owner-only." }, { status: 403 });
  }

  const merchantId = merchantContext.merchantId;

  const { data: merchant } = await serviceRole
    .from("merchants")
    .select("email")
    .eq("id", merchantId)
    .maybeSingle();

  const { data, error } = await serviceRole
    .from("merchant_settlement_accounts")
    .select(`
      *,
      merchant_provider_settlement_accounts(*)
    `)
    .eq("merchant_id", merchantId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const paymentMethodReadiness = await getMerchantPaymentMethodReadiness(serviceRole, {
    merchantId,
    environment: getSettlementEnvironment(merchant?.email || null),
    purpose: "invoice_payment",
  });

  return NextResponse.json({
    accounts: (data || []).map(sanitizeSettlementAccountRecord),
    payment_method_readiness: paymentMethodReadiness.methods,
    readiness_banner: paymentMethodReadiness.banner,
    has_payout_account: paymentMethodReadiness.has_payout_account,
  });
}

async function resolveCurrentMerchantContext(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const cookieStore = await cookies();
  return resolveMerchantContextForUser(supabase, user, {
    preferredMerchantId: cookieStore.get("purpledger_workspace_id")?.value || null,
  });
}

function sanitizeSettlementAccountRecord(account: Record<string, unknown>) {
  return {
    id: stringValue(account.id),
    bank_name: stringValue(account.bank_name),
    account_number: maskAccountNumber(stringValue(account.account_number)),
    account_name: stringValue(account.account_name),
    currency: stringValue(account.currency),
    is_default: Boolean(account.is_default),
  };
}

function maskAccountNumber(accountNumber?: string | null) {
  if (!accountNumber) return null;
  if (accountNumber.startsWith("****")) return accountNumber;
  const last4 = accountNumber.slice(-4) || "----";
  return `****${last4}`;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}
