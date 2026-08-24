import {
  prepareActivationTransitionPersistence,
  type ActivationPersistenceCommand,
  type ActivationPersistenceServiceRoleContext,
  type ActivationTransitionAtomicWriter,
  type ActivationTransitionPersistenceReasonCode,
  type ActivationTransitionPersistenceResult,
} from "./activation-transition-persistence-core";

/** Mockable orchestration for a future activation transport; no client is created here. */
export interface ActivationTransitionTransactionRunner {
  runServiceRoleTransaction<T>(
    operation: (writer: ActivationTransitionAtomicWriter) => Promise<T>,
  ): Promise<T>;
}

export type ActivationTransitionTransactionExecutorReasonCode =
  | "activation_transaction_context_denied"
  | "activation_transaction_runner_missing"
  | "activation_transaction_atomic_write_failed";

export type ActivationTransitionTransactionExecutorResult =
  | Extract<ActivationTransitionPersistenceResult, { kind: "schema_blocked" | "replay" | "rejected" }>
  | { kind: "created"; family: "relock" | "emergency_suspension"; profileId: string; eventId: string; diagnostics: readonly [] }
  | { kind: "rejected"; diagnostics: readonly [{ code: ActivationTransitionPersistenceReasonCode | ActivationTransitionTransactionExecutorReasonCode }] };

function contextAllowed(context: ActivationPersistenceServiceRoleContext | null): boolean {
  return context?.databaseRole === "service_role" && context.internalActivationAuthorized === true;
}

function assertWrite<T extends object | null>(value: T, property: string): asserts value is Exclude<T, null> {
  if (!value || !(property in value)) throw new Error("activation_write_failed");
}

/**
 * Re-reads all prerequisite snapshots through one injected transaction runner.
 * Activation exits schema-blocked before writes; only non-operational commands
 * can reach the future writer boundary at this stage.
 */
export async function executeActivationTransitionTransaction(
  command: ActivationPersistenceCommand | null,
  context: ActivationPersistenceServiceRoleContext | null,
  runner: ActivationTransitionTransactionRunner | null,
): Promise<ActivationTransitionTransactionExecutorResult> {
  if (!contextAllowed(context)) return { kind: "rejected", diagnostics: [{ code: "activation_transaction_context_denied" }] };
  if (!runner) return { kind: "rejected", diagnostics: [{ code: "activation_transaction_runner_missing" }] };
  if (!command) return { kind: "rejected", diagnostics: [{ code: "activation_persistence_command_missing" }] };

  try {
    return await runner.runServiceRoleTransaction(async (writer) => {
      const entitlements = await writer.findEntitlements({ merchantId: command.merchantId, workspaceId: command.workspaceId });
      const profiles = await writer.findProfiles(command.merchantId);
      const profileId = profiles.length === 1 ? profiles[0].id : "unresolved-profile";
      const [risks, limitWindows, readiness, operational, events] = await Promise.all([
        writer.findRiskSnapshots(command.merchantId),
        writer.lockLimitWindows({ merchantId: command.merchantId, profileId }),
        writer.loadReadiness({ merchantId: command.merchantId, workspaceId: command.workspaceId }),
        writer.lockOperationalState({ merchantId: command.merchantId, workspaceId: command.workspaceId }),
        writer.findEvents({ merchantId: command.merchantId, idempotencyKey: command.idempotencyKey }),
      ]);
      const persistence = prepareActivationTransitionPersistence(
        command,
        context,
        { executeAtomically: async <T>(operation: (unused: ActivationTransitionAtomicWriter) => Promise<T>) => operation(writer) },
        { entitlements, profiles, risks, limitWindows, readiness, operational, events },
      );
      if (persistence.kind !== "ready") return persistence;
      // `ready` is only available for non-operational commands. Keep this
      // explicit so an activation target can never reach a write path while
      // the schema contract remains unresolved.
      if (command.target.activationStatus === "active") {
        return { kind: "schema_blocked", diagnostics: [{ code: "activation_schema_incompatible" }] };
      }
      const target = command.target;

      const profile = await writer.updateProfileActivation({
        merchant_id: command.merchantId,
        id: profileId,
        activation_status: target.activationStatus,
        restriction_state: target.restrictionState,
        can_collect_payments: false,
        expected_row_version: command.expectedRowVersions.profile,
      });
      assertWrite(profile, "id");
      const operationalWrite = await writer.updateOperationalFlags({
        merchant_id: command.merchantId,
        workspace_id: command.workspaceId,
        setup_mode: true,
        live_features_enabled: false,
        can_collect_payments: false,
        expected_merchant_row_version: command.expectedRowVersions.merchant,
        expected_workspace_row_version: command.expectedRowVersions.workspace,
      });
      assertWrite(operationalWrite, "merchantId");
      const event = await writer.appendActivationEvent({
        merchant_id: command.merchantId,
        profile_id: profile.id,
        event_type: command.audit.eventType,
        reason_code: command.audit.reasonCode,
        actor_id: command.audit.actorId,
        policy_version: command.audit.policyVersion,
        idempotency_key: command.audit.idempotencyKey,
        to_state: command.target,
      });
      assertWrite(event, "id");
      return { kind: "created", family: persistence.family, profileId: profile.id, eventId: event.id, diagnostics: [] };
    });
  } catch {
    return { kind: "rejected", diagnostics: [{ code: "activation_transaction_atomic_write_failed" }] };
  }
}
