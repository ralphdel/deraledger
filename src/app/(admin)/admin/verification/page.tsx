/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState } from "react";
import {
  ShieldCheck, ShieldAlert, ShieldX, Clock, CheckCircle, XCircle,
  Search, Eye, RotateCcw, UploadCloud, ExternalLink, ChevronDown, ChevronUp, User, Info, Loader
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
  adminGetKycDocumentUrlAction,
} from "@/lib/actions";
import type { Merchant } from "@/lib/types";

type ActionMode = "idle" | "reject" | "reupload" | "reset";
type ReuploadField = "cac_status" | "bvn_status" | "utility_status" | "selfie_status";
type DirectorVerificationRow = {
  id: string;
  director_name?: string | null;
  director_role?: string | null;
  masked_bvn?: string | null;
  provider_name?: string | null;
  selfie_url?: string | null;
  verification_status?: string | null;
  face_match_score?: number | null;
  liveness_score?: number | null;
  admin_notes?: string | null;
  verification_log_id?: string | null;
  verification_id?: string | null;
  invitation_id?: string | null;
  normalized_response?: Record<string, unknown> | null;
  manual_review_required?: boolean | null;
  created_at?: string | null;
};
type RegistrySnapshotRow = {
  id: string;
  provider_name?: string | null;
  registered_name?: string | null;
  registration_number?: string | null;
  directors_json?: { name?: string; role?: string }[] | null;
  raw_response_encrypted?: Record<string, unknown> | null;
};
type BusinessAffiliationRow = {
  id: string;
  status?: string | null;
  match_reason?: string | null;
  matched_registry_name?: string | null;
};
type DirectorInvitationRow = {
  id: string;
  selected_director_name?: string | null;
  director_email?: string | null;
  status?: string | null;
  registry_snapshot_id?: string | null;
};
type VerificationCostRow = {
  id: string;
  cost_amount?: number | string | null;
};

