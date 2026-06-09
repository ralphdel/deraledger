import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendMonthlyReportEmail, type MonthlyReportData } from "@/lib/brevo";
import { getAppUrl } from "@/lib/server-utils";

// Service role client — bypasses RLS for cron jobs
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  // Validate Vercel Cron Secret
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  try {
    const now = new Date();

    // Report covers the previous calendar month
    const reportYear  = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const reportMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1; // 0-indexed

    const periodStart = new Date(reportYear, reportMonth, 1).toISOString();
    const periodEnd   = new Date(reportYear, reportMonth + 1, 1).toISOString();

    const monthLabel = new Date(reportYear, reportMonth, 1).toLocaleDateString("en-NG", {
      month: "long",
      year: "numeric",
    });

    const appUrl = getAppUrl();

    // ── 1. Fetch all active Individual + Corporate merchants ──────────────────
    const { data: merchants, error: merchantErr } = await supabase
      .from("merchants")
      .select("id, email, business_name, trading_name, subscription_plan, merchant_tier")
      .in("subscription_plan", ["individual", "corporate"])
      .neq("verification_status", "suspended");

    if (merchantErr || !merchants) {
      throw new Error(merchantErr?.message || "Failed to fetch merchants");
    }

    let sent = 0;
    let failed = 0;

    for (const merchant of merchants) {
      try {
        const merchantId = merchant.id;
        const businessName = merchant.trading_name || merchant.business_name || "Your Business";

        // ── 2. Invoice summary for the previous month ─────────────────────────
        const { data: invoices } = await supabase
          .from("invoices")
          .select("id, invoice_type, status, grand_total, amount_paid, outstanding_balance, pay_by_date, created_at, client_id")
          .eq("merchant_id", merchantId)
          .gte("created_at", periodStart)
          .lt("created_at", periodEnd);

        const inv = invoices || [];

        const collInv  = inv.filter(i => i.invoice_type === "collection");
        const recInv   = inv.filter(i => i.invoice_type === "record");

        const sumField = (arr: typeof inv, field: "grand_total" | "amount_paid" | "outstanding_balance") =>
          arr.reduce((s, i) => s + Number(i[field] || 0), 0);

        const openCollection   = collInv.filter(i => ["open", "partially_paid"].includes(i.status)).length;
        const closedCollection = collInv.filter(i => ["closed", "manually_closed"].includes(i.status)).length;
        const openRecord       = recInv.filter(i => ["open", "partially_paid"].includes(i.status)).length;
        const closedRecord     = recInv.filter(i => ["closed", "manually_closed"].includes(i.status)).length;

        const totalInvoicedCollection = sumField(collInv, "grand_total");
        const totalCollected          = sumField(collInv, "amount_paid");
        const outstandingCollection   = sumField(collInv.filter(i => !["closed", "manually_closed", "void"].includes(i.status)), "outstanding_balance");

        const totalInvoicedRecord   = sumField(recInv, "grand_total");
        const totalReceivedOffline  = sumField(recInv, "amount_paid");
        const outstandingRecord     = sumField(recInv.filter(i => !["closed", "manually_closed", "void"].includes(i.status)), "outstanding_balance");

        const totalOutstanding = outstandingCollection + outstandingRecord;

        // ── 3. New clients this month ─────────────────────────────────────────
        const { count: newClients } = await supabase
          .from("clients")
          .select("*", { count: "exact", head: true })
          .eq("merchant_id", merchantId)
          .gte("created_at", periodStart)
          .lt("created_at", periodEnd);

        // ── 4. Top 3 clients owing (all-time outstanding, not just last month) ─
        const { data: allOpenInv } = await supabase
          .from("invoices")
          .select("client_id, outstanding_balance, clients!inner(id, full_name)")
          .eq("merchant_id", merchantId)
          .in("status", ["open", "partially_paid"])
          .gt("outstanding_balance", 0);

        // Aggregate by client
        const clientOwing: Record<string, { name: string; outstanding: number }> = {};
        for (const row of allOpenInv || []) {
          const client = (row.clients as unknown) as { id: string; full_name: string } | null;
          if (!client) continue;
          if (!clientOwing[client.id]) {
            clientOwing[client.id] = { name: client.full_name, outstanding: 0 };
          }
          clientOwing[client.id].outstanding += Number(row.outstanding_balance || 0);
        }

        const topClients = Object.values(clientOwing)
          .sort((a, b) => b.outstanding - a.outstanding)
          .slice(0, 3);

        // ── 5. Aging buckets (overdue invoices across all time) ───────────────
        const { data: overdueInv } = await supabase
          .from("invoices")
          .select("outstanding_balance, pay_by_date")
          .eq("merchant_id", merchantId)
          .in("status", ["open", "partially_paid"])
          .lt("pay_by_date", new Date().toISOString().split("T")[0])
          .gt("outstanding_balance", 0);

        let aging0to30   = 0;
        let aging31to60  = 0;
        let aging60plus  = 0;

        const todayMs = Date.now();
        for (const row of overdueInv || []) {
          if (!row.pay_by_date) continue;
          const daysOverdue = Math.floor((todayMs - new Date(row.pay_by_date).getTime()) / 86_400_000);
          const amt = Number(row.outstanding_balance || 0);
          if (daysOverdue <= 30)       aging0to30  += amt;
          else if (daysOverdue <= 60)  aging31to60 += amt;
          else                         aging60plus  += amt;
        }

        // ── 6. Send email ─────────────────────────────────────────────────────
        const reportData: MonthlyReportData = {
          businessName,
          merchantEmail: merchant.email,
          month: monthLabel,
          analyticsUrl: `${appUrl}/accounting-report`,

          openCollection,
          closedCollection,
          totalInvoicedCollection,
          totalCollected,
          outstandingCollection,

          openRecord,
          closedRecord,
          totalInvoicedRecord,
          totalReceivedOffline,
          outstandingRecord,

          totalOutstanding,
          newClientsThisMonth: newClients ?? 0,
          topClients,

          aging0to30,
          aging31to60,
          aging60plus,
        };

        await sendMonthlyReportEmail(reportData);

        // ── 7. Audit log ──────────────────────────────────────────────────────
        await supabase.from("audit_logs").insert({
          event_type: "monthly_report_sent",
          actor_id: merchantId,
          actor_role: "system",
          target_id: merchantId,
          target_type: "merchant",
          metadata: { month: monthLabel, reportYear, reportMonth },
        });

        sent++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[monthly-reports] Failed for merchant ${merchant.id}:`, msg);
        failed++;
      }
    }

    return NextResponse.json({
      success: true,
      month: monthLabel,
      merchantsProcessed: merchants.length,
      sent,
      failed,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown cron error";
    console.error("Cron monthly-reports error:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
