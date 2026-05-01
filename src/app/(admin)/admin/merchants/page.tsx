"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Users, Search, AlertTriangle, MoreHorizontal, Ban, Trash2,
  CheckCircle2, ExternalLink, Filter,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import { formatNaira } from "@/lib/calculations";
import type { Merchant } from "@/lib/types";
import { adminDeactivateMerchantAction, adminDeleteMerchantAction, adminReactivateMerchantAction } from "@/lib/actions";

type ModalState =
  | { type: "deactivate"; merchant: Merchant }
  | { type: "reactivate"; merchant: Merchant }
  | { type: "delete"; merchant: Merchant; confirmName: string; error: string | null }
  | null;

interface MerchantStats {
  teamCount: number;
  recordInvoices: number;
  collectionInvoices: number;
  monthlyCollected: number;
  subscriptionExpiry?: string | null;
  subscriptionStatus?: string | null;
}

export default function AdminMerchantsPage() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [merchantStats, setMerchantStats] = useState<Record<string, MerchantStats>>({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [settlementFilter, setSettlementFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [modal, setModal] = useState<ModalState>(null);
  const [processing, setProcessing] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const sb = createClient();

    const [merchantRes, teamRes, invoiceRes, txRes, subRes] = await Promise.all([
      sb.from("merchants").select("*").order("created_at", { ascending: false }),
      sb.from("merchant_team").select("merchant_id"),
      sb.from("invoices").select("merchant_id, invoice_type"),
      sb.from("transactions").select("merchant_id, amount_paid, created_at").eq("status", "success"),
      sb.from("subscriptions").select("merchant_id, expiry_date, status").eq("status", "active"),
    ]);

    const allMerchants = (merchantRes.data || []) as Merchant[];
    setMerchants(allMerchants);

    // Build stats per merchant
    const stats: Record<string, MerchantStats> = {};
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    for (const m of allMerchants) {
      stats[m.id] = { teamCount: 0, recordInvoices: 0, collectionInvoices: 0, monthlyCollected: 0 };
    }

    (teamRes.data || []).forEach((t: any) => {
      if (stats[t.merchant_id]) stats[t.merchant_id].teamCount++;
    });

    (invoiceRes.data || []).forEach((i: any) => {
      if (!stats[i.merchant_id]) return;
      if (i.invoice_type === "record") stats[i.merchant_id].recordInvoices++;
      else stats[i.merchant_id].collectionInvoices++;
    });

    (txRes.data || []).forEach((t: any) => {
      if (!stats[t.merchant_id]) return;
      if (t.created_at >= firstOfMonth) {
        stats[t.merchant_id].monthlyCollected += Number(t.amount_paid);
      }
    });

    // Add subscription info (take the latest active if multiple)
    (subRes.data || []).forEach((s: any) => {
      if (stats[s.merchant_id]) {
        stats[s.merchant_id].subscriptionExpiry = s.expiry_date;
        stats[s.merchant_id].subscriptionStatus = s.status;
      }
    });

    setMerchantStats(stats);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleConfirmDeactivate = async () => {
    if (modal?.type !== "deactivate") return;
    setProcessing(true);
    await adminDeactivateMerchantAction(modal.merchant.id);
    await fetchData();
    setModal(null);
    setProcessing(false);
  };

  const handleConfirmReactivate = async () => {
    if (modal?.type !== "reactivate") return;
    setProcessing(true);
    await adminReactivateMerchantAction(modal.merchant.id);
    await fetchData();
    setModal(null);
    setProcessing(false);
  };

  const handleConfirmDelete = async () => {
    if (modal?.type !== "delete") return;
    if (modal.confirmName !== modal.merchant.business_name) {
      setModal({ ...modal, error: "Business name did not match. Please try again." });
      return;
    }
    setProcessing(true);
    await adminDeleteMerchantAction(modal.merchant.id);
    await fetchData();
    setModal(null);
    setProcessing(false);
  };

  const effectiveTier = (m: Merchant) => m.subscription_plan || m.merchant_tier || "starter";

  const maskEmail = (email: string) => {
    const [local, domain] = email.split("@");
    if (!domain) return email;
    return `${local.slice(0, 2)}***@${domain}`;
  };

  // Filter & sort
  let filtered = merchants.filter((m) =>
    m.business_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (planFilter !== "all") filtered = filtered.filter((m) => effectiveTier(m) === planFilter);
  if (statusFilter !== "all") filtered = filtered.filter((m) => m.verification_status === statusFilter);
  if (settlementFilter !== "all") {
    filtered = filtered.filter((m) => {
      if (settlementFilter === "none") return !m.payment_subaccount_code;
      if (settlementFilter === "active") return !!m.payment_subaccount_code && !m.subaccount_verified;
      if (settlementFilter === "verified") return !!m.payment_subaccount_code && m.subaccount_verified;
      return true;
    });
  }

  filtered.sort((a, b) => {
    if (sortBy === "newest") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (sortBy === "name") return a.business_name.localeCompare(b.business_name);
    if (sortBy === "plan") return effectiveTier(a).localeCompare(effectiveTier(b));
    if (sortBy === "collected") return (merchantStats[b.id]?.monthlyCollected || 0) - (merchantStats[a.id]?.monthlyCollected || 0);
    return 0;
  });

  const tierColor = (tier: string) => {
    switch (tier) {
      case "corporate": return "bg-indigo-50 text-indigo-700 border-indigo-200";
      case "individual": return "bg-purple-50 text-purple-700 border-purple-200";
      default: return "bg-neutral-50 text-neutral-600 border-neutral-200";
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "verified": return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "pending": return "bg-amber-50 text-amber-700 border-amber-200";
      case "rejected": return "bg-red-50 text-red-700 border-red-200";
      case "suspended": return "bg-red-100 text-red-800 border-red-300";
      case "incomplete": return "bg-amber-50 text-amber-600 border-amber-200";
      default: return "bg-neutral-50 text-neutral-600 border-neutral-200";
    }
  };

  const docDot = (status: string | undefined | null) => {
    if (status === "verified") return "bg-emerald-500";
    if (status === "pending") return "bg-amber-500";
    if (status === "rejected") return "bg-red-500";
    return "bg-neutral-300";
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-neutral-900">Merchant Directory</h1>
        <Card className="border shadow-none animate-pulse">
          <CardContent className="p-6"><div className="h-48 bg-neutral-100 rounded" /></CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">Merchant Directory</h1>
        <p className="text-neutral-500 text-sm mt-1">{merchants.length} registered merchants</p>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
          <Input
            placeholder="Search by name or email..."
            className="pl-10 border-2 bg-white"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={planFilter} onValueChange={(v) => v && setPlanFilter(v)}>
            <SelectTrigger className="w-[140px] border-2 bg-white text-sm"><SelectValue placeholder="Plan" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Plans</SelectItem>
              <SelectItem value="starter">Starter</SelectItem>
              <SelectItem value="individual">Individual</SelectItem>
              <SelectItem value="corporate">Corporate</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
            <SelectTrigger className="w-[160px] border-2 bg-white text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="unverified">Unverified</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="verified">Verified</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
            </SelectContent>
          </Select>
          <Select value={settlementFilter} onValueChange={(v) => v && setSettlementFilter(v)}>
            <SelectTrigger className="w-[160px] border-2 bg-white text-sm"><SelectValue placeholder="Settlement" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Settlement</SelectItem>
              <SelectItem value="none">No Account</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="verified">Verified</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(v) => v && setSortBy(v)}>
            <SelectTrigger className="w-[150px] border-2 bg-white text-sm"><SelectValue placeholder="Sort" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="name">Name A-Z</SelectItem>
              <SelectItem value="plan">By Plan</SelectItem>
              <SelectItem value="collected">Most Collected</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <Card className="border shadow-none">
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-neutral-50 border-b hover:bg-neutral-50">
                <TableHead className="font-bold text-neutral-900 text-xs uppercase">Business</TableHead>
                <TableHead className="font-bold text-neutral-900 text-xs uppercase">Plan</TableHead>
                <TableHead className="font-bold text-neutral-900 text-xs uppercase">Verification</TableHead>
                <TableHead className="font-bold text-neutral-900 text-xs uppercase">KYC</TableHead>
                <TableHead className="font-bold text-neutral-900 text-xs uppercase">Monthly Collected</TableHead>
                <TableHead className="font-bold text-neutral-900 text-xs uppercase">Sub Health</TableHead>
                <TableHead className="font-bold text-neutral-900 text-xs uppercase">Settlement</TableHead>
                <TableHead className="font-bold text-neutral-900 text-xs uppercase">Team</TableHead>
                <TableHead className="font-bold text-neutral-900 text-xs uppercase">Invoices</TableHead>
                <TableHead className="font-bold text-neutral-900 text-xs uppercase">Joined</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((m) => {
                const stats = merchantStats[m.id] || { teamCount: 0, recordInvoices: 0, collectionInvoices: 0, monthlyCollected: 0 };
                const tier = effectiveTier(m);
                const limit = Number(m.monthly_collection_limit);
                const collected = stats.monthlyCollected;
                const pct = limit > 0 ? Math.min(100, Math.round((collected / limit) * 100)) : (tier === "corporate" ? 0 : 0);
                const hasConfirmed = (m.platform_version ?? 0) >= 1;
                const ownerMissing = tier !== "starter" && !m.owner_name;
                const bizNameMissing = tier === "corporate" && (!m.business_name || !hasConfirmed);
                const effectiveStatus = (ownerMissing || bizNameMissing) ? "incomplete" : m.verification_status;
                
                let subHealth = { text: "Pending Payment", color: "text-neutral-500", bar: "bg-neutral-200", width: "0%" };
                if (m.email === "ralphdel14@yahoo.com") {
                  subHealth = { text: "Lifetime (SuperAdmin)", color: "text-purp-600", bar: "bg-purp-500", width: "100%" };
                } else if (tier === "starter") {
                  subHealth = { text: "Lifetime", color: "text-purp-600", bar: "bg-purp-500", width: "100%" };
                } else if (stats.subscriptionExpiry) {
                  const days = Math.ceil((new Date(stats.subscriptionExpiry).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
                  if (days < 0) subHealth = { text: "Expired", color: "text-red-600", bar: "bg-red-500", width: "100%" };
                  else if (days < 7) subHealth = { text: `${days} days left`, color: "text-red-600", bar: "bg-red-500", width: `${Math.max(5, (days/30)*100)}%` };
                  else if (days <= 14) subHealth = { text: `${days} days left`, color: "text-yellow-600", bar: "bg-yellow-500", width: `${Math.max(5, (days/30)*100)}%` };
                  else subHealth = { text: `${days} days left`, color: "text-emerald-600", bar: "bg-emerald-500", width: "100%" };
                }

                return (
                  <TableRow key={m.id} className="border-b hover:bg-neutral-50">
                    {/* Business */}
                    <TableCell>
                      <Link href={`/admin/merchants/${m.id}`} className="hover:underline">
                        <p className="font-medium text-sm text-purp-900">{m.trading_name || m.business_name}</p>
                      </Link>
                      <p className="text-xs text-neutral-500">{maskEmail(m.email)}</p>
                    </TableCell>

                    {/* Plan */}
                    <TableCell>
                      <Badge variant="outline" className={`text-xs capitalize border-2 ${tierColor(tier)}`}>
                        {tier}
                      </Badge>
                    </TableCell>

                    {/* Verification */}
                    <TableCell>
                      <Badge variant="outline" className={`text-xs capitalize border-2 ${statusColor(effectiveStatus)}`}>
                        {effectiveStatus}
                      </Badge>
                    </TableCell>

                    {/* KYC mini-badges */}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 text-[10px] text-neutral-500">
                          <span className={`w-2 h-2 rounded-full ${docDot(m.bvn_status)}`} /> BVN
                        </span>
                        <span className="flex items-center gap-1 text-[10px] text-neutral-500">
                          <span className={`w-2 h-2 rounded-full ${docDot(m.cac_status)}`} /> CAC
                        </span>
                        <span className="flex items-center gap-1 text-[10px] text-neutral-500">
                          <span className={`w-2 h-2 rounded-full ${docDot(m.utility_status)}`} /> Util
                        </span>
                      </div>
                    </TableCell>

                    {/* Monthly Collected */}
                    <TableCell>
                      <div className="space-y-1 min-w-[140px]">
                        <p className="text-xs text-neutral-700">
                          {formatNaira(collected)} / {limit > 0 ? formatNaira(limit) : "Unlimited"}
                        </p>
                        {limit > 0 && (
                          <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${pct > 80 ? "bg-red-500" : pct > 50 ? "bg-amber-500" : "bg-emerald-500"}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </TableCell>

                    {/* Sub Health */}
                    <TableCell>
                      <div className="flex flex-col gap-1 w-24">
                        <span className={`text-xs font-semibold ${subHealth.color}`}>{subHealth.text}</span>
                        <div className="w-full bg-neutral-100 rounded-full h-1.5 overflow-hidden border border-neutral-200">
                          <div className={`${subHealth.bar} h-1.5 rounded-full transition-all`} style={{ width: subHealth.width }} />
                        </div>
                      </div>
                    </TableCell>

                    {/* Settlement */}
                    <TableCell>
                      <Badge variant="outline" className={`text-xs border-2 ${
                        !m.payment_subaccount_code
                          ? "bg-neutral-50 text-neutral-500 border-neutral-200"
                          : m.subaccount_verified
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-amber-50 text-amber-700 border-amber-200"
                      }`}>
                        {!m.payment_subaccount_code ? "Not Set" : m.subaccount_verified ? "Verified" : "Active"}
                      </Badge>
                    </TableCell>

                    {/* Team */}
                    <TableCell className="text-sm text-neutral-600">{stats.teamCount}</TableCell>

                    {/* Invoices */}
                    <TableCell>
                      <span className="text-xs text-neutral-600">{stats.recordInvoices}R / {stats.collectionInvoices}C</span>
                    </TableCell>

                    {/* Joined */}
                    <TableCell className="text-sm text-neutral-500">
                      {new Date(m.created_at).toLocaleDateString("en-NG", {
                        day: "numeric", month: "short", year: "numeric",
                      })}
                    </TableCell>

                    {/* Actions */}
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger className="h-8 w-8 text-neutral-500 hover:text-purp-900 hover:bg-neutral-100 rounded-md inline-flex items-center justify-center transition-colors focus:outline-none">
                          <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem className="cursor-pointer" render={<Link href={`/admin/merchants/${m.id}`} />}>
                              <ExternalLink className="mr-2 h-4 w-4" /> View Detail
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {m.verification_status === "suspended" ? (
                            <DropdownMenuItem className="cursor-pointer text-emerald-600" onClick={() => setModal({ type: "reactivate", merchant: m })}>
                              <CheckCircle2 className="mr-2 h-4 w-4" /> Reactivate Access
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem className="cursor-pointer text-amber-600" onClick={() => setModal({ type: "deactivate", merchant: m })}>
                              <Ban className="mr-2 h-4 w-4" /> Suspend
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="cursor-pointer text-red-600" onClick={() => setModal({ type: "delete", merchant: m, confirmName: "", error: null })}>
                            <Trash2 className="mr-2 h-4 w-4" /> Delete Permanently
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8 text-neutral-500 text-sm">
                    No merchants found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Deactivate Modal */}
      <Dialog open={modal?.type === "deactivate"} onOpenChange={(open) => !open && setModal(null)}>
        <DialogContent className="border-2 border-amber-200">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center">
                <Ban className="h-5 w-5 text-amber-600" />
              </div>
              <DialogTitle className="text-amber-700">Suspend Merchant</DialogTitle>
            </div>
            <DialogDescription className="pt-3">
              Are you sure you want to suspend <strong>{modal?.type === "deactivate" ? modal.merchant.business_name : ""}</strong>? They will immediately lose access to their dashboard.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setModal(null)} disabled={processing} className="border-2">Cancel</Button>
            <Button onClick={handleConfirmDeactivate} disabled={processing} className="bg-amber-600 hover:bg-amber-700 text-white font-semibold">
              {processing ? "Suspending..." : "Suspend Merchant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reactivate Modal */}
      <Dialog open={modal?.type === "reactivate"} onOpenChange={(open) => !open && setModal(null)}>
        <DialogContent className="border-2 border-emerald-200">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <DialogTitle className="text-emerald-700">Reactivate Merchant</DialogTitle>
            </div>
            <DialogDescription className="pt-3">
              Reactivate <strong>{modal?.type === "reactivate" ? modal.merchant.business_name : ""}</strong>? They will immediately regain full access to their dashboard.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setModal(null)} disabled={processing} className="border-2">Cancel</Button>
            <Button onClick={handleConfirmReactivate} disabled={processing} className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
              {processing ? "Reactivating..." : "Reactivate Merchant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Modal */}
      <Dialog open={modal?.type === "delete"} onOpenChange={(open) => !open && setModal(null)}>
        <DialogContent className="border-2 border-red-200">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <DialogTitle className="text-red-600">Permanently Delete Merchant</DialogTitle>
            </div>
            <DialogDescription className="pt-3">
              This will permanently delete <strong>{modal?.type === "delete" ? modal.merchant.business_name : ""}</strong> and <strong>ALL their data</strong> — invoices, clients, team members, and payments. This action <strong>cannot be undone</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 space-y-2">
            <Label className="text-sm font-semibold text-neutral-700">
              Type the business name to confirm: <span className="text-red-600 font-mono">{modal?.type === "delete" ? modal.merchant.business_name : ""}</span>
            </Label>
            <Input
              value={modal?.type === "delete" ? modal.confirmName : ""}
              onChange={(e) => modal?.type === "delete" && setModal({ ...modal, confirmName: e.target.value, error: null })}
              placeholder="Type business name exactly..."
              className="border-2 border-red-200 focus:border-red-400"
            />
            {modal?.type === "delete" && modal.error && (
              <p className="text-sm text-red-600 font-medium">{modal.error}</p>
            )}
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setModal(null)} disabled={processing} className="border-2">Cancel</Button>
            <Button
              onClick={handleConfirmDelete}
              disabled={processing || (modal?.type === "delete" ? modal.confirmName !== modal.merchant.business_name : true)}
              className="bg-red-600 hover:bg-red-700 text-white font-semibold disabled:opacity-50"
            >
              {processing ? "Deleting..." : "Delete Permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
