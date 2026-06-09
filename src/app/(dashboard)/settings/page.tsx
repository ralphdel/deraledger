"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Country, State } from "country-state-city";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle,
  Clock,
  ExternalLink,
  FileCheck,
  Info,
  Lock,
  Plus,
  Save,
  Shield,
  Upload,
} from "lucide-react";
import DirectorSelfieModal from "@/components/kyc/director-selfie-modal";
import { LivenessCamera } from "@/components/kyc/liveness-camera";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createClient } from "@/lib/supabase/client";
import { getMerchant } from "@/lib/data";
import {
  createDirectorInvitationAction,
  getDirectorApprovalContextAction,
  submitDojahKycAction,
  submitKycAction,
  verifyRcNumberAction,
  requestManualReviewAction,
} from "@/lib/actions";
import {
  getLiveFeatureLockReasons,
  isLiveFeatureEnabled,
} from "@/lib/services/onboarding-flow.service";
import type { Merchant } from "@/lib/types";
import {
  getCollectionLimitLabel,
  getRequirementCompletion,
  getVerificationRequirements,
  hasVerificationRequirement,
  type VerificationRequirementKey,
} from "@/lib/verification-requirements";

const CURRENT_PLATFORM_VERSION = 1;

type DirectorRole =
  | "director"
  | "shareholder"
  | "beneficial_owner"
  | "signatory"
  | "proprietor"
  | "partner"
  | "trustee";

type DirectorVerificationRow = {
  id: string;
  director_name?: string | null;
  director_role?: string | null;
  verification_status?: string | null;
};

type RegistrySnapshotRow = {
  id: string;
  registered_name?: string | null;
  registration_number?: string | null;
  directors_json?: { id?: string; name?: string; role?: string }[] | null;
};

type DirectorInvitationRow = {
  id: string;
  selected_director_name?: string | null;
  status?: string | null;
};

type DirectorAffiliationRow = {
  matched_registry_name?: string | null;
  match_reason?: string | null;
  match_score?: number | null;
  status?: string | null;
};

const BUSINESS_TYPE_OPTIONS = [
  { value: "sole_proprietorship", label: "Sole Proprietorship / Registered Business Name" },
  { value: "ltd", label: "Private Limited Company (LTD)" },
  { value: "plc", label: "Public Limited Company (PLC)" },
  { value: "llp", label: "Limited Liability Partnership (LLP)" },
  { value: "lp", label: "Limited Partnership (LP)" },
  { value: "incorporated_trustees", label: "Incorporated Trustees (IT)" },
  { value: "cooperative", label: "Cooperative Society" },
] as const;

function formatPlanLabel(plan: string | null | undefined) {
  if (!plan) return "Starter";
  if (plan === "corporate") return "Business";
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

function getPlanProgressTitle(isStarter: boolean, isCorporate: boolean, relationshipClaim?: string | null) {
  if (isStarter) return "Starter Plan";
  if (isCorporate && relationshipClaim === "representative_claim") {
    return "Business & Director Approval Progress";
  }
  if (isCorporate) return "Director-Owned Business Verification";
  return "Your Individual Verification Progress";
}

function getIdentitySectionTitle(isCorporate: boolean, relationshipClaim?: string | null) {
  if (isCorporate && relationshipClaim === "representative_claim") {
    return "Representative Identity Verification";
  }
  if (isCorporate) return "Director/Owner Identity Verification";
  return "Identity Verification";
}

function getProfileNameLabel(isCorporate: boolean, relationshipClaim?: string | null) {
  if (isCorporate && relationshipClaim === "representative_claim") return "Representative Full Name";
  if (isCorporate) return "Director/Owner Full Name";
  return "Full Name on BVN";
}

function getOwnerDisplayLabel(isCorporate: boolean, relationshipClaim?: string | null) {
  if (isCorporate && relationshipClaim === "representative_claim") return "Representative";
  if (isCorporate) return "Director/Owner";
  return "Verified name";
}

function formatStatusLabel(status: string | null | undefined) {
  if (!status) return "Not started";
  return status.replace(/_/g, " ");
}

function maskAccountNumber(value: string | null | undefined) {
  if (!value) return "Not configured";
  const trimmed = value.trim();
  if (trimmed.length <= 4) return trimmed;
  return `${"*".repeat(Math.max(0, trimmed.length - 4))}${trimmed.slice(-4)}`;
}

function statusBadge(status: string | null | undefined) {
  if (!status || status === "unverified" || status === "not_started") {
    return (
      <Badge variant="outline" className="border-neutral-200 bg-neutral-50 text-neutral-600">
        Not started
      </Badge>
    );
  }

  if (
    status === "verified" ||
    status === "active" ||
    status === "strong_match" ||
    status === "director_approved"
  ) {
    return (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
        <CheckCircle className="mr-1 h-3 w-3" />
        {formatStatusLabel(status)}
      </Badge>
    );
  }

  if (status.includes("pending") || status === "manual_review" || status === "partial_match") {
    return (
      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
        <Clock className="mr-1 h-3 w-3" />
        {formatStatusLabel(status)}
      </Badge>
    );
  }

  if (status === "rejected" || status === "requires_reupload" || status === "restricted") {
    return (
      <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
        <AlertTriangle className="mr-1 h-3 w-3" />
        {formatStatusLabel(status)}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
      {formatStatusLabel(status)}
    </Badge>
  );
}

function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-2 border-purp-200 shadow-none">
      <CardHeader className="gap-3 pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1.5">
            <CardTitle className="text-base font-bold text-purp-900">{title}</CardTitle>
            <p className="text-sm leading-6 text-neutral-500">{description}</p>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">{children}</CardContent>
    </Card>
  );
}

