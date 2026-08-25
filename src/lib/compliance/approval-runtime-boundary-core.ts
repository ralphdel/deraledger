import {
  prepareComplianceProfileApprovalCommand,
  type ComplianceApprovalPlan,
  type ComplianceApprovalReasonCode,
  type ComplianceApprovalSourceState,
  type ComplianceApprovalTargetState,
  type ComplianceProfileApprovalPayload,
  type ComplianceProfileApprovalReasonCode,
} from "./compliance-profile-approval-command-core";

/** Current authorization is intentionally limited to platform super-admins. */
export type ApprovalReviewerActorKind =
  | "super_admin"
  | "compliance_reviewer_deferred"
  | "merchant_owner"
  | "merchant_team"
  | "customer"
  | "anonymous"
  | "browser_direct";

export interface ApprovalReviewerIdentityRepository {
  resolveAuthenticatedReviewer(): Promise<{
    actorKind: ApprovalReviewerActorKind;
    reviewerId: string | null;
    origin: "server_session" | "browser_input";
  } | null>;
}

export interface CanonicalApprovalProfile {
  merchantId: string;
  workspaceId: string;
  profileId: string;
  planCode: ComplianceApprovalPlan;
  complianceStatus: ComplianceApprovalSourceState;
  rowVersion: number;
  freshness: "current" | "stale";
}

export interface CanonicalApprovalSource {
  sourceType: "solo_lite_review" | "business_kyb_review" | "solo_plus_case";
  sourceId: string;
  merchantId: string;
  profileId: string;
  planCode: ComplianceApprovalPlan;
  sourceVersion: number;
  reviewedSourceVersion: number;
  policyVersion: string | null;
  evidenceState: "complete" | "incomplete";
  freshness: "current" | "stale";
}

/**
 * The eventual implementation must bind this repository to a trusted internal
 * review context. It receives no browser-selected IDs or row versions.
 */
export interface CanonicalApprovalReadRepository {
  loadOneCanonicalProfile(): Promise<CanonicalApprovalProfile | null>;
  loadOneCanonicalSource(): Promise<CanonicalApprovalSource | null>;
  reconcileDecisionIdempotency(input: {
    reviewerId: string;
    profileId: string;
    sourceId: string;
    targetComplianceStatus: ComplianceApprovalTargetState;
    policyVersion: string;
    reasonCode: ComplianceApprovalReasonCode | null;
  }): Promise<{ decisionIdempotencyKey: string } | null>;
}

/** This is the complete browser-permitted input surface. */
export interface ApprovalRuntimeUiIntent {
  targetComplianceStatus: ComplianceApprovalTargetState;
  reasonCode?: ComplianceApprovalReasonCode | null;
}

export type ApprovalRuntimeBoundaryReasonCode =
  | "approval_runtime_reviewer_denied"
  | "approval_runtime_profile_missing"
  | "approval_runtime_profile_stale"
  | "approval_runtime_source_missing"
  | "approval_runtime_source_stale"
  | "approval_runtime_source_mismatch"
  | "approval_runtime_policy_missing"
  | "approval_runtime_idempotency_missing"
  | "approval_runtime_execution_failed"
  | "approval_runtime_execution_unknown";

export type ApprovalRuntimeBoundaryResult =
  | { kind: "prepared"; profileId: string; payload: ComplianceProfileApprovalPayload; diagnostics: readonly [] }
  | { kind: "rejected"; diagnostics: readonly [{ code: ApprovalRuntimeBoundaryReasonCode | ComplianceProfileApprovalReasonCode }] };

export interface ApprovalRuntimeExecutionPort {
  /** Fake/injected seam only; this core never imports the transport or RPC. */
  execute(input: { profileId: string; payload: ComplianceProfileApprovalPayload }): Promise<unknown>;
}

