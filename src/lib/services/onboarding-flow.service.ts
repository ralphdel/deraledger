// The app uses untyped Supabase service clients across server routes; this
// helper accepts those clients without requiring generated database types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

import {
  getIncompleteRequirements,
  getVerificationRequirements,
  hasVerificationRequirement,
} from "@/lib/verification-requirements";

export type PlanType = "starter" | "individual" | "corporate";
export type RelationshipClaim = "owner_affiliated_claim" | "representative_claim";

export const VERIFICATION_DISCLOSURE_VERSION = "1.0";
export const SUPERADMIN_SANDBOX_EMAIL =
  (process.env.SUPERADMIN_SANDBOX_EMAIL || "ralphdel14@yahoo.com").toLowerCase();

export const LIVE_FEATURE_LOCK_MESSAGE =
  "Live payment collection is disabled until verification is completed. You can continue setting up your workspace.";

export function isSuperadminSandboxMerchant(merchant: {
  email?: string | null;
  is_super_admin?: boolean | null;
}) {
  return (
    merchant.is_super_admin === true ||
    merchant.email?.toLowerCase() === SUPERADMIN_SANDBOX_EMAIL
  );
}

export function requiresVerificationDisclosure(plan: string | null | undefined): boolean {
  return plan === "individual" || plan === "corporate";
}

export function isLiveFeatureEnabled(merchant: {
  subscription_plan?: string | null;
  merchant_tier?: string | null;
  verification_status?: string | null;
  bvn_status?: string | null;
  selfie_status?: string | null;
  cac_status?: string | null;
  utility_status?: string | null;
  business_affiliation_status?: string | null;
  live_features_enabled?: boolean | null;
  setup_mode?: boolean | null;
  email?: string | null;
  is_super_admin?: boolean | null;
  settlement_account_number?: string | null;
  settlement_bank_name?: string | null;
  settlement_account_name?: string | null;
  verification_step_state?: Record<string, unknown> | null;
}): boolean {
  if (isSuperadminSandboxMerchant(merchant)) return true;
  if (merchant.live_features_enabled !== true) return false;
  if (merchant.setup_mode === true) return false;
  const requirements = getVerificationRequirements(
    merchant.subscription_plan || merchant.merchant_tier || "starter",
  );
  if (requirements.includes("no_payment_collection")) return false;
  return getIncompleteRequirements(merchant).length === 0;
}

export function getLiveFeatureLockReasons(merchant: {
  subscription_plan?: string | null;
  merchant_tier?: string | null;
  verification_status?: string | null;
  bvn_status?: string | null;
  selfie_status?: string | null;
  cac_status?: string | null;
  utility_status?: string | null;
  business_affiliation_status?: string | null;
  setup_mode?: boolean | null;
  live_features_enabled?: boolean | null;
  email?: string | null;
  is_super_admin?: boolean | null;
  settlement_account_number?: string | null;
  settlement_bank_name?: string | null;
  settlement_account_name?: string | null;
  verification_step_state?: Record<string, unknown> | null;
}): string[] {
  if (isSuperadminSandboxMerchant(merchant)) return [];
  const planTier = merchant.subscription_plan || merchant.merchant_tier || "starter";
  const requirements = getVerificationRequirements(planTier);
  if (requirements.includes("no_payment_collection")) {
    return ["Upgrade to a collection-enabled tier to activate live payment collection."];
  }

  const reasons: string[] = [];
  const missing = getIncompleteRequirements(merchant);
  for (const requirement of missing) {
    switch (requirement) {
      case "bvn":
        reasons.push("Identity number verification");
        break;
      case "selfie_liveness":
        reasons.push("Selfie face match");
        break;
      case "business_registration_check":
        reasons.push("Business registration verification");
        break;
      case "business_document":
      case "business_documents":
        reasons.push("Business document approval");
        break;
      case "utility_bill":
      case "proof_of_address":
        reasons.push("Address or utility document approval");
        break;
      case "director_or_representative_flow":
      case "director_kyc":
        reasons.push("Director or representative authority approval");
        break;
      case "settlement_account":
        reasons.push("Settlement account readiness");
        break;
      case "valid_id_document":
        reasons.push("Additional identity document");
        break;
      case "additional_manual_review":
      case "admin_review":
        reasons.push("Final admin approval");
        break;
      default:
        break;
    }
  }

  if (reasons.length === 0 && merchant.setup_mode === true) reasons.push("Setup mode release");
  if (reasons.length === 0 && merchant.live_features_enabled !== true) reasons.push("Live payment feature activation");
  return reasons;
}

