"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  FolderKanban, Plus, Search, TrendingUp, Wallet, ChevronDown, ChevronUp,
  User, Edit2, Check, X, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { createReferenceAction, updateReferenceAction } from "@/lib/actions";
import { getInvoices, getMerchant, getReferences } from "@/lib/data";
import { formatNaira } from "@/lib/calculations";
import { computeReferenceFinancials } from "@/lib/services/references/reference-financial-engine";
import type { InvoiceWithClient, Merchant, Reference } from "@/lib/types";

function ProgressBar({ pct, className = "" }: { pct: number; className?: string }) {
  const color =
    pct >= 100 ? "bg-emerald-500" :
    pct >= 80  ? "bg-emerald-400" :
    pct >= 50  ? "bg-blue-500" :
    pct >= 25  ? "bg-amber-500" : "bg-amber-400";
  return (
    <div className={`w-full bg-neutral-100 rounded-full h-2 overflow-hidden ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-700 ${color}`}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}

export default function ReferencesPage() {
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [references, setReferences] = useState<Reference[]>([]);
  const [invoices, setInvoices] = useState<InvoiceWithClient[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  // New reference form
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [handledBy, setHandledBy] = useState("");
  const [projectTotal, setProjectTotal] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editProjectTotal, setEditProjectTotal] = useState("");
  const [editHandledBy, setEditHandledBy] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Expand/collapse linked invoices
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    const m = await getMerchant();
    setMerchant(m);
    if (m) {
      const [refs, invs] = await Promise.all([getReferences(m.id), getInvoices(m.id)]);
      setReferences(refs);
      setInvoices(invs);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const summaries = useMemo(() =>
    references
      .filter((r) => r.name.toLowerCase().includes(query.toLowerCase()))
      .map((ref) => ({
        ref,
        financials: computeReferenceFinancials(ref, invoices as any),
      })),
    [references, invoices, query]
  );

  const handleCreate = async () => {
    if (!merchant || !name.trim()) return;
    setSaving(true); setError(null);
    const result = await createReferenceAction({
      merchant_id: merchant.id,
      name,
      description,
      handled_by: handledBy || undefined,
      project_total_value: projectTotal ? parseFloat(projectTotal.replace(/,/g, "")) : undefined,
    });
    setSaving(false);
    if (!result.success) { setError(result.error || "Could not create reference."); return; }
    setName(""); setDescription(""); setHandledBy(""); setProjectTotal("");
    await load();
  };

  const handleSaveEdit = async (ref: Reference) => {
    if (!merchant) return;
    setEditSaving(true);
    await updateReferenceAction({
      id: ref.id,
      merchant_id: merchant.id,
      handled_by: editHandledBy || undefined,
      project_total_value: editProjectTotal ? parseFloat(editProjectTotal.replace(/,/g, "")) : 0,
    });
    setEditSaving(false);
    setEditingId(null);
    await load();
  };

  if (loading) return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-purp-900">References</h1>
      <Card className="border-2 border-purp-200 shadow-none animate-pulse">
        <CardContent className="p-6"><div className="h-56 rounded bg-purp-50" /></CardContent>
      </Card>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-purp-900">References</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Group deposits, milestones, and balance invoices under one client project.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        {/* ── Create Form ── */}
        <Card className="border-2 border-purp-200 shadow-none h-fit">
          <CardHeader><CardTitle className="text-base text-purp-900">New Reference</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name <span className="text-red-500">*</span></Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Adaeze Wedding" className="border-2 border-purp-200" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional internal notes" className="border-2 border-purp-200 min-h-[64px]" />
            </div>
            <div className="space-y-1.5">
              <Label>Handled By</Label>
              <Input value={handledBy} onChange={(e) => setHandledBy(e.target.value)} placeholder="e.g. Chidi Okafor" className="border-2 border-purp-200" />
            </div>
            <div className="space-y-1.5">
              <Label>Total Project Value <span className="text-neutral-400 text-xs font-normal">(optional)</span></Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 font-bold text-sm">₦</span>
                <Input
                  value={projectTotal}
                  onChange={(e) => setProjectTotal(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="500,000"
                  className="border-2 border-purp-200 pl-7"
                />
              </div>
              <p className="text-xs text-neutral-400">Sets the project ceiling. Enables deposit tracking and progress bars.</p>
            </div>
            {error && <p className="text-sm font-medium text-red-600">{error}</p>}
            <Button
              onClick={handleCreate}
              disabled={saving || !name.trim()}
              className="w-full bg-purp-900 text-white hover:bg-purp-700"
            >
              <Plus className="mr-2 h-4 w-4" />
              {saving ? "Saving..." : "Create Reference"}
            </Button>
          </CardContent>
        </Card>

        {/* ── Reference Cards ── */}
        <div className="space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search references..." className="border-2 border-purp-200 pl-10" />
          </div>

          <div className="grid gap-3">
            {summaries.map(({ ref, financials }) => {
              const isExpanded = expandedIds.has(ref.id);
              const isEditing = editingId === ref.id;
              const linkedInvoices = (invoices as InvoiceWithClient[]).filter(
                (inv) => inv.reference_id === ref.id && inv.invoice_type === "collection"
              );

              return (
                <Card key={ref.id} className="border-2 border-purp-200 shadow-none">
                  <CardContent className="p-4 space-y-4">
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2">
                        <FolderKanban className="h-5 w-5 text-purp-700 mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="font-bold text-purp-900">{ref.name}</h2>
                            <Badge variant="outline" className="border-purp-200 text-xs">
                              {financials.invoiceCount} invoice{financials.invoiceCount !== 1 ? "s" : ""}
                            </Badge>
                            {ref.handled_by && (
                              <span className="flex items-center gap-1 text-xs text-neutral-500">
                                <User className="h-3 w-3" /> {ref.handled_by}
                              </span>
                            )}
                          </div>
                          {ref.description && (
                            <p className="mt-0.5 text-sm text-neutral-500">{ref.description}</p>
                          )}
                        </div>
                      </div>

                      {/* Edit / Save controls */}
                      <div className="flex gap-1 flex-shrink-0">
                        {isEditing ? (
                          <>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-emerald-600 hover:bg-emerald-50" onClick={() => handleSaveEdit(ref)} disabled={editSaving}>
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-neutral-500 hover:bg-neutral-100" onClick={() => setEditingId(null)}>
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-neutral-400 hover:text-purp-700 hover:bg-purp-50"
                            onClick={() => {
                              setEditingId(ref.id);
                              setEditProjectTotal(ref.project_total_value ? String(ref.project_total_value) : "");
                              setEditHandledBy(ref.handled_by || "");
                            }}>
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Inline edit fields */}
                    {isEditing && (
                      <div className="grid sm:grid-cols-2 gap-3 bg-purp-50 border border-purp-200 rounded-lg p-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Total Project Value</Label>
                          <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 text-sm">₦</span>
                            <Input value={editProjectTotal} onChange={(e) => setEditProjectTotal(e.target.value.replace(/[^0-9.]/g, ""))} className="pl-6 h-9 border-purp-200 bg-white text-sm" placeholder="500000" />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Handled By</Label>
                          <Input value={editHandledBy} onChange={(e) => setEditHandledBy(e.target.value)} className="h-9 border-purp-200 bg-white text-sm" placeholder="Team member name" />
                        </div>
                      </div>
                    )}

                    {/* Financial stats */}
                    {financials.hasProjectTotal ? (
                      <div className="space-y-3">
                        {/* Progress bar */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-neutral-500">Collection Progress</span>
                            <span className={`font-bold ${
                              financials.collectionProgress >= 100 ? "text-emerald-600" :
                              financials.collectionProgress >= 50 ? "text-blue-600" : "text-amber-600"
                            }`}>{financials.collectionProgress}%</span>
                          </div>
                          <ProgressBar pct={financials.collectionProgress} />
                        </div>
                        {/* Stat grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="bg-neutral-50 rounded-lg p-2.5 text-center">
                            <p className="text-[10px] text-neutral-500 font-medium uppercase tracking-wide">Project Total</p>
                            <p className="font-bold text-purp-900 text-sm mt-0.5">{formatNaira(financials.projectTotalValue)}</p>
                          </div>
                          <div className="bg-neutral-50 rounded-lg p-2.5 text-center">
                            <p className="text-[10px] text-neutral-500 font-medium uppercase tracking-wide">Billed</p>
                            <p className="font-bold text-neutral-700 text-sm mt-0.5">{formatNaira(financials.totalBilled)}</p>
                          </div>
                          <div className="bg-emerald-50 rounded-lg p-2.5 text-center">
                            <p className="text-[10px] text-emerald-600 font-medium uppercase tracking-wide">Collected</p>
                            <p className="font-bold text-emerald-700 text-sm mt-0.5">{formatNaira(financials.totalCollected)}</p>
                          </div>
                          <div className={`rounded-lg p-2.5 text-center ${financials.outstandingBalance > 0 ? "bg-amber-50" : "bg-emerald-50"}`}>
                            <p className={`text-[10px] font-medium uppercase tracking-wide ${financials.outstandingBalance > 0 ? "text-amber-600" : "text-emerald-600"}`}>Outstanding</p>
                            <p className={`font-bold text-sm mt-0.5 ${financials.outstandingBalance > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                              {financials.outstandingBalance > 0 ? formatNaira(financials.outstandingBalance) : "Paid ✓"}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* No project total — show simple invoice-based totals */
                      <div className="grid grid-cols-3 gap-4 text-right text-sm border-t border-neutral-100 pt-3">
                        <div>
                          <p className="text-xs text-neutral-500">Invoiced</p>
                          <p className="font-bold">{formatNaira(financials.totalBilled)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-neutral-500">Collected</p>
                          <p className="font-bold text-emerald-700">{formatNaira(financials.totalCollected)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-neutral-500">Outstanding</p>
                          <p className="font-bold text-amber-700">{formatNaira(financials.outstandingBalance)}</p>
                        </div>
                      </div>
                    )}

                    {/* Linked invoices — expandable */}
                    {linkedInvoices.length > 0 && (
                      <div className="border-t border-neutral-100 pt-3">
                        <button
                          className="flex items-center gap-1.5 text-xs font-semibold text-purp-700 hover:text-purp-900 transition-colors"
                          onClick={() => {
                            setExpandedIds((prev) => {
                              const n = new Set(prev);
                              n.has(ref.id) ? n.delete(ref.id) : n.add(ref.id);
                              return n;
                            });
                          }}
                        >
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          {isExpanded ? "Hide" : "Show"} {linkedInvoices.length} linked invoice{linkedInvoices.length !== 1 ? "s" : ""}
                        </button>

                        {isExpanded && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {linkedInvoices.map((inv) => (
                              <Link
                                key={inv.id}
                                href={`/invoices/${inv.id}`}
                                className="flex items-center gap-1.5 rounded border border-purp-200 bg-purp-50 px-2.5 py-1 text-xs font-semibold text-purp-800 hover:bg-purp-100 transition-colors"
                              >
                                <span>{inv.invoice_number}</span>
                                {(inv as any).invoice_stage && (inv as any).invoice_stage !== "standard" && (
                                  <span className="bg-purp-200 text-purp-800 px-1.5 py-0.5 rounded text-[10px] capitalize">
                                    {(inv as any).invoice_stage}
                                  </span>
                                )}
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* CTA */}
                    <div className="flex items-center justify-between border-t border-neutral-100 pt-3">
                      <Link href={`/invoices/create?reference=${ref.id}&type=collection`}>
                        <Button size="sm" variant="outline" className="border-purp-200 text-purp-700 hover:bg-purp-50 text-xs h-7">
                          <Plus className="h-3 w-3 mr-1" /> New Invoice
                        </Button>
                      </Link>
                      {financials.hasProjectTotal && financials.outstandingBalance > 0 && (
                        <span className="text-xs text-neutral-500">
                          Suggested next: <strong className="text-purp-900">{formatNaira(financials.suggestedNextInvoiceAmount)}</strong>
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {summaries.length === 0 && (
              <Card className="border-2 border-purp-200 shadow-none">
                <CardContent className="p-8 text-center text-sm text-neutral-500">
                  {query ? "No references match your search." : "No references yet. Create your first project above."}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
