"use client";

import { use, useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Save, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getInvoiceById, getItemCatalog, getDiscountTemplates } from "@/lib/data";
import { editInvoice } from "@/lib/actions";
import type { InvoiceWithLineItems, ItemCatalog, DiscountTemplate } from "@/lib/types";
import { calculateInvoiceTotals, formatNaira, getStatusColor, getStatusLabel } from "@/lib/calculations";

interface FormLineItem {
  id: string;
  itemName: string;
  quantity: string;
  unitRate: string;
  isNew?: boolean;    // flag for newly added items like late fees
}

export default function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceWithLineItems | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const [discountPct, setDiscountPct] = useState("0");
  const [taxPct, setTaxPct] = useState("7.5");
  const [allowPartialPayment, setAllowPartialPayment] = useState(false);
  const [partialPaymentPct, setPartialPaymentPct] = useState("50");
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<FormLineItem[]>([]);
  const [catalog, setCatalog] = useState<ItemCatalog[]>([]);
  const [discountTemplates, setDiscountTemplates] = useState<DiscountTemplate[]>([]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      getInvoiceById(id),
      getItemCatalog(),
      getDiscountTemplates(),
    ]).then(([inv, cat, tpls]) => {
      if (inv) {
        setInvoice(inv);
        setDiscountPct(String(inv.discount_pct));
        setTaxPct(String(inv.tax_pct));
        setAllowPartialPayment(inv.allow_partial_payment || false);
        setPartialPaymentPct(inv.partial_payment_pct ? String(inv.partial_payment_pct) : "50");
        setNotes(inv.notes || "");
        setLineItems(
          (inv.line_items || []).map((item) => ({
            id: item.id,
            itemName: item.item_name,
            quantity: String(item.quantity),
            unitRate: String(item.unit_rate),
            isNew: false,
          }))
        );
      }
      setCatalog(cat);
      setDiscountTemplates(tpls);
      setLoading(false);
    });
  }, [id]);

  const addLineItem = (prefill?: { name: string; rate: string }) => {
    setLineItems((prev) => [
      ...prev,
      {
        id: `new_${Date.now()}`,
        itemName: prefill?.name || "",
        quantity: "1",
        unitRate: prefill?.rate || "",
        isNew: true,
      },
    ]);
  };

  const removeLineItem = (itemId: string) => {
    if (lineItems.length > 1) {
      setLineItems(lineItems.filter((li) => li.id !== itemId));
    }
  };

  const updateLineItem = (itemId: string, field: keyof FormLineItem, value: string) => {
    setLineItems((prev) =>
      prev.map((li) => (li.id === itemId ? { ...li, [field]: value } : li))
    );
  };

  // Calculate totals live
  const parsedItems = lineItems.map((li) => ({
    quantity: parseFloat(li.quantity) || 0,
    unitRate: parseFloat(li.unitRate) || 0,
  }));

  const totals = calculateInvoiceTotals(
    parsedItems,
    parseFloat(discountPct) || 0,
    parseFloat(taxPct) || 0
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoice) return;
    setError("");

    const amountPaid = Number(invoice.amount_paid);
    const newOutstanding = totals.grandTotal - amountPaid;

    if (newOutstanding < 0) {
      setError("Grand total cannot be less than the amount already paid.");
      return;
    }

    startTransition(async () => {
      const result = await editInvoice(
        invoice.id,
        {
          subtotal: totals.subtotal,
          discount_pct: parseFloat(discountPct) || 0,
          discount_value: totals.discountValue,
          tax_pct: parseFloat(taxPct) || 0,
          tax_value: totals.taxValue,
          grand_total: totals.grandTotal,
          outstanding_balance: newOutstanding,
          notes,
          allow_partial_payment: invoice.invoice_type === "collection" ? allowPartialPayment : false,
          partial_payment_pct: (invoice.invoice_type === "collection" && allowPartialPayment) ? parseFloat(partialPaymentPct) : null,
        },
        lineItems.map((li, idx) => ({
          item_name: li.itemName,
          quantity: parseFloat(li.quantity) || 0,
          unit_rate: parseFloat(li.unitRate) || 0,
          line_total: Math.round(((parseFloat(li.quantity) || 0) * (parseFloat(li.unitRate) || 0) + Number.EPSILON) * 100) / 100,
          sort_order: idx + 1,
        }))
      );

      if (result.success) {
        router.push(`/invoices/${invoice.id}`);
      } else {
        setError(result.error || "Failed to save changes");
      }
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 border-2 border-purp-700 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <h2 className="text-xl font-bold text-purp-900">Invoice Not Found</h2>
          <Link href="/invoices">
            <Button className="mt-4 bg-purp-900 hover:bg-purp-700 text-white">Back to Invoices</Button>
          </Link>
        </div>
      </div>
    );
  }

  const amountPaid = Number(invoice.amount_paid);
  const newOutstanding = totals.grandTotal - amountPaid;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/invoices/${invoice.id}`}>
          <Button variant="outline" size="icon" className="border-2 border-purp-200">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-purp-900">
              Edit {invoice.invoice_number}
            </h1>
            <Badge variant="outline" className={`${getStatusColor(invoice.status)} border-2 font-semibold text-xs`}>
              {getStatusLabel(invoice.status)}
            </Badge>
          </div>
          <p className="text-neutral-500 text-sm mt-0.5">
            Modify line items, discounts, taxes, and notes. Changes are tracked in invoice history.
          </p>
        </div>
      </div>

      {/* Warning for partially paid invoices */}
      {amountPaid > 0 && (
        <div className="bg-amber-50 border-2 border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-amber-800">This invoice has existing payments</p>
            <p className="text-amber-700 mt-1">
              <strong>{formatNaira(amountPaid)}</strong> has already been collected.
              The new grand total must be at least this amount. The outstanding balance will be recalculated automatically.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 text-sm text-red-700 font-medium">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Line Items */}
        <Card className="border-2 border-purp-200 shadow-none">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-bold text-purp-900">
                Line Items
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addLineItem({ name: "Late Fee", rate: "" })}
                  className="border-2 border-amber-200 text-amber-700 hover:bg-amber-50"
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add Late Fee
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addLineItem()}
                  className="border-2 border-purp-200 text-purp-700 hover:bg-purp-100"
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add Item
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {/* Header Row */}
              <div className="hidden sm:grid sm:grid-cols-12 gap-3 text-xs font-bold text-purp-900 uppercase tracking-wider px-1">
                <div className="col-span-5">Item Description</div>
                <div className="col-span-2">Quantity</div>
                <div className="col-span-3">Unit Rate (₦)</div>
                <div className="col-span-2 text-right">Line Total</div>
              </div>

              {lineItems.map((item) => {
                const lineTotal =
                  (parseFloat(item.quantity) || 0) *
                  (parseFloat(item.unitRate) || 0);
                return (
                  <div
                    key={item.id}
                    className={`grid sm:grid-cols-12 gap-3 items-center border rounded-lg p-3 ${
                      item.isNew
                        ? "bg-amber-50/50 border-amber-200"
                        : "bg-purp-50 border-purp-200"
                    }`}
                  >
                    <div className="sm:col-span-5 relative flex items-center">
                      <Input
                        placeholder="e.g. Late Fee, Additional Service"
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
                        onChange={(e) => updateLineItem(item.id, "quantity", e.target.value)}
                        className="border-2 border-purp-200 bg-white h-10"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={item.unitRate}
                        onChange={(e) => updateLineItem(item.id, "unitRate", e.target.value)}
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
                Tax, Discount & Notes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Discount (%)</Label>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" size="sm" className="h-6 text-xs text-purp-700 hover:text-purp-900 px-2">
                            Use Template
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end" className="w-48 border-2 border-purp-200">
                        {discountTemplates.filter((t) => t.is_active).length === 0 ? (
                          <div className="px-2 py-3 text-xs text-neutral-500 text-center">
                            No active templates
                          </div>
                        ) : (
                          discountTemplates
                            .filter((t) => t.is_active)
                            .map((t) => (
                              <DropdownMenuItem
                                key={t.id}
                                onClick={() => setDiscountPct(t.percentage.toString())}
                                className="cursor-pointer flex justify-between"
                              >
                                <span>{t.name}</span>
                                <span className="text-neutral-500 font-mono text-xs">{t.percentage}%</span>
                              </DropdownMenuItem>
                            ))
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
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
                  {Number(invoice.discount_pct) > 0 && discountPct === "0" && (
                    <p className="text-xs text-amber-600 font-medium">
                      ⚠ Discount removed from original {invoice.discount_pct}%
                    </p>
                  )}
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

              {invoice.invoice_type === "collection" && (
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
                Updated Summary
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

                {/* Show the recalculated outstanding */}
                <Separator className="bg-purp-200" />
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-500">Already Paid</span>
                  <span className="font-semibold text-emerald-600">{formatNaira(amountPaid)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-purp-900">New Outstanding</span>
                  <span className={`font-bold text-lg ${newOutstanding < 0 ? "text-red-600" : "text-amber-600"}`}>
                    {formatNaira(newOutstanding)}
                  </span>
                </div>
                {newOutstanding < 0 && (
                  <p className="text-xs text-red-600 font-medium">
                    Grand total cannot be less than the amount already paid.
                  </p>
                )}
              </div>

              <div className="mt-6">
                <Button
                  type="submit"
                  disabled={isPending || newOutstanding < 0 || lineItems.every((li) => !li.itemName)}
                  className="w-full h-11 bg-purp-900 hover:bg-purp-700 text-white font-semibold"
                >
                  {isPending ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Saving Changes...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Save className="h-4 w-4" />
                      Save Changes
                    </span>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </form>
    </div>
  );
}