export function setupStatusForMerchant(merchant: {
  subscription_plan?: string | null;
  merchant_tier?: string | null;
  verification_status?: string | null;
  bvn_status?: string | null;
  selfie_status?: string | null;
  cac_status?: string | null;
  utility_status?: string | null;
  business_affiliation_status?: string | null;
  email?: string | null;
  is_super_admin?: boolean | null;
  settlement_account_number?: string | null;
  settlement_bank_name?: string | null;
  settlement_account_name?: string | null;
  verification_step_state?: Record<string, unknown> | null;
}): {
  onboarding_status: string;
  setup_mode: boolean;
  live_features_enabled: boolean;
} {
  if (isSuperadminSandboxMerchant(merchant)) {
    return { onboarding_status: "active", setup_mode: false, live_features_enabled: true };
  }
  const plan = merchant.subscription_plan || merchant.merchant_tier || "starter";
  const requirements = getVerificationRequirements(plan);
  if (requirements.includes("no_payment_collection")) {
    return { onboarding_status: "active", setup_mode: false, live_features_enabled: false };
  }
  const incomplete = getIncompleteRequirements(merchant);
  if (incomplete.length === 0) {
    return { onboarding_status: "active", setup_mode: false, live_features_enabled: true };
  }

  if (
    hasVerificationRequirement(plan, "bvn") &&
    (merchant.bvn_status !== "verified" || merchant.selfie_status !== "verified")
  ) {
    return { onboarding_status: "pending_kyc", setup_mode: true, live_features_enabled: false };
  }

  if (
    hasVerificationRequirement(plan, "business_registration_check") &&
    merchant.cac_status !== "verified"
  ) {
    return { onboarding_status: "pending_kyb", setup_mode: true, live_features_enabled: false };
  }

  if (
    (hasVerificationRequirement(plan, "business_document") ||
      hasVerificationRequirement(plan, "business_documents") ||
      hasVerificationRequirement(plan, "utility_bill") ||
      hasVerificationRequirement(plan, "proof_of_address")) &&
    merchant.utility_status !== "verified"
  ) {
    return { onboarding_status: "pending_kyb", setup_mode: true, live_features_enabled: false };
  }

  if (
    hasVerificationRequirement(plan, "director_or_representative_flow") ||
    hasVerificationRequirement(plan, "director_kyc")
  ) {
    const affiliation = merchant.business_affiliation_status || "not_started";
    if (affiliation === "no_match" || affiliation === "rejected" || affiliation === "not_started") {
      return { onboarding_status: "pending_director_approval", setup_mode: true, live_features_enabled: false };
    }
    if (affiliation === "partial_match" || affiliation === "manual_review") {
      return { onboarding_status: "pending_affiliation_match", setup_mode: true, live_features_enabled: false };
    }
  }

  if (
    merchant.verification_status === "pending" ||
    merchant.verification_status === "pending_admin_review"
  ) {
    return { onboarding_status: "pending_manual_review", setup_mode: true, live_features_enabled: false };
  }

  if (
    requirements.includes("additional_manual_review") ||
    requirements.includes("admin_review")
  ) {
    return { onboarding_status: "pending_manual_review", setup_mode: true, live_features_enabled: false };
  }

  return { onboarding_status: "pending_kyc", setup_mode: true, live_features_enabled: false };
}

