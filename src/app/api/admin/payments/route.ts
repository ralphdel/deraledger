import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireAdminPortalSession } from "@/lib/admin-portal-auth";
import { getPaymentEnvironment } from "@/lib/services/payment-routing.service";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = "force-dynamic";

type PaginationParams = {
  page: number;
  pageSize: number;
};

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

export async function GET(request: Request) {
  const guard = await requireAdminPortalSession();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const url = new URL(request.url);
  const recordsPagination = getPaginationParams(url, "records");
  const eventsPagination = getPaginationParams(url, "events");
  const transactionsPagination = getPaginationParams(url, "transactions");
  const environment = getPaymentEnvironment();
  const [providersRes, routesRes, methodsRes, eventsRes, recordsRes, transactionsRes] = await Promise.all([
    supabase.from("payment_providers").select("*").order("environment").order("provider_name"),
    supabase.from("payment_provider_routes").select("*").order("environment").order("payment_purpose"),
    supabase.from("payment_method_configs").select("*").order("environment").order("payment_purpose"),
    fetchRecentPaymentEvents(eventsPagination),
    fetchRecentPaymentRecords(recordsPagination),
    fetchRecentPaymentTransactions(transactionsPagination),
  ]);

  if (providersRes.error || routesRes.error || methodsRes.error) {
    return NextResponse.json(
      { error: providersRes.error?.message || routesRes.error?.message || methodsRes.error?.message },
      { status: 500 }
    );
  }

  const providers = providersRes.data || [];
  const routes = routesRes.data || [];
  const methods = methodsRes.data || [];

  return NextResponse.json({
    environment,
    summary: {
      activeProviders: providers.filter((row) => row.status === "active").length,
      activeRoutes: routes.filter((row) => row.is_enabled).length,
      activeMethods: methods.filter((row) => row.is_enabled).length,
    },
    providers,
    routes,
    methods,
    events: eventsRes.data || [],
    paymentRecords: recordsRes.data || [],
    transactions: transactionsRes.data || [],
    pagination: {
      events: eventsRes.pagination,
      paymentRecords: recordsRes.pagination,
      transactions: transactionsRes.pagination,
    },
    diagnostics: {
      eventsError: eventsRes.error || null,
      eventsWarning: eventsRes.warning || null,
      paymentRecordsError: recordsRes.error || null,
      paymentRecordsWarning: recordsRes.warning || null,
      transactionsError: transactionsRes.error || null,
    },
  }, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function getPaginationParams(url: URL, prefix: string): PaginationParams {
  const page = Number(url.searchParams.get(`${prefix}Page`) || 1);
  const pageSize = Number(url.searchParams.get(`${prefix}PageSize`) || DEFAULT_PAGE_SIZE);

  return {
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
    pageSize:
      Number.isFinite(pageSize) && pageSize > 0
        ? Math.min(Math.floor(pageSize), MAX_PAGE_SIZE)
        : DEFAULT_PAGE_SIZE,
  };
}

function rangeFor({ page, pageSize }: PaginationParams) {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

function paginationMeta(params: PaginationParams, count: number | null) {
  const total = count || 0;
  return {
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
  };
}

async function fetchRecentPaymentRecords(params: PaginationParams) {
  const { from, to } = rangeFor(params);
  const withCreatedAt = await supabase
    .from("payment_records")
    .select("id, created_at, updated_at, provider_name, payment_method, payment_purpose, internal_reference, provider_reference, expected_amount, amount_paid, currency, payment_status, processing_status, account_setup_status, password_setup_required, customer_email, merchant_id, user_id, business_id, plan_id, plan_name, setup_recovery_email_sent_at, setup_recovery_email_count, setup_completed_at, reconciliation_status, failure_reason, raw_provider_payload", { count: "exact" })
    .in("payment_purpose", ["plan_subscription", "plan_upgrade", "plan_renewal"])
    .order("created_at", { ascending: false })
    .range(from, to);

  if (!withCreatedAt.error) {
    return { data: withCreatedAt.data || [], error: null, warning: null, pagination: paginationMeta(params, withCreatedAt.count) };
  }

  const message = withCreatedAt.error.message;
  if (!message.includes("created_at")) {
    return { data: [], error: message, warning: null, pagination: paginationMeta(params, 0) };
  }

  const fallback = await supabase
    .from("payment_records")
    .select("id, provider_name, payment_method, payment_purpose, internal_reference, provider_reference, expected_amount, amount_paid, currency, payment_status, processing_status, account_setup_status, password_setup_required, customer_email, merchant_id, user_id, business_id, plan_id, plan_name, setup_recovery_email_sent_at, setup_recovery_email_count, setup_completed_at, reconciliation_status, failure_reason, raw_provider_payload", { count: "exact" })
    .in("payment_purpose", ["plan_subscription", "plan_upgrade", "plan_renewal"])
    .range(from, to);

  if (fallback.error) {
    return { data: [], error: fallback.error.message, warning: message, pagination: paginationMeta(params, 0) };
  }

  return {
    data: (fallback.data || []).map((record) => ({ ...record, created_at: null, updated_at: null })),
    error: null,
    warning: "payment_records.created_at is missing. Recent subscription recovery records cannot be sorted by time.",
    pagination: paginationMeta(params, fallback.count),
  };
}

async function fetchRecentPaymentEvents(params: PaginationParams) {
  const { from, to } = rangeFor(params);
  const withCreatedAt = await supabase
    .from("payment_events")
    .select("id, created_at, event_type, processor, processor_ref, amount_kobo, merchant_id, invoice_id, raw_payload, payment_method, payment_purpose, payment_reference, provider_reference, expected_amount, paid_amount, currency, fee, plan_id, customer_email, processing_status, failure_reason, reconciliation_status", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (!withCreatedAt.error) {
    return { data: withCreatedAt.data || [], error: null, warning: null, pagination: paginationMeta(params, withCreatedAt.count) };
  }

  const message = withCreatedAt.error.message;
  if (!message.includes("created_at")) {
    return { data: [], error: message, warning: null, pagination: paginationMeta(params, 0) };
  }

  const fallback = await supabase
    .from("payment_events")
    .select("id, event_type, processor, processor_ref, amount_kobo, merchant_id, invoice_id, raw_payload, payment_method, payment_purpose, payment_reference, provider_reference, expected_amount, paid_amount, currency, fee, plan_id, customer_email, processing_status, failure_reason, reconciliation_status", { count: "exact" })
    .range(from, to);

  if (fallback.error) {
    return { data: [], error: fallback.error.message, warning: message, pagination: paginationMeta(params, 0) };
  }

  return {
    data: (fallback.data || []).map((event) => ({ ...event, created_at: null })),
    error: null,
    warning: "payment_events.created_at is missing. Run the payment events timestamp migration to sort provider events by time.",
    pagination: paginationMeta(params, fallback.count),
  };
}

async function fetchRecentPaymentTransactions(params: PaginationParams) {
  const { from, to } = rangeFor(params);
  const result = await supabase
    .from("transactions")
    .select("id, created_at, invoice_id, merchant_id, amount_paid, payment_method, status, paystack_reference", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (result.error) {
    return { data: [], error: result.error.message, pagination: paginationMeta(params, 0) };
  }

  return { data: result.data || [], error: null, pagination: paginationMeta(params, result.count) };
}

export async function POST(request: Request) {
  const guard = await requireAdminPortalSession();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        providers?: Record<string, unknown>[];
        routes?: Record<string, unknown>[];
        methods?: Record<string, unknown>[];
      }
    | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (body.providers?.length) {
    for (const provider of body.providers) {
      const row = sanitizeProvider(provider);
      if (!row) continue;
      const { error } = await supabase
        .from("payment_providers")
        .update(row.updates)
        .eq("provider_name", row.provider_name)
        .eq("environment", row.environment);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
  }

  if (body.routes?.length) {
    for (const route of body.routes) {
      const row = sanitizeRoute(route);
      if (!row) continue;
      const { error } = await supabase
        .from("payment_provider_routes")
        .update(row.updates)
        .eq("payment_purpose", row.payment_purpose)
        .eq("payment_method", row.payment_method)
        .eq("environment", row.environment);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
  }

  if (body.methods?.length) {
    for (const method of body.methods) {
      const row = sanitizeMethod(method);
      if (!row) continue;
      const { error } = await supabase
        .from("payment_method_configs")
        .update(row.updates)
        .eq("payment_purpose", row.payment_purpose)
        .eq("payment_method", row.payment_method)
        .eq("environment", row.environment);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ success: true });
}

function sanitizeProvider(row: Record<string, unknown>) {
  const provider_name = row.provider_name;
  const environment = row.environment;
  if (!isProvider(provider_name) || !isEnvironment(environment)) return null;

  return {
    provider_name,
    environment,
    updates: {
      status: row.status,
      allow_degraded_routing: Boolean(row.allow_degraded_routing),
      supports_card: Boolean(row.supports_card),
      supports_bank_transfer: Boolean(row.supports_bank_transfer),
      supports_ussd: Boolean(row.supports_ussd),
      supports_crypto: Boolean(row.supports_crypto),
      updated_at: new Date().toISOString(),
    },
  };
}

function sanitizeRoute(row: Record<string, unknown>) {
  const payment_purpose = row.payment_purpose;
  const payment_method = row.payment_method;
  const environment = row.environment;
  if (!isPurpose(payment_purpose) || !isMethod(payment_method) || !isEnvironment(environment)) return null;
  if (!isProvider(row.primary_provider)) return null;

  return {
    payment_purpose,
    payment_method,
    environment,
    updates: {
      primary_provider: row.primary_provider,
      fallback_provider: isProvider(row.fallback_provider) ? row.fallback_provider : null,
      is_enabled: Boolean(row.is_enabled),
      updated_at: new Date().toISOString(),
    },
  };
}

function sanitizeMethod(row: Record<string, unknown>) {
  const payment_purpose = row.payment_purpose;
  const payment_method = row.payment_method;
  const environment = row.environment;
  if (!isPurpose(payment_purpose) || !isMethod(payment_method) || !isEnvironment(environment)) return null;

  return {
    payment_purpose,
    payment_method,
    environment,
    updates: {
      is_enabled: Boolean(row.is_enabled),
      display_label: String(row.display_label || payment_method),
      display_description: row.display_description ? String(row.display_description) : null,
      updated_at: new Date().toISOString(),
    },
  };
}

function isProvider(value: unknown): value is "paystack" | "monnify" | "breet" {
  return value === "paystack" || value === "monnify" || value === "breet";
}

function isEnvironment(value: unknown): value is "sandbox" | "live" {
  return value === "sandbox" || value === "live";
}

function isPurpose(value: unknown): value is string {
  return (
    value === "plan_subscription" ||
    value === "plan_upgrade" ||
    value === "plan_renewal" ||
    value === "invoice_payment" ||
    value === "payment_link" ||
    value === "crypto_payment"
  );
}

function isMethod(value: unknown): value is string {
  return value === "card" || value === "bank_transfer" || value === "ussd" || value === "crypto";
}
