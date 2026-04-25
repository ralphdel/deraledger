"use client";

import { use, useState, useEffect } from "react";
import { formatNaira, calculateProportionalPayment, getMinimumPayment } from "@/lib/calculations";
import { getPublicInvoice } from "@/lib/data";
import type { InvoiceWithLineItems, Merchant } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ShieldCheck, Receipt, Clock, CheckCircle2, Lock, AlertTriangle, Info } from "lucide-react";
import Script from "next/script";

export default function PublicPaymentPortal({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = use(params);
  const [invoice, setInvoice] = useState<InvoiceWithLineItems | null>(null);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [monthlyCollected, setMonthlyCollected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [inputAmount, setInputAmount] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  useEffect(() => {
    getPublicInvoice(invoiceId).then((result) => {
      if (result) {
        setInvoice(result.invoice);
        setMerchant(result.merchant);
        setMonthlyCollected(result.monthlyCollected);
        setInputAmount(Number(result.invoice.outstanding_balance).toString());
      }
      setLoading(false);
    });
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

  const businessName = merchant?.business_name || "PurpLedger Merchant";

  // ── Invoice status logic ──────────────────────────────────────────────────
  // Check if merchant limit is exceeded
  const isStarter = merchant?.merchant_tier === "starter";
  const limitExceeded = isStarter || (merchant?.monthly_collection_limit ? monthlyCollected >= merchant.monthly_collection_limit : false);

  // Manually closed or fully closed → no more payments accepted
  const isManuallyClosed = invoice.status === "manually_closed";
  const isFullyClosed = invoice.status === "closed";
  const isVoid = invoice.status === "void";

  // Expired means link has expired (past pay-by date),
  // but the invoice is NOT closed — it can only be manually closed by merchant
  const isExpired = invoice.status === "expired";

  // We no longer strictly block just because the date passed, 
  // so that reopened invoices stay active until explicitly expired again.
  // Determine if payment should be blocked
  const isPaymentBlocked = isManuallyClosed || isFullyClosed || isVoid || isExpired || limitExceeded;

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
              {limitExceeded ? "Merchant Limit Reached" : isClosed ? "Invoice Closed" : "Payment Link Expired"}
            </h1>
            <p className="text-neutral-500">
              {limitExceeded
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

  // ── Payment calculations ──────────────────────────────────────────────────
  const outstandingBalance = Number(invoice.outstanding_balance);
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

    // Check if Paystack public key is configured
    const paystackKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY;
    if (paystackKey && paystackKey !== "pk_test_your_public_key_here" && paystackKey.startsWith("pk_")) {
      // Live Paystack Inline integration
      const handler = (window as unknown as Record<string, unknown>).PaystackPop as {
        setup: (config: Record<string, unknown>) => { openIframe: () => void };
      } | undefined;

      if (handler) {
        try {
          const chargeAmount = invoice.fee_absorption === "customer"
            ? Math.round(allocation.totalCharge * 100)
            : Math.round(parsedAmount * 100);

          const payHandler = handler.setup({
            key: paystackKey,
            email: invoice.clients?.email || "customer@purpledger.app",
            amount: chargeAmount,
            currency: "NGN",
            ref: `purp_${invoice.id.slice(0, 8)}_${Date.now()}`,
            metadata: {
              invoice_id: invoice.id,
              invoice_number: invoice.invoice_number,
              merchant_id: invoice.merchant_id,
              payment_amount: parsedAmount,
              k_factor: allocation.kFactor,
            },
            callback: function(response: any) {
              // In local dev, webhooks won't work, so we hit the demo endpoint as a fallback 
              // to actually record the transaction so it works on localhost.
              if (window.location.hostname === "localhost") {
                fetch("/api/demo-payment", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    invoiceId: invoice.id,
                    paymentAmount: parsedAmount,
                  }),
                }).catch(e => console.error("Fallback to demo-payment failed", e));
              }
              setIsProcessing(false);
              setSuccess(true);
            },
            onClose: function() {
              setIsProcessing(false);
            },
          });
          payHandler.openIframe();
          return;
        } catch (err: any) {
          console.error("Paystack popup failed to load:", err);
          setIsProcessing(false);
          setPaymentError("Payment interface failed to load. Please try again.");
          return;
        }
      }
    }

    // DEMO MODE: Actually writes to the database via the demo endpoint
    try {
      setPaymentError(null);
      const res = await fetch("/api/demo-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: invoice.id,
          paymentAmount: parsedAmount,
        }),
      });
      const result = await res.json();
      if (result.success) {
        setSuccess(true);
      } else {
        setPaymentError("Payment failed: " + result.error);
      }
    } catch (err) {
      setPaymentError("Payment could not be processed. Please try again or contact support.");
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-purp-50 flex flex-col items-center justify-center p-4">
        <Card className="max-w-md w-full border-2 border-emerald-200">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-10 h-10 text-emerald-600" />
            </div>
            <h1 className="text-2xl font-bold text-purp-900">Payment Successful</h1>
            <p className="text-neutral-500 pb-4">
              Your payment of <strong className="text-emerald-700">{formatNaira(allocation.amountPaid)}</strong> has been processed securely.
            </p>
            <div className="bg-purp-50 p-4 rounded-lg text-left text-sm space-y-2 border border-purp-100">
              <div className="flex justify-between">
                <span className="text-neutral-500">Invoice</span>
                <span className="font-medium text-purp-900">{invoice.invoice_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Remaining Balance</span>
                <span className="font-medium text-amber-600">{formatNaira(allocation.newOutstandingBalance)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
        <div className="mt-8 flex items-center gap-2 text-neutral-400 text-sm">
          <Lock className="w-4 h-4" /> SECURED BY PURPLEDGER
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full bg-[#F8F7FF] flex flex-col md:flex-row">
      <Script src="https://js.paystack.co/v1/inline.js" strategy="lazyOnload" />
      {/* Left Panel: Invoice Details */}
      <div className="w-full md:w-5/12 lg:w-1/3 bg-purp-900 text-white p-6 md:p-8 flex flex-col md:h-screen md:sticky md:top-0 md:overflow-y-auto">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-purp-900 font-bold text-xl">
            {businessName.charAt(0)}
          </div>
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
                  <span>Grand Total</span><span>{formatNaira(grandTotal)}</span>
                </div>
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
      <div className="w-full md:w-7/12 lg:w-2/3 p-4 md:p-8 flex items-center justify-center">
        <Card className="w-full max-w-lg border-2 border-purp-200 shadow-xl shadow-purp-900/5">
          <CardHeader className="text-center pb-2">
            <h2 className="text-2xl font-bold text-purp-900">Make a Payment</h2>
            <p className="text-neutral-500">You can pay in full or make a partial payment.</p>
          </CardHeader>
          <CardContent>
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
                    className={`pl-12 h-20 text-3xl font-bold text-purp-900 border-2 rounded-xl ${
                      isBelowMinimum || isAboveMax
                        ? "border-red-400 focus:border-red-500 bg-red-50/50"
                        : "border-purp-200 focus:border-purp-700"
                    }`}
                  />
                </div>

                {/* Minimum payment info */}
                <div className="flex items-center justify-between text-xs text-neutral-500 px-1">
                  <span>Min: {formatNaira(minimumPayment)}</span>
                  <span>Max: {formatNaira(outstandingBalance)}</span>
                </div>

                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1 border-purp-200" onClick={() => handleQuickSelect(0.25)}>25%</Button>
                  <Button type="button" variant="outline" className="flex-1 border-purp-200" onClick={() => handleQuickSelect(0.5)}>50%</Button>
                  <Button type="button" variant="outline" className="flex-1 border-purp-200 text-purp-900 font-bold" onClick={() => handleQuickSelect(1)}>Full</Button>
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
