import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { 
  sendSubscriptionExpiringEmail, 
  sendSubscriptionExpiredEmail, 
  sendSubscriptionGraceEmail 
} from "@/lib/brevo";

// Initialize Supabase with service role for background cron task
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
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
    // We only care about non-cancelled subscriptions
    const { data: subs, error } = await supabase
      .from("subscriptions")
      .select("id, merchant_id, plan_type, expiry_date, status, merchants(email, business_name, subscription_notifications_sent)")
      .neq("status", "cancelled");

    if (error) throw error;

    let processed = {
      t7: 0,
      t3: 0,
      expired: 0,
      locked: 0,
      grace: 0
    };

    for (const sub of subs || []) {
      const merchantData = Array.isArray(sub.merchants) ? sub.merchants[0] : sub.merchants;
      if (!merchantData?.email || sub.plan_type === "starter") continue;

      const expiryDate = new Date(sub.expiry_date);
      const days = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      const notificationsSent = merchantData.subscription_notifications_sent || {};
      
      // Check thresholds
      if (days <= 7 && days > 3 && !notificationsSent['7_day']) {
        await sendSubscriptionExpiringEmail(
          merchantData.email,
          merchantData.business_name,
          sub.plan_type,
          sub.expiry_date,
          7
        );
        
        await supabase.from("merchants").update({
          subscription_notifications_sent: { ...notificationsSent, '7_day': now.toISOString() }
        }).eq("id", sub.merchant_id);
        
        await supabase.from("subscriptions").update({ status: "expiring_soon" }).eq("id", sub.id);
        
        processed.t7++;
        console.log(`Sent T-7 warning to ${merchantData.email}`);
      }
      
      if (days <= 3 && days > 0 && !notificationsSent['3_day']) {
        await sendSubscriptionExpiringEmail(
          merchantData.email,
          merchantData.business_name,
          sub.plan_type,
          sub.expiry_date,
          days
        );
        
        await supabase.from("merchants").update({
          subscription_notifications_sent: { ...notificationsSent, '3_day': now.toISOString() }
        }).eq("id", sub.merchant_id);
        
        processed.t3++;
        console.log(`Sent T-${days} warning to ${merchantData.email}`);
      }
      
      if (days <= 0 && days > -3 && sub.status !== "grace_period") {
        await sendSubscriptionExpiredEmail(
          merchantData.email,
          merchantData.business_name,
          sub.plan_type
        );
        
        await supabase.from("subscriptions").update({ status: "grace_period" }).eq("id", sub.id);
        
        processed.expired++;
        console.log(`Marked as Grace Period and sent Expired Notice to ${merchantData.email}`);
      } else if (days <= 0 && days > -3 && sub.status === "grace_period") {
        // Send daily grace period warning
        const lastNotifiedStr = notificationsSent[`grace_day_${Math.abs(days)}`];
        if (!lastNotifiedStr) {
           await sendSubscriptionGraceEmail(
             merchantData.email,
             merchantData.business_name,
             3 + days // 0 -> 3, -1 -> 2, -2 -> 1
           );
           await supabase.from("merchants").update({
             subscription_notifications_sent: { ...notificationsSent, [`grace_day_${Math.abs(days)}`]: now.toISOString() }
           }).eq("id", sub.merchant_id);
           processed.grace++;
        }
      }
      
      if (days <= -3 && sub.status !== "expired") {
        await supabase.from("subscriptions").update({ status: "expired" }).eq("id", sub.id);
        
        processed.locked++;
        console.log(`Marked as Expired (Locked) for ${merchantData.email}`);
      }
    }

    return NextResponse.json({
      success: true,
      processed
    });
  } catch (err: any) {
    console.error("Subscription Cron Failed:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
