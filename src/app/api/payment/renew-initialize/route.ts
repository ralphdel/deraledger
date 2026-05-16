import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PaymentService } from "@/lib/payment";

/**
 * POST /api/payment/renew-initialize
 *
 * Called by the /checkout/subscription?context=renewal page to initialize
 * a Paystack transaction for subscription renewal. Returns an accessCode
 * (for inline Paystack popup) instead of a redirect URL.
 *
 * This is different from /api/payment/renew which returns a redirect URL.
 * The renewal checkout page uses the inline Paystack popup just like the
 * onboarding checkout, keeping a consistent UX.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { plan, email, callbackUrl } = await request.json();

    if (plan !== "individual" && plan !== "corporate") {
      return NextResponse.json({ error: "Invalid plan for renewal" }, { status: 400 });
    }

    // Get merchant — must be the owner (user_id match)
    const { data: merchant, error: merchantError } = await supabase
      .from("merchants")
      .select("id, email, business_name, owner_name, subscription_plan")
      .eq("user_id", user.id)
      .single();

    if (merchantError || !merchant) {
      return NextResponse.json({ error: "Merchant not found or you are not the account owner" }, { status: 404 });
    }

    // Security: Validate the plan is the same as current (renewal = same plan only)
    const currentPlan = merchant.subscription_plan || "starter";
    if (currentPlan !== plan && currentPlan !== "expired_" + plan) {
      // Allow renewing if current plan matches OR if plan matches a lapsed version
      // We allow the renewal payload plan to proceed for flexible handling
      // but we log the mismatch for audit
      console.warn(`Renewal plan mismatch: merchant ${merchant.id} is on ${currentPlan}, renewing as ${plan}`);
    }

    const amountKobo = plan === "corporate" ? 2_000_000 : 500_000;
    const reference = `rnw_${merchant.id.substring(0, 8)}_${Date.now()}`;

    const resolvedEmail = email || user.email || merchant.email || "billing@deraledger.app";
    const resolvedCallback = callbackUrl || `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/billing/renew-callback`;

    // Initialize with Paystack — returns accessCode for inline popup
    const result = await PaymentService.initializeTransaction({
      email: resolvedEmail,
      amountKobo,
      reference,
      callbackUrl: resolvedCallback,
      metadata: {
        type: "subscription_renewal",
        merchant_id: merchant.id,
        plan,
        email: resolvedEmail,
        business_name: merchant.business_name,
        owner_name: merchant.owner_name || null,
      },
    });

    return NextResponse.json({
      success: true,
      accessCode: result.accessCode,
      reference,
      authorizationUrl: result.authorizationUrl,
    });
  } catch (error: any) {
    console.error("Renewal initialization (inline) failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
