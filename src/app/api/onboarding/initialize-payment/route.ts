import { NextResponse } from "next/server";
import { PaymentService } from "@/lib/payment";
import crypto from "crypto";

export async function POST(request: Request) {
  const { email, tradingName, registeredName, ownerName, plan, sessionId, amountKobo } = await request.json();

  if (!email || !tradingName || !registeredName || !plan || !sessionId || !amountKobo) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const appUrl = configuredUrl || (process.env.NODE_ENV === "production" ? "https://purpledger.vercel.app" : "http://localhost:3000");
  // Unique reference per transaction
  const reference = `SUB-${plan.toUpperCase()}-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;

  try {
    const result = await PaymentService.initializeTransaction({
      email,
      amountKobo,
      reference,
      callbackUrl: `${appUrl}/onboarding/payment-callback`,
      metadata: {
        type: "subscription",
        plan,
        email,
        business_name: registeredName,
        trading_name: tradingName,
        owner_name: ownerName || null,
        session_id: sessionId,
      },
    });

    return NextResponse.json({
      authorizationUrl: result.authorizationUrl,
      accessCode: result.accessCode,
      reference,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Payment initialization failed";
    console.error("Payment init error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
