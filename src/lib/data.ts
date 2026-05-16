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
  Subscription,
  Reference,
} from "@/lib/types";

// ── Active Merchant ID Resolver ───────────────────────────────────────────────
function supabase() {
  return createClient();
}

let cachedMerchantId: string | null = null;
let activeMerchantPromise: Promise<string> | null = null;

async function getActiveMerchantId(): Promise<string> {
  let workspaceId = null;

  if (typeof window !== "undefined") {
    const match = window.location.pathname.match(/^\/(w|workspace)\/([^\/]+)/);
    if (match) workspaceId = match[2];
  }
  
  if (workspaceId) {
    return workspaceId;
  }

  if (cachedMerchantId) return cachedMerchantId;
  if (activeMerchantPromise) return activeMerchantPromise;

  activeMerchantPromise = (async () => {
    try {
      const sb = supabase();
      const { data: { session } } = await sb.auth.getSession();
      const user = session?.user;
      
      if (user) {
        const { data } = await sb.from("merchants").select("id").eq("user_id", user.id).single();
        if (data?.id) {
          cachedMerchantId = data.id;
          return data.id;
        }
      }
      return "00000000-0000-0000-0000-000000000001"; // Fallback to demo layout
    } finally {
      activeMerchantPromise = null;
    }
  })();

  return activeMerchantPromise;
}

