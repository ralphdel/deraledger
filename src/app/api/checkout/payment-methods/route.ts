import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  getPaymentEnvironment,
  getPaymentEnvironmentForMerchantEmail,
  listAvailablePaymentMethods,
  type PaymentPurpose,
} from "@/lib/services/payment-routing.service";
import { filterMethodsBySettlementReadiness } from "@/lib/services/settlement-ledger.service";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
    const invoiceId = searchParams.get("invoiceId");
    const purpose = resolvePurpose(kind);

    if (!purpose) {
      return NextResponse.json({ error: "Invalid checkout kind." }, { status: 400 });
    }

    let environment = getPaymentEnvironment();
    let merchantId: string | null = null;
    if (kind === "invoice" && invoiceId) {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId);
      const invoiceResult = isUUID
        ? await supabase.from("invoices").select("merchant_id").eq("id", invoiceId).maybeSingle()
        : await supabase.from("invoices").select("merchant_id").or(`invoice_hash.eq.${invoiceId},short_link.eq.${invoiceId}`).maybeSingle();
      const invoice = invoiceResult.data;

      if (invoice?.merchant_id) {
        merchantId = invoice.merchant_id;
        const { data: merchant } = await supabase
          .from("merchants")
          .select("email")
          .eq("id", invoice.merchant_id)
          .maybeSingle();
        environment = getPaymentEnvironmentForMerchantEmail(merchant?.email);
      }
    }

    const routedMethods = await listAvailablePaymentMethods(purpose, environment);
    const availableMethods =
      purpose === "invoice_payment" || purpose === "payment_link" || purpose === "crypto_payment"
        ? await filterMethodsBySettlementReadiness(supabase, merchantId, routedMethods, environment, purpose)
        : routedMethods;

    return NextResponse.json({
      kind,
      purpose,
      environment,
      availableMethods,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load payment methods.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
