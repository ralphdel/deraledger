import { NextResponse } from "next/server";
import { PaymentService } from "@/lib/payment";

export async function POST(request: Request) {
  const signature =
    request.headers.get("monnify-signature") ||
    request.headers.get("x-monnify-signature") ||
    "";
  const body = await request.text();
  const verification = PaymentService.verifyWebhook(body, signature, "monnify");

  if (process.env.NODE_ENV === "production" && !verification.valid) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  // Monnify checkout normalization is scaffolded but not yet mapped into the
  // existing purpose handlers. We acknowledge the event so the route exists
  // without disturbing current Paystack production behavior.
  return NextResponse.json({
    received: true,
    provider: "monnify",
    message: "Monnify webhook endpoint is available. Purpose normalization is pending activation.",
  });
}
