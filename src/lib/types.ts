// PurpLedger — Database Types (v2.1 — matches Supabase schema)

export interface Merchant {
  id: string;
  user_id: string | null;
  workspace_code: string | null;
  business_name: string;
  trading_name: string | null;
  owner_name: string | null;
  email: string;
  phone: string | null;
  logo_url: string | null;
  fee_absorption_default: "business" | "customer";
  verification_status: "unverified" | "pending" | "verified" | "rejected" | "suspended";
  // v2.1: subscription_plan replaces merchant_tier
  subscription_plan: "starter" | "individual" | "corporate";
  // Keep merchant_tier during migration — both columns exist in DB
  merchant_tier: "starter" | "individual" | "corporate";
  kyc_submitted_at: string | null;
  kyc_notes: string | null;
  cac_number: string | null;
  bvn: string | null;
  cac_document_url: string | null;
  utility_document_url: string | null;
  cac_status: "unverified" | "pending" | "verified" | "rejected";
  utility_status: "unverified" | "pending" | "verified" | "rejected";
  bvn_status: "unverified" | "pending" | "verified" | "rejected";
  // Settlement fields (v2.1)
  settlement_bank_name: string | null;
  settlement_bank_code: string | null;
  settlement_account_number: string | null;
  settlement_account_name: string | null;
  settlement_account_type: string | null;
  payment_subaccount_code: string | null;
  payment_provider: string;
  subaccount_verified: boolean;
  settlement_activated_at: string | null;
  monthly_collection_limit: number;
  holds_pending_review: boolean;
  platform_version: number;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  merchant_id: string;
  plan_type: "individual" | "corporate" | "starter";
  amount_paid: number;
  start_date: string;
  expiry_date: string;
  status: "active" | "expired" | "cancelled";
  last_notified_at: string | null;
  is_banner_dismissed: boolean;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  merchant_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  address: string | null;               // v2.1 FB-001
  whatsapp_number: string | null;       // v2.1 Sprint E
  reminder_enabled: boolean;            // v2.1 — whether reminders are sent to this client
  reminder_channels: ("email" | "whatsapp")[];  // v2.1 — which channels to use
  is_deleted: boolean;
  created_at: string;
}

export interface Invoice {
  id: string;
  merchant_id: string;
  client_id: string;
  invoice_number: string;
  invoice_type: "record" | "collection";  // v2.1
  status: "open" | "partially_paid" | "closed" | "manually_closed" | "overdue" | "expired" | "void";
  subtotal: number;
  discount_pct: number;
  discount_value: number;
  tax_pct: number;
  tax_value: number;
  grand_total: number;
  amount_paid: number;
  outstanding_balance: number;
  fee_absorption: "business" | "customer";
  pay_by_date: string | null;       // Collection Invoice
  due_date?: string | null;         // Record Invoice alias — same DB column, renamed in UI
  short_link: string | null;
  qr_code_url: string | null;
  notes: string | null;
  payment_notes: string | null;     // v2.1 Record Invoice only
  manual_close_reason: string | null;
  send_reminders: boolean;
  allow_partial_payment: boolean;
  partial_payment_pct: number | null;
  created_at: string;
  updated_at: string;
}

export interface LineItem {
  id: string;
  invoice_id: string;
  item_name: string;
  quantity: number;
  unit_rate: number;
  line_total: number;
  sort_order: number;
}

export interface Transaction {
  id: string;
  invoice_id: string;
  merchant_id: string;
  amount_paid: number;
  k_factor: number;
  tax_collected: number;
  discount_applied: number;
  paystack_fee: number;
  fee_absorbed_by: "business" | "customer";
  paystack_reference: string | null;
  payment_method: "card" | "bank_transfer" | "ussd";
  status: "success" | "failed" | "pending" | "held_pending_review";
  created_at: string;
}

