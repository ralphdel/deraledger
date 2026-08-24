import type {
  ComplianceApprovalPlan,
  ComplianceProfileApprovalPayload,
} from "./compliance-profile-approval-command-core";

/**
 * Persistence contract only for a future approval transaction. This core has
 * no database client and never executes the approval; a later service-role
 * transport may consume a `ready` result inside one atomic transaction.
 */

export interface ComplianceApprovalServiceRoleContext {
  databaseRole: "service_role" | "anon" | "authenticated" | "browser" | "unknown";
  internalReviewAuthorized: boolean;
}

export interface PersistedApprovalProfile {
  id: string;
  merchantId: string;
  complianceStatus: string | null;
  activationStatus: string | null;
  restrictionState: string | null;
  rowVersion: number | null;
}

export interface PersistedApprovalReview {
  id: string;
  merchantId: string;
  profileId: string;
  reviewType: "solo_lite" | "business_kyb";
  sourceId: string;
  rowVersion: number | null;
}

export interface PersistedSoloPlusApprovalCase {
  id: string;
  merchantId: string;
  profileId: string;
  sourceId: string;
  rowVersion: number | null;
}

export interface PersistedApprovalEvent {
  id: string;
  merchantId: string;
  profileId: string;
  idempotencyKey: string;
  sourceType: "solo_lite_review" | "solo_plus_case" | "business_kyb_review";
  sourceId: string;
  complianceStatus: string;
  resultingRowVersion: number | null;
}

export interface ComplianceProfileApprovalPersistenceSnapshot {
  profiles: readonly PersistedApprovalProfile[];
  reviews: readonly PersistedApprovalReview[];
  soloPlusCases: readonly PersistedSoloPlusApprovalCase[];
  events: readonly PersistedApprovalEvent[];
}

/**
 * The future transport may expose only these operations. In particular, it
 * cannot represent entitlement, limit, merchant, workspace, subscription,
 * payment, provider, settlement, invoice, or activation writes.
 */
export interface ComplianceProfileApprovalAtomicWriter {
  findProfiles(merchantId: string): Promise<readonly PersistedApprovalProfile[]>;
  findReviewsByApprovalSource(input: {
    merchantId: string;
    profileId: string;
    sourceId: string;
  }): Promise<readonly PersistedApprovalReview[]>;
  findSoloPlusCasesByApprovalSource(input: {
    merchantId: string;
    profileId: string;
    sourceId: string;
  }): Promise<readonly PersistedSoloPlusApprovalCase[]>;
  findEventsByApprovalDecisionKey(input: {
    merchantId: string;
    approvalDecisionKey: string;
  }): Promise<readonly PersistedApprovalEvent[]>;
  updateProfileDecision(row: Record<string, unknown>): Promise<{ id: string; rowVersion: number } | null>;
  updateReviewDecision(row: Record<string, unknown>): Promise<{ id: string; rowVersion: number } | null>;
  bindSoloPlusCaseDecision(row: Record<string, unknown>): Promise<{ id: string; rowVersion: number } | null>;
  appendApprovalEvent(row: Record<string, unknown>): Promise<{ id: string } | null>;
}

export interface ComplianceProfileApprovalPersistenceDatabase {
  executeAtomically<T>(
    operation: (writer: ComplianceProfileApprovalAtomicWriter) => Promise<T>,
  ): Promise<T>;
}

export type ComplianceProfileApprovalPersistenceReasonCode =
  | "approval_persistence_command_missing"
  | "approval_persistence_context_denied"
  | "approval_persistence_payload_invalid"
  | "approval_profile_missing"
  | "approval_profile_ambiguous"
  | "approval_profile_preserved"
  | "approval_row_version_conflict"
  | "approval_source_mismatch"
  | "approval_review_missing"
  | "approval_review_ambiguous"
  | "approval_case_missing"
  | "approval_case_ambiguous"
  | "approval_event_ambiguous"
  | "approval_idempotent_replay"
  | "approval_replay_inconsistent";

