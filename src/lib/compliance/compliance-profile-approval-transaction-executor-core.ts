import {
  prepareComplianceProfileApprovalCommand,
  type ComplianceProfileApprovalReasonCode,
  type ComplianceProfileApprovalCommandRequest,
  type ComplianceProfileApprovalPayload,
} from "./compliance-profile-approval-command-core";
import type {
  ComplianceProfileApprovalRpcAdapter,
  ComplianceProfileApprovalRpcClientReasonCode,
} from "./compliance-profile-approval-rpc-client-core";
import {
  prepareComplianceProfileApprovalPersistence,
  type ComplianceApprovalServiceRoleContext,
  type ComplianceProfileApprovalAtomicWriter,
  type ComplianceProfileApprovalPersistenceReasonCode,
  type ComplianceProfileApprovalPersistenceResult,
} from "./compliance-profile-approval-persistence-core";

/**
 * Pure orchestration around an injected transaction transport. It creates no
 * client and performs no import-time work; a future service-role transport is
 * responsible for providing real atomicity.
 */

export interface ComplianceProfileApprovalTransactionRunner {
  runServiceRoleTransaction<T>(
    operation: (writer: ComplianceProfileApprovalAtomicWriter) => Promise<T>,
  ): Promise<T>;
}

export type ComplianceProfileApprovalTransactionExecutorReasonCode =
  | "approval_transaction_context_denied"
  | "approval_transaction_runner_missing"
  | "approval_transaction_atomic_write_failed"
  | "approval_rpc_adapter_missing";

export type ComplianceProfileApprovalTransactionExecutorResult =
  | {
      kind: "rejected";
      diagnostics: readonly [{ code: ComplianceProfileApprovalReasonCode | ComplianceProfileApprovalPersistenceReasonCode | ComplianceProfileApprovalTransactionExecutorReasonCode | ComplianceProfileApprovalRpcClientReasonCode }];
    }
  | {
      kind: "created";
      profileId: string;
      reviewId: string | null;
      soloPlusCaseId: string | null;
      eventId: string;
      diagnostics: readonly [];
    }
  | Extract<ComplianceProfileApprovalPersistenceResult, { kind: "replay" | "preserved" }>;

function isServiceRoleContext(context: ComplianceApprovalServiceRoleContext | null): boolean {
  return context?.databaseRole === "service_role" && context.internalReviewAuthorized === true;
}

function reviewStatus(command: ComplianceProfileApprovalPayload): "approved" | "rejected" | "needs_attention" {
  if (command.complianceStatus === "rejected") return "rejected";
  if (command.complianceStatus === "needs_attention" || command.complianceStatus === "restricted") {
    return "needs_attention";
  }
  return "approved";
}

function safeState(command: ComplianceProfileApprovalPayload): Record<string, unknown> {
  return {
    compliance_status: command.complianceStatus,
    activation_status: command.activationStatus,
    restriction_state: command.restrictionState,
    merchant_entitlements: command.merchantEntitlements,
  };
}

function resolvedProfileId(profileId: string | null): string | null {
  const normalized = profileId?.trim() ?? "";
  return normalized || null;
}

/**
 * Source-only bridge from the existing command validator to an injected RPC
 * adapter. It is not a runtime call site and never constructs a DB client.
 */
export async function executeComplianceProfileApprovalRpcTransaction(
  request: ComplianceProfileApprovalCommandRequest,
  profileId: string | null,
  context: ComplianceApprovalServiceRoleContext | null,
  adapter: ComplianceProfileApprovalRpcAdapter | null,
): Promise<ComplianceProfileApprovalTransactionExecutorResult> {
  const command = prepareComplianceProfileApprovalCommand(request);
  if (command.kind === "rejected") return command;
  const resolved = resolvedProfileId(profileId);
  if (!resolved) {
    return { kind: "rejected", diagnostics: [{ code: "approval_persistence_command_missing" }] };
  }
  if (command.kind === "existing") {
    return { kind: "preserved", profileId: resolved, diagnostics: [{ code: "approval_profile_preserved" }] };
  }
  if (!adapter) {
    return { kind: "rejected", diagnostics: [{ code: "approval_rpc_adapter_missing" }] };
  }

  try {
    const result = await adapter.execute(command.payload, resolved, context);
    if (result.kind === "created") {
      return {
        kind: "created", profileId: result.profileId, reviewId: null,
        soloPlusCaseId: null, eventId: result.eventId, diagnostics: [],
      };
    }
    if (result.kind === "replay") {
      return { kind: "replay", profileId: result.profileId, eventId: result.eventId, diagnostics: result.diagnostics };
    }
    if (result.kind === "preserved") {
      return { kind: "preserved", profileId: result.profileId, diagnostics: result.diagnostics };
    }
    return result;
  } catch {
    return { kind: "rejected", diagnostics: [{ code: "approval_rpc_rejected" }] };
  }
}

/**
 * Executes exactly one injected atomic approval operation. A future call site
 * remains separately prohibited; this function is exercised only with mocks.
 */
