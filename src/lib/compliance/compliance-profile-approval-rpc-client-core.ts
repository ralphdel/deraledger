import type { ComplianceProfileApprovalPayload } from "./compliance-profile-approval-command-core";
import type { ComplianceApprovalServiceRoleContext } from "./compliance-profile-approval-persistence-core";

/**
 * Source-only transport contract for the already-installed Migration 027
 * approval RPC. Construction is inert: a separately approved server boundary
 * must supply the service-role transport and no route imports this module.
 */
export const REVIEW_COMPLIANCE_PROFILE_DECISION_RPC = "review_compliance_profile_decision_v1" as const;

export interface ReviewedProfileApprovalRpcArguments {
  p_merchant_id: string;
  p_profile_id: string;
  p_plan_code: "solo_lite" | "solo_plus" | "business";
  p_source_type: "solo_lite_review" | "solo_plus_case" | "business_kyb_review";
  p_source_id: string;
  p_source_version: number;
  p_target_compliance_status: string;
  p_expected_profile_row_version: number;
  p_reviewer_id: string;
  p_decision_idempotency_key: string;
  p_policy_version: string;
  p_reviewed_at: string;
  p_reason_code: string | null;
}

export interface ReviewedProfileApprovalRpcRow {
  result_code: string;
  profile_id: string | null;
  event_id: string | null;
  resulting_row_version: number | null;
}

export interface ReviewedProfileApprovalRpcTransport {
  callApprovalDecisionRpc(
    functionName: typeof REVIEW_COMPLIANCE_PROFILE_DECISION_RPC,
    arguments_: ReviewedProfileApprovalRpcArguments,
  ): Promise<readonly ReviewedProfileApprovalRpcRow[]>;
}

export type ComplianceProfileApprovalRpcClientReasonCode =
  | "approval_rpc_context_denied"
  | "approval_rpc_transport_missing"
  | "approval_rpc_response_invalid"
  | "approval_rpc_result_unknown"
  | "approval_rpc_rejected";

export type ComplianceProfileApprovalRpcClientResult =
  | { kind: "created"; profileId: string; eventId: string; resultingRowVersion: number; diagnostics: readonly [] }
  | { kind: "replay"; profileId: string; eventId: string; resultingRowVersion: number; diagnostics: readonly [{ code: "approval_idempotent_replay" }] }
  | { kind: "preserved"; profileId: string; resultingRowVersion: number; diagnostics: readonly [{ code: "approval_profile_preserved" }] }
  | { kind: "rejected"; diagnostics: readonly [{ code: ComplianceProfileApprovalRpcClientReasonCode }] };

function isTrustedServiceRoleContext(context: ComplianceApprovalServiceRoleContext | null): boolean {
  return context?.databaseRole === "service_role" && context.internalReviewAuthorized === true;
}

function nonEmpty(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function validPositiveInteger(value: number | null): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Maps a pure validated command directly to Migration 027's exact 13 inputs. */
export function toReviewedProfileApprovalRpcArguments(
  command: ComplianceProfileApprovalPayload,
  profileId: string,
): ReviewedProfileApprovalRpcArguments {
  return {
    p_merchant_id: command.merchantId,
    p_profile_id: profileId,
    p_plan_code: command.planCode,
    p_source_type: command.reviewSourceType,
    p_source_id: command.reviewSourceId,
    p_source_version: command.evidenceVersion,
    p_target_compliance_status: command.complianceStatus,
    p_expected_profile_row_version: command.expectedProfileRowVersion,
    p_reviewer_id: command.reviewedBy,
    p_decision_idempotency_key: command.approvalDecisionKey,
    p_policy_version: command.policyVersion,
    p_reviewed_at: command.reviewedAt,
    p_reason_code: command.reasonCode,
  };
}

function mapResponse(rows: readonly ReviewedProfileApprovalRpcRow[]): ComplianceProfileApprovalRpcClientResult {
  if (rows.length !== 1) return { kind: "rejected", diagnostics: [{ code: "approval_rpc_response_invalid" }] };
  const row = rows[0];
  const profileId = nonEmpty(row.profile_id);
  const eventId = nonEmpty(row.event_id);
  const resultingRowVersion = row.resulting_row_version;

  if (row.result_code === "approval_applied" && profileId && eventId && validPositiveInteger(resultingRowVersion)) {
    return { kind: "created", profileId, eventId, resultingRowVersion, diagnostics: [] };
  }
  if (row.result_code === "approval_idempotent_replay" && profileId && eventId && validPositiveInteger(resultingRowVersion)) {
    return { kind: "replay", profileId, eventId, resultingRowVersion, diagnostics: [{ code: "approval_idempotent_replay" }] };
  }
  if (row.result_code === "approval_profile_preserved" && profileId && validPositiveInteger(resultingRowVersion)) {
    return { kind: "preserved", profileId, resultingRowVersion, diagnostics: [{ code: "approval_profile_preserved" }] };
  }
  if (typeof row.result_code === "string" && row.result_code.startsWith("approval_")) {
    return { kind: "rejected", diagnostics: [{ code: "approval_rpc_rejected" }] };
  }
  return { kind: "rejected", diagnostics: [{ code: "approval_rpc_result_unknown" }] };
}

/**
 * This is intentionally not adopted by runtime code. It checks the same
 * service-role/internal-review boundary as the existing approval layers and
 * delegates exactly one RPC call to its injected transport.
 */
export async function executeReviewedProfileApprovalRpc(
  command: ComplianceProfileApprovalPayload | null,
  profileId: string | null,
  context: ComplianceApprovalServiceRoleContext | null,
  transport: ReviewedProfileApprovalRpcTransport | null,
): Promise<ComplianceProfileApprovalRpcClientResult> {
  if (!isTrustedServiceRoleContext(context)) {
    return { kind: "rejected", diagnostics: [{ code: "approval_rpc_context_denied" }] };
  }
  if (!transport) {
    return { kind: "rejected", diagnostics: [{ code: "approval_rpc_transport_missing" }] };
  }
  const resolvedProfileId = nonEmpty(profileId);
  if (!command || !resolvedProfileId) {
    return { kind: "rejected", diagnostics: [{ code: "approval_rpc_response_invalid" }] };
  }
  try {
    return mapResponse(await transport.callApprovalDecisionRpc(
      REVIEW_COMPLIANCE_PROFILE_DECISION_RPC,
      toReviewedProfileApprovalRpcArguments(command, resolvedProfileId),
    ));
  } catch {
    return { kind: "rejected", diagnostics: [{ code: "approval_rpc_rejected" }] };
  }
}