// ── Merchant ────────────────────────────────────────────────────────────────
export async function getMerchant(id?: string): Promise<(Merchant & { currentUserRole?: string, permissions?: Record<string, boolean> }) | null> {
  const mId = id || await getActiveMerchantId();
  const sb = supabase();
  
  const { data, error } = await sb
    .from("merchants")
    .select("*")
    .eq("id", mId)
    .single();
    
  // Determine subscription status for lock enforcement.
  // CRITICAL: Must order by created_at DESC (not expiry_date) so the most recently
  // created subscription (the new active one after renewal/upgrade) is always returned first.
  // Ordering by expiry_date can return an old expired row that has a later date than the new active one.
  const { data: subData } = await sb
    .from("subscriptions")
    .select("status, expiry_date")
    .eq("merchant_id", mId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const isCancelled = subData?.status === "cancelled";
  const isExpired = subData?.status === "expired";
  const isSuspended = data?.verification_status === "suspended";
  const isSuperAdmin = (data as any)?.is_super_admin === true;
  const expiryDate = subData?.expiry_date ? new Date(subData.expiry_date) : null;
  const now = new Date();
  // SuperAdmin accounts are NEVER locked regardless of subscription state
  const isHardLocked = !isSuperAdmin && (isCancelled || (isExpired && expiryDate && (now.getTime() - expiryDate.getTime()) / (1000 * 60 * 60) > 24) || isSuspended);

  // Determine current user role and permissions
  let currentUserRole = "viewer"; // default safe fallback
  let permissions: Record<string, boolean> = {};
  
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;

  if (user) {
    if (data.user_id === user.id) {
      currentUserRole = "owner";
      // Owners get all permissions
      permissions = {
        view_invoices: true, create_invoice: true, edit_invoice: true, record_payment: true,
        manual_close: true, void_invoice: true, view_clients: true, manage_clients: true,
        delete_client: true, view_analytics: true, view_transactions: true, manage_kyc: true,
        change_fee_settings: true, manage_business: true, manage_billing: true, manage_team: true,
        use_purpbot: true, view_settlements: true, manage_advance_settings: true,
        manage_settlement_account: true, manage_item_catalog: true, manage_discount_template: true,
        view_item_catalog: true, view_discount_template: true
      };
    } else {
      const { data: teamData } = await sb
        .from("merchant_team")
        .select("roles(name, permissions)")
        .eq("merchant_id", mId)
        .eq("user_id", user.id)
        .single();
        
      if (teamData?.roles) {
        // @ts-ignore
        currentUserRole = teamData.roles.name;
        // @ts-ignore
        permissions = teamData.roles.permissions || {};
      }
    }
  } else if (mId === "00000000-0000-0000-0000-000000000001") {
    currentUserRole = "owner";
    permissions = {
      view_invoices: true, create_invoice: true, edit_invoice: true, record_payment: true,
      manual_close: true, void_invoice: true, view_clients: true, manage_clients: true,
      delete_client: true, view_analytics: true, view_transactions: true, manage_kyc: true,
      change_fee_settings: true, manage_business: true, manage_billing: true, manage_team: true,
      use_purpbot: true, view_settlements: true, manage_advance_settings: true,
      manage_settlement_account: true, manage_item_catalog: true, manage_discount_template: true,
      view_item_catalog: true, view_discount_template: true
    };
  }

  const isReadOnly = isExpired && !isHardLocked;

  // Apply Lock/Restriction logic: Strip permissions based on status
  if (currentUserRole !== "superadmin") {
    if (isHardLocked) {
      if (isSuspended) {
        // Suspended for violations: Zero access
        permissions = {};
      } else {
        // Churned/Hard Expired: Only billing access
        permissions = {
          manage_billing: true,
          view_billing: true
        };
      }
    } else if (isReadOnly) {
      // Expired but in 24h grace period: Read-only access
      const readOnlyPermissions: Record<string, boolean> = {
        manage_billing: true,
        view_billing: true
      };
      
      // Keep only view permissions
      Object.keys(permissions).forEach(key => {
        if (key.startsWith("view_")) {
          readOnlyPermissions[key] = true;
        }
      });
      
      permissions = readOnlyPermissions;
    }
  }

  return { 
    ...data, 
    currentUserRole, 
    permissions,
    subscription_status: subData?.status || "none",
    is_hard_locked: isHardLocked,
    is_suspended: isSuspended,
    is_read_only: isReadOnly
  } as Merchant & { 
    currentUserRole?: string, 
    permissions?: Record<string, boolean>,
    subscription_status: string,
    is_hard_locked: boolean,
    is_suspended: boolean,
    is_read_only: boolean
  };
}

// ── Subscriptions ───────────────────────────────────────────────────────────
export async function getActiveSubscription(id?: string): Promise<Subscription | null> {
  const mId = id || await getActiveMerchantId();
  const sb = supabase();
  
  // SuperAdmin Bypass
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  if (user?.email === "ralphdel14@yahoo.com") {
    return {
      id: "superadmin-bypass",
      merchant_id: mId,
      plan_type: "individual",
      amount_paid: 0,
      start_date: new Date().toISOString(),
      expiry_date: new Date(new Date().getTime() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString(), // 100 years
      status: "active",
      last_notified_at: null,
      is_banner_dismissed: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }
  
  const { data, error } = await sb
    .from("subscriptions")
    .select("*")
    .eq("merchant_id", mId)
    .order("created_at", { ascending: false }) // Always get the most recently created subscription
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error("getActiveSubscription:", error);
  }
  return data as Subscription | null;
}

export interface SubscriptionPayment {
  id: string;
  merchant_id: string;
  plan: string;
  amount_ngn: number;
  period_start: string;
  period_end: string;
  paystack_ref: string;
  payment_type: "new" | "renewal" | "upgrade";
  status: "paid" | "refunded";
  created_at: string;
}

export async function getSubscriptionPayments(merchantId?: string): Promise<SubscriptionPayment[]> {
  const mId = merchantId || await getActiveMerchantId();
  const { data, error } = await supabase()
    .from("subscription_payments")
    .select("*")
    .eq("merchant_id", mId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getSubscriptionPayments:", error);
    return [];
  }
  return data as SubscriptionPayment[];
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

export async function getReferences(merchantId?: string): Promise<Reference[]> {
  const mId = merchantId || await getActiveMerchantId();
  const { data, error } = await supabase()
    .from("references")
    .select("*")
    .eq("merchant_id", mId)
    .order("created_at", { ascending: false });
  if (error) { console.error("getReferences:", error); return []; }
  return (data || []) as Reference[];
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
    .select("*, invoices(*, clients(full_name, email, phone, company_name, address))")
    .eq("merchant_id", mId)
    .order("created_at", { ascending: false });

  if (error) { console.error("getAllTransactions:", error); return []; }
  return (data || []) as Transaction[];
}

export async function getAllManualPayments(merchantId?: string) {
  const mId = merchantId || await getActiveMerchantId();
  const { data, error } = await supabase()
    .from("manual_payments")
    .select("*, invoices(*, clients(full_name, email, phone, company_name, address))")
    .eq("merchant_id", mId)
    .order("date_received", { ascending: false });

  if (error) { console.error("getAllManualPayments:", error); return []; }
  return data || [];
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
  const [invoices, transactions, manualPayments] = await Promise.all([
    getInvoices(mId),
    getAllTransactions(mId),
    getAllManualPayments(mId),
  ]);

  const paymentsByInvoice = new Map<string, number>();
  transactions
    .filter((t) => t.status === "success")
    .forEach((t) => {
      paymentsByInvoice.set(t.invoice_id, (paymentsByInvoice.get(t.invoice_id) || 0) + Number(t.amount_paid || 0));
    });
  manualPayments.forEach((payment: any) => {
    paymentsByInvoice.set(payment.invoice_id, (paymentsByInvoice.get(payment.invoice_id) || 0) + Number(payment.amount || 0));
  });

  const getInvoiceMetrics = (invoice: InvoiceWithClient) => {
    const grandTotal = Number(invoice.grand_total || 0);
    const recordedPaid = Number(invoice.amount_paid || 0);
    const paymentRecordPaid = paymentsByInvoice.get(invoice.id) || 0;
    const paid = Math.min(grandTotal, Math.max(recordedPaid, paymentRecordPaid));
    const outstanding = Math.max(0, grandTotal - paid);
    return { grandTotal, paid, outstanding };
  };

  const openInvoices = invoices.filter(
    (i) => i.status === "open" || i.status === "partially_paid"
  );
  const totalOutstanding = openInvoices.reduce(
    (sum, i) => sum + getInvoiceMetrics(i).outstanding,
    0
  );
  const now = new Date();
  const todayMidnight = new Date(now);
  todayMidnight.setHours(0, 0, 0, 0);
  const overdueCount = invoices.filter((i) => {
    if (i.status === "expired" || i.status === "overdue") return true;
    if ((i.status === "open" || i.status === "partially_paid") && i.pay_by_date) {
      return new Date(i.pay_by_date) < todayMidnight;
    }
    return false;
  }).length;
  const totalInvoiced = invoices.reduce((sum, i) => sum + getInvoiceMetrics(i).grandTotal, 0);
  const totalCollected = invoices.reduce((sum, i) => sum + getInvoiceMetrics(i).paid, 0);

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
  const agingData = [
    { bucket: "0-30 days", amount: 0 },
    { bucket: "31-60 days", amount: 0 },
    { bucket: "61-90 days", amount: 0 },
    { bucket: "90+ days", amount: 0 },
  ];
  openInvoices.forEach((inv) => {
    const created = new Date(inv.created_at);
    const daysDiff = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
    const balance = getInvoiceMetrics(inv).outstanding;
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

  manualPayments.forEach((payment: any) => {
    const created = new Date(payment.date_received || payment.created_at);
    const y = created.getFullYear();
    const m = created.getMonth();
    const bucket = monthlyData.find(b => b._year === y && b._month === m);
    if (bucket) bucket.collected += Number(payment.amount);
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
export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: "info" | "warning" | "error" | "success";
  time: string;
  isRead: boolean;
  link?: string;
}

export async function getNotifications(merchantId?: string): Promise<AppNotification[]> {
  const mId = merchantId || await getActiveMerchantId();
  const [merchant, subscription] = await Promise.all([
    getMerchant(mId),
    getActiveSubscription(mId)
  ]);

  const notifications: AppNotification[] = [];

  if (!merchant) return [];

  // 1. KYC Notifications
  if (merchant.verification_status === "unverified") {
    notifications.push({
      id: "kyc-unverified",
      title: "KYC Verification Needed",
      message: "Please complete your business verification to unlock higher collection limits.",
      type: "warning",
      time: "Action Required",
      isRead: false,
      link: "/settings/verification"
    });
  } else if (merchant.verification_status === "rejected") {
    notifications.push({
      id: "kyc-rejected",
      title: "Verification Rejected",
      message: "Your documents were rejected. Please review the notes and re-upload.",
      type: "error",
      time: "Important",
      isRead: false,
      link: "/settings/verification"
    });
  }

  // 2. Subscription Notifications
  if (subscription) {
    const now = new Date();
    const expiry = new Date(subscription.expiry_date);
    const daysRemaining = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (subscription.status === "cancelled") {
      notifications.push({
        id: "sub-cancelled",
        title: "Account Deactivated",
        message: "Your subscription has been manually cancelled. Features are restricted.",
        type: "error",
        time: "Now",
        isRead: false,
        link: "/settings/billing"
      });
    } else if (daysRemaining <= 0) {
      notifications.push({
        id: "sub-expired",
        title: "Subscription Expired",
        message: "Your plan has expired. Renew now to restore full dashboard access.",
        type: "error",
        time: "Now",
        isRead: false,
        link: "/settings/billing"
      });
    } else if (daysRemaining <= 7) {
      notifications.push({
        id: "sub-warning",
        title: "Subscription Expiring",
        message: `Your ${subscription.plan_type} plan expires in ${daysRemaining} days.`,
        type: "warning",
        time: `${daysRemaining} days left`,
        isRead: false,
        link: "/settings/billing"
      });
    }
  }

  return notifications;
}
