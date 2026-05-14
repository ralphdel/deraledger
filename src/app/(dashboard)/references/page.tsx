"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FolderKanban, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { createReferenceAction } from "@/lib/actions";
import { getInvoices, getMerchant, getReferences } from "@/lib/data";
import { formatNaira } from "@/lib/calculations";
import type { InvoiceWithClient, Merchant, Reference } from "@/lib/types";

export default function ReferencesPage() {
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [references, setReferences] = useState<Reference[]>([]);
  const [invoices, setInvoices] = useState<InvoiceWithClient[]>([]);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    load();
  }, []);

  const summaries = useMemo(() => references.map((ref) => {
    const linked = invoices.filter((inv) => inv.reference_id === ref.id);
    const totalInvoiced = linked.reduce((sum, inv) => sum + Number(inv.grand_total || 0), 0);
    const collected = linked.reduce((sum, inv) => sum + Number(inv.amount_paid || 0), 0);
    const outstanding = Math.max(0, totalInvoiced - collected);
    return { ref, linked, totalInvoiced, collected, outstanding };
  }).filter((item) => item.ref.name.toLowerCase().includes(query.toLowerCase())), [references, invoices, query]);

  const handleCreate = async () => {
    if (!merchant || !name.trim()) return;
    setSaving(true);
    setError(null);
    const result = await createReferenceAction({
      merchant_id: merchant.id,
      name,
      description,
    });
    setSaving(false);
    if (!result.success) {
      setError(result.error || "Could not create reference.");
      return;
    }
    setName("");
    setDescription("");
    await load();
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-purp-900">References</h1>
        <Card className="border-2 border-purp-200 shadow-none animate-pulse">
          <CardContent className="p-6"><div className="h-56 rounded bg-purp-50" /></CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-purp-900">References</h1>
        <p className="mt-1 text-sm text-neutral-500">Group deposits, balances, and milestone invoices under one client project.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card className="border-2 border-purp-200 shadow-none">
          <CardHeader><CardTitle className="text-base text-purp-900">New Reference</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Adaeze Wedding" className="border-2 border-purp-200" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional internal context" className="border-2 border-purp-200" />
            </div>
            {error && <p className="text-sm font-medium text-red-600">{error}</p>}
            <Button onClick={handleCreate} disabled={saving || !name.trim()} className="w-full bg-purp-900 text-white hover:bg-purp-700">
              <Plus className="mr-2 h-4 w-4" /> {saving ? "Saving..." : "Create Reference"}
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search references..." className="border-2 border-purp-200 pl-10" />
          </div>

          <div className="grid gap-3">
            {summaries.map(({ ref, linked, totalInvoiced, collected, outstanding }) => (
              <Card key={ref.id} className="border-2 border-purp-200 shadow-none">
                <CardContent className="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <FolderKanban className="h-4 w-4 text-purp-700" />
                        <h2 className="font-bold text-purp-900">{ref.name}</h2>
                        <Badge variant="outline" className="border-purp-200 text-xs">{linked.length} invoices</Badge>
                      </div>
                      {ref.description && <p className="mt-1 text-sm text-neutral-500">{ref.description}</p>}
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-right text-sm">
                      <div><p className="text-xs text-neutral-500">Invoiced</p><p className="font-bold">{formatNaira(totalInvoiced)}</p></div>
                      <div><p className="text-xs text-neutral-500">Collected</p><p className="font-bold text-emerald-700">{formatNaira(collected)}</p></div>
                      <div><p className="text-xs text-neutral-500">Outstanding</p><p className="font-bold text-amber-700">{formatNaira(outstanding)}</p></div>
                    </div>
                  </div>
                  {linked.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {linked.slice(0, 6).map((inv) => (
                        <Link key={inv.id} href={`/invoices/${inv.id}`} className="rounded border border-purp-200 bg-purp-50 px-2 py-1 text-xs font-semibold text-purp-800 hover:bg-purp-100">
                          {inv.invoice_number}
                        </Link>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
            {summaries.length === 0 && (
              <Card className="border-2 border-purp-200 shadow-none">
                <CardContent className="p-8 text-center text-sm text-neutral-500">No references found.</CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