// v2.1 — Record Invoice offline payment record
export interface ManualPayment {
  id: string;
  invoice_id: string;
  merchant_id: string;
  amount: number;
  payment_method: "cash" | "bank_transfer" | "cheque" | "other";
  date_received: string;
  reference_note: string | null;
  recorded_by: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  event_type: string;
  actor_id: string | null;
  actor_role: "merchant" | "admin" | "system";
  target_id: string | null;
  target_type: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Role {
  id: string;
  name: string;
  permissions: Record<string, boolean>;
  is_system_role: boolean;
  merchant_id: string | null;
  created_at: string;
}

export interface MerchantTeam {
  id: string;
  merchant_id: string;
  user_id: string;
  role_id: string;
  is_active: boolean;
  must_change_password: boolean;
  invited_by: string | null;
  added_at: string;
  last_active_at: string | null;
}

// v2.1 — Item Catalog (FB-003A)
export interface ItemCatalog {
  id: string;
  merchant_id: string;
  item_name: string;
  default_rate: number;
  description: string | null;
  is_active: boolean;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

// v2.1 — Discount Templates (FB-003B)
export interface DiscountTemplate {
  id: string;
  merchant_id: string;
  name: string;
  percentage: number;
  is_active: boolean;
  created_at: string;
}

// v2.1 — Paid onboarding session
export interface OnboardingSession {
  id: string;
  email: string;
  business_name: string;
  plan: "individual" | "corporate";
  status: "awaiting_payment" | "payment_confirmed" | "activated" | "expired";
  paystack_ref: string | null;
  amount_paid: number | null;
  merchant_id: string | null;
  expires_at: string;
  created_at: string;
  idempotency_key: string | null;
}

// v2.1 — Admin-configurable platform settings
export interface PlatformSetting {
  key: string;
  value: string;
  updated_by: string | null;
  updated_at: string;
}

// v2.1 — Payment processor webhook event log
export interface PaymentEvent {
  id: string;
  merchant_id: string;
  invoice_id: string | null;
  transaction_id: string | null;
  event_type: string;
  processor: string;
  processor_ref: string | null;
  amount_kobo: number | null;
  raw_payload: Record<string, unknown> | null;
  processed_at: string;
  idempotency_key: string | null;
}

// ── Joined types for UI convenience ──────────────────────────────────────────

export interface InvoiceWithClient extends Invoice {
  clients: Pick<Client, "full_name" | "email" | "phone" | "company_name" | "address"> | null;
}

export interface InvoiceWithLineItems extends Invoice {
  line_items: LineItem[];
  clients: Pick<Client, "full_name" | "email" | "phone" | "company_name" | "address"> | null;
}

export interface InvoiceWithPayments extends InvoiceWithLineItems {
  manual_payments?: ManualPayment[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const MANUAL_CLOSE_REASONS = [
  "Settlement Discount",
  "Bad Debt Write-Off",
  "Goodwill Adjustment",
  "Duplicate Invoice",
  "Client Agreement — Paid in Full",
  "Other",
] as const;

export const SUBSCRIPTION_PLANS = {
  starter: {
    label: "Starter",
    price: 0,
    invoiceLimit: 5,
    clientLimit: 10,
    teamLimit: 0,
    canCollect: false,
    canUsePurpBot: false,
    canUseAnalytics: false,
  },
  individual: {
    label: "Individual",
    price: 5000,
    invoiceLimit: Infinity,
    clientLimit: Infinity,
    teamLimit: 2,
    canCollect: true, // requires BVN verification
    canUsePurpBot: true,
    canUseAnalytics: true,
  },
  corporate: {
    label: "Corporate",
    price: 20000,
    invoiceLimit: Infinity,
    clientLimit: Infinity,
    teamLimit: Infinity,
    canCollect: true, // requires all docs verified
    canUsePurpBot: true,
    canUseAnalytics: true,
  },
} as const;

export const PAYMENT_METHODS_RECORD = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
] as const;
