import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PaymentService } from "@/lib/payment";
import crypto from "crypto";

/**
 * POST /api/checkout/crypto-upgrade
 *
 * Generates a Breet crypto deposit address for an existing merchant plan upgrade.
 * Feature-flagged: returns a "coming_soon" response until Breet credentials are configured.
 */
export async function POST(request: Request) {
  const BREET_ENABLED = process.env.BREET_API_KEY && process.env.BREET_API_KEY.length > 0;

  if (!BREET_ENABLED) {
    return NextResponse.json(
      { error: "Crypto payments are not yet enabled. Please use Card & Bank or Bank Transfer." },
      { status: 503 }
    );
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { newPlan } = await request.json();

    if (newPlan !== "individual" && newPlan !== "corporate") {
      return NextResponse.json({ error: "Invalid plan." }, { status: 400 });
    }

    const amountNgn = newPlan === "corporate" ? 20000 : 5000;
    const reference = `CRYPTO-UPG-${newPlan.toUpperCase()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;

    const result = await PaymentService.generateCryptoDepositAddress({
      assetId: "USDT",
      label: reference,
    });

    return NextResponse.json({
      success: true,
      cryptoAddress: result.address,
      cryptoNetwork: result.asset || "TRC20",
      cryptoCoin: result.asset || "USDT",
      fiatAmount: amountNgn,
      reference,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to generate crypto address.";
    console.error("Crypto upgrade init error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
