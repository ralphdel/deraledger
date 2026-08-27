/**
 * Pure, injected mapping layer for Migration 030 canonical-readiness RPCs.
 * It creates no database client and is not an approval decision executor.
 */

export const ISSUE_CANONICAL_APPROVAL_DECISION_REQUEST_V2_RPC =
  "issue_canonical_approval_decision_request_v2" as const;
export const READ_CANONICAL_APPROVAL_SNAPSHOT_V2_RPC =
  "read_canonical_approval_snapshot_v2" as const;

export type CanonicalApprovalPlan = "solo_lite" | "solo_plus" | "business";
export type CanonicalApprovalSourceType = "solo_lite_review" | "solo_plus_case" | "business_kyb_review";
export type CanonicalApprovalTargetStatus =
  | "lite_verified"
  | "enhanced_verified"
  | "business_verified"
  | "needs_attention"
  | "restricted"
  | "rejected";
export type CanonicalApprovalReasonCode =
  | "evidence_incomplete"
  | "evidence_expired"
  | "evidence_mismatch"
  | "review_rejected"
  | "reviewer_requested_correction"
  | "policy_restriction"
  | "risk_restricted"
  | "risk_suspended";

/** Returned only by an injected server-session/RBAC resolver, never by a caller command. */
export interface CanonicalApprovalReadinessDerivedReviewer {
  actorKind: "super_admin" | "compliance_reviewer_deferred" | "merchant_owner" | "merchant_team" | "customer" | "anonymous" | "browser_direct";
  reviewerId: string | null;
}

export interface CanonicalApprovalReadinessReviewerResolver {
  resolveServerSessionReviewer(): Promise<CanonicalApprovalReadinessDerivedReviewer | null>;
}

/** M030 derives source, versions, workspace, and idempotency from trusted rows. */
export interface IssueCanonicalApprovalReadinessCommand {
  profileId: string;
  targetComplianceStatus: CanonicalApprovalTargetStatus;
  policyVersion: string;
  reasonCode?: CanonicalApprovalReasonCode | null;
}

export interface ReadCanonicalApprovalSnapshotCommand {
  decisionRequestId: string;
}

export interface IssueCanonicalApprovalDecisionRequestV2Arguments {
  p_profile_id: string;
  p_reviewer_id: string;
  p_target_compliance_status: CanonicalApprovalTargetStatus;
  p_policy_version: string;
  p_reason_code: CanonicalApprovalReasonCode | null;
}

export interface ReadCanonicalApprovalSnapshotV2Arguments {
  p_decision_request_id: string;
}

export interface CanonicalApprovalIssueRpcRow {
  result_code: string;
  decision_request_id: string | null;
  decision_idempotency_key: string | null;
}

export interface CanonicalApprovalSnapshotRpcRow extends CanonicalApprovalIssueRpcRow {
  merchant_id: string | null;
  workspace_id: string | null;
  profile_id: string | null;
  plan_code: string | null;
  current_compliance_status: string | null;
  source_type: string | null;
  source_id: string | null;
  source_version: number | null;
  expected_profile_row_version: number | null;
  policy_version: string | null;
  reviewer_id: string | null;
  reviewed_at: string | null;
  reason_code: string | null;
  target_compliance_status: string | null;
}

export interface CanonicalApprovalReadinessRpcTransport {
  issueCanonicalApprovalDecisionRequestV2(
    functionName: typeof ISSUE_CANONICAL_APPROVAL_DECISION_REQUEST_V2_RPC,
    arguments_: IssueCanonicalApprovalDecisionRequestV2Arguments,
  ): Promise<readonly CanonicalApprovalIssueRpcRow[]>;
  readCanonicalApprovalSnapshotV2(
    functionName: typeof READ_CANONICAL_APPROVAL_SNAPSHOT_V2_RPC,
    arguments_: ReadCanonicalApprovalSnapshotV2Arguments,
  ): Promise<readonly CanonicalApprovalSnapshotRpcRow[]>;
}

