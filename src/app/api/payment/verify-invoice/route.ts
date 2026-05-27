import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { PaymentService } from "@/lib/payment";
import { processSuccessfulFiatPayment } from "@/lib/services/fiat-payment-confirmation.service";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const { reference, provider } = await request.json();
    if (!reference) {
      return NextResponse.json({ error: "Missing reference" }, { status: 400 });
    }

    const providersToTry: Array<"paystack" | "monnify"> =
      provider === "monnify" ? ["monnify"] : provider === "paystack" ? ["paystack"] : ["paystack", "monnify"];

    let lastError: unknown = null;
    for (const resolvedProvider of providersToTry) {
      try {
        const tx = await PaymentService.verifyTransaction(reference, resolvedProvider);

        if (tx.status !== "success") {
          lastError = new Error("Payment not successful");
          continue;
        }

        const metadata = normalizeMetadata(tx.metadata ?? tx.metaData);
        if (metadata.type !== "invoice_payment") {
          return NextResponse.json({ success: true, ignored: true });
        }

        const result = await processSuccessfulFiatPayment(supabase, {
          provider: resolvedProvider,
          metadata,
          amountKobo: Number(tx.amount || 0),
          reference: String(tx.reference || reference),
          channel: String(tx.paymentMethod || tx.channel || metadata.payment_method_requested || "card"),
          feesKobo: typeof tx.fees === "number" ? tx.fees : null,
        });

        return NextResponse.json({ success: true, provider: resolvedProvider, ...result });
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Payment verification failed");
  } catch (error) {
    console.error("Invoice payment verification failed:", error);
    return NextResponse.json({ error: "Payment verification failed" }, { status: 500 });
  }
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
