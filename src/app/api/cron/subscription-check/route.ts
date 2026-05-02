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
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // 1. Process EXPIRED (Day 0)
    // Find subscriptions that just expired
    const { data: newlyExpired, error: expiredError } = await supabase
      .from("subscriptions")
      .select("id, plan_type, expiry_date, merchants(email, business_name)")
      .lt("expiry_date", now.toISOString())
      .eq("status", "active");

    let expiredProcessed = 0;
    if (expiredError) {
      console.error("Error fetching expired subscriptions:", expiredError);
    } else if (newlyExpired && newlyExpired.length > 0) {
      console.log(`Found ${newlyExpired.length} subscriptions that have expired.`);
      
      for (const sub of newlyExpired) {
        // Update status to expired
        await supabase
          .from("subscriptions")
          .update({ 
            status: "expired",
            last_notified_at: now.toISOString()
          })
          .eq("id", sub.id);

        expiredProcessed++;
        
        const merchantData = Array.isArray(sub.merchants) ? sub.merchants[0] : sub.merchants;
        if (!merchantData?.email) continue;
        
        try {
          await sendSubscriptionExpiredEmail(
            merchantData.email,
            merchantData.business_name,
            sub.plan_type
          );
          console.log(`Sent Expired Notice to ${merchantData.email}`);
        } catch (emailErr) {
          console.error(`Failed to send email to ${merchantData.email}:`, emailErr);
        }
      }
    }

    // 2. Process GRACE PERIOD (Days 1 to 3 after expiry)
    // We send a daily grace period warning.
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const { data: graceSubs, error: graceError } = await supabase
      .from("subscriptions")
      .select("id, expiry_date, merchants(email, business_name)")
      .eq("status", "expired")
      .gte("expiry_date", threeDaysAgo.toISOString())
      .or(`last_notified_at.is.null,last_notified_at.lt.${twentyFourHoursAgo.toISOString()}`);

    let graceWarningsSent = 0;
    if (graceError) {
      console.error("Error fetching grace period subscriptions:", graceError);
    } else if (graceSubs && graceSubs.length > 0) {
      console.log(`Found ${graceSubs.length} subscriptions in grace period.`);
      
      for (const sub of graceSubs) {
        const expiryDate = new Date(sub.expiry_date);
        // Calculate days since expiry (1, 2, or 3)
        const daysSinceExpiry = Math.floor((now.getTime() - expiryDate.getTime()) / (1000 * 60 * 60 * 24));
        const daysRemainingBeforeLock = 4 - daysSinceExpiry; // Lock happens on day 4
        
        if (daysRemainingBeforeLock > 0 && daysRemainingBeforeLock <= 3) {
          const merchantData = Array.isArray(sub.merchants) ? sub.merchants[0] : sub.merchants;
          if (!merchantData?.email) continue;
          
          try {
            await sendSubscriptionGraceEmail(
              merchantData.email,
              merchantData.business_name,
              daysRemainingBeforeLock
            );

            await supabase
              .from("subscriptions")
              .update({ last_notified_at: now.toISOString() })
              .eq("id", sub.id);
              
            graceWarningsSent++;
            console.log(`Sent Grace Warning to ${merchantData.email}`);
          } catch (emailErr) {
            console.error(`Failed to send email to ${merchantData.email}:`, emailErr);
          }
        }
      }
    }

    // 3. Process UPCOMING (T-7 and T-3)
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const eightDaysFromNow = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const fourDaysFromNow = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);

    const { data: upcomingSubs, error: upcomingError } = await supabase
      .from("subscriptions")
      .select("id, plan_type, expiry_date, merchants(email, business_name)")
      .eq("status", "active")
      .or(`last_notified_at.is.null,last_notified_at.lt.${twentyFourHoursAgo.toISOString()}`);

    let upcomingWarningsSent = 0;
    if (upcomingError) {
      console.error("Error fetching upcoming subscriptions:", upcomingError);
    } else if (upcomingSubs && upcomingSubs.length > 0) {
      for (const sub of upcomingSubs) {
        const expiryDate = new Date(sub.expiry_date);
        
        let targetDays = 0;
        if (expiryDate >= sevenDaysFromNow && expiryDate < eightDaysFromNow) {
          targetDays = 7;
        } else if (expiryDate >= threeDaysFromNow && expiryDate < fourDaysFromNow) {
          targetDays = 3;
        }

        if (targetDays > 0) {
          const merchantData = Array.isArray(sub.merchants) ? sub.merchants[0] : sub.merchants;
          if (!merchantData?.email) continue;
          
          try {
            await sendSubscriptionExpiringEmail(
              merchantData.email,
              merchantData.business_name,
              sub.plan_type,
              sub.expiry_date,
              targetDays
            );

            await supabase
              .from("subscriptions")
              .update({ last_notified_at: now.toISOString() })
              .eq("id", sub.id);
              
            upcomingWarningsSent++;
            console.log(`Sent T-${targetDays} warning to ${merchantData.email}`);
          } catch (emailErr) {
            console.error(`Failed to send email to ${merchantData.email}:`, emailErr);
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      expiredProcessed,
      graceWarningsSent,
      upcomingWarningsSent
    });
  } catch (err: any) {
    console.error("Subscription Cron Failed:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
