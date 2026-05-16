"use client";

import { use, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { formatNaira, calculateProportionalPayment, getMinimumPayment } from "@/lib/calculations";
import type { InvoiceWithLineItems, Merchant } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Receipt, Clock, CheckCircle2, Lock, AlertTriangle, Info, AlertCircle, Copy, Wallet, CreditCard, ArrowRightLeft, Sparkles } from "lucide-react";

// Feature flags — controls which payment rails are active
const PROVIDER_FLAGS = {
  paystack: true,   // Card + Bank Transfer via Paystack
  monnify: false,   // Dynamic bank accounts via Monnify (coming soon)
  breet: false,     // Crypto OTC via Breet (coming soon)
};

export default function PublicPaymentPortal({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = use(params);
  const [invoice, setInvoice] = useState<InvoiceWithLineItems | null>(null);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [monthlyCollected, setMonthlyCollected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [inputAmount, setInputAmount] = useState<string>("");
  const searchParams = useSearchParams();
  const [isProcessing, setIsProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"card" | "transfer" | "crypto">("card");
  const [refreshedInvoice, setRefreshedInvoice] = useState<InvoiceWithLineItems | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [cryptoDetails, setCryptoDetails] = useState<{
    address: string;
    network: string;
    coin: string;
    fiatAmount: number;
    reference: string;
  } | null>(null);

  const [copied, setCopied] = useState(false);
  const [referenceContext, setReferenceContext] = useState<{
    name: string;
    projectTotalValue: number;
    totalCollected: number;
    outstandingBalance: number;
    collectionProgress: number;
    hasProjectTotal: boolean;
  } | null>(null);

  interface DepositAllocation { id: string; source_invoice_id: string; allocated_amount: number; source_invoice_number: string | null; }
  const [depositAllocations, setDepositAllocations] = useState<DepositAllocation[]>([]);
  const [totalDepositAllocated, setTotalDepositAllocated] = useState(0);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    if (searchParams.has("reference") || searchParams.has("trxref")) {
      setSuccess(true);
      // Poll for updated invoice data after payment — webhook may take a moment to update DB
      setIsRefreshing(true);
      let attempts = 0;
      const maxAttempts = 6;
      const poll = async () => {
        attempts++;
        try {
          const res = await fetch(`/api/invoice/${invoiceId}`);
          const result = await res.json();
          if (result?.invoice) {
            const fresh = result.invoice as InvoiceWithLineItems;
            // Check if DB has been updated (amount_paid changed from initial state)
            if (attempts >= maxAttempts || Number(fresh.amount_paid) !== Number(invoice?.amount_paid ?? fresh.amount_paid)) {
              setRefreshedInvoice(fresh);
              setIsRefreshing(false);
              return;
            }
          }
        } catch {}
        if (attempts < maxAttempts) {
          setTimeout(poll, 1500);
        } else {
          setIsRefreshing(false);
        }
      };
      setTimeout(poll, 1500); // Start first attempt after 1.5s to give webhook time
    }
  }, [searchParams, invoiceId]);

  useEffect(() => {
    // Fetch via our secure server-side API route — uses service role key to
    // always return real merchant verification_status, regardless of RLS.
    fetch(`/api/invoice/${invoiceId}`)
      .then((res) => res.json())
      .then((result) => {
        if (result?.invoice) {
          setInvoice(result.invoice);
          setMerchant(result.merchant);
          setMonthlyCollected(result.monthlyCollected ?? 0);
          
          const depositAllocated = result.totalDepositAllocated ?? 0;
          setInputAmount(Math.max(0, Number(result.invoice.outstanding_balance)).toString());
          if (result.referenceContext?.hasProjectTotal) {
            setReferenceContext(result.referenceContext);
          }
          if (result.depositAllocations?.length) {
            setDepositAllocations(result.depositAllocations);
            setTotalDepositAllocated(result.totalDepositAllocated ?? 0);
          }
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [invoiceId]);

  if (loading) {
    return (
      <div className="flex-1 w-full bg-purp-50 flex items-center justify-center p-4">
        <div className="w-8 h-8 border-2 border-purp-700 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="flex-1 w-full bg-purp-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full border-2 border-purp-200">
          <CardContent className="pt-6 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl font-bold text-red-600">!</span>
            </div>
            <h1 className="text-xl font-bold text-purp-900">Invoice Not Found</h1>
            <p className="text-neutral-500 mt-2">This payment link is invalid or has been removed.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const businessName = merchant?.business_name || "Deraledger Merchant";

  // ── Invoice status logic ──────────────────────────────────────────────────
  // Check if merchant limit is exceeded
  const isStarter = (merchant?.subscription_plan || merchant?.merchant_tier || "starter") === "starter";
  const limitExceeded = isStarter || (merchant?.monthly_collection_limit ? monthlyCollected >= merchant.monthly_collection_limit : false);

  // Manually closed or fully closed → no more payments accepted
  const isManuallyClosed = invoice.status === "manually_closed";
  const isFullyClosed = invoice.status === "closed";
  const isVoid = invoice.status === "void";

  // Expired means link has expired (past pay-by date),
  // but the invoice is NOT closed — it can only be manually closed by merchant
  const isExpired = invoice.status === "expired";

  // Check if merchant subscription is locked
  const isMerchantSubscriptionExpired = (merchant as any)?.subscription_status === "expired";

  // We no longer strictly block just because the date passed, 
  // so that reopened invoices stay active until explicitly expired again.
  // Determine if payment should be blocked
  const isPaymentBlocked = isManuallyClosed || isFullyClosed || isVoid || isExpired || limitExceeded || isMerchantSubscriptionExpired;

  if (isPaymentBlocked) {
    // Differentiate between "closed" and "link expired"
    const isClosed = isManuallyClosed || isFullyClosed || isVoid;

    return (
      <div className="flex-1 w-full bg-purp-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full border-2 border-purp-200">
          <CardContent className="pt-6 text-center space-y-4">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${
              isClosed ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
            }`}>
              {isClosed ? <CheckCircle2 className="w-8 h-8" /> : <Clock className="w-8 h-8" />}
            </div>
            <h1 className="text-xl font-bold text-purp-900">
              {isMerchantSubscriptionExpired ? "Payment Link Unavailable" : limitExceeded ? "Merchant Limit Reached" : isClosed ? "Invoice Closed" : "Payment Link Expired"}
            </h1>
            <p className="text-neutral-500">
              {isMerchantSubscriptionExpired
                ? "This payment link is temporarily unavailable. Please contact the merchant directly."
                : limitExceeded
                ? "This merchant is currently unable to accept further payments at this time. Please contact them directly."
                : isClosed
                  ? "This invoice has been closed by the merchant and no further payments can be accepted."
                  : "This payment link has expired. The invoice is still open, but payments can no longer be accepted through this link."}
            </p>

            {!isClosed && !limitExceeded && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-left">
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-amber-800">
                    <p className="font-medium">What does this mean?</p>
                    <p className="mt-1 text-xs">
                      The pay-by date ({invoice.pay_by_date ? new Date(invoice.pay_by_date).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" }) : "N/A"}) has passed.
                      Your outstanding balance of <strong>{formatNaira(Number(invoice.outstanding_balance))}</strong> has not been written off — the merchant may reach out to arrange payment directly or extend the deadline.
                    </p>
                  </div>
                </div>
              </div>
            )}


            {isManuallyClosed && invoice.manual_close_reason && (
              <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3 text-left text-sm">
                <p className="text-neutral-500 text-xs mb-1">Closure Reason</p>
                <p className="font-medium text-neutral-700">{invoice.manual_close_reason}</p>
              </div>
            )}

            <div className="pt-4 border-t border-purp-100">
              <p className="text-sm font-medium text-purp-900">{businessName}</p>
              <p className="text-xs text-neutral-500">{invoice.invoice_number}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Merchant Verification Guard
  const isMerchantVerified = merchant?.verification_status === "verified";
  const hasSettlementAccount = !!merchant?.payment_subaccount_code;
  const isAcceptingPayments = isMerchantVerified && hasSettlementAccount;

  if (!isAcceptingPayments) {
    const isUnverified = !isMerchantVerified;
    return (
      <div className="flex-1 w-full bg-purp-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full border-2 border-purp-200">
          <CardContent className="pt-6 text-center space-y-4">
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-amber-600" />
            </div>
            <h1 className="text-xl font-bold text-purp-900">
              {isUnverified ? "Account Not Yet Verified" : "Payments Unavailable"}
            </h1>
            <p className="text-neutral-500">
              {isUnverified
                ? "This merchant has not completed their account verification (KYC). Online payments cannot be accepted until verification is approved. Please contact the merchant directly."
                : "This merchant has not yet set up their settlement account. Online payments cannot be accepted at this time. Please contact the merchant directly."}
            </p>
            <div className="pt-4 border-t border-purp-100 mt-4">
              <p className="text-sm font-medium text-purp-900">{businessName}</p>
              <p className="text-xs text-neutral-500">{invoice.invoice_number}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Payment calculations ──────────────────────────────────────────────────
  // The true outstanding balance the client owes is exactly what's recorded in the DB (which already factors in applied deposits)
  const outstandingBalance = Math.max(0, Number(invoice.outstanding_balance));
  const grandTotal = Number(invoice.grand_total);
  const parsedAmount = parseFloat(inputAmount) || 0;
  const minimumPayment = getMinimumPayment(grandTotal, outstandingBalance);
  const remainingLimit = isStarter ? 0 : (merchant?.monthly_collection_limit ? merchant.monthly_collection_limit - monthlyCollected : Infinity);

  // Validation states
  const exceedsRemainingLimit = parsedAmount > remainingLimit;
  const isBelowMinimum = parsedAmount > 0 && parsedAmount < minimumPayment;
  const isAboveMax = parsedAmount > outstandingBalance;
  const isValidAmount = parsedAmount >= minimumPayment && parsedAmount <= outstandingBalance && !exceedsRemainingLimit;
  const cappedAmount = Math.min(parsedAmount, outstandingBalance);

  const allocation = calculateProportionalPayment(
    isValidAmount ? parsedAmount : 0,
    outstandingBalance,
    Number(invoice.tax_value),
    Number(invoice.discount_value),
    Number(invoice.amount_paid),
    invoice.fee_absorption
  );

  const handleQuickSelect = (percentage: number) => {
    const amount = Math.round(outstandingBalance * percentage);
    // Ensure quick select never goes below minimum
    const finalAmount = Math.max(amount, minimumPayment);
    setInputAmount(finalAmount.toString());
  };

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidAmount || !invoice) return;

    setIsProcessing(true);
    setPaymentError(null);

    try {
      const res = await fetch("/api/demo-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: invoice.id,
          paymentAmount: parsedAmount,
        }),
      });
      
      const result = await res.json();
      
      if (result.success && result.isCrypto) {
        setCryptoDetails({
          address: result.cryptoAddress,
          network: result.cryptoNetwork,
          coin: result.cryptoCoin,
          fiatAmount: result.fiatAmount,
          reference: result.reference,
        });
        setIsProcessing(false);
      } else if (result.success && result.authorizationUrl) {
        // Redirect to Paystack standard checkout page
        window.location.href = result.authorizationUrl;
      } else {
        setPaymentError("Payment initialization failed: " + (result.error || "Unknown error"));
        setIsProcessing(false);
      }
    } catch (err) {
      setPaymentError("Payment could not be processed. Please try again or contact support.");
      console.error(err);
      setIsProcessing(false);
    }
  };

  if (success) {
    const displayInvoice = refreshedInvoice || invoice;
    const updatedOutstanding = Math.max(0, Number(displayInvoice?.outstanding_balance ?? 0));
    const updatedTotalPaid = Number(displayInvoice?.amount_paid ?? 0) + totalDepositAllocated;
    // Calculate delta: what was paid IN THIS transaction only
    // `invoice` holds the pre-payment snapshot; `refreshedInvoice` holds post-payment state
    const prePaidAmount = Number(invoice?.amount_paid ?? 0);
    const thisPayment = refreshedInvoice
      ? Math.max(0, Number(refreshedInvoice.amount_paid ?? 0) - prePaidAmount)
      : 0; // if still loading, we don't know yet
    const isFullyPaid = updatedOutstanding <= 0;

    return (
      <div className="min-h-screen bg-purp-50 flex flex-col items-center justify-center p-4">
        <Card className="max-w-md w-full border-2 border-emerald-200">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-10 h-10 text-emerald-600" />
            </div>
            <h1 className="text-2xl font-bold text-purp-900">Payment Successful</h1>
            <p className="text-neutral-500 pb-2">
              Your payment has been processed securely and the ledger has been updated.
            </p>
            {isRefreshing ? (
              <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4 flex items-center justify-center gap-3 text-sm text-neutral-500">
                <div className="w-4 h-4 border-2 border-purp-600 border-t-transparent rounded-full animate-spin" />
                Fetching updated balance...
              </div>
            ) : (
              <div className="bg-purp-50 p-4 rounded-lg text-left text-sm space-y-3 border border-purp-100">
                <div className="flex justify-between">
                  <span className="text-neutral-500">Invoice</span>
                  <span className="font-medium text-purp-900">{displayInvoice?.invoice_number}</span>
                </div>
                {thisPayment > 0 && (
                  <div className="flex justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 -mx-1">
                    <span className="font-semibold text-emerald-800">This Payment</span>
                    <span className="font-bold text-emerald-700">{formatNaira(thisPayment)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-neutral-500">Total Paid to Date</span>
                  <span className="font-medium text-purp-900">{formatNaira(updatedTotalPaid)}</span>
                </div>
                {totalDepositAllocated > 0 && (
                  <div className="flex justify-between border-t border-purp-50 pt-2 mt-1">
                    <span className="text-neutral-500 text-xs">Includes Applied Deposit</span>
                    <span className="font-medium text-blue-600 text-xs">{formatNaira(totalDepositAllocated)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-purp-100 pt-2 mt-2">
                  <span className="text-neutral-500">Outstanding Balance</span>
                  <span className={`font-bold ${isFullyPaid ? "text-emerald-600" : "text-amber-600"}`}>
                    {isFullyPaid ? "Fully Paid ✓" : formatNaira(updatedOutstanding)}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        <div className="mt-8 flex items-center gap-2 text-neutral-400 text-sm">
          <Lock className="w-4 h-4" /> SECURED BY DERALEDGER
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full bg-[#F8F7FF] flex flex-col md:flex-row">
      {/* Left Panel: Invoice Details */}
      <div className="w-full md:w-5/12 lg:w-1/3 bg-purp-900 text-white p-6 md:p-8 flex flex-col md:h-screen md:sticky md:top-0 md:overflow-y-auto">
        <div className="flex items-center gap-3 mb-10">
          {merchant?.logo_url ? (
            <img src={merchant.logo_url} alt={businessName} className="w-12 h-12 rounded-xl object-cover bg-white" />
          ) : (
            <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-purp-900 font-bold text-xl">
              {businessName.charAt(0)}
            </div>
          )}
          <div>
            <h2 className="font-bold text-lg leading-tight">{businessName}</h2>
            <p className="text-purp-200 text-sm">Official Payment Portal</p>
          </div>
        </div>

        <div className="space-y-6 flex-1">
          <div>
            <p className="text-purp-200 text-sm mb-1">Invoice Reference</p>
            <p className="font-mono text-lg font-bold">{invoice.invoice_number}</p>
          </div>

          <div>
            <p className="text-purp-200 text-sm mb-1">Billed To</p>
            <p className="font-medium">{invoice.clients?.full_name || "Client"}</p>
            <p className="text-purp-200 text-sm">{invoice.clients?.email || ""}</p>
          </div>

          <div className="pt-6 border-t border-white/15">
            <h3 className="font-bold mb-4">Invoice Breakdown</h3>
            <div className="space-y-4">
              {(invoice.line_items || []).map((item) => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span className="text-purp-100 pr-4">{item.quantity}x {item.item_name}</span>
                  <span className="font-medium">{formatNaira(Number(item.line_total))}</span>
                </div>
              ))}

              <div className="pt-4 border-t border-white/15 space-y-2 text-sm">
                <div className="flex justify-between text-purp-200">
                  <span>Subtotal</span><span>{formatNaira(Number(invoice.subtotal))}</span>
                </div>
                {Number(invoice.discount_value) > 0 && (
                  <div className="flex justify-between text-red-300">
                    <span>Discount ({invoice.discount_pct}%)</span>
                    <span>-{formatNaira(Number(invoice.discount_value))}</span>
                  </div>
                )}
                {Number(invoice.tax_value) > 0 && (
                  <div className="flex justify-between text-purp-200">
                    <span>Tax ({invoice.tax_pct}%)</span>
                    <span>+{formatNaira(Number(invoice.tax_value))}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-base pt-2">
                  <span>Service Total</span><span>{formatNaira(grandTotal)}</span>
                </div>
                {totalDepositAllocated > 0 && (
                  <>
                    <div className="flex justify-between text-emerald-300 pt-1">
                      <span>Previously Paid Deposit</span>
                      <span className="font-bold">-{formatNaira(totalDepositAllocated)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-white text-base border-t border-white/20 pt-2 mt-1">
                      <span>Outstanding Amount</span>
                      <span>{formatNaira(Math.max(0, grandTotal - totalDepositAllocated))}</span>
                    </div>
                  </>
                )}
                {totalDepositAllocated <= 0 && (
                  <div className="flex justify-between font-bold text-base pt-2 border-t border-white/15">
                    <span>Grand Total</span><span>{formatNaira(grandTotal)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {Number(invoice.amount_paid) > 0 && (
            <div className="bg-black/20 p-4 rounded-lg mt-6">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-purp-200">Already Paid</span>
                <span className="font-bold text-emerald-400">{formatNaira(Number(invoice.amount_paid))}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-purp-200">Outstanding Balance</span>
                <span className="font-bold text-white">{formatNaira(outstandingBalance)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="mt-8 text-xs text-purp-200 flex items-center gap-1 opacity-75">
          <ShieldCheck className="w-4 h-4" /> Secure payment powered by Paystack
        </div>
      </div>

      {/* Right Panel: Payment Interaction */}
      <div className="w-full md:w-7/12 lg:w-2/3 p-4 md:p-8 flex flex-col items-center justify-center gap-4">

        {/* Project Progress Card — only when project_total_value > 0 */}
        {referenceContext && referenceContext.hasProjectTotal && (
          <div className="w-full max-w-lg">
            <div className="bg-white border-2 border-purp-200 rounded-2xl p-4 space-y-3 shadow-sm">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-purp-100 rounded-lg flex items-center justify-center">
                  <Wallet className="w-4 h-4 text-purp-700" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">Project</p>
                  <p className="font-bold text-purp-900 text-sm leading-tight">{referenceContext.name}</p>
                </div>
              </div>

              {/* Progress bar */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-500">Collection Progress</span>
                  <span className={`font-bold ${
                    referenceContext.collectionProgress >= 100 ? "text-emerald-600" :
                    referenceContext.collectionProgress >= 80  ? "text-emerald-500" :
                    referenceContext.collectionProgress >= 50  ? "text-blue-600"   : "text-amber-600"
                  }`}>{referenceContext.collectionProgress}%</span>
                </div>
                <div className="w-full bg-neutral-100 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      referenceContext.collectionProgress >= 100 ? "bg-emerald-500" :
                      referenceContext.collectionProgress >= 80  ? "bg-emerald-400" :
                      referenceContext.collectionProgress >= 50  ? "bg-blue-500"   : "bg-amber-400"
                    }`}
                    style={{ width: `${Math.min(100, referenceContext.collectionProgress)}%` }}
                  />
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center bg-neutral-50 rounded-lg p-2">
                  <p className="text-[10px] text-neutral-400 font-medium uppercase tracking-wide">Total</p>
                  <p className="text-sm font-bold text-purp-900">{formatNaira(referenceContext.projectTotalValue)}</p>
                </div>
                <div className="text-center bg-emerald-50 rounded-lg p-2">
                  <p className="text-[10px] text-emerald-500 font-medium uppercase tracking-wide">Collected</p>
                  <p className="text-sm font-bold text-emerald-700">{formatNaira(referenceContext.totalCollected)}</p>
                </div>
                <div className={`text-center rounded-lg p-2 ${referenceContext.outstandingBalance > 0 ? "bg-amber-50" : "bg-emerald-50"}`}>
                  <p className={`text-[10px] font-medium uppercase tracking-wide ${referenceContext.outstandingBalance > 0 ? "text-amber-500" : "text-emerald-500"}`}>Outstanding</p>
                  <p className={`text-sm font-bold ${referenceContext.outstandingBalance > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                    {referenceContext.outstandingBalance > 0 ? formatNaira(referenceContext.outstandingBalance) : "Settled ✓"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        <Card className="w-full max-w-lg border-2 border-purp-200 shadow-xl shadow-purp-900/5">
          <CardHeader className="text-center pb-2">
            <h2 className="text-2xl font-bold text-purp-900">
              {cryptoDetails ? "Crypto Payment" : "Make a Payment"}
            </h2>
            <p className="text-neutral-500">
              {cryptoDetails ? "Send exact amount to the address below." : "Choose your preferred payment method."}
            </p>
          </CardHeader>
          <CardContent>
            {/* Payment Method Tabs */}
            {!cryptoDetails && (
              <div className="flex gap-2 mb-6 p-1 bg-neutral-100 rounded-xl">
                {/* Card / Bank */}
                <button
                  type="button"
                  onClick={() => setPaymentMethod("card")}
                  className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-lg text-xs font-semibold transition-all duration-200 ${
                    paymentMethod === "card"
                      ? "bg-white shadow text-purp-900 ring-1 ring-purp-200"
                      : "text-neutral-500 hover:text-neutral-700"
                  }`}
                >
                  <CreditCard className="h-5 w-5" />
                  <span>Card / Bank</span>
                </button>
                {/* Transfer */}
                <button
                  type="button"
                  onClick={() => setPaymentMethod("transfer")}
                  className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-lg text-xs font-semibold transition-all duration-200 ${
                    paymentMethod === "transfer"
                      ? "bg-white shadow text-purp-900 ring-1 ring-purp-200"
                      : "text-neutral-500 hover:text-neutral-700"
                  }`}
                >
                  <ArrowRightLeft className="h-5 w-5" />
                  <span>Transfer</span>
                </button>
                {/* Crypto — Coming Soon */}
                <button
                  type="button"
                  onClick={() => setPaymentMethod("crypto")}
                  className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-lg text-xs font-semibold transition-all duration-200 relative ${
                    paymentMethod === "crypto"
                      ? "bg-white shadow text-purp-900 ring-1 ring-purp-200"
                      : "text-neutral-400 hover:text-neutral-500"
                  }`}
                >
                  <Sparkles className="h-5 w-5" />
                  <span>Crypto</span>
                  <span className="absolute -top-1 -right-1 bg-amber-400 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none">SOON</span>
                </button>
              </div>
            )}
            {cryptoDetails ? (
              <div className="space-y-6 animate-in fade-in zoom-in duration-300">
                {/* existing crypto details UI — unchanged */}
                <div className="bg-neutral-900 text-white rounded-xl p-6 text-center space-y-4">
                  <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mx-auto">
                    <Wallet className="w-8 h-8 text-white" />
                  </div>
                  <div>
                    <p className="text-neutral-400 text-sm">Send Exact Amount</p>
                    <p className="text-3xl font-bold font-mono tracking-tight text-emerald-400">
                      {formatNaira(cryptoDetails.fiatAmount)}
                    </p>
                    <p className="text-neutral-500 text-xs mt-1">
                      Equivalent in {cryptoDetails.coin.toUpperCase()} ({cryptoDetails.network})
                    </p>
                  </div>
                </div>
                <div className="space-y-3">
                  <Label className="text-sm font-medium text-purp-900">Deposit Address ({cryptoDetails.network})</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={cryptoDetails.address} className="font-mono text-sm bg-purp-50 border-purp-200 text-purp-900 h-12" />
                    <Button onClick={() => handleCopy(cryptoDetails.address)} className="h-12 w-12 bg-purp-100 hover:bg-purp-200 text-purp-700 border-2 border-purp-200" variant="outline" title="Copy Address">
                      {copied ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Copy className="h-5 w-5" />}
                    </Button>
                  </div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800 text-sm flex items-start gap-3">
                  <Info className="h-5 w-5 flex-shrink-0 mt-0.5" />
                  <p>Ensure you send the exact equivalent of <strong>{formatNaira(cryptoDetails.fiatAmount)}</strong> on the <strong>{cryptoDetails.network}</strong> network.</p>
                </div>
              </div>
            ) : paymentMethod === "crypto" ? (
              /* Coming Soon state for Crypto */
              <div className="py-8 text-center space-y-4 animate-in fade-in duration-300">
                <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto border-2 border-amber-100">
                  <Sparkles className="w-8 h-8 text-amber-500" />
                </div>
                <div>
                  <h3 className="font-bold text-purp-900 text-lg">Coming Soon</h3>
                  <p className="text-neutral-500 text-sm mt-1 max-w-xs mx-auto">
                    Crypto payments will be available soon. This payment option is part of our MVP rollout.
                  </p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800 text-sm">
                  <p className="font-medium">This payment method is currently unavailable during MVP rollout.</p>
                  <p className="text-xs mt-1 text-amber-700">Please use Card/Bank or Transfer to complete your payment.</p>
                </div>
                <Button type="button" variant="outline" className="border-purp-200" onClick={() => setPaymentMethod("card")}>
                  Use Card / Bank Transfer Instead
                </Button>
              </div>
            ) : (
            <form onSubmit={handlePayment} className="space-y-6">
              <div className="space-y-3">
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-neutral-400">₦</span>
                  <Input
                    type="number"
                    value={inputAmount}
                    onChange={(e) => setInputAmount(e.target.value)}
                    max={outstandingBalance}
                    min={0}
                    step="0.01"
                    readOnly={!invoice.allow_partial_payment || !!invoice.partial_payment_pct}
                    className={`pl-12 h-20 text-3xl font-bold text-purp-900 border-2 rounded-xl ${
                      isBelowMinimum || isAboveMax
                        ? "border-red-400 focus:border-red-500 bg-red-50/50"
                        : "border-purp-200 focus:border-purp-700"
                    } ${( !invoice.allow_partial_payment || !!invoice.partial_payment_pct ) ? "bg-neutral-50 cursor-not-allowed opacity-80" : ""}`}
                  />
                </div>

                {/* Minimum payment info */}
                {invoice.allow_partial_payment && !invoice.partial_payment_pct && (
                  <div className="flex items-center justify-between text-xs text-neutral-500 px-1">
                    <span>Min: {formatNaira(minimumPayment)}</span>
                    <span>Max: {formatNaira(outstandingBalance)}</span>
                  </div>
                )}

                <div className="flex gap-2">
                  {invoice.allow_partial_payment && invoice.partial_payment_pct && (
                    <Button type="button" variant="outline" className="flex-1 border-purp-200" onClick={() => handleQuickSelect(Number(invoice.partial_payment_pct) / 100)}>{invoice.partial_payment_pct}%</Button>
                  )}
                  {invoice.allow_partial_payment && !invoice.partial_payment_pct && (
                    <>
                      <Button type="button" variant="outline" className="flex-1 border-purp-200" onClick={() => handleQuickSelect(0.25)}>25%</Button>
                      <Button type="button" variant="outline" className="flex-1 border-purp-200" onClick={() => handleQuickSelect(0.5)}>50%</Button>
                    </>
                  )}
                  {(!invoice.allow_partial_payment || invoice.partial_payment_pct) && (
                    <Button type="button" variant="outline" className="flex-1 border-purp-200 text-purp-900 font-bold" onClick={() => handleQuickSelect(1)}>Full Amount</Button>
                  )}
                  {invoice.allow_partial_payment && !invoice.partial_payment_pct && (
                    <Button type="button" variant="outline" className="flex-1 border-purp-200 text-purp-900 font-bold" onClick={() => handleQuickSelect(1)}>Full</Button>
                  )}
                </div>
              </div>

              {/* Validation Error Messages */}
              {isBelowMinimum && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-semibold text-red-700">Amount too low</p>
                    <p className="text-red-600 mt-1">
                      The minimum payment is <strong>{formatNaira(minimumPayment)}</strong> (10% of the invoice total, capped at ₦1,000).
                      Please enter at least {formatNaira(minimumPayment)} to proceed.
                    </p>
                  </div>
                </div>
              )}

              {isAboveMax && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-semibold text-red-700">Amount exceeds balance</p>
                    <p className="text-red-600 mt-1">
                      Your payment cannot exceed the outstanding balance of <strong>{formatNaira(outstandingBalance)}</strong>.
                      Use the &quot;Full&quot; button to pay the entire balance.
                    </p>
                  </div>
                </div>
              )}

              {exceedsRemainingLimit && !isAboveMax && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-semibold text-red-700">Merchant Limit Exceeded</p>
                    <p className="text-red-600 mt-1">
                      This amount exceeds the merchant's remaining monthly collection limit (<strong>{formatNaira(remainingLimit)}</strong> left). 
                      Please enter a smaller amount or contact the merchant directly.
                    </p>
                  </div>
                </div>
              )}

              {/* Proportional Allocation Card */}
              {isValidAmount && (
                <div className="bg-purp-50 border border-purp-200 rounded-xl p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-purp-100 flex items-center justify-center flex-shrink-0">
                      <Receipt className="w-4 h-4 text-purp-700" />
                    </div>
                    <div className="text-sm">
                      <p className="font-bold text-purp-900">Proportional Allocation</p>
                      <p className="text-neutral-500 mt-1">
                        Out of this payment, <strong className="text-purp-700">{formatNaira(allocation.taxCollected)}</strong> goes to tax and <strong className="text-red-500">{formatNaira(allocation.discountApplied)}</strong> covers your discount proportionally.
                      </p>
                    </div>
                  </div>

                  {invoice.fee_absorption === "customer" && (
                    <div className="pt-4 border-t border-purp-200 space-y-2 text-sm">
                      <div className="flex justify-between text-neutral-500">
                        <span>Payment Amount</span><span>{formatNaira(allocation.amountPaid)}</span>
                      </div>
                      <div className="flex justify-between text-neutral-500">
                        <span>Processing Fee</span><span>{formatNaira(allocation.paystackFee)}</span>
                      </div>
                      <div className="flex justify-between font-bold text-purp-900 pt-2 border-t border-purp-200 border-dashed">
                        <span>Total to Pay</span><span>{formatNaira(allocation.totalCharge)}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {paymentError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-red-700">Payment Error</p>
                    <p className="text-red-600 mt-1">{paymentError}</p>
                  </div>
                </div>
              )}

              <Button
                type="submit"
                disabled={isProcessing || !isValidAmount}
                className="w-full h-14 bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing
                  ? "Processing..."
                  : !isValidAmount
                  ? `Enter ${formatNaira(minimumPayment)} – ${formatNaira(outstandingBalance)}`
                  : `Pay ${invoice.fee_absorption === "customer" ? formatNaira(allocation.totalCharge) : formatNaira(allocation.amountPaid)}`}
              </Button>
            </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
