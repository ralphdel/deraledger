import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PaymentService } from "@/lib/payment";
import { getAppUrl } from "@/lib/server-utils";
import { resolvePaymentRoute, type PaymentMethod } from "@/lib/services/payment-routing.service";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { plan, paymentMethod } = await request.json();

    if (plan !== "individual" && plan !== "corporate") {
      return NextResponse.json({ error: "Invalid plan or plan is not renewable" }, { status: 400 });
    }

    // Get merchant
    const { data: merchant, error: merchantError } = await supabase
      .from("merchants")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (merchantError || !merchant) {
      return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    }

    // Determine price
    const amountKobo = plan === "corporate" ? 2000000 : 500000;
    const reference = `rnw_${merchant.id.substring(0, 8)}_${Date.now()}`;

    const appUrl = getAppUrl();
    const method = (paymentMethod || "card") as PaymentMethod;
    const route = await resolvePaymentRoute("plan_subscription", method);
    const callback = new URL(`${appUrl}/settings/billing/renew-callback`);
    callback.searchParams.set("provider", route.provider);

    const result = await PaymentService.initializeTransaction({
      email: user.email || merchant.email || "billing@deraledger.app",
      amountKobo,
      reference,
      // Use a dedicated callback URL so we can detect the redirect and verify payment
      callbackUrl: callback.toString(),
      metadata: {
        type: "subscription_renewal",
        merchant_id: merchant.id,
        plan: plan,
        amount_expected_kobo: amountKobo,
        payment_method_requested: method,
        resolved_provider: route.provider,
        payment_purpose: "plan_subscription",
      },
      paymentMethod: method,
    }, route.provider === "monnify" ? "monnify" : "paystack");

    return NextResponse.json({
      success: true,
      authorizationUrl: result.authorizationUrl,
      reference,
      provider: route.provider,
    });
  } catch (error: any) {
    console.error("Renewal initialization failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
