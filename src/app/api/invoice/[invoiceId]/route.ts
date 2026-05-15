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

  // 1. Look up invoice — try by UUID `id` first, then fall back to `invoice_hash` or `short_link`
  let invoice: any = null;

  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId);

  if (isUUID) {
    const { data, error } = await adminClient
      .from("invoices")
      .select("*, line_items(*), clients(*)")
      .eq("id", invoiceId)
      .maybeSingle();
    if (error) {
      console.error("Invoice UUID lookup error:", error.message);
    }
    invoice = data;
  }

  // Fallback: try invoice_hash or short_link (for short-link based URLs)
  if (!invoice) {
    const { data, error } = await adminClient
      .from("invoices")
      .select("*, line_items(*), clients(*)")
      .or(`invoice_hash.eq.${invoiceId},short_link.eq.${invoiceId}`)
      .maybeSingle();
    if (error) {
      console.error("Invoice hash/shortlink lookup error:", error.message);
    }
    invoice = data;
  }

  if (!invoice) {
    console.error("Invoice not found for ID:", invoiceId);
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  // 2. Fetch merchant record — separate query to avoid join issues
  const { data: merchant, error: merchantError } = await adminClient
    .from("merchants")
    .select("*")
    .eq("id", invoice.merchant_id)
    .single();

  if (merchantError || !merchant) {
    console.error("Merchant lookup failed for invoice:", invoice.merchant_id, merchantError?.message);
    return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
  }

  // 3. Separate subscription query to avoid RLS join issues
  const { data: subData } = await adminClient
    .from("subscriptions")
    .select("status")
    .eq("merchant_id", invoice.merchant_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  merchant.subscription_status = subData?.status || "active";

  // 4. Monthly collection total
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

  // 5. Enforce owner_name guard server-side.
  const isNonStarter = (merchant.subscription_plan || merchant.merchant_tier || "starter") !== "starter";
  const ownerNameMissing = isNonStarter && (!merchant.owner_name || merchant.owner_name.trim() === "");
  const effectiveMerchant = ownerNameMissing
    ? { ...merchant, verification_status: "unverified", bvn_status: "unverified" }
    : merchant;

  // 6. Fetch reference context if invoice belongs to a project
  let referenceContext: {
    name: string;
    projectTotalValue: number;
    totalCollected: number;
    outstandingBalance: number;
    collectionProgress: number;
    hasProjectTotal: boolean;
  } | null = null;

  if (invoice.reference_id) {
    const { data: ref } = await adminClient
      .from("references")
      .select("name, project_total_value")
      .eq("id", invoice.reference_id)
      .maybeSingle();

    if (ref) {
      // Fetch all sibling collection invoices under same reference
      const { data: siblings } = await adminClient
        .from("invoices")
        .select("amount_paid, invoice_type")
        .eq("reference_id", invoice.reference_id)
        .eq("invoice_type", "collection");

      const totalCollected = (siblings || []).reduce(
        (sum: number, s: any) => sum + Number(s.amount_paid ?? 0), 0
      );
      const projectTotalValue = Number(ref.project_total_value ?? 0);
      const hasProjectTotal = projectTotalValue > 0;
      const outstandingBalance = hasProjectTotal
        ? Math.max(0, projectTotalValue - totalCollected)
        : 0;
      const collectionProgress = hasProjectTotal
        ? Math.min(100, Math.round((totalCollected / projectTotalValue) * 100))
        : 0;

      referenceContext = {
        name: ref.name,
        projectTotalValue,
        totalCollected,
        outstandingBalance,
        collectionProgress,
        hasProjectTotal,
      };
    }
  }

  return NextResponse.json({ invoice, merchant: effectiveMerchant, monthlyCollected, referenceContext });
}