function ChecklistRow({
  title,
  description,
  status,
}: {
  title: string;
  description: string;
  status: "complete" | "pending" | "locked" | "rejected";
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-4">
      {status === "complete" ? (
        <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
      ) : status === "rejected" ? (
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
      ) : status === "pending" ? (
        <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
      ) : (
        <Lock className="mt-0.5 h-5 w-5 shrink-0 text-neutral-400" />
      )}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-neutral-900">{title}</p>
          <Badge
            variant="outline"
            className={
              status === "complete"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : status === "rejected"
                ? "border-red-200 bg-red-50 text-red-700"
                : status === "pending"
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-neutral-200 bg-neutral-50 text-neutral-600"
            }
          >
            {status === "complete"
              ? "Complete"
              : status === "rejected"
              ? "Rejected"
              : status === "pending"
              ? "Pending"
              : "Locked"}
          </Badge>
        </div>
        <p className="text-sm leading-6 text-neutral-500">{description}</p>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [businessName, setBusinessName] = useState("");
  const [tradingName, setTradingName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [businessStreet, setBusinessStreet] = useState("");
  const [businessCity, setBusinessCity] = useState("");
  const [businessState, setBusinessState] = useState("");
  const [businessCountry, setBusinessCountry] = useState("NG");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [feeDefault, setFeeDefault] = useState<"business" | "customer">("business");
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [businessType, setBusinessType] = useState("sole_proprietorship");
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingFeeSettings, setSavingFeeSettings] = useState(false);

  const [cacFile, setCacFile] = useState<File | null>(null);
  const [cacNumber, setCacNumber] = useState("");
  const [utilityFile, setUtilityFile] = useState<File | null>(null);
  const [bvnNumber, setBvnNumber] = useState("");
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [kycSubmitting, setKycSubmitting] = useState(false);
  const [rcSubmitting, setRcSubmitting] = useState(false);
  const [rcError, setRcError] = useState<string | null>(null);
  const [kycSuccess, setKycSuccess] = useState(false);
  const [kycError, setKycError] = useState<string | null>(null);

  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  const [livenessImages, setLivenessImages] = useState<string[]>([]);
  const [showLivenessCamera, setShowLivenessCamera] = useState(false);
  const [livenessFallback, setLivenessFallback] = useState(false);
  const [isBvnLocked, setIsBvnLocked] = useState(false);

  const [directors, setDirectors] = useState<DirectorVerificationRow[]>([]);
  const [directorsLoading, setDirectorsLoading] = useState(false);
  const [newDirectorName, setNewDirectorName] = useState("");
  const [newDirectorRole, setNewDirectorRole] = useState<DirectorRole>("director");
  const [activeDirectorToVerify, setActiveDirectorToVerify] = useState<{ name: string; role: DirectorRole } | null>(null);
  const [registrySnapshot, setRegistrySnapshot] = useState<RegistrySnapshotRow | null>(null);
  const [directorInvitations, setDirectorInvitations] = useState<DirectorInvitationRow[]>([]);
  const [directorAffiliation, setDirectorAffiliation] = useState<DirectorAffiliationRow | null>(null);
  const [selectedRegistryDirector, setSelectedRegistryDirector] = useState("");
  const [directorInviteEmail, setDirectorInviteEmail] = useState("");
  const [lastDirectorInvite, setLastDirectorInvite] = useState<{ directorName: string; email: string } | null>(null);
  const [directorInviteSubmitting, setDirectorInviteSubmitting] = useState(false);
  const [directorInviteMessage, setDirectorInviteMessage] = useState<string | null>(null);
  const [directorInviteError, setDirectorInviteError] = useState<string | null>(null);

  const loadDirectors = useCallback(async (merchantId: string) => {
    setDirectorsLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("business_director_verifications")
        .select("*")
        .eq("merchant_id", merchantId)
        .order("created_at", { ascending: false });

      if (!error && data) {
        setDirectors(data);
      }
    } catch (error) {
      console.error("Failed to load directors", error);
    } finally {
      setDirectorsLoading(false);
    }
  }, []);

  const loadDirectorApprovalContext = useCallback(async (merchantId: string) => {
    try {
      const result = await getDirectorApprovalContextAction(merchantId);
      if (result.success) {
        setRegistrySnapshot(result.snapshot);
        setDirectorInvitations(result.invitations || []);
        setDirectorAffiliation(result.affiliation || null);
      }
    } catch (error) {
      console.error("Failed to load director approval context", error);
    }
  }, []);

  const applyMerchantState = useCallback(async (nextMerchant: Merchant) => {
    setMerchant(nextMerchant);
    const tier = nextMerchant.subscription_plan || nextMerchant.merchant_tier || "starter";
    const hasConfirmed = (nextMerchant.platform_version ?? 0) >= CURRENT_PLATFORM_VERSION;

    if (tier === "corporate" && !hasConfirmed) {
      setBusinessName("");
    } else {
      setBusinessName(nextMerchant.business_name || "");
    }

    setTradingName(nextMerchant.trading_name || nextMerchant.business_name || "");
    setOwnerName(nextMerchant.owner_name || "");
    setBusinessStreet(nextMerchant.business_street || "");
    setBusinessCity(nextMerchant.business_city || "");
    setBusinessState(nextMerchant.business_state || "");
    setBusinessCountry(nextMerchant.business_country || "NG");
    setEmail(nextMerchant.email || "");
    setPhone(nextMerchant.phone || "");
    setFeeDefault(nextMerchant.fee_absorption_default === "customer" ? "customer" : "business");
    setBvnNumber(/^\d{11}$/.test(nextMerchant.bvn || "") ? nextMerchant.bvn || "" : "");
    setCacNumber(nextMerchant.cac_number || "");
    setLogoUrl(nextMerchant.logo_url || null);
    setBusinessType(nextMerchant.business_type || "sole_proprietorship");

    if (tier === "corporate" && nextMerchant.id) {
      await Promise.all([
        loadDirectors(nextMerchant.id),
        loadDirectorApprovalContext(nextMerchant.id),
      ]);
    } else {
      setDirectors([]);
      setRegistrySnapshot(null);
      setDirectorInvitations([]);
      setDirectorAffiliation(null);
    }
  }, [loadDirectorApprovalContext, loadDirectors]);

  const refreshMerchant = useCallback(async (merchantId?: string) => {
    const freshMerchant = await getMerchant(merchantId);
    if (freshMerchant) {
      await applyMerchantState(freshMerchant as Merchant);
    }
  }, [applyMerchantState]);

  const handleCreateDirectorInvitation = async () => {
    if (!merchant) return;
    setDirectorInviteSubmitting(true);
    setDirectorInviteError(null);
    setDirectorInviteMessage(null);

    try {
      const result = await createDirectorInvitationAction({
        merchantId: merchant.id,
        selectedDirectorRecordId: selectedRegistryDirector,
        directorEmail: directorInviteEmail,
      });

      if (!result.success) {
        throw new Error(result.error || "Could not send director invitation.");
      }

      const selectedDirectorName =
        uniqueRegistryDirectors.find((director) => (director.id || director.name || "") === selectedRegistryDirector)?.name ||
        selectedRegistryDirector ||
        "Selected director";
      setLastDirectorInvite({
        directorName: selectedDirectorName,
        email: directorInviteEmail,
      });
      setDirectorInviteMessage("Director approval request sent.");
      await loadDirectorApprovalContext(merchant.id);
    } catch (error) {
      setDirectorInviteError(
        error instanceof Error ? error.message : "Could not send director invitation.",
      );
    } finally {
      setDirectorInviteSubmitting(false);
    }
  };

  const handleManualReviewRequest = async () => {
    if (!merchant) return;
    setDirectorInviteMessage("Submitting manual review request...");
    setDirectorInviteError(null);
    try {
      const res = await requestManualReviewAction(merchant.id);
      if (res.success) {
        setDirectorInviteMessage("Manual review requested.");
        await refreshMerchant(merchant.id);
      } else {
        setDirectorInviteError(res.error || "Failed to request manual review");
      }
    } catch (err: any) {
      setDirectorInviteError(err.message);
    }
  };

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !merchant) return;

    setUploadingLogo(true);
    setKycError(null);
    try {
      const supabase = createClient();
      const fileExt = file.name.split(".").pop();
      const fileName = `${merchant.id}_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("merchant_logos")
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("merchant_logos").getPublicUrl(fileName);

      await submitKycAction(merchant.id, { logo_url: publicUrl });
      setLogoUrl(publicUrl);
      await refreshMerchant(merchant.id);
    } catch (error) {
      console.error("Error uploading logo:", error);
      setKycError(
        `Failed to upload logo: ${
          error instanceof Error ? error.message : "Unknown error"
        }. Please ensure your storage policies are configured correctly.`,
      );
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleRemoveLogo = async () => {
    if (!merchant) return;

    setUploadingLogo(true);
    setKycError(null);
    try {
      await submitKycAction(merchant.id, { logo_url: null });
      setLogoUrl(null);
      await refreshMerchant(merchant.id);
    } catch (error) {
      console.error("Error removing logo:", error);
      setKycError(
        `Failed to remove logo: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setUploadingLogo(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    getMerchant().then(async (nextMerchant) => {
      if (!nextMerchant || cancelled) {
        setLoading(false);
        return;
      }

      await applyMerchantState(nextMerchant as Merchant);
      if (!cancelled) {
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [applyMerchantState]);

  const effectiveTier = merchant?.subscription_plan || merchant?.merchant_tier || "starter";
  const planRequirements = getVerificationRequirements(effectiveTier);
  const isStarter = planRequirements.includes("no_payment_collection");
  const isCorporate =
    hasVerificationRequirement(effectiveTier, "director_or_representative_flow") ||
    hasVerificationRequirement(effectiveTier, "director_kyc");
  const isIndividual = !isStarter && !isCorporate;
  const requiresBvn = hasVerificationRequirement(effectiveTier, "bvn") || isCorporate;
  const requiresSelfie = hasVerificationRequirement(effectiveTier, "selfie_liveness") || isCorporate;
  const requiresBusinessRegistration = hasVerificationRequirement(
    effectiveTier,
    "business_registration_check",
  );
  const requiresBusinessDocument =
    hasVerificationRequirement(effectiveTier, "business_document") ||
    hasVerificationRequirement(effectiveTier, "business_documents");
  const requiresUtilityBill =
    hasVerificationRequirement(effectiveTier, "utility_bill") ||
    hasVerificationRequirement(effectiveTier, "proof_of_address");
  const requiresValidIdDocument = hasVerificationRequirement(effectiveTier, "valid_id_document");
  const requiresDirectorApprovalFlow =
    hasVerificationRequirement(effectiveTier, "director_or_representative_flow") ||
    hasVerificationRequirement(effectiveTier, "director_kyc");
  const requiresSettlementAccount = hasVerificationRequirement(effectiveTier, "settlement_account");
  const liveFeaturesActive = merchant ? isLiveFeatureEnabled(merchant) : false;
  const liveFeatureLockReasons = merchant ? getLiveFeatureLockReasons(merchant) : [];
  const nextLiveUnlockStep = liveFeatureLockReasons[0] || null;
  const verificationStatus = merchant?.verification_status || "unverified";
  const isOwnerNameLocked =
    merchant?.bvn_status === "verified" && merchant?.selfie_status === "verified";
  const registryDirectors = Array.isArray(registrySnapshot?.directors_json)
    ? registrySnapshot.directors_json
    : [];
  const uniqueRegistryDirectors = (() => {
    const seen = new Set<string>();
    return registryDirectors.filter((director) => {
      const key = `${(director.name || "").trim().toLowerCase()}|${(director.role || "").trim().toLowerCase()}`;
      if (!key.trim() || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();
  const registryDirectorsByRole = uniqueRegistryDirectors.reduce<Record<string, typeof uniqueRegistryDirectors>>((acc, director) => {
    const roleKey = director.role || "Director";
    if (!acc[roleKey]) acc[roleKey] = [];
    acc[roleKey].push(director);
    return acc;
  }, {});
  const closestRegistryDirector = (() => {
    const matchedName = directorAffiliation?.matched_registry_name?.trim().toLowerCase();
    if (matchedName) {
      return uniqueRegistryDirectors.find((director) => director.name?.trim().toLowerCase() === matchedName) || null;
    }
    return uniqueRegistryDirectors[0] || null;
  })();
  const pendingDirectorInvite = directorInvitations.find((invite) =>
    ["sent", "opened"].includes(String(invite.status || "")),
  );
  const shouldShowManualFallback =
    Boolean(
      merchant?.business_affiliation_status === "partial_match" ||
        merchant?.business_affiliation_status === "no_match" ||
        merchant?.business_affiliation_status === "rejected" ||
        merchant?.business_affiliation_status === "manual_review" ||
        !registrySnapshot ||
        uniqueRegistryDirectors.length === 0 ||
        directorInviteError ||
        directorInvitations.some((invite) =>
          ["expired", "rejected", "cancelled"].includes(String(invite.status || "")),
        ),
    );
  const authorityApproved =
    merchant?.business_affiliation_status === "director_approved" ||
    merchant?.business_affiliation_status === "strong_match";
  const approvedDirectorInvite = directorInvitations.find((invite) => invite.status === "approved");
  const approvedDirectorName =
    approvedDirectorInvite?.selected_director_name ||
    directors.find((director) => director.verification_status === "verified")?.director_name ||
    null;
  const needsDirectorApproval =
    isCorporate &&
    !authorityApproved &&
    (["no_match", "rejected"].includes(String(merchant?.business_affiliation_status || "")) ||
      merchant?.relationship_claim === "representative_claim");

  const planProgressTitle = getPlanProgressTitle(
    isStarter,
    isCorporate,
    merchant?.relationship_claim,
  );
  const identitySectionTitle = getIdentitySectionTitle(
    isCorporate,
    merchant?.relationship_claim,
  );
  const profileNameLabel = getProfileNameLabel(isCorporate, merchant?.relationship_claim);
  const verifiedOwnerLabel = getOwnerDisplayLabel(isCorporate, merchant?.relationship_claim);
  const verifiedIdentityComplete =
    merchant?.bvn_status === "verified" && merchant?.selfie_status === "verified";
  const verificationCompleteCopy = isCorporate
    ? merchant?.relationship_claim === "representative_claim"
      ? "Representative identity verified."
      : "Director/owner identity verified."
    : "Identity verification completed.";
  const verificationPendingCopy = isCorporate
    ? merchant?.relationship_claim === "representative_claim"
      ? "Verify your BVN and selfie as the person opening this business account. Director approval is handled separately."
      : "Verify your BVN and selfie as the director or owner opening this business account."
    : "Verify your BVN and take a live selfie to confirm your identity.";

  const ownerNameMissing = !isStarter && !ownerName.trim();
  const businessNameMissing = isCorporate && !businessName.trim();
  const businessAddressMissing =
    !isStarter &&
    (!businessStreet.trim() ||
      !businessCity.trim() ||
      !businessState.trim() ||
      !businessCountry.trim());
  const phoneMissing = !isStarter && !phone.trim();
  const profileIncomplete =
    ownerNameMissing || businessNameMissing || businessAddressMissing || phoneMissing;
  const effectiveVerificationStatus = profileIncomplete ? "unverified" : verificationStatus;

  const settlementConfigured = Boolean(
    merchant?.settlement_account_number &&
      merchant?.settlement_bank_name &&
      merchant?.settlement_account_name,
  );

  const verificationChecklist = (() => {
    const metadata: Record<
      VerificationRequirementKey,
      { title: string; description: string }
    > = {
      basic_profile: {
        title: "Business profile",
        description: "Complete your profile before verification can proceed.",
      },
      no_payment_collection: {
        title: "Payment collection",
        description: "Payment collection is not available on this plan yet.",
      },
      bvn: {
        title: "BVN verification",
        description: "Legal identity must match the submitted BVN.",
      },
      selfie_liveness: {
        title: "Selfie Verification",
        description: "One live selfie confirms the account owner or representative.",
      },
      valid_id_document: {
        title: "Identity document",
        description: "Some plans require an extra identity document.",
      },
      proof_of_address: {
        title: "Proof of Address",
        description: "Some plans require a proof of address document.",
      },
      additional_manual_review: {
        title: "Final review",
        description: "Some plans need a final review before payment collection starts.",
      },
      business_registration_check: {
        title: "Business registration",
        description: "Verify the business registration number and registered name.",
      },
      owner_or_director_kyc: {
        title:
          isCorporate && merchant?.relationship_claim !== "representative_claim"
            ? "Director/Owner Identity"
            : "Representative Identity",
        description:
          isCorporate && merchant?.relationship_claim !== "representative_claim"
            ? "Verify the director or owner opening the account."
            : "Verify the person opening the account.",
      },
      director_or_representative_flow: {
        title: "Director Approval",
        description: "A listed director must approve the business account.",
      },
      director_kyc: {
        title: "Director Match",
        description: "Match the director name to the business record.",
      },
      business_document: {
        title: "Business Registration Document",
        description: "Upload the required business registration document.",
      },
      business_documents: {
        title: "Business Verification Documents",
        description: "Upload the required business verification documents.",
      },
      utility_bill: {
        title: "Proof of Business Address",
        description: "Upload proof of the business address.",
      },
      settlement_account: {
        title: "Payout Account",
        description: "Add the bank account where customer payments should be sent.",
      },
      admin_review: {
        title: "Final Review",
        description: "Collections only start after final review.",
      },
      lower_collection_limit: {
        title: "Lower collection limit",
        description: "This tier operates under a lower payment collection limit.",
      },
      higher_collection_limit: {
        title: "Higher collection limit",
        description: "This tier unlocks a higher payment collection limit once all required steps are complete.",
      },
    };

    return planRequirements.map((requirement) => ({
      title: metadata[requirement]?.title || requirement,
      description: metadata[requirement]?.description || "Requirement status",
      status: merchant
        ? getRequirementCompletion(merchant, requirement)
        : ("pending" as const),
    }));
  })();

  const handleSaveProfile = async () => {
    if (!merchant) return;
    setSavingProfile(true);
    setKycError(null);

    const normalizedBusinessName = businessName.trim();
    const normalizedTradingName = tradingName.trim();
    const normalizedOwnerName = ownerName.trim();

    const updates: Record<string, unknown> = {
      business_name: isCorporate
        ? normalizedBusinessName || normalizedTradingName
        : normalizedTradingName || normalizedBusinessName,
      trading_name: normalizedTradingName || null,
      business_street: businessStreet.trim() || null,
      business_city: businessCity.trim() || null,
      business_state: businessState.trim() || null,
      business_country: businessCountry || null,
      business_type: businessType,
      phone: phone.trim() || null,
      platform_version: CURRENT_PLATFORM_VERSION,
    };

    if (!isOwnerNameLocked) {
      updates.owner_name = normalizedOwnerName || null;
    }

    const result = await submitKycAction(merchant.id, updates);
    if (!result.success) {
      setKycError(result.error || "Failed to save business profile.");
      setSavingProfile(false);
      return;
    }

    await refreshMerchant(merchant.id);
    setSavingProfile(false);
  };

  const handleSaveFeeSettings = async () => {
    if (!merchant) return;
    setSavingFeeSettings(true);
    setKycError(null);

    const result = await submitKycAction(merchant.id, {
      fee_absorption_default: feeDefault,
    });

    if (!result.success) {
      setKycError(result.error || "Failed to save fee settings.");
      setSavingFeeSettings(false);
      return;
    }

    await refreshMerchant(merchant.id);
    setSavingFeeSettings(false);
  };

  const handleVerifyRcNumber = async () => {
    if (!merchant?.id) return;

    const normalizedCacNumber = cacNumber.trim().toUpperCase().replace(/[\s-]/g, "");
    if (!normalizedCacNumber || normalizedCacNumber.length < 5) {
      setRcError("Please enter a valid business registration number.");
      return;
    }

    const savedBusinessName = merchant.business_name?.trim() || "";
    const savedOwnerName = merchant.owner_name?.trim() || "";
    if (
      (businessName.trim() && businessName.trim() !== savedBusinessName) ||
      (ownerName.trim() && ownerName.trim() !== savedOwnerName)
    ) {
      setRcError(
        "You have unsaved business profile changes. Save the Business Profile section before verifying registration.",
      );
      return;
    }

    if (!savedBusinessName || !savedOwnerName) {
      setRcError(
        "Complete the Business Profile section first, then verify the registration number.",
      );
      return;
    }

    setRcSubmitting(true);
    setRcError(null);
    try {
      const response = await verifyRcNumberAction(merchant.id, normalizedCacNumber);
      if (!response.success) {
        setRcError(response.error || "Failed to verify business registration.");
        return;
      }

      setCacNumber(normalizedCacNumber);
      await refreshMerchant(merchant.id);
    } catch (error) {
      setRcError(
        error instanceof Error
          ? error.message
          : "An unexpected error occurred verifying your business registration.",
      );
    } finally {
      setRcSubmitting(false);
    }
  };

  const handleKycSubmit = async () => {
    if (!merchant) return;

    if (!isBvnLocked && merchant.bvn_status !== "verified" && merchant.bvn_status !== "pending") {
      setKycError("Save the BVN first so the submitted identity cannot drift during review.");
      return;
    }

    const selfieRequired = merchant.selfie_status !== "verified";
    if (!bvnNumber || (selfieRequired && livenessImages.length === 0 && !selfieFile)) {
      setKycError("Provide your BVN and complete the selfie step before submitting.");
      return;
    }

    if (requiresBusinessRegistration && !merchant.cac_number) {
      setKycError("Verify the required registration step before submitting verification.");
      return;
    }

    if (requiresBusinessDocument && !cacFile && !merchant.cac_document_url) {
      setKycError("This tier requires the supporting business document before submission.");
      return;
    }

    if (requiresUtilityBill && !utilityFile && !merchant.utility_document_url) {
      setKycError("This tier requires proof of address or utility evidence before submission.");
      return;
    }

    setKycSubmitting(true);

    const toBase64 = (file: File) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || "");
          resolve(result.includes(",") ? result.split(",")[1] : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });

    try {
      let finalSelfieBase64: string | undefined;
      let finalSelfieFileName: string | undefined;

      if (livenessImages.length > 0) {
        finalSelfieBase64 = livenessImages[0];
        finalSelfieFileName = `liveness-${Date.now()}.jpg`;
      } else if (selfieFile) {
        finalSelfieBase64 = await toBase64(selfieFile);
        finalSelfieFileName = selfieFile.name;
      }

      const cacBase64 = cacFile ? await toBase64(cacFile) : undefined;
      const utilityBase64 = utilityFile ? await toBase64(utilityFile) : undefined;

      const result = await submitDojahKycAction({
        merchantId: merchant.id,
        bvn: bvnNumber,
        selfieBase64: finalSelfieBase64,
        selfieFileName: finalSelfieFileName,
        cacDocumentName: cacFile?.name,
        cacFileBase64: cacBase64,
        utilityDocumentName: utilityFile?.name,
        utilityFileBase64: utilityBase64,
      });

      if (!result.success) {
        if (result.updates) {
          setMerchant({ ...merchant, ...result.updates } as Merchant);
        }
        setKycError(`Submission failed: ${result.error}`);
        setIsBvnLocked(false);
        setLivenessImages([]);
        return;
      }

      setKycSuccess(true);
      setKycError(null);
      setIsBvnLocked(false);
      setLivenessImages([]);
      setSelfieFile(null);
      setCacFile(null);
      setUtilityFile(null);
      await refreshMerchant(merchant.id);
    } catch (error) {
      setKycError(error instanceof Error ? error.message : "Could not read the verification files.");
      setIsBvnLocked(false);
      setLivenessImages([]);
    } finally {
      setKycSubmitting(false);
    }
  };

  const directorInvitationStatusLabel = (status?: string | null) => {
    switch (status) {
      case "sent":
        return "Invite sent";
      case "opened":
        return "Waiting for identity verification";
      case "verified":
        return "Identity verified, waiting for consent";
      case "approved":
        return "Director approved";
      case "rejected":
        return "Director rejected";
      case "expired":
        return "Invite expired";
      case "cancelled":
        return "Invite cancelled";
      default:
        return formatStatusLabel(status);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-purp-900">Settings</h1>
          <p className="mt-1 text-sm text-neutral-500">Loading your workspace settings...</p>
        </div>
        <Card className="border-2 border-purp-200 shadow-none">
          <CardContent className="p-6">
            <div className="h-48 animate-pulse rounded-2xl bg-purp-50" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="space-y-3">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-purp-900">Settings</h1>
            <p className="max-w-3xl text-sm leading-6 text-neutral-500">
              Manage verification, profile data, payout account setup, billing, and business controls
              without mixing unrelated actions into one long form.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-purp-200 bg-purp-50 text-purp-800">
              Plan: {formatPlanLabel(effectiveTier)}
            </Badge>
            {statusBadge(effectiveVerificationStatus)}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-purp-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Payment Collection
            </p>
            <div className="mt-2 flex items-center gap-2">
              {liveFeaturesActive ? (
                <CheckCircle className="h-5 w-5 text-emerald-600" />
              ) : (
                <Lock className="h-5 w-5 text-amber-600" />
              )}
              <p className="text-sm font-semibold text-neutral-900">
                {liveFeaturesActive ? "Enabled" : "Locked for now"}
              </p>
            </div>
            <p className="mt-2 text-sm leading-6 text-neutral-500">
              {liveFeaturesActive
                ? "Your workspace can use payment collection and payout features."
                : nextLiveUnlockStep || "Complete the required verification steps to enable payment collection."}
            </p>
          </div>

          <div className="rounded-2xl border border-purp-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Payout Account
            </p>
            <div className="mt-2 flex items-center gap-2">
              {settlementConfigured ? (
                <CheckCircle className="h-5 w-5 text-emerald-600" />
              ) : (
                <Clock className="h-5 w-5 text-amber-600" />
              )}
              <p className="text-sm font-semibold text-neutral-900">
                {settlementConfigured ? "Added" : "Action required"}
              </p>
            </div>
            <p className="mt-2 text-sm leading-6 text-neutral-500">
              {settlementConfigured
                ? `${merchant?.settlement_bank_name || "Bank"} • ${maskAccountNumber(
                    merchant?.settlement_account_number,
                  )}`
                : "Add the bank account where customer payments should be sent."}
            </p>
          </div>

          <div className="rounded-2xl border border-purp-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Verified Details
            </p>
            <div className="mt-2 flex items-center gap-2">
              {isOwnerNameLocked ? (
                <Lock className="h-5 w-5 text-emerald-600" />
              ) : (
                <Info className="h-5 w-5 text-blue-600" />
              )}
              <p className="text-sm font-semibold text-neutral-900">
                {isOwnerNameLocked ? "Locked for safety" : "Editable for now"}
              </p>
            </div>
            <p className="mt-2 text-sm leading-6 text-neutral-500">
              Once BVN and selfie are verified, identity-bound profile fields stop accepting edits until
              an admin reset is performed.
            </p>
          </div>
        </div>
      </div>

      {kycError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <p>{kycError}</p>
          </div>
        </div>
      ) : null}

      {rcError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <p>{rcError}</p>
          </div>
        </div>
      ) : null}

      {kycSuccess ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          <div className="flex items-start gap-3">
            <CheckCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <p>
              Verification details submitted successfully. The completed steps are now locked and the
              workspace remains in setup mode until final review is complete.
            </p>
          </div>
        </div>
      ) : null}

      <Tabs defaultValue="verification" className="space-y-6">
        <div className="overflow-x-auto">
          <TabsList className="inline-flex min-w-full justify-start gap-2 rounded-2xl border border-purp-200 bg-white p-2">
            <TabsTrigger value="verification">Account Status & Verification</TabsTrigger>
            <TabsTrigger value="profile">Business Profile</TabsTrigger>
            <TabsTrigger value="settlement">Settlement Account</TabsTrigger>
            <TabsTrigger value="fees">Payment Fee Settings</TabsTrigger>
            <TabsTrigger value="billing">Billing & Subscription</TabsTrigger>
            <TabsTrigger value="tools">Business Tools</TabsTrigger>
            <TabsTrigger value="advanced">Advanced Settings</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="verification" className="space-y-6">
          <SectionCard
            title="Account Status & Verification"
            description="Only the steps for your current plan remain active."
          >
            {isStarter ? (
              <div className="space-y-5">
                <div className="rounded-2xl border border-purp-200 bg-purp-50 p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-2">
                      <p className="text-base font-semibold text-purp-900">Starter Plan</p>
                      <p className="max-w-2xl text-sm leading-6 text-neutral-600">
                        Create invoices now. Upgrade when you are ready to collect payments online.
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Link href="/settings/upgrade/individual">
                        <Button variant="outline" className="border-purp-200 text-purp-900">
                          Upgrade Plan
                        </Button>
                      </Link>
                      <Link href="/settings/upgrade/corporate">
                        <Button className="bg-purp-900 text-white hover:bg-purp-800">
                          Compare Plans
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {verificationChecklist.map((item) => (
                    <ChecklistRow
                      key={item.title}
                      title={item.title}
                      description={item.description}
                      status={item.status}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                  <div className="rounded-2xl border border-purp-200 bg-purp-50/60 p-5">
                    <div className="flex items-start gap-3">
                      {liveFeaturesActive ? (
                        <Shield className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                      ) : (
                        <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                      )}
                      <div className="space-y-2">
                        <p className="text-base font-semibold text-purp-900">
                          {planProgressTitle}
                        </p>
                        <p className="text-sm leading-6 text-neutral-600">
                          {isStarter
                            ? "You can create invoices now. Upgrade and complete verification when you are ready to collect payments online."
                            : isCorporate
                            ? merchant?.relationship_claim === "representative_claim"
                              ? "You are opening this account as a representative of the business. We verify you, verify the business, and then ask a listed director to approve access."
                              : "You are registering as a director or owner of this business. We verify your identity, match it with the business record, and then complete the business checks."
                            : "Complete these steps to unlock payment collection on your Individual plan."}
                        </p>
                        {!liveFeaturesActive && liveFeatureLockReasons.length > 0 ? (
                          <div className="rounded-xl border border-amber-200 bg-white p-3 text-sm text-amber-700">
                            <p className="font-medium">Still needed before payment collection starts</p>
                            <ul className="mt-2 list-disc space-y-1 pl-5">
                              {liveFeatureLockReasons.map((reason) => (
                                <li key={reason}>{reason}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {verificationChecklist.map((item) => (
                      <ChecklistRow
                        key={item.title}
                        title={item.title}
                        description={item.description}
                        status={item.status}
                      />
                    ))}
                  </div>
                </div>

                {profileIncomplete ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                      <div className="space-y-2">
                        <p className="font-semibold">Business profile still blocks verification</p>
                        <ul className="list-disc space-y-1 pl-5">
                          {ownerNameMissing ? <li>Add the verified name in Business Profile.</li> : null}
                          {businessNameMissing ? <li>Add the registered business name in Business Profile.</li> : null}
                          {businessAddressMissing ? <li>Complete the full business address in Business Profile.</li> : null}
                          {phoneMissing ? <li>Add the workspace phone number in Business Profile.</li> : null}
                        </ul>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                  <SectionCard
                    title={identitySectionTitle}
                    description={verificationPendingCopy}
                    action={
                      !profileIncomplete && requiresBvn && merchant?.bvn_status !== "verified" ? (
                        <Button
                          onClick={handleKycSubmit}
                          disabled={kycSubmitting}
                          className="bg-purp-900 text-white hover:bg-purp-800"
                        >
                          {kycSubmitting ? "Submitting..." : "Verify BVN"}
                        </Button>
                      ) : null
                    }
                  >
                    <div className="space-y-4">
                      {verifiedIdentityComplete ? (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                          <div className="flex items-start gap-3">
                            <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                            <div className="space-y-2">
                              <p className="text-sm font-semibold text-emerald-900">
                                {verificationCompleteCopy}
                              </p>
                              <p className="text-sm leading-6 text-emerald-700">
                                BVN: Verified
                                <br />
                                Selfie: Verified
                                <br />
                                {verifiedOwnerLabel}: {ownerName || "Not available"}
                              </p>
                              <p className="text-sm text-emerald-700">
                                These details are now locked for safety. Contact support if anything needs to change.
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          {requiresBvn ? (
                            <div className="space-y-2">
                              <Label className="flex items-center gap-2 text-sm font-medium">
                                <Shield className="h-4 w-4 text-purp-700" />
                                BVN
                                {statusBadge(merchant?.bvn_status)}
                              </Label>
                              <p className="text-xs text-neutral-500">
                                Enter the BVN that matches <strong>{ownerName || "the saved profile name"}</strong>.
                              </p>
                              <div className="flex flex-col gap-3 sm:flex-row">
                                <Input
                                  type="text"
                                  maxLength={11}
                                  placeholder="22XXXXXXXXX"
                                  value={bvnNumber}
                                  onChange={(event) => setBvnNumber(event.target.value.replace(/\D/g, ""))}
                                  className="h-11 border-2 border-purp-200 bg-white sm:max-w-xs"
                                  disabled={
                                    profileIncomplete ||
                                    merchant?.bvn_status === "verified" ||
                                    merchant?.bvn_status === "pending" ||
                                    isBvnLocked
                                  }
                                />
                                {merchant?.bvn_status === "verified" || merchant?.bvn_status === "pending" ? null : (
                                  <div className="flex gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      onClick={() => setIsBvnLocked(true)}
                                      disabled={bvnNumber.length !== 11 || isBvnLocked}
                                      className="h-11 border-2 border-purp-200 text-purp-700"
                                    >
                                      {isBvnLocked ? "Saved" : "Save BVN"}
                                    </Button>
                                    {isBvnLocked ? (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={() => setIsBvnLocked(false)}
                                        className="h-11 text-neutral-500"
                                      >
                                        Edit
                                      </Button>
                                    ) : null}
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : null}

                          {requiresSelfie ? (
                            <div className="space-y-2">
                              <Label className="flex items-center gap-2 text-sm font-medium">
                                <Camera className="h-4 w-4 text-purp-700" />
                                Selfie / Liveness
                                {statusBadge(merchant?.selfie_status)}
                              </Label>
                              <p className="text-xs text-neutral-500">
                                {merchant?.bvn_status === "verified"
                                  ? "Now complete selfie verification."
                                  : "Verify your BVN first, then complete selfie verification."}
                              </p>
                              {!(isBvnLocked || merchant?.bvn_status === "verified" || merchant?.bvn_status === "pending") ? (
                                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500">
                                  Verify your BVN first, then complete selfie verification.
                                </div>
                              ) : (
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                  {!livenessFallback &&
                                  merchant?.selfie_status !== "verified" &&
                                  merchant?.selfie_status !== "pending" ? (
                                    <Button
                                      onClick={() => setShowLivenessCamera(true)}
                                      variant="outline"
                                      disabled={profileIncomplete}
                                      className="border-2 border-purp-200 bg-purp-50 text-purp-700 hover:bg-purp-100"
                                    >
                                      <Camera className="mr-2 h-4 w-4" />
                                      {livenessImages.length > 0 ? "Retake selfie" : "Start Selfie Verification"}
                                    </Button>
                                  ) : (
                                    <Input
                                      type="file"
                                      accept=".png,.jpg,.jpeg"
                                      onChange={(event) => setSelfieFile(event.target.files?.[0] || null)}
                                      className="h-11 border-2 border-purp-200 bg-white file:mr-3 file:rounded-md file:border-0 file:bg-purp-100 file:px-3 file:py-1 file:text-sm file:font-medium file:text-purp-700"
                                      disabled={
                                        profileIncomplete ||
                                        merchant?.selfie_status === "verified" ||
                                        merchant?.selfie_status === "pending"
                                      }
                                    />
                                  )}
                                  {livenessImages.length > 0 || selfieFile || (merchant?.selfie_url && merchant?.selfie_status !== "rejected") ? (
                                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                                      <CheckCircle className="mr-1 h-3 w-3" />
                                      {merchant?.selfie_url && merchant?.selfie_status !== "rejected"
                                        ? "Existing selfie on file"
                                        : livenessImages.length > 0
                                        ? "Capture ready"
                                        : "File selected"}
                                    </Badge>
                                  ) : null}
                                </div>
                              )}
                            </div>
                          ) : null}
                        </>
                      )}

                      {(requiresBusinessRegistration ||
                        requiresBusinessDocument ||
                        requiresUtilityBill ||
                        requiresValidIdDocument) ? (
                        <div className="space-y-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                          <div className="space-y-1">
                            <p className="text-sm font-semibold text-neutral-900">Business Verification Documents</p>
                            <p className="text-sm leading-6 text-neutral-500">
                              Upload the documents required for your current plan.
                            </p>
                          </div>

                          {!verifiedIdentityComplete ? (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                              <p className="font-medium flex items-center gap-2">
                                <Lock className="h-4 w-4" />
                                {merchant?.relationship_claim === "representative_claim"
                                  ? "Complete Representative Identity Verification first."
                                  : "Complete Director/Owner Identity Verification first."}
                              </p>
                              <p className="mt-1 text-xs opacity-80">
                                You must verify your BVN and take a live selfie before uploading business documents.
                              </p>
                            </div>
                          ) : (
                            <>

                          {requiresBusinessRegistration ? (
                            <div className="space-y-2">
                              <Label className="flex items-center gap-2 text-sm font-medium">
                                <FileCheck className="h-4 w-4 text-purp-700" />
                                Business Registration Number
                                {statusBadge(merchant?.cac_status)}
                              </Label>
                              <div className="flex flex-col gap-3 sm:flex-row">
                                <Input
                                  type="text"
                                  value={merchant?.cac_number || cacNumber}
                                  onChange={(event) => setCacNumber(event.target.value)}
                                  placeholder="Registration or record number"
                                  className="h-11 border-2 border-purp-200 bg-white font-mono sm:max-w-xs"
                                  disabled={Boolean(merchant?.cac_number)}
                                />
                                {!merchant?.cac_number ? (
                                  <Button
                                    onClick={handleVerifyRcNumber}
                                    disabled={rcSubmitting || cacNumber.trim().length < 5}
                                    className="bg-purp-900 text-white hover:bg-purp-800"
                                  >
                                    {rcSubmitting ? "Verifying..." : "Verify Business Registration"}
                                  </Button>
                                ) : (
                                  <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                                    <CheckCircle className="mr-1 h-3 w-3" />
                                    Registration locked
                                  </Badge>
                                )}
                              </div>
                            </div>
                          ) : null}

                          <div className="grid gap-4 lg:grid-cols-2">
                            {requiresBusinessDocument || requiresValidIdDocument ? (
                              <div className="space-y-2">
                                <Label className="flex items-center gap-2 text-sm font-medium">
                                  <Upload className="h-4 w-4 text-purp-700" />
                                  {requiresValidIdDocument && !requiresBusinessDocument
                                    ? "Business Registration Document"
                                    : "Business Registration Document"}
                                  {statusBadge(merchant?.cac_status)}
                                </Label>
                                <Input
                                  type="file"
                                  accept=".pdf,.png,.jpg,.jpeg"
                                  onChange={(event) => setCacFile(event.target.files?.[0] || null)}
                                  className="h-11 border-2 border-purp-200 bg-white file:mr-3 file:rounded-md file:border-0 file:bg-purp-100 file:px-3 file:py-1 file:text-sm file:font-medium file:text-purp-700"
                                />
                                {cacFile ? (
                                  <p className="text-xs text-neutral-500">Selected file: {cacFile.name}</p>
                                ) : null}
                                {merchant?.cac_document_url ? (
                                  <p className="text-xs text-emerald-600">Existing document already uploaded.</p>
                                ) : null}
                              </div>
                            ) : null}

                            {requiresUtilityBill ? (
                              <div className="space-y-2">
                                <Label className="flex items-center gap-2 text-sm font-medium">
                                  <Upload className="h-4 w-4 text-purp-700" />
                                  Proof of Business Address
                                  {statusBadge(merchant?.utility_status)}
                                </Label>
                                <Input
                                  type="file"
                                  accept=".pdf,.png,.jpg,.jpeg"
                                  onChange={(event) => setUtilityFile(event.target.files?.[0] || null)}
                                  className="h-11 border-2 border-purp-200 bg-white file:mr-3 file:rounded-md file:border-0 file:bg-purp-100 file:px-3 file:py-1 file:text-sm file:font-medium file:text-purp-700"
                                />
                                {utilityFile ? (
                                  <p className="text-xs text-neutral-500">Selected file: {utilityFile.name}</p>
                                ) : null}
                                {merchant?.utility_document_url ? (
                                  <p className="text-xs text-emerald-600">Existing utility document already uploaded.</p>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                          <div className="pt-2">
                            <Button
                              onClick={handleKycSubmit}
                              disabled={
                                kycSubmitting ||
                                (requiresBvn && bvnNumber.trim().length !== 11) ||
                                (requiresSelfie &&
                                  !(merchant?.selfie_status === "verified" ||
                                    merchant?.selfie_status === "pending" ||
                                    livenessImages.length > 0 ||
                                    selfieFile ||
                                    merchant?.selfie_url)) ||
                                (requiresBusinessRegistration && !merchant?.cac_number && cacNumber.trim().length < 5) ||
                                (requiresBusinessDocument && !cacFile && !merchant?.cac_document_url) ||
                                (requiresUtilityBill && !utilityFile && !merchant?.utility_document_url)
                              }
                              className="bg-purp-900 text-white hover:bg-purp-800"
                            >
                              <Save className="mr-2 h-4 w-4" />
                              {kycSubmitting ? "Submitting..." : "Submit for Review"}
                            </Button>
                          </div>
                          </>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </SectionCard>

                  {requiresDirectorApprovalFlow ? (
                    <SectionCard
                      title={
                        merchant?.relationship_claim === "representative_claim"
                          ? "Business & Director Approval Progress"
                          : "Director Match & Business Authority"
                      }
                      description={
                        merchant?.relationship_claim === "representative_claim"
                          ? "You are registering this business as a representative. We will verify your identity, confirm the business, and ask a listed director to approve your access."
                          : "You are registering as a director or owner. We will verify your identity, match it to the business record, and complete the business checks."
                      }
                    >
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-neutral-900">Authority status</p>
                              <p className="text-sm text-neutral-500">
                                {authorityApproved
                                  ? approvedDirectorName
                                    ? `Approved by ${approvedDirectorName}. This section is now complete.`
                                    : "Authority matched automatically from verified business records."
                                  : merchant?.relationship_claim === "representative_claim"
                                  ? "Director approval is still required before payment collection can start."
                                  : "Director match is still pending and cannot be assumed from identity alone."}
                              </p>
                            </div>
                            {statusBadge(merchant?.business_affiliation_status)}
                          </div>
                        </div>

                        {merchant?.business_affiliation_status === "partial_match" && directorAffiliation ? (
                          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                            <div className="space-y-2">
                              <p className="text-sm font-semibold text-amber-900">
                                Director match needs confirmation
                              </p>
                              <p className="text-sm text-amber-800">
                                We found a similar name in the registry, but it does not fully match the name you entered.
                              </p>
                              <div className="space-y-1 text-sm text-amber-800">
                                <p>Entered name: {ownerName || "Not provided"}</p>
                                <p>Closest registry name: {directorAffiliation.matched_registry_name || "Not available"}</p>
                                <p>Role: {closestRegistryDirector?.role || "Director"}</p>
                              </div>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {(directorAffiliation.match_score ?? 0) >= 60 ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="border-amber-300 text-amber-900 hover:bg-amber-100"
                                  onClick={() => {
                                    if (directorAffiliation.matched_registry_name) {
                                      setOwnerName(directorAffiliation.matched_registry_name);
                                    }
                                  }}
                                >
                                  Use registry name
                                </Button>
                              ) : null}
                              <Button
                                type="button"
                                variant="outline"
                                className="border-amber-300 text-amber-900 hover:bg-amber-100"
                                onClick={handleManualReviewRequest}
                              >
                                Request manual review
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className="border-amber-300 text-amber-900 hover:bg-amber-100"
                                onClick={() => {
                                  if (closestRegistryDirector?.id || closestRegistryDirector?.name) {
                                    setSelectedRegistryDirector(
                                      closestRegistryDirector.id || closestRegistryDirector.name || "",
                                    );
                                  }
                                  setDirectorInviteMessage("Invite flow prepared for the listed director.");
                                }}
                              >
                                Invite listed director instead
                              </Button>
                            </div>
                          </div>
                        ) : null}

                        {registrySnapshot ? (
                          <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                            <div className="space-y-2">
                              <p className="text-sm font-semibold text-neutral-900">Registry snapshot</p>
                              <p className="text-sm text-neutral-500">
                                {registrySnapshot.registered_name || "Registered business"} • RC{" "}
                                {registrySnapshot.registration_number || merchant?.cac_number || "pending"}
                              </p>
                            </div>
                            {closestRegistryDirector ? (
                              <div className="mt-3 rounded-xl border border-white bg-white p-3">
                                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                  Closest match
                                </p>
                                <p className="mt-1 text-sm font-medium text-neutral-900">
                                  {closestRegistryDirector.name || "Unnamed director"}
                                </p>
                                <p className="text-xs text-neutral-500">
                                  {closestRegistryDirector.role || "Director"}
                                </p>
                              </div>
                            ) : null}
                            <details className="mt-3 rounded-xl border border-white bg-white p-3">
                              <summary className="cursor-pointer text-sm font-medium text-neutral-900">
                                View all registry names
                              </summary>
                              <div className="mt-3 space-y-3">
                                {Object.keys(registryDirectorsByRole).length > 0 ? (
                                  Object.entries(registryDirectorsByRole).map(([role, directorsForRole]) => (
                                    <div key={role} className="space-y-2">
                                      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                        {role}
                                      </p>
                                      <div className="space-y-2">
                                        {directorsForRole.map((director) => (
                                          <div
                                            key={`${director.id || director.name}-${director.role}`}
                                            className="flex items-center justify-between rounded-xl border border-neutral-200 bg-neutral-50 p-3"
                                          >
                                            <div>
                                              <p className="text-sm font-medium text-neutral-900">
                                                {director.name || "Unnamed director"}
                                              </p>
                                              <p className="text-xs text-neutral-500">{director.role || "Director"}</p>
                                            </div>
                                            {approvedDirectorName === director.name ? (
                                              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                                                Approved
                                              </Badge>
                                            ) : null}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-sm text-neutral-500">
                                    Registry directors have not been synced yet.
                                  </p>
                                )}
                              </div>
                            </details>
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
                            Verify the business registration number first to load listed directors and approval options.
                          </div>
                        )}

                        {needsDirectorApproval ? (
                          <div className="space-y-4 rounded-2xl border border-purp-200 bg-purp-50/40 p-4">
                            <div className="space-y-1">
                              <p className="text-sm font-semibold text-purp-900">Director approval invite</p>
                              <p className="text-sm leading-6 text-neutral-600">
                                Use this when a listed director needs to approve the account.
                              </p>
                            </div>

                            <div className="grid gap-4">
                              <div className="space-y-2">
                                <Label className="text-sm font-medium">Select listed director</Label>
                                <Select
                                  value={selectedRegistryDirector || null}
                                  onValueChange={(value) => setSelectedRegistryDirector(value ?? "")}
                                >
                                  <SelectTrigger className="h-11 border-2 border-purp-200 bg-white">
                                    <SelectValue placeholder="Choose a registry director" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {uniqueRegistryDirectors.map((director) => (
                                      <SelectItem
                                        key={director.id || director.name}
                                        value={director.id || director.name || ""}
                                      >
                                        {director.name || "Unnamed director"} {director.role ? `(${director.role})` : ""}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="space-y-2">
                                <Label className="text-sm font-medium">Director email</Label>
                                <Input
                                  type="email"
                                  value={directorInviteEmail}
                                  onChange={(event) => setDirectorInviteEmail(event.target.value)}
                                  placeholder="director@company.com"
                                  className="h-11 border-2 border-purp-200 bg-white"
                                />
                              </div>

                            <div className="flex flex-wrap gap-3">
                              <Button
                                onClick={handleCreateDirectorInvitation}
                                disabled={
                                  directorInviteSubmitting ||
                                  Boolean(pendingDirectorInvite) ||
                                  !selectedRegistryDirector ||
                                  !directorInviteEmail.trim()
                                }
                                className="bg-purp-900 text-white hover:bg-purp-800"
                              >
                                  {directorInviteSubmitting
                                    ? "Sending..."
                                    : pendingDirectorInvite
                                    ? "Invite pending"
                                    : "Send approval invite"}
                              </Button>
                              </div>
                            {directorInviteMessage || pendingDirectorInvite || lastDirectorInvite ? (
                              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                                <p className="font-medium">
                                  {directorInviteMessage || "Director approval request sent."}
                                </p>
                                <p className="mt-1">
                                  {lastDirectorInvite?.directorName || pendingDirectorInvite?.selected_director_name || "Selected director"}{" "}
                                  {pendingDirectorInvite?.status ? `- ${directorInvitationStatusLabel(pendingDirectorInvite.status)}` : null}
                                </p>
                                <p className="text-xs text-emerald-700">
                                  {lastDirectorInvite?.email || directorInviteEmail || "Director email not captured"}
                                </p>
                              </div>
                            ) : null}
                            {directorInviteError ? (
                              <p className="text-sm text-red-700">{directorInviteError}</p>
                            ) : null}
                            </div>
                          </div>
                        ) : null}

                        {shouldShowManualFallback ? (
                          <details className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                            <summary className="cursor-pointer text-sm font-semibold text-neutral-900">
                              Need help confirming director?
                            </summary>
                            <div className="mt-4 grid gap-4">
                              <div className="grid gap-4 lg:grid-cols-2">
                                <div className="space-y-2">
                                  <Label className="text-sm font-medium">Director name</Label>
                                  <Input
                                    value={newDirectorName}
                                    onChange={(event) => setNewDirectorName(event.target.value)}
                                    placeholder="Full legal name"
                                    className="h-11 border-2 border-purp-200 bg-white"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label className="text-sm font-medium">Role</Label>
                                  <Select
                                    value={newDirectorRole}
                                    onValueChange={(value) =>
                                      setNewDirectorRole((value as DirectorRole | null) || "director")
                                    }
                                  >
                                    <SelectTrigger className="h-11 border-2 border-purp-200 bg-white">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="director">Director</SelectItem>
                                      <SelectItem value="shareholder">Shareholder</SelectItem>
                                      <SelectItem value="beneficial_owner">Beneficial Owner</SelectItem>
                                      <SelectItem value="signatory">Authorized Signatory</SelectItem>
                                      <SelectItem value="proprietor">Proprietor</SelectItem>
                                      <SelectItem value="partner">Partner</SelectItem>
                                      <SelectItem value="trustee">Trustee</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>

                              <Button
                                variant="outline"
                                className="w-full border-2 border-purp-200 text-purp-700 hover:bg-purp-50"
                                disabled={!newDirectorName.trim()}
                                onClick={() =>
                                  setActiveDirectorToVerify({
                                    name: newDirectorName.trim(),
                                    role: newDirectorRole,
                                  })
                                }
                              >
                                <Plus className="mr-2 h-4 w-4" />
                                Verify this director once
                              </Button>
                            </div>
                          </details>
                        ) : null}

                          <div className="space-y-3">
                            <p className="text-sm font-semibold text-neutral-900">Director activity</p>
                            <div className="space-y-2">
                              {directorsLoading ? (
                                <p className="text-sm text-neutral-500">Loading director verification history...</p>
                              ) : directors.length > 0 ? (
                              directors.map((director) => (
                                <div
                                  key={director.id}
                                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-3"
                                >
                                  <div>
                                    <p className="text-sm font-medium text-neutral-900">
                                      {director.director_name || "Unnamed director"}
                                    </p>
                                    <p className="text-xs text-neutral-500">
                                      {director.director_role || "Director"}
                                    </p>
                                  </div>
                                  {statusBadge(director.verification_status)}
                                </div>
                              ))
                            ) : (
                              <p className="text-sm text-neutral-500">
                                No manual director verifications have been recorded yet.
                              </p>
                            )}
                          </div>

                          <div className="space-y-2">
                            {directorInvitations.length > 0 ? (
                              directorInvitations.map((invite) => (
                                <div
                                  key={invite.id}
                                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-3"
                                >
                                  <div>
                                    <p className="text-sm font-medium text-neutral-900">
                                      {invite.selected_director_name || "Director invite"}
                                    </p>
                                    <p className="text-xs text-neutral-500">
                                      {directorInvitationStatusLabel(invite.status)}
                                    </p>
                                  </div>
                                  {statusBadge(invite.status)}
                                </div>
                              ))
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </SectionCard>
                  ) : null}
                </div>
              </div>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="profile" className="space-y-6">
          <SectionCard
            title="Business Profile"
            description="Update the business details shown on invoices, payment pages, and verification records."
            action={
              merchant?.permissions && !merchant.permissions.manage_business ? null : (
                <Button
                  onClick={handleSaveProfile}
                  disabled={savingProfile}
                  className="bg-purp-900 text-white hover:bg-purp-800"
                >
                  <Save className="mr-2 h-4 w-4" />
                  {savingProfile ? "Saving..." : "Save Business Profile"}
                </Button>
              )
            }
          >
            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Trading Name <span className="text-red-500">*</span>
                  </Label>
                  <p className="text-xs text-neutral-500">
                    This name is shown to customers on invoices and payment pages.
                  </p>
                  <Input
                    value={tradingName}
                    onChange={(event) => setTradingName(event.target.value)}
                    placeholder="e.g. DeraLedger Consulting"
                    className="h-11 border-2 border-purp-200 bg-purp-50"
                  />
                </div>

                {requiresBusinessRegistration ? (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      Business Type <span className="text-red-500">*</span>
                    </Label>
                    <Select
                      value={businessType || null}
                      onValueChange={(value) => {
                        if (!isOwnerNameLocked || !merchant?.business_type) {
                          setBusinessType(value ?? "sole_proprietorship");
                        }
                      }}
                    >
                      <SelectTrigger className="h-11 border-2 border-purp-200 bg-purp-50">
                        <SelectValue placeholder="Choose business type" />
                      </SelectTrigger>
                      <SelectContent>
                        {BUSINESS_TYPE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {requiresBusinessRegistration ? (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      Registered Business Name <span className="text-red-500">*</span>
                    </Label>
                    <p className="text-xs text-neutral-500">
                      This should match the official business name on the registration record.
                    </p>
                    <label className="flex items-center gap-3 rounded-xl border border-purp-200 bg-purp-50/50 p-3 text-sm text-neutral-700">
                      <input
                        type="checkbox"
                        checked={businessName.trim() !== "" && businessName.trim() === tradingName.trim()}
                        onChange={(event) => {
                          if (event.target.checked) {
                            setBusinessName(tradingName);
                          } else {
                            setBusinessName("");
                          }
                        }}
                        disabled={Boolean(merchant?.cac_number)}
                        className="h-4 w-4 accent-purp-700"
                      />
                      Same as Trading Name
                    </label>
                    {!(businessName.trim() !== "" && businessName.trim() === tradingName.trim()) ? (
                      <Input
                        value={businessName}
                        onChange={(event) => setBusinessName(event.target.value)}
                        disabled={Boolean(merchant?.cac_number)}
                        placeholder="Registered business name"
                        className={`h-11 border-2 ${
                          merchant?.cac_number
                            ? "cursor-not-allowed border-emerald-200 bg-emerald-50 text-emerald-900"
                            : "border-purp-200 bg-purp-50"
                        }`}
                      />
                    ) : null}
                    {merchant?.cac_number ? (
                      <p className="text-xs text-emerald-600">
                        Registration is already verified, so the registered business name should no longer drift.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {!isStarter ? (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      {profileNameLabel} <span className="text-red-500">*</span>
                    </Label>
                    <p className="text-xs text-neutral-500">
                      {isOwnerNameLocked
                        ? "Verified Details"
                        : requiresDirectorApprovalFlow && merchant?.relationship_claim === "representative_claim"
                        ? "This should match the person opening this account. Director approval is handled separately."
                        : "This name should match your BVN and the business registration record."}
                    </p>
                    <Input
                      value={ownerName}
                      onChange={(event) => {
                        if (!isOwnerNameLocked) {
                          setOwnerName(event.target.value);
                        }
                      }}
                      disabled={isOwnerNameLocked}
                      placeholder="Full legal name"
                      className={`h-11 border-2 ${
                        isOwnerNameLocked
                          ? "cursor-not-allowed border-emerald-200 bg-emerald-50 text-emerald-900"
                          : "border-purp-200 bg-purp-50"
                      }`}
                    />
                  </div>
                ) : null}

                {!isStarter ? (
                  <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                    <div className="space-y-4">
                      <div>
                        <p className="text-sm font-semibold text-neutral-900">Business Address</p>
                        <p className="text-xs text-neutral-500">
                          This should match the business address on your proof of address document.
                        </p>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2 sm:col-span-2">
                          <Label className="text-xs font-medium">
                            Street Address <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            value={businessStreet}
                            onChange={(event) => setBusinessStreet(event.target.value)}
                            placeholder="12 Admiralty Way"
                            className="h-11 border-2 border-purp-200 bg-white"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label className="text-xs font-medium">
                            City <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            value={businessCity}
                            onChange={(event) => setBusinessCity(event.target.value)}
                            placeholder="Lekki"
                            className="h-11 border-2 border-purp-200 bg-white"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label className="text-xs font-medium">
                            Country <span className="text-red-500">*</span>
                          </Label>
                          <Select
                            value={businessCountry || null}
                            onValueChange={(value) => {
                              setBusinessCountry(value ?? "");
                              setBusinessState("");
                            }}
                          >
                            <SelectTrigger className="h-11 border-2 border-purp-200 bg-white">
                              <SelectValue placeholder="Select country" />
                            </SelectTrigger>
                            <SelectContent>
                              {Country.getAllCountries().map((country) => (
                                <SelectItem key={country.isoCode} value={country.isoCode}>
                                  {country.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-xs font-medium">
                            State / Province <span className="text-red-500">*</span>
                          </Label>
                          <Select
                            value={businessState || null}
                            onValueChange={(value) => setBusinessState(value ?? "")}
                          >
                            <SelectTrigger className="h-11 border-2 border-purp-200 bg-white">
                              <SelectValue placeholder="Select state" />
                            </SelectTrigger>
                            <SelectContent>
                              {State.getStatesOfCountry(businessCountry).map((state) => (
                                <SelectItem key={state.isoCode} value={state.isoCode}>
                                  {state.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Email</Label>
                    <Input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="h-11 border-2 border-purp-200 bg-purp-50"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      Phone {!isStarter ? <span className="text-red-500">*</span> : null}
                    </Label>
                    <Input
                      type="tel"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      className="h-11 border-2 border-purp-200 bg-purp-50"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-5">
                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-neutral-900">Field lock summary</p>
                    <ChecklistRow
                      title="Verified Details"
                      description="Owner or representative name locks after a successful BVN and selfie match."
                      status={isOwnerNameLocked ? "complete" : "pending"}
                    />
                    <ChecklistRow
                      title="Registered business details"
                      description="Registration verification prevents the official business name from drifting after business checks."
                      status={merchant?.cac_number ? "complete" : "pending"}
                    />
                  </div>
                </div>

                <div className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4">
                  <div>
                    <p className="text-sm font-semibold text-neutral-900">Business Logo</p>
                    <p className="text-xs text-neutral-500">
                      This upload is separate from verification and saves immediately.
                    </p>
                  </div>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-purp-200 bg-purp-50">
                      {logoUrl ? (
                        <Image
                          src={logoUrl}
                          alt="Business logo"
                          width={80}
                          height={80}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-2xl font-bold text-purp-700">
                          {(tradingName || businessName || "B").charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <div className="relative">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleLogoUpload}
                          disabled={uploadingLogo}
                          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                        />
                        <Button variant="outline" disabled={uploadingLogo} className="pointer-events-none border-2 border-purp-200 text-purp-700">
                          {uploadingLogo ? "Uploading..." : "Upload Logo"}
                        </Button>
                      </div>
                      {logoUrl ? (
                        <Button
                          variant="outline"
                          disabled={uploadingLogo}
                          onClick={handleRemoveLogo}
                          className="border-2 border-red-200 text-red-700 hover:bg-red-50"
                        >
                          Remove Logo
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="settlement" className="space-y-6">
          <SectionCard
            title="Payout Account"
            description="Add the bank account where customer payments should be sent. This must be completed before payment collection starts."
            action={
              !requiresSettlementAccount ? null : (
                <Link href="/settings/settlement-accounts">
                  <Button className="bg-purp-900 text-white hover:bg-purp-800">
                    Manage Settlement Account
                  </Button>
                </Link>
              )
            }
          >
            {!requiresSettlementAccount ? (
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 text-sm text-neutral-600">
                Payout account is not needed on Starter. Upgrade to a payment collection plan to add the bank account where payouts should be sent.
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
                <div className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-neutral-900">Current payout account</p>
                      <p className="text-xs text-neutral-500">
                        This is the bank account that will receive customer payments.
                      </p>
                    </div>
                    {settlementConfigured ? (
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                        Configured
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                        Incomplete
                      </Badge>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                      <p className="text-xs font-medium text-neutral-500">Bank</p>
                      <p className="mt-1 text-sm font-semibold text-neutral-900">
                        {merchant?.settlement_bank_name || "Not configured"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                      <p className="text-xs font-medium text-neutral-500">Account Number</p>
                      <p className="mt-1 text-sm font-semibold text-neutral-900">
                        {maskAccountNumber(merchant?.settlement_account_number)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 sm:col-span-2">
                      <p className="text-xs font-medium text-neutral-500">Account Name</p>
                      <p className="mt-1 text-sm font-semibold text-neutral-900">
                        {merchant?.settlement_account_name || "Not configured"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <ChecklistRow
                    title="Payout account added"
                    description="Add and verify a payout account before payment collection can start."
                    status={settlementConfigured ? "complete" : "pending"}
                  />
                  <ChecklistRow
                    title="Verification still required"
                    description="Adding a payout account does not replace identity, business, or director verification."
                    status={liveFeaturesActive ? "complete" : "pending"}
                  />
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700">
                    Payout account setup is shown separately so merchants can complete it without digging through verification forms.
                  </div>
                </div>
              </div>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="fees" className="space-y-6">
          <SectionCard
            title="Payment Fee Settings"
            description="Who pays payment charges can be managed separately from profile and verification. This section has its own save action."
            action={
              merchant?.permissions && !merchant.permissions.change_fee_settings ? null : (
                <Button
                  onClick={handleSaveFeeSettings}
                  disabled={savingFeeSettings}
                  className="bg-purp-900 text-white hover:bg-purp-800"
                >
                  <Save className="mr-2 h-4 w-4" />
                  {savingFeeSettings ? "Saving..." : "Save Fee Settings"}
                </Button>
              )
            }
          >
            <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Who pays payment charges?</Label>
                  <Select
                    value={feeDefault}
                    onValueChange={(value) =>
                      setFeeDefault(((value as "business" | "customer" | null) || "business"))
                    }
                  >
                    <SelectTrigger className="h-11 max-w-sm border-2 border-purp-200 bg-purp-50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="business">Business pays</SelectItem>
                      <SelectItem value="customer">Customer pays</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="rounded-2xl border border-purp-200 bg-purp-50 p-4 text-sm text-neutral-600">
                  <p>
                    <strong className="text-purp-900">How this works:</strong> this is only the default for
                    new invoices and payment links. It can still be overridden per invoice where allowed.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <ChecklistRow
                  title="Fee ownership policy"
                  description="Keep a clear default so staff do not accidentally change who bears charges from one invoice to another."
                  status="complete"
                />
                <ChecklistRow
                  title="Independent save control"
                  description="This section now saves independently, so changing a fee policy does not quietly modify business profile data."
                  status="complete"
                />
              </div>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="billing" className="space-y-6">
          <SectionCard
            title="Billing & Subscription"
            description="Your plan, upgrade path, and billing management are separate from business verification and profile editing."
            action={
              <Link href="/settings/billing">
                <Button className="bg-purp-900 text-white hover:bg-purp-800">
                  Open Billing
                </Button>
              </Link>
            }
          >
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-neutral-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Current plan
                </p>
                <p className="mt-2 text-lg font-semibold text-neutral-900">
                  {formatPlanLabel(effectiveTier)}
                </p>
                <p className="mt-2 text-sm text-neutral-500">
                  {getCollectionLimitLabel(effectiveTier)}. Upgrade when you need more collection capability or business controls.
                </p>
              </div>

              <div className="rounded-2xl border border-neutral-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Recommended next step
                </p>
                <p className="mt-2 text-sm font-semibold text-neutral-900">
                  {isStarter
                    ? "Upgrade to Individual or Business"
                    : isIndividual
                    ? "Complete your Individual verification to start collecting payments"
                    : "Complete Business verification"}
                </p>
                <p className="mt-2 text-sm text-neutral-500">
                  {nextLiveUnlockStep || "Open billing to manage renewals, status, and history."}
                </p>
              </div>

              <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4">
                {isStarter ? (
                  <>
                    <Link
                      href="/settings/upgrade/individual"
                      className="flex items-center justify-between rounded-xl border border-purp-200 px-4 py-3 text-sm font-medium text-purp-900 transition hover:bg-purp-50"
                    >
                      Upgrade to Individual
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    <Link
                      href="/settings/upgrade/corporate"
                      className="flex items-center justify-between rounded-xl border border-purp-200 px-4 py-3 text-sm font-medium text-purp-900 transition hover:bg-purp-50"
                    >
                      Upgrade to Business
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </>
                ) : isIndividual ? (
                  <>
                    <Link
                      href="/settings/billing"
                      className="flex items-center justify-between rounded-xl border border-purp-200 px-4 py-3 text-sm font-medium text-purp-900 transition hover:bg-purp-50"
                    >
                      Complete Verification
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    <Link
                      href="/settings/upgrade/corporate"
                      className="flex items-center justify-between rounded-xl border border-purp-200 px-4 py-3 text-sm font-medium text-purp-900 transition hover:bg-purp-50"
                    >
                      Upgrade to Business
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </>
                ) : (
                  <>
                    <Link
                      href="/settings/billing"
                      className="flex items-center justify-between rounded-xl border border-purp-200 px-4 py-3 text-sm font-medium text-purp-900 transition hover:bg-purp-50"
                    >
                      Complete Business Verification
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    <Link
                      href="/settings/billing"
                      className="flex items-center justify-between rounded-xl border border-purp-200 px-4 py-3 text-sm font-medium text-purp-900 transition hover:bg-purp-50"
                    >
                      Manage Billing
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </>
                )}
              </div>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="tools" className="space-y-6">
          <SectionCard
            title="Business Tools"
            description="Operational tools are grouped here so merchants can navigate without the settings page growing into one long unstructured list."
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Link
                href="/clients"
                className="rounded-2xl border border-purp-200 bg-white p-4 transition hover:bg-purp-50"
              >
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-purp-900">Clients</p>
                  <ExternalLink className="h-4 w-4 text-purp-400" />
                </div>
                <p className="mt-2 text-sm text-neutral-500">
                  Manage client records and reminders.
                </p>
              </Link>

              <Link
                href="/settings/catalog"
                className="rounded-2xl border border-purp-200 bg-white p-4 transition hover:bg-purp-50"
              >
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-purp-900">Item Catalog</p>
                  <ExternalLink className="h-4 w-4 text-purp-400" />
                </div>
                <p className="mt-2 text-sm text-neutral-500">
                  Reusable products and services for invoicing.
                </p>
              </Link>

              <Link
                href="/settings/discount-templates"
                className="rounded-2xl border border-purp-200 bg-white p-4 transition hover:bg-purp-50"
              >
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-purp-900">Discount Templates</p>
                  <ExternalLink className="h-4 w-4 text-purp-400" />
                </div>
                <p className="mt-2 text-sm text-neutral-500">
                  Save discount presets for faster quoting.
                </p>
              </Link>

              <Link
                href="/settings/billing"
                className="rounded-2xl border border-purp-200 bg-white p-4 transition hover:bg-purp-50"
              >
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-purp-900">Billing History</p>
                  <ExternalLink className="h-4 w-4 text-purp-400" />
                </div>
                <p className="mt-2 text-sm text-neutral-500">
                  View payment history, renewals, and subscription activity.
                </p>
              </Link>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="advanced" className="space-y-6">
          <SectionCard
            title="Advanced Settings"
            description="Operational guidance, lock-state explanation, and specialist links live here instead of being mixed with profile save actions."
          >
            <div className="grid gap-4 lg:grid-cols-[1fr_0.95fr]">
              <div className="space-y-4">
                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                  <p className="text-sm font-semibold text-neutral-900">Why fields lock after verification</p>
                  <p className="mt-2 text-sm leading-6 text-neutral-600">
                    After verification, legal identity and business details can only be changed after review.
                    This protects your account and prevents mistakes.
                  </p>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-white p-4">
                  <p className="text-sm font-semibold text-neutral-900">Requesting a change</p>
                  <p className="mt-2 text-sm leading-6 text-neutral-600">
                    If a verified detail is wrong, contact support or request admin review.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <Link
                  href="/settings/settlement-accounts"
                  className="flex items-center justify-between rounded-2xl border border-purp-200 bg-white px-4 py-4 transition hover:bg-purp-50"
                >
                  <div>
                    <p className="font-semibold text-purp-900">Settlement Accounts</p>
                    <p className="mt-1 text-sm text-neutral-500">Open the dedicated payout account manager.</p>
                  </div>
                  <ExternalLink className="h-4 w-4 text-purp-400" />
                </Link>

                <Link
                  href="/team"
                  className="flex items-center justify-between rounded-2xl border border-purp-200 bg-white px-4 py-4 transition hover:bg-purp-50"
                >
                  <div>
                    <p className="font-semibold text-purp-900">Team & Roles</p>
                    <p className="mt-1 text-sm text-neutral-500">Manage operational access separately from verification.</p>
                  </div>
                  <ExternalLink className="h-4 w-4 text-purp-400" />
                </Link>
              </div>
            </div>
          </SectionCard>
        </TabsContent>
      </Tabs>

      {showLivenessCamera ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md">
            <LivenessCamera
              onComplete={(images) => {
                setLivenessImages(images);
                setShowLivenessCamera(false);
              }}
              onCancel={() => setShowLivenessCamera(false)}
              onFallback={(error) => {
                setLivenessFallback(true);
                setShowLivenessCamera(false);
                setKycError(`Camera failed: ${error}. Please use the manual file upload.`);
              }}
            />
          </div>
        </div>
      ) : null}

      {activeDirectorToVerify && merchant ? (
        <DirectorSelfieModal
          merchantId={merchant.id}
          directorName={activeDirectorToVerify.name}
          directorRole={activeDirectorToVerify.role}
          onClose={() => setActiveDirectorToVerify(null)}
          onSuccess={async () => {
            await loadDirectors(merchant.id);
            await loadDirectorApprovalContext(merchant.id);
            setActiveDirectorToVerify(null);
          }}
        />
      ) : null}
    </div>
  );
}