export default function VerificationQueuePage() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMerchant, setSelectedMerchant] = useState<Merchant | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [actionReason, setActionReason] = useState("");
  const [reuploadFields, setReuploadFields] = useState<ReuploadField[]>([]);
  const [actionMode, setActionMode] = useState<ActionMode>("idle");
  const [actionLoading, setActionLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const [directors, setDirectors] = useState<DirectorVerificationRow[]>([]);
  const [directorsLoading, setDirectorsLoading] = useState(false);
  const [directorsExpanded, setDirectorsExpanded] = useState(true);
  const [directorNotes, setDirectorNotes] = useState<Record<string, string>>({});
  const [registrySnapshot, setRegistrySnapshot] = useState<RegistrySnapshotRow | null>(null);
  const [businessAffiliations, setBusinessAffiliations] = useState<BusinessAffiliationRow[]>([]);
  const [directorInvitations, setDirectorInvitations] = useState<DirectorInvitationRow[]>([]);
  const [verificationCosts, setVerificationCosts] = useState<VerificationCostRow[]>([]);

  function loadMerchants() {
    const sb = createClient();
    sb.from("merchants")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setMerchants((data || []) as Merchant[]);
        setLoading(false);
      });
  }

  useEffect(() => {
    loadMerchants();
  }, []);

  const refreshMerchant = (updates: Partial<Merchant>) => {
    if (!selectedMerchant) return;
    const updated = { ...selectedMerchant, ...updates } as Merchant;
    setSelectedMerchant(updated);
    setMerchants(prev => prev.map(m => m.id === updated.id ? updated : m));
  };

  const getEffectiveStatus = (m: Merchant | null): string => {
    if (!m) return "unverified";
    const tier = m.subscription_plan || m.merchant_tier || "starter";
    const hasConfirmed = (m.platform_version ?? 0) >= 1;
    if (tier !== "starter" && !m.owner_name) return "incomplete";
    if (tier === "corporate" && (!m.business_name || !hasConfirmed)) return "incomplete";
    if (tier !== "starter" && (!m.business_street || !m.business_city || !m.business_state || !m.business_country || !m.phone)) return "incomplete";
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

  /** Maps internal plan keys to user-facing labels. "corporate" → "Business". */
  const formatPlanLabel = (plan: string | null | undefined): string => {
    if (!plan) return "Starter";
    if (plan === "corporate") return "Business";
    return plan.charAt(0).toUpperCase() + plan.slice(1);
  };

  const updateItemStatus = async (merchant: Merchant, field: "cac_status" | "bvn_status" | "utility_status" | "selfie_status", status: "verified" | "rejected") => {
    const { success, error, updates } = await adminUpdateKycDocumentStatusAction(merchant.id, field, status, reviewNotes || undefined);
    if (success) refreshMerchant(updates || {});
    else setReviewError("Failed to update: " + error);
    setReviewNotes("");
  };

  const reuploadOptions: Array<{ field: ReuploadField; label: string; description: string }> = [
    { field: "bvn_status", label: "BVN", description: "Identity number or BVN name needs correction." },
    { field: "selfie_status", label: "Selfie", description: "Face image is unclear or failed matching." },
    { field: "cac_status", label: "CAC / RC", description: "Business registry document or lookup needs correction." },
    { field: "utility_status", label: "Address proof", description: "Utility bill or business address evidence needs correction." },
  ];

  const toggleReuploadField = (field: ReuploadField) => {
    setReuploadFields((prev) =>
      prev.includes(field) ? prev.filter((item) => item !== field) : [...prev, field]
    );
  };

  const handleApprove = async () => {
    if (!selectedMerchant) return;
    setActionLoading(true); setReviewError(null);
    const res = await adminApproveVerificationAction(selectedMerchant.id);
    if (res.success) {
      refreshMerchant((res.updates || { verification_status: "verified" }) as Partial<Merchant>);
      setActionSuccess(res.message || "Merchant approved.");
      setActionMode("idle");
    } else setReviewError(res.error || "Approval failed.");
    setActionLoading(false);
  };

  const handleReject = async () => {
    if (!selectedMerchant || !actionReason.trim()) return;
    setActionLoading(true); setReviewError(null);
    const res = await adminRejectVerificationAction(selectedMerchant.id, actionReason.trim());
    if (res.success) {
      refreshMerchant((res.updates || { verification_status: "rejected", kyc_rejection_reason: actionReason.trim() }) as Partial<Merchant>);
      setActionSuccess(res.message || "Verification rejected. Live payment features remain disabled.");
      setActionMode("idle"); setActionReason("");
    } else setReviewError(res.error || "Rejection failed.");
    setActionLoading(false);
  };

  const handleReset = async () => {
    if (!selectedMerchant) return;
    setActionLoading(true); setReviewError(null);
    const res = await adminResetVerificationAction(selectedMerchant.id);
    if (res.success) {
      refreshMerchant((res.updates || { verification_status: "unverified", cac_status: "unverified", bvn_status: "unverified", utility_status: "unverified", selfie_status: "unverified" }) as Partial<Merchant>);
      setDirectors([]);
      setRegistrySnapshot(null);
      setBusinessAffiliations([]);
      setDirectorInvitations([]);
      setVerificationCosts([]);
      setDirectorNotes({});
      setActionSuccess(res.message || "Verification reset. Merchant must restart verification.");
      setActionMode("idle");
      loadMerchants();
    } else setReviewError(res.error || "Reset failed.");
    setActionLoading(false);
  };

  const handleReupload = async () => {
    if (!selectedMerchant || !actionReason.trim()) return;
    setActionLoading(true); setReviewError(null);
    const res = await adminRequestReuploadAction(selectedMerchant.id, actionReason.trim(), reuploadFields);
    if (res.success) {
      refreshMerchant((res.updates || { verification_status: "requires_reupload" }) as Partial<Merchant>);
      setActionSuccess(res.message || "Reupload request saved. Live payment features remain disabled.");
      setActionMode("idle"); setActionReason(""); setReuploadFields([]);
    } else setReviewError(res.error || "Request failed.");
    setActionLoading(false);
  };

  const openReview = (m: Merchant) => {
    setSelectedMerchant(m);
    setReviewNotes(""); setActionReason(""); setActionMode("idle");
    setReuploadFields([]);
    setReviewError(null); setActionSuccess(null);
    setRegistrySnapshot(null);
    setBusinessAffiliations([]);
    setDirectorInvitations([]);
    setVerificationCosts([]);

    const plan = m.subscription_plan || m.merchant_tier || "starter";
    const isBusinessPlan = plan === "corporate" || plan === "business";
    const sb = createClient();
    if (isBusinessPlan) {
      setDirectorsLoading(true);
      sb.from("business_director_verifications")
        .select("*")
        .eq("merchant_id", m.id)
        .order("created_at", { ascending: false })
        .then(({ data }) => {
          setDirectors(data || []);
          setDirectorsLoading(false);
        });
    } else {
      setDirectors([]);
    }

    // Snapshot lookup — 3-step fallback:
    // 1. direct link via business_registry_snapshot_id
    // 2. latest snapshot by merchant_id
    // 3. snapshot linked via a director_invitation.registry_snapshot_id
    const resolveSnapshot = async (): Promise<RegistrySnapshotRow | null> => {
      // Step 1
      if (m.business_registry_snapshot_id) {
        const { data } = await sb
          .from("business_registry_snapshots")
          .select("*")
          .eq("id", m.business_registry_snapshot_id)
          .maybeSingle();
        if (data) return data as RegistrySnapshotRow;
      }
      // Step 2
      const { data: byMerchant } = await sb
        .from("business_registry_snapshots")
        .select("*")
        .eq("merchant_id", m.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (byMerchant) return byMerchant as RegistrySnapshotRow;
      return null;
    };

    Promise.all([
      resolveSnapshot(),
      sb.from("business_affiliations").select("*").eq("merchant_id", m.id).order("created_at", { ascending: false }),
      sb.from("director_invitations").select("*").eq("merchant_id", m.id).order("created_at", { ascending: false }),
      sb.from("verification_costs").select("*").eq("merchant_id", m.id).order("created_at", { ascending: false }).limit(10),
    ]).then(async ([snapshotData, affiliationRes, invitationRes, costRes]) => {
      let resolvedSnapshot = snapshotData;
      // Step 3: fallback via director_invitations.registry_snapshot_id
      if (!resolvedSnapshot && invitationRes.data) {
        const snapshotId = invitationRes.data.find(
          (inv: DirectorInvitationRow) => inv.registry_snapshot_id
        )?.registry_snapshot_id;
        if (snapshotId) {
          const { data: invSnap } = await sb
            .from("business_registry_snapshots")
            .select("*")
            .eq("id", snapshotId)
            .maybeSingle();
          if (invSnap) resolvedSnapshot = invSnap as RegistrySnapshotRow;
        }
      }
      setRegistrySnapshot(resolvedSnapshot || null);
      setBusinessAffiliations(affiliationRes.data || []);
      setDirectorInvitations(invitationRes.data || []);
      setVerificationCosts(costRes.data || []);
    });
  };

  const handleApproveDirector = async (id: string, notes: string) => {
    const { adminManualReviewDirectorAction } = await import("@/lib/actions");
    const res = await adminManualReviewDirectorAction({
      directorVerificationId: id,
      status: "verified",
      adminNotes: notes || "Manually approved by admin.",
    });
    if (res.success) {
      const sb = createClient();
      const { data } = await sb.from("business_director_verifications").select("*").eq("merchant_id", selectedMerchant!.id);
      setDirectors(data || []);
    } else {
      setReviewError("Failed to approve director: " + res.error);
    }
  };

  const handleRejectDirector = async (id: string, notes: string) => {
    const { adminManualReviewDirectorAction } = await import("@/lib/actions");
    const res = await adminManualReviewDirectorAction({
      directorVerificationId: id,
      status: "failed",
      adminNotes: notes || "Manually rejected by admin.",
    });
    if (res.success) {
      const sb = createClient();
      const { data } = await sb.from("business_director_verifications").select("*").eq("merchant_id", selectedMerchant!.id);
      setDirectors(data || []);
    } else {
      setReviewError("Failed to reject director: " + res.error);
    }
  };

  const handleViewDocument = async (pathOrUrl: string) => {
    const res = await adminGetKycDocumentUrlAction(pathOrUrl);
    if (res.success && res.url) {
      window.open(res.url, "_blank");
    } else {
      setReviewError("Failed to load document: " + res.error);
    }
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

  const renderMerchantList = (data: Merchant[]) => {
    const extractKeyPersonnel = (snapshot: any) => {
      if (!snapshot?.raw_response_encrypted) return snapshot?.directors_json || [];
      const raw = snapshot.raw_response_encrypted;
      let keyPersonnel = [];
      if (raw?.data?.company?.keyPersonnel) keyPersonnel = raw.data.company.keyPersonnel;
      else if (raw?.data?.keyPersonnel) keyPersonnel = raw.data.keyPersonnel;
      else if (raw?.keyPersonnel) keyPersonnel = raw.keyPersonnel;
      
      if (!Array.isArray(keyPersonnel) || keyPersonnel.length === 0) {
        return snapshot?.directors_json || [];
      }
      
      return keyPersonnel.map((person: any) => {
        const name = typeof person?.name === 'string' ? person.name.trim() : 'Unnamed director';
        const designation = String(person?.designation || person?.role || 'DIRECTOR');
        const status = person?.status || null;
        const nationality = person?.countryOfResidence || person?.nationality || null;
        const address = person?.address || null;
        const isCorporate = person?.isCorporate === true || person?.isCorporate === "true";
        return { name, designation, status, nationality, address, isCorporate };
      });
    };

    return (
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
                    {formatPlanLabel(m.subscription_plan || m.merchant_tier)}
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
                        <span className="text-xs text-neutral-400 capitalize">{formatPlanLabel(selectedMerchant.subscription_plan || selectedMerchant.merchant_tier)} plan</span>
                      </div>

                      {/* Merchant info grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-neutral-50 rounded-xl p-3 text-sm">
                        <div><p className="text-neutral-400 text-xs mb-0.5">Email</p><p className="font-medium truncate">{selectedMerchant.email}</p></div>
                        <div>
                          <p className="text-neutral-400 text-xs mb-0.5">Phone</p>
                          <p className={`font-semibold ${selectedMerchant.phone ? "text-neutral-900" : "text-red-600"}`}>
                            {selectedMerchant.phone || "⚠ Not provided"}
                          </p>
                        </div>
                        <div className="sm:col-span-2">
                          <p className="text-neutral-400 text-xs mb-0.5">Owner / Director (BVN match)</p>
                          <p className={`font-semibold ${selectedMerchant.owner_name ? "text-neutral-900" : "text-red-600"}`}>
                            {selectedMerchant.owner_name || "⚠ Not provided"}
                          </p>
                        </div>
                        <div className="sm:col-span-2 border-t pt-2 mt-1">
                          <p className="text-neutral-400 text-xs mb-0.5">Business Address</p>
                          {selectedMerchant.business_street || selectedMerchant.business_city || selectedMerchant.business_state || selectedMerchant.business_country ? (
                            <p className="font-medium text-neutral-900">
                              {[selectedMerchant.business_street, selectedMerchant.business_city, selectedMerchant.business_state, selectedMerchant.business_country].filter(Boolean).join(", ")}
                            </p>
                          ) : (
                            <p className="font-semibold text-red-600">⚠ Not provided</p>
                          )}
                        </div>
                      </div>

                      {/* PRD setup-mode and authority context */}
                      <div className="rounded-xl border border-purple-200 bg-purple-50/60 p-3 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-purple-950 text-sm">Setup Mode & Authority Review</p>
                            <p className="text-xs text-purple-700 mt-0.5">
                              Tracks paid setup, live feature gating, saved registry snapshot, affiliation matching, invitations, and cost context.
                            </p>
                          </div>
                          <Badge variant="outline" className="border-purple-200 bg-white text-purple-700 font-bold capitalize">
                            {selectedMerchant.onboarding_status?.replace(/_/g, " ") || "legacy"}
                          </Badge>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {[
                            { label: "Setup mode", value: selectedMerchant.setup_mode ? "Yes" : "No" },
                            { label: "Live features", value: selectedMerchant.live_features_enabled ? "Enabled" : "Locked" },
                            { label: "Relationship", value: selectedMerchant.relationship_claim?.replace(/_/g, " ") || "not set" },
                            { label: "Affiliation", value: selectedMerchant.business_affiliation_status?.replace(/_/g, " ") || "not started" },
                          ].map((item) => (
                            <div key={item.label} className="rounded-lg bg-white border border-purple-100 p-2">
                              <p className="text-[10px] uppercase font-bold text-purple-400">{item.label}</p>
                              <p className="mt-0.5 text-xs font-semibold text-neutral-900 capitalize">{item.value}</p>
                            </div>
                          ))}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="rounded-lg bg-white border border-purple-100 p-3">
                            <p className="text-xs font-bold text-neutral-900">Verification disclosure</p>
                            <p className="mt-1 text-xs text-neutral-600">
                              Version: {selectedMerchant.verification_disclosure_version || "-"}
                            </p>
                            <p className="text-xs text-neutral-600">
                              Acknowledged: {selectedMerchant.verification_disclosure_acknowledged_at ? new Date(selectedMerchant.verification_disclosure_acknowledged_at).toLocaleString() : "-"}
                            </p>
                          </div>
                          <div className="rounded-lg bg-white border border-purple-100 p-3">
                            <p className="text-xs font-bold text-neutral-900">Verification cost context</p>
                            <p className="mt-1 text-xs text-neutral-600">
                              Attempts shown: {verificationCosts.length}
                            </p>
                            <p className="text-xs text-neutral-600">
                              Total shown: NGN {verificationCosts.reduce((sum, item) => sum + Number(item.cost_amount || 0), 0).toLocaleString()}
                            </p>
                          </div>
                        </div>

                        {registrySnapshot ? (
                          <div className="rounded-lg bg-white border border-purple-100 p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <p className="text-xs font-bold text-neutral-900">Saved business registry snapshot</p>
                                <p className="text-[11px] text-neutral-500">
                                  {registrySnapshot.registered_name || "-"} - {registrySnapshot.registration_number || "-"}
                                </p>
                              </div>
                              <Badge variant="outline" className="text-[10px] uppercase">{registrySnapshot.provider_name}</Badge>
                            </div>
                            {(() => {
                              const roster = extractKeyPersonnel(registrySnapshot);
                              return roster.length > 0 ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {roster.slice(0, 6).map((person: any, index: number) => (
                                    <div key={`${person.name}-${index}`} className="rounded border bg-neutral-50 px-2 py-1.5">
                                      <p className="truncate text-xs font-semibold text-neutral-800">{person.name || "Unnamed director"}</p>
                                      <p className="text-[10px] text-neutral-500 capitalize">
                                        {String(person.designation || person.role || "director").replace(/_/g, " ")}
                                      </p>
                                      {person.status && (
                                        <p className="text-[9px] text-neutral-400 uppercase tracking-wide">{person.status}</p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-amber-700">No director roster was returned in the saved snapshot.</p>
                              );
                            })()}
                          </div>
                        ) : selectedMerchant.cac_number ? (
                          <div className="rounded-lg bg-white border border-dashed border-amber-200 p-3 text-xs text-amber-700 font-semibold">
                            CAC number exists, but registry snapshot was not found. Re-run CAC lookup or repair snapshot link.
                          </div>
                        ) : (
                          <div className="rounded-lg bg-white border border-dashed border-purple-100 p-3 text-xs text-neutral-500">
                            No saved registry snapshot yet. RC/CAC lookup must run before affiliation matching or director approval.
                          </div>
                        )}

                        {(businessAffiliations.length > 0 || directorInvitations.length > 0) && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="rounded-lg bg-white border border-purple-100 p-3 space-y-2">
                              <p className="text-xs font-bold text-neutral-900">Affiliation matches</p>
                              {businessAffiliations.length === 0 ? (
                                <p className="text-xs text-neutral-500">No affiliation match recorded.</p>
                              ) : businessAffiliations.slice(0, 4).map((item) => (
                                <div key={item.id} className="text-xs border-t border-neutral-100 pt-2 first:border-t-0 first:pt-0">
                                  <p className="font-semibold capitalize">{item.status?.replace(/_/g, " ")}</p>
                                  <p className="text-neutral-500">{item.match_reason || item.matched_registry_name || "-"}</p>
                                </div>
                              ))}
                            </div>
                            <div className="rounded-lg bg-white border border-purple-100 p-3 space-y-2">
                              <p className="text-xs font-bold text-neutral-900">Director invitations</p>
                              {directorInvitations.length === 0 ? (
                                <p className="text-xs text-neutral-500">No director invitation sent.</p>
                              ) : directorInvitations.slice(0, 4).map((invite) => (
                                <div key={invite.id} className="text-xs border-t border-neutral-100 pt-2 first:border-t-0 first:pt-0">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-semibold truncate">{invite.selected_director_name}</span>
                                    <Badge variant="outline" className="text-[9px] capitalize">{invite.status}</Badge>
                                  </div>
                                  <p className="text-neutral-500 truncate">{invite.director_email}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
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
                            { label: "CAC Number (Dojah Verified)", value: selectedMerchant.cac_number, field: "cac_status" as const, statusVal: selectedMerchant.cac_number ? "verified" : "unverified" },
                            { label: "BVN", value: selectedMerchant.bvn, field: "bvn_status" as const, statusVal: selectedMerchant.bvn_status },
                            { label: "Selfie", value: selectedMerchant.selfie_url ? "Submitted" : null, field: "selfie_status" as const, statusVal: selectedMerchant.selfie_status },
                            { label: "CAC Document", value: selectedMerchant.cac_document_url, field: "cac_status" as const, isDoc: true, statusVal: selectedMerchant.cac_status },
                            { label: "Utility Bill", value: selectedMerchant.utility_document_url, field: "utility_status" as const, isDoc: true, statusVal: selectedMerchant.utility_status },
                          ]).map(({ label, value, field, isDoc, statusVal }) => (
                            <div key={label} className="flex flex-wrap items-center justify-between gap-2 bg-neutral-50 border border-neutral-100 rounded-lg px-3 py-2">
                              <div className="min-w-0">
                                <p className="text-xs text-neutral-500">{label}</p>
                                {isDoc && value ? (
                                  <button onClick={() => handleViewDocument(value as string)} className="text-purp-600 hover:underline text-sm flex items-center gap-1 bg-transparent border-0 p-0 cursor-pointer">
                                    View Document <ExternalLink className="h-3 w-3" />
                                  </button>
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

                      {/* Business Directors & KYB Panel */}
                      {(selectedMerchant.subscription_plan === "corporate" || selectedMerchant.merchant_tier === "corporate" || selectedMerchant.subscription_plan === "business" || selectedMerchant.merchant_tier === "business") && (
                        <div className="space-y-4">
                          <div className="border border-neutral-200 rounded-xl overflow-hidden bg-white shadow-sm">
                            <button
                              type="button"
                              onClick={() => setDirectorsExpanded(!directorsExpanded)}
                              className="w-full flex items-center justify-between p-3.5 bg-neutral-50/50 hover:bg-neutral-50 border-b border-neutral-100 transition-colors"
                            >
                              <span className="font-bold text-sm text-neutral-800 flex items-center gap-2">
                                <User className="h-4.5 w-4.5 text-[#7B2FF7]" />
                                CAC Business Directors &amp; KYB Roster
                                <Badge className="ml-1 bg-[#E9D5FF] text-[#6F2CFF] text-[10px] font-extrabold border-0">
                                  {registrySnapshot ? extractKeyPersonnel(registrySnapshot).length : 0} Listed
                                </Badge>
                              </span>
                              {directorsExpanded ? (
                                <ChevronUp className="h-4 w-4 text-neutral-400" />
                              ) : (
                                <ChevronDown className="h-4 w-4 text-neutral-400" />
                              )}
                            </button>

                            {directorsExpanded && (
                              <div className="p-3.5 space-y-3.5 divide-y divide-neutral-100">
                                {!registrySnapshot ? (
                                  <div className="rounded-lg bg-amber-50 border border-dashed border-amber-200 p-3 text-xs text-amber-700 font-semibold">
                                    CAC number exists, but registry snapshot was not found. Re-run CAC lookup or repair snapshot link.
                                  </div>
                                ) : extractKeyPersonnel(registrySnapshot).length === 0 ? (
                                  <div className="py-6 text-center text-xs text-neutral-400 flex items-center justify-center gap-2">
                                    <Info className="h-4 w-4 text-neutral-300" />
                                    <span>No key personnel found in registry response.</span>
                                  </div>
                                ) : (
                                  extractKeyPersonnel(registrySnapshot).map((person: any, idx: number) => (
                                    <div key={idx} className="pt-3.5 first:pt-0 space-y-2">
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="space-y-1">
                                          <h5 className="font-semibold text-sm text-neutral-900 flex items-center gap-1.5">
                                            {person.name}
                                            {person.isCorporate && (
                                              <Badge variant="outline" className="text-[9px] bg-neutral-100 border-neutral-200 text-neutral-600 px-1 py-0 uppercase">Business Entity</Badge>
                                            )}
                                          </h5>
                                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500 font-mono">
                                            <span>Role: {String(person.designation || person.role || "Director").replace(/_/g, " ")}</span>
                                            {person.nationality && <span>Nationality: {person.nationality}</span>}
                                            {person.status && <span>Status: {person.status}</span>}
                                          </div>
                                          {person.address && (
                                            <p className="text-xs text-neutral-400 max-w-sm truncate" title={person.address}>
                                              {person.address}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>

                          <div className="border border-neutral-200 rounded-xl overflow-hidden bg-white shadow-sm">
                            <div className="w-full flex items-center justify-between p-3.5 bg-neutral-50/50 border-b border-neutral-100">
                              <span className="font-bold text-sm text-neutral-800 flex items-center gap-2">
                                <ShieldCheck className="h-4.5 w-4.5 text-blue-600" />
                                Director Approval &amp; Identity Evidence
                                <Badge className={`ml-1 text-[10px] font-extrabold border-0 ${
                                  directors.filter(d => d.verification_status === "verified").length > 0
                                    ? "bg-emerald-100 text-emerald-700"
                                    : directors.length > 0
                                    ? "bg-amber-100 text-amber-700"
                                    : "bg-blue-100 text-blue-700"
                                }`}>
                                  {directors.length} Record{directors.length !== 1 ? "s" : ""}
                                </Badge>
                              </span>
                            </div>

                            <div className="p-3.5 space-y-3.5 divide-y divide-neutral-100">
                              {selectedMerchant.business_affiliation_status === "director_approved" && directors.length === 0 && !directorsLoading && (
                                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 mb-3 text-xs text-amber-800 font-semibold flex items-start gap-2">
                                  <ShieldAlert className="h-4 w-4 text-amber-600 flex-shrink-0" />
                                  Director approval exists, but director identity verification evidence was not found.
                                </div>
                              )}

                              {directorsLoading ? (
                                <div className="py-6 flex flex-col items-center justify-center gap-2 text-neutral-400 text-xs">
                                  <Loader className="h-5 w-5 animate-spin text-blue-600" />
                                  <span>Loading director KYC statuses...</span>
                                </div>
                              ) : directors.length === 0 ? (
                                <div className="py-4 text-center text-xs text-neutral-400 flex items-center justify-center gap-2">
                                  <Info className="h-4 w-4 text-neutral-300" />
                                  <span>No director identity verification submitted for this account yet.</span>
                                </div>
                              ) : (
                                directors.map((dir) => {
                                  // Parse normalized_response for sandbox and BVN name data
                                  const normResp = dir.normalized_response as Record<string, unknown> | null;
                                  const sandboxOverride = normResp?.deraLedgerSandboxOverride as Record<string, unknown> | null;
                                  const bvnData = normResp?.data as Record<string, unknown> | null;
                                  const bvnFirstName = String(bvnData?.firstName || "").trim();
                                  const bvnLastName = String(bvnData?.lastName || "").trim();
                                  const bvnNameOnCard = String(bvnData?.nameOnCard || "").trim();
                                  const bvnReturnedName = [bvnFirstName, bvnLastName].filter(Boolean).join(" ") || bvnNameOnCard || null;
                                  const invitedName = String(dir.director_name || "").toUpperCase().trim();
                                  const bvnNormalized = bvnReturnedName?.toUpperCase().trim() || "";

                                  // Check name match — compare invited director name tokens vs BVN returned tokens
                                  const invitedTokens = invitedName.split(/\s+/).filter(Boolean);
                                  const bvnTokens = bvnNormalized.split(/\s+/).filter(Boolean);
                                  const hasNameOverlap = invitedTokens.length > 0 && bvnTokens.length > 0 &&
                                    invitedTokens.some(t => bvnTokens.includes(t) && t.length > 2);
                                  const nameMismatch = bvnReturnedName !== null && !hasNameOverlap;

                                  // Selfie analysis
                                  const providerMatch = sandboxOverride ? (sandboxOverride.providerMatch as boolean) : true;
                                  const providerConfidence = sandboxOverride?.providerConfidenceLevel as number | null ?? dir.face_match_score;
                                  const providerThreshold = sandboxOverride?.providerThreshold as number | null;
                                  const selfieMatchBypassed = sandboxOverride?.selfieMatchBypassed as boolean ?? false;

                                  // Find linked invitation
                                  const linkedInvite = directorInvitations.find(inv => inv.id === dir.invitation_id) ||
                                    directorInvitations.find(inv => inv.selected_director_name?.toUpperCase() === invitedName);

                                  return (
                                    <div key={dir.id} className="pt-3.5 first:pt-0 space-y-3">
                                      {/* Header: invited director + status badge */}
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="space-y-1">
                                          <h5 className="font-semibold text-sm text-neutral-900 flex items-center gap-1.5">
                                            {dir.director_name}
                                            <span className="text-[10px] bg-neutral-100 text-neutral-600 px-1.5 py-0.5 rounded capitalize font-medium">
                                              {dir.director_role?.replace(/_/g, " ")}
                                            </span>
                                          </h5>
                                          {linkedInvite && (
                                            <p className="text-[10px] text-neutral-400">
                                              Invited via: {linkedInvite.director_email} · Invite status: <span className="capitalize">{linkedInvite.status}</span>
                                            </p>
                                          )}
                                        </div>

                                        <div className="flex flex-col items-end gap-1.5">
                                          <Badge
                                            variant="outline"
                                            className={`text-[10px] font-bold border-2 capitalize ${
                                              dir.verification_status === "verified" && !nameMismatch
                                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                                : dir.verification_status === "failed"
                                                ? "bg-red-50 text-red-700 border-red-200"
                                                : nameMismatch
                                                ? "bg-red-50 text-red-700 border-red-200"
                                                : "bg-amber-50 text-amber-700 border-amber-200"
                                            }`}
                                          >
                                            {nameMismatch ? "Name Mismatch" : dir.verification_status?.replace(/_/g, " ")}
                                          </Badge>
                                          {providerConfidence !== null && (
                                            <span className="text-[10px] text-neutral-400 font-mono">
                                              Confidence: {providerConfidence}%{providerThreshold ? ` / ${providerThreshold}% threshold` : ""}
                                            </span>
                                          )}
                                        </div>
                                      </div>

                                      {/* Name Mismatch Warning */}
                                      {nameMismatch && bvnReturnedName && (
                                        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-800 flex items-start gap-2">
                                          <ShieldAlert className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                                          <div>
                                            <p className="font-bold mb-1">Director Identity Name Mismatch</p>
                                            <p>Invited director: <span className="font-semibold">{dir.director_name}</span></p>
                                            <p>BVN returned name: <span className="font-semibold">{bvnReturnedName}{bvnNameOnCard && bvnNameOnCard !== bvnReturnedName ? ` / ${bvnNameOnCard}` : ""}</span></p>
                                            <p className="mt-1 text-red-700">This director identity evidence does not match the invited director. Do not count as verified.</p>
                                          </div>
                                        </div>
                                      )}

                                      {/* Sandbox Override Warning */}
                                      {selfieMatchBypassed && (
                                        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 flex items-start gap-2">
                                          <ShieldAlert className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                                          <div>
                                            <p className="font-bold mb-1">Sandbox Override — Provider Selfie Threshold Not Met</p>
                                            <p>Provider selfie match: <span className="font-semibold text-red-700">{providerMatch ? "Passed" : "Failed"}</span></p>
                                            <p>Provider confidence: <span className="font-semibold">{providerConfidence}%</span> / threshold: <span className="font-semibold">{providerThreshold}%</span></p>
                                            <p className="mt-1">Sandbox override accepted this verification. In production this would be <span className="font-bold">rejected or flagged for manual review</span>.</p>
                                          </div>
                                        </div>
                                      )}

                                      {/* BVN & Selfie Details */}
                                      <div className="rounded-lg bg-neutral-50 border border-neutral-100 p-2.5 text-xs font-mono text-neutral-600 space-y-1">
                                        <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                                          <span>BVN: {dir.masked_bvn || "—"}</span>
                                          <span>Provider: {dir.provider_name || "—"}</span>
                                          <span>Ref: {dir.verification_id || dir.id.split("-")[0]}</span>
                                        </div>
                                        {bvnReturnedName && (
                                          <div className="flex gap-2">
                                            <span className="text-neutral-400">BVN name returned:</span>
                                            <span className={nameMismatch ? "text-red-600 font-semibold" : "text-neutral-800"}>{bvnReturnedName}{bvnNameOnCard && bvnNameOnCard !== bvnReturnedName ? ` / ${bvnNameOnCard}` : ""}</span>
                                          </div>
                                        )}
                                        <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                                          <span>Selfie: {selfieMatchBypassed ? "Sandbox accepted" : dir.selfie_url ? "Submitted" : "Missing"}</span>
                                          {dir.created_at && <span>Verified at: {new Date(dir.created_at).toLocaleString()}</span>}
                                        </div>
                                      </div>

                                      {dir.selfie_url && (
                                        <button
                                          type="button"
                                          onClick={() => dir.selfie_url && handleViewDocument(dir.selfie_url)}
                                          className="text-xs text-blue-600 hover:underline flex items-center gap-1 font-semibold"
                                        >
                                          View Selfie <ExternalLink className="h-3 w-3" />
                                        </button>
                                      )}

                                      {/* Action panel */}
                                      {(dir.verification_status !== "verified" || nameMismatch) && (
                                        <div className="bg-neutral-50 rounded-lg p-2.5 border border-neutral-200/60 space-y-2">
                                          <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider block">
                                            Manual Override Action
                                          </span>
                                          <div className="flex gap-2">
                                            <input
                                              type="text"
                                              placeholder="Reason or notes for manual override..."
                                              value={directorNotes[dir.id] || ""}
                                              onChange={(e) =>
                                                setDirectorNotes({ ...directorNotes, [dir.id]: e.target.value })
                                              }
                                              className="w-full text-xs rounded border border-neutral-300 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#7B2FF7] bg-white text-neutral-800"
                                            />
                                            <Button
                                              type="button"
                                              size="sm"
                                              onClick={() => handleApproveDirector(dir.id, directorNotes[dir.id] || "")}
                                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-8"
                                            >
                                              Approve
                                            </Button>
                                            <Button
                                              type="button"
                                              size="sm"
                                              variant="destructive"
                                              onClick={() => handleRejectDirector(dir.id, directorNotes[dir.id] || "")}
                                              className="text-white font-bold text-xs h-8"
                                            >
                                              Reject
                                            </Button>
                                          </div>
                                        </div>
                                      )}

                                      {dir.admin_notes && (
                                        <div className="bg-neutral-50 rounded-lg p-2.5 border border-dashed text-xs text-neutral-600 leading-relaxed font-mono">
                                          <span className="font-bold text-neutral-800 block mb-0.5">Admin Audit Notes:</span>
                                          {dir.admin_notes}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                      {/* Review notes */}
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium">Review Notes (optional)</Label>
                        <Textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} placeholder="Add notes about this document review..." className="min-h-[56px] text-sm" />
                      </div>

                      {/* Reason input */}
                      {(actionMode === "reject" || actionMode === "reupload") && (
                        <div className={`space-y-3 rounded-xl p-3 border ${actionMode === "reject" ? "bg-red-50 border-red-200" : "bg-orange-50 border-orange-200"}`}>
                          <div>
                            <Label className={`text-sm font-semibold ${actionMode === "reject" ? "text-red-800" : "text-orange-800"}`}>
                            {actionMode === "reject" ? "Rejection Reason (required)" : "Documents needed (required)"}
                            </Label>
                            <Textarea
                              value={actionReason}
                              onChange={e => setActionReason(e.target.value)}
                              placeholder={actionMode === "reject" ? "Explain why verification is being rejected..." : "Example: Re-upload clearer utility bill and retake selfie in good lighting."}
                              className={`min-h-[80px] bg-white text-sm ${actionMode === "reject" ? "border-red-300" : "border-orange-300"}`}
                            />
                            {actionMode === "reject" && actionReason.trim().length > 0 && actionReason.trim().length < 10 && (
                              <p className="text-xs text-red-600 mt-1">Reason must be at least 10 characters.</p>
                            )}
                          </div>

                          {actionMode === "reupload" && (
                            <div className="space-y-2">
                              <p className="text-xs font-semibold text-orange-900">Mark affected checks</p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {reuploadOptions.map((option) => (
                                  <label
                                    key={option.field}
                                    className={`flex items-start gap-2 rounded-lg border p-2 cursor-pointer transition-colors ${
                                      reuploadFields.includes(option.field)
                                        ? "bg-white border-orange-400"
                                        : "bg-orange-50/50 border-orange-200 hover:bg-white"
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={reuploadFields.includes(option.field)}
                                      onChange={() => toggleReuploadField(option.field)}
                                      className="mt-0.5 h-4 w-4 accent-orange-600"
                                    />
                                    <span>
                                      <span className="block text-xs font-bold text-neutral-900">{option.label}</span>
                                      <span className="block text-[11px] leading-snug text-neutral-500">{option.description}</span>
                                    </span>
                                  </label>
                                ))}
                              </div>
                              <p className="text-[11px] text-orange-700">
                                Selected checks will be marked rejected and live payment collection will stay locked until the merchant fixes them.
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Reset warning */}
                      {actionMode === "reset" && (
                        <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4 flex gap-3 items-start">
                          <ShieldAlert className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                          <div>
                            <h4 className="text-sm font-bold text-red-900 mb-1">Danger: Full KYC Reset</h4>
                            <p className="text-xs text-red-700 leading-relaxed">
                              This action clears the active BVN, selfie, CAC, utility, and authority statuses and returns the merchant to setup mode. Historical logs and previous file references stay in the audit trail.
                            </p>
                            <p className="text-xs text-red-800 font-semibold mt-2">Use this only when the merchant needs a clean verification restart.</p>
                          </div>
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
                        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-9" 
                          disabled={
                            actionLoading || 
                            selectedMerchant?.verification_status === "verified" ||
                            getEffectiveStatus(selectedMerchant) === "incomplete" ||
                            (selectedMerchant?.subscription_plan === "corporate" && (selectedMerchant?.cac_status !== "verified" || selectedMerchant?.utility_status !== "verified"))
                          } 
                          onClick={handleApprove}>
                          <CheckCircle className="h-3.5 w-3.5 mr-1" />{actionLoading ? "..." : "Approve"}
                        </Button>
                        <Button variant="destructive" className="text-xs h-9" disabled={actionLoading || selectedMerchant?.verification_status === "rejected"} onClick={() => { setActionMode("reject"); setActionReason(""); }}>
                          <XCircle className="h-3.5 w-3.5 mr-1" />Reject
                        </Button>
                        <Button variant="outline" className="border-orange-300 text-orange-700 hover:bg-orange-50 text-xs h-9" disabled={actionLoading} onClick={() => { setActionMode("reupload"); setActionReason(""); setReuploadFields([]); }}>
                          <UploadCloud className="h-3.5 w-3.5 mr-1" />Reupload
                        </Button>
                        <Button variant="outline" className="border-neutral-300 text-xs h-9" disabled={actionLoading} onClick={() => { setActionMode("reset"); setActionReason(""); setReuploadFields([]); }}>
                          <RotateCcw className="h-3.5 w-3.5 mr-1" />Reset
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-2 flex-wrap">
                        <Button variant="outline" className="text-xs h-9" onClick={() => { setActionMode("idle"); setActionReason(""); setReuploadFields([]); }}>Cancel</Button>
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
                        {actionMode === "reset" && (
                          <Button variant="destructive" className="text-xs h-9" disabled={actionLoading} onClick={handleReset}>
                            <RotateCcw className="h-3.5 w-3.5 mr-1" /> {actionLoading ? "Resetting..." : "Yes, Force Reset"}
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
  };

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
            <Card className="border shadow-none"><CardContent className="p-0">{renderMerchantList(getFilteredMerchants(tab))}</CardContent></Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
