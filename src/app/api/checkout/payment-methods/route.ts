import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  canUseBreetCryptoCheckout,
  isBelowBreetMinimumAmount,
  loadBreetRuntimeConfig,
} from "@/lib/services/breet-crypto.service";
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

const SUBSCRIPTION_PLAN_PRICES_NGN: Record<string, number> = {
  individual: 5000,
  corporate: 20000,
};

const UPGRADE_PLAN_PRICES_NGN: Record<string, number> = {
  individual: 5000,
  corporate: 20000,
};

function resolvePurpose(kind: string | null): PaymentPurpose | null {
  if (kind === "subscription") return "plan_subscription";
  if (kind === "upgrade") return "plan_upgrade";
  if (kind === "invoice") return "invoice_payment";
  if (kind === "payment_link") return "payment_link";
  return null;
}

function parsePositiveAmount(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get("kind");
    const invoiceId = searchParams.get("invoiceId");
    const plan = searchParams.get("plan");
    const purpose = resolvePurpose(kind);

    if (!purpose) {
      return NextResponse.json({ error: "Invalid checkout kind." }, { status: 400 });
    }

    let environment = getPaymentEnvironment();
    let merchantId: string | null = null;
    let invoiceAmountForCrypto: number | null = null;
    if (kind === "invoice" && invoiceId) {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId);
      const invoiceResult = isUUID
        ? await supabase.from("invoices").select("merchant_id, outstanding_balance").eq("id", invoiceId).maybeSingle()
        : await supabase.from("invoices").select("merchant_id, outstanding_balance").or(`invoice_hash.eq.${invoiceId},short_link.eq.${invoiceId}`).maybeSingle();
      const invoice = invoiceResult.data;

      if (invoice?.merchant_id) {
        merchantId = invoice.merchant_id;
        invoiceAmountForCrypto = Number(invoice.outstanding_balance || 0);
        const { data: merchant } = await supabase
          .from("merchants")
          .select("email")
          .eq("id", invoice.merchant_id)
          .maybeSingle();
        environment = getPaymentEnvironmentForMerchantEmail(merchant?.email);
      }
    }

    const routedMethods = await listAvailablePaymentMethods(purpose, environment);
    const settlementReadyMethods =
      purpose === "invoice_payment" || purpose === "payment_link" || purpose === "crypto_payment"
        ? await filterMethodsBySettlementReadiness(supabase, merchantId, routedMethods, environment, purpose)
        : routedMethods;
    const runtimeConfig = await loadBreetRuntimeConfig(supabase);
    const requestedInvoiceAmount =
      parsePositiveAmount(searchParams.get("paymentAmount")) ??
      parsePositiveAmount(searchParams.get("amountNgn")) ??
      parsePositiveAmount(searchParams.get("amount"));
    const amountToCheck =
      purpose === "invoice_payment" || purpose === "payment_link" || purpose === "crypto_payment"
        ? requestedInvoiceAmount ?? invoiceAmountForCrypto
        : purpose === "plan_subscription"
          ? (plan ? SUBSCRIPTION_PLAN_PRICES_NGN[plan] ?? null : null)
          : purpose === "plan_upgrade"
            ? (plan ? UPGRADE_PLAN_PRICES_NGN[plan] ?? null : null)
            : null;
    const cryptoBelowMinimum =
      amountToCheck !== null &&
      isBelowBreetMinimumAmount(amountToCheck, runtimeConfig.minimumAutoSettlementNgn);
    const breetEligibility = settlementReadyMethods.some((method) => method.method === "crypto")
      ? await canUseBreetCryptoCheckout({
          supabase,
          purpose,
          merchantId,
          environment,
        })
      : null;
    const availableMethods = settlementReadyMethods.filter((method) => {
      if (method.method !== "crypto") return true;
      if (cryptoBelowMinimum) return false;
      if (breetEligibility && !breetEligibility.allowed) return false;
      return true;
    });

    return NextResponse.json({
      kind,
      purpose,
      environment,
      minimumAutoSettlementNgn: runtimeConfig.minimumAutoSettlementNgn,
      availableMethods,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load payment methods.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
