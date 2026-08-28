import "server-only";

import type { CanonicalApprovalReasonCode, CanonicalApprovalTargetStatus, IssueCanonicalApprovalReadinessCommand, ReadCanonicalApprovalSnapshotCommand } from "../canonical-approval-readiness-core";

export type AdminReadinessValidationResult<T> = { ok: true; command: T } | { ok: false; code: "invalid_command" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses = new Set<CanonicalApprovalTargetStatus>(["lite_verified", "enhanced_verified", "business_verified", "needs_attention", "restricted", "rejected"]);
const reasons = new Set<CanonicalApprovalReasonCode>(["evidence_incomplete", "evidence_expired", "evidence_mismatch", "review_rejected", "reviewer_requested_correction", "policy_restriction", "risk_restricted", "risk_suspended"]);
function plain(value: unknown): value is Record<string, unknown> { return Boolean(value) && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function exact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}
function validUuid(value: unknown): value is string { return typeof value === "string" && uuid.test(value.trim()); }
function scalar(value: unknown): boolean { return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean"; }
export function validateAdminReadinessIssue(value: unknown): AdminReadinessValidationResult<IssueCanonicalApprovalReadinessCommand> {
  if (!plain(value) || !exact(value, ["profileId", "targetComplianceStatus", "policyVersion"], ["reasonCode"]) || !Object.values(value).every(scalar)) return { ok: false, code: "invalid_command" };
  const profileId = validUuid(value.profileId) ? value.profileId.trim() : null;
  const policyVersion = typeof value.policyVersion === "string" ? value.policyVersion.trim() : "";
  const reasonCode = value.reasonCode === undefined || value.reasonCode === null ? null : typeof value.reasonCode === "string" && reasons.has(value.reasonCode as CanonicalApprovalReasonCode) ? value.reasonCode as CanonicalApprovalReasonCode : undefined;
  if (!profileId || typeof value.targetComplianceStatus !== "string" || !statuses.has(value.targetComplianceStatus as CanonicalApprovalTargetStatus) || !policyVersion || policyVersion.length > 128 || reasonCode === undefined) return { ok: false, code: "invalid_command" };
  return { ok: true, command: { profileId, targetComplianceStatus: value.targetComplianceStatus as CanonicalApprovalTargetStatus, policyVersion, reasonCode } };
}
export function validateAdminReadinessSnapshot(value: unknown): AdminReadinessValidationResult<ReadCanonicalApprovalSnapshotCommand> {
  if (!plain(value) || !exact(value, ["decisionRequestId"]) || !Object.values(value).every(scalar) || !validUuid(value.decisionRequestId)) return { ok: false, code: "invalid_command" };
  return { ok: true, command: { decisionRequestId: value.decisionRequestId.trim() } };
}
