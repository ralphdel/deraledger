// PurpLedger — Supabase Data Fetching Layer
// Replaces all mock-data imports with real Supabase queries

import { createClient } from "@/lib/supabase/client";
import type {
  Merchant,
  Client,
  Invoice,
  InvoiceWithClient,
  InvoiceWithLineItems,
  LineItem,
  Transaction,
  AuditLog,
  ItemCatalog,
  DiscountTemplate,
} from "@/lib/types";

// ── Active Merchant ID Resolver ───────────────────────────────────────────────
function supabase() {
  return createClient();
}

async function getActiveMerchantId(): Promise<string> {
  let workspaceId: string | undefined;
  
  if (typeof document !== "undefined") {
    const match = document.cookie.match(new RegExp('(^| )purpledger_workspace_id=([^;]+)'));
    if (match) workspaceId = match[2];
  }
  
  if (workspaceId) {
    return workspaceId;
  }

  const sb = supabase();
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  
  if (user) {
    const { data } = await sb.from("merchants").select("id").eq("user_id", user.id).single();
    if (data?.id) return data.id;
  }
  return "00000000-0000-0000-0000-000000000001"; // Fallback to demo layout
}

// ── Merchant ────────────────────────────────────────────────────────────────
export async function getMerchant(id?: string): Promise<(Merchant & { currentUserRole?: string }) | null> {
  const mId = id || await getActiveMerchantId();
  const sb = supabase();
  
  const { data, error } = await sb
    .from("merchants")
    .select("*")
    .eq("id", mId)
    .single();
    
  if (error) { 
    if (error.code !== "PGRST116") {
      console.error("getMerchant:", error); 
    }
    return null; 
  }

  // Determine current user role
  let currentUserRole = "viewer"; // default safe fallback
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;

  if (user) {
    if (data.user_id === user.id) {
      currentUserRole = "owner";
    } else {
      const { data: teamData } = await sb
        .from("merchant_team")
        .select("roles(name)")
        .eq("merchant_id", mId)
        .eq("user_id", user.id)
        .single();
        
      if (teamData?.roles) {
        // @ts-ignore
        currentUserRole = teamData.roles.name;
      }
    }
  } else {
    // If no user session, they might be in the public payment portal
    // Or it's the demo account. If demo account, let's pretend they are owner for demo purposes.
    if (mId === "00000000-0000-0000-0000-000000000001") {
      currentUserRole = "owner";
    }
  }

  return { ...data, currentUserRole } as Merchant & { currentUserRole?: string };
}

// ── Clients ─────────────────────────────────────────────────────────────────
export async function getClients(merchantId?: string): Promise<Client[]> {
  const mId = merchantId || await getActiveMerchantId();
  const { data, error } = await supabase()
    .from("clients")
    .select("*")
    .eq("merchant_id", mId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false });
  if (error) { console.error("getClients:", error); return []; }
  return (data || []) as Client[];
}

// ── Catalog & Discounts ──────────────────────────────────────────────────────
export async function getItemCatalog(merchantId?: string): Promise<ItemCatalog[]> {
  const mId = merchantId || await getActiveMerchantId();
  const { data, error } = await supabase()
    .from("item_catalog")
    .select("*")
    .eq("merchant_id", mId)
    .order("usage_count", { ascending: false });
  if (error) { console.error("getItemCatalog:", error); return []; }
  return (data || []) as ItemCatalog[];
}

export async function getDiscountTemplates(merchantId?: string): Promise<DiscountTemplate[]> {
  const mId = merchantId || await getActiveMerchantId();
  const { data, error } = await supabase()
    .from("discount_templates")
    .select("*")
    .eq("merchant_id", mId)
    .order("percentage", { ascending: true });
  if (error) { console.error("getDiscountTemplates:", error); return []; }
  return (data || []) as DiscountTemplate[];
}

// ── Invoices ────────────────────────────────────────────────────────────────
export async function getInvoices(merchantId?: string): Promise<InvoiceWithClient[]> {
  const mId = merchantId || await getActiveMerchantId();
  const { data, error } = await supabase()
    .from("invoices")
    .select("*, clients(full_name, email, phone, company_name, address)")
    .eq("merchant_id", mId)
    .order("created_at", { ascending: false });
  if (error) { console.error("getInvoices:", error); return []; }
  return (data || []) as InvoiceWithClient[];
}

export async function getInvoiceById(invoiceId: string): Promise<InvoiceWithLineItems | null> {
  const { data, error } = await supabase()
    .from("invoices")
    .select("*, line_items(*), clients(full_name, email, phone, company_name, address)")
    .eq("id", invoiceId)
    .single();
  if (error) { console.error("getInvoiceById:", error); return null; }
  // Sort line items by sort_order
  if (data?.line_items) {
    data.line_items.sort((a: LineItem, b: LineItem) => a.sort_order - b.sort_order);
  }
  return data as InvoiceWithLineItems;
}

// ── Transactions ────────────────────────────────────────────────────────────
export async function getTransactions(invoiceId: string): Promise<Transaction[]> {
  const { data, error } = await supabase()
    .from("transactions")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: true });
  if (error) { console.error("getTransactions:", error); return []; }
  return (data || []) as Transaction[];
}

export async function getManualPayments(invoiceId: string) {
  const { data, error } = await supabase()
    .from("manual_payments")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("date_received", { ascending: true });
  if (error) { console.error("getManualPayments:", error); return []; }
  return data || [];
}

