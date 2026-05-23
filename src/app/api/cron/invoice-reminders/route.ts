import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  sendInvoiceReminderEmail,
  sendRecordReminderEmail,
} from "@/lib/brevo";
import { sendWhatsAppTemplate } from "@/lib/wati";
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
    // Fetch all open/partially_paid/expired invoices with full client + merchant context.
    // We select reminder_enabled, reminder_channels, whatsapp_number from clients.
    // Only process invoices where the client has reminder_enabled = true.
    const { data: invoices, error } = await supabase
      .from("invoices")
      .select(`
        *,
        clients!inner(
          id,
          full_name,
          email,
          phone,
          whatsapp_number,
          reminder_enabled,
          reminder_channels
        ),
        merchants!inner(
          id,
          business_name,
          email,
          phone
        )
      `)
      .in("status", ["open", "partially_paid", "expired"]);

    if (error) throw error;

    let emailsSent = 0;
    let whatsappSent = 0;
    let skipped = 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const appUrl = getAppUrl();

    for (const invoice of invoices) {
      const client = invoice.clients;
      const merchant = invoice.merchants;

      // ── Skip if merchant has disabled reminders for this client ──────────
      if (!client?.reminder_enabled) {
        skipped++;
        continue;
      }

      // ── Determine the due date field based on invoice type ────────────────
      // Collection invoices use pay_by_date; Record invoices use the same column
      const dueDateStr = invoice.pay_by_date;
      if (!dueDateStr) {
        skipped++;
        continue;
      }

      const createdDate = new Date(invoice.created_at);
      createdDate.setHours(0, 0, 0, 0);
      const dueDate = new Date(dueDateStr);
      dueDate.setHours(0, 0, 0, 0);

      const daysSinceCreated = Math.floor(
        (today.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      const daysUntilDue = Math.floor(
        (dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );

      // ── Determine reminder type for this invoice ──────────────────────────
      let reminderType: "standard" | "urgent" | "overdue" | null = null;

      if (daysUntilDue < 0) {
        // Overdue: fire every 5 days
        const daysOverdue = Math.abs(daysUntilDue);
        if (daysOverdue % 5 === 0) reminderType = "overdue";
      } else if (daysUntilDue <= 3) {
        // Due within 3 days: fire daily
        reminderType = "urgent";
      } else if (daysSinceCreated > 0 && daysSinceCreated % 4 === 0) {
        // Standard open: fire every 4 days
        reminderType = "standard";
      }

      if (!reminderType) {
        skipped++;
        continue;
      }

      const amountDue = `₦${Number(invoice.outstanding_balance).toLocaleString("en-NG")}`;
      const formattedDueDate = dueDate.toLocaleDateString("en-NG", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });

      const channels: string[] = client.reminder_channels ?? [];

      // ── EMAIL channel ─────────────────────────────────────────────────────
      if (channels.includes("email") && client.email) {
        if (invoice.invoice_type === "record") {
          // Record Invoice: NO payment link — use the record reminder template
          await sendRecordReminderEmail(
            client.email,
            client.full_name,
            invoice.invoice_number,
            merchant.business_name,
            merchant.email,
            merchant.phone || null,
            amountDue,
            formattedDueDate,
            reminderType
          ).catch((e: unknown) => console.error(`Record email failed ${invoice.id}:`, e));
        } else {
          // Collection Invoice: include Pay Now link
          const payLink = `${appUrl}/pay/${invoice.id}`;
          await sendInvoiceReminderEmail(
            client.email,
            client.full_name,
            invoice.invoice_number,
            merchant.business_name,
            amountDue,
            formattedDueDate,
            reminderType,
            payLink
          ).catch((e: unknown) => console.error(`Collection email failed ${invoice.id}:`, e));
        }
        emailsSent++;
      } else if (channels.includes("email") && !client.email) {
        console.warn(
          `[Reminders] Invoice ${invoice.id}: email channel enabled but client has no email — skipping email.`
        );
      }

      // ── WHATSAPP channel ──────────────────────────────────────────────────
      if (channels.includes("whatsapp") && client.whatsapp_number) {
        const templateName =
          invoice.invoice_type === "record"
            ? "RECORD_REMINDER_WA"
            : "COLLECTION_REMINDER_WA";

        const params = [
          { name: "client_name", value: client.full_name },
          { name: "business_name", value: merchant.business_name },
          { name: "invoice_number", value: invoice.invoice_number },
          { name: "amount_due", value: amountDue },
          { name: "due_date", value: formattedDueDate },
        ];

        // For Collection invoices add payment link param
        if (invoice.invoice_type === "collection") {
          params.push({ name: "payment_link", value: `${appUrl}/pay/${invoice.id}` });
        } else {
          // Record Invoice: merchant contact instead of payment link
          params.push({
            name: "merchant_contact",
            value: merchant.email + (merchant.phone ? ` / ${merchant.phone}` : ""),
          });
        }

        await sendWhatsAppTemplate(client.whatsapp_number, templateName, params).catch(
          (e: unknown) => console.error(`WhatsApp failed ${invoice.id}:`, e)
        );
        whatsappSent++;
      } else if (channels.includes("whatsapp") && !client.whatsapp_number) {
        console.warn(
          `[Reminders] Invoice ${invoice.id}: whatsapp channel enabled but client has no whatsapp_number — skipping WhatsApp.`
        );
      }
    }

    return NextResponse.json({
      success: true,
      processed: invoices.length,
      emailsSent,
      whatsappSent,
      skipped,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown cron error";
    console.error("Cron invoice-reminders error:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
