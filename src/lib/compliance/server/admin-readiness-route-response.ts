import "server-only";

export type AdminReadinessRouteEnvelope = Readonly<{
  status: 200 | 201 | 400 | 401 | 403 | 404 | 409 | 429 | 500;
  body: Readonly<{
    kind: "issued" | "created" | "replay" | "ready" | "denied" | "missing" | "conflict" | "throttled" | "unavailable";
    code: string;
    csrfToken?: string;
    expiresAt?: string;
  }>;
}>;
export type AdminReadinessPublicCode =
  | "invalid_command" | "csrf_denied" | "csrf_unavailable" | "rate_limited" | "throttle_unavailable"
  | "canonical_readiness_authority_denied" | "canonical_readiness_payload_invalid" | "canonical_readiness_transport_failed" | "canonical_readiness_response_invalid" | "canonical_readiness_result_unknown"
  | "canonical_request_v2_payload_invalid" | "canonical_request_v2_reviewer_invalid" | "canonical_request_v2_profile_missing" | "canonical_request_v2_profile_state_invalid" | "canonical_request_v2_workspace_linkage_unavailable" | "canonical_request_v2_workspace_linkage_conflict" | "canonical_request_v2_policy_invalid" | "canonical_request_v2_source_invalid" | "canonical_request_v2_idempotency_conflict" | "canonical_request_v2_failed"
  | "canonical_snapshot_v2_payload_invalid" | "canonical_snapshot_v2_request_missing" | "canonical_snapshot_v2_profile_missing" | "canonical_snapshot_v2_stale_or_conflicting" | "canonical_snapshot_v2_workspace_linkage_unavailable" | "canonical_snapshot_v2_workspace_linkage_conflict" | "canonical_snapshot_v2_policy_invalid" | "canonical_snapshot_v2_source_invalid" | "canonical_snapshot_v2_failed";
export type AdminReadinessRouteOutcome =
  | { kind: "created" } | { kind: "replay" } | { kind: "ready" }
  | { kind: "rejected"; diagnostics: readonly [{ code: AdminReadinessPublicCode }] }
  | { kind: "validation_denied" | "csrf_denied" | "session_denied" | "authority_denied" | "missing" | "conflict" | "throttled" | "unavailable"; code?: AdminReadinessPublicCode };

