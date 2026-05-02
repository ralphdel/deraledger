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

  // 1. Look up invoice — try by UUID `id` first, then fall back to `invoice_hash`
  //    This ensures payment links using either the raw ID (/pay/uuid) or
  //    a short hash (/pay/hash) both resolve correctly.
  let invoice: any = null;

  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId);

  if (isUUID) {
    const { data } = await adminClient
      .from("invoices")
      .select("*, line_items(*), clients(*)")
      .eq("id", invoiceId)
      .maybeSingle();
    invoice = data;
  }

  // Fallback: try invoice_hash (for short-link based URLs)
  if (!invoice) {
    const { data } = await adminClient
      .from("invoices")
      .select("*, line_items(*), clients(*)")
      .eq("invoice_hash", invoiceId)
      .maybeSingle();
    invoice = data;
  }

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  // 2. Fetch full merchant record — this is the critical part.
  //    Using the service role key GUARANTEES we get the real verification_status
  //    regardless of RLS policies, so the KYC gate is enforced server-side.
  const { data: merchant, error: merchantError } = await adminClient
    .from("merchants")
    .select("*, subscriptions(*)")
    .eq("id", invoice.merchant_id)
    .single();

  if (merchantError || !merchant) {
    return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
  }

  // Find the relevant subscription (not cancelled)
  const subscription = merchant.subscriptions?.find((sub: any) => sub.status !== "cancelled");
  // Attach the status to the merchant object for the frontend to read
  merchant.subscription_status = subscription?.status || "active";
  delete merchant.subscriptions;

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
