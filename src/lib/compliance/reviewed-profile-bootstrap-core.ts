import type {
  MerchantActivationStatus,
  MerchantComplianceStatus,
  MerchantRestrictionState,
} from "./merchant-capabilities";

/**
 * Pure preparation contract for a future, reviewer-operated profile bootstrap
 * command. This module does not read or write a database and must never treat
 * payment, legacy verification, setup, or live-feature state as approval.
 */

export type ReviewedBootstrapPlan = "solo_lite" | "solo_plus" | "business" | "generic";
export type ReviewedBootstrapOutcome =
  | "pending"
  | "needs_attention"
  | "rejected"
  | "restricted"
  | "suspended";

export type BootstrapComplianceStatus = Extract<
  MerchantComplianceStatus,
  | "draft"
  | "lite_pending"
  | "enhanced_pending"
  | "business_pending"
  | "needs_attention"
  | "restricted"
  | "rejected"
>;

export interface TrustedBootstrapIdentity {
  merchantId: string;
  workspaceId: string;
}

export interface ReviewedBootstrapEvidence {
  /** Trusted internal review reference; never browser-supplied metadata. */
  reviewSourceId: string;
  reviewerId: string;
  reviewedAt: string;
  /** The reviewing workflow, not payment or legacy verification, classifies evidence. */
  disposition: "reviewed" | "incomplete" | "ambiguous";
}

export interface ReviewedProfileBootstrapRequest {
  identity: TrustedBootstrapIdentity | null;
  bootstrapKey: string;
  plan: ReviewedBootstrapPlan;
  outcome?: ReviewedBootstrapOutcome;
  evidence: ReviewedBootstrapEvidence | null;
}

export interface ExistingComplianceProfileSnapshot {
  merchantId: string;
  workspaceId: string | null;
  complianceStatus: MerchantComplianceStatus | string | null;
  activationStatus: MerchantActivationStatus | string | null;
  restrictionState: MerchantRestrictionState | string | null;
  bootstrapKey: string | null;
}

export interface ReviewedProfileBootstrapRepository {
  findByMerchantAndBootstrapKey(input: {
    merchantId: string;
    bootstrapKey: string;
  }): Promise<ExistingComplianceProfileSnapshot | null>;
  findCurrentProfile(input: { merchantId: string }): Promise<ExistingComplianceProfileSnapshot | null>;
}

export type ReviewedProfileBootstrapReasonCode =
  | "trusted_identity_missing"
  | "bootstrap_key_missing"
  | "reviewed_evidence_missing"
  | "reviewed_evidence_ambiguous"
  | "bootstrap_plan_invalid"
  | "bootstrap_outcome_invalid"
  | "existing_profile_preserved"
  | "bootstrap_repository_error";

export interface ReviewedProfileBootstrapDiagnostic {
  code: ReviewedProfileBootstrapReasonCode;
}

export interface ReviewedProfileBootstrapPayload {
  merchantId: string;
  workspaceId: string;
  bootstrapKey: string;
  planCode: Exclude<ReviewedBootstrapPlan, "generic"> | "starter";
  complianceStatus: BootstrapComplianceStatus;
  activationStatus: Extract<MerchantActivationStatus, "test_mode" | "restricted" | "suspended">;
  restrictionState: Extract<MerchantRestrictionState, "restricted" | "suspended"> | null;
  reviewSourceId: string;
  reviewedBy: string;
  reviewedAt: string;
  /** Every bootstrap payload remains non-operational. */
  merchantEntitlements: {
    canCollectPayments: false;
    canUseInstantSale: false;
    canUseReceivableSale: false;
    canUseStorefront: false;
    canActivateSettlement: false;
    canUseDepositBalance: false;
  };
}

export type ReviewedProfileBootstrapResult =
  | { kind: "prepared"; payload: ReviewedProfileBootstrapPayload; diagnostics: readonly [] }
  | {
      kind: "existing";
      existing: ExistingComplianceProfileSnapshot;
      diagnostics: readonly ReviewedProfileBootstrapDiagnostic[];
    }
  | { kind: "rejected"; diagnostics: readonly ReviewedProfileBootstrapDiagnostic[] };

