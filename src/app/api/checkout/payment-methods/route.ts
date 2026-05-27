import { NextResponse } from "next/server";
import {
  getPaymentEnvironment,
  listAvailablePaymentMethods,
  type PaymentPurpose,
} from "@/lib/services/payment-routing.service";

function resolvePurpose(kind: string | null): PaymentPurpose | null {
  if (kind === "subscription") return "plan_subscription";
  if (kind === "upgrade") return "plan_upgrade";
  if (kind === "invoice") return "invoice_payment";
  if (kind === "payment_link") return "payment_link";
  return null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get("kind");
    const purpose = resolvePurpose(kind);

    if (!purpose) {
      return NextResponse.json({ error: "Invalid checkout kind." }, { status: 400 });
    }

    const availableMethods = await listAvailablePaymentMethods(purpose);

    return NextResponse.json({
      kind,
      purpose,
      environment: getPaymentEnvironment(),
      availableMethods,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load payment methods.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