export async function executeComplianceProfileApprovalTransaction(
  command: ComplianceProfileApprovalPayload | null,
  context: ComplianceApprovalServiceRoleContext | null,
  runner: ComplianceProfileApprovalTransactionRunner | null,
): Promise<ComplianceProfileApprovalTransactionExecutorResult> {
  if (!isServiceRoleContext(context)) {
    return { kind: "rejected", diagnostics: [{ code: "approval_transaction_context_denied" }] };
  }
  if (!runner) {
    return { kind: "rejected", diagnostics: [{ code: "approval_transaction_runner_missing" }] };
  }
  if (!command) {
    return { kind: "rejected", diagnostics: [{ code: "approval_persistence_command_missing" }] };
  }

  try {
    return await runner.runServiceRoleTransaction(async (writer) => {
      const profiles = await writer.findProfiles(command.merchantId);

      const profileId = profiles.length === 1 ? profiles[0].id : "pending-profile-resolution";
      const [reviews, soloPlusCases, events] = await Promise.all([
        writer.findReviewsByApprovalSource({
          merchantId: command.merchantId,
          profileId,
          sourceId: command.reviewSourceId,
        }),
        writer.findSoloPlusCasesByApprovalSource({
          merchantId: command.merchantId,
          profileId,
          sourceId: command.reviewSourceId,
        }),
        writer.findEventsByApprovalDecisionKey({
          merchantId: command.merchantId,
          approvalDecisionKey: command.approvalDecisionKey,
        }),
      ]);
      const persistence = prepareComplianceProfileApprovalPersistence(command, context, {
        profiles,
        reviews: reviews.filter((review) => review.profileId === profileId),
        soloPlusCases: soloPlusCases.filter((caseRow) => caseRow.profileId === profileId),
        events,
      });
      if (persistence.kind !== "ready") return persistence;

      const profile = await writer.updateProfileDecision({
        id: persistence.profileId,
        merchant_id: command.merchantId,
        compliance_status: command.complianceStatus,
        activation_status: command.activationStatus,
        restriction_state: command.restrictionState,
        decision_source_type: command.reviewSourceType,
        decision_source_id: command.reviewSourceId,
        decision_source_version: command.evidenceVersion,
        last_reviewed_at: command.reviewedAt,
        reviewed_by: command.reviewedBy,
        policy_version: command.policyVersion,
        expected_row_version: command.expectedProfileRowVersion,
        row_version: persistence.nextRowVersion,
        can_collect_payments: false,
        can_use_instant_sale: false,
        can_use_receivable_sale: false,
        can_use_storefront: false,
        can_activate_settlement: false,
        can_use_deposit_balance: false,
      });
      if (!profile?.id || profile.rowVersion !== persistence.nextRowVersion) {
        throw new Error("profile_update_failed");
      }

      let reviewId: string | null = null;
      let soloPlusCaseId: string | null = null;
      if (persistence.reviewUpdate) {
        const review = await writer.updateReviewDecision({
          id: persistence.reviewUpdate.reviewId,
          merchant_id: command.merchantId,
          profile_id: profile.id,
          review_status: reviewStatus(command),
          reviewed_at: command.reviewedAt,
          reviewed_by: command.reviewedBy,
          policy_version: command.policyVersion,
          decision_reason_code: command.reasonCode,
        });
        if (!review?.id) throw new Error("review_update_failed");
        reviewId = review.id;
      }
      if (persistence.soloPlusCaseBinding) {
        const caseBinding = await writer.bindSoloPlusCaseDecision({
          id: persistence.soloPlusCaseBinding.caseId,
          merchant_id: command.merchantId,
          profile_id: profile.id,
          reviewed_at: command.reviewedAt,
          reviewed_by: command.reviewedBy,
          policy_version: command.policyVersion,
          decision_reason_code: command.reasonCode,
        });
        if (!caseBinding?.id) throw new Error("case_binding_failed");
        soloPlusCaseId = caseBinding.id;
      }

      const event = await writer.appendApprovalEvent({
        merchant_id: command.merchantId,
        profile_id: profile.id,
        event_type: "compliance_profile_approval_v1",
        from_state: { compliance_status: command.sourceComplianceStatus },
        to_state: safeState(command),
        reason_code: command.reasonCode,
        actor_type: "admin",
        actor_id: command.reviewedBy,
        source_type: command.reviewSourceType,
        source_id: command.reviewSourceId,
        policy_version: command.policyVersion,
        idempotency_key: command.approvalDecisionKey,
        expected_row_version: command.expectedProfileRowVersion,
        resulting_row_version: persistence.nextRowVersion,
        metadata: { source: "compliance_profile_approval" },
      });
      if (!event?.id) throw new Error("event_append_failed");
      return {
        kind: "created",
        profileId: profile.id,
        reviewId,
        soloPlusCaseId,
        eventId: event.id,
        diagnostics: [],
      };
    });
  } catch {
    return { kind: "rejected", diagnostics: [{ code: "approval_transaction_atomic_write_failed" }] };
  }
}
