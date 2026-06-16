import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  getMerchantPaymentMethodReadiness,
  getSettlementEnvironment,
} from "@/lib/services/settlement-ledger.service";

export const dynamic = "force-dynamic";

const serviceRole = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const supabase = await createClient();
  const merchantId = await resolveCurrentMerchantId(supabase);

  if (!merchantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

async function resolveCurrentMerchantId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: owned } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", user.id)
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
