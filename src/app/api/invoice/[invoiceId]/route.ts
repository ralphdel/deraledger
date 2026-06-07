import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Service role client — runs server-side only, bypasses RLS completely
function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type InvoiceApiRecord = {
  id: string;
  merchant_id: string;
  reference_id?: string | null;
  payment_provider?: string | null;
  payment_method?: string | null;
  crypto_asset?: string | null;
  [key: string]: unknown;
};

type AllocationRow = {
  id: string;
  source_invoice_id: string;
  allocated_amount: number | string | null;
  invoices?: {
    invoice_number?: string | null;
    grand_total?: number | string | null;
  } | null;
};

async function applyLatestSuccessfulPaymentDisplay(adminClient: ReturnType<typeof getServiceClient>, invoice: InvoiceApiRecord | null) {
  if (!invoice) return null;
  const { data: paymentRecord } = await adminClient
    .from("payment_records")
    .select("provider_name,payment_method,paid_at,created_at,raw_provider_payload")
    .eq("invoice_id", invoice.id)
    .eq("payment_status", "successful")
    .order("paid_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (paymentRecord) {
    invoice.payment_provider = paymentRecord.provider_name || invoice.payment_provider;
    invoice.payment_method = paymentRecord.payment_method || invoice.payment_method;
    if (paymentRecord.payment_method === "crypto") {
      invoice.crypto_asset =
        paymentRecord.raw_provider_payload?.asset ||
        paymentRecord.raw_provider_payload?.raw_provider_payload?.asset ||
        invoice.crypto_asset;
    }
    return invoice;
  }

  const { data: transaction } = await adminClient
    .from("transactions")
    .select("payment_method,payment_rail")
    .eq("invoice_id", invoice.id)
    .eq("status", "success")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (transaction) {
    const latestMethod = transaction.payment_method || transaction.payment_rail || invoice.payment_method;
    invoice.payment_method = latestMethod;
    if (latestMethod === "crypto" || ["usdt", "usdc", "btc", "eth"].includes(String(latestMethod).toLowerCase())) {
      invoice.payment_provider = "breet";
    }
  }

  return invoice;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const { invoiceId } = await params;

  const adminClient = getServiceClient();

  // 1. Look up invoice — try by UUID `id` first, then fall back to `invoice_hash` or `short_link`
  let invoice: InvoiceApiRecord | null = null;

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

  invoice = await applyLatestSuccessfulPaymentDisplay(adminClient, invoice);

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
    (sum: number, tx) => sum + Number(tx.amount_paid),
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
        (sum: number, sibling) => sum + Number(sibling.amount_paid ?? 0), 0
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

  // 7. Fetch deposit allocations applied to this invoice
  const { data: allocations } = await adminClient
    .from("invoice_allocations")
    .select("id, source_invoice_id, allocated_amount, invoices!source_invoice_id(invoice_number, grand_total)")
    .eq("target_invoice_id", invoice.id);

  const depositAllocations = ((allocations || []) as AllocationRow[]).map((allocation) => ({
    id: allocation.id,
    source_invoice_id: allocation.source_invoice_id,
    allocated_amount: Number(allocation.allocated_amount),
    source_invoice_number: allocation.invoices?.invoice_number ?? null,
    source_invoice_total: allocation.invoices?.grand_total ? Number(allocation.invoices.grand_total) : null,
  }));

  const totalDepositAllocated = depositAllocations.reduce(
    (sum: number, allocation) => sum + allocation.allocated_amount, 0
  );

  return NextResponse.json({ invoice, merchant: effectiveMerchant, monthlyCollected, referenceContext, depositAllocations, totalDepositAllocated });
}
