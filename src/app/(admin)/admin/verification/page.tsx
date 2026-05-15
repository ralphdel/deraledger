"use client";

import { useEffect, useState } from "react";
import {
  ShieldCheck, ShieldAlert, ShieldX, Clock, CheckCircle, XCircle,
  Search, Eye, RotateCcw, UploadCloud, ExternalLink,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createClient } from "@/lib/supabase/client";

import {
  adminUpdateKycDocumentStatusAction,
  adminApproveVerificationAction,
  adminRejectVerificationAction,
  adminResetVerificationAction,
  adminRequestReuploadAction,
} from "@/lib/actions";
import type { Merchant } from "@/lib/types";

type ActionMode = "idle" | "reject" | "reupload";

export default function VerificationQueuePage() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMerchant, setSelectedMerchant] = useState<Merchant | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [actionReason, setActionReason] = useState("");
  const [actionMode, setActionMode] = useState<ActionMode>("idle");
  const [actionLoading, setActionLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  useEffect(() => {
    loadMerchants();
  }, []);

  const loadMerchants = () => {
    const sb = createClient();
    sb.from("merchants")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setMerchants((data || []) as Merchant[]);
        setLoading(false);
      });
  };

  const refreshMerchant = (updates: Partial<Merchant>) => {
    if (!selectedMerchant) return;
    const updated = { ...selectedMerchant, ...updates } as Merchant;
    setSelectedMerchant(updated);
    setMerchants(prev => prev.map(m => m.id === updated.id ? updated : m));
  };

  const getEffectiveStatus = (m: Merchant) => {
    const tier = m.subscription_plan || m.merchant_tier || "starter";
    const hasConfirmed = (m.platform_version ?? 0) >= 1;
    if (tier !== "starter" && !m.owner_name) return "incomplete";
    if (tier === "corporate" && (!m.business_name || !hasConfirmed)) return "incomplete";
    if (tier !== "starter" && m.bvn_status === "verified" && (m.selfie_status || "unverified") !== "verified") return "pending";
    return m.verification_status;
  };

  const getFilteredMerchants = (status: string) =>
    merchants
      .filter(m => status === "all" ? true : getEffectiveStatus(m) === status)
      .filter(m =>
        (m.trading_name || m.business_name).toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.email.toLowerCase().includes(searchQuery.toLowerCase())
      );

  const statusIcon = (status: string) => {
    switch (status) {
      case "verified": return <CheckCircle className="h-4 w-4 text-emerald-600" />;
      case "pending_admin_review": return <ShieldCheck className="h-4 w-4 text-blue-600" />;
      case "pending": return <Clock className="h-4 w-4 text-amber-600" />;
      case "requires_reupload": return <UploadCloud className="h-4 w-4 text-orange-500" />;
      case "rejected": return <XCircle className="h-4 w-4 text-red-600" />;
      case "suspended": case "restricted": return <ShieldX className="h-4 w-4 text-red-600" />;
      case "incomplete": return <ShieldAlert className="h-4 w-4 text-amber-500" />;
      default: return <ShieldAlert className="h-4 w-4 text-neutral-400" />;
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "verified": return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "pending_admin_review": return "bg-blue-50 text-blue-700 border-blue-200";
      case "pending": return "bg-amber-50 text-amber-700 border-amber-200";
      case "requires_reupload": return "bg-orange-50 text-orange-700 border-orange-200";
      case "rejected": return "bg-red-50 text-red-700 border-red-200";
      case "suspended": case "restricted": return "bg-red-50 text-red-700 border-red-200";
      case "incomplete": return "bg-amber-50 text-amber-600 border-amber-200";
      default: return "bg-neutral-50 text-neutral-600 border-neutral-200";
    }
  };

  const updateItemStatus = async (merchant: Merchant, field: "cac_status" | "bvn_status" | "utility_status" | "selfie_status", status: "verified" | "rejected") => {
    const { success, error, updates } = await adminUpdateKycDocumentStatusAction(merchant.id, field, status, reviewNotes || undefined);
    if (success) refreshMerchant(updates || {});
    else setReviewError("Failed to update: " + error);
    setReviewNotes("");
  };

  const handleApprove = async () => {
    if (!selectedMerchant) return;
    setActionLoading(true); setReviewError(null);
    const res = await adminApproveVerificationAction(selectedMerchant.id);
    if (res.success) {
      refreshMerchant({ verification_status: "verified" });
      setActionSuccess("Merchant approved and marked as verified.");
      setActionMode("idle");
    } else setReviewError(res.error || "Approval failed.");
    setActionLoading(false);
  };

  const handleReject = async () => {
    if (!selectedMerchant || !actionReason.trim()) return;
    setActionLoading(true); setReviewError(null);
    const res = await adminRejectVerificationAction(selectedMerchant.id, actionReason.trim());
    if (res.success) {
      refreshMerchant({ verification_status: "rejected", kyc_rejection_reason: actionReason.trim() });
      setActionSuccess("Verification rejected. Reason stored in audit log.");
      setActionMode("idle"); setActionReason("");
    } else setReviewError(res.error || "Rejection failed.");
    setActionLoading(false);
  };

  const handleReset = async () => {
    if (!selectedMerchant) return;
    setActionLoading(true); setReviewError(null);
    const res = await adminResetVerificationAction(selectedMerchant.id);
    if (res.success) {
      refreshMerchant({ verification_status: "unverified", cac_status: "unverified", bvn_status: "unverified", utility_status: "unverified", selfie_status: "unverified" });
      setActionSuccess("Verification reset. Merchant must re-upload all documents.");
      setActionMode("idle");
    } else setReviewError(res.error || "Reset failed.");
    setActionLoading(false);
  };

  const handleReupload = async () => {
    if (!selectedMerchant || !actionReason.trim()) return;
    setActionLoading(true); setReviewError(null);
    const res = await adminRequestReuploadAction(selectedMerchant.id, actionReason.trim());
    if (res.success) {
      refreshMerchant({ verification_status: "requires_reupload" });
      setActionSuccess("Reupload request sent. Merchant notified.");
      setActionMode("idle"); setActionReason("");
    } else setReviewError(res.error || "Request failed.");
    setActionLoading(false);
  };

  const openReview = (m: Merchant) => {
    setSelectedMerchant(m);
    setReviewNotes(""); setActionReason(""); setActionMode("idle");
    setReviewError(null); setActionSuccess(null);
  };

  const pendingCount = merchants.filter(m => m.verification_status === "pending").length;
  const adminReviewCount = merchants.filter(m => m.verification_status === "pending_admin_review").length;
  const incompleteCount = merchants.filter(m => getEffectiveStatus(m) === "incomplete").length;
  const reuploadCount = merchants.filter(m => m.verification_status === "requires_reupload").length;

  if (loading) return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-neutral-900">Verification Queue</h1>
      <Card className="border shadow-none animate-pulse"><CardContent className="p-6"><div className="h-48 bg-neutral-100 rounded" /></CardContent></Card>
    </div>
  );

  const MerchantList = ({ data }: { data: Merchant[] }) => (
    <div className="divide-y divide-neutral-100">
      {data.map(m => {
        const status = getEffectiveStatus(m);
        return (
          <div key={m.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 hover:bg-neutral-50 transition-colors">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-9 h-9 rounded-full bg-purp-100 flex items-center justify-center text-purp-700 font-bold text-sm flex-shrink-0">
                {(m.trading_name || m.business_name || "?").charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-neutral-900 text-sm truncate">{m.trading_name || m.business_name}</p>
                <p className="text-xs text-neutral-500 truncate">{m.email}</p>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  <Badge variant="outline" className="text-[10px] capitalize border bg-purple-50 text-purple-700 border-purple-200 px-1.5">
                    {m.subscription_plan || m.merchant_tier}
                  </Badge>
                  <Badge variant="outline" className={`text-[10px] capitalize border flex items-center gap-1 px-1.5 ${statusColor(status)}`}>
                    {statusIcon(status)}
                    <span>{status.replace(/_/g, " ")}</span>
                  </Badge>
                  {m.kyc_submitted_at && (
                    <span className="text-[10px] text-neutral-400">
                      {new Date(m.kyc_submitted_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex-shrink-0 self-start sm:self-center">
              <Dialog>
                <DialogTrigger render={
                  <Button variant="outline" size="sm" className="border-2 h-8" onClick={() => openReview(m)}>
                    <Eye className="mr-1.5 h-3.5 w-3.5" /> Review
                  </Button>
                } />
                <DialogContent className="w-[95vw] max-w-2xl max-h-[92vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="text-neutral-900 text-base">
                      {m.trading_name || m.business_name}
                    </DialogTitle>
                    <DialogDescription>KYC Review — take action below.</DialogDescription>
                  </DialogHeader>

                  {selectedMerchant && (
                    <div className="space-y-4 py-1">
                      {selectedMerchant.kyc_rejection_reason && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
                          <p className="text-xs text-red-500 font-semibold mb-1">Previous Rejection / Reupload Reason</p>
                          <p className="text-red-800">{selectedMerchant.kyc_rejection_reason}</p>
                        </div>
                      )}

                      {/* Status + Plan row */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Badge variant="outline" className={`text-xs capitalize border-2 flex items-center gap-1.5 px-2 py-1 ${statusColor(getEffectiveStatus(selectedMerchant))}`}>
                          {statusIcon(getEffectiveStatus(selectedMerchant))}
                          <span>{getEffectiveStatus(selectedMerchant).replace(/_/g, " ")}</span>
                        </Badge>
                        <span className="text-xs text-neutral-400 capitalize">{selectedMerchant.subscription_plan || selectedMerchant.merchant_tier} plan</span>
                      </div>

                      {/* Merchant info grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-neutral-50 rounded-xl p-3 text-sm">
                        <div><p className="text-neutral-400 text-xs mb-0.5">Email</p><p className="font-medium truncate">{selectedMerchant.email}</p></div>
                        <div><p className="text-neutral-400 text-xs mb-0.5">Phone</p><p className="font-medium">{selectedMerchant.phone || "—"}</p></div>
                        <div className="sm:col-span-2">
                          <p className="text-neutral-400 text-xs mb-0.5">Owner / Director (BVN match)</p>
                          <p className={`font-semibold ${selectedMerchant.owner_name ? "text-neutral-900" : "text-red-600"}`}>
                            {selectedMerchant.owner_name || "⚠ Not provided"}
                          </p>
                        </div>
                      </div>

                      {/* Dojah block */}
                      <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div>
                            <p className="font-semibold text-blue-900 text-sm">Dojah BVN + Selfie Check</p>
                            <p className="text-xs text-blue-600 mt-0.5">Ref: {selectedMerchant.dojah_reference || "Not submitted"}</p>
                          </div>
                          <Badge variant="outline" className="border-blue-200 bg-white text-blue-700 font-bold">
                            Score: {selectedMerchant.dojah_match_score ?? "N/A"}%
                          </Badge>
                        </div>
                      </div>

                      {/* Documents */}
                      <div className="space-y-2">
                        <h4 className="font-semibold text-sm text-neutral-900">Documents</h4>
                        <div className="space-y-2">
                          {([
                            { label: "CAC Number", value: selectedMerchant.cac_number, field: "cac_status" as const, statusVal: selectedMerchant.cac_status },
                            { label: "BVN", value: selectedMerchant.bvn, field: "bvn_status" as const, statusVal: selectedMerchant.bvn_status },
                            { label: "Selfie", value: selectedMerchant.selfie_url ? "Submitted" : null, field: "selfie_status" as const, statusVal: selectedMerchant.selfie_status },
                            { label: "CAC Document", value: selectedMerchant.cac_document_url, field: "cac_status" as const, isDoc: true, statusVal: selectedMerchant.cac_status },
                            { label: "Utility Bill", value: selectedMerchant.utility_document_url, field: "utility_status" as const, isDoc: true, statusVal: selectedMerchant.utility_status },
                          ]).map(({ label, value, field, isDoc, statusVal }) => (
                            <div key={label} className="flex flex-wrap items-center justify-between gap-2 bg-neutral-50 border border-neutral-100 rounded-lg px-3 py-2">
                              <div className="min-w-0">
                                <p className="text-xs text-neutral-500">{label}</p>
                                {isDoc && value ? (
                                  <a href={value as string} target="_blank" rel="noreferrer" className="text-purp-600 hover:underline text-sm flex items-center gap-1">
                                    View Document <ExternalLink className="h-3 w-3" />
                                  </a>
                                ) : (
                                  <p className="font-medium text-sm truncate max-w-[180px]">{value as string || "—"}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <Badge variant="outline" className={`text-xs capitalize border ${statusColor(statusVal || "unverified")}`}>
                                  {statusVal || "unverified"}
                                </Badge>
                                {statusVal === "pending" && (
                                  <div className="flex gap-1">
                                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-emerald-600 hover:bg-emerald-50" onClick={() => updateItemStatus(selectedMerchant, field, "verified")}><CheckCircle className="h-4 w-4" /></Button>
                                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-600 hover:bg-red-50" onClick={() => updateItemStatus(selectedMerchant, field, "rejected")}><XCircle className="h-4 w-4" /></Button>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Review notes */}
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium">Review Notes (optional)</Label>
                        <Textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} placeholder="Add notes about this document review..." className="min-h-[56px] text-sm" />
                      </div>

                      {/* Reason input */}
                      {(actionMode === "reject" || actionMode === "reupload") && (
                        <div className="space-y-2 bg-red-50 border border-red-200 rounded-xl p-3">
                          <Label className="text-sm font-semibold text-red-800">
                            {actionMode === "reject" ? "Rejection Reason (required)" : "Documents needed (required)"}
                          </Label>
                          <Textarea
                            value={actionReason}
                            onChange={e => setActionReason(e.target.value)}
                            placeholder={actionMode === "reject" ? "Explain why verification is being rejected..." : "Specify which documents need to be re-uploaded..."}
                            className="min-h-[80px] border-red-300 bg-white text-sm"
                          />
                          {actionMode === "reject" && actionReason.trim().length > 0 && actionReason.trim().length < 10 && (
                            <p className="text-xs text-red-600">Reason must be at least 10 characters.</p>
                          )}
                        </div>
                      )}

                      {reviewError && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-medium border border-red-100">{reviewError}</div>}
                      {actionSuccess && <div className="bg-emerald-50 text-emerald-700 p-3 rounded-lg text-sm font-medium border border-emerald-100">{actionSuccess}</div>}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="border-t pt-4 mt-2">
                    {actionMode === "idle" ? (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-9" disabled={actionLoading || selectedMerchant?.verification_status === "verified"} onClick={handleApprove}>
                          <CheckCircle className="h-3.5 w-3.5 mr-1" />{actionLoading ? "..." : "Approve"}
                        </Button>
                        <Button variant="destructive" className="text-xs h-9" disabled={actionLoading || selectedMerchant?.verification_status === "rejected"} onClick={() => { setActionMode("reject"); setActionReason(""); }}>
                          <XCircle className="h-3.5 w-3.5 mr-1" />Reject
                        </Button>
                        <Button variant="outline" className="border-orange-300 text-orange-700 hover:bg-orange-50 text-xs h-9" disabled={actionLoading} onClick={() => { setActionMode("reupload"); setActionReason(""); }}>
                          <UploadCloud className="h-3.5 w-3.5 mr-1" />Reupload
                        </Button>
                        <Button variant="outline" className="border-neutral-300 text-xs h-9" disabled={actionLoading} onClick={handleReset}>
                          <RotateCcw className="h-3.5 w-3.5 mr-1" />Reset
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-2 flex-wrap">
                        <Button variant="outline" className="text-xs h-9" onClick={() => { setActionMode("idle"); setActionReason(""); }}>Cancel</Button>
                        {actionMode === "reject" && (
                          <Button variant="destructive" className="text-xs h-9" disabled={actionLoading || actionReason.trim().length < 10} onClick={handleReject}>
                            {actionLoading ? "Rejecting..." : "Confirm Reject"}
                          </Button>
                        )}
                        {actionMode === "reupload" && (
                          <Button className="bg-orange-600 hover:bg-orange-700 text-white text-xs h-9" disabled={actionLoading || actionReason.trim().length < 5} onClick={handleReupload}>
                            {actionLoading ? "Sending..." : "Request Reupload"}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        );
      })}
      {data.length === 0 && (
        <div className="py-12 text-center text-sm text-neutral-400">No merchants found.</div>
      )}
    </div>
  );


  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">Verification Queue</h1>
        <p className="text-neutral-500 text-sm mt-1">
          {adminReviewCount > 0 ? `${adminReviewCount} awaiting admin review` : ""}
          {pendingCount > 0 ? ` · ${pendingCount} pending` : ""}
          {incompleteCount > 0 ? ` · ${incompleteCount} incomplete` : ""}
          {reuploadCount > 0 ? ` · ${reuploadCount} reupload requested` : ""}
          {adminReviewCount === 0 && pendingCount === 0 && incompleteCount === 0 && reuploadCount === 0 ? "All merchants have been reviewed." : ""}
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
        <Input placeholder="Search merchants..." className="pl-10 border-2 bg-white" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
      </div>

      <Tabs defaultValue="pending_admin_review" className="space-y-4">
        <TabsList className="bg-neutral-100 flex-wrap h-auto gap-1">
          <TabsTrigger value="pending_admin_review" className="data-[state=active]:bg-blue-100 data-[state=active]:text-blue-800">
            Admin Review {adminReviewCount > 0 && <Badge className="ml-1.5 bg-blue-500 text-white text-[10px] px-1.5">{adminReviewCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="pending" className="data-[state=active]:bg-amber-100 data-[state=active]:text-amber-800">
            Pending {pendingCount > 0 && <Badge className="ml-1.5 bg-amber-500 text-white text-[10px] px-1.5">{pendingCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="requires_reupload" className="data-[state=active]:bg-orange-100 data-[state=active]:text-orange-700">
            Reupload {reuploadCount > 0 && <Badge className="ml-1.5 bg-orange-500 text-white text-[10px] px-1.5">{reuploadCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="incomplete" className="data-[state=active]:bg-amber-100 data-[state=active]:text-amber-700">
            Incomplete {incompleteCount > 0 && <Badge className="ml-1.5 bg-amber-400 text-white text-[10px] px-1.5">{incompleteCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="verified" className="data-[state=active]:bg-emerald-100 data-[state=active]:text-emerald-800">Verified</TabsTrigger>
          <TabsTrigger value="rejected" className="data-[state=active]:bg-red-100 data-[state=active]:text-red-800">Rejected</TabsTrigger>
          <TabsTrigger value="all" className="data-[state=active]:bg-neutral-200">All</TabsTrigger>
        </TabsList>

        {["pending_admin_review","pending","requires_reupload","incomplete","verified","rejected","all"].map(tab => (
          <TabsContent key={tab} value={tab}>
            <Card className="border shadow-none"><CardContent className="p-0"><MerchantList data={getFilteredMerchants(tab)} /></CardContent></Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