export type ComplianceProfileApprovalPersistenceResult =
  | {
      kind: "ready";
      profileId: string;
      nextRowVersion: number;
      reviewUpdate: { reviewId: string } | null;
      soloPlusCaseBinding: { caseId: string } | null;
      diagnostics: readonly [];
    }
  | {
      kind: "replay";
      profileId: string;
      eventId: string;
      diagnostics: readonly [{ code: "approval_idempotent_replay" }];
    }
  | {
      kind: "preserved";
      profileId: string;
      diagnostics: readonly [{ code: "approval_profile_preserved" }];
    }
  | {
      kind: "rejected";
      diagnostics: readonly [{ code: Exclude<
        ComplianceProfileApprovalPersistenceReasonCode,
        "approval_profile_preserved"
      > }];
    };

const REVIEW_TYPE_BY_PLAN: Record<Exclude<ComplianceApprovalPlan, "solo_plus">, PersistedApprovalReview["reviewType"]> = {
  solo_lite: "solo_lite",
  business: "business_kyb",
};

const SOURCE_TYPE_BY_PLAN: Record<ComplianceApprovalPlan, PersistedApprovalEvent["sourceType"]> = {
  solo_lite: "solo_lite_review",
  solo_plus: "solo_plus_case",
  business: "business_kyb_review",
};

