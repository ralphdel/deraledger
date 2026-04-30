import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Service role client — runs server-side only, bypasses RLS completely
function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const { invoiceId } = await params;

  const adminClient = getServiceClient();

  // 1. Look up invoice by its public hash
  const { data: invoice, error: invError } = await adminClient
    .from("invoices")
    .select("*, line_items(*), clients(*)")
    .eq("invoice_hash", invoiceId)
    .single();

  if (invError || !invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  // 2. Fetch full merchant record — this is the critical part.
  //    Using the service role key GUARANTEES we get the real verification_status
  //    regardless of RLS policies, so the KYC gate is enforced server-side.
  const { data: merchant, error: merchantError } = await adminClient
    .from("merchants")
    .select("*")
    .eq("id", invoice.merchant_id)
    .single();

  if (merchantError || !merchant) {
    return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
  }

  // 3. Monthly collection total
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const { data: txData } = await adminClient
    .from("transactions")
    .select("amount_paid")
    .eq("merchant_id", invoice.merchant_id)
    .eq("status", "success")
    .gte("created_at", firstDayOfMonth);

  const monthlyCollected = (txData || []).reduce(
    (sum: number, tx: any) => sum + Number(tx.amount_paid),
    0
  );

  // 4. Enforce owner_name guard server-side.
  //    If merchant is "verified" but owner_name is missing, treat as unverified.
  //    This handles merchants verified before the owner_name requirement was introduced.
  const isNonStarter = (merchant.subscription_plan || merchant.merchant_tier || "starter") !== "starter";
  const ownerNameMissing = isNonStarter && (!merchant.owner_name || merchant.owner_name.trim() === "");
  const effectiveMerchant = ownerNameMissing
    ? { ...merchant, verification_status: "unverified", bvn_status: "unverified" }
    : merchant;

  return NextResponse.json({ invoice, merchant: effectiveMerchant, monthlyCollected });
}
