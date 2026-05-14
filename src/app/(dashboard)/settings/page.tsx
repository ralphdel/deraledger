"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { Save, Shield, Upload, FileCheck, AlertTriangle, CheckCircle, Clock, ArrowRight, ExternalLink, Lock, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { getMerchant } from "@/lib/data";
import { submitDojahKycAction, submitKycAction } from "@/lib/actions";
import { CreateClientModal } from "@/components/CreateClientModal";
import { LivenessCamera } from "@/components/kyc/liveness-camera";
import { createClient } from "@/lib/supabase/client";
import type { Merchant } from "@/lib/types";

const CURRENT_PLATFORM_VERSION = 1;

export default function SettingsPage() {
  const [businessName, setBusinessName] = useState("");
  const [tradingName, setTradingName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [feeDefault, setFeeDefault] = useState<"business" | "customer">("business");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [merchant, setMerchant] = useState<Merchant | null>(null);

  // KYC state
  const [cacFile, setCacFile] = useState<File | null>(null);
  const [cacNumber, setCacNumber] = useState("");
  const [utilityFile, setUtilityFile] = useState<File | null>(null);
  const [bvnNumber, setBvnNumber] = useState("");
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [kycSubmitting, setKycSubmitting] = useState(false);
  const [kycSuccess, setKycSuccess] = useState(false);
  const [kycError, setKycError] = useState<string | null>(null);
  const [upgradingPlan, setUpgradingPlan] = useState<string | null>(null);

  // Logo state
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  const [livenessImages, setLivenessImages] = useState<string[]>([]);
  const [showLivenessCamera, setShowLivenessCamera] = useState(false);
  const [livenessFallback, setLivenessFallback] = useState(false);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !merchant) return;

    setUploadingLogo(true);
    setKycError(null);
    try {
      const supabase = createClient();
      const fileExt = file.name.split('.').pop();
      const fileName = `${merchant.id}_${Date.now()}.${fileExt}`;
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('merchant_logos')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('merchant_logos')
        .getPublicUrl(fileName);

      // Save to database
      await submitKycAction(merchant.id, { logo_url: publicUrl });
      
      setLogoUrl(publicUrl);
      setMerchant({ ...merchant, logo_url: publicUrl } as Merchant);
    } catch (err: any) {
      console.error("Error uploading logo:", err);
      setKycError("Failed to upload logo: " + err.message + ". Please ensure your database storage policies are set up correctly.");
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
      setMerchant({ ...merchant, logo_url: null } as Merchant);
    } catch (err: any) {
      console.error("Error removing logo:", err);
      setKycError("Failed to remove logo: " + err.message);
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleUpgrade = async (newPlan: "individual" | "corporate") => {
    setUpgradingPlan(newPlan);
    setKycError(null);
    try {
      const res = await fetch("/api/payment/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPlan }),
      });
      const data = await res.json();
      if (data.authorizationUrl) {
        window.location.href = data.authorizationUrl;
      } else {
        setKycError(data.error || "Failed to initialize upgrade");
        setUpgradingPlan(null);
      }
    } catch (e) {
      setKycError("An error occurred while initializing upgrade");
      setUpgradingPlan(null);
    }
  };

  useEffect(() => {
    getMerchant().then((m) => {
      if (m) {
        setMerchant(m);
        const tier = m.subscription_plan || m.merchant_tier || "starter";
        const hasConfirmed = (m.platform_version ?? 0) >= 1;
        // For Corporate: only prefill business_name if they've already confirmed (platform_version >= 1)
        // Otherwise leave blank so they must explicitly set or toggle "Same as Trading Name"
        if (tier === "corporate" && !hasConfirmed) {
          setBusinessName("");
        } else {
          setBusinessName(m.business_name || "");
        }
        setTradingName(m.trading_name || m.business_name || "");
        setOwnerName(m.owner_name || "");
        setEmail(m.email);
        setPhone(m.phone || "");
        setFeeDefault(m.fee_absorption_default);
        setBvnNumber(/^\d{11}$/.test(m.bvn || "") ? (m.bvn || "") : "");
        setCacNumber(m.cac_number || "");
        setLogoUrl(m.logo_url || null);
      }
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    if (!merchant) return;
    setSaving(true);
    const effectiveTier = merchant.subscription_plan || merchant.merchant_tier || "starter";
    const updates: Record<string, unknown> = {
      business_name: effectiveTier === "corporate" ? (businessName || tradingName) : (tradingName || businessName),
      trading_name: tradingName,
      owner_name: ownerName || null,
      phone: phone || null,
      fee_absorption_default: feeDefault,
      platform_version: CURRENT_PLATFORM_VERSION,
    };
    await submitKycAction(merchant.id, updates);
    setMerchant({ ...merchant, ...updates } as Merchant);
    setSaving(false);
  };

  const handleKycSubmit = async () => {
    if (!merchant) return;

    if (!bvnNumber || (livenessImages.length === 0 && !selfieFile)) {
      setKycError("Please provide your BVN and complete the selfie verification.");
      return;
    }

    // Corporate accounts must provide CAC evidence to be meaningful
    if (isCorporate && !cacNumber && !cacFile) {
      setKycError("Business accounts require a CAC Number or CAC Certificate. Please provide at least one to proceed.");
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
      let finalSelfieBase64: string | string[];
      let finalSelfieFileName: string | string[];

      if (livenessImages.length > 0) {
        finalSelfieBase64 = livenessImages;
        finalSelfieFileName = livenessImages.map((_, i) => `liveness-${i}-${Date.now()}.jpg`);
      } else {
        finalSelfieBase64 = await toBase64(selfieFile!);
        finalSelfieFileName = selfieFile!.name;
      }

      const { success, error, updates } = await submitDojahKycAction({
        merchantId: merchant.id,
        bvn: bvnNumber,
        selfieBase64: finalSelfieBase64,
        selfieFileName: finalSelfieFileName,
        cacNumber: cacNumber || undefined,
        cacDocumentName: cacFile?.name,
        utilityDocumentName: utilityFile?.name,
      });

      if (success) {
        setMerchant({ ...merchant, ...(updates || {}) } as Merchant);
        setKycSuccess(true);
        setKycError(null);
      } else {
        if (updates) setMerchant({ ...merchant, ...updates } as Merchant);
        setKycError("Submission failed: " + error);
      }
    } catch (err) {
      setKycError(err instanceof Error ? err.message : "Could not read selfie image.");
    } finally {
      setKycSubmitting(false);
    }
  };

  const renderStatusBadge = (status: string | undefined) => {
    if (!status || status === "unverified") return null;
    if (status === "verified") return <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 text-xs ml-2"><CheckCircle className="mr-1 h-3 w-3" /> Verified</Badge>;
    if (status === "rejected") return <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 text-xs ml-2"><AlertTriangle className="mr-1 h-3 w-3" /> Rejected</Badge>;
    return <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 text-xs ml-2"><Clock className="mr-1 h-3 w-3" /> Pending</Badge>;
  };

  const verificationStatus = merchant?.verification_status || "unverified";
  const effectiveTier = merchant?.subscription_plan || merchant?.merchant_tier || "starter";
  const isStarter = effectiveTier === "starter";
  const isIndividual = effectiveTier === "individual";
  const isCorporate = effectiveTier === "corporate";
  const ownerLabel = isCorporate ? "Highest Shareholder's Full Name" : "Owner's Full Name";
  // If Individual/Corporate and owner_name is missing, treat as unverified
  const ownerNameMissing = !isStarter && !ownerName.trim();
  // If Corporate and business_name (registered name) is missing, also block
  const businessNameMissing = isCorporate && !businessName.trim();
  const profileIncomplete = ownerNameMissing || businessNameMissing;
  const effectiveVerificationStatus = profileIncomplete ? "unverified" : verificationStatus;

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div><h1 className="text-2xl font-bold text-purp-900">Settings</h1></div>
        <Card className="border-2 border-purp-200 shadow-none animate-pulse">
          <CardContent className="p-6"><div className="h-40 bg-purp-50 rounded" /></CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-purp-900">Settings</h1>
        <p className="text-neutral-500 text-sm mt-1">
          Manage your business profile and account preferences
        </p>
      </div>

      {/* ── KYC Verification Section ── */}
      {(!merchant?.permissions || merchant.permissions.manage_kyc) && (
      <Card className={`border-2 shadow-none ${
        (merchant?.subscription_plan || merchant?.merchant_tier) === "corporate"
          ? "border-emerald-300 bg-emerald-50/30"
          : (merchant?.subscription_plan || merchant?.merchant_tier) === "individual"
          ? "border-blue-300 bg-blue-50/30"
          : "border-purp-300 bg-purp-50/30"
      }`}>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-bold text-purp-900 flex items-center gap-2">
              <Shield className="h-5 w-5 text-purp-700" />
              Account Verification & Limits
            </CardTitle>
            <Badge variant="outline" className={`border-2 text-xs font-semibold ${
              (merchant?.subscription_plan || merchant?.merchant_tier) === "corporate"
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : (merchant?.subscription_plan || merchant?.merchant_tier) === "individual"
                ? "bg-blue-50 text-blue-700 border-blue-200"
                : "bg-neutral-50 text-neutral-600 border-neutral-200"
            }`}>
              <Shield className="mr-1 h-3 w-3" />
              Tier: <span className="capitalize ml-1">{merchant?.subscription_plan || merchant?.merchant_tier || "Starter"}</span>
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Tier Informational Banner */}
          {(merchant?.subscription_plan || merchant?.merchant_tier) === "corporate" ? (
            <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-lg mb-4">
              {effectiveVerificationStatus === "verified" && (merchant?.cac_document_url || merchant?.cac_number) ? (
                <CheckCircle className="h-5 w-5 text-emerald-600 mt-0.5 flex-shrink-0" />
              ) : (
                <Shield className="h-5 w-5 text-emerald-600 mt-0.5 flex-shrink-0" />
              )}
              <div>
                <p className="text-sm font-semibold text-emerald-800">Business Account</p>
                <p className="text-sm text-emerald-700 mt-1">
                  {effectiveVerificationStatus === "verified" && (merchant?.cac_document_url || merchant?.cac_number)
                    ? "Your account is fully verified. You have access to unlimited monthly collections and payment links."
                    : "Please complete your verification below — submit your BVN, CAC Number, CAC Certificate, and Utility Bill to activate unlimited collections."}
                </p>
              </div>
            </div>
          ) : (merchant?.subscription_plan || merchant?.merchant_tier) === "individual" ? (
            <div className="flex items-start justify-between gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg mb-4 flex-col md:flex-row">
              <div className="flex gap-3">
                <Shield className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-blue-800">Individual / Collections Account</p>
                  <p className="text-sm text-blue-700 mt-1">
                    {effectiveVerificationStatus === "verified"
                      ? "Your account is verified. You can collect up to NGN 5,000,000 per month. Upgrade to Business to unlock unlimited collections and advanced team controls."
                      : "Please complete your BVN verification below to activate your NGN 5,000,000 monthly collection limit. Upgrade to Business to unlock unlimited collections."}
                  </p>
                </div>
              </div>
              <Link href="/settings/upgrade/corporate">
                <Button className="bg-purp-900 hover:bg-purp-800 text-white shrink-0">
                  Upgrade to Business
                </Button>
              </Link>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3 p-4 bg-purp-50 border border-purp-200 rounded-lg mb-4 flex-col md:flex-row">
              <div className="flex gap-3">
                <Shield className="h-5 w-5 text-purp-700 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-purp-900">Starter Account (Free)</p>
                  <p className="text-sm text-neutral-600 mt-1">
                    You can create record invoices to test the workflow. To collect live payments, unlock payment links, and manage partial collections online, upgrade your plan.
                  </p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                <Link href="/settings/upgrade/individual">
                  <Button className="w-full sm:w-auto bg-white border border-purp-200 text-purp-900 hover:bg-purp-50">
                    Upgrade to Individual / Collections
                  </Button>
                </Link>
                <Link href="/settings/upgrade/corporate">
                  <Button className="w-full sm:w-auto bg-purp-900 hover:bg-purp-800 text-white">
                    Upgrade to Business
                  </Button>
                </Link>
              </div>
            </div>
          )}

          {effectiveVerificationStatus === "pending" && (
            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg mb-4">
              <Clock className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-800">Review In Progress</p>
                <p className="text-sm text-amber-700 mt-1">
                  Some of your documents are awaiting admin review. You cannot edit items that are currently pending.
                </p>
              </div>
            </div>
          )}

          {effectiveVerificationStatus === "rejected" && (

            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg mb-4">
              <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red-800">Action Required</p>
                <p className="text-sm text-red-700 mt-1">
                  {merchant?.kyc_notes || "One or more of your documents were rejected. Please check the status below and re-submit."}
                </p>
              </div>
            </div>
          )}

          {kycSuccess && (
            <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-lg mb-4">
              <CheckCircle className="h-5 w-5 text-emerald-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-emerald-800">Documents Submitted!</p>
                <p className="text-sm text-emerald-700 mt-1">
                  Your verification documents have been submitted successfully. A platform admin will review them shortly.
                </p>
              </div>
            </div>
          )}

          {profileIncomplete && (
            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg mb-4">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-800">Profile Update Required</p>
                <ul className="text-sm text-amber-700 mt-1 space-y-1 list-disc list-inside">
                  {ownerNameMissing && (
                    <li>Provide your <strong>{ownerLabel}</strong> — required for BVN verification.</li>
                  )}
                  {businessNameMissing && (
                    <li>Provide your <strong>Registered Business Name</strong> — required for CAC / RC Number verification.</li>
                  )}
                </ul>
                <p className="text-xs text-amber-600 mt-2">
                  Complete these fields in the Business Profile section below and save to proceed with verification.
                </p>
              </div>
            </div>
          )}

          {/* Document Upload Fields — Plan Gated */}
          <div className="space-y-4">
            {/* Starter: All locked */}
            {isStarter && (
              <div className="relative p-6 bg-neutral-50 border-2 border-neutral-200 rounded-lg text-center">
                <Lock className="h-8 w-8 mx-auto text-neutral-400 mb-2" />
                <p className="text-sm font-semibold text-neutral-700">Verification Locked</p>
                <p className="text-xs text-neutral-500 mt-1 max-w-sm mx-auto">
                  Upgrade to Individual / Collections or Business to submit verification documents and start collecting payments.
                </p>
                <div className="flex gap-2 justify-center mt-3">
                  <Link href="/settings/upgrade/individual">
                    <Button size="sm" variant="outline" className="border-2 text-sm">Upgrade to Individual / Collections</Button>
                  </Link>
                  <Link href="/settings/upgrade/corporate">
                    <Button size="sm" className="bg-purp-900 hover:bg-purp-800 text-white text-sm">Upgrade to Business</Button>
                  </Link>
                </div>
              </div>
            )}

            {/* BVN — available for Individual + Corporate */}
            {!isStarter && (
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Shield className="h-4 w-4 text-purp-700" />
                  BVN (Bank Verification Number)
                  {renderStatusBadge(merchant?.bvn_status)}
                </Label>
                <p className="text-xs text-neutral-500">Must match the name: <strong>{ownerName || "Set owner name below"}</strong></p>
                <Input
                  type="text"
                  maxLength={11}
                  placeholder="22XXXXXXXXX"
                  value={bvnNumber}
                  onChange={(e) => setBvnNumber(e.target.value.replace(/\D/g, ""))}
                  className="border-2 border-purp-200 bg-white h-11 max-w-xs"
                  disabled={profileIncomplete || merchant?.bvn_status === "verified" || merchant?.bvn_status === "pending"}
                />
              </div>
            )}

            {!isStarter && (
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Shield className="h-4 w-4 text-purp-700" />
                  Live Selfie Capture
                  {renderStatusBadge(merchant?.selfie_status)}
                </Label>
                <p className="text-xs text-neutral-500">Used with your BVN for secure face match verification.</p>
                <div className="flex items-center gap-3">
                  {!livenessFallback && merchant?.selfie_status !== "verified" && merchant?.selfie_status !== "pending" ? (
                    <Button 
                      onClick={() => setShowLivenessCamera(true)}
                      variant="outline"
                      disabled={profileIncomplete}
                      className="border-2 border-purp-200 bg-purp-50 hover:bg-purp-100 text-purp-700"
                    >
                      <Camera className="h-4 w-4 mr-2" />
                      {livenessImages.length > 0 ? "Retake Live Pictures" : "Start Live Camera Capture"}
                    </Button>
                  ) : (
                    <Input
                      type="file"
                      accept=".png,.jpg,.jpeg"
                      onChange={(e) => setSelfieFile(e.target.files?.[0] || null)}
                      className="border-2 border-purp-200 bg-white h-11 file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-purp-100 file:text-purp-700"
                      disabled={profileIncomplete || merchant?.selfie_status === "verified" || merchant?.selfie_status === "pending"}
                    />
                  )}
                  
                  {(livenessImages.length > 0 || selfieFile || merchant?.selfie_url) && (
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 text-xs whitespace-nowrap">
                      <CheckCircle className="mr-1 h-3 w-3" /> {merchant?.selfie_url ? "Submitted" : (livenessImages.length > 0 ? "3 Images Captured" : "Selected")}
                    </Badge>
                  )}
                </div>
              </div>
            )}

            {/* CAC Number — Corporate only */}
            {isCorporate ? (
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <FileCheck className="h-4 w-4 text-purp-700" />
                  CAC Number
                  {renderStatusBadge(merchant?.cac_status)}
                </Label>
                <Input
                  type="text"
                  placeholder="RC-123456"
                  value={cacNumber}
                  onChange={(e) => setCacNumber(e.target.value)}
                  className="border-2 border-purp-200 bg-white h-11 max-w-xs"
                  disabled={merchant?.cac_status === "verified" || merchant?.cac_status === "pending"}
                />
              </div>
            ) : isIndividual ? (
              <div className="relative p-4 bg-neutral-50 border border-neutral-200 rounded-lg opacity-60">
                <div className="flex items-center gap-2 text-sm text-neutral-500">
                  <Lock className="h-4 w-4" />
                  <span>CAC Number — <strong>Available on Business plan</strong></span>
                </div>
              </div>
            ) : null}

            {/* CAC Certificate — Corporate only */}
            {isCorporate ? (
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <FileCheck className="h-4 w-4 text-purp-700" />
                  CAC Certificate
                  {renderStatusBadge(merchant?.cac_status)}
                </Label>
                <div className="flex items-center gap-3">
                  <Input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={(e) => setCacFile(e.target.files?.[0] || null)}
                    className="border-2 border-purp-200 bg-white h-11 file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-purp-100 file:text-purp-700"
                    disabled={merchant?.cac_status === "verified" || merchant?.cac_status === "pending"}
                  />
                  {(cacFile || merchant?.cac_document_url) && (
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 text-xs whitespace-nowrap">
                      <CheckCircle className="mr-1 h-3 w-3" /> {merchant?.cac_document_url ? 'Uploaded' : 'Selected'}
                    </Badge>
                  )}
                </div>
              </div>
            ) : isIndividual ? (
              <div className="relative p-4 bg-neutral-50 border border-neutral-200 rounded-lg opacity-60">
                <div className="flex items-center gap-2 text-sm text-neutral-500">
                  <Lock className="h-4 w-4" />
                  <span>CAC Certificate — <strong>Available on Business plan</strong></span>
                </div>
              </div>
            ) : null}

            {/* Utility Bill — Corporate only */}
            {isCorporate ? (
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <FileCheck className="h-4 w-4 text-purp-700" />
                  Utility Bill (Proof of Address)
                  {renderStatusBadge(merchant?.utility_status)}
                </Label>
                <div className="flex items-center gap-3">
                  <Input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={(e) => setUtilityFile(e.target.files?.[0] || null)}
                    className="border-2 border-purp-200 bg-white h-11 file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-purp-100 file:text-purp-700"
                    disabled={merchant?.utility_status === "verified" || merchant?.utility_status === "pending"}
                  />
                  {(utilityFile || merchant?.utility_document_url) && (
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 text-xs whitespace-nowrap">
                      <CheckCircle className="mr-1 h-3 w-3" /> {merchant?.utility_document_url ? 'Uploaded' : 'Selected'}
                    </Badge>
                  )}
                </div>
              </div>
            ) : isIndividual ? (
              <div className="relative p-4 bg-neutral-50 border border-neutral-200 rounded-lg opacity-60">
                <div className="flex items-center gap-2 text-sm text-neutral-500">
                  <Lock className="h-4 w-4" />
                  <span>Utility Bill — <strong>Available on Business plan</strong></span>
                </div>
              </div>
            ) : null}
          </div>

          <Button
            onClick={handleKycSubmit}
            disabled={profileIncomplete || kycSubmitting || !bvnNumber || !selfieFile}
            className="w-full h-11 bg-purp-900 hover:bg-purp-700 text-white font-semibold"
          >
            {kycSubmitting ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Submitting Documents...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Submit for Verification
                <ArrowRight className="h-4 w-4" />
              </span>
            )}
          </Button>

          {kycError && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-medium border border-red-100 flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0 mt-1.5" />
              {kycError}
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Business Profile */}
      {(!merchant?.permissions || merchant.permissions.manage_business) && (
      <Card className="border-2 border-purp-200 shadow-none">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-bold text-purp-900">
              Business Profile
            </CardTitle>
            <Badge variant="outline" className={`border-2 text-xs font-semibold ${
              effectiveVerificationStatus === "verified"
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : effectiveVerificationStatus === "pending"
                ? "bg-amber-50 text-amber-700 border-amber-200"
                : "bg-neutral-50 text-neutral-600 border-neutral-200"
            }`}>
              <Shield className="mr-1 h-3 w-3" />
              {effectiveVerificationStatus === "verified" ? "Verified" : effectiveVerificationStatus === "pending" ? "Pending" : "Unverified"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Trading Name <span className="text-red-500">*</span></Label>
            <p className="text-xs text-neutral-500">The name your business trades under. Shown on invoices and payment links.</p>
            <Input
              value={tradingName}
              onChange={(e) => setTradingName(e.target.value)}
              placeholder="e.g. Adebayo Consulting"
              className="border-2 border-purp-200 bg-purp-50 h-11"
            />
          </div>
          {isCorporate && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Registered Business Name <span className="text-red-500">*</span></Label>
              <p className="text-xs text-neutral-500">The official name registered with CAC. Used to verify your CAC certificate and RC Number.</p>
              <div className="flex items-center gap-3 p-3 bg-purp-50/50 border border-purp-200 rounded-lg">
                <input
                  type="checkbox"
                  checked={businessName.trim() !== "" && businessName.trim() === tradingName.trim()}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setBusinessName(tradingName);
                    } else {
                      setBusinessName("");
                    }
                  }}
                  className="w-4 h-4 accent-purp-700"
                />
                <span className="text-sm text-neutral-700">Same as Trading Name</span>
              </div>
              {!(businessName.trim() !== "" && businessName.trim() === tradingName.trim()) && (
                <Input
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Adebayo Consulting Limited"
                  className="border-2 border-purp-200 bg-purp-50 h-11"
                />
              )}
              {businessNameMissing && (
                <p className="text-xs text-red-500 font-medium">⚠ Required — CAC/RC verification is blocked until this is provided.</p>
              )}
            </div>
          )}
          {!isStarter && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">{ownerLabel} <span className="text-red-500">*</span></Label>
              <p className="text-xs text-neutral-500">
                {isCorporate
                  ? "Full legal name of the shareholder with the highest share. Used to verify BVN."
                  : "Your full legal name as it appears on your BVN. Used for identity verification."}
              </p>
              <Input
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="e.g. Adebayo Olanrewaju"
                className="border-2 border-purp-200 bg-purp-50 h-11"
              />
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="border-2 border-purp-200 bg-purp-50 h-11"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Phone</Label>
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="border-2 border-purp-200 bg-purp-50 h-11"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Business Logo</Label>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-purp-100 border-2 border-purp-200 border-dashed rounded-lg flex items-center justify-center overflow-hidden">
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl font-bold text-purp-700">
                    {businessName.charAt(0)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    disabled={uploadingLogo}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                  />
                  <Button variant="outline" disabled={uploadingLogo} className="border-2 border-purp-200 text-purp-700 pointer-events-none">
                    {uploadingLogo ? "Uploading..." : "Upload Logo"}
                  </Button>
                </div>
                {logoUrl && (
                  <Button 
                    variant="outline" 
                    onClick={handleRemoveLogo}
                    disabled={uploadingLogo} 
                    className="border-2 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                  >
                    Remove Logo
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {/* Fee Settings */}
      {(!merchant?.permissions || merchant.permissions.change_fee_settings) && (
      <Card className="border-2 border-purp-200 shadow-none">
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-bold text-purp-900">
            Paystack Fee Settings
          </CardTitle>
          <p className="text-xs text-neutral-500 mt-1">
            Set who absorbs the Paystack processing fee by default. This can be overridden per invoice.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Global Default</Label>
            <Select value={feeDefault} onValueChange={(v) => setFeeDefault((v ?? "business") as "business" | "customer")}>
              <SelectTrigger className="border-2 border-purp-200 bg-purp-50 h-11 max-w-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-2 border-purp-200">
                <SelectItem value="business">Business Absorbs Fee</SelectItem>
                <SelectItem value="customer">Customer Absorbs Fee</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="bg-purp-50 border border-purp-200 rounded-lg p-4 text-sm">
            <p className="text-neutral-500">
              <strong className="text-purp-900">Current Fee Structure:</strong> Paystack charges
              1.5% + ₦100 per transaction, capped at ₦2,000.
            </p>
          </div>
        </CardContent>
      </Card>
      )}

      {/* Quick Links */}
      {(!merchant?.permissions || merchant.permissions.manage_advance_settings || merchant.permissions.manage_settlement_account || merchant.permissions.manage_item_catalog || merchant.permissions.view_item_catalog || merchant.permissions.manage_discount_template || merchant.permissions.view_discount_template) && (
      <Card className="border-2 border-purp-200 shadow-none">
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-bold text-purp-900">
            Advanced Settings
          </CardTitle>
          <p className="text-xs text-neutral-500 mt-1">
            Manage your specialized platform configurations.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-3 gap-4">
            {(!merchant?.permissions || merchant.permissions.manage_advance_settings || merchant.permissions.manage_settlement_account) && (
              isStarter ? (
                <div className="block p-4 border border-neutral-200 rounded-lg bg-neutral-50 opacity-70">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-neutral-500">Settlement Account</span>
                    <Lock className="w-4 h-4 text-neutral-400" />
                  </div>
                  <p className="text-xs text-neutral-400">Upgrade to collect online payments and configure payouts.</p>
                </div>
              ) : (
                <Link href="/settings/settlement" className="block p-4 border border-purp-200 rounded-lg hover:bg-purp-50 transition-colors group">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-purp-900">Settlement Account</span>
                    <ExternalLink className="w-4 h-4 text-purp-300 group-hover:text-purp-700 transition-colors" />
                  </div>
                  <p className="text-xs text-neutral-500">Configure your payout bank account for online payments.</p>
                </Link>
              )
            )}
            
            {(!merchant?.permissions || merchant.permissions.manage_advance_settings || merchant.permissions.manage_billing) && (
              <Link href="/settings/billing" className="block p-4 border border-purp-200 rounded-lg hover:bg-purp-50 transition-colors group">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-purp-900">Billing &amp; Subscription</span>
                  <ExternalLink className="w-4 h-4 text-purp-300 group-hover:text-purp-700 transition-colors" />
                </div>
                <p className="text-xs text-neutral-500">Manage your subscription, renewals, and billing history.</p>
              </Link>
            )}
            
            {(!merchant?.permissions || merchant.permissions.manage_advance_settings || merchant.permissions.manage_item_catalog || merchant.permissions.view_item_catalog) && (
            <Link href="/settings/catalog" className="block p-4 border border-purp-200 rounded-lg hover:bg-purp-50 transition-colors group">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-purp-900">Item Catalog</span>
                <ExternalLink className="w-4 h-4 text-purp-300 group-hover:text-purp-700 transition-colors" />
              </div>
              <p className="text-xs text-neutral-500">Manage your reusable products and services for invoicing.</p>
            </Link>
            )}

            {(!merchant?.permissions || merchant.permissions.manage_advance_settings || merchant.permissions.manage_discount_template || merchant.permissions.view_discount_template) && (
            <Link href="/settings/discount-templates" className="block p-4 border border-purp-200 rounded-lg hover:bg-purp-50 transition-colors group">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-purp-900">Discount Templates</span>
                <ExternalLink className="w-4 h-4 text-purp-300 group-hover:text-purp-700 transition-colors" />
              </div>
              <p className="text-xs text-neutral-500">Save predefined discount rates for quick application.</p>
            </Link>
            )}
          </div>
        </CardContent>
      </Card>
      )}

      <Separator className="bg-purp-200" />

      {(!merchant?.permissions || merchant.permissions.manage_business || merchant.permissions.change_fee_settings) && (
      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-purp-900 hover:bg-purp-700 text-white font-semibold px-8"
        >
          {saving ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Saving...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Save className="h-4 w-4" />
              Save Settings
            </span>
          )}
        </Button>
      </div>
      )}
      {showLivenessCamera && (
        <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4">
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
                setKycError("Camera failed: " + error + ". Please use the manual file upload.");
              }}
            />
          </div>
        </div>
      )}

    </div>
  );
}