function nonEmpty(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function validIdentity(value: TrustedBootstrapIdentity | null): value is TrustedBootstrapIdentity {
  return Boolean(value && nonEmpty(value.merchantId) && nonEmpty(value.workspaceId));
}

function validEvidence(value: ReviewedBootstrapEvidence | null): value is ReviewedBootstrapEvidence {
  return Boolean(
    value
      && nonEmpty(value.reviewSourceId)
      && nonEmpty(value.reviewerId)
      && nonEmpty(value.reviewedAt),
  );
}

function isPreservedProfile(profile: ExistingComplianceProfileSnapshot | null): boolean {
  if (!profile) return false;
  const status = String(profile.complianceStatus ?? "").trim().toLowerCase();
  const restriction = String(profile.restrictionState ?? "").trim().toLowerCase();
  return ["lite_verified", "enhanced_verified", "business_verified", "restricted", "rejected"].includes(status)
    || ["restricted", "suspended"].includes(restriction);
}

function planStatus(plan: ReviewedBootstrapPlan): BootstrapComplianceStatus | null {
  switch (plan) {
    case "solo_lite": return "lite_pending";
    case "solo_plus": return "enhanced_pending";
    case "business": return "business_pending";
    case "generic": return "draft";
    default: return null;
  }
}

function safePlanCode(plan: ReviewedBootstrapPlan): ReviewedProfileBootstrapPayload["planCode"] {
  return plan === "generic" ? "starter" : plan;
}

function payloadFor(
  request: ReviewedProfileBootstrapRequest,
  status: BootstrapComplianceStatus,
  activationStatus: ReviewedProfileBootstrapPayload["activationStatus"],
  restrictionState: ReviewedProfileBootstrapPayload["restrictionState"],
): ReviewedProfileBootstrapPayload {
  return {
    merchantId: request.identity!.merchantId.trim(),
    workspaceId: request.identity!.workspaceId.trim(),
    bootstrapKey: request.bootstrapKey.trim(),
    planCode: safePlanCode(request.plan),
    complianceStatus: status,
    activationStatus,
    restrictionState,
    reviewSourceId: request.evidence!.reviewSourceId.trim(),
    reviewedBy: request.evidence!.reviewerId.trim(),
    reviewedAt: request.evidence!.reviewedAt.trim(),
    merchantEntitlements: {
      canCollectPayments: false,
      canUseInstantSale: false,
      canUseReceivableSale: false,
      canUseStorefront: false,
      canActivateSettlement: false,
      canUseDepositBalance: false,
    },
  };
}

/**
 * Produces only a non-operational bootstrap intent. A future reviewed command
 * owns any transaction/write; callers must not infer approval from this result.
 */
export async function prepareReviewedProfileBootstrap(
  request: ReviewedProfileBootstrapRequest,
  repository: ReviewedProfileBootstrapRepository,
): Promise<ReviewedProfileBootstrapResult> {
  if (!validIdentity(request.identity)) {
    return { kind: "rejected", diagnostics: [{ code: "trusted_identity_missing" }] };
  }
  if (!nonEmpty(request.bootstrapKey)) {
    return { kind: "rejected", diagnostics: [{ code: "bootstrap_key_missing" }] };
  }
  if (!validEvidence(request.evidence)) {
    return { kind: "rejected", diagnostics: [{ code: "reviewed_evidence_missing" }] };
  }
  if (request.evidence.disposition === "ambiguous") {
    return { kind: "rejected", diagnostics: [{ code: "reviewed_evidence_ambiguous" }] };
  }
  if (request.evidence.disposition !== "reviewed") {
    return { kind: "rejected", diagnostics: [{ code: "reviewed_evidence_missing" }] };
  }
  const defaultStatus = planStatus(request.plan);
  if (!defaultStatus) {
    return { kind: "rejected", diagnostics: [{ code: "bootstrap_plan_invalid" }] };
  }

  try {
    const keyed = await repository.findByMerchantAndBootstrapKey({
      merchantId: request.identity.merchantId.trim(),
      bootstrapKey: request.bootstrapKey.trim(),
    });
    if (keyed) return { kind: "existing", existing: keyed, diagnostics: [] };

    const current = await repository.findCurrentProfile({
      merchantId: request.identity.merchantId.trim(),
    });
    if (isPreservedProfile(current)) {
      return {
        kind: "existing",
        existing: current!,
        diagnostics: [{ code: "existing_profile_preserved" }],
      };
    }
  } catch {
    return { kind: "rejected", diagnostics: [{ code: "bootstrap_repository_error" }] };
  }

  const outcome = request.outcome ?? "pending";
  if (outcome === "pending") {
    return { kind: "prepared", payload: payloadFor(request, defaultStatus, "test_mode", null), diagnostics: [] };
  }
  if (outcome === "needs_attention") {
    return { kind: "prepared", payload: payloadFor(request, "needs_attention", "test_mode", null), diagnostics: [] };
  }
  if (outcome === "rejected") {
    return { kind: "prepared", payload: payloadFor(request, "rejected", "restricted", null), diagnostics: [] };
  }
  if (outcome === "restricted") {
    return { kind: "prepared", payload: payloadFor(request, "restricted", "restricted", "restricted"), diagnostics: [] };
  }
  if (outcome === "suspended") {
    return { kind: "prepared", payload: payloadFor(request, "restricted", "suspended", "suspended"), diagnostics: [] };
  }
  return { kind: "rejected", diagnostics: [{ code: "bootstrap_outcome_invalid" }] };
}
