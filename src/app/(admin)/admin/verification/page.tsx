/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState } from "react";
import {
  ShieldCheck, ShieldAlert, ShieldX, Clock, CheckCircle, XCircle,
  Search, Eye, RotateCcw, UploadCloud, ExternalLink, ChevronDown, ChevronUp, Info, Loader
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
  adminGetVerificationDetailsAction,
  getActiveVerificationProviderKeyAction,
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
  created_at?: string | null;
  approved_at?: string | null;
  sent_at?: string | null;
  registry_role?: string | null;
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
  const [directorsExpanded, setDirectorsExpanded] = useState(false);
  const [directorNotes, setDirectorNotes] = useState<Record<string, string>>({});
  const [registrySnapshot, setRegistrySnapshot] = useState<RegistrySnapshotRow | null>(null);
  const [businessAffiliations, setBusinessAffiliations] = useState<BusinessAffiliationRow[]>([]);
  const [directorInvitations, setDirectorInvitations] = useState<DirectorInvitationRow[]>([]);
  const [verificationCosts, setVerificationCosts] = useState<VerificationCostRow[]>([]);
  const [verificationLogs, setVerificationLogs] = useState<any[]>([]);
  const [activeProvider, setActiveProvider] = useState<string>("youverify");
  const [snapshotSource, setSnapshotSource] = useState<string>("none");

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
    getActiveVerificationProviderKeyAction().then((res) => {
      if (res.success && res.provider) {
        setActiveProvider(res.provider);
      }
    });
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

  const reviewToneClass = (tone: string) => {
    switch (tone) {
      case "verified": return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "pending": return "bg-amber-50 text-amber-700 border-amber-200";
      case "attention": return "bg-orange-50 text-orange-700 border-orange-200";
      case "blocked": return "bg-red-50 text-red-700 border-red-200";
      case "info": return "bg-blue-50 text-blue-700 border-blue-200";
      default: return "bg-neutral-50 text-neutral-700 border-neutral-200";
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

  const openReview = async (m: Merchant) => {
    setSelectedMerchant(m);
    setReviewNotes(""); setActionReason(""); setActionMode("idle");
    setReuploadFields([]);
    setReviewError(null); setActionSuccess(null);
    setRegistrySnapshot(null);
    setBusinessAffiliations([]);
    setDirectorInvitations([]);
    setVerificationCosts([]);
    setVerificationLogs([]);
    setSnapshotSource("none");

    const plan = m.subscription_plan || m.merchant_tier || "starter";
    const isBusinessPlan = plan === "corporate" || plan === "business";

    setDirectorsLoading(true);
    try {
      const res = await adminGetVerificationDetailsAction(m.id);
      if (res.success) {
        setRegistrySnapshot(res.registrySnapshot || null);
        setSnapshotSource(res.snapshotSource || "none");
        setBusinessAffiliations(res.businessAffiliations || []);
        setDirectorInvitations(res.directorInvitations || []);
        setVerificationCosts(res.verificationCosts || []);
        setVerificationLogs(res.verificationLogs || []);
        setDirectorsExpanded(false);
        if (isBusinessPlan) {
          setDirectors(res.directors || []);
        } else {
          setDirectors([]);
        }
      } else {
        setReviewError(res.error || "Failed to load verification details");
      }
    } catch (e: any) {
      setReviewError(e.message || "An error occurred loading verification details");
    } finally {
      setDirectorsLoading(false);
    }
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
  );  const renderMerchantList = (data: Merchant[]) => {
    const extractKeyPersonnel = (snapshot: any) => {
      if (!snapshot) return [];

      let roster: any[] = [];
      if (Array.isArray(snapshot.directors_json) && snapshot.directors_json.length > 0) {
        roster = snapshot.directors_json;
      }

      const rawCandidates: any[] = [];
      const addCandidate = (c: any) => {
        if (!c) return;
        rawCandidates.push(c);
        if (c.raw_provider_response) rawCandidates.push(c.raw_provider_response);
        if (c.rawProviderResponse) rawCandidates.push(c.rawProviderResponse);
        if (c.raw_response) rawCandidates.push(c.raw_response);
        if (c.rawResponse) rawCandidates.push(c.rawResponse);
        if (c.normalized_response_json) rawCandidates.push(c.normalized_response_json);
        if (c.normalizedResponseJson) rawCandidates.push(c.normalizedResponseJson);
        if (c.data) rawCandidates.push(c.data);
      };
      addCandidate(snapshot.raw_response_encrypted);
      addCandidate(snapshot.raw_response);
      addCandidate(snapshot.normalized_response_json);
      addCandidate(snapshot.rawResponse);
      addCandidate(snapshot.raw_provider_response);
      addCandidate(snapshot.rawProviderResponse);

      for (const raw of rawCandidates) {
        if (!raw) continue;

        const arrays = [
          'keyPersonnel', 'directors', 'officers', 'shareholders', 'personnel', 'trustees',
          'signatories', 'beneficialOwners', 'personsWithSignificantControl',
          'beneficial_owners', 'persons_with_significant_control'
        ];
        for (const arrName of arrays) {
          const pathVal1 = raw?.data?.company?.[arrName];
          const pathVal2 = raw?.data?.[arrName];
          const pathVal3 = raw?.[arrName];
          if (Array.isArray(pathVal1) && pathVal1.length > 0) {
            roster = [...roster, ...pathVal1];
          }
          if (Array.isArray(pathVal2) && pathVal2.length > 0) {
            roster = [...roster, ...pathVal2];
          }
          if (Array.isArray(pathVal3) && pathVal3.length > 0) {
            roster = [...roster, ...pathVal3];
          }
        }
      }

      if (roster.length === 0) {
        return [];
      }

      const mapped = roster.map((person: any) => {
        const name = typeof person?.name === 'string' ? person.name.trim() : 'Unnamed director';
        const designation = String(person?.designation || person?.role || person?.roleDescription || 'DIRECTOR');
        const status = person?.status || person?.companyStatus || null;
        const nationality = person?.countryOfResidence || person?.nationality || null;
        const address = person?.address || null;
        const isCorporate = person?.isCorporate === true || person?.isCorporate === "true" || !!person?.corporateName || false;
        return { name, designation, status, nationality, address, isCorporate };
      });

      const seen = new Set<string>();
      const deduped: any[] = [];
      for (const item of mapped) {
        const key = `${item.name.toUpperCase()}|${item.designation.toUpperCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push(item);
        }
      }

      return deduped;
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
                <DialogContent className="w-[calc(100vw-1rem)] max-w-[min(95vw,112rem)] max-h-[90vh] overflow-hidden p-0 sm:w-[95vw] sm:max-w-3xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl">
                  <DialogHeader className="border-b border-neutral-200 px-4 py-4 sm:px-6">
                    <DialogTitle className="text-neutral-900 text-base">
                      {m.trading_name || m.business_name}
                    </DialogTitle>
                    <DialogDescription>KYC Review - take action below.</DialogDescription>
                  </DialogHeader>

                  {selectedMerchant && (() => {
                    const planKey = selectedMerchant.subscription_plan || selectedMerchant.merchant_tier;
                    const planLabel = formatPlanLabel(planKey);
                    const isBusinessPlan = planKey === "corporate" || planKey === "business";
                    const effectiveStatus = getEffectiveStatus(selectedMerchant);
                    const roster = extractKeyPersonnel(registrySnapshot);
                    const rosterCount = roster.length;
                    const hasMissingSnapshot = !registrySnapshot && !!selectedMerchant.cac_number;
                    const businessAddress = [selectedMerchant.business_street, selectedMerchant.business_city, selectedMerchant.business_state, selectedMerchant.business_country].filter(Boolean).join(", ");

                    const repLog = verificationLogs.find((log) =>
                      [
                        "representative_bvn_selfie",
                        "individual_bvn_selfie",
                        "bvn_selfie",
                        "identity",
                      ].includes(String(log.verification_type || "").toLowerCase())
                    );
                    const repStoredProvider = String(
                      repLog?.provider_name ||
                      (repLog as Record<string, unknown> | undefined)?.provider ||
                      (repLog as Record<string, unknown> | undefined)?.source_provider ||
                      (repLog as Record<string, unknown> | undefined)?.verification_provider ||
                      (repLog as Record<string, unknown> | undefined)?.provider_key ||
                      repLog?.raw_response?.provider_name ||
                      repLog?.raw_response?.provider ||
                      repLog?.raw_response?.source ||
                      repLog?.raw_response?.vendor ||
                      repLog?.raw_response?.data?.provider_name ||
                      repLog?.raw_response?.data?.provider ||
                      ""
                    ).trim();
                    const repMerchantProvider = String((selectedMerchant as any).bvn_provider || "").trim();
                    const repProviderUsesActiveFallback = !repStoredProvider && !!repLog && !!(repLog?.provider_reference || repLog?.verification_id);
                    const repProviderRaw = repStoredProvider || repMerchantProvider || (repProviderUsesActiveFallback ? activeProvider : "Unknown");
                    const formattedRepProvider = repProviderRaw.charAt(0).toUpperCase() + repProviderRaw.slice(1).toLowerCase();
                    const isHistoricalRepProvider = activeProvider.toLowerCase() !== repProviderRaw.toLowerCase() && repProviderRaw.toLowerCase() !== "unknown";
                    const repBvnData = repLog?.raw_response?.data || repLog?.raw_response;
                    const repBvnFirstName = String(repBvnData?.firstName || "").trim();
                    const repBvnLastName = String(repBvnData?.lastName || "").trim();
                    const repBvnNameOnCard = String(repBvnData?.nameOnCard || "").trim();
                    const repBvnReturnedName = String(
                      repLog?.returned_bvn_name ||
                      repLog?.raw_response?.returnedName ||
                      repLog?.raw_response?.returned_name ||
                      repLog?.raw_response?.data?.returnedName ||
                      repLog?.raw_response?.data?.name ||
                      ""
                    ).trim() || [repBvnFirstName, repBvnLastName].filter(Boolean).join(" ") || repBvnNameOnCard || null;
                    const repSubmittedName = String(selectedMerchant.owner_name || "").trim();
                    const repStoredNameMatchStatus = String(
                      repLog?.name_match_status ||
                      repLog?.raw_response?.nameMatchStatus ||
                      repLog?.raw_response?.data?.nameMatchStatus ||
                      ""
                    ).trim().toLowerCase();
                    const repTokens = (value: string) =>
                      value.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
                    const repMatches = (left: string, right: string) => {
                      if (!left || !right) return false;
                      if (left === right) return true;
                      if (left.length < 4 || right.length < 4) return false;
                      return left.includes(right) || right.includes(left);
                    };
                    const repNameMismatch = (() => {
                      if (!repSubmittedName || !repBvnReturnedName) return false;
                      const submittedTokens = repTokens(repSubmittedName);
                      const returnedTokens = repTokens(repBvnReturnedName);
                      const returnedSurname = returnedTokens[returnedTokens.length - 1] || "";
                      if (!returnedSurname || !submittedTokens.some((token) => repMatches(token, returnedSurname))) return true;
                      const returnedGivenNames = returnedTokens.slice(0, -1);
                      if (returnedGivenNames.length === 0) return false;
                      return !returnedGivenNames.some((returnedToken) =>
                        submittedTokens.some((submittedToken) => repMatches(submittedToken, returnedToken))
                      );
                    })();
                    const repProviderUnknown = formattedRepProvider.toLowerCase() === "unknown";
                    const repProviderConfirmed = !!repStoredProvider;
                    const repProviderNote = !repProviderConfirmed && repMerchantProvider
                      ? `Provider not stored on historical row - using merchant provider setting (${repMerchantProvider.toUpperCase()}).`
                      : !repProviderConfirmed && repProviderUsesActiveFallback
                        ? `Provider not stored on historical row - current active provider is ${formattedRepProvider}.`
                        : null;
                    const repNameMatchStatus = !repBvnReturnedName
                      ? "Unknown / Not recorded"
                      : repNameMismatch || ["mismatch", "manual_review", "failed", "name_mismatch"].includes(repStoredNameMatchStatus)
                        ? "Mismatch / Manual review required"
                        : ["passed", "matched", "verified", "success"].includes(repStoredNameMatchStatus) || !repStoredNameMatchStatus
                          ? "Matched"
                          : "Unknown / Needs review";
                    const repSandboxOverride = repLog?.raw_response?.deraLedgerSandboxOverride as Record<string, unknown> | null;
                    const repSelfieMatchBypassed = repSandboxOverride?.selfieMatchBypassed as boolean ?? false;
                    const repMatchScore: number | null = (
                      repLog?.match_score ??
                      (repSandboxOverride?.providerConfidenceLevel as number | null) ??
                      (selectedMerchant as any).dojah_match_score ??
                      repLog?.raw_response?.data?.confidence ??
                      null
                    );
                    const repProviderConfidence = repMatchScore;
                    const repProviderThreshold = repSandboxOverride?.providerThreshold as number | null;
                    const repProviderRef: string = (
                      repLog?.provider_reference ||
                      repLog?.verification_id ||
                      (selectedMerchant as any).dojah_reference ||
                      "Not submitted"
                    );
                    const identityLabel = isBusinessPlan ? "Representative Identity" : "Identity Verification";
                    const identitySectionLabel = isBusinessPlan ? "Representative Identity Evidence" : "Individual Identity Evidence";
                    const repIdentityBlocked = repNameMatchStatus === "Mismatch / Manual review required";
                    const repIdentityPendingReview = !repIdentityBlocked && (repNameMatchStatus !== "Matched" || !repProviderConfirmed || repSelfieMatchBypassed || repProviderUnknown);
                    const repIdentityVerified = !repIdentityBlocked && !repIdentityPendingReview && selectedMerchant.bvn_status === "verified" && (selectedMerchant.selfie_status || "unverified") === "verified";
                    const showIdentityManualReviewPanel = !isBusinessPlan && (repIdentityBlocked || repIdentityPendingReview);
                    const approveDisabledReason = (() => {
                      if (repIdentityBlocked) return "Approval blocked: identity name mismatch requires manual review or re-verification.";
                      if (!isBusinessPlan && repIdentityPendingReview) return "Approval blocked: identity evidence still needs review before final approval.";
                      if (selectedMerchant.verification_status === "verified" && !selectedMerchant.live_features_enabled) return "Approval blocked: stored verification status is verified, but live features remain locked pending compliance resolution.";
                      if (getEffectiveStatus(selectedMerchant) === "incomplete") return "Approval blocked: merchant profile details are incomplete.";
                      if (selectedMerchant.subscription_plan === "corporate" && (selectedMerchant.cac_status !== "verified" || selectedMerchant.utility_status !== "verified")) return "Approval blocked: business verification documents are still incomplete.";
                      return null;
                    })();
                    const isApproveDisabled =
                      actionLoading ||
                      repIdentityBlocked ||
                      (!isBusinessPlan && repIdentityPendingReview) ||
                      selectedMerchant.verification_status === "verified" ||
                      getEffectiveStatus(selectedMerchant) === "incomplete" ||
                      (selectedMerchant.subscription_plan === "corporate" && (selectedMerchant.cac_status !== "verified" || selectedMerchant.utility_status !== "verified"));

                    const cacLog = verificationLogs.find(
                      (log) => log.verification_type === "business" || log.verification_type === "business_registry"
                    );
                    const cacProviderRaw = registrySnapshot?.provider_name || cacLog?.provider_name || (selectedMerchant as any).cac_provider || "Unknown";
                    const formattedCacProvider = cacProviderRaw.charAt(0).toUpperCase() + cacProviderRaw.slice(1).toLowerCase();
                    const isHistoricalCacProvider = activeProvider.toLowerCase() !== cacProviderRaw.toLowerCase() && cacProviderRaw.toLowerCase() !== "unknown";
                    const cacProviderRef = cacLog?.provider_reference || cacLog?.verification_id || "Not submitted";
                    const cacEvidenceTimestamp = cacLog?.created_at || null;

                    const directorProviderNames = Array.from(new Set(directors.map((dir) => (dir.provider_name || "Unknown").trim() || "Unknown")));
                    const formattedDirectorProviders = directorProviderNames.map((provider) => provider.charAt(0).toUpperCase() + provider.slice(1).toLowerCase());
                    const hasUnknownDirectorProvider = directorProviderNames.some((provider) => provider.toLowerCase() === "unknown");
                    const hasHistoricalDirectorProvider = directorProviderNames.some((provider) => provider.toLowerCase() !== "unknown" && provider.toLowerCase() !== activeProvider.toLowerCase());
                    const hasDirectorApproval = directorInvitations.some((invite) => ["approved", "verified"].includes(String(invite.status || "").toLowerCase())) || selectedMerchant.business_affiliation_status === "director_approved";
                    const hasDirectorManualReview = directors.some((dir) => dir.manual_review_required);
                    const hasDirectorFailure = directors.some((dir) => dir.verification_status === "failed");
                    const hasDirectorSandboxWarning = directors.some((dir) => {
                      const normResp = dir.normalized_response as Record<string, unknown> | null;
                      const sandboxOverride = normResp?.deraLedgerSandboxOverride as Record<string, unknown> | null;
                      return (sandboxOverride?.selfieMatchBypassed as boolean | undefined) ?? false;
                    });
                    const hasDirectorNameMismatch = directors.some((dir) => {
                      const normResp = dir.normalized_response as Record<string, unknown> | null;
                      const bvnData = normResp?.data as Record<string, unknown> | null;
                      const bvnFirstName = String(bvnData?.firstName || "").trim();
                      const bvnLastName = String(bvnData?.lastName || "").trim();
                      const bvnNameOnCard = String(bvnData?.nameOnCard || "").trim();
                      const bvnReturnedName = [bvnFirstName, bvnLastName].filter(Boolean).join(" ") || bvnNameOnCard || null;
                      const invitedName = String(dir.director_name || "").toUpperCase().trim();
                      const bvnNormalized = bvnReturnedName?.toUpperCase().trim() || "";
                      const invitedTokens = invitedName.split(/\s+/).filter((token) => token.length > 2);
                      const bvnTokens = bvnNormalized.split(/\s+/).filter((token) => token.length > 2);
                      const matchingTokens = invitedTokens.filter((token) => bvnTokens.includes(token));
                      const requiredMatches = Math.min(2, invitedTokens.length);
                      const isNameMatched = matchingTokens.length >= requiredMatches;
                      return bvnReturnedName !== null && !isNameMatched;
                    });

                    const documentItems = [
                      { label: "CAC Document", value: selectedMerchant.cac_document_url, field: "cac_status" as const, statusVal: selectedMerchant.cac_status },
                      { label: "Utility Bill / Proof of Business Address", value: selectedMerchant.utility_document_url, field: "utility_status" as const, statusVal: selectedMerchant.utility_status },
                    ];
                    const availableDocumentCount = documentItems.filter((item) => item.value).length;
                    const allDocumentsVerified = availableDocumentCount === documentItems.length && documentItems.every((item) => item.statusVal === "verified");
                    const directorInvitationStatuses = directorInvitations.map((invite) => String(invite.status || "").toLowerCase());
                    const hasRejectedDirectorApproval = directorInvitationStatuses.some((status) => ["rejected", "declined", "expired", "failed"].includes(status));
                    const hasPendingDirectorApproval = directorInvitationStatuses.some((status) => ["sent", "opened", "pending"].includes(status));

                    const mainBlocker = (() => {
                      if (selectedMerchant.kyc_rejection_reason) return "Previous rejection reason needs reviewer attention.";
                      if (effectiveStatus === "incomplete") return "Merchant profile details are incomplete.";
                      if (repIdentityBlocked) return "Identity evidence requires manual review before final approval.";
                      if (repIdentityPendingReview) return "Identity evidence needs review before final approval.";
                      if (isBusinessPlan && hasMissingSnapshot) return "CAC snapshot is missing and business registration evidence needs repair.";
                      if (isBusinessPlan && selectedMerchant.business_affiliation_status === "director_approved" && directors.length === 0 && !directorsLoading) return "Director approval exists without matching identity evidence.";
                      if (!selectedMerchant.live_features_enabled) return "Live features remain locked pending compliance completion.";
                      if (effectiveStatus === "pending_admin_review") return "Awaiting final admin decision.";
                      if (effectiveStatus === "pending") return "Submitted evidence still needs review.";
                      return "No immediate blocker detected from the current review data.";
                    })();

                    const checklistItems = [
                      {
                        label: identityLabel,
                        badge: repIdentityBlocked ? "manual review" : repIdentityPendingReview ? "pending review" : repIdentityVerified ? "verified" : selectedMerchant.bvn_status === "verified" || !!selectedMerchant.selfie_url ? "pending" : "attention",
                        tone: repIdentityBlocked ? "blocked" : repIdentityPendingReview ? "pending" : repIdentityVerified ? "verified" : selectedMerchant.bvn_status === "verified" || !!selectedMerchant.selfie_url ? "pending" : "attention",
                        reason: repIdentityBlocked
                          ? `Submitted name does not match BVN returned name (${repBvnReturnedName || "not recorded"}).`
                          : repIdentityPendingReview
                            ? repProviderUnknown
                              ? "Provider traceability is missing for this identity evidence."
                              : !repProviderConfirmed && repProviderNote
                                ? repProviderNote
                                : !repBvnReturnedName
                                  ? "BVN returned name was not recorded on this row."
                                  : "Identity evidence still needs review before final approval."
                            : `BVN ${selectedMerchant.bvn_status || "unverified"} / selfie ${selectedMerchant.selfie_status || "unverified"}`,
                        nextAction: repIdentityVerified ? "No action" : "Review identity evidence",
                      },
                      {
                        label: "Business Registration",
                        badge: !isBusinessPlan ? "not required" : registrySnapshot ? "verified" : selectedMerchant.cac_number ? "pending" : "attention",
                        tone: !isBusinessPlan ? "neutral" : registrySnapshot ? "verified" : selectedMerchant.cac_number ? "pending" : "attention",
                        reason: !isBusinessPlan ? "Not required for this plan." : registrySnapshot ? "CAC snapshot linked to review." : selectedMerchant.cac_number ? "CAC number exists but snapshot is missing." : "CAC number not yet available.",
                        nextAction: !isBusinessPlan ? "No action" : registrySnapshot ? "No action" : "Check CAC snapshot",
                      },
                      {
                        label: "CAC Roster",
                        badge: !isBusinessPlan ? "not required" : rosterCount > 0 ? "verified" : hasMissingSnapshot ? "attention" : "pending",
                        tone: !isBusinessPlan ? "neutral" : rosterCount > 0 ? "verified" : hasMissingSnapshot ? "attention" : "pending",
                        reason: !isBusinessPlan ? "Not required for this plan." : rosterCount > 0 ? `${rosterCount} roster entries available.` : "No roster extracted yet.",
                        nextAction: !isBusinessPlan ? "No action" : rosterCount > 0 ? "Review roster" : "Open roster section",
                      },
                      {
                        label: "Director Approval",
                        badge: !isBusinessPlan ? "not required" : hasRejectedDirectorApproval ? "rejected" : hasDirectorApproval ? "approved" : hasPendingDirectorApproval ? "pending" : "consent required",
                        tone: !isBusinessPlan ? "neutral" : hasRejectedDirectorApproval ? "blocked" : hasDirectorApproval ? "verified" : hasPendingDirectorApproval ? "pending" : "attention",
                        reason: !isBusinessPlan ? "Not required for this plan." : hasRejectedDirectorApproval ? "Director consent was rejected or expired." : hasDirectorApproval ? "Director consent was recorded. Identity evidence is reviewed separately." : hasPendingDirectorApproval ? "Invitation sent but consent is still pending." : "No director invitation or consent record found.",
                        nextAction: !isBusinessPlan ? "No action" : hasDirectorApproval ? "Check identity evidence" : "Review consent status",
                      },
                      {
                        label: "Director Identity Evidence",
                        badge: !isBusinessPlan ? "not required" : directorsLoading ? "loading" : directors.length === 0 ? "missing" : hasDirectorNameMismatch ? "name mismatch" : hasDirectorManualReview ? "manual review" : hasDirectorSandboxWarning ? "sandbox warning" : hasDirectorFailure ? "rejected" : "verified",
                        tone: !isBusinessPlan ? "neutral" : directorsLoading ? "info" : directors.length === 0 ? "attention" : hasDirectorNameMismatch || hasDirectorManualReview ? "blocked" : hasDirectorSandboxWarning ? "pending" : hasDirectorFailure ? "blocked" : "verified",
                        reason: !isBusinessPlan ? "Not required for this plan." : directorsLoading ? "Loading identity evidence." : directors.length === 0 ? "No submitted director identity evidence." : hasDirectorNameMismatch ? "Submitted evidence contains a director name mismatch." : hasDirectorManualReview ? "Submitted evidence is flagged for manual review." : hasDirectorSandboxWarning ? "Submitted evidence includes a sandbox selfie override warning." : `${directors.length} evidence record(s) available.`,
                        nextAction: !isBusinessPlan ? "No action" : directors.length === 0 ? "Check director evidence" : "Review mismatches and overrides",
                      },
                      {
                        label: "Documents",
                        badge: !isBusinessPlan ? "not required" : availableDocumentCount === documentItems.length && documentItems.every((item) => item.statusVal === "verified") ? "verified" : availableDocumentCount > 0 ? "pending" : "attention",
                        tone: !isBusinessPlan ? "neutral" : availableDocumentCount === documentItems.length && documentItems.every((item) => item.statusVal === "verified") ? "verified" : availableDocumentCount > 0 ? "pending" : "attention",
                        reason: !isBusinessPlan ? "Not required for this plan." : `${availableDocumentCount}/${documentItems.length} supporting document(s) submitted.`,
                        nextAction: !isBusinessPlan ? "No action" : availableDocumentCount === documentItems.length ? "Check document statuses" : "Review missing documents",
                      },
                      {
                        label: "Final Admin Review",
                        badge: repIdentityBlocked || (isBusinessPlan && (hasDirectorNameMismatch || hasDirectorManualReview)) ? "blocked" : selectedMerchant.verification_status === "verified" && selectedMerchant.live_features_enabled ? "verified" : effectiveStatus === "pending_admin_review" || !selectedMerchant.live_features_enabled ? "pending" : effectiveStatus,
                        tone: repIdentityBlocked || (isBusinessPlan && (hasDirectorNameMismatch || hasDirectorManualReview)) ? "blocked" : selectedMerchant.verification_status === "verified" && selectedMerchant.live_features_enabled ? "verified" : effectiveStatus === "pending_admin_review" || !selectedMerchant.live_features_enabled ? "info" : effectiveStatus === "requires_reupload" || effectiveStatus === "rejected" ? "blocked" : effectiveStatus === "incomplete" ? "attention" : "pending",
                        reason: repIdentityBlocked || (isBusinessPlan && (hasDirectorNameMismatch || hasDirectorManualReview))
                          ? "Manual review is still required before final admin approval."
                          : !selectedMerchant.live_features_enabled
                            ? "Live features are still locked until compliance review is complete."
                            : `Current queue state: ${effectiveStatus.replace(/_/g, " ")}.`,
                        nextAction: selectedMerchant.verification_status === "verified" && selectedMerchant.live_features_enabled ? "No action" : "Use admin decision controls",
                      },
                    ];

                    return (
                      <div className="grid min-h-0 max-h-[calc(90vh-84px)] grid-cols-1 gap-4 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.95fr)] 2xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.9fr)]">
                        <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm xl:order-1 xl:col-span-2">
                          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                            <div className="min-w-0 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="text-lg font-semibold text-neutral-950 break-words">{selectedMerchant.trading_name || selectedMerchant.business_name}</h4>
                                <Badge variant="outline" className="border-purple-200 bg-purple-50 text-purple-700 font-semibold">{planLabel}</Badge>
                              </div>
                              <p className="text-sm text-neutral-600 break-words whitespace-normal">{mainBlocker}</p>
                              {selectedMerchant.kyc_rejection_reason && (
                                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm">
                                  <p className="text-xs text-red-500 font-semibold mb-1">Previous Rejection / Reupload Reason</p>
                                  <p className="text-red-800 break-words whitespace-normal">{selectedMerchant.kyc_rejection_reason}</p>
                                </div>
                              )}
                            </div>
                            <div className="grid w-full grid-cols-1 gap-2 lg:grid-cols-3 xl:w-auto xl:min-w-[360px]">
                              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 min-w-0">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Review status</p>
                                <div className="mt-2 flex items-center gap-2">
                                  <Badge variant="outline" className={`text-xs capitalize border-2 flex items-center gap-1.5 px-2 py-1 ${statusColor(effectiveStatus)}`}>
                                    {statusIcon(effectiveStatus)}
                                    <span>{effectiveStatus.replace(/_/g, " ")}</span>
                                  </Badge>
                                </div>
                              </div>
                              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 min-w-0">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Live features</p>
                                <p className={`mt-2 text-sm font-semibold ${selectedMerchant.live_features_enabled ? "text-emerald-700" : "text-amber-700"}`}>{selectedMerchant.live_features_enabled ? "Enabled" : "Locked"}</p>
                              </div>
                              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 min-w-0">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Relationship flow</p>
                                <p className="mt-2 text-sm font-semibold capitalize text-neutral-900 break-words whitespace-normal">{selectedMerchant.relationship_claim?.replace(/_/g, " ") || "Not set"}</p>
                              </div>
                            </div>
                          </div>
                        </section>

                        <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm xl:order-10">
                          <div className="mb-3">
                            <h4 className="text-sm font-semibold text-neutral-900">Merchant &amp; Plan Information</h4>
                            <p className="text-xs text-neutral-500">Core merchant profile details used during first-pass review.</p>
                          </div>
                          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2 2xl:grid-cols-3">
                            <div className="rounded-xl bg-neutral-50 p-3 min-w-0">
                              <p className="text-neutral-400 text-xs mb-1">Email</p>
                              <p className="font-medium text-neutral-900 break-all whitespace-normal" title={selectedMerchant.email}>{selectedMerchant.email}</p>
                            </div>
                            <div className="rounded-xl bg-neutral-50 p-3 min-w-0">
                              <p className="text-neutral-400 text-xs mb-1">Phone</p>
                              <p className={`font-semibold break-words whitespace-normal ${selectedMerchant.phone ? "text-neutral-900" : "text-red-600"}`}>{selectedMerchant.phone || "Not provided"}</p>
                            </div>
                            <div className="rounded-xl bg-neutral-50 p-3 min-w-0">
                              <p className="text-neutral-400 text-xs mb-1">Plan</p>
                              <p className="font-semibold text-neutral-900">{planLabel}</p>
                            </div>
                            <div className="rounded-xl bg-neutral-50 p-3 min-w-0 lg:col-span-2 xl:col-span-1">
                              <p className="text-neutral-400 text-xs mb-1">Owner / Director (BVN match)</p>
                              <p className={`font-semibold break-words whitespace-normal ${selectedMerchant.owner_name ? "text-neutral-900" : "text-red-600"}`}>{selectedMerchant.owner_name || "Not provided"}</p>
                            </div>
                            <div className="rounded-xl bg-neutral-50 p-3 min-w-0">
                              <p className="text-neutral-400 text-xs mb-1">Setup mode</p>
                              <p className="font-semibold text-neutral-900">{selectedMerchant.setup_mode ? "Yes" : "No"}</p>
                            </div>
                            <div className="rounded-xl bg-neutral-50 p-3 min-w-0">
                              <p className="text-neutral-400 text-xs mb-1">Live features</p>
                              <p className={`font-semibold ${selectedMerchant.live_features_enabled ? "text-emerald-700" : "text-amber-700"}`}>{selectedMerchant.live_features_enabled ? "Enabled" : "Locked"}</p>
                            </div>
                            <div className="rounded-xl bg-neutral-50 p-3 min-w-0 lg:col-span-2 xl:col-span-3">
                              <p className="text-neutral-400 text-xs mb-1">Business Address</p>
                              <p className={`font-medium break-words whitespace-normal ${businessAddress ? "text-neutral-900" : "text-red-600"}`}>{businessAddress || "Not provided"}</p>
                            </div>
                          </div>
                        </section>

                        <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm xl:order-2">
                          <div className="mb-3">
                            <h4 className="text-sm font-semibold text-neutral-900">Verification Status Checklist</h4>
                            <p className="text-xs text-neutral-500">Display-only checkpoints built from the current review state.</p>
                          </div>
                          <div className="space-y-2">
                            {checklistItems.map((item) => (
                              <div key={item.label} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="text-sm font-semibold text-neutral-900">{item.label}</p>
                                      <Badge variant="outline" className={`text-[10px] uppercase ${reviewToneClass(item.tone)}`}>{item.badge.replace(/_/g, " ")}</Badge>
                                    </div>
                                    <p className="mt-1 text-xs text-neutral-600 break-words whitespace-normal">{item.reason}</p>
                                  </div>
                                  <p className="text-xs font-medium text-neutral-500 break-words whitespace-normal">Next: {item.nextAction}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>

                        <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm xl:order-3">
                          <div className="mb-3">
                            <h4 className="text-sm font-semibold text-neutral-900">Admin Decision</h4>
                            <p className="text-xs text-neutral-500">Manual approval requires compliance responsibility and will be audit-logged.</p>
                          </div>

                          <div className="space-y-4">
                            {showIdentityManualReviewPanel && (
                              <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
                                <div>
                                  <h5 className="text-sm font-semibold text-red-900">Identity Manual Review Required</h5>
                                  <p className="mt-1 text-xs text-red-800">The submitted name does not match the BVN returned name. Clean approval is blocked until this is resolved.</p>
                                </div>
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs text-red-900">
                                  <p className="break-words whitespace-normal"><span className="font-semibold">Submitted name:</span> {repSubmittedName || "Not available"}</p>
                                  <p className="break-words whitespace-normal"><span className="font-semibold">BVN returned name:</span> {repBvnReturnedName || "Not recorded"}</p>
                                  <p className="break-words whitespace-normal"><span className="font-semibold">Provider:</span> {formattedRepProvider}</p>
                                  <p className="break-all whitespace-normal"><span className="font-semibold">Reference:</span> {repProviderRef}</p>
                                  <p className="break-words whitespace-normal"><span className="font-semibold">Name match:</span> {repNameMatchStatus}</p>
                                  <p className="break-words whitespace-normal"><span className="font-semibold">Selfie confidence / threshold:</span> {repProviderConfidence ?? "N/A"}% / {repProviderThreshold ?? "N/A"}%</p>
                                </div>
                                {repSelfieMatchBypassed && (
                                  <p className="text-xs font-medium text-amber-800">Sandbox override warning: selfie confidence was below the provider threshold and requires manual review.</p>
                                )}
                                <p className="text-xs text-red-800">Ask the user to re-verify with a BVN matching the submitted legal name, or update the submitted legal name if it is incorrect.</p>
                                <div className="flex flex-wrap gap-2">
                                  <Button type="button" variant="outline" className="border-orange-300 text-orange-700 hover:bg-orange-50 text-xs h-9" onClick={() => { setActionMode("reupload"); setActionReason("Re-verify with a BVN matching your submitted legal name, or update your submitted legal name if it is incorrect."); setReuploadFields(["bvn_status", "selfie_status"]); }}>
                                    <UploadCloud className="h-3.5 w-3.5 mr-1" />Request correction / re-verification
                                  </Button>
                                  <Button type="button" variant="destructive" className="text-xs h-9" onClick={() => { setActionMode("reject"); setActionReason("Identity verification rejected because the submitted legal name does not match the BVN returned name."); }}>
                                    <XCircle className="h-3.5 w-3.5 mr-1" />Reject identity verification
                                  </Button>
                                </div>
                                <p className="text-[11px] text-red-700">No individual identity manual-override action is available on this page yet. Use Reupload or Reject to resolve the mismatch safely.</p>
                              </div>
                            )}

                            <div className="space-y-1.5">
                              <Label className="text-sm font-medium">Review Notes (optional)</Label>
                              <Textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} placeholder="Add notes about this document review..." className="min-h-[56px] text-sm" />
                            </div>

                            {(actionMode === "reject" || actionMode === "reupload") && (
                              <div className={`space-y-3 rounded-xl p-3 border ${actionMode === "reject" ? "bg-red-50 border-red-200" : "bg-orange-50 border-orange-200"}`}>
                                <div>
                                  <Label className={`text-sm font-semibold ${actionMode === "reject" ? "text-red-800" : "text-orange-800"}`}>{actionMode === "reject" ? "Rejection Reason (required)" : "Documents needed (required)"}</Label>
                                  <Textarea
                                    value={actionReason}
                                    onChange={e => setActionReason(e.target.value)}
                                    placeholder={actionMode === "reject" ? "Explain why verification is being rejected..." : "Example: Re-upload clearer utility bill and retake selfie in good lighting."}
                                    className={`min-h-[80px] bg-white text-sm ${actionMode === "reject" ? "border-red-300" : "border-orange-300"}`}
                                  />
                                  {actionMode === "reject" && actionReason.trim().length > 0 && actionReason.trim().length < 10 && <p className="text-xs text-red-600 mt-1">Reason must be at least 10 characters.</p>}
                                </div>

                                {actionMode === "reupload" && (
                                  <div className="space-y-2">
                                    <p className="text-xs font-semibold text-orange-900">Mark affected checks</p>
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                      {reuploadOptions.map((option) => (
                                        <label key={option.field} className={`flex items-start gap-2 rounded-lg border p-2 cursor-pointer transition-colors ${reuploadFields.includes(option.field) ? "bg-white border-orange-400" : "bg-orange-50/50 border-orange-200 hover:bg-white"}`}>
                                          <input type="checkbox" checked={reuploadFields.includes(option.field)} onChange={() => toggleReuploadField(option.field)} className="mt-0.5 h-4 w-4 accent-orange-600" />
                                          <span>
                                            <span className="block text-xs font-bold text-neutral-900">{option.label}</span>
                                            <span className="block text-[11px] leading-snug text-neutral-500">{option.description}</span>
                                          </span>
                                        </label>
                                      ))}
                                    </div>
                                    <p className="text-[11px] text-orange-700">Selected checks will be marked rejected and live payment collection will stay locked until the merchant fixes them.</p>
                                  </div>
                                )}
                              </div>
                            )}

                            {actionMode === "reset" && (
                              <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4 flex gap-3 items-start">
                                <ShieldAlert className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                                <div>
                                  <h4 className="text-sm font-bold text-red-900 mb-1">Danger: Full KYC Reset</h4>
                                  <p className="text-xs text-red-700 leading-relaxed">This action clears the active BVN, selfie, CAC, utility, and authority statuses and returns the merchant to setup mode. Historical logs and previous file references stay in the audit trail.</p>
                                  <p className="text-xs text-red-800 font-semibold mt-2">Use this only when the merchant needs a clean verification restart.</p>
                                </div>
                              </div>
                            )}

                            {reviewError && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-medium border border-red-100">{reviewError}</div>}
                            {actionSuccess && <div className="bg-emerald-50 text-emerald-700 p-3 rounded-lg text-sm font-medium border border-emerald-100">{actionSuccess}</div>}
                            {approveDisabledReason && actionMode === "idle" && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">{approveDisabledReason}</div>}

                            <div className="border-t pt-4">
                              {actionMode === "idle" ? (
                                <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-4">
                                  <Button className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-9"
                                    disabled={isApproveDisabled}
                                    onClick={handleApprove}>
                                    <CheckCircle className="h-3.5 w-3.5 mr-1" />{actionLoading ? "..." : "Approve"}
                                  </Button>
                                  <Button variant="destructive" className="text-xs h-9" disabled={actionLoading || selectedMerchant.verification_status === "rejected"} onClick={() => { setActionMode("reject"); setActionReason(""); }}>
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
                                <div className="flex flex-wrap gap-2">
                                  <Button variant="outline" className="text-xs h-9" onClick={() => { setActionMode("idle"); setActionReason(""); setReuploadFields([]); }}>Cancel</Button>
                                  {actionMode === "reject" && <Button variant="destructive" className="text-xs h-9" disabled={actionLoading || actionReason.trim().length < 10} onClick={handleReject}>{actionLoading ? "Rejecting..." : "Confirm Reject"}</Button>}
                                  {actionMode === "reupload" && <Button className="bg-orange-600 hover:bg-orange-700 text-white text-xs h-9" disabled={actionLoading || actionReason.trim().length < 5} onClick={handleReupload}>{actionLoading ? "Sending..." : "Request Reupload"}</Button>}
                                  {actionMode === "reset" && <Button variant="destructive" className="text-xs h-9" disabled={actionLoading} onClick={handleReset}><RotateCcw className="h-3.5 w-3.5 mr-1" /> {actionLoading ? "Resetting..." : "Yes, Force Reset"}</Button>}
                                </div>
                              )}
                            </div>
                          </div>
                        </section>

                        <details className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm xl:order-6" open={repProviderUnknown || (isBusinessPlan && (formattedCacProvider.toLowerCase() === "unknown" || hasUnknownDirectorProvider))}>
                          <summary className="cursor-pointer list-none">
                            <span className="flex items-center justify-between gap-3">
                              <span>
                                <span className="block text-sm font-semibold text-neutral-900">Provider Evidence Summary</span>
                                <span className="block text-xs text-neutral-500">Read-only provider trace from the current evidence already loaded on the page.</span>
                              </span>
                              <span className="text-[10px] font-medium text-neutral-500">Collapsed by default</span>
                            </span>
                          </summary>
                          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                            {[ 
                              { label: "Current active provider", value: activeProvider, note: "System default", tone: "info" as const },
                              { label: isBusinessPlan ? "Representative evidence provider" : "Individual identity evidence provider", value: formattedRepProvider, note: repProviderUnknown ? "Unknown provider" : isHistoricalRepProvider ? "Historical evidence" : "Current evidence", tone: repProviderUnknown ? "blocked" as const : isHistoricalRepProvider ? "pending" as const : "neutral" as const },
                              { label: "CAC evidence provider", value: !isBusinessPlan ? "Not required" : formattedCacProvider, note: !isBusinessPlan ? "Not required for this plan" : formattedCacProvider.toLowerCase() === "unknown" ? "Unknown provider" : isHistoricalCacProvider ? "Historical evidence" : "Current evidence", tone: !isBusinessPlan ? "neutral" as const : formattedCacProvider.toLowerCase() === "unknown" ? "blocked" as const : isHistoricalCacProvider ? "pending" as const : "neutral" as const },
                              { label: "Director identity evidence provider", value: !isBusinessPlan ? "Not required" : formattedDirectorProviders.length > 0 ? formattedDirectorProviders.join(", ") : "No evidence yet", note: !isBusinessPlan ? "Not required for this plan" : hasUnknownDirectorProvider ? "Unknown provider present" : hasHistoricalDirectorProvider ? "Historical evidence present" : "Current evidence", tone: !isBusinessPlan ? "neutral" as const : hasUnknownDirectorProvider ? "blocked" as const : hasHistoricalDirectorProvider ? "pending" as const : "neutral" as const },
                            ].map((provider) => (
                              <div key={provider.label} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 min-w-0">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{provider.label}</p>
                                <p className="mt-2 text-sm font-semibold text-neutral-900 break-words whitespace-normal capitalize" title={provider.value}>{provider.value}</p>
                                <Badge variant="outline" className={`mt-2 text-[10px] ${reviewToneClass(provider.tone)}`}>{provider.note}</Badge>
                              </div>
                            ))}
                          </div>
                        </details>

                        {isBusinessPlan && (
                        <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm xl:order-7">
                          <div className="mb-3">
                            <h4 className="text-sm font-semibold text-neutral-900">Business Registration &amp; CAC Snapshot</h4>
                            <p className="text-xs text-neutral-500">Business registration state, provider evidence, and the saved CAC snapshot used for downstream review.</p>
                          </div>
                          {hasMissingSnapshot && (
                            <div className="mb-3 rounded-xl border border-dashed border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 font-semibold">CAC number exists, but registry snapshot was not found. Re-run CAC lookup or repair snapshot link.</div>
                          )}
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            {[
                              { label: "CAC / RC number", value: selectedMerchant.cac_number || "-", tone: selectedMerchant.cac_number ? "neutral" as const : "attention" as const },
                              { label: "CAC verification status", value: selectedMerchant.cac_status || "unverified", tone: selectedMerchant.cac_status === "verified" ? "verified" as const : selectedMerchant.cac_status === "pending" ? "pending" as const : "attention" as const },
                              { label: "Provider", value: formattedCacProvider, tone: formattedCacProvider.toLowerCase() === "unknown" ? "blocked" as const : isHistoricalCacProvider ? "pending" as const : "neutral" as const },
                              { label: "Provider reference", value: cacProviderRef, tone: cacProviderRef === "Not submitted" ? "attention" as const : "neutral" as const },
                            ].map((item) => (
                              <div key={item.label} className="rounded-xl border border-purple-100 bg-purple-50/60 p-3 min-w-0">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-purple-500">{item.label}</p>
                                <p className="mt-2 text-sm font-semibold text-neutral-900 break-words whitespace-normal">{item.value}</p>
                                <Badge variant="outline" className={`mt-2 text-[10px] capitalize ${reviewToneClass(item.tone)}`}>{item.value === "-" ? "missing" : item.tone === "neutral" ? "info" : item.tone}</Badge>
                              </div>
                            ))}
                          </div>
                          <details className="mt-3 rounded-xl border border-purple-100 bg-purple-50/30 p-3">
                            <summary className="cursor-pointer list-none font-semibold text-sm text-purple-900">
                              <span className="flex items-center justify-between gap-3">
                                <span>CAC snapshot details</span>
                                <span className="text-[10px] font-medium text-purple-600">Collapsed by default</span>
                              </span>
                            </summary>
                            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                            {[
                              { label: "Setup mode", value: selectedMerchant.setup_mode ? "Yes" : "No" },
                              { label: "Live features", value: selectedMerchant.live_features_enabled ? "Enabled" : "Locked" },
                              { label: "Relationship", value: selectedMerchant.relationship_claim?.replace(/_/g, " ") || "not set" },
                              { label: "Affiliation", value: selectedMerchant.business_affiliation_status?.replace(/_/g, " ") || "not started" },
                            ].map((item) => (
                              <div key={item.label} className="rounded-xl border border-purple-100 bg-white p-3 min-w-0">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-purple-500">{item.label}</p>
                                <p className="mt-2 text-sm font-semibold text-neutral-900 break-words whitespace-normal capitalize">{item.value}</p>
                              </div>
                            ))}
                            </div>

                          {registrySnapshot ? (
                            <div className="mt-3 rounded-xl border border-purple-100 bg-white p-4 space-y-3">
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold text-neutral-900">Saved business registry snapshot</p>
                                  <p className="mt-1 text-xs text-emerald-600 font-semibold flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Registry snapshot saved from CAC verification.</p>
                                  <p className="mt-1 text-xs text-neutral-500 break-words whitespace-normal">{registrySnapshot.registered_name || "-"} - {registrySnapshot.registration_number || "-"}</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant="outline" className="text-[10px] uppercase break-all max-w-full">{registrySnapshot.provider_name || formattedCacProvider}</Badge>
                                  <Badge variant="outline" className="text-[10px] uppercase break-all max-w-full">{snapshotSource}</Badge>
                                </div>
                              </div>
                              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Snapshot status / source</p>
                                  <p className="mt-2 text-sm font-semibold text-neutral-900">Saved and linked</p>
                                  <p className="mt-1 text-xs text-neutral-500 break-words whitespace-normal">Source: {snapshotSource}</p>
                                </div>
                                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Evidence timestamp</p>
                                  <p className="mt-2 text-sm font-semibold text-neutral-900 break-words whitespace-normal">{cacEvidenceTimestamp ? new Date(cacEvidenceTimestamp).toLocaleString() : "Not available"}</p>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-3 rounded-xl border border-dashed border-purple-100 bg-neutral-50 p-3 text-sm text-neutral-600">No saved registry snapshot yet. RC/CAC lookup must run before affiliation matching or director approval.</div>
                          )}
                          </details>
                        </section>
                        )}

                        {isBusinessPlan && (
                        <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm xl:order-11 xl:col-span-2">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h4 className="text-sm font-semibold text-neutral-900">CAC Business Directors &amp; KYB Roster</h4>
                                  <Badge className="bg-[#E9D5FF] text-[#6F2CFF] text-[10px] font-extrabold border-0">{rosterCount} Listed</Badge>
                                </div>
                                <p className="text-xs text-neutral-500">Registry-linked roster for CAC business review.</p>
                              </div>
                              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setDirectorsExpanded(!directorsExpanded)} disabled={!registrySnapshot || rosterCount === 0}>
                                {directorsExpanded ? "Hide roster" : "View roster"}
                                {directorsExpanded ? <ChevronUp className="ml-2 h-4 w-4" /> : <ChevronDown className="ml-2 h-4 w-4" />}
                              </Button>
                            </div>

                            {!registrySnapshot ? (
                              <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600">Roster becomes available after a linked registry snapshot is present.</div>
                            ) : rosterCount === 0 ? (
                              <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600 flex items-center gap-2"><Info className="h-4 w-4 text-neutral-400" /><span>No key personnel found in the saved registry snapshot.</span></div>
                            ) : directorsExpanded ? (
                              <div className="mt-3 space-y-3">
                                <div className="grid grid-cols-1 gap-3 sm:hidden">
                                  {roster.map((person: any, idx: number) => (
                                    <div key={idx} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 space-y-2">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="text-sm font-semibold text-neutral-900 break-words whitespace-normal">{person.name}</p>
                                        <Badge variant="outline" className="text-[9px] uppercase">{person.isCorporate ? "Corporate/Business Entity" : "Person"}</Badge>
                                      </div>
                                      <p className="text-xs text-neutral-600 break-words whitespace-normal">Role: {String(person.designation || person.role || "Director").replace(/_/g, " ")}</p>
                                      {person.nationality && <p className="text-xs text-neutral-600 break-words whitespace-normal">Nationality: {person.nationality}</p>}
                                      {person.status && <p className="text-xs text-neutral-600 break-words whitespace-normal">Status: {person.status}</p>}
                                      {person.address && <p className="text-xs text-neutral-500 break-words whitespace-normal">Address: {person.address}</p>}
                                    </div>
                                  ))}
                                </div>
                                <div className="hidden sm:block overflow-x-auto">
                                  <table className="min-w-full text-sm">
                                    <thead>
                                      <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                                        <th className="py-2 pr-4 font-semibold">Name</th>
                                        <th className="py-2 pr-4 font-semibold">Role</th>
                                        <th className="py-2 pr-4 font-semibold">Type</th>
                                        <th className="py-2 pr-4 font-semibold">Nationality</th>
                                        <th className="py-2 font-semibold">Status / Address</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {roster.map((person: any, idx: number) => (
                                        <tr key={idx} className="border-b border-neutral-100 align-top last:border-b-0">
                                          <td className="py-3 pr-4 font-medium text-neutral-900 break-words whitespace-normal">{person.name}</td>
                                          <td className="py-3 pr-4 text-neutral-700 break-words whitespace-normal">{String(person.designation || person.role || "Director").replace(/_/g, " ")}</td>
                                          <td className="py-3 pr-4 text-neutral-700">{person.isCorporate ? "Corporate/Business Entity" : "Person"}</td>
                                          <td className="py-3 pr-4 text-neutral-700 break-words whitespace-normal">{person.nationality || "-"}</td>
                                          <td className="py-3 text-neutral-700 break-words whitespace-normal">
                                            <p>{person.status || "-"}</p>
                                            {person.address && <p className="mt-1 text-xs text-neutral-500">{person.address}</p>}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            ) : null}
                          </section>
                        )}

                        <details className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm xl:order-8" open={repSelfieMatchBypassed || repProviderUnknown || repIdentityBlocked}>
                          <summary className="cursor-pointer list-none">
                            <span className="flex items-center justify-between gap-3">
                              <span>
                                <span className="block text-sm font-semibold text-blue-950">{identitySectionLabel}</span>
                                <span className="block text-xs text-blue-700">{isBusinessPlan ? "Representative-only identity evidence, separate from director identity review." : "Individual identity evidence and provider traceability review."}</span>
                              </span>
                              <span className="text-[10px] font-medium text-blue-700">Details collapsed by default</span>
                            </span>
                          </summary>
                          <div className="mt-3 space-y-2.5">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div className="min-w-0 max-w-full">
                                <p className="font-semibold text-blue-900 text-sm break-words whitespace-normal">{formattedRepProvider} BVN + Selfie Check</p>
                                <p className="text-xs text-blue-600 mt-0.5 break-all whitespace-normal" title={repProviderRef}>Ref: {repProviderRef}</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className="border-blue-200 bg-white text-blue-700 font-bold">Score: {repMatchScore !== null && repMatchScore !== undefined ? `${repMatchScore}%` : "N/A"}</Badge>
                                {isHistoricalRepProvider && <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200 text-[9px] uppercase font-bold">Historical {formattedRepProvider} Evidence</Badge>}
                              </div>
                            </div>

                            <div className="rounded-xl border border-blue-100 bg-white/70 p-3 text-[11px] text-blue-800">
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-1.5"><Info className="h-3 w-3 flex-shrink-0" /><span>Current active provider: <span className="font-semibold capitalize">{activeProvider}</span></span></div>
                                <div>
                                  <span>Evidence provider: <span className="font-semibold capitalize">{formattedRepProvider}</span></span>
                                  {repProviderUnknown && <span className="ml-1 font-bold text-red-600">(Warning: Provider is Unknown!)</span>}
                                </div>
                                {repProviderNote && <div className="text-amber-700 font-medium break-words whitespace-normal">{repProviderNote}</div>}
                              </div>
                            </div>

                            <div className="rounded-xl border border-blue-100 bg-white p-3 text-xs text-blue-900 font-mono space-y-2">
                              {repNameMismatch && (
                                <div className="rounded bg-amber-50 border border-amber-200 p-2 text-[11px] text-amber-800 flex items-start gap-1.5 font-sans">
                                  <ShieldAlert className="h-3.5 w-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                                  <div>
                                    <p className="font-bold">Representative Name Mismatch</p>
                                    <p>Submitted name: {repSubmittedName || "Not available"}</p>
                                    <p>BVN returned name: {repBvnReturnedName || "Not available"}</p>
                                    <p>Name match: {repNameMatchStatus}</p>
                                  </div>
                                </div>
                              )}
                              <div className="break-words whitespace-normal"><span className="font-semibold">BVN returned name:</span> {repBvnReturnedName || "Not recorded"}</div>
                              <div className="break-words whitespace-normal"><span className="font-semibold">Submitted name:</span> {repSubmittedName || "Not available"}</div>
                              <div className="break-words whitespace-normal"><span className="font-semibold">Name match:</span> {repNameMatchStatus}</div>
                              <div className="flex flex-col gap-y-1 break-words whitespace-normal lg:flex-row lg:flex-wrap lg:gap-x-4">
                                <span>BVN: {selectedMerchant.bvn || "-"} ({selectedMerchant.bvn_status || "unverified"})</span>
                                <span>Selfie: {selectedMerchant.selfie_url ? "Submitted" : "Missing"} ({selectedMerchant.selfie_status || "unverified"})</span>
                              </div>
                              {repSelfieMatchBypassed && (
                                <div className="rounded bg-amber-50 border border-amber-200 p-2 text-[11px] text-amber-800 flex items-start gap-1.5 font-sans">
                                  <ShieldAlert className="h-3.5 w-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                                  <div>
                                    <p className="font-bold">Sandbox Override - Selfie Threshold Not Met</p>
                                    <p>Confidence: {repProviderConfidence}% / Threshold: {repProviderThreshold}%</p>
                                    <p className="mt-0.5">Sandbox override accepted this verification. In production this would be flagged.</p>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </details>

                        {isBusinessPlan && (
                        <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm xl:order-5">
                            <div className="mb-3">
                              <h4 className="text-sm font-semibold text-neutral-900">Director Approval Status</h4>
                              <p className="text-xs text-neutral-500">Invitation and consent status only. Identity evidence is reviewed separately below.</p>
                            </div>
                            {hasDirectorApproval && (
                              <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">Director consent was recorded. Identity evidence is reviewed separately.</div>
                            )}
                            {directorInvitations.length === 0 ? (
                              <div className="text-sm text-neutral-500 bg-neutral-50 rounded-xl p-3 border border-neutral-200">No director invitation sent or approval status found.</div>
                            ) : (
                              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                                {directorInvitations.map((invite) => (
                                  <div key={invite.id} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 space-y-2 min-w-0">
                                    <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                                      <div className="min-w-0 max-w-full">
                                        <p className="font-semibold text-neutral-900 break-words whitespace-normal">{invite.selected_director_name}</p>
                                        <p className="text-xs text-neutral-500 break-all whitespace-normal" title={invite.director_email || "-"}>{invite.director_email || "-"}</p>
                                      </div>
                                      <Badge variant="outline" className={`text-[10px] capitalize font-bold ${invite.status === "approved" || invite.status === "verified" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : invite.status === "sent" || invite.status === "opened" || invite.status === "pending" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-red-50 text-red-700 border-red-200"}`}>{invite.status === "approved" || invite.status === "verified" ? "Consent received" : invite.status === "sent" || invite.status === "opened" || invite.status === "pending" ? "Pending" : invite.status === "rejected" || invite.status === "declined" || invite.status === "expired" || invite.status === "failed" ? "Rejected" : invite.status || "unknown"}</Badge>
                                    </div>
                                    <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 text-xs text-neutral-600">
                                      <p className="break-words whitespace-normal">Sent: {invite.sent_at || invite.created_at ? new Date(invite.sent_at || invite.created_at || "").toLocaleString() : "-"}</p>
                                      <p className="break-words whitespace-normal">Approved: {invite.approved_at ? new Date(invite.approved_at).toLocaleString() : "-"}</p>
                                      <p className="break-words whitespace-normal capitalize">Affiliation: {selectedMerchant.business_affiliation_status?.replace(/_/g, " ") || "-"}</p>
                                      <p className="break-words whitespace-normal">Registry role: {invite.registry_role || "-"}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </section>
                        )}

                        {isBusinessPlan && (
                          <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm xl:order-4">
                            <div className="mb-3">
                              <h4 className="text-sm font-semibold text-neutral-900">Director Identity Evidence</h4>
                              <p className="text-xs text-neutral-500">Identity review for invited directors, including mismatch and sandbox warnings.</p>
                            </div>

                            {selectedMerchant.business_affiliation_status === "director_approved" && directors.length === 0 && !directorsLoading && (
                              <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 font-semibold flex items-start gap-2"><ShieldAlert className="h-4 w-4 text-amber-600 flex-shrink-0" />Director approval exists, but director identity verification evidence was not found.</div>
                            )}

                            {directorsLoading ? (
                              <div className="py-6 flex flex-col items-center justify-center gap-2 text-neutral-400 text-xs"><Loader className="h-5 w-5 animate-spin text-blue-600" /><span>Loading director identity evidence...</span></div>
                            ) : directors.length === 0 ? (
                              <div className="py-4 text-center text-xs text-neutral-400 flex items-center justify-center gap-2 bg-neutral-50 rounded-xl border border-neutral-200"><Info className="h-4 w-4 text-neutral-300" /><span>No director identity verification evidence has been submitted yet.</span></div>
                            ) : (
                              <div className="space-y-3">
                                {directors.map((dir) => {
                                  const normResp = dir.normalized_response as Record<string, unknown> | null;
                                  const sandboxOverride = normResp?.deraLedgerSandboxOverride as Record<string, unknown> | null;
                                  const bvnData = normResp?.data as Record<string, unknown> | null;
                                  const bvnFirstName = String(bvnData?.firstName || "").trim();
                                  const bvnLastName = String(bvnData?.lastName || "").trim();
                                  const bvnNameOnCard = String(bvnData?.nameOnCard || "").trim();
                                  const bvnReturnedName = [bvnFirstName, bvnLastName].filter(Boolean).join(" ") || bvnNameOnCard || null;
                                  const invitedName = String(dir.director_name || "").toUpperCase().trim();
                                  const bvnNormalized = bvnReturnedName?.toUpperCase().trim() || "";
                                  const invitedTokens = invitedName.split(/\s+/).filter(t => t.length > 2);
                                  const bvnTokens = bvnNormalized.split(/\s+/).filter(t => t.length > 2);
                                  const matchingTokens = invitedTokens.filter(t => bvnTokens.includes(t));
                                  const requiredMatches = Math.min(2, invitedTokens.length);
                                  const isNameMatched = matchingTokens.length >= requiredMatches;
                                  const nameMismatch = bvnReturnedName !== null && !isNameMatched;
                                  const providerMatch = sandboxOverride ? (sandboxOverride.providerMatch as boolean) : true;
                                  const providerConfidence = sandboxOverride?.providerConfidenceLevel as number | null ?? dir.face_match_score;
                                  const providerThreshold = sandboxOverride?.providerThreshold as number | null;
                                  const selfieMatchBypassed = sandboxOverride?.selfieMatchBypassed as boolean ?? false;
                                  const linkedInvite = directorInvitations.find(inv => inv.id === dir.invitation_id) || directorInvitations.find(inv => inv.selected_director_name?.toUpperCase() === invitedName);
                                  const dirProviderRaw = dir.provider_name || "Unknown";
                                  const formattedDirProvider = dirProviderRaw.charAt(0).toUpperCase() + dirProviderRaw.slice(1).toLowerCase();
                                  const isHistoricalDirProvider = activeProvider.toLowerCase() !== dirProviderRaw.toLowerCase() && dirProviderRaw.toLowerCase() !== "unknown";

                                  return (
                                    <div key={dir.id} className="bg-neutral-50 border border-neutral-200 rounded-xl p-3 space-y-3 min-w-0">
                                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                        <div className="space-y-1 min-w-0">
                                          <h5 className="font-semibold text-sm text-neutral-900 flex flex-wrap items-center gap-1.5">
                                            <span className="break-words whitespace-normal">{dir.director_name}</span>
                                            <span className="text-[10px] bg-neutral-100 text-neutral-600 px-1.5 py-0.5 rounded capitalize font-medium">{dir.director_role?.replace(/_/g, " ")}</span>
                                          </h5>
                                          {linkedInvite ? (
                                            <p className="text-[10px] text-neutral-500 break-all whitespace-normal" title={`${linkedInvite.director_email || ""} (${linkedInvite.status || ""})`}>Linked to invite: {linkedInvite.director_email} ({linkedInvite.status})</p>
                                          ) : (
                                            <p className="text-[10px] text-red-500 font-semibold break-words whitespace-normal">No linked invitation found for this director.</p>
                                          )}
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2">
                                          <Badge variant="outline" className={`text-[10px] font-bold border-2 capitalize ${dir.verification_status === "verified" && !nameMismatch ? "bg-emerald-50 text-emerald-700 border-emerald-200" : dir.verification_status === "failed" ? "bg-red-50 text-red-700 border-red-200" : nameMismatch ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>{nameMismatch ? "Name Mismatch" : dir.verification_status?.replace(/_/g, " ")}</Badge>
                                          {dir.manual_review_required && <Badge variant="outline" className="text-[10px] border-amber-200 bg-amber-50 text-amber-800">Manual review required</Badge>}
                                        </div>
                                      </div>

                                      {nameMismatch && bvnReturnedName && (
                                        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-800 flex items-start gap-2">
                                          <ShieldAlert className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                                          <div>
                                            <p className="font-bold mb-1">Director Identity Name Mismatch</p>
                                            <p>Invited director: <span className="font-semibold text-neutral-900">{dir.director_name}</span></p>
                                            <p>BVN returned name: <span className="font-semibold text-neutral-950">{bvnReturnedName}</span></p>
                                            <p className="mt-1 text-red-700 font-medium">Director identity evidence found, but it does not match the invited director.</p>
                                          </div>
                                        </div>
                                      )}

                                      {dir.manual_review_required && (
                                        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 flex items-start gap-2">
                                          <ShieldAlert className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                                          <div>
                                            <p className="font-bold mb-1">Manual Review Required</p>
                                            <p>This director evidence already carries a manual-review-required flag and should be checked carefully before any override.</p>
                                          </div>
                                        </div>
                                      )}

                                      {selfieMatchBypassed && (
                                        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 flex items-start gap-2">
                                          <ShieldAlert className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                                          <div>
                                            <p className="font-bold mb-1">Sandbox Override - Selfie Threshold Not Met</p>
                                            <p>Match: <span className="font-semibold text-red-700">{providerMatch ? "Passed" : "Failed"}</span></p>
                                            <p>Confidence: {providerConfidence}% / Threshold: {providerThreshold}%</p>
                                            <p className="mt-1">Sandbox override accepted this verification. In production this would be rejected or flagged.</p>
                                          </div>
                                        </div>
                                      )}

                                      <div className="rounded-lg bg-white border border-neutral-100 p-3 text-xs text-neutral-600 space-y-2">
                                        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-3">
                                          <p className="break-all whitespace-normal" title={dir.masked_bvn || "-"}><span className="font-semibold text-neutral-500">BVN:</span> {dir.masked_bvn || "-"}</p>
                                          <p className="break-words whitespace-normal"><span className="font-semibold text-neutral-500">Provider:</span> {formattedDirProvider} {dirProviderRaw.toLowerCase() === "unknown" && <span className="text-red-600 font-bold">(Warning: Provider is Unknown!)</span>}</p>
                                          <p className="break-all whitespace-normal" title={dir.verification_id || dir.id.split("-")[0]}><span className="font-semibold text-neutral-500">Reference:</span> {dir.verification_id || dir.id.split("-")[0]}</p>
                                          <p className="break-words whitespace-normal"><span className="font-semibold text-neutral-500">BVN name returned:</span> <span className={nameMismatch ? "text-red-600 font-semibold" : "text-neutral-800"}>{bvnReturnedName || "-"}</span></p>
                                          <p className="break-words whitespace-normal"><span className="font-semibold text-neutral-500">Selfie:</span> {selfieMatchBypassed ? "Sandbox accepted" : dir.selfie_url ? "Submitted" : "Missing"}</p>
                                          <p className="break-words whitespace-normal"><span className="font-semibold text-neutral-500">Confidence:</span> {providerConfidence ?? "N/A"}{providerThreshold !== null && providerThreshold !== undefined ? ` / Threshold ${providerThreshold}%` : ""}</p>
                                        </div>
                                        {isHistoricalDirProvider && <div className="text-[10px] text-amber-700 font-semibold">Historical {formattedDirProvider} evidence</div>}
                                        {dir.created_at && <div className="text-[11px] text-neutral-500 break-words whitespace-normal">Verified at: {new Date(dir.created_at).toLocaleString()}</div>}
                                      </div>

                                      {dir.selfie_url && (
                                        <button type="button" onClick={() => dir.selfie_url && handleViewDocument(dir.selfie_url)} className="text-xs text-blue-600 hover:underline flex items-center gap-1 font-semibold break-words whitespace-normal text-left">
                                          View Selfie <ExternalLink className="h-3 w-3" />
                                        </button>
                                      )}

                                      {(dir.verification_status !== "verified" || nameMismatch) && (
                                        <div className="bg-white rounded-lg p-3 border border-neutral-200 space-y-2">
                                          <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider block">Manual Override Action</span>
                                          <div className="flex flex-col gap-2 sm:flex-row">
                                            <input
                                              type="text"
                                              placeholder="Reason or notes for manual override..."
                                              value={directorNotes[dir.id] || ""}
                                              onChange={(e) => setDirectorNotes({ ...directorNotes, [dir.id]: e.target.value })}
                                              className="w-full text-xs rounded border border-neutral-300 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#7B2FF7] bg-white text-neutral-800"
                                            />
                                            <div className="flex flex-wrap gap-2">
                                              <Button type="button" size="sm" onClick={() => handleApproveDirector(dir.id, directorNotes[dir.id] || "")} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-8">Approve</Button>
                                              <Button type="button" size="sm" variant="destructive" onClick={() => handleRejectDirector(dir.id, directorNotes[dir.id] || "")} className="text-white font-bold text-xs h-8">Reject</Button>
                                            </div>
                                          </div>
                                        </div>
                                      )}

                                      {dir.admin_notes && (
                                        <div className="bg-white rounded-lg p-2.5 border border-dashed text-xs text-neutral-600 leading-relaxed">
                                          <span className="font-bold text-neutral-800 block mb-0.5">Admin Audit Notes:</span>
                                          <span className="break-words whitespace-normal">{dir.admin_notes}</span>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </section>
                        )}

                        {isBusinessPlan && (
                        <details className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm xl:order-9" open={!allDocumentsVerified}>
                          <summary className="cursor-pointer list-none">
                            <span className="flex items-center justify-between gap-3">
                              <span>
                                <span className="block text-sm font-semibold text-neutral-900">Documents Review</span>
                                <span className="block text-xs text-neutral-500">Submitted documents only. Representative BVN and selfie evidence are reviewed separately above.</span>
                              </span>
                              <span className="text-[10px] font-medium text-neutral-500">{allDocumentsVerified ? "Collapsed by default" : "Expanded for pending checks"}</span>
                            </span>
                          </summary>
                          <div className="mt-3 space-y-2">
                            {documentItems.map(({ label, value, field, statusVal }) => (
                              <div key={label} className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 lg:flex-row lg:items-center lg:justify-between">
                                <div className="min-w-0 max-w-full">
                                  <p className="text-xs text-neutral-500">{label}</p>
                                  {value ? (
                                    <button onClick={() => handleViewDocument(value)} className="mt-1 text-purp-600 hover:underline text-sm flex items-center gap-1 bg-transparent border-0 p-0 cursor-pointer break-all whitespace-normal text-left" title={value}>
                                      View Document <ExternalLink className="h-3 w-3" />
                                    </button>
                                  ) : (
                                    <p className="mt-1 font-medium text-sm text-neutral-700 break-words whitespace-normal">Not submitted</p>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                                  <Badge variant="outline" className={`text-xs capitalize border ${statusColor(statusVal || "unverified")}`}>{statusVal || "unverified"}</Badge>
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
                        </details>
                        )}

                        <details className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 shadow-sm xl:order-12 xl:col-span-2">
                          <summary className="cursor-pointer list-none font-semibold text-sm text-neutral-900">
                            <span className="flex items-center justify-between gap-3">
                              <span>Advanced Debug</span>
                              <span className="text-xs font-medium text-neutral-500">Collapsed by default</span>
                            </span>
                          </summary>
                          <div className="mt-4 space-y-3">
                            <div className="rounded-xl border border-purple-200 bg-purple-50/60 p-3 space-y-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-semibold text-purple-950 text-sm">Setup Mode &amp; Authority Review</p>
                                  <p className="text-xs text-purple-700 mt-0.5">Tracks paid setup, live feature gating, saved registry snapshot, affiliation matching, invitations, and cost context.</p>
                                </div>
                                <Badge variant="outline" className="border-purple-200 bg-white text-purple-700 font-bold capitalize">{selectedMerchant.onboarding_status?.replace(/_/g, " ") || "legacy"}</Badge>
                              </div>

                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div className="rounded-lg bg-white border border-purple-100 p-3">
                                  <p className="text-xs font-bold text-neutral-900">Verification disclosure</p>
                                  <p className="mt-1 text-xs text-neutral-600">Version: {selectedMerchant.verification_disclosure_version || "-"}</p>
                                  <p className="text-xs text-neutral-600">Acknowledged: {selectedMerchant.verification_disclosure_acknowledged_at ? new Date(selectedMerchant.verification_disclosure_acknowledged_at).toLocaleString() : "-"}</p>
                                </div>
                                <div className="rounded-lg bg-white border border-purple-100 p-3">
                                  <p className="text-xs font-bold text-neutral-900">Verification cost context</p>
                                  <p className="mt-1 text-xs text-neutral-600">Attempts shown: {verificationCosts.length}</p>
                                  <p className="text-xs text-neutral-600">Total NGN: {verificationCosts.reduce((sum, item) => sum + Number(item.cost_amount || 0), 0).toLocaleString()}</p>
                                </div>
                              </div>

                              <div className="rounded-lg bg-white border border-purple-100 p-3">
                                <p className="text-xs font-bold text-neutral-900">Snapshot source debug</p>
                                <p className="mt-1 text-xs text-neutral-600 break-words whitespace-normal">Source: {snapshotSource}</p>
                              </div>

                              {(businessAffiliations.length > 0 || directorInvitations.length > 0) && (
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                  <div className="rounded-lg bg-white border border-purple-100 p-3 space-y-2">
                                    <p className="text-xs font-bold text-neutral-900">Affiliation matches</p>
                                    {businessAffiliations.length === 0 ? (
                                      <p className="text-xs text-neutral-500">No affiliation match recorded.</p>
                                    ) : businessAffiliations.slice(0, 4).map((item) => (
                                      <div key={item.id} className="text-xs border-t border-neutral-100 pt-2 first:border-t-0 first:pt-0">
                                        <p className="font-semibold capitalize">{item.status?.replace(/_/g, " ")}</p>
                                        <p className="text-neutral-500 break-words whitespace-normal">{item.match_reason || item.matched_registry_name || "-"}</p>
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
                                          <span className="font-semibold break-words whitespace-normal">{invite.selected_director_name}</span>
                                          <Badge variant="outline" className="text-[9px] capitalize">{invite.status}</Badge>
                                        </div>
                                        <p className="text-neutral-500 break-words whitespace-normal">{invite.director_email}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </details>
                      </div>
                    );
                  })()}
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
