import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendSubscriptionExpiringEmail } from "@/lib/brevo";

// Initialize Supabase with service role for background cron task
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  // Validate standard Vercel Cron header if needed
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const now = new Date();
  console.log(`Starting Subscription Cron Job at ${now.toISOString()}`);

  try {
    // 1. Find and update EXPIRED subscriptions
    const { data: expiredSubs, error: expiredError } = await supabase
      .from("subscriptions")
      .update({ status: "expired" })
      .lt("expiry_date", now.toISOString())
      .eq("status", "active")
      .select("merchant_id");

    if (expiredError) {
      console.error("Error updating expired subscriptions:", expiredError);
    } else if (expiredSubs && expiredSubs.length > 0) {
      console.log(`Marked ${expiredSubs.length} subscriptions as expired.`);
    }

    // 2. Find subscriptions expiring in exactly 7 days
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const eightDaysFromNow = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    
    // We also want to ensure we haven't already notified them recently (last 24h)
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const { data: expiringSubs, error: expiringError } = await supabase
      .from("subscriptions")
      .select("id, plan_type, expiry_date, merchants(email, business_name)")
      .eq("status", "active")
      .gte("expiry_date", sevenDaysFromNow.toISOString())
      .lt("expiry_date", eightDaysFromNow.toISOString())
      .or(`last_notified_at.is.null,last_notified_at.lt.${twentyFourHoursAgo.toISOString()}`);

    if (expiringError) {
      console.error("Error fetching expiring subscriptions:", expiringError);
    } else if (expiringSubs && expiringSubs.length > 0) {
      console.log(`Found ${expiringSubs.length} subscriptions expiring in ~7 days.`);

      // Send T-7 emails
      for (const sub of expiringSubs) {
        const merchantData = Array.isArray(sub.merchants) ? sub.merchants[0] : sub.merchants;
        if (!merchantData?.email) continue;
        
        try {
          await sendSubscriptionExpiringEmail(
            merchantData.email,
            merchantData.business_name,
            sub.plan_type,
            sub.expiry_date,
            7
          );

          // Update last_notified_at
          await supabase
            .from("subscriptions")
            .update({ last_notified_at: now.toISOString() })
            .eq("id", sub.id);
            
          console.log(`Sent T-7 warning to ${merchantData.email}`);
        } catch (emailErr) {
          console.error(`Failed to send email to ${merchantData.email}:`, emailErr);
        }
      }
    }

    return NextResponse.json({
      success: true,
      expiredProcessed: expiredSubs?.length || 0,
      warningsSent: expiringSubs?.length || 0
    });
  } catch (err: any) {
    console.error("Subscription Cron Failed:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