export type CanonicalApprovalReadinessReasonCode =
  | "canonical_readiness_authority_denied"
  | "canonical_readiness_payload_invalid"
  | "canonical_readiness_transport_failed"
  | "canonical_readiness_response_invalid"
  | "canonical_readiness_result_unknown"
  | "canonical_request_v2_payload_invalid"
  | "canonical_request_v2_reviewer_invalid"
  | "canonical_request_v2_profile_missing"
  | "canonical_request_v2_profile_state_invalid"
  | "canonical_request_v2_workspace_linkage_unavailable"
  | "canonical_request_v2_workspace_linkage_conflict"
  | "canonical_request_v2_policy_invalid"
  | "canonical_request_v2_source_invalid"
  | "canonical_request_v2_idempotency_conflict"
  | "canonical_request_v2_failed"
  | "canonical_snapshot_v2_payload_invalid"
  | "canonical_snapshot_v2_request_missing"
  | "canonical_snapshot_v2_profile_missing"
  | "canonical_snapshot_v2_stale_or_conflicting"
  | "canonical_snapshot_v2_workspace_linkage_unavailable"
  | "canonical_snapshot_v2_workspace_linkage_conflict"
  | "canonical_snapshot_v2_policy_invalid"
  | "canonical_snapshot_v2_source_invalid"
  | "canonical_snapshot_v2_failed";

export type CanonicalApprovalReadinessIssueResult =
  | { kind: "created"; decisionRequestId: string; decisionIdempotencyKey: string; diagnostics: readonly [] }
  | { kind: "replay"; decisionRequestId: string; decisionIdempotencyKey: string; diagnostics: readonly [{ code: "canonical_request_v2_idempotent_replay" }] }
  | { kind: "rejected"; diagnostics: readonly [{ code: CanonicalApprovalReadinessReasonCode }] };

export interface CanonicalApprovalSnapshot {
  decisionRequestId: string;
  decisionIdempotencyKey: string;
  merchantId: string;
  workspaceId: string;
  profileId: string;
  planCode: CanonicalApprovalPlan;
  currentComplianceStatus: string;
  sourceType: CanonicalApprovalSourceType;
  sourceId: string;
  sourceVersion: number;
  expectedProfileRowVersion: number;
  policyVersion: string;
  reviewerId: string;
  reviewedAt: string;
  reasonCode: CanonicalApprovalReasonCode | null;
  targetComplianceStatus: CanonicalApprovalTargetStatus;
}

