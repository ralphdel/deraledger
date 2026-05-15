import { NextResponse } from "next/server";
import { PaymentService } from "@/lib/payment";
import crypto from "crypto";

/**
 * POST /api/checkout/crypto-subscription
 *
 * Generates a Breet crypto deposit address for new merchant subscription.
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
    const { email, plan, sessionId, amountKobo } = await request.json();

    if (!email || !plan || !sessionId || !amountKobo) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    const reference = `CRYPTO-SUB-${plan.toUpperCase()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
    const fiatAmount = amountKobo / 100;

    const result = await PaymentService.generateCryptoDepositAddress({
      assetId: "USDT",
      label: reference,
    });

    return NextResponse.json({
      success: true,
      cryptoAddress: result.address,
      cryptoNetwork: result.asset || "TRC20",
      cryptoCoin: result.asset || "USDT",
      fiatAmount,
      reference,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to generate crypto address.";
    console.error("Crypto subscription init error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
