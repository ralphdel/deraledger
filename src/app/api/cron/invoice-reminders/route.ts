import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendInvoiceReminderEmail } from "@/lib/brevo";

// Create a service role client to bypass RLS for cron jobs
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  // Validate Vercel Cron Secret
  // Only enforce auth if CRON_SECRET is actually configured.
  // This allows browser-based testing in dev (no secret set = open access).
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return new NextResponse("Unauthorized — set Authorization: Bearer <CRON_SECRET>", { status: 401 });
    }
  }

  try {
    // 1. Fetch all open/partially_paid or expired invoices with client and merchant details
    const { data: invoices, error } = await supabase
      .from("invoices")
      .select(`
        *,
        clients!inner(full_name, email),
        merchants!inner(business_name)
      `)
      .in("status", ["open", "partially_paid", "expired"]);

    if (error) throw error;

    let emailsSent = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of day

    for (const invoice of invoices) {
      if (!invoice.clients?.email || !invoice.pay_by_date) continue;

      const createdDate = new Date(invoice.created_at);
      createdDate.setHours(0, 0, 0, 0);

      const dueDate = new Date(invoice.pay_by_date);
      dueDate.setHours(0, 0, 0, 0);

      const daysSinceCreated = Math.floor((today.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
      const daysUntilDue = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      
      let reminderType: "standard" | "urgent" | "overdue" | null = null;

      if (daysUntilDue < 0) {
        // RULE 3: After deadline, email every 5 days
        const daysOverdue = Math.abs(daysUntilDue);
        if (daysOverdue % 5 === 0) {
          reminderType = "overdue";
        }
      } else if (daysUntilDue <= 3 && daysUntilDue >= 0) {
        // RULE 2: 3 days to deadline, email everyday
        reminderType = "urgent";
      } else {
        // RULE 1: Standard open invoice, email every 4 days
        if (daysSinceCreated > 0 && daysSinceCreated % 4 === 0) {
          reminderType = "standard";
        }
      }

      if (reminderType) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://purpledger.vercel.app";
        const payLink = `${appUrl}/pay/${invoice.id}`;
        const amountDue = `₦${Number(invoice.outstanding_balance).toLocaleString()}`;
        const formattedDueDate = dueDate.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });

        await sendInvoiceReminderEmail(
          invoice.clients.email,
          invoice.clients.full_name,
          invoice.invoice_number,
          invoice.merchants.business_name,
          amountDue,
          formattedDueDate,
          reminderType,
          payLink
        );
        emailsSent++;
      }
    }

    return NextResponse.json({ success: true, emailsSent });
  } catch (err: any) {
    console.error("Cron Error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