export type ApprovalRuntimeExecutionResult =
  | { kind: "created" | "replay" | "preserved"; diagnostics: readonly [] }
  | { kind: "rejected"; diagnostics: readonly [{ code: ApprovalRuntimeBoundaryReasonCode | ComplianceProfileApprovalReasonCode }] };

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function nonEmpty(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function sourceMatchesProfile(profile: CanonicalApprovalProfile, source: CanonicalApprovalSource): boolean {
  return profile.merchantId === source.merchantId
    && profile.profileId === source.profileId
    && profile.planCode === source.planCode
    && positiveInteger(profile.rowVersion)
    && positiveInteger(source.sourceVersion)
    && source.sourceVersion === source.reviewedSourceVersion;
}

/**
 * Builds a validated approval command from server-derived identity and facts.
 * No client, database, RPC transport, or write operation is created here.
 */
export function createApprovalRuntimeBoundary(dependencies: {
  reviewerIdentityRepository: ApprovalReviewerIdentityRepository;
  canonicalReadRepository: CanonicalApprovalReadRepository;
  now?: () => Date;
}): {
  prepare(intent: ApprovalRuntimeUiIntent): Promise<ApprovalRuntimeBoundaryResult>;
  executeWithInjectedPortForTest(
    intent: ApprovalRuntimeUiIntent,
    port: ApprovalRuntimeExecutionPort,
  ): Promise<ApprovalRuntimeExecutionResult>;
} {
  const now = dependencies.now ?? (() => new Date());

  async function prepare(intent: ApprovalRuntimeUiIntent): Promise<ApprovalRuntimeBoundaryResult> {
    const reviewer = await dependencies.reviewerIdentityRepository.resolveAuthenticatedReviewer();
    if (!reviewer || reviewer.actorKind !== "super_admin" || reviewer.origin !== "server_session" || !nonEmpty(reviewer.reviewerId)) {
      return { kind: "rejected", diagnostics: [{ code: "approval_runtime_reviewer_denied" }] };
    }
    const [profile, source] = await Promise.all([
      dependencies.canonicalReadRepository.loadOneCanonicalProfile(),
      dependencies.canonicalReadRepository.loadOneCanonicalSource(),
    ]);
    if (!profile) return { kind: "rejected", diagnostics: [{ code: "approval_runtime_profile_missing" }] };
    if (profile.freshness !== "current" || !positiveInteger(profile.rowVersion)) {
      return { kind: "rejected", diagnostics: [{ code: "approval_runtime_profile_stale" }] };
    }
    if (!source) return { kind: "rejected", diagnostics: [{ code: "approval_runtime_source_missing" }] };
    if (source.freshness !== "current" || !positiveInteger(source.sourceVersion) || source.sourceVersion !== source.reviewedSourceVersion) {
      return { kind: "rejected", diagnostics: [{ code: "approval_runtime_source_stale" }] };
    }
    if (!sourceMatchesProfile(profile, source)) {
      return { kind: "rejected", diagnostics: [{ code: "approval_runtime_source_mismatch" }] };
    }
    const policyVersion = nonEmpty(source.policyVersion);
    if (!policyVersion) return { kind: "rejected", diagnostics: [{ code: "approval_runtime_policy_missing" }] };
    const idempotency = await dependencies.canonicalReadRepository.reconcileDecisionIdempotency({
      reviewerId: reviewer.reviewerId!, profileId: profile.profileId, sourceId: source.sourceId,
      targetComplianceStatus: intent.targetComplianceStatus, policyVersion, reasonCode: intent.reasonCode ?? null,
    });
    const decisionIdempotencyKey = nonEmpty(idempotency?.decisionIdempotencyKey ?? null);
    if (!decisionIdempotencyKey) return { kind: "rejected", diagnostics: [{ code: "approval_runtime_idempotency_missing" }] };

    const command = prepareComplianceProfileApprovalCommand({
      identity: { merchantId: profile.merchantId, workspaceId: profile.workspaceId, authority: "trusted_server" },
      approvalDecisionKey: decisionIdempotencyKey,
      expectedProfileRowVersion: profile.rowVersion,
      plan: profile.planCode,
      sourceComplianceStatus: profile.complianceStatus,
      targetComplianceStatus: intent.targetComplianceStatus,
      reviewer: { reviewerId: reviewer.reviewerId!, authorization: "internal_compliance_reviewer", authorized: true },
      evidence: {
        sourceType: source.sourceType, sourceId: source.sourceId, evidenceVersion: source.sourceVersion,
        evidenceState: source.evidenceState, reviewedAt: now().toISOString(), policyVersion,
        authority: "trusted_review_workflow",
      },
      reasonCode: intent.reasonCode ?? null,
      restrictionOutcome: intent.targetComplianceStatus === "restricted" && intent.reasonCode === "risk_suspended" ? "suspended" : "none",
    });
    if (command.kind === "existing") {
      return { kind: "rejected", diagnostics: [{ code: "approval_profile_preserved" }] };
    }
    if (command.kind === "rejected") return command;
    return { kind: "prepared", profileId: profile.profileId, payload: command.payload, diagnostics: [] };
  }

  return {
    prepare,
    async executeWithInjectedPortForTest(intent, port) {
      const result = await prepare(intent);
      if (result.kind !== "prepared") return result;
      try {
        const executed = await port.execute({ profileId: result.profileId, payload: result.payload });
        if (executed && typeof executed === "object" && (executed as { kind?: unknown }).kind === "created") return { kind: "created", diagnostics: [] };
        if (executed && typeof executed === "object" && (executed as { kind?: unknown }).kind === "replay") return { kind: "replay", diagnostics: [] };
        if (executed && typeof executed === "object" && (executed as { kind?: unknown }).kind === "preserved") return { kind: "preserved", diagnostics: [] };
        return { kind: "rejected", diagnostics: [{ code: "approval_runtime_execution_unknown" }] };
      } catch {
        return { kind: "rejected", diagnostics: [{ code: "approval_runtime_execution_failed" }] };
      }
    },
  };
}
