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
import { closeInvoiceManually, reopenInvoice, getInvoiceHistory, sendInvoiceEmailAction } from "@/lib/actions";
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
    const [inv, txns, manualTxns, merch, collected] = await Promise.all([
      getInvoiceById(id),
      getTransactions(id),
      getManualPayments(id),
      getMerchant(),
      getMonthlyCollectionTotal(),
    ]);
    setInvoice(inv);
    
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
          <div className="w-8 h-8 border-2 border-purp-700 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-neutral-500">Loading invoice...</p>
        </div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <h2 className="text-xl font-bold text-purp-900">Invoice Not Found</h2>
          <p className="text-neutral-500 mt-2">The requested invoice doesn&apos;t exist.</p>
          <Link href="/invoices">
            <Button className="mt-4 bg-purp-900 hover:bg-purp-700 text-white">Back to Invoices</Button>
          </Link>
        </div>
      </div>
    );
  }

  const paymentProgress =
    Number(invoice.grand_total) > 0
      ? Math.round((Number(invoice.amount_paid) / Number(invoice.grand_total)) * 100)
      : 0;

  const paymentUrl = `${typeof window !== "undefined" ? window.location.origin : "https://purpledger.app"}/pay/${invoice.id}`;
  const displayLink = invoice.short_link || paymentUrl.replace(/^https?:\/\//, "");

  const copyLink = () => {
    navigator.clipboard.writeText(paymentUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareViaWhatsApp = () => {
    const clientName = invoice.clients?.full_name || "Client";
    const businessName = merchant?.business_name || "PurpLedger";
    const message = encodeURIComponent(
      `Hi ${clientName},\n\n` +
      `You have an invoice from *${businessName}*:\n\n` +
      `📄 Invoice: ${invoice.invoice_number}\n` +
      `💰 Amount Due: ${formatNaira(Number(invoice.outstanding_balance))}\n\n` +
      `Pay securely here:\n${paymentUrl}\n\n` +
      `Thank you for your business! 🙏`
    );
    window.open(`https://wa.me/?text=${message}`, "_blank");
  };

  const sendEmail = () => {
    if (!emailTo) return;
    
    startTransition(async () => {
      setEmailSending(true);
      const clientName = invoice.clients?.full_name || "Client";
      const businessName = merchant?.business_name || "PurpLedger";
      
      const result = await sendInvoiceEmailAction({
        toEmail: emailTo,
        clientName,
        businessName,
        invoiceNumber: invoice.invoice_number,
        grandTotal: formatNaira(Number(invoice.grand_total)),
        amountPaid: formatNaira(Number(invoice.amount_paid)),
        outstandingBalance: formatNaira(Number(invoice.outstanding_balance)),
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
            <Button variant="outline" size="icon" className="border-2 border-purp-200">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-purp-900">{invoice.invoice_number}</h1>
              <Badge variant="outline" className={`${getStatusColor(invoice.status)} border-2 font-semibold text-xs`}>
                <StatusIcon className="mr-1 h-3 w-3" />
                {getStatusLabel(invoice.status)}
              </Badge>
              {isRecordInvoice && (
                <Badge variant="outline" className="border-2 border-neutral-300 bg-neutral-100 text-neutral-700 text-xs font-semibold">
                  Record
                </Badge>
              )}
            </div>
            <p className="text-neutral-500 text-sm mt-0.5">{clientName} · {clientEmail}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Edit Button */}
          {canEdit && (
            <Link href={`/invoices/${invoice.id}/edit`} className="print:hidden">
              <Button variant="outline" className="border-2 border-purp-200 text-purp-700 hover:bg-purp-100">
                <Pencil className="mr-2 h-4 w-4" /> Edit Invoice
              </Button>
            </Link>
          )}

          {/* Download PDF Button for Record Invoices */}
          {isRecordInvoice && (
            <Button
              variant="outline"
              className="border-2 border-purp-200 text-purp-700 hover:bg-purp-100 print:hidden"
              onClick={() => window.open(`/invoices/${invoice.id}/print`, "_blank")}
            >
              <Printer className="mr-2 h-4 w-4" /> Download PDF
            </Button>
          )}

          {/* Reopen Button */}
          {canReopen && (
            <Dialog open={reopenDialogOpen} onOpenChange={setReopenDialogOpen}>
              <DialogTrigger
                render={<Button variant="outline" className="border-2 border-blue-200 text-blue-700 hover:bg-blue-50 print:hidden" />}
              >
                <RotateCcw className="mr-2 h-4 w-4" /> Reopen Invoice
              </DialogTrigger>
              <DialogContent className="border-2 border-purp-200">
                <DialogHeader>
                  <DialogTitle className="text-purp-900">Reopen Invoice</DialogTitle>
                  <DialogDescription>
                    This will reactivate the invoice and make the payment link active again.
                    {Number(invoice.amount_paid) > 0
                      ? ` The status will be set to "Partially Paid" since ${formatNaira(Number(invoice.amount_paid))} has already been collected.`
                      : ` The status will be set to "Open".`}
                  </DialogDescription>
                </DialogHeader>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
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
                    className="border-2 border-purp-200"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleReopen}
                    disabled={isPending}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
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
                render={<Button variant="outline" className="border-2 border-red-200 text-red-600 hover:bg-red-50 print:hidden" />}
              >
                Close Manually
              </DialogTrigger>
              <DialogContent className="border-2 border-purp-200">
                <DialogHeader>
                  <DialogTitle className="text-purp-900">Close Invoice Manually</DialogTitle>
                  <DialogDescription>
                    Outstanding balance of{" "}
                    <strong>{formatNaira(Number(invoice.outstanding_balance))}</strong> will
                    remain unpaid. You can reopen this invoice later if needed.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Reason Code *</Label>
                    <Select value={closeReason} onValueChange={(v) => setCloseReason(v ?? "")}>
                      <SelectTrigger className="border-2 border-purp-200">
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
            <TabsList variant="line" className="w-full justify-start border-b-2 border-purp-200 mb-6 gap-6">
              <TabsTrigger value="details" className="text-sm py-2">
                Invoice Details
              </TabsTrigger>
              <TabsTrigger value="history" className="text-sm py-2">
                Payment History
              </TabsTrigger>
              <TabsTrigger value="activity" className="text-sm py-2">
                Activity Log
              </TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="space-y-6 mt-0">
              {/* Payment Progress */}
          <Card className="border-2 border-purp-200 shadow-none">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-neutral-500">Payment Progress</span>
                <span className="text-sm font-bold text-purp-900">{paymentProgress}%</span>
              </div>
              <div className="w-full h-3 bg-purp-100 rounded-full border border-purp-200 overflow-hidden">
                <div className="h-full bg-purp-700 rounded-full transition-all duration-500" style={{ width: `${paymentProgress}%` }} />
              </div>
              <div className="flex items-center justify-between mt-3 text-sm">
                <div>
                  <span className="text-neutral-500">Paid: </span>
                  <span className="font-semibold text-emerald-600">{formatNaira(Number(invoice.amount_paid))}</span>
                </div>
                <div>
                  <span className="text-neutral-500">Outstanding: </span>
                  <span className="font-semibold text-amber-600">{formatNaira(Number(invoice.outstanding_balance))}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card className="border-2 border-purp-200 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold text-purp-900">Line Items</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="bg-purp-50 border-b-2 border-purp-200 hover:bg-purp-50">
                    <TableHead className="font-bold text-purp-900 text-xs uppercase">#</TableHead>
                    <TableHead className="font-bold text-purp-900 text-xs uppercase">Description</TableHead>
                    <TableHead className="font-bold text-purp-900 text-xs uppercase text-right">Qty</TableHead>
                    <TableHead className="font-bold text-purp-900 text-xs uppercase text-right">Unit Rate</TableHead>
                    <TableHead className="font-bold text-purp-900 text-xs uppercase text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(invoice.line_items || []).map((item, idx) => (
                    <TableRow key={item.id} className="border-b border-purp-200">
                      <TableCell className="text-sm text-neutral-500">{idx + 1}</TableCell>
                      <TableCell className="font-medium text-sm">{item.item_name}</TableCell>
                      <TableCell className="text-right text-sm">{item.quantity}</TableCell>
                      <TableCell className="text-right text-sm">{formatNaira(Number(item.unit_rate))}</TableCell>
                      <TableCell className="text-right font-semibold text-sm">{formatNaira(Number(item.line_total))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="mt-4 space-y-2 max-w-xs ml-auto">
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-500">Subtotal</span>
                  <span className="font-medium">{formatNaira(Number(invoice.subtotal))}</span>
                </div>
                {Number(invoice.discount_pct) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500">Discount ({invoice.discount_pct}%)</span>
                    <span className="text-red-500">-{formatNaira(Number(invoice.discount_value))}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-500">Tax ({invoice.tax_pct}%)</span>
                  <span>+{formatNaira(Number(invoice.tax_value))}</span>
                </div>
                <Separator className="bg-purp-200" />
                <div className="flex justify-between">
                  <span className="font-bold text-purp-900">Grand Total</span>
                  <span className="font-bold text-purp-900 text-lg">{formatNaira(Number(invoice.grand_total))}</span>
                </div>
              </div>
            </CardContent>
          </Card>
            </TabsContent>

            <TabsContent value="history" className="mt-0">
              {/* Payment History */}
              <Card className="border-2 border-purp-200 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold text-purp-900">Payment History</CardTitle>
            </CardHeader>
            <CardContent>
              {transactions.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-purp-50 border-b-2 border-purp-200 hover:bg-purp-50">
                      <TableHead className="font-bold text-purp-900 text-xs uppercase">Date</TableHead>
                      <TableHead className="font-bold text-purp-900 text-xs uppercase">Reference</TableHead>
                      <TableHead className="font-bold text-purp-900 text-xs uppercase">Method</TableHead>
                      <TableHead className="font-bold text-purp-900 text-xs uppercase text-right">Amount</TableHead>
                      <TableHead className="font-bold text-purp-900 text-xs uppercase">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((txn: any) => (
                      <TableRow key={txn.id} className="border-b border-purp-200">
                        <TableCell className="text-sm">
                          {new Date(txn.date).toLocaleDateString("en-NG", {
                            day: "numeric", month: "short", year: "numeric",
                          })}
                        </TableCell>
                        <TableCell className="text-sm font-mono text-purp-700">{txn.reference}</TableCell>
                        <TableCell className="text-sm capitalize">{txn.method.replace("_", " ")}</TableCell>
                        <TableCell className="text-right font-semibold text-sm">{formatNaira(Number(txn.amount))}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 border-2 text-xs font-semibold">
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
            <Card className="border-2 border-purp-200 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold text-purp-900 flex items-center gap-2">
                <History className="h-4 w-4" /> Invoice History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {history.filter(h => h.event_type !== "payment_received").length > 0 ? (
                <div className="relative">
                  {/* Timeline line */}
                  <div className="absolute left-[15px] top-2 bottom-2 w-0.5 bg-purp-200" />
                  <div className="space-y-4">
                    {history.filter(h => h.event_type !== "payment_received").map((event) => {
                      const meta = event.metadata as Record<string, unknown>;
                      return (
                        <div key={event.id} className="flex items-start gap-3 relative">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border-2 z-10 ${getEventColor(event.event_type)}`}>
                            {event.event_type === "manual_close" && <XCircle className="h-3.5 w-3.5" />}
                            {event.event_type === "reopen" && <RotateCcw className="h-3.5 w-3.5" />}
                            {event.event_type === "edit" && <Pencil className="h-3.5 w-3.5" />}
                            {!["manual_close", "reopen", "edit"].includes(event.event_type) && <User className="h-3.5 w-3.5" />}
                          </div>
                          <div className="flex-1 min-w-0 bg-purp-50/50 border border-purp-100 rounded-lg p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <Badge variant="outline" className={`${getEventColor(event.event_type)} border text-xs font-semibold`}>
                                  {getEventLabel(event.event_type)}
                                </Badge>
                                {typeof meta?.reason === "string" && meta.reason && (
                                  <p className="text-sm text-neutral-600 mt-1.5">
                                    Reason: <span className="font-medium">{meta.reason}</span>
                                  </p>
                                )}
                                {typeof meta?.status === "string" && meta.status && (
                                  <p className="text-sm text-neutral-600 mt-1.5">
                                    Status set to: <span className="font-medium capitalize">{meta.status.replace("_", " ")}</span>
                                  </p>
                                )}
                                {typeof meta?.changes === "string" && meta.changes && (
                                  <p className="text-sm text-neutral-600 mt-1.5">{meta.changes}</p>
                                )}
                              </div>
                              <span className="text-xs text-neutral-400 whitespace-nowrap">
                                {new Date(event.created_at).toLocaleDateString("en-NG", {
                                  day: "numeric", month: "short", year: "numeric",
                                  hour: "2-digit", minute: "2-digit",
                                })}
                              </span>
                            </div>
                            <p className="text-xs text-neutral-400 mt-1.5 flex justify-between">
                              <span>By: {meta?.actor_name ? (meta.actor_name as string) : (event.actor_role === "merchant" ? "System" : event.actor_role)}</span>
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="text-center text-neutral-500 py-8 text-sm">No activity recorded yet.</p>
              )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Sidebar */}
        <div className="space-y-6">
          {/* Invoice Type Indicator */}
          <Card className={`border-2 shadow-none ${isRecordInvoice ? "border-amber-200 bg-amber-50" : "border-blue-200 bg-blue-50"}`}>
            <CardContent className="p-4 flex items-start gap-3">
              <div className={`mt-0.5 p-2 rounded-lg ${isRecordInvoice ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                {isRecordInvoice ? <BookOpen className="h-5 w-5" /> : <CreditCard className="h-5 w-5" />}
              </div>
              <div>
                <h3 className={`font-bold ${isRecordInvoice ? "text-amber-900" : "text-blue-900"}`}>
                  {isRecordInvoice ? "Record Invoice" : "Collection Invoice"}
                </h3>
                <p className={`text-xs mt-1 ${isRecordInvoice ? "text-amber-700" : "text-blue-700"}`}>
                  {isRecordInvoice 
                    ? "Offline bookkeeping. No payment link." 
                    : "Live invoice. Includes payment portal link."}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Record Payment (For Record Invoices) */}
          {isRecordInvoice && (
            <Card className="border-2 border-purp-200 shadow-none bg-purp-50">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-bold text-purp-900">Offline Payment</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-neutral-600">
                  This is a record invoice. Payments must be recorded manually.
                </p>
                <Button 
                  onClick={() => setPaymentDrawerOpen(true)}
                  disabled={Number(invoice.outstanding_balance) <= 0 || !canEdit}
                  className="w-full bg-purp-900 hover:bg-purp-800 text-white font-semibold"
                >
                  <Wallet className="mr-2 h-4 w-4" />
                  Record Payment
                </Button>
                <Button
                  variant="outline"
                  onClick={() => window.open(`/invoices/${invoice.id}/print`, "_blank")}
                  className="w-full border-2 border-purp-200 text-purp-700 hover:bg-purp-100"
                >
                  <Printer className="mr-2 h-4 w-4" />
                  View / Download Invoice
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const msg = encodeURIComponent(
                      `Hi ${clientName},\n\nPlease find your invoice from *${merchant?.business_name || "PurpLedger"}*:\n\n` +
                      `📄 Invoice: ${invoice.invoice_number}\n` +
                      `💰 Amount Due: ${formatNaira(Number(invoice.outstanding_balance))}\n\n` +
                      `View your invoice here:\n${window.location.origin}/invoices/${invoice.id}/print\n\n` +
                      `Thank you! 🙏`
                    );
                    window.open(`https://wa.me/?text=${msg}`, "_blank");
                  }}
                  className="w-full border-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
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
              <Card className="border-2 border-purp-200 shadow-none">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-bold text-purp-900">Payment Link</CardTitle>
                    <Badge
                      variant="outline"
                      className={`text-xs font-semibold border ${
                        isLinkActive
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-gray-100 text-gray-500 border-gray-200"
                      }`}
                    >
                      {isLinkActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className={`flex items-center justify-center p-4 bg-white border-2 rounded-lg ${isLinkActive ? "border-purp-200" : "border-gray-200 opacity-50"}`}>
                    <QRCodeSVG
                      value={paymentUrl}
                      size={160}
                      fgColor={isLinkActive ? "#2D1B6B" : "#9CA3AF"}
                      bgColor="#FFFFFF"
                      level="H"
                    />
                  </div>

                  {!isLinkActive && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
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
                        <div className={`flex-1 px-3 py-2 bg-purp-50 border-2 border-purp-200 rounded-lg text-xs font-mono text-purp-700 truncate ${!isLinkActive ? 'opacity-50' : ''}`}>
                          {displayLink}
                        </div>
                        <Button variant="outline" size="sm" onClick={copyLink} disabled={!isLinkActive} className="border-2 border-purp-200 flex-shrink-0">
                          {copied ? <CheckCircle className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>

                      <Link href={isLinkActive ? `/pay/${invoice.id}` : '#'} target={isLinkActive ? "_blank" : undefined}>
                        <Button variant="outline" disabled={!isLinkActive} className="w-full border-2 border-purp-200 text-purp-700 hover:bg-purp-100 disabled:opacity-50">
                          <ExternalLink className="mr-2 h-4 w-4" /> Open Payment Portal
                        </Button>
                      </Link>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Share Invoice */}
              <Card className="border-2 border-purp-200 shadow-none">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-bold text-purp-900 flex items-center gap-2">
                    <Share2 className="h-4 w-4" /> Share Invoice
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* WhatsApp */}
                  <Button
                    variant="outline"
                    onClick={shareViaWhatsApp}
                    disabled={!isLinkActive}
                    className="w-full border-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50 font-medium disabled:opacity-50"
                  >
                    <MessageCircle className="mr-2 h-4 w-4" />
                    Send via WhatsApp
                  </Button>

                  {/* Email */}
                  <Dialog>
                    <DialogTrigger
                      disabled={!isLinkActive}
                      render={<Button variant="outline" disabled={!isLinkActive} className="w-full border-2 border-blue-200 text-blue-700 hover:bg-blue-50 font-medium disabled:opacity-50" />}
                    >
                      <Mail className="mr-2 h-4 w-4" />
                      Send via Email
                    </DialogTrigger>
                    <DialogContent className="border-2 border-purp-200">
                      <DialogHeader>
                        <DialogTitle className="text-purp-900">Send Invoice to Email</DialogTitle>
                        <DialogDescription>
                          Send {invoice.invoice_number} ({formatNaira(Number(invoice.outstanding_balance))} outstanding) to the client&apos;s email.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-2">
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Recipient Email</Label>
                          <Input
                            type="email"
                            value={emailTo}
                            onChange={(e) => setEmailTo(e.target.value)}
                            className="border-2 border-purp-200 bg-purp-50 h-11"
                            placeholder="client@email.com"
                          />
                        </div>
                        <div className="bg-purp-50 border border-purp-200 rounded-lg p-3 text-sm">
                          <p className="text-neutral-500 text-xs mb-2">Email Preview:</p>
                          <p className="font-medium text-neutral-900">Invoice {invoice.invoice_number} from {merchant?.business_name || "PurpLedger"}</p>
                          <p className="text-neutral-500 mt-1 text-xs">
                            Grand Total: {formatNaira(Number(invoice.grand_total))} · Outstanding: {formatNaira(Number(invoice.outstanding_balance))}
                          </p>
                          <p className="text-purp-700 mt-2 text-xs font-mono truncate">{paymentUrl}</p>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button
                          onClick={sendEmail}
                          disabled={!emailTo || emailSending}
                          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                        >
                          {emailSent ? (
                            <><CheckCircle className="mr-2 h-4 w-4" /> Sent!</>
                          ) : emailSending ? (
                            "Opening mail client..."
                          ) : (
                            <><Send className="mr-2 h-4 w-4" /> Send Email</>
                          )}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  {/* Copy Link */}
                  <Button
                    variant="outline"
                    onClick={copyLink}
                    className="w-full border-2 border-purp-200 text-purp-700 hover:bg-purp-100 font-medium"
                  >
                    {copied ? (
                      <><CheckCircle className="mr-2 h-4 w-4 text-emerald-600" /> Link Copied!</>
                    ) : (
                      <><Copy className="mr-2 h-4 w-4" /> Copy Payment Link</>
                    )}
                  </Button>
                </CardContent>
              </Card>
            </>
          )}

          {/* Invoice Metadata */}
          <Card className="border-2 border-purp-200 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold text-purp-900">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-neutral-500">Fee Absorption</span>
                <span className="font-medium capitalize">{invoice.fee_absorption}</span>
              </div>
              <Separator className="bg-purp-200" />
              <div className="flex justify-between">
                <span className="text-neutral-500">Pay-By Date</span>
                <span className="font-medium">
                  {invoice.pay_by_date
                    ? new Date(invoice.pay_by_date).toLocaleDateString("en-NG", {
                        day: "numeric", month: "short", year: "numeric",
                      })
                    : "—"}
                </span>
              </div>
              <Separator className="bg-purp-200" />
              <div className="flex justify-between">
                <span className="text-neutral-500">Created</span>
                <span className="font-medium">
                  {new Date(invoice.created_at).toLocaleDateString("en-NG", {
                    day: "numeric", month: "short", year: "numeric",
                  })}
                </span>
              </div>
              {invoice.manual_close_reason && (
                <>
                  <Separator className="bg-purp-200" />
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Close Reason</span>
                    <span className="font-medium text-purple-600">{invoice.manual_close_reason}</span>
                  </div>
                </>
              )}
              {invoice.notes && (
                <>
                  <Separator className="bg-purp-200" />
                  <div>
                    <span className="text-neutral-500 block mb-1">Notes</span>
                    <p className="text-neutral-900">{invoice.notes}</p>
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
