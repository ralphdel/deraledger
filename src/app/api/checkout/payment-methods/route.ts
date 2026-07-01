import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  canUseBreetCryptoCheckout,
  isBelowBreetMinimumAmount,
  loadBreetRuntimeConfig,
  resolveBreetCheckoutEnvironment,
} from "@/lib/services/breet-crypto.service";
import {
  getPaymentEnvironment,
  getPaymentEnvironmentForMerchantEmail,
  listAvailablePaymentMethods,
  type PaymentPurpose,
} from "@/lib/services/payment-routing.service";
import { filterMethodsBySettlementReadiness } from "@/lib/services/settlement-ledger.service";
import { assertPlanAvailable, getPlanPrice, getStoragePlanCode, normalizePlanCode } from "@/lib/plans";

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

function parsePositiveAmount(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get("kind");
    const invoiceId = searchParams.get("invoiceId");
    const requestedPlan = searchParams.get("plan");
    const purpose = resolvePurpose(kind);

    if (!purpose) {
      return NextResponse.json({ error: "Invalid checkout kind." }, { status: 400 });
    }

    let normalizedPlan: string | null = null;
    let storagePlan: string | null = null;
    if (requestedPlan) {
      normalizedPlan = normalizePlanCode(requestedPlan);
      storagePlan = getStoragePlanCode(normalizedPlan);
      const availability = await assertPlanAvailable(supabase, normalizedPlan);
      if (!availability.ok) {
        return NextResponse.json({ error: "This plan is not available right now." }, { status: 403 });
      }
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

    const runtimeConfig = await loadBreetRuntimeConfig(supabase);
    const cryptoEnvironment = resolveBreetCheckoutEnvironment(runtimeConfig, environment);
    const routedMethods = await listAvailablePaymentMethods(purpose, environment);
    const cryptoRoutedMethods =
      cryptoEnvironment !== environment
        ? await listAvailablePaymentMethods(purpose, cryptoEnvironment)
        : routedMethods;
    const mergedMethods = [
      ...routedMethods,
      ...cryptoRoutedMethods.filter((method) =>
        method.method === "crypto" && !routedMethods.some((existing) => existing.method === "crypto")
      ),
    ];
    const settlementReadyMethods =
      purpose === "invoice_payment" || purpose === "payment_link" || purpose === "crypto_payment"
        ? await filterMethodsBySettlementReadiness(
            supabase,
            merchantId,
            mergedMethods.filter((method) => method.method !== "crypto"),
            environment,
            purpose
          )
        : mergedMethods.filter((method) => method.method !== "crypto");
    const requestedInvoiceAmount =
      parsePositiveAmount(searchParams.get("paymentAmount")) ??
      parsePositiveAmount(searchParams.get("amountNgn")) ??
      parsePositiveAmount(searchParams.get("amount"));
    const amountToCheck =
      purpose === "invoice_payment" || purpose === "payment_link" || purpose === "crypto_payment"
        ? requestedInvoiceAmount ?? invoiceAmountForCrypto
        : purpose === "plan_subscription"
          ? (normalizedPlan ? getPlanPrice(normalizedPlan) : null)
          : purpose === "plan_upgrade"
            ? (normalizedPlan ? getPlanPrice(normalizedPlan) : null)
            : null;
    const cryptoBelowMinimum =
      amountToCheck !== null &&
      isBelowBreetMinimumAmount(amountToCheck, runtimeConfig.minimumAutoSettlementNgn);
    const cryptoCandidate = mergedMethods.find((method) => method.method === "crypto" && method.provider === "breet") || null;
    const breetEligibility = cryptoCandidate
      ? await canUseBreetCryptoCheckout({
          supabase,
          purpose,
          merchantId,
          environment,
        })
      : null;

    const cryptoDisabledReason =
      !cryptoCandidate
        ? "Crypto checkout route is disabled."
        : cryptoBelowMinimum
          ? `Crypto payments are available for amounts from ₦${runtimeConfig.minimumAutoSettlementNgn.toLocaleString()} and above. Please use another payment method for smaller amounts.`
          : breetEligibility && !breetEligibility.allowed
            ? breetEligibility.reason || "Crypto checkout is unavailable."
            : null;

    const availableMethods = mergedMethods.filter((method) => {
      if (method.method !== "crypto") {
        return settlementReadyMethods.some((readyMethod) => readyMethod.method === method.method);
      }
      return Boolean(cryptoCandidate && !cryptoDisabledReason);
    });

    const methodAvailability = {
      card: {
        enabled: availableMethods.some((method) => method.method === "card"),
        reason: null as string | null,
      },
      bank_transfer: {
        enabled: availableMethods.some((method) => method.method === "bank_transfer"),
        reason: null as string | null,
      },
      ussd: {
        enabled: availableMethods.some((method) => method.method === "ussd"),
        reason: null as string | null,
      },
      crypto: {
        enabled: availableMethods.some((method) => method.method === "crypto"),
        reason: cryptoDisabledReason,
      },
    };

    return NextResponse.json({
      kind,
      purpose,
      plan: storagePlan,
      displayPlan: normalizedPlan,
      environment,
      effectiveCryptoEnvironment: breetEligibility?.effectiveEnvironment || cryptoEnvironment,
      minimumAutoSettlementNgn: runtimeConfig.minimumAutoSettlementNgn,
      availableMethods,
      methodAvailability,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load payment methods.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