export async function getAllTransactions(merchantId?: string): Promise<Transaction[]> {
  const mId = merchantId || await getActiveMerchantId();
  const { data, error } = await supabase()
    .from("transactions")
    .select("*, invoices(*)")
    .order("created_at", { ascending: false });

  if (error) { console.error("getAllTransactions:", error); return []; }

  // Manually filter down to the merchant's invoices
  // In a real DB, you'd probably join properly, but this is simple enough for the demo.
  const filtered = (data || []).filter(
    (tx) => (tx.invoices as any)?.merchant_id === mId
  );
  return filtered as Transaction[];
}

export async function getMonthlyCollectionTotal(merchantId?: string): Promise<number> {
  const mId = merchantId || await getActiveMerchantId();
  
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  
  const { data, error } = await supabase()
    .from("transactions")
    .select("amount_paid")
    .eq("merchant_id", mId)
    .eq("status", "success")
    .gte("created_at", firstDayOfMonth);

  if (error) {
    console.error("getMonthlyCollectionTotal:", error);
    return 0;
  }

  return (data || []).reduce((sum, tx) => sum + Number(tx.amount_paid), 0);
}

// ── Dashboard Analytics ─────────────────────────────────────────────────────
export async function getDashboardStats(merchantId?: string) {
  const mId = merchantId || await getActiveMerchantId();
  const [invoices, transactions] = await Promise.all([
    getInvoices(mId),
    getAllTransactions(mId),
  ]);

  const openInvoices = invoices.filter(
    (i) => i.status === "open" || i.status === "partially_paid"
  );
  const totalOutstanding = openInvoices.reduce(
    (sum, i) => sum + Number(i.outstanding_balance),
    0
  );
  const overdueCount = invoices.filter((i) => i.status === "expired").length;
  const totalInvoiced = invoices.reduce((sum, i) => sum + Number(i.grand_total), 0);
  const totalCollected = invoices.reduce((sum, i) => sum + Number(i.amount_paid), 0);

  // Payment method breakdown
  const successTxns = transactions.filter((t) => t.status === "success");
  const methodCounts = { card: 0, bank_transfer: 0, ussd: 0 };
  successTxns.forEach((t) => {
    methodCounts[t.payment_method] = (methodCounts[t.payment_method] || 0) + 1;
  });
  const totalTxnCount = successTxns.length || 1;
  const paymentMethodData = [
    { method: "Card", value: Math.round((methodCounts.card / totalTxnCount) * 100), fill: "#2D1B6B" },
    { method: "Bank Transfer", value: Math.round((methodCounts.bank_transfer / totalTxnCount) * 100), fill: "#7B2FBE" },
    { method: "USSD", value: Math.round((methodCounts.ussd / totalTxnCount) * 100), fill: "#C4B5FD" },
  ];

  // Aging buckets
  const now = new Date();
  const agingData = [
    { bucket: "0-30 days", amount: 0 },
    { bucket: "31-60 days", amount: 0 },
    { bucket: "61-90 days", amount: 0 },
    { bucket: "90+ days", amount: 0 },
  ];
  openInvoices.forEach((inv) => {
    const created = new Date(inv.created_at);
    const daysDiff = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
    const balance = Number(inv.outstanding_balance);
    if (daysDiff <= 30) agingData[0].amount += balance;
    else if (daysDiff <= 60) agingData[1].amount += balance;
    else if (daysDiff <= 90) agingData[2].amount += balance;
    else agingData[3].amount += balance;
  });

  // Monthly data (last 6 months)
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthlyData: { month: string; invoiced: number; collected: number; _year: number; _month: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthlyData.push({ month: monthNames[d.getMonth()], invoiced: 0, collected: 0, _year: d.getFullYear(), _month: d.getMonth() });
  }

  invoices.forEach(inv => {
    const created = new Date(inv.created_at);
    const y = created.getFullYear();
    const m = created.getMonth();
    const bucket = monthlyData.find(b => b._year === y && b._month === m);
    if (bucket) bucket.invoiced += Number(inv.grand_total);
  });

  successTxns.forEach(txn => {
    const created = new Date(txn.created_at);
    const y = created.getFullYear();
    const m = created.getMonth();
    const bucket = monthlyData.find(b => b._year === y && b._month === m);
    if (bucket) bucket.collected += Number(txn.amount_paid);
  });

  // Recent activity from audit logs or recent transactions
  const recentActivity = successTxns.slice(0, 5).map((txn, i) => ({
    id: txn.id,
    type: "payment" as const,
    description: `Payment of ₦${Number(txn.amount_paid).toLocaleString()} received (${txn.paystack_reference})`,
    time: new Date(txn.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short" }),
    icon: "receipt" as const,
  }));

  return {
    totalInvoiced,
    totalCollected,
    totalOutstanding,
    overdueCount,
    paymentMethodData,
    agingData,
    monthlyData,
    recentActivity,
  };
}

// ── Public Payment Portal ───────────────────────────────────────────────────
// NOTE: The public payment portal now calls /api/invoice/[invoiceId] directly
// using the service role key. This function is kept for reference only.
export async function getPublicInvoice(invoiceId: string) {
  const invoice = await getInvoiceById(invoiceId);
  if (!invoice) return null;
  const merchant = await getMerchant(invoice.merchant_id);
  const monthlyCollected = await getMonthlyCollectionTotal(invoice.merchant_id);
  return { invoice, merchant, monthlyCollected };
}
