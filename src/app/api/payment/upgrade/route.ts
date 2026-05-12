import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PaymentService } from "@/lib/payment";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { newPlan, ownerName } = await request.json();

    if (newPlan !== "individual" && newPlan !== "corporate") {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
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
    const amountKobo = newPlan === "corporate" ? 2000000 : 500000;
    const reference = `upg_${merchant.id.substring(0, 8)}_${Date.now()}`;

    const configuredUrl = process.env.NEXT_PUBLIC_APP_URL || "";
    const appUrl = configuredUrl || (process.env.NODE_ENV === "production" ? "https://purpledger.vercel.app" : "http://localhost:3000");

    const result = await PaymentService.initializeTransaction({
      email: user.email || merchant.email || "billing@deraledger.app",
      amountKobo,
      reference,
      callbackUrl: `${appUrl}/settings/upgrade-success?reference=${reference}&plan=${newPlan}`,
      metadata: {
        type: "subscription_upgrade",
        merchant_id: merchant.id,
        new_plan: newPlan,
        owner_name: ownerName || null,
      },
    });

    return NextResponse.json({
      success: true,
      authorizationUrl: result.authorizationUrl,
    });
  } catch (error: any) {
    console.error("Upgrade initialization failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
