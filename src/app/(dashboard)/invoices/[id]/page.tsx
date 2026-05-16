"use client";

import { use, useState, useEffect, useTransition } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  CheckCircle,
  Clock,
  XCircle,
  AlertTriangle,
  MessageCircle,
  Mail,
  Share2,
  Send,
  RotateCcw,
  Pencil,
  History,
  User,
  Wallet,
  Printer,
  BookOpen,
  CreditCard,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { getInvoiceById, getTransactions, getMerchant, getMonthlyCollectionTotal, getManualPayments } from "@/lib/data";
import { closeInvoiceManually, reopenInvoice, getInvoiceHistory, sendInvoiceEmailAction, getInvoiceAllocationsAction } from "@/lib/actions";
import { MANUAL_CLOSE_REASONS } from "@/lib/types";
import type { InvoiceWithLineItems, Transaction, Merchant, AuditLog } from "@/lib/types";
import { formatNaira, getStatusColor, getStatusLabel } from "@/lib/calculations";
import { RecordPaymentDrawer } from "@/components/RecordPaymentDrawer";

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [invoice, setInvoice] = useState<InvoiceWithLineItems | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [history, setHistory] = useState<AuditLog[]>([]);
  const [monthlyCollected, setMonthlyCollected] = useState(0);
  const [depositAllocated, setDepositAllocated] = useState(0);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [closeExplanation, setCloseExplanation] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [reopenDialogOpen, setReopenDialogOpen] = useState(false);
  const [paymentDrawerOpen, setPaymentDrawerOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const refreshData = async () => {
    const [inv, txns, manualTxns, merch, collected, allocationsRes] = await Promise.all([
      getInvoiceById(id),
      getTransactions(id),
      getManualPayments(id),
      getMerchant(),
      getMonthlyCollectionTotal(),
      getInvoiceAllocationsAction(id)
    ]);
    setInvoice(inv);
    if (allocationsRes.success) {
      const totalAllocated = allocationsRes.allocations.reduce((sum: number, a: any) => sum + Number(a.allocated_amount), 0);
      setDepositAllocated(totalAllocated);
    }
    
    // Combine online transactions and manual payments into a unified array
    const combinedHistory = [
      ...txns.map(t => ({
        id: t.id,
        date: t.created_at,
        reference: t.paystack_reference || "-",
        method: t.payment_method,
        amount: t.amount_paid,
        status: t.status,
      })),
      ...manualTxns.map(m => ({
        id: m.id,
        date: m.date_received,
        reference: m.reference_note || "-",
        method: m.payment_method,
        amount: m.amount,
        status: "success (manual)",
      }))
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    setTransactions(combinedHistory as any);
    setMerchant(merch);
    setMonthlyCollected(collected);
    if (inv?.clients?.email) setEmailTo(inv.clients.email);
    // Fetch history from server action
    let h = await getInvoiceHistory(id);
    setHistory(h);
  };

  useEffect(() => {
    refreshData().then(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-purp-700 dark:border-[#7B2FF7] border-t-transparent dark:border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-neutral-500 dark:text-white/60">Loading invoice...</p>
        </div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <h2 className="text-xl font-bold text-purp-900 dark:text-white">Invoice Not Found</h2>
          <p className="text-neutral-500 dark:text-white/60 mt-2">The requested invoice doesn&apos;t exist.</p>
          <Link href="/invoices">
            <Button className="mt-4 bg-purp-900 hover:bg-purp-700 dark:bg-[#7B2FF7] dark:hover:bg-[#B58CFF] dark:hover:text-[#12061F] text-white">Back to Invoices</Button>
          </Link>
        </div>
      </div>
    );
  }

  const trueOutstanding = Math.max(0, Number(invoice.outstanding_balance));

  const paymentProgress =
    Number(invoice.grand_total) > 0
      ? Math.min(100, Math.round(((Number(invoice.amount_paid) + depositAllocated) / Number(invoice.grand_total)) * 100))
      : 0;

  const paymentUrl = `${typeof window !== "undefined" ? window.location.origin : "https://deraledger.app"}/pay/${invoice.id}`;
  const displayLink = invoice.short_link || paymentUrl.replace(/^https?:\/\//, "");

  const copyLink = () => {
    navigator.clipboard.writeText(paymentUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareViaWhatsApp = () => {
    const clientName = invoice.clients?.full_name || "Client";
    const businessName = merchant?.business_name || "Deraledger";
    const message = encodeURIComponent(
      `Hi ${clientName},\n\n` +
      `You have an invoice from *${businessName}*:\n\n` +
      `📄 Invoice: ${invoice.invoice_number}\n` +
      `💰 Amount Due: ${formatNaira(trueOutstanding)}\n\n` +
      `Pay securely here:\n${paymentUrl}\n\n` +
      `Thank you for your business! 🙏`
    );
    window.open(`https://api.whatsapp.com/send?text=${message}`, "_blank");
  };

  const sendEmail = () => {
    if (!emailTo) return;
    
    startTransition(async () => {
      setEmailSending(true);
      const clientName = invoice.clients?.full_name || "Client";
      const businessName = merchant?.business_name || "Deraledger";
      
      const result = await sendInvoiceEmailAction({
        toEmail: emailTo,
        clientName,
        businessName,
        invoiceNumber: invoice.invoice_number,
        grandTotal: formatNaira(Number(invoice.grand_total)),
        amountPaid: formatNaira(Number(invoice.amount_paid) + depositAllocated),
        outstandingBalance: formatNaira(trueOutstanding),
        payByDate: invoice.pay_by_date ? new Date(invoice.pay_by_date).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" }) : "",
        paymentUrl,
      });

      setEmailSending(false);
      if (result.success) {
        setEmailSent(true);
        setTimeout(() => setEmailSent(false), 3000);
      } else {
        alert("Failed to send email: " + result.error);
      }
    });
  };

  const handleManualClose = () => {
    const reason = closeReason === "Other" && closeExplanation.length >= 20
      ? closeExplanation
      : closeReason;
    if (!reason) return;

    startTransition(async () => {
      const result = await closeInvoiceManually(invoice.id, reason);
      if (result.success) {
        setCloseDialogOpen(false);
        setCloseReason("");
        setCloseExplanation("");
        await refreshData();
      }
    });
  };

  const handleReopen = () => {
    startTransition(async () => {
      const result = await reopenInvoice(invoice.id, Number(invoice.amount_paid));
      if (result.success) {
        setReopenDialogOpen(false);
        await refreshData();
      }
    });
  };

  // Whether the invoice can be reopened (expired or manually_closed)
  const canReopen = invoice.status === "expired" || invoice.status === "manually_closed";
  // Whether the invoice can be edited (open, partially_paid, or expired/manually_closed to allow changes before reopening)
  const canEdit = ["open", "partially_paid", "expired", "manually_closed"].includes(invoice.status);
  // Whether the payment link is active
  const isStarter = (merchant?.subscription_plan || merchant?.merchant_tier || "starter") === "starter";
  const limitExceeded = isStarter || (merchant?.monthly_collection_limit ? monthlyCollected >= merchant.monthly_collection_limit : false);
  const isUnverified = merchant?.verification_status !== "verified";
  const missingSettlement = !merchant?.settlement_account_number;
  
  const isLinkActive = (invoice.status === "open" || invoice.status === "partially_paid") 
    && !limitExceeded 
    && !isUnverified
    && !missingSettlement
    && invoice.invoice_type !== "record";

  const statusIcons: Record<string, React.ElementType> = {
    open: Clock, partially_paid: AlertTriangle, closed: CheckCircle,
    manually_closed: CheckCircle, expired: XCircle, void: XCircle,
  };
  const StatusIcon = statusIcons[invoice.status] || Clock;

  const clientName = invoice.clients?.full_name || "Unknown Client";
  const clientEmail = invoice.clients?.email || "";
  const isRecordInvoice = invoice.invoice_type === "record";

  // History helpers
  const getEventLabel = (eventType: string) => {
    const labels: Record<string, string> = {
      manual_close: "Manually Closed",
      reopen: "Reopened",
      edit: "Edited",
      payment_received: "Payment Received",
      created: "Created",
    };
    return labels[eventType] || eventType;
  };

  const getEventColor = (eventType: string) => {
    const colors: Record<string, string> = {
      manual_close: "bg-red-100 text-red-700 border-red-200",
      reopen: "bg-blue-100 text-blue-700 border-blue-200",
      edit: "bg-amber-100 text-amber-700 border-amber-200",
      payment_received: "bg-emerald-100 text-emerald-700 border-emerald-200",
      created: "bg-purp-100 text-purp-700 border-purp-200",
    };
    return colors[eventType] || "bg-gray-100 text-gray-600 border-gray-200";
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/invoices">
            <Button variant="outline" size="icon" className="border-2 border-purp-200 dark:border-white/10 dark:text-white dark:bg-white/5 dark:hover:bg-white/10">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-purp-900 dark:text-white">{invoice.invoice_number}</h1>
              <Badge variant="outline" className={`${getStatusColor(invoice.status)} border-2 dark:border font-semibold text-xs`}>
                <StatusIcon className="mr-1 h-3 w-3" />
                {getStatusLabel(invoice.status)}
              </Badge>
              {isRecordInvoice && (
                <Badge variant="outline" className="border-2 border-neutral-300 dark:border-white/20 bg-neutral-100 dark:bg-white/10 text-neutral-700 dark:text-white/80 text-xs font-semibold">
                  Record
                </Badge>
              )}
            </div>
            <p className="text-neutral-500 dark:text-white/60 text-sm mt-0.5">{clientName} · {clientEmail}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Edit Button */}
          {canEdit && (
            <Link href={`/invoices/${invoice.id}/edit`} className="print:hidden">
              <Button variant="outline" className="border-2 border-purp-200 dark:border-white/10 text-purp-700 dark:text-white hover:bg-purp-100 dark:hover:bg-white/10 dark:bg-white/5">
                <Pencil className="mr-2 h-4 w-4" /> Edit Invoice
              </Button>
            </Link>
          )}

          {/* Download PDF Button for Record Invoices */}
          {isRecordInvoice && (
            <Button
              variant="outline"
              className="border-2 border-purp-200 dark:border-white/10 text-purp-700 dark:text-white hover:bg-purp-100 dark:hover:bg-white/10 dark:bg-white/5 print:hidden"
              onClick={() => window.open(`/invoices/${invoice.id}/print`, "_blank")}
            >
              <Printer className="mr-2 h-4 w-4" /> Download PDF
            </Button>
          )}

          {/* Reopen Button */}
          {canReopen && (
            <Dialog open={reopenDialogOpen} onOpenChange={setReopenDialogOpen}>
              <DialogTrigger
                render={<Button variant="outline" className="border-2 border-blue-200 dark:border-blue-500/30 text-blue-700 dark:text-blue-400 dark:bg-blue-500/10 hover:bg-blue-50 dark:hover:bg-blue-500/20 print:hidden" />}
              >
                <RotateCcw className="mr-2 h-4 w-4" /> Reopen Invoice
              </DialogTrigger>
              <DialogContent className="border-2 border-purp-200 dark:border-white/10 dark:bg-[#1A0B2E]">
                <DialogHeader>
                  <DialogTitle className="text-purp-900 dark:text-white">Reopen Invoice</DialogTitle>
                  <DialogDescription className="dark:text-white/60">
                    This will reactivate the invoice and make the payment link active again.
                    {Number(invoice.amount_paid) > 0
                      ? ` The status will be set to "Partially Paid" since ${formatNaira(Number(invoice.amount_paid))} has already been collected.`
                      : ` The status will be set to "Open".`}
                  </DialogDescription>
                </DialogHeader>
                <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-lg p-3 text-sm text-blue-800 dark:text-blue-400">
                  <p className="font-medium">What happens when you reopen:</p>
                  <ul className="list-disc list-inside mt-1 space-y-1 text-xs">
                    <li>Payment link becomes active again</li>
                    <li>You can add late fees or additional items via &quot;Edit Invoice&quot;</li>
                    <li>Discount can be modified or removed</li>
                    <li>This action is recorded in invoice history</li>
                  </ul>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setReopenDialogOpen(false)}
                    className="border-2 border-purp-200 dark:border-white/10 dark:text-white dark:hover:bg-white/5"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleReopen}
                    disabled={isPending}
                    className="bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 text-white"
                  >
                    {isPending ? "Reopening..." : "Confirm Reopen"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

          {/* Manual Close Button */}
          {(invoice.status === "open" || invoice.status === "partially_paid") && (
            <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
              <DialogTrigger
                render={<Button variant="outline" className="border-2 border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 dark:bg-red-500/10 hover:bg-red-50 dark:hover:bg-red-500/20 print:hidden" />}
              >
                Close Manually
              </DialogTrigger>
              <DialogContent className="border-2 border-purp-200 dark:border-white/10 dark:bg-[#1A0B2E]">
                <DialogHeader>
                  <DialogTitle className="text-purp-900 dark:text-white">Close Invoice Manually</DialogTitle>
                  <DialogDescription className="dark:text-white/60">
                    Outstanding balance of{" "}
                    <strong className="dark:text-white">{formatNaira(trueOutstanding)}</strong> will
                    remain unpaid. You can reopen this invoice later if needed.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium dark:text-white/80">Reason Code *</Label>
                    <Select value={closeReason} onValueChange={(v) => setCloseReason(v ?? "")}>
                      <SelectTrigger className="border-2 border-purp-200 dark:border-white/10 dark:bg-white/5 dark:text-white">
                        <SelectValue placeholder="Select a reason" />
                      </SelectTrigger>
                      <SelectContent className="border-2 border-purp-200">
                        {MANUAL_CLOSE_REASONS.map((reason) => (
                          <SelectItem key={reason} value={reason}>{reason}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {closeReason === "Other" && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Explanation (min 20 characters) *</Label>
                      <Textarea
                        value={closeExplanation}
                        onChange={(e) => setCloseExplanation(e.target.value)}
                        className="border-2 border-purp-200 min-h-[80px]"
                        placeholder="Please explain..."
                      />
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setCloseDialogOpen(false)}
                    className="border-2 border-purp-200"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleManualClose}
                    disabled={isPending || !closeReason || (closeReason === "Other" && closeExplanation.length < 20)}
                    className="bg-red-600 hover:bg-red-700 text-white"
                  >
                    {isPending ? "Closing..." : "Confirm Manual Closure"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main Info */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="details" className="w-full">
            <TabsList variant="line" className="w-full justify-start border-b-2 border-purp-200 dark:border-white/10 mb-6 gap-6">
              <TabsTrigger value="details" className="text-sm py-2 dark:text-white/60 dark:data-[state=active]:text-white dark:data-[state=active]:border-white">
                Invoice Details
              </TabsTrigger>
              <TabsTrigger value="history" className="text-sm py-2 dark:text-white/60 dark:data-[state=active]:text-white dark:data-[state=active]:border-white">
                Payment History
              </TabsTrigger>
              <TabsTrigger value="activity" className="text-sm py-2 dark:text-white/60 dark:data-[state=active]:text-white dark:data-[state=active]:border-white">
                Activity Log
              </TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="space-y-6 mt-0">
              {/* Payment Progress */}
          <Card className="border-2 border-purp-200 dark:border-white/10 shadow-none dark:bg-white/5">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-neutral-500 dark:text-white/60">Payment Progress</span>
                <span className="text-sm font-bold text-purp-900 dark:text-white">{paymentProgress}%</span>
              </div>
              <div className="w-full h-3 bg-purp-100 dark:bg-white/5 rounded-full border border-purp-200 dark:border-white/10 overflow-hidden">
                <div className="h-full bg-purp-700 dark:bg-[#7B2FF7] rounded-full transition-all duration-500" style={{ width: `${paymentProgress}%` }} />
              </div>
              <div className="flex items-center justify-between mt-3 text-sm">
                <div>
                  <span className="text-neutral-500 dark:text-white/60">Paid: </span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">{formatNaira(Number(invoice.amount_paid) + depositAllocated)}</span>
                </div>
                <div>
                  <span className="text-neutral-500 dark:text-white/60">Outstanding: </span>
                  <span className="font-semibold text-amber-600 dark:text-amber-400">{formatNaira(trueOutstanding)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card className="border-2 border-purp-200 dark:border-white/10 shadow-none dark:bg-[#1A0B2E]">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold text-purp-900 dark:text-white">Line Items</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="bg-purp-50 dark:bg-white/5 border-b-2 border-purp-200 dark:border-white/10 hover:bg-purp-50 dark:hover:bg-white/5">
                    <TableHead className="font-bold text-purp-900 dark:text-white/60 text-xs uppercase">#</TableHead>
                    <TableHead className="font-bold text-purp-900 dark:text-white/60 text-xs uppercase">Description</TableHead>
                    <TableHead className="font-bold text-purp-900 dark:text-white/60 text-xs uppercase text-right">Qty</TableHead>
                    <TableHead className="font-bold text-purp-900 dark:text-white/60 text-xs uppercase text-right">Unit Rate</TableHead>
                    <TableHead className="font-bold text-purp-900 dark:text-white/60 text-xs uppercase text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(invoice.line_items || []).map((item, idx) => (
                    <TableRow key={item.id} className="border-b border-purp-200 dark:border-white/10">
                      <TableCell className="text-sm text-neutral-500 dark:text-white/50">{idx + 1}</TableCell>
                      <TableCell className="font-medium text-sm dark:text-white">{item.item_name}</TableCell>
                      <TableCell className="text-right text-sm dark:text-white">{item.quantity}</TableCell>
                      <TableCell className="text-right text-sm dark:text-white">{formatNaira(Number(item.unit_rate))}</TableCell>
                      <TableCell className="text-right font-semibold text-sm dark:text-white">{formatNaira(Number(item.line_total))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="mt-4 space-y-2 max-w-xs ml-auto">
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-500 dark:text-white/60">Subtotal</span>
                  <span className="font-medium dark:text-white">{formatNaira(Number(invoice.subtotal))}</span>
                </div>
                {Number(invoice.discount_pct) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500 dark:text-white/60">Discount ({invoice.discount_pct}%)</span>
                    <span className="text-red-500 dark:text-red-400">-{formatNaira(Number(invoice.discount_value))}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-500 dark:text-white/60">Tax ({invoice.tax_pct}%)</span>
                  <span className="dark:text-white">+{formatNaira(Number(invoice.tax_value))}</span>
                </div>
                <Separator className="bg-purp-200 dark:bg-white/10" />
                <div className="flex justify-between">
                  <span className="font-bold text-purp-900 dark:text-white">Service Total</span>
                  <span className="font-bold text-purp-900 dark:text-white text-lg">{formatNaira(Number(invoice.grand_total))}</span>
                </div>
                {depositAllocated > 0 && (
                  <>
                    <div className="flex justify-between text-blue-600 dark:text-blue-400 font-medium">
                      <span>Previously Paid Deposit</span>
                      <span>-{formatNaira(depositAllocated)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-purp-900 dark:text-white pt-2 border-t border-purp-100 dark:border-white/10">
                      <span>Outstanding Amount</span>
                      <span>{formatNaira(trueOutstanding)}</span>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
            </TabsContent>

            <TabsContent value="history" className="mt-0">
              {/* Payment History */}
              <Card className="border-2 border-purp-200 dark:border-white/10 shadow-none dark:bg-[#1A0B2E]">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold text-purp-900 dark:text-white">Payment History</CardTitle>
            </CardHeader>
            <CardContent>
              {transactions.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-purp-50 dark:bg-white/5 border-b-2 border-purp-200 dark:border-white/10 hover:bg-purp-50 dark:hover:bg-white/5">
                      <TableHead className="font-bold text-purp-900 dark:text-white/60 text-xs uppercase">Date</TableHead>
                      <TableHead className="font-bold text-purp-900 dark:text-white/60 text-xs uppercase">Reference</TableHead>
                      <TableHead className="font-bold text-purp-900 dark:text-white/60 text-xs uppercase">Method</TableHead>
                      <TableHead className="font-bold text-purp-900 dark:text-white/60 text-xs uppercase text-right">Amount</TableHead>
                      <TableHead className="font-bold text-purp-900 dark:text-white/60 text-xs uppercase">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((txn: any) => (
                      <TableRow key={txn.id} className="border-b border-purp-200 dark:border-white/10 hover:bg-purp-50 dark:hover:bg-white/5">
                        <TableCell className="text-sm dark:text-white">
                          {new Date(txn.date).toLocaleDateString("en-NG", {
                            day: "numeric", month: "short", year: "numeric",
                          })}
                        </TableCell>
                        <TableCell className="text-sm font-mono text-purp-700 dark:text-[#B58CFF]">
                          <div className="flex items-center gap-2">
                            <span className="truncate max-w-[120px] inline-block" title={txn.reference}>{txn.reference}</span>
                            {txn.status === "success (manual)" && txn.reference !== "-" && (
                              <Dialog>
                                <DialogTrigger render={<Button variant="ghost" size="icon" className="h-6 w-6 text-purp-500 dark:text-[#7B2FF7] hover:text-purp-700 dark:hover:text-[#B58CFF] hover:bg-purp-100 dark:hover:bg-white/10 rounded-full" />}>
                                  <MessageCircle className="h-3.5 w-3.5" />
                                </DialogTrigger>
                                <DialogContent className="border-2 border-purp-200 dark:border-white/10 dark:bg-[#1A0B2E]">
                                  <DialogHeader>
                                    <DialogTitle className="text-purp-900 dark:text-white">Payment Note</DialogTitle>
                                    <DialogDescription className="dark:text-white/60">Note added during manual payment</DialogDescription>
                                  </DialogHeader>
                                  <div className="bg-purp-50 dark:bg-white/5 p-4 rounded-md border border-purp-100 dark:border-white/10 text-sm whitespace-pre-wrap text-neutral-700 dark:text-white/80">
                                    {txn.reference}
                                  </div>
                                </DialogContent>
                              </Dialog>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm capitalize dark:text-white">{txn.method.replace("_", " ")}</TableCell>
                        <TableCell className="text-right font-semibold text-sm dark:text-white">{formatNaira(Number(txn.amount))}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20 border-2 text-xs font-semibold">
                            {txn.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-center text-neutral-500 py-8 text-sm">No payments recorded yet.</p>
              )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="activity" className="mt-0">
            {/* Invoice Activity History */}
            <Card className="border-2 border-purp-200 dark:border-white/10 shadow-none dark:bg-[#1A0B2E]">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold text-purp-900 dark:text-white flex items-center gap-2">
                <History className="h-4 w-4" /> Invoice History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {history.filter(h => h.event_type !== "payment_received").length > 0 ? (
                <div className="relative">
                  {/* Timeline line */}
                  <div className="absolute left-[15px] top-2 bottom-2 w-0.5 bg-purp-200 dark:bg-white/10" />
                  <div className="space-y-4">
                    {history.filter(h => h.event_type !== "payment_received").map((event) => {
                      const meta = event.metadata as Record<string, unknown>;
                      return (
                        <div key={event.id} className="flex items-start gap-3 relative">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border-2 z-10 ${getEventColor(event.event_type)} dark:border-transparent dark:bg-white/10 dark:text-white`}>
                            {event.event_type === "manual_close" && <XCircle className="h-3.5 w-3.5" />}
                            {event.event_type === "reopen" && <RotateCcw className="h-3.5 w-3.5" />}
                            {event.event_type === "edit" && <Pencil className="h-3.5 w-3.5" />}
                            {!["manual_close", "reopen", "edit"].includes(event.event_type) && <User className="h-3.5 w-3.5" />}
                          </div>
                          <div className="flex-1 min-w-0 bg-purp-50/50 dark:bg-white/5 border border-purp-100 dark:border-white/10 rounded-lg p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <Badge variant="outline" className={`${getEventColor(event.event_type)} dark:border-white/10 dark:text-white/80 border text-xs font-semibold`}>
                                  {getEventLabel(event.event_type)}
                                </Badge>
                                {typeof meta?.reason === "string" && meta.reason && (
                                  <p className="text-sm text-neutral-600 dark:text-white/60 mt-1.5">
                                    Reason: <span className="font-medium dark:text-white">{meta.reason}</span>
                                  </p>
                                )}
                                {typeof meta?.status === "string" && meta.status && (
                                  <p className="text-sm text-neutral-600 dark:text-white/60 mt-1.5">
                                    Status set to: <span className="font-medium capitalize dark:text-white">{meta.status.replace("_", " ")}</span>
                                  </p>
                                )}
                                {typeof meta?.changes === "string" && meta.changes && (
                                  <p className="text-sm text-neutral-600 dark:text-white/60 mt-1.5">{meta.changes}</p>
                                )}
                              </div>
                              <span className="text-xs text-neutral-400 dark:text-white/40 whitespace-nowrap">
                                {new Date(event.created_at).toLocaleDateString("en-NG", {
                                  day: "numeric", month: "short", year: "numeric",
                                  hour: "2-digit", minute: "2-digit",
                                })}
                              </span>
                            </div>
                            <p className="text-xs text-neutral-400 dark:text-white/40 mt-1.5 flex justify-between">
                              <span>By: {meta?.actor_name ? (meta.actor_name as string) : (event.actor_role === "merchant" ? "System" : event.actor_role)}</span>
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="text-center text-neutral-500 dark:text-white/50 py-8 text-sm">No activity recorded yet.</p>
              )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Sidebar */}
        <div className="space-y-6">
          {/* Invoice Type Indicator */}
          <Card className={`border-2 shadow-none ${isRecordInvoice ? "border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10" : "border-blue-200 bg-blue-50 dark:border-blue-500/20 dark:bg-blue-500/10"}`}>
            <CardContent className="p-4 flex items-start gap-3">
              <div className={`mt-0.5 p-2 rounded-lg ${isRecordInvoice ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400" : "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400"}`}>
                {isRecordInvoice ? <BookOpen className="h-5 w-5" /> : <CreditCard className="h-5 w-5" />}
              </div>
              <div>
                <h3 className={`font-bold ${isRecordInvoice ? "text-amber-900 dark:text-amber-400" : "text-blue-900 dark:text-blue-400"}`}>
                  {isRecordInvoice ? "Record Invoice" : "Collection Invoice"}
                </h3>
                <p className={`text-xs mt-1 ${isRecordInvoice ? "text-amber-700 dark:text-amber-400/80" : "text-blue-700 dark:text-blue-400/80"}`}>
                  {isRecordInvoice 
                    ? "Offline bookkeeping. No payment link." 
                    : "Live invoice. Includes payment portal link."}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Record Payment (For Record Invoices) */}
          {isRecordInvoice && (
            <Card className="border-2 border-purp-200 dark:border-white/10 shadow-none bg-purp-50 dark:bg-white/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-bold text-purp-900 dark:text-white">Offline Payment</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-neutral-600 dark:text-white/60">
                  This is a record invoice. Payments must be recorded manually.
                </p>
                <Button 
                  onClick={() => setPaymentDrawerOpen(true)}
                  disabled={trueOutstanding <= 0 || !canEdit}
                  className="w-full bg-purp-900 hover:bg-purp-800 dark:bg-[#7B2FF7] dark:hover:bg-[#B58CFF] dark:hover:text-[#12061F] text-white font-semibold"
                >
                  <Wallet className="mr-2 h-4 w-4" />
                  Record Payment
                </Button>
                <Button
                  variant="outline"
                  onClick={() => window.open(`/invoices/${invoice.id}/print`, "_blank")}
                  className="w-full border-2 border-purp-200 dark:border-white/10 text-purp-700 dark:text-white hover:bg-purp-100 dark:hover:bg-white/10 dark:bg-white/5"
                >
                  <Printer className="mr-2 h-4 w-4" />
                  View / Download Invoice
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const msg = encodeURIComponent(
                      `Hi ${clientName},\n\nPlease find your invoice from *${merchant?.business_name || "Deraledger"}*:\n\n` +
                      `📄 Invoice: ${invoice.invoice_number}\n` +
                      `💰 Amount Due: ${formatNaira(trueOutstanding)}\n\n` +
                      `View your invoice here:\n${window.location.origin}/invoices/${invoice.id}/print\n\n` +
                      `Thank you! 🙏`
                    );
                    window.open(`https://wa.me/?text=${msg}`, "_blank");
                  }}
                  className="w-full border-2 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 dark:bg-emerald-500/5"
                >
                  <MessageCircle className="mr-2 h-4 w-4" />
                  Share via WhatsApp
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Payment Link & QR (For Collection Invoices) */}
          {!isRecordInvoice && (
            <>
              <Card className="border-2 border-purp-200 dark:border-white/10 shadow-none dark:bg-[#1A0B2E]">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-bold text-purp-900 dark:text-white">Payment Link</CardTitle>
                    <Badge
                      variant="outline"
                      className={`text-xs font-semibold border ${
                        isLinkActive
                          ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20"
                          : "bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-white/40 border-gray-200 dark:border-white/10"
                      }`}
                    >
                      {isLinkActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className={`flex items-center justify-center p-4 bg-white dark:bg-[#12061F] border-2 rounded-lg ${isLinkActive ? "border-purp-200 dark:border-white/10" : "border-gray-200 dark:border-white/5 opacity-50"}`}>
                    <QRCodeSVG
                      value={paymentUrl}
                      size={160}
                      fgColor={isLinkActive ? "#7B2FF7" : "#9CA3AF"}
                      bgColor="transparent"
                      level="H"
                      className={isLinkActive ? "dark:text-[#B58CFF]" : ""}
                    />
                  </div>

                  {!isLinkActive && (
                    <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg p-3 text-sm text-amber-800 dark:text-amber-400">
                      <p className="font-semibold flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4" />
                        Payment Link is Inactive
                      </p>
                      <p className="mt-1">
                        {isUnverified
                          ? "Your business profile is unverified. Please upload the required documents in Settings to enable payment links."
                          : missingSettlement
                          ? "You have not linked a settlement bank account. Please set up your banking details in Settings to enable payment links."
                          : limitExceeded
                          ? isStarter 
                            ? "Starter Tier — Payment links are disabled. Upgrade your tier to accept live payments."
                            : "Monthly collection limit reached. Upgrade your tier to accept more payments."
                          : invoice.status === "expired" || invoice.status === "manually_closed"
                            ? "Reopen this invoice to reactivate the payment link."
                            : "This invoice is closed and can no longer accept payments."}
                      </p>
                    </div>
                  )}

                  {!limitExceeded && (
                    <>
                      <div className="flex items-center gap-2">
                        <div className={`flex-1 px-3 py-2 bg-purp-50 dark:bg-white/5 border-2 border-purp-200 dark:border-white/10 rounded-lg text-xs font-mono text-purp-700 dark:text-[#B58CFF] truncate ${!isLinkActive ? 'opacity-50' : ''}`}>
                          {displayLink}
                        </div>
                        <Button variant="outline" size="sm" onClick={copyLink} disabled={!isLinkActive} className="border-2 border-purp-200 dark:border-white/10 dark:text-white dark:bg-white/5 dark:hover:bg-white/10 flex-shrink-0">
                          {copied ? <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>

                      <Link href={isLinkActive ? `/pay/${invoice.id}` : '#'} target={isLinkActive ? "_blank" : undefined}>
                        <Button variant="outline" disabled={!isLinkActive} className="w-full border-2 border-purp-200 dark:border-white/10 text-purp-700 dark:text-white dark:bg-white/5 dark:hover:bg-white/10 hover:bg-purp-100 disabled:opacity-50">
                          <ExternalLink className="mr-2 h-4 w-4" /> Open Payment Portal
                        </Button>
                      </Link>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Share Invoice */}
              <Card className="border-2 border-purp-200 dark:border-white/10 shadow-none dark:bg-[#1A0B2E]">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-bold text-purp-900 dark:text-white flex items-center gap-2">
                    <Share2 className="h-4 w-4" /> Share Invoice
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* WhatsApp */}
                  <Button
                    variant="outline"
                    onClick={shareViaWhatsApp}
                    disabled={!isLinkActive}
                    className="w-full border-2 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 font-medium disabled:opacity-50"
                  >
                    <MessageCircle className="mr-2 h-4 w-4" />
                    Send via WhatsApp
                  </Button>

                  {/* Email */}
                  <Dialog>
                    <DialogTrigger
                      disabled={!isLinkActive}
                      render={<Button variant="outline" disabled={!isLinkActive} className="w-full border-2 border-blue-200 dark:border-blue-500/30 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 font-medium disabled:opacity-50" />}
                    >
                      <Mail className="mr-2 h-4 w-4" />
                      Send via Email
                    </DialogTrigger>
                    <DialogContent className="border-2 border-purp-200 dark:border-white/10 dark:bg-[#1A0B2E] sm:max-w-md">
                      {emailSent ? (
                        /* ── Success State ─────────────────────────────────── */
                        <div className="flex flex-col items-center justify-center py-8 px-4">
                          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center mb-5 shadow-lg shadow-emerald-200 animate-in zoom-in-50 duration-300">
                            <CheckCircle className="h-10 w-10 text-white" />
                          </div>
                          <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-2 animate-in fade-in-0 duration-500">Invoice Sent!</h3>
                          <p className="text-neutral-500 dark:text-white/60 text-sm text-center mb-1 animate-in fade-in-0 duration-700">
                            {invoice.invoice_number} has been sent to
                          </p>
                          <p className="text-purp-700 dark:text-[#B58CFF] font-semibold text-sm mb-6 animate-in fade-in-0 duration-700">{emailTo}</p>
                          <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-lg p-3 w-full text-center animate-in fade-in-0 duration-1000">
                            <p className="text-emerald-800 dark:text-emerald-400 text-xs font-medium">
                              ✅ The client will receive a professional invoice email with a direct payment link.
                            </p>
                          </div>
                        </div>
                      ) : (
                        /* ── Pre-Send State ────────────────────────────────── */
                        <>
                          <DialogHeader>
                            <DialogTitle className="text-purp-900 dark:text-white flex items-center gap-2">
                              <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center">
                                <Mail className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                              </div>
                              Send Invoice via Email
                            </DialogTitle>
                            <DialogDescription className="dark:text-white/60">
                              A professional invoice email will be sent with a secure payment link.
                            </DialogDescription>
                          </DialogHeader>

                          {/* Invoice Summary Card */}
                          <div className="bg-gradient-to-br from-purp-50 to-blue-50 dark:from-white/5 dark:to-blue-500/5 border-2 border-purp-200 dark:border-white/10 rounded-xl p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-purp-600 dark:text-[#B58CFF] uppercase tracking-wider">Invoice</span>
                              <span className="text-sm font-bold text-purp-900 dark:text-white">{invoice.invoice_number}</span>
                            </div>
                            <Separator className="bg-purp-200 dark:bg-white/10" />
                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div>
                                <span className="text-neutral-500 dark:text-white/60 text-xs">Grand Total</span>
                                <p className="font-bold text-neutral-900 dark:text-white">{formatNaira(Number(invoice.grand_total))}</p>
                              </div>
                              <div>
                                <span className="text-neutral-500 dark:text-white/60 text-xs">Outstanding</span>
                                <p className="font-bold text-amber-600 dark:text-amber-400">{formatNaira(Number(invoice.outstanding_balance))}</p>
                              </div>
                            </div>
                            {invoice.pay_by_date && (
                              <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-white/50">
                                <Clock className="h-3 w-3" />
                                Due: {new Date(invoice.pay_by_date).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}
                              </div>
                            )}
                          </div>

                          {/* Recipient */}
                          <div className="space-y-2">
                            <Label className="text-sm font-medium dark:text-white/80">Recipient Email</Label>
                            <Input
                              type="email"
                              value={emailTo}
                              onChange={(e) => setEmailTo(e.target.value)}
                              className="border-2 border-purp-200 dark:border-white/10 bg-purp-50 dark:bg-white/5 dark:text-white h-11"
                              placeholder="client@email.com"
                            />
                          </div>

                          <DialogFooter>
                            <Button
                              onClick={sendEmail}
                              disabled={!emailTo || emailSending}
                              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold h-11 shadow-md hover:shadow-lg transition-all"
                            >
                              {emailSending ? (
                                <span className="flex items-center gap-2">
                                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                  </svg>
                                  Sending Invoice...
                                </span>
                              ) : (
                                <><Send className="mr-2 h-4 w-4" /> Send Invoice Email</>
                              )}
                            </Button>
                          </DialogFooter>
                        </>
                      )}
                    </DialogContent>
                  </Dialog>

                  {/* Copy Link */}
                  <Button
                    variant="outline"
                    onClick={copyLink}
                    className="w-full border-2 border-purp-200 dark:border-white/10 text-purp-700 dark:text-white hover:bg-purp-100 dark:hover:bg-white/10 dark:bg-white/5 font-medium"
                  >
                    {copied ? (
                      <><CheckCircle className="mr-2 h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Link Copied!</>
                    ) : (
                      <><Copy className="mr-2 h-4 w-4" /> Copy Payment Link</>
                    )}
                  </Button>
                </CardContent>
              </Card>
            </>
          )}

          {/* Invoice Metadata */}
          <Card className="border-2 border-purp-200 dark:border-white/10 shadow-none dark:bg-[#1A0B2E]">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold text-purp-900 dark:text-white">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-neutral-500 dark:text-white/60">Fee Absorption</span>
                <span className="font-medium capitalize dark:text-white">{invoice.fee_absorption}</span>
              </div>
              <Separator className="bg-purp-200 dark:bg-white/10" />
              <div className="flex justify-between">
                <span className="text-neutral-500 dark:text-white/60">Pay-By Date</span>
                <span className="font-medium dark:text-white">
                  {invoice.pay_by_date
                    ? new Date(invoice.pay_by_date).toLocaleDateString("en-NG", {
                        day: "numeric", month: "short", year: "numeric",
                      })
                    : "—"}
                </span>
              </div>
              <Separator className="bg-purp-200 dark:bg-white/10" />
              <div className="flex justify-between">
                <span className="text-neutral-500 dark:text-white/60">Created</span>
                <span className="font-medium dark:text-white">
                  {new Date(invoice.created_at).toLocaleDateString("en-NG", {
                    day: "numeric", month: "short", year: "numeric",
                  })}
                </span>
              </div>
              {invoice.manual_close_reason && (
                <>
                  <Separator className="bg-purp-200 dark:bg-white/10" />
                  <div className="flex justify-between">
                    <span className="text-neutral-500 dark:text-white/60">Close Reason</span>
                    <span className="font-medium text-purple-600 dark:text-[#B58CFF]">{invoice.manual_close_reason}</span>
                  </div>
                </>
              )}
              {invoice.notes && (
                <>
                  <Separator className="bg-purp-200 dark:bg-white/10" />
                  <div>
                    <span className="text-neutral-500 dark:text-white/60 block mb-1">Notes</span>
                    <p className="text-neutral-900 dark:text-white/90">{invoice.notes}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      
      {isRecordInvoice && (
        <RecordPaymentDrawer
          open={paymentDrawerOpen}
          onOpenChange={(open) => {
            setPaymentDrawerOpen(open);
            if (!open) refreshData();
          }}
          invoiceId={invoice.id}
          merchantId={invoice.merchant_id}
          outstandingBalance={Number(invoice.outstanding_balance)}
        />
      )}
    </div>
  );
}
