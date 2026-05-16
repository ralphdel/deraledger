"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Save, AlertTriangle, CheckCircle2, FileText, Link as LinkIcon, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { getClients, getItemCatalog, getDiscountTemplates, getActiveSubscription, getReferences } from "@/lib/data";
import type { Client, Merchant, ItemCatalog, DiscountTemplate, Reference } from "@/lib/types";
import { calculateInvoiceTotals, formatNaira } from "@/lib/calculations";
import { createInvoiceAction, createInvoiceAllocationAction, getEligibleDepositInvoicesAction } from "@/lib/actions";
import { createClient } from "@/lib/supabase/client";
import { CreateClientModal } from "@/components/CreateClientModal";

interface FormLineItem {
  id: string;
  itemName: string;
  quantity: string;
  unitRate: string;
  discountPct: string;
}

function CreateInvoiceForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultType = (searchParams.get("type") as "record" | "collection") || "record"; // Default to record, not collection
  const [clients, setClients] = useState<Client[]>([]);
  const [references, setReferences] = useState<Reference[]>([]);
  const [catalog, setCatalog] = useState<ItemCatalog[]>([]);
  const [discountTemplates, setDiscountTemplates] = useState<DiscountTemplate[]>([]);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [invoiceType, setInvoiceType] = useState<"record" | "collection">(defaultType);
  const [initialAmountPaid, setInitialAmountPaid] = useState("");
  const [referenceGroupSummary, setReferenceGroupSummary] = useState<{ totalBilled: number; totalPaid: number; projectTotalValue: number; hasProjectTotal: boolean; outstandingBalance: number; suggestedAmount: number } | null>(null);
  const [invoiceStage, setInvoiceStage] = useState<'deposit' | 'milestone' | 'balance' | 'standard'>('standard');
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [useCustomNumber, setUseCustomNumber] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [clientId, setClientId] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [createClientModalOpen, setCreateClientModalOpen] = useState(false);
  const [discountPct, setDiscountPct] = useState("0");
  const [taxPct, setTaxPct] = useState("7.5");
  const [feeAbsorption, setFeeAbsorption] = useState("business");
  const [payByDate, setPayByDate] = useState("");
  const [allowPartialPayment, setAllowPartialPayment] = useState(false);
  const [partialPaymentPct, setPartialPaymentPct] = useState("50");
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<FormLineItem[]>([
    { id: "1", itemName: "", quantity: "1", unitRate: "", discountPct: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isRestricted, setIsRestricted] = useState(false);

  // Deposit allocation state
  interface DepositInvoice { id: string; invoice_number: string; grand_total: number; amount_paid: number; is_allocated?: boolean; }
  const [eligibleDeposits, setEligibleDeposits] = useState<DepositInvoice[]>([]);
  const [appliedDepositId, setAppliedDepositId] = useState<string | null>(null);
  const [appliedDepositAmount, setAppliedDepositAmount] = useState<number>(0);

  useEffect(() => {
    getClients().then(setClients);

    // Load merchant context and their catalog/templates
    const sb = createClient();
    sb.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const user = session.user;
        const { data } = await sb
          .from("merchants")
          .select("*")
          .eq("user_id", user.id)
          .single();
        if (data) {
          setMerchant(data as Merchant);
          // Fetch catalog and discount templates
          getItemCatalog(data.id).then(setCatalog);
          getDiscountTemplates(data.id).then(setDiscountTemplates);
          getReferences(data.id).then(setReferences);

          // CRITICAL: Force starter plan merchants to record type only.
          // This prevents the form from accidentally submitting a collection invoice
          // if the page loaded without a ?type=record query param.
          const plan = data.subscription_plan || data.merchant_tier || "starter";
          if (plan === "starter") {
            setInvoiceType("record");
          }
          
          getActiveSubscription(data.id).then((sub) => {
            if (sub && sub.status === "expired") {
              setIsRestricted(true);
            }
          });
        }
      }
    });
  }, []);

  const addLineItem = () => {
    setLineItems([
      ...lineItems,
      { id: Date.now().toString(), itemName: "", quantity: "1", unitRate: "", discountPct: "" },
    ]);
  };

  const removeLineItem = (id: string) => {
    if (lineItems.length > 1) {
      setLineItems(lineItems.filter((li) => li.id !== id));
    }
  };

  const updateLineItem = (id: string, field: keyof FormLineItem, value: string) => {
    setLineItems((prev) =>
      prev.map((li) => (li.id === id ? { ...li, [field]: value } : li))
    );
  };

  const parsedItems = lineItems.map((li) => {
    const qty = parseFloat(li.quantity) || 0;
    const rate = parseFloat(li.unitRate) || 0;
    const disc = parseFloat(li.discountPct) || 0;
    // Calculate discounted rate so calculations.ts works seamlessly
    return {
      quantity: qty,
      unitRate: rate * (1 - disc / 100),
    };
  });

  const totals = calculateInvoiceTotals(
    parsedItems,
    parseFloat(discountPct) || 0,
    parseFloat(taxPct) || 0
  );

  // Resolve displayed client name for the selected client
  const selectedClient = clients.find((c) => c.id === clientId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!clientId) {
      setError("Please select a client before saving.");
      return;
    }
    if (!merchant) {
      setError("Unable to resolve merchant identity. Please refresh.");
      return;
    }
    if (isRestricted) {
      setError("Your subscription has expired. You must renew to create new invoices.");
      return;
    }
    if (lineItems.every((li) => !li.itemName.trim())) {
      setError("Please add at least one line item with a description.");
      return;
    }

    // Bug 6: Validate initial payment does not exceed grand total
    if (invoiceType === "record" && initialAmountPaid.trim() !== "") {
      const paid = parseFloat(initialAmountPaid);
      if (paid > totals.grandTotal) {
        setError("Initial payment cannot exceed the grand total. Please enter a valid amount.");
        return;
      }
      if (paid < 0) {
        setError("Initial payment cannot be negative.");
        return;
      }
    }

    setSaving(true);

    const result = await createInvoiceAction({
      merchant_id: merchant.id,
      client_id: clientId,
      // Record invoices NEVER get a reference_id — lightweight records only
      reference_id: invoiceType === "collection" ? (referenceId || null) : null,
      invoice_number: useCustomNumber ? invoiceNumber : undefined,
      invoice_type: invoiceType,
      discount_pct: parseFloat(discountPct) || 0,
      tax_pct: parseFloat(taxPct) || 0,
      fee_absorption: invoiceType === "record" ? "business" : (feeAbsorption as "business" | "customer"),
      pay_by_date: payByDate || undefined,
      notes: notes || undefined,
      payment_notes: invoiceType === "record" ? notes : undefined,
      initial_amount_paid: invoiceType === "record" ? (initialAmountPaid.trim() !== "" ? parseFloat(initialAmountPaid) : 0) : 0,
      payment_method: paymentMethod,
      allow_partial_payment: invoiceType === "collection" ? allowPartialPayment : false,
      partial_payment_pct: (invoiceType === "collection" && allowPartialPayment) ? parseFloat(partialPaymentPct) : null,
      // payment_provider is always server-defaulted to paystack — not merchant-selected
      invoice_stage: (invoiceType === "collection" && referenceId) ? invoiceStage : undefined,
      line_items: lineItems
        .filter((li) => li.itemName.trim())
        .map((li) => {
          const disc = parseFloat(li.discountPct) || 0;
          return {
            item_name: disc > 0 ? `${li.itemName.trim()} (${disc}% off)` : li.itemName.trim(),
            quantity: parseFloat(li.quantity) || 1,
            unit_rate: (parseFloat(li.unitRate) || 0) * (1 - disc / 100),
          };
        }),
    });

    setSaving(false);

    if (result.success) {
      // If a deposit was applied, create the allocation linkage
      if (appliedDepositId && appliedDepositAmount > 0 && result.invoiceId) {
        await createInvoiceAllocationAction({
          merchant_id: merchant.id,
          source_invoice_id: appliedDepositId,
          target_invoice_id: result.invoiceId,
          allocated_amount: appliedDepositAmount,
        });
      }
      setSuccess(true);
      setTimeout(() => {
        router.push("/invoices");
      }, 1200);
    } else {
      setError("Failed to create invoice: " + result.error);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/invoices">
          <Button variant="outline" size="icon" className="border-2 border-purp-200 dark:border-white/10 dark:text-white dark:hover:bg-white/10 dark:bg-transparent">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-purp-900 dark:text-white">Create Invoice</h1>
          <p className="text-neutral-500 dark:text-white/60 text-sm mt-0.5">
            Fill in the details to generate a new invoice
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Invoice Type Selector */}
        <div className="grid sm:grid-cols-2 gap-4">
          <Card
            className={`cursor-pointer border-2 transition-all shadow-sm ${invoiceType === "record"
                ? "border-amber-600 bg-amber-50 ring-2 ring-amber-200 dark:bg-amber-500/10 dark:border-amber-500/50 dark:ring-amber-500/20"
                : "border-neutral-200 hover:border-amber-300 dark:border-white/10 dark:bg-[#1A0B2E] dark:hover:border-amber-500/30"
              }`}
            onClick={() => {
              setInvoiceType("record");
              router.replace("/invoices/create?type=record", { scroll: false });
            }}
          >
            <CardContent className="p-5 flex items-start gap-4">
              <div className={`p-2 rounded-lg ${invoiceType === "record" ? "bg-amber-600 text-white" : "bg-neutral-100 text-neutral-500 dark:bg-white/5 dark:text-white/40"}`}>
                <FileText className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h3 className={`font-bold ${invoiceType === "record" ? "text-amber-900 dark:text-amber-400" : "text-neutral-700 dark:text-white"}`}>Record Invoice</h3>
                <p className="text-xs text-neutral-500 dark:text-white/60 mt-1 leading-relaxed">
                  For offline bookkeeping. Generates a standard receipt without a Paystack portal.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card
            className={`border-2 transition-all shadow-sm ${(merchant?.subscription_plan === "starter" || merchant?.verification_status !== "verified") ? "opacity-60 bg-neutral-50 dark:bg-white/5 cursor-not-allowed" : "cursor-pointer"
              } ${invoiceType === "collection"
                ? "border-blue-600 bg-blue-50 ring-2 ring-blue-200 dark:bg-blue-500/10 dark:border-blue-500/50 dark:ring-blue-500/20"
                : "border-neutral-200 hover:border-blue-300 dark:border-white/10 dark:bg-[#1A0B2E] dark:hover:border-blue-500/30"
              }`}
            onClick={() => {
              if (merchant?.subscription_plan === "starter" || merchant?.verification_status !== "verified") return; // Locked for starter or unverified
              setInvoiceType("collection");
              router.replace("/invoices/create?type=collection", { scroll: false });
            }}
          >
            <CardContent className="p-5 flex items-start gap-4">
              <div className={`p-2 rounded-lg ${invoiceType === "collection" ? "bg-blue-600 text-white" : "bg-neutral-100 text-neutral-500 dark:bg-white/5 dark:text-white/40"}`}>
                <LinkIcon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className={`font-bold ${invoiceType === "collection" ? "text-blue-900 dark:text-blue-400" : "text-neutral-700 dark:text-white"}`}>Collection Invoice</h3>
                  {merchant?.subscription_plan === "starter" ? (
                    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-600 bg-amber-100 dark:bg-amber-500/20 dark:text-amber-400 px-2 py-0.5 rounded-full">
                      <Lock className="h-3 w-3" /> Upgrade
                    </span>
                  ) : merchant?.verification_status !== "verified" ? (
                    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-600 bg-amber-100 dark:bg-amber-500/20 dark:text-amber-400 px-2 py-0.5 rounded-full">
                      <Lock className="h-3 w-3" /> Verify KYC
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-neutral-500 dark:text-white/60 mt-1 leading-relaxed">
                  Live payment portal. Clients can pay directly via Card, Transfer, or USSD securely.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Client & Invoice Number */}
        <Card className={`border-2 shadow-none transition-all duration-300 dark:bg-[#1A0B2E] ${invoiceType === "record" ? "border-amber-200 dark:border-amber-500/20" : "border-blue-200 dark:border-blue-500/20"}`}>
          <CardHeader className={`pb-4 border-b-2 ${invoiceType === "record" ? "border-amber-100 bg-amber-50/50 dark:border-amber-500/10 dark:bg-amber-500/5" : "border-blue-100 bg-blue-50/50 dark:border-blue-500/10 dark:bg-blue-500/5"}`}>
            <CardTitle className="text-base font-bold flex items-center justify-between">
              <span className={invoiceType === "record" ? "text-amber-900 dark:text-amber-400" : "text-blue-900 dark:text-blue-400"}>
                Invoice Details
              </span>
              <Badge variant="outline" className={`${invoiceType === "record" ? "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30" : "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/30"} uppercase tracking-wider text-[10px]`}>
                {invoiceType === "record" ? "Offline Receipt Mode" : "Live Payment Portal Mode"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium dark:text-white/80">Client</Label>
                {/* Custom combobox-style select to avoid UUID display bug */}
                <div className="relative">
                  <Select
                    value={clientId}
                    onValueChange={(v) => {
                      if (v === "NEW_CLIENT") {
                        setCreateClientModalOpen(true);
                      } else {
                        setClientId(v ?? "");
                      }
                    }}
                  >
                    <SelectTrigger className="border-2 border-purp-200 dark:border-white/10 bg-purp-50 dark:bg-white/5 h-11">
                      <span className={selectedClient ? "text-neutral-900 dark:text-white" : "text-neutral-400 dark:text-white/40"}>
                        {selectedClient
                          ? `${selectedClient.full_name}${selectedClient.company_name ? ` — ${selectedClient.company_name}` : ""}`
                          : "Select a client"}
                      </span>
                    </SelectTrigger>
                    <SelectContent className="border-2 border-purp-200 dark:border-white/10 dark:bg-[#1A0B2E]">
                      <SelectItem value="NEW_CLIENT" className="text-purp-700 dark:text-[#B58CFF] font-semibold focus:text-purp-800 dark:focus:text-white focus:bg-purp-50 dark:focus:bg-white/5">
                        <span className="flex items-center gap-2">
                          <Plus className="h-4 w-4" />
                          New Client
                        </span>
                      </SelectItem>
                      <Separator className="my-1 bg-purp-100 dark:bg-white/10" />
                      {clients.length === 0 && (
                        <div className="px-3 py-2 text-sm text-neutral-400 dark:text-white/40">No clients yet</div>
                      )}
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id} className="dark:text-white dark:focus:bg-white/5">
                          {client.full_name}
                          {client.company_name && ` — ${client.company_name}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium dark:text-white/80">Invoice Number</Label>
                  <button
                    type="button"
                    onClick={() => setUseCustomNumber(!useCustomNumber)}
                    className="text-xs text-purp-700 dark:text-[#B58CFF] hover:underline font-medium"
                  >
                    {useCustomNumber ? "Use auto-generated" : "Use custom"}
                  </button>
                </div>
                <Input
                  value={useCustomNumber ? invoiceNumber : ""}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  disabled={!useCustomNumber}
                  className="border-2 border-purp-200 dark:border-white/10 bg-purp-50 dark:bg-white/5 dark:text-white h-11"
                  placeholder={useCustomNumber ? "e.g. INV-2025-007" : "Auto-generated on save"}
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium dark:text-white/80">
                  {invoiceType === "record" ? "Due Date" : "Pay-By Date"}
                </Label>
                <Input
                  type="date"
                  value={payByDate}
                  onChange={(e) => setPayByDate(e.target.value)}
                  className="border-2 border-purp-200 dark:border-white/10 bg-purp-50 dark:bg-white/5 dark:text-white h-11"
                />
              </div>

              {invoiceType === "collection" && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium dark:text-white/80">Fee Absorption</Label>
                  <Select value={feeAbsorption} onValueChange={(v) => setFeeAbsorption(v ?? "business")}>
                    <SelectTrigger className="border-2 border-purp-200 dark:border-white/10 bg-purp-50 dark:bg-white/5 dark:text-white h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-2 border-purp-200 dark:border-white/10 dark:bg-[#1A0B2E]">
                      <SelectItem value="business" className="dark:text-white dark:focus:bg-white/5">Business Absorbs</SelectItem>
                      <SelectItem value="customer" className="dark:text-white dark:focus:bg-white/5">Customer Absorbs</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Reference / Project — ONLY for collection invoices */}
            {invoiceType === "collection" && (
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium dark:text-white/80">Reference / Project</Label>
                    <Link href="/references" className="text-xs font-semibold text-purp-700 dark:text-[#B58CFF] hover:underline">
                      Manage
                    </Link>
                  </div>
                  <Select
                    value={referenceId || "none"}
                    onValueChange={async (v) => {
                      const newRef = v === "none" ? "" : String(v);
                      setReferenceId(newRef);
                      setReferenceGroupSummary(null);
                      setInvoiceStage('standard');
                      // Reset deposit allocation when reference changes
                      setEligibleDeposits([]);
                      setAppliedDepositId(null);
                      setAppliedDepositAmount(0);
                      if (newRef && merchant) {
                        try {
                          const sb = (await import("@/lib/supabase/client")).createClient();
                          const [{ data: refData }, { data: groupInvs }] = await Promise.all([
                            sb.from("references").select("project_total_value").eq("id", newRef).single(),
                            sb.from("invoices").select("id, grand_total, amount_paid, invoice_type, outstanding_balance").eq("merchant_id", merchant.id).eq("reference_id", newRef),
                          ]);
                          const collectionInvs = (groupInvs || []).filter((i: any) => i.invoice_type === "collection");
                          const totalPaid = collectionInvs.reduce((s: number, i: any) => s + Number(i.amount_paid), 0);
                          const invoiceOutstanding = collectionInvs.reduce((s: number, i: any) => s + Number(i.outstanding_balance || 0), 0);
                          
                          const projectTotalValue = Number(refData?.project_total_value ?? 0);
                          const hasProjectTotal = projectTotalValue > 0;
                          
                          const outstandingBalance = hasProjectTotal
                            ? Math.max(0, projectTotalValue - totalPaid)
                            : invoiceOutstanding;
                            
                          const totalBilled = hasProjectTotal 
                            ? projectTotalValue 
                            : totalPaid + invoiceOutstanding;

                          const suggestedAmount = hasProjectTotal ? outstandingBalance : 0;
                          setReferenceGroupSummary({ totalBilled, totalPaid, projectTotalValue, hasProjectTotal, outstandingBalance, suggestedAmount });
                          // Auto-suggest: populate first line item unit rate
                          if (suggestedAmount > 0) {
                            setLineItems(prev => prev.map((li, idx) =>
                              idx === 0 && !li.itemName.trim()
                                ? { ...li, itemName: 'Balance Payment', unitRate: String(suggestedAmount), quantity: '1' }
                                : li
                            ));
                          }
                          // Load eligible deposit invoices
                          const depRes = await getEligibleDepositInvoicesAction(merchant.id, newRef);
                          if (depRes.success) setEligibleDeposits(depRes.deposits as DepositInvoice[]);
                        } catch {}
                      }
                    }}
                  >
                    <SelectTrigger className="border-2 border-purp-200 dark:border-white/10 bg-purp-50 dark:bg-white/5 dark:text-white h-11">
                      <SelectValue placeholder="Optional" />
                    </SelectTrigger>
                    <SelectContent className="border-2 border-purp-200 dark:border-white/10 dark:bg-[#1A0B2E]">
                      <SelectItem value="none" className="dark:text-white dark:focus:bg-white/5">No reference</SelectItem>
                      {references.map((ref) => (
                        <SelectItem key={ref.id} value={ref.id} className="dark:text-white dark:focus:bg-white/5">{ref.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {referenceGroupSummary && (
                    <div className="mt-2 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-lg p-3 text-xs space-y-1">
                      <p className="font-semibold text-blue-900 dark:text-blue-400">📊 Project Collection Summary</p>
                      {referenceGroupSummary.hasProjectTotal && (
                        <>
                          <div className="flex justify-between text-blue-700 dark:text-blue-400/80">
                            <span>Project total</span>
                            <span className="font-mono font-bold dark:text-white">{formatNaira(referenceGroupSummary.projectTotalValue)}</span>
                          </div>
                          <div className="w-full bg-blue-100 dark:bg-blue-500/20 rounded-full h-1.5 overflow-hidden">
                            <div className="h-full bg-blue-500 dark:bg-blue-400 rounded-full" style={{ width: `${Math.min(100, Math.round((referenceGroupSummary.totalPaid / referenceGroupSummary.projectTotalValue) * 100))}%` }} />
                          </div>
                        </>
                      )}
                      <div className="flex justify-between text-blue-700 dark:text-blue-400/80">
                        <span>Total billed so far</span>
                        <span className="font-mono font-bold dark:text-white">{formatNaira(referenceGroupSummary.totalBilled)}</span>
                      </div>
                      <div className="flex justify-between text-blue-700 dark:text-blue-400/80">
                        <span>Already collected</span>
                        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{formatNaira(referenceGroupSummary.totalPaid)}</span>
                      </div>
                      <div className="flex justify-between border-t border-blue-200 dark:border-blue-500/20 pt-1 text-blue-900 dark:text-blue-400">
                        <span className="font-semibold">Outstanding balance</span>
                        <span className="font-mono font-bold text-amber-700 dark:text-amber-400">{formatNaira(referenceGroupSummary.outstandingBalance)}</span>
                      </div>
                      {referenceGroupSummary.suggestedAmount > 0 && (
                        <p className="text-blue-600 dark:text-blue-400/80 text-[11px] pt-0.5">💡 First line item auto-populated with suggested balance.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
            {invoiceType === "record" && (
              <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                <span className="font-semibold">Note:</span> Record invoices are lightweight offline records and do not support project reference grouping.
              </div>
            )}

            {/* Invoice Stage — only shown when collection + reference selected */}
            {invoiceType === "collection" && referenceId && (
              <div className="space-y-2">
                <Label className="text-sm font-medium dark:text-white/80">Invoice Stage</Label>
                <div className="grid grid-cols-4 gap-2">
                  {(["deposit", "milestone", "balance", "standard"] as const).map((stage) => (
                    <button
                      key={stage}
                      type="button"
                      onClick={() => {
                        setInvoiceStage(stage);
                        // Reset deposit allocation when stage changes away from balance
                        if (stage !== "balance") {
                          setAppliedDepositId(null);
                          setAppliedDepositAmount(0);
                        }
                      }}
                      className={`py-2 px-1 rounded-lg border-2 text-xs font-semibold capitalize transition-all ${
                        invoiceStage === stage
                          ? "border-purp-700 bg-purp-50 text-purp-900 dark:border-[#7B2FF7] dark:bg-[#7B2FF7]/10 dark:text-white"
                          : "border-neutral-200 bg-white text-neutral-500 hover:border-purp-300 dark:border-white/10 dark:bg-[#1A0B2E] dark:text-white/60 dark:hover:border-white/30"
                      }`}
                    >
                      {stage === "deposit" ? "🏦 Deposit" :
                       stage === "milestone" ? "🎯 Milestone" :
                       stage === "balance" ? "✅ Balance" : "📄 Standard"}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-neutral-400 dark:text-white/40">
                  Stage helps track where this invoice falls in the project lifecycle.
                </p>
              </div>
            )}

            {/* Deposit Allocation — only when stage = balance and eligible deposits exist */}
            {invoiceType === "collection" && referenceId && invoiceStage === "balance" && eligibleDeposits.length > 0 && (
              <div className="space-y-2 rounded-xl border-2 border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 p-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold text-emerald-900 dark:text-emerald-400">💰 Apply Existing Deposit?</Label>
                  {appliedDepositId && (
                    <button
                      type="button"
                      onClick={() => { setAppliedDepositId(null); setAppliedDepositAmount(0); }}
                      className="text-xs text-emerald-700 dark:text-emerald-400/80 hover:underline font-medium"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <p className="text-xs text-emerald-700 dark:text-emerald-400/80">Select a fully paid deposit to deduct from this invoice&apos;s payable amount.</p>
                <div className="space-y-2">
                  {eligibleDeposits.map((dep) => (
                    <button
                      key={dep.id}
                      type="button"
                      disabled={dep.is_allocated}
                      onClick={() => {
                        if (appliedDepositId === dep.id) {
                          setAppliedDepositId(null);
                          setAppliedDepositAmount(0);
                        } else {
                          setAppliedDepositId(dep.id);
                          setAppliedDepositAmount(Number(dep.amount_paid));
                        }
                      }}
                      className={`w-full flex items-center justify-between rounded-lg border-2 px-3 py-2.5 text-sm transition-all ${
                        dep.is_allocated
                          ? "border-neutral-200 bg-neutral-50 dark:border-white/5 dark:bg-white/5 opacity-60 cursor-not-allowed"
                          : appliedDepositId === dep.id
                            ? "border-emerald-600 bg-emerald-100 text-emerald-900 dark:border-emerald-500 dark:bg-emerald-500/20 dark:text-emerald-300"
                            : "border-emerald-200 bg-white text-neutral-700 hover:border-emerald-400 dark:border-emerald-500/30 dark:bg-[#12061F] dark:text-emerald-100/70 dark:hover:border-emerald-400"
                      }`}
                    >
                      <span className="font-semibold">{dep.invoice_number}</span>
                      <span className="flex items-center gap-2">
                        <span className="font-mono">{formatNaira(Number(dep.amount_paid))}</span>
                        {dep.is_allocated ? (
                          <span className="text-[10px] uppercase font-bold text-neutral-500 bg-neutral-200 border border-neutral-300 dark:bg-white/10 dark:text-white/50 dark:border-white/20 rounded px-1.5 py-0.5">Used</span>
                        ) : (
                          <span className="text-[10px] uppercase font-bold text-emerald-600 bg-emerald-100 border border-emerald-300 dark:text-emerald-400 dark:bg-emerald-500/10 dark:border-emerald-500/30 rounded px-1.5 py-0.5">Paid ✓</span>
                        )}
                        {appliedDepositId === dep.id && !dep.is_allocated && (
                          <span className="text-[10px] font-bold text-white bg-emerald-600 dark:bg-emerald-500 rounded px-1.5 py-0.5">Applied</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}


            {invoiceType === "collection" && (
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <Label className="text-sm font-medium dark:text-white/80">Allow Partial Payment?</Label>
                    {invoiceStage === "deposit" ? (
                      <span className="text-xs text-neutral-400 dark:text-white/40 italic">Disabled for deposit invoices</span>
                    ) : (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={allowPartialPayment} 
                          onChange={(e) => setAllowPartialPayment(e.target.checked)}
                          className="w-4 h-4 accent-purp-600 rounded border-purp-300 dark:border-white/20 dark:bg-[#1A0B2E]"
                        />
                        <span className="text-xs text-neutral-600 dark:text-white/60">Yes, allow partial</span>
                      </label>
                    )}
                  </div>
                  {allowPartialPayment && invoiceStage !== "deposit" && (
                    <div className="relative mt-2">
                      <Label className="text-xs text-neutral-500 dark:text-white/60 mb-1 block">Required Percentage</Label>
                      <div className="relative">
                        <Input
                          type="number"
                          step="1"
                          min="0"
                          max="100"
                          value={partialPaymentPct}
                          onChange={(e) => setPartialPaymentPct(e.target.value)}
                          className="border-2 border-purp-200 dark:border-white/10 bg-purp-50 dark:bg-white/5 dark:text-white h-11 pr-8"
                        />
                        <span className="absolute right-3 top-3 text-neutral-500 dark:text-white/40 font-medium">%</span>
                      </div>
                      <p className="text-[10px] text-neutral-500 dark:text-white/40 mt-1">Client must pay exactly this % or the full amount.</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {invoiceType === "record" && (
              <>
                <Separator className="bg-purp-200 dark:bg-white/10 my-2" />
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium dark:text-white/80">Initial Amount Paid (Optional)</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-3 text-neutral-500 dark:text-white/50 font-medium">₦</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={initialAmountPaid}
                        onChange={(e) => setInitialAmountPaid(e.target.value)}
                        className="pl-8 border-2 border-purp-200 dark:border-white/10 bg-purp-50 dark:bg-white/5 dark:text-white h-11"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium dark:text-white/80">Payment Method</Label>
                    <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v ?? "")}>
                      <SelectTrigger className="border-2 border-purp-200 dark:border-white/10 bg-purp-50 dark:bg-white/5 dark:text-white h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-2 border-purp-200 dark:border-white/10 dark:bg-[#1A0B2E]">
                        <SelectItem value="cash" className="dark:text-white dark:focus:bg-white/5">Cash</SelectItem>
                        <SelectItem value="bank_transfer" className="dark:text-white dark:focus:bg-white/5">Bank Transfer</SelectItem>
                        <SelectItem value="cheque" className="dark:text-white dark:focus:bg-white/5">Cheque</SelectItem>
                        <SelectItem value="pos" className="dark:text-white dark:focus:bg-white/5">POS</SelectItem>
                        <SelectItem value="other" className="dark:text-white dark:focus:bg-white/5">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Line Items */}
        <Card className={`border-2 shadow-none transition-all duration-300 dark:bg-[#1A0B2E] ${invoiceType === "record" ? "border-amber-200 dark:border-amber-500/20" : "border-blue-200 dark:border-blue-500/20"}`}>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-bold text-purp-900 dark:text-white">
                Line Items
              </CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addLineItem}
                className="border-2 border-purp-200 dark:border-white/10 text-purp-700 dark:text-[#B58CFF] hover:bg-purp-100 dark:hover:bg-white/10 dark:bg-white/5"
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add Item
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {/* Header Row */}
              <div className="hidden sm:grid sm:grid-cols-12 gap-3 text-xs font-bold text-purp-900 dark:text-white/60 uppercase tracking-wider px-1">
                <div className="col-span-4">Item Description</div>
                <div className="col-span-2">Quantity</div>
                <div className="col-span-2">Rate (₦)</div>
                <div className="col-span-2">Disc (%)</div>
                <div className="col-span-2 text-right">Line Total</div>
              </div>

              {lineItems.map((item) => {
                const lineTotal =
                  (parseFloat(item.quantity) || 0) *
                  (parseFloat(item.unitRate) || 0) *
                  (1 - (parseFloat(item.discountPct) || 0) / 100);
                return (
                  <div
                    key={item.id}
                    className="grid sm:grid-cols-12 gap-3 items-center bg-purp-50 dark:bg-white/5 border border-purp-200 dark:border-white/10 rounded-lg p-3"
                  >
                    <div className="sm:col-span-4 relative flex items-center">
                      <Input
                        placeholder="e.g. Consultation"
                        value={item.itemName}
                        onChange={(e) => updateLineItem(item.id, "itemName", e.target.value)}
                        className="border-2 border-purp-200 dark:border-white/10 bg-white dark:bg-[#1A0B2E] dark:text-white h-10 pr-[88px]"
                      />
                      {catalog.filter((c) => c.is_active).length > 0 && (
                        <div className="absolute right-1.5">
                          <DropdownMenu>
                            <DropdownMenuTrigger className="text-[10px] uppercase tracking-wider font-bold text-purp-600 dark:text-[#B58CFF] bg-purp-50 dark:bg-white/5 hover:bg-purp-100 dark:hover:bg-white/10 px-2 py-1 rounded transition-colors">
                              Use Saved
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56 border-2 border-purp-200 dark:border-white/10 dark:bg-[#1A0B2E] max-h-60 overflow-y-auto">
                              {catalog.filter((c) => c.is_active).map((c) => (
                                <DropdownMenuItem
                                  key={c.id}
                                  onClick={() => {
                                    updateLineItem(item.id, "itemName", c.item_name);
                                    updateLineItem(item.id, "unitRate", c.default_rate.toString());
                                  }}
                                  className="font-medium cursor-pointer flex justify-between dark:text-white dark:focus:bg-white/5"
                                >
                                  <span className="truncate pr-2">{c.item_name}</span>
                                  <span className="text-purp-600 dark:text-[#B58CFF] font-mono text-xs">{formatNaira(c.default_rate)}</span>
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </div>
                    <div className="sm:col-span-2">
                      <Input
                        type="number"
                        step="0.001"
                        min="0"
                        placeholder="1"
                        value={item.quantity}
                        onChange={(e) =>
                          updateLineItem(item.id, "quantity", e.target.value)
                        }
                        className="border-2 border-purp-200 dark:border-white/10 bg-white dark:bg-[#1A0B2E] dark:text-white h-10"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={item.unitRate}
                        onChange={(e) =>
                          updateLineItem(item.id, "unitRate", e.target.value)
                        }
                        className="border-2 border-purp-200 dark:border-white/10 bg-white dark:bg-[#1A0B2E] dark:text-white h-10"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        placeholder="0"
                        value={item.discountPct}
                        onChange={(e) =>
                          updateLineItem(item.id, "discountPct", e.target.value)
                        }
                        className="border-2 border-purp-200 dark:border-white/10 bg-white dark:bg-[#1A0B2E] dark:text-white h-10"
                      />
                    </div>
                    <div className="sm:col-span-2 flex items-center justify-between sm:justify-end gap-2">
                      <span className="font-semibold text-sm text-purp-900 dark:text-white">
                        {formatNaira(lineTotal)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeLineItem(item.id)}
                        className="text-neutral-500 hover:text-red-500 dark:text-white/40 dark:hover:text-red-400 transition-colors p-1"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Tax, Discount, Notes + Totals Summary */}
        <div className="grid lg:grid-cols-2 gap-6">
          <Card className="border-2 border-purp-200 dark:border-white/10 shadow-none dark:bg-[#1A0B2E]">
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-bold text-purp-900 dark:text-white">
                Tax, Discount &amp; Notes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium dark:text-white/80">Discount (%)</Label>
                    {discountTemplates.length > 0 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger className="text-[10px] uppercase tracking-wider font-bold text-purp-600 dark:text-[#B58CFF] bg-purp-50 dark:bg-white/5 hover:bg-purp-100 dark:hover:bg-white/10 px-2 py-1 rounded transition-colors">
                          Use Template
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="border-2 border-purp-200 dark:border-white/10 dark:bg-[#1A0B2E]">
                          {discountTemplates.filter((d) => d.is_active).map((d) => (
                            <DropdownMenuItem
                              key={d.id}
                              onClick={() => setDiscountPct(d.percentage.toString())}
                              className="font-medium cursor-pointer dark:text-white dark:focus:bg-white/5"
                            >
                              {d.name} <span className="ml-auto text-purp-600 dark:text-[#B58CFF]">{d.percentage}%</span>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={discountPct}
                    onChange={(e) => setDiscountPct(e.target.value)}
                    className="border-2 border-purp-200 dark:border-white/10 bg-purp-50 dark:bg-white/5 dark:text-white h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium dark:text-white/80">Tax (%)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={taxPct}
                    onChange={(e) => setTaxPct(e.target.value)}
                    className="border-2 border-purp-200 dark:border-white/10 bg-purp-50 dark:bg-white/5 dark:text-white h-11"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium dark:text-white/80">Notes / Terms</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Payment terms, additional context..."
                  className="border-2 border-purp-200 dark:border-white/10 bg-purp-50 dark:bg-white/5 dark:text-white min-h-[100px]"
                />
              </div>
            </CardContent>
          </Card>

          {/* Totals Summary */}
          <Card className="border-2 border-purp-200 dark:border-white/10 shadow-none dark:bg-[#1A0B2E]">
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-bold text-purp-900 dark:text-white">
                Invoice Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-500 dark:text-white/60">Subtotal</span>
                  <span className="font-medium dark:text-white">{formatNaira(totals.subtotal)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-500 dark:text-white/60">
                    Discount ({discountPct || "0"}%)
                  </span>
                  <span className="font-medium text-red-500 dark:text-red-400">
                    -{formatNaira(totals.discountValue)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-500 dark:text-white/60">Tax ({taxPct || "0"}%)</span>
                  <span className="font-medium dark:text-white">
                    +{formatNaira(totals.taxValue)}
                  </span>
                </div>
                {appliedDepositAmount > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-emerald-700 dark:text-emerald-400 font-medium">Previously Paid Deposit</span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-400">-{formatNaira(appliedDepositAmount)}</span>
                  </div>
                )}
                <Separator className="bg-purp-200 dark:bg-white/10" />
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold text-purp-900 dark:text-white">
                    {appliedDepositAmount > 0 ? "Outstanding Amount" : "Grand Total"}
                  </span>
                  <span className="text-2xl font-bold text-purp-900 dark:text-white">
                    {formatNaira(Math.max(0, totals.grandTotal - appliedDepositAmount))}
                  </span>
                </div>
                {appliedDepositAmount > 0 && (
                  <div className="flex items-center justify-between text-xs text-neutral-400 dark:text-white/40">
                    <span>Service Total</span>
                    <span className="font-mono">{formatNaira(totals.grandTotal)}</span>
                  </div>
                )}
              </div>

              <div className="mt-6 space-y-3">
                {error && (
                  <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg p-3 flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-500 dark:text-red-400" />
                    {error}
                  </div>
                )}
                {success && (
                  <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-lg p-3 flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400 font-medium">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    Invoice created! Redirecting...
                  </div>
                )}
                <Button
                  type="submit"
                  disabled={saving || success || isRestricted}
                  className="w-full h-11 bg-purp-900 hover:bg-purp-700 dark:bg-[#7B2FF7] dark:hover:bg-[#7B2FF7]/80 dark:text-white text-white font-semibold"
                >
                  {saving ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Creating Invoice...
                    </span>
                  ) : isRestricted ? (
                    <span className="flex items-center gap-2 text-red-100 dark:text-red-200">
                      <Lock className="h-4 w-4" />
                      Subscription Expired
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Save className="h-4 w-4" />
                      {invoiceType === "record" ? "Save Record Invoice" : "Create Invoice & Generate Link"}
                    </span>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </form>

      {merchant && (
        <CreateClientModal
          open={createClientModalOpen}
          onOpenChange={setCreateClientModalOpen}
          merchantId={merchant.id}
          onSuccess={(newClient) => {
            setClients([...clients, newClient]);
            setClientId(newClient.id);
            setCreateClientModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

export default function CreateInvoicePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-neutral-500">Loading invoice form...</div>}>
      <CreateInvoiceForm />
    </Suspense>
  );
}
