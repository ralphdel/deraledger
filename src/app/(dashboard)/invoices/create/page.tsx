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
import { getClients, getItemCatalog, getDiscountTemplates } from "@/lib/data";
import type { Client, Merchant, ItemCatalog, DiscountTemplate } from "@/lib/types";
import { calculateInvoiceTotals, formatNaira } from "@/lib/calculations";
import { createInvoiceAction } from "@/lib/actions";
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
  const defaultType = (searchParams.get("type") as "record" | "collection") || "collection";
  const [clients, setClients] = useState<Client[]>([]);
  const [catalog, setCatalog] = useState<ItemCatalog[]>([]);
  const [discountTemplates, setDiscountTemplates] = useState<DiscountTemplate[]>([]);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [invoiceType, setInvoiceType] = useState<"record" | "collection">(defaultType);
  const [initialAmountPaid, setInitialAmountPaid] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [useCustomNumber, setUseCustomNumber] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [clientId, setClientId] = useState("");
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

  useEffect(() => {
    getClients().then(setClients);

    // Load merchant context and their catalog/templates
    const sb = createClient();
    sb.auth.getUser().then(async ({ data: { user } }) => {
      if (user) {
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
      setError("Session error: could not load your merchant account. Please refresh.");
      return;
    }
    if (lineItems.every((li) => !li.itemName.trim())) {
      setError("Please add at least one line item with a description.");
      return;
    }

    setSaving(true);

    const result = await createInvoiceAction({
      merchant_id: merchant.id,
      client_id: clientId,
      invoice_number: useCustomNumber ? invoiceNumber : undefined,
      invoice_type: invoiceType,
      discount_pct: parseFloat(discountPct) || 0,
      tax_pct: parseFloat(taxPct) || 0,
      fee_absorption: invoiceType === "record" ? "business" : (feeAbsorption as "business" | "customer"),
      pay_by_date: payByDate || undefined,
      notes: notes || undefined,
      payment_notes: invoiceType === "record" ? notes : undefined, // Reuse notes for payment ref
      initial_amount_paid: invoiceType === "record" ? (initialAmountPaid ? parseFloat(initialAmountPaid) : totals.grandTotal) : 0,
      payment_method: paymentMethod,
      allow_partial_payment: invoiceType === "collection" ? allowPartialPayment : false,
      partial_payment_pct: (invoiceType === "collection" && allowPartialPayment) ? parseFloat(partialPaymentPct) : null,
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
          <Button variant="outline" size="icon" className="border-2 border-purp-200">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-purp-900">Create Invoice</h1>
          <p className="text-neutral-500 text-sm mt-0.5">
            Fill in the details to generate a new invoice
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Invoice Type Selector */}
        <div className="grid sm:grid-cols-2 gap-4">
          <Card
            className={`cursor-pointer border-2 transition-all shadow-sm ${invoiceType === "record"
                ? "border-amber-600 bg-amber-50 ring-2 ring-amber-200"
                : "border-neutral-200 hover:border-amber-300"
              }`}
            onClick={() => {
              setInvoiceType("record");
              router.replace("/invoices/create?type=record", { scroll: false });
            }}
          >
            <CardContent className="p-5 flex items-start gap-4">
              <div className={`p-2 rounded-lg ${invoiceType === "record" ? "bg-amber-600 text-white" : "bg-neutral-100 text-neutral-500"}`}>
                <FileText className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h3 className={`font-bold ${invoiceType === "record" ? "text-amber-900" : "text-neutral-700"}`}>Record Invoice</h3>
                <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
                  For offline bookkeeping. Generates a standard receipt without a Paystack portal.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card
            className={`border-2 transition-all shadow-sm ${(merchant?.subscription_plan === "starter" || merchant?.verification_status !== "verified") ? "opacity-60 bg-neutral-50 cursor-not-allowed" : "cursor-pointer"
              } ${invoiceType === "collection"
                ? "border-blue-600 bg-blue-50 ring-2 ring-blue-200"
                : "border-neutral-200 hover:border-blue-300"
              }`}
            onClick={() => {
              if (merchant?.subscription_plan === "starter" || merchant?.verification_status !== "verified") return; // Locked for starter or unverified
              setInvoiceType("collection");
              router.replace("/invoices/create?type=collection", { scroll: false });
            }}
          >
            <CardContent className="p-5 flex items-start gap-4">
              <div className={`p-2 rounded-lg ${invoiceType === "collection" ? "bg-blue-600 text-white" : "bg-neutral-100 text-neutral-500"}`}>
                <LinkIcon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className={`font-bold ${invoiceType === "collection" ? "text-blue-900" : "text-neutral-700"}`}>Collection Invoice</h3>
                  {merchant?.subscription_plan === "starter" ? (
                    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">
                      <Lock className="h-3 w-3" /> Upgrade
                    </span>
                  ) : merchant?.verification_status !== "verified" ? (
                    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">
                      <Lock className="h-3 w-3" /> Verify KYC
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
                  Live payment portal. Clients can pay directly via Card, Transfer, or USSD securely.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Client & Invoice Number */}
        <Card className={`border-2 shadow-none transition-all duration-300 ${invoiceType === "record" ? "border-amber-200" : "border-blue-200"}`}>
          <CardHeader className={`pb-4 border-b-2 ${invoiceType === "record" ? "border-amber-100 bg-amber-50/50" : "border-blue-100 bg-blue-50/50"}`}>
            <CardTitle className="text-base font-bold flex items-center justify-between">
              <span className={invoiceType === "record" ? "text-amber-900" : "text-blue-900"}>
                Invoice Details
              </span>
              <Badge variant="outline" className={`${invoiceType === "record" ? "bg-amber-100 text-amber-700 border-amber-300" : "bg-blue-100 text-blue-700 border-blue-300"} uppercase tracking-wider text-[10px]`}>
                {invoiceType === "record" ? "Offline Receipt Mode" : "Live Payment Portal Mode"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Client</Label>
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
                    <SelectTrigger className="border-2 border-purp-200 bg-purp-50 h-11">
                      <span className={selectedClient ? "text-neutral-900" : "text-neutral-400"}>
                        {selectedClient
                          ? `${selectedClient.full_name}${selectedClient.company_name ? ` — ${selectedClient.company_name}` : ""}`
                          : "Select a client"}
                      </span>
                    </SelectTrigger>
                    <SelectContent className="border-2 border-purp-200">
                      <SelectItem value="NEW_CLIENT" className="text-purp-700 font-semibold focus:text-purp-800 focus:bg-purp-50">
                        <span className="flex items-center gap-2">
                          <Plus className="h-4 w-4" />
                          New Client
                        </span>
                      </SelectItem>
                      <Separator className="my-1 bg-purp-100" />
                      {clients.length === 0 && (
                        <div className="px-3 py-2 text-sm text-neutral-400">No clients yet</div>
                      )}
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
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
                  <Label className="text-sm font-medium">Invoice Number</Label>
                  <button
                    type="button"
                    onClick={() => setUseCustomNumber(!useCustomNumber)}
                    className="text-xs text-purp-700 hover:underline font-medium"
                  >
                    {useCustomNumber ? "Use auto-generated" : "Use custom"}
                  </button>
                </div>
                <Input
                  value={useCustomNumber ? invoiceNumber : ""}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  disabled={!useCustomNumber}
                  className="border-2 border-purp-200 bg-purp-50 h-11"
                  placeholder={useCustomNumber ? "e.g. INV-2025-007" : "Auto-generated on save"}
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  {invoiceType === "record" ? "Due Date" : "Pay-By Date"}
                </Label>
                <Input
                  type="date"
                  value={payByDate}
                  onChange={(e) => setPayByDate(e.target.value)}
                  className="border-2 border-purp-200 bg-purp-50 h-11"
                />
              </div>

              {invoiceType === "collection" && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Fee Absorption</Label>
                  <Select value={feeAbsorption} onValueChange={(v) => setFeeAbsorption(v ?? "business")}>
                    <SelectTrigger className="border-2 border-purp-200 bg-purp-50 h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-2 border-purp-200">
                      <SelectItem value="business">Business Absorbs</SelectItem>
                      <SelectItem value="customer">Customer Absorbs</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {invoiceType === "collection" && (
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <Label className="text-sm font-medium">Allow Partial Payment?</Label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={allowPartialPayment} 
                        onChange={(e) => setAllowPartialPayment(e.target.checked)}
                        className="w-4 h-4 accent-purp-600 rounded border-purp-300"
                      />
                      <span className="text-xs text-neutral-600">Yes, allow partial</span>
                    </label>
                  </div>
                  {allowPartialPayment && (
                    <div className="relative mt-2">
                      <Label className="text-xs text-neutral-500 mb-1 block">Required Percentage</Label>
                      <div className="relative">
                        <Input
                          type="number"
                          step="1"
                          min="0"
                          max="100"
                          value={partialPaymentPct}
                          onChange={(e) => setPartialPaymentPct(e.target.value)}
                          className="border-2 border-purp-200 bg-purp-50 h-11 pr-8"
                        />
                        <span className="absolute right-3 top-3 text-neutral-500 font-medium">%</span>
                      </div>
                      <p className="text-[10px] text-neutral-500 mt-1">Client must pay exactly this % or the full amount.</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {invoiceType === "record" && (
              <>
                <Separator className="bg-purp-200 my-2" />
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Initial Amount Paid (Optional)</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-3 text-neutral-500 font-medium">₦</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={initialAmountPaid}
                        onChange={(e) => setInitialAmountPaid(e.target.value)}
                        className="pl-8 border-2 border-purp-200 bg-purp-50 h-11"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Payment Method</Label>
                    <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v ?? "")}>
                      <SelectTrigger className="border-2 border-purp-200 bg-purp-50 h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-2 border-purp-200">
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                        <SelectItem value="cheque">Cheque</SelectItem>
                        <SelectItem value="pos">POS</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Line Items */}
        <Card className={`border-2 shadow-none transition-all duration-300 ${invoiceType === "record" ? "border-amber-200" : "border-blue-200"}`}>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-bold text-purp-900">
                Line Items
              </CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addLineItem}
                className="border-2 border-purp-200 text-purp-700 hover:bg-purp-100"
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add Item
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {/* Header Row */}
              <div className="hidden sm:grid sm:grid-cols-12 gap-3 text-xs font-bold text-purp-900 uppercase tracking-wider px-1">
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
                    className="grid sm:grid-cols-12 gap-3 items-center bg-purp-50 border border-purp-200 rounded-lg p-3"
                  >
                    <div className="sm:col-span-4 relative flex items-center">
                      <Input
                        placeholder="e.g. Consultation"
                        value={item.itemName}
                        onChange={(e) => updateLineItem(item.id, "itemName", e.target.value)}
                        className="border-2 border-purp-200 bg-white h-10 pr-[88px]"
                      />
                      {catalog.filter((c) => c.is_active).length > 0 && (
                        <div className="absolute right-1.5">
                          <DropdownMenu>
                            <DropdownMenuTrigger className="text-[10px] uppercase tracking-wider font-bold text-purp-600 bg-purp-50 hover:bg-purp-100 px-2 py-1 rounded transition-colors">
                              Use Saved
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56 border-2 border-purp-200 max-h-60 overflow-y-auto">
                              {catalog.filter((c) => c.is_active).map((c) => (
                                <DropdownMenuItem
                                  key={c.id}
                                  onClick={() => {
                                    updateLineItem(item.id, "itemName", c.item_name);
                                    updateLineItem(item.id, "unitRate", c.default_rate.toString());
                                  }}
                                  className="font-medium cursor-pointer flex justify-between"
                                >
                                  <span className="truncate pr-2">{c.item_name}</span>
                                  <span className="text-purp-600 font-mono text-xs">{formatNaira(c.default_rate)}</span>
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
                        className="border-2 border-purp-200 bg-white h-10"
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
                        className="border-2 border-purp-200 bg-white h-10"
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
                        className="border-2 border-purp-200 bg-white h-10"
                      />
                    </div>
                    <div className="sm:col-span-2 flex items-center justify-between sm:justify-end gap-2">
                      <span className="font-semibold text-sm text-purp-900">
                        {formatNaira(lineTotal)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeLineItem(item.id)}
                        className="text-neutral-500 hover:text-red-500 transition-colors p-1"
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
          <Card className="border-2 border-purp-200 shadow-none">
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-bold text-purp-900">
                Tax, Discount &amp; Notes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Discount (%)</Label>
                    {discountTemplates.length > 0 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger className="text-[10px] uppercase tracking-wider font-bold text-purp-600 bg-purp-50 hover:bg-purp-100 px-2 py-1 rounded">
                          Use Template
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="border-2 border-purp-200">
                          {discountTemplates.filter((d) => d.is_active).map((d) => (
                            <DropdownMenuItem
                              key={d.id}
                              onClick={() => setDiscountPct(d.percentage.toString())}
                              className="font-medium cursor-pointer"
                            >
                              {d.name} <span className="ml-auto text-purp-600">{d.percentage}%</span>
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
                    className="border-2 border-purp-200 bg-purp-50 h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Tax (%)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={taxPct}
                    onChange={(e) => setTaxPct(e.target.value)}
                    className="border-2 border-purp-200 bg-purp-50 h-11"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Notes / Terms</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Payment terms, additional context..."
                  className="border-2 border-purp-200 bg-purp-50 min-h-[100px]"
                />
              </div>
            </CardContent>
          </Card>

          {/* Totals Summary */}
          <Card className="border-2 border-purp-200 shadow-none">
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-bold text-purp-900">
                Invoice Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-500">Subtotal</span>
                  <span className="font-medium">{formatNaira(totals.subtotal)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-500">
                    Discount ({discountPct || "0"}%)
                  </span>
                  <span className="font-medium text-red-500">
                    -{formatNaira(totals.discountValue)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-500">Tax ({taxPct || "0"}%)</span>
                  <span className="font-medium">
                    +{formatNaira(totals.taxValue)}
                  </span>
                </div>
                <Separator className="bg-purp-200" />
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold text-purp-900">
                    Grand Total
                  </span>
                  <span className="text-2xl font-bold text-purp-900">
                    {formatNaira(totals.grandTotal)}
                  </span>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2 text-sm text-red-600">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-500" />
                    {error}
                  </div>
                )}
                {success && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center gap-2 text-sm text-emerald-700 font-medium">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    Invoice created! Redirecting...
                  </div>
                )}
                <Button
                  type="submit"
                  disabled={saving || success}
                  className="w-full h-11 bg-purp-900 hover:bg-purp-700 text-white font-semibold"
                >
                  {saving ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Creating Invoice...
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