const publicCodes = new Set<AdminReadinessPublicCode>([
  "invalid_command", "csrf_denied", "csrf_unavailable", "rate_limited", "throttle_unavailable",
  "canonical_readiness_authority_denied", "canonical_readiness_payload_invalid", "canonical_readiness_transport_failed", "canonical_readiness_response_invalid", "canonical_readiness_result_unknown",
  "canonical_request_v2_payload_invalid", "canonical_request_v2_reviewer_invalid", "canonical_request_v2_profile_missing", "canonical_request_v2_profile_state_invalid", "canonical_request_v2_workspace_linkage_unavailable", "canonical_request_v2_workspace_linkage_conflict", "canonical_request_v2_policy_invalid", "canonical_request_v2_source_invalid", "canonical_request_v2_idempotency_conflict", "canonical_request_v2_failed",
  "canonical_snapshot_v2_payload_invalid", "canonical_snapshot_v2_request_missing", "canonical_snapshot_v2_profile_missing", "canonical_snapshot_v2_stale_or_conflicting", "canonical_snapshot_v2_workspace_linkage_unavailable", "canonical_snapshot_v2_workspace_linkage_conflict", "canonical_snapshot_v2_policy_invalid", "canonical_snapshot_v2_source_invalid", "canonical_snapshot_v2_failed",
]);
function opaque(): AdminReadinessRouteEnvelope { return { status: 500, body: { kind: "unavailable", code: "internal_unavailable" } }; }
function knownCode(value: unknown): AdminReadinessPublicCode | null { return typeof value === "string" && publicCodes.has(value as AdminReadinessPublicCode) ? value as AdminReadinessPublicCode : null; }
function keys(value: object, expected: readonly string[]): boolean { return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key)); }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const csrfToken = /^[A-Za-z0-9_-]{43,128}$/;
const plans = new Set(["solo_lite", "solo_plus", "business"]);
const sources = new Set(["solo_lite_review", "solo_plus_case", "business_kyb_review"]);
const currentStatuses = new Set(["lite_pending", "enhanced_pending", "business_pending", "needs_attention"]);
const targets = new Set(["lite_verified", "enhanced_verified", "business_verified", "needs_attention", "restricted", "rejected"]);
const reasons = new Set(["evidence_incomplete", "evidence_expired", "evidence_mismatch", "review_rejected", "reviewer_requested_correction", "policy_restriction", "risk_restricted", "risk_suspended"]);
function validUuid(value: unknown): value is string { return typeof value === "string" && uuid.test(value); }
function validIssueSuccess(value: { decisionRequestId?: unknown }): boolean { return validUuid(value.decisionRequestId); }
function positiveInteger(value: unknown): boolean { return typeof value === "number" && Number.isInteger(value) && value > 0; }
function validSnapshotSuccess(value: { snapshot?: unknown }): boolean {
  if (!value.snapshot || typeof value.snapshot !== "object" || Array.isArray(value.snapshot)) return false;
  const snapshot = value.snapshot as Record<string, unknown>;
  if (!keys(snapshot, ["decisionRequestId", "profileId", "planCode", "currentComplianceStatus", "sourceType", "sourceVersion", "expectedProfileRowVersion", "policyVersion", "reasonCode", "targetComplianceStatus"])) return false;
  return validUuid(snapshot.decisionRequestId) && validUuid(snapshot.profileId)
    && typeof snapshot.planCode === "string" && plans.has(snapshot.planCode)
    && typeof snapshot.currentComplianceStatus === "string" && currentStatuses.has(snapshot.currentComplianceStatus)
    && typeof snapshot.sourceType === "string" && sources.has(snapshot.sourceType)
    && positiveInteger(snapshot.sourceVersion) && positiveInteger(snapshot.expectedProfileRowVersion)
    && typeof snapshot.policyVersion === "string" && Boolean(snapshot.policyVersion.trim()) && snapshot.policyVersion.trim().length <= 128
    && (snapshot.reasonCode === null || typeof snapshot.reasonCode === "string" && reasons.has(snapshot.reasonCode))
    && typeof snapshot.targetComplianceStatus === "string" && targets.has(snapshot.targetComplianceStatus)
    && (snapshot.planCode !== "solo_lite" || snapshot.sourceType === "solo_lite_review" && (snapshot.currentComplianceStatus === "lite_pending" || snapshot.currentComplianceStatus === "needs_attention") && (snapshot.targetComplianceStatus === "lite_verified" || snapshot.targetComplianceStatus === "needs_attention" || snapshot.targetComplianceStatus === "restricted" || snapshot.targetComplianceStatus === "rejected"))
    && (snapshot.planCode !== "solo_plus" || snapshot.sourceType === "solo_plus_case" && (snapshot.currentComplianceStatus === "enhanced_pending" || snapshot.currentComplianceStatus === "needs_attention") && (snapshot.targetComplianceStatus === "enhanced_verified" || snapshot.targetComplianceStatus === "needs_attention" || snapshot.targetComplianceStatus === "restricted" || snapshot.targetComplianceStatus === "rejected"))
    && (snapshot.planCode !== "business" || snapshot.sourceType === "business_kyb_review" && (snapshot.currentComplianceStatus === "business_pending" || snapshot.currentComplianceStatus === "needs_attention") && (snapshot.targetComplianceStatus === "business_verified" || snapshot.targetComplianceStatus === "needs_attention" || snapshot.targetComplianceStatus === "restricted" || snapshot.targetComplianceStatus === "rejected"));
}
function rejectionCode(value: unknown): AdminReadinessPublicCode | null {
  if (!Array.isArray(value) || value.length !== 1 || !value[0] || typeof value[0] !== "object" || Object.keys(value[0]).length !== 1) return null;
  return knownCode((value[0] as { code?: unknown }).code);
}
function rejectionEnvelope(code: AdminReadinessPublicCode): AdminReadinessRouteEnvelope {
  if (code === "canonical_request_v2_idempotency_conflict" || code.endsWith("workspace_linkage_conflict")) return { status: 409, body: { kind: "conflict", code } };
  if (code === "canonical_snapshot_v2_request_missing") return { status: 404, body: { kind: "missing", code } };
  return { status: 500, body: { kind: "unavailable", code } };
}
export function mapAdminReadinessRouteOutcome(outcome: unknown): AdminReadinessRouteEnvelope {
  if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)) return opaque();
  const value = outcome as { kind?: unknown; code?: unknown; diagnostics?: unknown; decisionRequestId?: unknown; decisionIdempotencyKey?: unknown; snapshot?: unknown };
  if (value.kind === "issued" && keys(value, ["kind", "token", "expiresAt"])
    && typeof (value as { token?: unknown }).token === "string" && csrfToken.test((value as { token: string }).token)
    && typeof (value as { expiresAt?: unknown }).expiresAt === "string"
    && Number.isFinite(Date.parse((value as { expiresAt: string }).expiresAt))) {
    return {
      status: 201,
      body: {
        kind: "issued",
        code: "csrf_issued",
        csrfToken: (value as { token: string }).token,
        expiresAt: (value as { expiresAt: string }).expiresAt,
      },
    };
  }
  if (value.kind === "deny" && value.code === "origin_denied") return { status: 400, body: { kind: "denied", code: "origin_denied" } };
  if (value.kind === "deny" && value.code === "authority_denied") return { status: 403, body: { kind: "denied", code: "authority_denied" } };
  if (value.kind === "deny" && value.code === "rate_limited") return { status: 429, body: { kind: "throttled", code: "rate_limited" } };
  if (value.kind === "created" && validIssueSuccess(value)) return { status: 201, body: { kind: "created", code: "created" } };
  if (value.kind === "replay" && validIssueSuccess(value)) return { status: 200, body: { kind: "replay", code: "replay" } };
  if (value.kind === "ready" && keys(value, ["kind", "snapshot", "diagnostics"]) && Array.isArray(value.diagnostics) && value.diagnostics.length === 0 && validSnapshotSuccess(value)) return { status: 200, body: { kind: "ready", code: "ready" } };
  if (value.kind === "validation_denied") {
    if (value.code !== undefined && value.code !== "invalid_command") return opaque();
    return { status: 400, body: { kind: "denied", code: "invalid_command" } };
  }
  if (value.kind === "csrf_denied") {
    if (value.code !== undefined && value.code !== "csrf_denied") return opaque();
    return { status: 400, body: { kind: "denied", code: "csrf_denied" } };
  }
  if (value.kind === "session_denied") return { status: 401, body: { kind: "denied", code: "session_denied" } };
  if (value.kind === "authority_denied") return { status: 403, body: { kind: "denied", code: "authority_denied" } };
  if (value.kind === "missing") return { status: 404, body: { kind: "missing", code: "not_found" } };
  if (value.kind === "conflict") return { status: 409, body: { kind: "conflict", code: "conflict" } };
  if (value.kind === "throttled") return { status: 429, body: { kind: "throttled", code: "rate_limited" } };
  if (value.kind === "unavailable") return opaque();
  if (value.kind === "rejected") { const code = rejectionCode(value.diagnostics); return code ? rejectionEnvelope(code) : opaque(); }
  return opaque();
}
