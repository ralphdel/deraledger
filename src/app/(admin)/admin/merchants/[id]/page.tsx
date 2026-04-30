"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Shield, CheckCircle, XCircle, Clock, Users, FileText,
  DollarSign, Building2, Mail, Phone, Hash, Copy, Ban, CheckCircle2,
  KeyRound, RefreshCw, CreditCard,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { formatNaira } from "@/lib/calculations";
import type { Merchant, AuditLog } from "@/lib/types";
import {
  adminDeactivateMerchantAction, adminReactivateMerchantAction,
  adminChangePlanAction, adminResetPasswordAction,
} from "@/lib/actions";

export default function MerchantDetailPage() {
  const params = useParams();
  const router = useRouter();
  const merchantId = params.id as string;

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [invoiceStats, setInvoiceStats] = useState({ record: 0, collection: 0, totalInvoiced: 0, totalCollected: 0, outstanding: 0 });
  const [monthlyCollected, setMonthlyCollected] = useState(0);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  // Modal states
  const [showSuspend, setShowSuspend] = useState(false);
  const [showReactivate, setShowReactivate] = useState(false);
  const [showChangePlan, setShowChangePlan] = useState(false);
  const [newPlan, setNewPlan] = useState<"starter" | "individual" | "corporate">("individual");
  const [showResetLink, setShowResetLink] = useState<string | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    const sb = createClient();

    const [mRes, teamRes, invRes, txRes, auditRes] = await Promise.all([
      sb.from("merchants").select("*").eq("id", merchantId).single(),
      sb.from("merchant_team").select("*").eq("merchant_id", merchantId),
      sb.from("invoices").select("invoice_type, grand_total, amount_paid, outstanding_balance").eq("merchant_id", merchantId),
      sb.from("transactions").select("amount_paid, created_at").eq("merchant_id", merchantId).eq("status", "success"),
      sb.from("audit_logs").select("*").or(`target_id.eq.${merchantId},metadata->>actor_merchant_id.eq.${merchantId}`).order("created_at", { ascending: false }).limit(50),
    ]);

    setMerchant(mRes.data as Merchant | null);
    setTeamMembers(teamRes.data || []);
    setAuditLogs((auditRes.data || []) as AuditLog[]);

    // Invoice stats
    const invoices = invRes.data || [];
    let rCount = 0, cCount = 0, totalInv = 0, totalCol = 0, outst = 0;
    invoices.forEach((i: any) => {
      if (i.invoice_type === "record") rCount++; else cCount++;
      totalInv += Number(i.grand_total);
      totalCol += Number(i.amount_paid);
      outst += Number(i.outstanding_balance);
    });
    setInvoiceStats({ record: rCount, collection: cCount, totalInvoiced: totalInv, totalCollected: totalCol, outstanding: outst });

    // Monthly collected
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const mc = (txRes.data || []).filter((t: any) => t.created_at >= firstOfMonth).reduce((s: number, t: any) => s + Number(t.amount_paid), 0);
    setMonthlyCollected(mc);

    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [merchantId]);

  if (loading || !merchant) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => router.back()} className="gap-2"><ArrowLeft className="h-4 w-4" /> Back</Button>
        <Card className="border shadow-none animate-pulse"><CardContent className="p-6"><div className="h-48 bg-neutral-100 rounded" /></CardContent></Card>
      </div>
    );
  }

  const tier = merchant.subscription_plan || merchant.merchant_tier || "starter";
  const limit = Number(merchant.monthly_collection_limit);

  const tierColor = (t: string) => t === "corporate" ? "bg-indigo-50 text-indigo-700 border-indigo-200" : t === "individual" ? "bg-purple-50 text-purple-700 border-purple-200" : "bg-neutral-50 text-neutral-600 border-neutral-200";
  const statusColor = (s: string) => s === "verified" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : s === "pending" ? "bg-amber-50 text-amber-700 border-amber-200" : s === "rejected" ? "bg-red-50 text-red-700 border-red-200" : s === "suspended" ? "bg-red-100 text-red-800 border-red-300" : "bg-neutral-50 text-neutral-600 border-neutral-200";
  const docBadge = (s: string | null | undefined) => {
    const st = s || "unverified";
    const icon = st === "verified" ? <CheckCircle className="h-3.5 w-3.5" /> : st === "pending" ? <Clock className="h-3.5 w-3.5" /> : st === "rejected" ? <XCircle className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />;
    return <Badge variant="outline" className={`text-xs capitalize border-2 gap-1 ${statusColor(st)}`}>{icon} {st}</Badge>;
  };

  const handleSuspend = async () => { setProcessing(true); await adminDeactivateMerchantAction(merchantId); await fetchAll(); setShowSuspend(false); setProcessing(false); };
  const handleReactivate = async () => { setProcessing(true); await adminReactivateMerchantAction(merchantId); await fetchAll(); setShowReactivate(false); setProcessing(false); };
  const handleChangePlan = async () => { setProcessing(true); await adminChangePlanAction(merchantId, newPlan); await fetchAll(); setShowChangePlan(false); setProcessing(false); };
  const handleResetPassword = async () => {
    setProcessing(true);
    const res = await adminResetPasswordAction(merchantId);
    if (res.success && res.resetLink) setShowResetLink(res.resetLink);
    setProcessing(false);
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Back + Title */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push("/admin/merchants")} className="gap-1"><ArrowLeft className="h-4 w-4" /> Back</Button>
          <h1 className="text-2xl font-bold text-neutral-900">{merchant.business_name}</h1>
          <Badge variant="outline" className={`capitalize border-2 ${tierColor(tier)}`}>{tier}</Badge>
          <Badge variant="outline" className={`capitalize border-2 ${statusColor(merchant.verification_status)}`}>{merchant.verification_status}</Badge>
        </div>
      </div>

      {/* Admin Actions Bar */}
      <Card className="border shadow-none">
        <CardContent className="p-4 flex flex-wrap gap-2">
          {merchant.verification_status === "suspended" ? (
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1" onClick={() => setShowReactivate(true)}>
              <CheckCircle2 className="h-4 w-4" /> Reactivate
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="border-2 text-amber-700 border-amber-200 hover:bg-amber-50 gap-1" onClick={() => setShowSuspend(true)}>
              <Ban className="h-4 w-4" /> Suspend
            </Button>
          )}
          <Button size="sm" variant="outline" className="border-2 gap-1" onClick={() => { setNewPlan(tier === "starter" ? "individual" : tier === "individual" ? "corporate" : "individual"); setShowChangePlan(true); }}>
            <RefreshCw className="h-4 w-4" /> Change Plan
          </Button>
          <Button size="sm" variant="outline" className="border-2 gap-1" onClick={handleResetPassword} disabled={processing}>
            <KeyRound className="h-4 w-4" /> {processing ? "Generating..." : "Reset Password"}
          </Button>
        </CardContent>
      </Card>

      {/* Reset Link Display */}
      {showResetLink && (
        <Card className="border-2 border-emerald-200 shadow-none">
          <CardContent className="p-4">
            <p className="text-sm font-semibold text-emerald-800 mb-2">Password Reset Link Generated</p>
            <div className="flex items-center gap-2">
              <code className="text-xs bg-neutral-100 p-2 rounded flex-1 break-all">{showResetLink}</code>
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => { navigator.clipboard.writeText(showResetLink); }}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-neutral-500 mt-2">Send this link to the merchant. It expires in 1 hour.</p>
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Profile */}
        <Card className="border shadow-none">
          <CardHeader className="pb-3"><CardTitle className="text-base font-bold flex items-center gap-2"><Building2 className="h-4 w-4" /> Profile</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-neutral-500 text-xs">Email</p><p className="font-medium">{merchant.email}</p></div>
              <div><p className="text-neutral-500 text-xs">Phone</p><p className="font-medium">{merchant.phone || "—"}</p></div>
              <div><p className="text-neutral-500 text-xs">Workspace Code</p><p className="font-medium font-mono">{merchant.workspace_code || "—"}</p></div>
              <div><p className="text-neutral-500 text-xs">Joined</p><p className="font-medium">{new Date(merchant.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}</p></div>
              <div><p className="text-neutral-500 text-xs">Fee Absorption</p><p className="font-medium capitalize">{merchant.fee_absorption_default}</p></div>
              <div><p className="text-neutral-500 text-xs">Merchant ID</p><p className="font-medium font-mono text-xs">{merchant.id}</p></div>
            </div>
          </CardContent>
        </Card>

        {/* KYC Documents */}
        <Card className="border shadow-none">
          <CardHeader className="pb-3"><CardTitle className="text-base font-bold flex items-center gap-2"><Shield className="h-4 w-4" /> KYC Documents</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "BVN", value: merchant.bvn, status: merchant.bvn_status },
              { label: "CAC Number", value: merchant.cac_number, status: merchant.cac_status },
              { label: "CAC Document", value: merchant.cac_document_url ? "Uploaded" : null, status: merchant.cac_status },
              { label: "Utility Bill", value: merchant.utility_document_url ? "Uploaded" : null, status: merchant.utility_status },
            ].map((doc) => (
              <div key={doc.label} className="flex items-center justify-between bg-neutral-50 p-3 rounded-lg">
                <div>
                  <p className="text-xs text-neutral-500">{doc.label}</p>
                  <p className="text-sm font-medium">{doc.value || "Not submitted"}</p>
                </div>
                {docBadge(doc.status)}
              </div>
            ))}
            {merchant.kyc_submitted_at && (
              <p className="text-xs text-neutral-500">Submitted: {new Date(merchant.kyc_submitted_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}</p>
            )}
          </CardContent>
        </Card>

        {/* Settlement Account */}
        <Card className="border shadow-none">
          <CardHeader className="pb-3"><CardTitle className="text-base font-bold flex items-center gap-2"><CreditCard className="h-4 w-4" /> Settlement Account</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {merchant.payment_subaccount_code ? (
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-neutral-500 text-xs">Bank</p><p className="font-medium">{merchant.settlement_bank_name || "—"}</p></div>
                <div><p className="text-neutral-500 text-xs">Account</p><p className="font-medium">{merchant.settlement_account_number ? `****${merchant.settlement_account_number.slice(-4)}` : "—"}</p></div>
                <div><p className="text-neutral-500 text-xs">Account Name</p><p className="font-medium">{merchant.settlement_account_name || "—"}</p></div>
                <div><p className="text-neutral-500 text-xs">Subaccount</p><p className="font-medium font-mono text-xs">{merchant.payment_subaccount_code}</p></div>
                <div><p className="text-neutral-500 text-xs">Verified</p><p className="font-medium">{merchant.subaccount_verified ? "Yes ✓" : "No"}</p></div>
                {merchant.settlement_activated_at && (
                  <div><p className="text-neutral-500 text-xs">Activated</p><p className="font-medium">{new Date(merchant.settlement_activated_at).toLocaleDateString("en-NG")}</p></div>
                )}
              </div>
            ) : (
              <div className="text-center py-6 text-neutral-500"><CreditCard className="h-8 w-8 mx-auto mb-2 text-neutral-300" /><p className="text-sm">No settlement account configured</p></div>
            )}
          </CardContent>
        </Card>

        {/* Invoice Summary */}
        <Card className="border shadow-none">
          <CardHeader className="pb-3"><CardTitle className="text-base font-bold flex items-center gap-2"><FileText className="h-4 w-4" /> Invoices</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-neutral-50 p-3 rounded-lg"><p className="text-xs text-neutral-500">Record Invoices</p><p className="text-xl font-bold text-neutral-900">{invoiceStats.record}</p></div>
              <div className="bg-neutral-50 p-3 rounded-lg"><p className="text-xs text-neutral-500">Collection Invoices</p><p className="text-xl font-bold text-neutral-900">{invoiceStats.collection}</p></div>
              <div className="bg-neutral-50 p-3 rounded-lg"><p className="text-xs text-neutral-500">Total Invoiced</p><p className="text-lg font-bold text-neutral-900">{formatNaira(invoiceStats.totalInvoiced)}</p></div>
              <div className="bg-neutral-50 p-3 rounded-lg"><p className="text-xs text-neutral-500">Total Collected</p><p className="text-lg font-bold text-emerald-700">{formatNaira(invoiceStats.totalCollected)}</p></div>
            </div>
            <div className="bg-red-50 p-3 rounded-lg border border-red-100">
              <p className="text-xs text-red-500">Outstanding Balance</p>
              <p className="text-lg font-bold text-red-700">{formatNaira(invoiceStats.outstanding)}</p>
            </div>
          </CardContent>
        </Card>

        {/* Monthly Collection */}
        <Card className="border shadow-none">
          <CardHeader className="pb-3"><CardTitle className="text-base font-bold flex items-center gap-2"><DollarSign className="h-4 w-4" /> Monthly Collection</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-neutral-900">{formatNaira(monthlyCollected)}</p>
            <p className="text-sm text-neutral-500">of {limit > 0 ? formatNaira(limit) : "Unlimited"} limit</p>
            {limit > 0 && (
              <div className="mt-3 h-2 bg-neutral-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${(monthlyCollected / limit) > 0.8 ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, (monthlyCollected / limit) * 100)}%` }} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Team Members */}
        <Card className="border shadow-none">
          <CardHeader className="pb-3"><CardTitle className="text-base font-bold flex items-center gap-2"><Users className="h-4 w-4" /> Team ({teamMembers.length})</CardTitle></CardHeader>
          <CardContent>
            {teamMembers.length === 0 ? (
              <p className="text-sm text-neutral-500 text-center py-4">No team members</p>
            ) : (
              <div className="space-y-2">
                {teamMembers.map((tm: any) => (
                  <div key={tm.id} className="flex items-center justify-between bg-neutral-50 p-3 rounded-lg text-sm">
                    <div>
                      <p className="font-medium">{tm.user_id?.slice(0, 8)}...</p>
                      <p className="text-xs text-neutral-500">Role: {tm.role || "member"}</p>
                    </div>
                    <Badge variant="outline" className={`text-xs border-2 ${tm.is_active ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-neutral-50 text-neutral-500 border-neutral-200"}`}>
                      {tm.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Audit Log */}
      <Card className="border shadow-none">
        <CardHeader className="pb-3"><CardTitle className="text-base font-bold">Audit Log (Last 50)</CardTitle></CardHeader>
        <CardContent>
          {auditLogs.length === 0 ? (
            <p className="text-sm text-neutral-500 text-center py-4">No audit events for this merchant</p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {auditLogs.map((log) => (
                <div key={log.id} className="flex items-start justify-between p-3 bg-neutral-50 rounded-lg text-sm border border-neutral-100">
                  <div>
                    <p className="font-medium text-neutral-900">{log.event_type.replace(/_/g, " ")}</p>
                    <p className="text-xs text-neutral-500">{(log.metadata as any)?.actor_name || log.actor_role} · {log.target_type}</p>
                  </div>
                  <p className="text-xs text-neutral-400 shrink-0">{new Date(log.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Suspend Dialog */}
      <Dialog open={showSuspend} onOpenChange={setShowSuspend}>
        <DialogContent className="border-2 border-amber-200">
          <DialogHeader>
            <DialogTitle className="text-amber-700">Suspend {merchant.business_name}?</DialogTitle>
            <DialogDescription>They will immediately lose dashboard access.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSuspend(false)} disabled={processing}>Cancel</Button>
            <Button onClick={handleSuspend} disabled={processing} className="bg-amber-600 hover:bg-amber-700 text-white">{processing ? "Suspending..." : "Suspend"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reactivate Dialog */}
      <Dialog open={showReactivate} onOpenChange={setShowReactivate}>
        <DialogContent className="border-2 border-emerald-200">
          <DialogHeader>
            <DialogTitle className="text-emerald-700">Reactivate {merchant.business_name}?</DialogTitle>
            <DialogDescription>They will regain full dashboard access.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReactivate(false)} disabled={processing}>Cancel</Button>
            <Button onClick={handleReactivate} disabled={processing} className="bg-emerald-600 hover:bg-emerald-700 text-white">{processing ? "Reactivating..." : "Reactivate"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Plan Dialog */}
      <Dialog open={showChangePlan} onOpenChange={setShowChangePlan}>
        <DialogContent className="border-2 border-purp-200">
          <DialogHeader>
            <DialogTitle>Change Plan for {merchant.business_name}</DialogTitle>
            <DialogDescription>Current plan: <span className="font-semibold capitalize">{tier}</span></DialogDescription>
          </DialogHeader>
          <Select value={newPlan} onValueChange={(v) => setNewPlan(v as any)}>
            <SelectTrigger className="border-2"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="starter">Starter (Free)</SelectItem>
              <SelectItem value="individual">Individual (₦5,000/mo)</SelectItem>
              <SelectItem value="corporate">Corporate (₦20,000/mo)</SelectItem>
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowChangePlan(false)} disabled={processing}>Cancel</Button>
            <Button onClick={handleChangePlan} disabled={processing} className="bg-purp-900 hover:bg-purp-800 text-white">{processing ? "Updating..." : "Change Plan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