export async function getFeatureFlag(
  adminClient: SupabaseClient,
  key: string,
  defaultValue = false
): Promise<boolean> {
  const { data } = await adminClient
    .from("platform_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (!data?.value) return defaultValue;
  return ["true", "1", "yes", "on"].includes(String(data.value).toLowerCase());
}

export async function recordVerificationDisclosure(
  adminClient: SupabaseClient,
  params: {
    planType: string;
    context: "onboarding" | "upgrade" | "renewal";
    userId?: string | null;
    merchantId?: string | null;
    onboardingSessionId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    deviceMetadata?: Record<string, unknown> | null;
    disclosureVersion?: string | null;
  }
) {
  if (!requiresVerificationDisclosure(params.planType)) return { success: true };

  const disclosureVersion = params.disclosureVersion || VERIFICATION_DISCLOSURE_VERSION;
  const payload = {
    user_id: params.userId || null,
    merchant_id: params.merchantId || null,
    onboarding_session_id: params.onboardingSessionId || null,
    plan_type: params.planType,
    context: params.context,
    disclosure_version: disclosureVersion,
    ip_address: params.ipAddress || null,
    user_agent: params.userAgent || null,
    device_metadata: params.deviceMetadata || {},
  };

  const { error } = await adminClient.from("verification_disclosures").insert(payload);
  if (error) {
    console.warn("[OnboardingFlow] Disclosure insert skipped:", error.message);
    return { success: false, error: error.message };
  }

  if (params.merchantId) {
    await adminClient
      .from("merchants")
      .update({
        verification_disclosure_acknowledged_at: new Date().toISOString(),
        verification_disclosure_version: disclosureVersion,
      })
      .eq("id", params.merchantId);
  }

  return { success: true };
}

export async function enterPaidSetupMode(
  adminClient: SupabaseClient,
  params: {
    merchantId: string;
    planType: string;
    relationshipClaim?: RelationshipClaim | null;
    paymentReference?: string | null;
  }
) {
  const plan = params.planType as PlanType;
  const setupFields = plan === "starter"
    ? { onboarding_status: "active", setup_mode: false, live_features_enabled: false }
    : { onboarding_status: "setup_mode", setup_mode: true, live_features_enabled: false };

  await adminClient
    .from("merchants")
    .update({
      ...setupFields,
      relationship_claim: params.relationshipClaim || null,
      paid_setup_started_at: plan === "starter" ? null : new Date().toISOString(),
    })
    .eq("id", params.merchantId);

  await ensureWorkspaceForMerchant(adminClient, params.merchantId);

  const { data: workspace } = await adminClient
    .from("workspaces")
    .select("id")
    .eq("merchant_id", params.merchantId)
    .maybeSingle();

  if (workspace?.id && plan !== "starter") {
    await adminClient.from("workspace_subscriptions").insert({
      workspace_id: workspace.id,
      merchant_id: params.merchantId,
      plan_type: plan,
      subscription_status: "paid_setup",
      payment_reference: params.paymentReference || null,
    });
  }
}

export async function syncMerchantSetupStatus(adminClient: SupabaseClient, merchantId: string) {
  const { data: merchant } = await adminClient
    .from("merchants")
    .select("subscription_plan, merchant_tier, verification_status, bvn_status, selfie_status, cac_status, utility_status, business_affiliation_status, setup_mode, live_features_enabled")
    .eq("id", merchantId)
    .maybeSingle();

  if (!merchant) return;
  const fields = setupStatusForMerchant(merchant);
  await adminClient.from("merchants").update({
    ...fields,
    ...(fields.live_features_enabled ? {
      verification_status: "verified",
      live_features_activated_at: new Date().toISOString(),
    } : {}),
  }).eq("id", merchantId);
  await ensureWorkspaceForMerchant(adminClient, merchantId);
  await adminClient
    .from("workspaces")
    .update({
      onboarding_status: fields.onboarding_status,
      setup_mode: fields.setup_mode,
      live_features_enabled: fields.live_features_enabled,
      updated_at: new Date().toISOString(),
    })
    .eq("merchant_id", merchantId);
}

export async function ensureWorkspaceForMerchant(adminClient: SupabaseClient, merchantId: string) {
  const { data: merchant } = await adminClient
    .from("merchants")
    .select("id, user_id, business_name, trading_name, subscription_plan, merchant_tier, onboarding_status, setup_mode, live_features_enabled, bvn_status, selfie_status, cac_status, utility_status, business_affiliation_status, verification_status")
    .eq("id", merchantId)
    .maybeSingle();

  if (!merchant) return null;

  const derived = setupStatusForMerchant(merchant);
  const plan = merchant.subscription_plan || merchant.merchant_tier || "starter";
  const displayName = merchant.trading_name || merchant.business_name || "DeraLedger Workspace";

  const { data: existing } = await adminClient
    .from("workspaces")
    .select("id")
    .eq("merchant_id", merchantId)
    .maybeSingle();

  if (existing?.id) {
    await adminClient
      .from("workspaces")
      .update({
        owner_user_id: merchant.user_id,
        display_name: displayName,
        plan_type: plan,
        onboarding_status: merchant.onboarding_status || derived.onboarding_status,
        setup_mode: merchant.setup_mode ?? derived.setup_mode,
        live_features_enabled: merchant.live_features_enabled ?? derived.live_features_enabled,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    return existing.id;
  }

  const { data: created, error } = await adminClient
    .from("workspaces")
    .insert({
      owner_user_id: merchant.user_id,
      merchant_id: merchantId,
      workspace_type: plan === "individual" ? "personal" : "business",
      display_name: displayName,
      plan_type: plan,
      onboarding_status: merchant.onboarding_status || derived.onboarding_status,
      setup_mode: merchant.setup_mode ?? derived.setup_mode,
      live_features_enabled: merchant.live_features_enabled ?? derived.live_features_enabled,
    })
    .select("id")
    .single();

  if (error) {
    console.warn("[OnboardingFlow] Workspace creation skipped:", error.message);
    return null;
  }

  await adminClient.from("merchants").update({ workspace_id: created.id }).eq("id", merchantId);
  return created.id;
}

export function matchAffiliationByName(
  verifiedName: string,
  registryPeople: { name?: string | null; role?: string | null }[]
): { status: "strong_match" | "partial_match" | "no_match"; matchedName?: string; score: number; reason: string } {
  const verifiedTokens = tokenizeName(verifiedName);
  if (verifiedTokens.length === 0 || registryPeople.length === 0) {
    return { status: "no_match", score: 0, reason: "No comparable identity or registry people were available." };
  }

  let best: {
    status: "strong_match" | "partial_match" | "no_match";
    matchedName: string;
    score: number;
    reason: string;
  } = { status: "no_match", matchedName: "", score: 0, reason: "No registry name matched." };

  for (const person of registryPeople) {
    const personName = person.name || "";
    const registryTokens = tokenizeName(personName);
    const matchedCount = verifiedTokens.filter((left) =>
      registryTokens.some((right) => tokensMatch(left, right))
    ).length;
    const score = registryTokens.length > 0
      ? Math.round((matchedCount / Math.max(verifiedTokens.length, registryTokens.length)) * 100)
      : 0;

    const surname = registryTokens[0] || "";
    const surnameMatch = verifiedTokens.some((token) => tokensMatch(token, surname));
    const status =
      surnameMatch && matchedCount >= 2 ? "strong_match"
      : matchedCount >= 2 ? "partial_match"
      : matchedCount === 1 ? "partial_match"
      : "no_match";

    if (score > best.score) {
      best = {
        status,
        matchedName: personName,
        score,
        reason: status === "strong_match"
          ? "Surname plus at least one other token matched the registry record."
          : status === "partial_match"
            ? "Possible name ordering or spelling variation matched the registry record."
            : "No registry name matched.",
      };
    }
  }

  return best;
}

export async function persistBusinessRegistrySnapshot(
  adminClient: SupabaseClient,
  params: {
    merchantId: string;
    providerName: string;
    businessType?: string | null;
    registeredName?: string | null;
    registrationNumber: string;
    registrationStatus?: string | null;
    personnel?: { name: string; role: string }[];
    rawResponse?: Record<string, unknown>;
    normalizedResponse?: Record<string, unknown>;
    verificationReference?: string | null;
    verificationLogId?: string | null;
    ownerName?: string | null;
    relationshipClaim?: RelationshipClaim | null;
  }
) {
  await ensureWorkspaceForMerchant(adminClient, params.merchantId);

  const { data: workspace } = await adminClient
    .from("workspaces")
    .select("id")
    .eq("merchant_id", params.merchantId)
    .maybeSingle();

  const { data: snapshot, error } = await adminClient
    .from("business_registry_snapshots")
    .insert({
      business_workspace_id: workspace?.id || null,
      merchant_id: params.merchantId,
      provider_name: params.providerName.toUpperCase(),
      business_type: params.businessType || null,
      registered_name: params.registeredName || null,
      registration_number: params.registrationNumber,
      registration_status: params.registrationStatus || "unknown",
      directors_json: params.personnel || [],
      raw_response_encrypted: params.rawResponse || {},
      normalized_response_json: params.normalizedResponse || {},
      verification_reference: params.verificationReference || null,
      verification_log_id: params.verificationLogId || null,
    })
    .select("id")
    .single();

  if (error || !snapshot) {
    console.warn("[OnboardingFlow] Registry snapshot insert skipped:", error?.message);
    return null;
  }

  let affiliationStatus = "not_started";
  let matchedRegistryName: string | null = null;
  let matchScore: number | null = null;
  let matchReason: string | null = null;

  if (params.ownerName && params.relationshipClaim !== "representative_claim") {
    const match = matchAffiliationByName(params.ownerName, params.personnel || []);
    affiliationStatus = match.status;
    matchedRegistryName = match.matchedName || null;
    matchScore = match.score;
    matchReason = match.reason;

    await adminClient.from("business_affiliations").insert({
      business_workspace_id: workspace?.id || null,
      merchant_id: params.merchantId,
      registry_snapshot_id: snapshot.id,
      claimed_relationship_type: params.relationshipClaim || "owner_affiliated_claim",
      status: affiliationStatus,
      matched_registry_name: matchedRegistryName,
      match_score: matchScore,
      match_reason: matchReason,
    });
  } else if (params.relationshipClaim === "representative_claim") {
    affiliationStatus = "no_match";
    matchReason = "Requester selected representative setup path; director approval is required.";

    await adminClient.from("business_affiliations").insert({
      business_workspace_id: workspace?.id || null,
      merchant_id: params.merchantId,
      registry_snapshot_id: snapshot.id,
      claimed_relationship_type: "representative_claim",
      status: affiliationStatus,
      match_reason: matchReason,
    });
  }

  await adminClient
    .from("merchants")
    .update({
      business_registry_snapshot_id: snapshot.id,
      business_affiliation_status: affiliationStatus,
    })
    .eq("id", params.merchantId);

  await syncMerchantSetupStatus(adminClient, params.merchantId);
  return snapshot.id;
}

function tokenizeName(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function tokensMatch(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length < 4 || right.length < 4) return false;
  return left.includes(right) || right.includes(left);
}