function nonEmpty(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function hasFalseEntitlements(payload: ComplianceProfileApprovalPayload): boolean {
  const value = payload as unknown as { merchantEntitlements?: Record<string, unknown> };
  return [
    "canCollectPayments",
    "canUseInstantSale",
    "canUseReceivableSale",
    "canUseStorefront",
    "canActivateSettlement",
    "canUseDepositBalance",
  ].every((key) => value.merchantEntitlements?.[key] === false);
}

function isValidPayload(payload: ComplianceProfileApprovalPayload): boolean {
  const value = payload as unknown as {
    activationStatus?: unknown;
    restrictionState?: unknown;
  };
  return Boolean(
    nonEmpty(payload.merchantId)
      && nonEmpty(payload.workspaceId)
      && nonEmpty(payload.approvalDecisionKey)
      && nonEmpty(payload.reviewedBy)
      && nonEmpty(payload.reviewedAt)
      && nonEmpty(payload.reviewSourceId)
      && nonEmpty(payload.policyVersion)
      && Number.isInteger(payload.expectedProfileRowVersion)
      && payload.expectedProfileRowVersion > 0
      && Number.isInteger(payload.evidenceVersion)
      && payload.evidenceVersion > 0
      && value.activationStatus !== "approved"
      && value.restrictionState !== "active"
      && payload.reviewSourceType === SOURCE_TYPE_BY_PLAN[payload.planCode]
      && hasFalseEntitlements(payload),
  );
}

function isServiceRoleContext(context: ComplianceApprovalServiceRoleContext | null): boolean {
  return Boolean(context?.databaseRole === "service_role" && context.internalReviewAuthorized === true);
}

function isPreserved(profile: PersistedApprovalProfile): boolean {
  const status = String(profile.complianceStatus ?? "").trim().toLowerCase();
  const restriction = String(profile.restrictionState ?? "").trim().toLowerCase();
  return ["lite_verified", "enhanced_verified", "business_verified", "rejected", "restricted"].includes(status)
    || ["restricted", "suspended"].includes(restriction);
}

function sourceMatchesProfile(
  command: ComplianceProfileApprovalPayload,
  profile: PersistedApprovalProfile,
): boolean {
  return profile.merchantId === command.merchantId
    && profile.rowVersion === command.expectedProfileRowVersion
    && profile.complianceStatus === command.sourceComplianceStatus;
}

function replayMatches(
  event: PersistedApprovalEvent,
  command: ComplianceProfileApprovalPayload,
  profile: PersistedApprovalProfile,
): boolean {
  return event.merchantId === command.merchantId
    && event.profileId === profile.id
    && event.idempotencyKey === command.approvalDecisionKey
    && event.sourceType === command.reviewSourceType
    && event.sourceId === command.reviewSourceId
    && event.complianceStatus === command.complianceStatus
    && event.resultingRowVersion === command.expectedProfileRowVersion + 1;
}

/**
 * Validates a future persistence operation against already-loaded, trusted
 * snapshots. It neither creates a transaction nor invokes a database writer.
 */
export function prepareComplianceProfileApprovalPersistence(
  command: ComplianceProfileApprovalPayload | null,
  context: ComplianceApprovalServiceRoleContext | null,
  snapshot: ComplianceProfileApprovalPersistenceSnapshot,
): ComplianceProfileApprovalPersistenceResult {
  if (!command) {
    return { kind: "rejected", diagnostics: [{ code: "approval_persistence_command_missing" }] };
  }
  if (!isServiceRoleContext(context)) {
    return { kind: "rejected", diagnostics: [{ code: "approval_persistence_context_denied" }] };
  }
  if (!isValidPayload(command)) {
    return { kind: "rejected", diagnostics: [{ code: "approval_persistence_payload_invalid" }] };
  }
  if (snapshot.profiles.length === 0) {
    return { kind: "rejected", diagnostics: [{ code: "approval_profile_missing" }] };
  }
  if (snapshot.profiles.length !== 1) {
    return { kind: "rejected", diagnostics: [{ code: "approval_profile_ambiguous" }] };
  }
  const profile = snapshot.profiles[0];
  if (isPreserved(profile)) {
    return { kind: "preserved", profileId: profile.id, diagnostics: [{ code: "approval_profile_preserved" }] };
  }
  if (!sourceMatchesProfile(command, profile)) {
    return { kind: "rejected", diagnostics: [{ code: "approval_row_version_conflict" }] };
  }
  if (snapshot.events.length > 1) {
    return { kind: "rejected", diagnostics: [{ code: "approval_event_ambiguous" }] };
  }
  if (snapshot.events.length === 1) {
    return replayMatches(snapshot.events[0], command, profile)
      ? { kind: "replay", profileId: profile.id, eventId: snapshot.events[0].id, diagnostics: [{ code: "approval_idempotent_replay" }] }
      : { kind: "rejected", diagnostics: [{ code: "approval_replay_inconsistent" }] };
  }

  if (command.planCode === "solo_plus") {
    if (snapshot.reviews.length !== 0) {
      return { kind: "rejected", diagnostics: [{ code: "approval_source_mismatch" }] };
    }
    if (snapshot.soloPlusCases.length === 0) {
      return { kind: "rejected", diagnostics: [{ code: "approval_case_missing" }] };
    }
    if (snapshot.soloPlusCases.length !== 1) {
      return { kind: "rejected", diagnostics: [{ code: "approval_case_ambiguous" }] };
    }
    const source = snapshot.soloPlusCases[0];
    if (source.merchantId !== command.merchantId || source.profileId !== profile.id || source.sourceId !== command.reviewSourceId) {
      return { kind: "rejected", diagnostics: [{ code: "approval_source_mismatch" }] };
    }
    return {
      kind: "ready",
      profileId: profile.id,
      nextRowVersion: command.expectedProfileRowVersion + 1,
      reviewUpdate: null,
      soloPlusCaseBinding: { caseId: source.id },
      diagnostics: [],
    };
  }

  if (snapshot.soloPlusCases.length !== 0) {
    return { kind: "rejected", diagnostics: [{ code: "approval_source_mismatch" }] };
  }
  if (snapshot.reviews.length === 0) {
    return { kind: "rejected", diagnostics: [{ code: "approval_review_missing" }] };
  }
  if (snapshot.reviews.length !== 1) {
    return { kind: "rejected", diagnostics: [{ code: "approval_review_ambiguous" }] };
  }
  const review = snapshot.reviews[0];
  if (review.merchantId !== command.merchantId
    || review.profileId !== profile.id
    || review.sourceId !== command.reviewSourceId
    || review.reviewType !== REVIEW_TYPE_BY_PLAN[command.planCode]) {
    return { kind: "rejected", diagnostics: [{ code: "approval_source_mismatch" }] };
  }
  return {
    kind: "ready",
    profileId: profile.id,
    nextRowVersion: command.expectedProfileRowVersion + 1,
    reviewUpdate: { reviewId: review.id },
    soloPlusCaseBinding: null,
    diagnostics: [],
  };
}