export type CanonicalApprovalReadinessSnapshotResult =
  | { kind: "ready"; snapshot: CanonicalApprovalSnapshot; diagnostics: readonly [] }
  | { kind: "rejected"; diagnostics: readonly [{ code: CanonicalApprovalReadinessReasonCode }] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TARGETS = new Set<CanonicalApprovalTargetStatus>(["lite_verified", "enhanced_verified", "business_verified", "needs_attention", "restricted", "rejected"]);
const REASONS = new Set<CanonicalApprovalReasonCode>(["evidence_incomplete", "evidence_expired", "evidence_mismatch", "review_rejected", "reviewer_requested_correction", "policy_restriction", "risk_restricted", "risk_suspended"]);
const PLANS = new Set<CanonicalApprovalPlan>(["solo_lite", "solo_plus", "business"]);
const SOURCES = new Set<CanonicalApprovalSourceType>(["solo_lite_review", "solo_plus_case", "business_kyb_review"]);
const ISSUE_REJECTIONS = new Set<CanonicalApprovalReadinessReasonCode>([
  "canonical_request_v2_payload_invalid", "canonical_request_v2_reviewer_invalid", "canonical_request_v2_profile_missing", "canonical_request_v2_profile_state_invalid", "canonical_request_v2_workspace_linkage_unavailable", "canonical_request_v2_workspace_linkage_conflict", "canonical_request_v2_policy_invalid", "canonical_request_v2_source_invalid", "canonical_request_v2_idempotency_conflict", "canonical_request_v2_failed",
]);
const SNAPSHOT_REJECTIONS = new Set<CanonicalApprovalReadinessReasonCode>([
  "canonical_snapshot_v2_payload_invalid", "canonical_snapshot_v2_request_missing", "canonical_snapshot_v2_profile_missing", "canonical_snapshot_v2_stale_or_conflicting", "canonical_snapshot_v2_workspace_linkage_unavailable", "canonical_snapshot_v2_workspace_linkage_conflict", "canonical_snapshot_v2_policy_invalid", "canonical_snapshot_v2_source_invalid", "canonical_snapshot_v2_failed",
]);

function nonEmpty(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value.trim());
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function derivedReviewerId(reviewer: CanonicalApprovalReadinessDerivedReviewer | null): string | null {
  if (!reviewer || reviewer.actorKind !== "super_admin" || !validUuid(reviewer.reviewerId)) return null;
  return reviewer.reviewerId.trim();
}

function validIssueInput(command: IssueCanonicalApprovalReadinessCommand, reviewerId: string): boolean {
  const reason = command.reasonCode ?? null;
  return validUuid(command.profileId)
    && Boolean(reviewerId)
    && TARGETS.has(command.targetComplianceStatus)
    && Boolean(nonEmpty(command.policyVersion))
    && (reason === null || REASONS.has(reason));
}

function exactlyOne<T>(rows: readonly T[]): T | null {
  return rows.length === 1 ? rows[0] : null;
}

function issueIdAndKey(row: CanonicalApprovalIssueRpcRow): { id: string; key: string } | null {
  const id = validUuid(row.decision_request_id) ? row.decision_request_id.trim() : null;
  const key = nonEmpty(row.decision_idempotency_key);
  return id && key ? { id, key } : null;
}

function snapshotFromRow(row: CanonicalApprovalSnapshotRpcRow): CanonicalApprovalSnapshot | null {
  const issue = issueIdAndKey(row);
  const merchantId = validUuid(row.merchant_id) ? row.merchant_id.trim() : null;
  const workspaceId = validUuid(row.workspace_id) ? row.workspace_id.trim() : null;
  const profileId = validUuid(row.profile_id) ? row.profile_id.trim() : null;
  const sourceId = validUuid(row.source_id) ? row.source_id.trim() : null;
  const reviewerId = validUuid(row.reviewer_id) ? row.reviewer_id.trim() : null;
  const currentComplianceStatus = nonEmpty(row.current_compliance_status);
  const policyVersion = nonEmpty(row.policy_version);
  const reviewedAt = nonEmpty(row.reviewed_at);
  const reasonCode = nonEmpty(row.reason_code);
  if (!issue || !validUuid(row.merchant_id) || !validUuid(row.workspace_id) || !validUuid(row.profile_id)
    || !validUuid(row.source_id) || !validUuid(row.reviewer_id) || !PLANS.has(row.plan_code as CanonicalApprovalPlan)
    || !SOURCES.has(row.source_type as CanonicalApprovalSourceType) || !TARGETS.has(row.target_compliance_status as CanonicalApprovalTargetStatus)
    || !positiveInteger(row.source_version) || !positiveInteger(row.expected_profile_row_version)
    || !merchantId || !workspaceId || !profileId || !sourceId || !reviewerId || !currentComplianceStatus || !policyVersion || !reviewedAt
    || (reasonCode !== null && !REASONS.has(reasonCode as CanonicalApprovalReasonCode))
    || !snapshotPlanStateIsCompatible(row)) return null;
  return {
    decisionRequestId: issue.id, decisionIdempotencyKey: issue.key, merchantId, workspaceId,
    profileId, planCode: row.plan_code as CanonicalApprovalPlan,
    currentComplianceStatus, sourceType: row.source_type as CanonicalApprovalSourceType,
    sourceId, sourceVersion: row.source_version, expectedProfileRowVersion: row.expected_profile_row_version,
    policyVersion, reviewerId, reviewedAt,
    reasonCode: reasonCode as CanonicalApprovalReasonCode | null, targetComplianceStatus: row.target_compliance_status as CanonicalApprovalTargetStatus,
  };
}

/** Defense in depth: never surface a payload that contradicts M030's plan/source/status contract. */
function snapshotPlanStateIsCompatible(row: CanonicalApprovalSnapshotRpcRow): boolean {
  const plan = row.plan_code as CanonicalApprovalPlan;
  const source = row.source_type as CanonicalApprovalSourceType;
  const status = nonEmpty(row.current_compliance_status);
  const target = row.target_compliance_status as CanonicalApprovalTargetStatus;
  const expectedSource: Record<CanonicalApprovalPlan, CanonicalApprovalSourceType> = {
    solo_lite: "solo_lite_review", solo_plus: "solo_plus_case", business: "business_kyb_review",
  };
  const compatibleStatus = (plan === "solo_lite" && (status === "lite_pending" || status === "needs_attention"))
    || (plan === "solo_plus" && (status === "enhanced_pending" || status === "needs_attention"))
    || (plan === "business" && (status === "business_pending" || status === "needs_attention"));
  const compatibleVerifiedTarget = target === "needs_attention" || target === "restricted" || target === "rejected"
    || (plan === "solo_lite" && target === "lite_verified")
    || (plan === "solo_plus" && target === "enhanced_verified")
    || (plan === "business" && target === "business_verified");
  return expectedSource[plan] === source && compatibleStatus && compatibleVerifiedTarget;
}

function issueArguments(
  command: IssueCanonicalApprovalReadinessCommand,
  reviewerId: string,
): IssueCanonicalApprovalDecisionRequestV2Arguments | null {
  if (!reviewerId || !validIssueInput(command, reviewerId)) return null;
  return {
    p_profile_id: command.profileId.trim(), p_reviewer_id: reviewerId,
    p_target_compliance_status: command.targetComplianceStatus, p_policy_version: command.policyVersion.trim(),
    p_reason_code: command.reasonCode ?? null,
  };
}

export function createCanonicalApprovalReadiness(dependencies: {
  transport: CanonicalApprovalReadinessRpcTransport | null;
  reviewerResolver: CanonicalApprovalReadinessReviewerResolver;
}): {
  issue(command: IssueCanonicalApprovalReadinessCommand): Promise<CanonicalApprovalReadinessIssueResult>;
  readSnapshot(command: ReadCanonicalApprovalSnapshotCommand): Promise<CanonicalApprovalReadinessSnapshotResult>;
} {
  return {
    async issue(command) {
      let reviewerId: string | null;
      try { reviewerId = derivedReviewerId(await dependencies.reviewerResolver.resolveServerSessionReviewer()); } catch { reviewerId = null; }
      if (!reviewerId) return { kind: "rejected", diagnostics: [{ code: "canonical_readiness_authority_denied" }] };
      const arguments_ = issueArguments(command, reviewerId);
      if (!arguments_) return { kind: "rejected", diagnostics: [{ code: "canonical_readiness_payload_invalid" }] };
      if (!dependencies.transport) return { kind: "rejected", diagnostics: [{ code: "canonical_readiness_transport_failed" }] };
      try {
        const row = exactlyOne(await dependencies.transport.issueCanonicalApprovalDecisionRequestV2(ISSUE_CANONICAL_APPROVAL_DECISION_REQUEST_V2_RPC, arguments_));
        if (!row) return { kind: "rejected", diagnostics: [{ code: "canonical_readiness_response_invalid" }] };
        const issue = issueIdAndKey(row);
        if (row.result_code === "canonical_request_v2_created" && issue) return { kind: "created", decisionRequestId: issue.id, decisionIdempotencyKey: issue.key, diagnostics: [] };
        if (row.result_code === "canonical_request_v2_idempotent_replay" && issue) return { kind: "replay", decisionRequestId: issue.id, decisionIdempotencyKey: issue.key, diagnostics: [{ code: "canonical_request_v2_idempotent_replay" }] };
        if (ISSUE_REJECTIONS.has(row.result_code as CanonicalApprovalReadinessReasonCode)) return { kind: "rejected", diagnostics: [{ code: row.result_code as CanonicalApprovalReadinessReasonCode }] };
        return { kind: "rejected", diagnostics: [{ code: "canonical_readiness_result_unknown" }] };
      } catch {
        return { kind: "rejected", diagnostics: [{ code: "canonical_readiness_transport_failed" }] };
      }
    },
    async readSnapshot(command) {
      try {
        if (!derivedReviewerId(await dependencies.reviewerResolver.resolveServerSessionReviewer())) {
          return { kind: "rejected", diagnostics: [{ code: "canonical_readiness_authority_denied" }] };
        }
      } catch {
        return { kind: "rejected", diagnostics: [{ code: "canonical_readiness_authority_denied" }] };
      }
      if (!validUuid(command.decisionRequestId)) return { kind: "rejected", diagnostics: [{ code: "canonical_readiness_payload_invalid" }] };
      if (!dependencies.transport) return { kind: "rejected", diagnostics: [{ code: "canonical_readiness_transport_failed" }] };
      try {
        const row = exactlyOne(await dependencies.transport.readCanonicalApprovalSnapshotV2(READ_CANONICAL_APPROVAL_SNAPSHOT_V2_RPC, { p_decision_request_id: command.decisionRequestId.trim() }));
        if (!row) return { kind: "rejected", diagnostics: [{ code: "canonical_readiness_response_invalid" }] };
        if (row.result_code === "canonical_snapshot_v2_ready") {
          const snapshot = snapshotFromRow(row);
          return snapshot ? { kind: "ready", snapshot, diagnostics: [] } : { kind: "rejected", diagnostics: [{ code: "canonical_readiness_response_invalid" }] };
        }
        if (SNAPSHOT_REJECTIONS.has(row.result_code as CanonicalApprovalReadinessReasonCode)) return { kind: "rejected", diagnostics: [{ code: row.result_code as CanonicalApprovalReadinessReasonCode }] };
        return { kind: "rejected", diagnostics: [{ code: "canonical_readiness_result_unknown" }] };
      } catch {
        return { kind: "rejected", diagnostics: [{ code: "canonical_readiness_transport_failed" }] };
      }
    },
  };
}
