import type {
  ActivationAuditEventContract,
  ActivationPlanCode,
  PreparedActivationTarget,
  PreparedNonOperationalTarget,
} from "./activation-transition-command-core";

/**
 * Pure persistence boundary for a future activation transaction. It creates no
 * client and runs no write. A later service-role-only transport may consume a
 * `ready` result inside an injected atomic transaction.
 */

export interface ActivationPersistenceServiceRoleContext {
  databaseRole: "service_role" | "anon" | "authenticated" | "browser" | "unknown";
  internalActivationAuthorized: boolean;
}

export interface ActivationPersistenceCommand {
  family: "activation" | "relock" | "emergency_suspension";
  merchantId: string;
  workspaceId: string;
  planCode: ActivationPlanCode | null;
  idempotencyKey: string;
  expectedRowVersions: {
    merchant: number;
    workspace: number;
    profile: number;
    limitWindows: readonly number[];
  };
  target: PreparedActivationTarget | PreparedNonOperationalTarget;
  audit: ActivationAuditEventContract;
}

export interface PersistedActivationEntitlementSnapshot {
  id: string;
  merchantId: string;
  workspaceId: string;
  planCode: ActivationPlanCode;
  state: "active_paid" | "inactive" | "expired" | "cancelled" | "conflicting";
}
export interface PersistedActivationProfileSnapshot {
  id: string;
  merchantId: string;
  planCode: ActivationPlanCode;
  complianceStatus: string | null;
  activationStatus: string | null;
  restrictionState: "active" | "restricted" | "suspended" | null;
  rowVersion: number | null;
}
export interface PersistedActivationRiskSnapshot {
  decisionId: string;
  merchantId: string;
  rating: "low" | "medium" | "high" | "restricted" | null;
  reviewed: boolean;
}
export interface PersistedActivationLimitWindowSnapshot {
  id: string;
  merchantId: string;
  profileId: string;
  lifecycle: "active" | "exhausted" | "expired" | "suspended" | "revoked";
  approved: boolean;
  rowVersion: number | null;
}
export interface PersistedActivationReadinessSnapshot {
  payoutReady: boolean | null;
  exactProviderEnvironmentMappingReady: boolean | null;
  globalCollectionFlagEnabled: boolean | null;
  merchantCollectionEntitlementApproved: boolean | null;
  setupLiveReadinessApproved: boolean | null;
}
export interface PersistedActivationOperationalSnapshot {
  merchantId: string;
  workspaceId: string;
  merchantRowVersion: number | null;
  workspaceRowVersion: number | null;
  setupMode: boolean | null;
  liveFeaturesEnabled: boolean | null;
}
export interface PersistedActivationEvent {
  id: string;
  merchantId: string;
  workspaceId: string;
  idempotencyKey: string;
  family: ActivationPersistenceCommand["family"];
  targetActivationStatus: string;
  sourceProfileId: string | null;
  resultingProfileRowVersion: number | null;
}

export interface ActivationPersistenceSnapshot {
  entitlements: readonly PersistedActivationEntitlementSnapshot[];
  profiles: readonly PersistedActivationProfileSnapshot[];
  risks: readonly PersistedActivationRiskSnapshot[];
  limitWindows: readonly PersistedActivationLimitWindowSnapshot[];
  readiness: PersistedActivationReadinessSnapshot | null;
  operational: readonly PersistedActivationOperationalSnapshot[];
  events: readonly PersistedActivationEvent[];
}

/** Only the eventual activation boundary is represented; no provider/payment/invoice API exists here. */
export interface ActivationTransitionAtomicWriter {
  findEntitlements(input: { merchantId: string; workspaceId: string }): Promise<readonly PersistedActivationEntitlementSnapshot[]>;
  findProfiles(merchantId: string): Promise<readonly PersistedActivationProfileSnapshot[]>;
  findRiskSnapshots(merchantId: string): Promise<readonly PersistedActivationRiskSnapshot[]>;
  lockLimitWindows(input: { merchantId: string; profileId: string }): Promise<readonly PersistedActivationLimitWindowSnapshot[]>;
  loadReadiness(input: { merchantId: string; workspaceId: string }): Promise<PersistedActivationReadinessSnapshot | null>;
  lockOperationalState(input: { merchantId: string; workspaceId: string }): Promise<readonly PersistedActivationOperationalSnapshot[]>;
  findEvents(input: { merchantId: string; idempotencyKey: string }): Promise<readonly PersistedActivationEvent[]>;
  updateProfileActivation(row: Record<string, unknown>): Promise<{ id: string; rowVersion: number } | null>;
  updateOperationalFlags(row: Record<string, unknown>): Promise<{ merchantId: string; workspaceId: string } | null>;
  appendActivationEvent(row: Record<string, unknown>): Promise<{ id: string } | null>;
}
export interface ActivationTransitionPersistenceDatabase {
  executeAtomically<T>(operation: (writer: ActivationTransitionAtomicWriter) => Promise<T>): Promise<T>;
}

export type ActivationTransitionPersistenceReasonCode =
  | "activation_persistence_command_missing"
  | "activation_persistence_context_denied"
  | "activation_persistence_transaction_missing"
  | "activation_persistence_command_invalid"
  | "activation_prerequisite_missing"
  | "activation_prerequisite_ambiguous"
  | "activation_prerequisite_conflicting"
  | "activation_prerequisite_stale"
  | "activation_schema_incompatible"
  | "activation_replay_inconsistent"
  | "activation_idempotent_replay";

export type ActivationTransitionPersistenceResult =
  | { kind: "schema_blocked"; diagnostics: readonly [{ code: "activation_schema_incompatible" }] }
  | { kind: "ready"; family: "relock" | "emergency_suspension"; diagnostics: readonly [] }
  | { kind: "replay"; eventId: string; diagnostics: readonly [{ code: "activation_idempotent_replay" }] }
  | { kind: "rejected"; diagnostics: readonly [{ code: Exclude<ActivationTransitionPersistenceReasonCode, "activation_schema_incompatible" | "activation_idempotent_replay"> }] };

function nonEmpty(value: unknown): boolean { return typeof value === "string" && value.trim().length > 0; }
function positive(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value > 0; }
function contextAllowed(context: ActivationPersistenceServiceRoleContext | null): boolean {
  return context?.databaseRole === "service_role" && context.internalActivationAuthorized === true;
}
function validCommand(command: ActivationPersistenceCommand): boolean {
  return nonEmpty(command.merchantId) && nonEmpty(command.workspaceId) && nonEmpty(command.idempotencyKey)
    && nonEmpty(command.audit.actorId) && nonEmpty(command.audit.policyVersion)
    && positive(command.expectedRowVersions.merchant) && positive(command.expectedRowVersions.workspace)
    && positive(command.expectedRowVersions.profile) && command.expectedRowVersions.limitWindows.length > 0
    && command.expectedRowVersions.limitWindows.every(positive);
}
function verifiedStatus(plan: ActivationPlanCode | null): string | null {
  return plan === "solo_lite" ? "lite_verified" : plan === "solo_plus" ? "enhanced_verified" : plan === "business" ? "business_verified" : null;
}
function replayMatches(event: PersistedActivationEvent, command: ActivationPersistenceCommand): boolean {
  return event.merchantId === command.merchantId && event.workspaceId === command.workspaceId
    && event.idempotencyKey === command.idempotencyKey && event.family === command.family
    && event.targetActivationStatus === command.target.activationStatus;
}
function isActivationTarget(target: ActivationPersistenceCommand["target"]): target is PreparedActivationTarget {
  return target.activationStatus === "active";
}

/**
 * Validates trusted snapshots for a future atomic write. Activation is always
 * schema-blocked until the Migration 024 activation-status allowlist is
 * separately changed and rehearsed.
 */
export function prepareActivationTransitionPersistence(
  command: ActivationPersistenceCommand | null,
  context: ActivationPersistenceServiceRoleContext | null,
  transaction: ActivationTransitionPersistenceDatabase | null,
  snapshot: ActivationPersistenceSnapshot,
): ActivationTransitionPersistenceResult {
  if (!command) return { kind: "rejected", diagnostics: [{ code: "activation_persistence_command_missing" }] };
  if (!contextAllowed(context)) return { kind: "rejected", diagnostics: [{ code: "activation_persistence_context_denied" }] };
  if (!transaction) return { kind: "rejected", diagnostics: [{ code: "activation_persistence_transaction_missing" }] };
  if (!validCommand(command)) return { kind: "rejected", diagnostics: [{ code: "activation_persistence_command_invalid" }] };
  if (snapshot.events.length > 1) return { kind: "rejected", diagnostics: [{ code: "activation_prerequisite_ambiguous" }] };
  if (snapshot.events.length === 1) return replayMatches(snapshot.events[0], command)
    ? { kind: "replay", eventId: snapshot.events[0].id, diagnostics: [{ code: "activation_idempotent_replay" }] }
    : { kind: "rejected", diagnostics: [{ code: "activation_replay_inconsistent" }] };

  if (!isActivationTarget(command.target)) {
    return { kind: "ready", family: command.family as "relock" | "emergency_suspension", diagnostics: [] };
  }
  if (command.planCode === "starter" || !command.planCode) return { kind: "rejected", diagnostics: [{ code: "activation_prerequisite_conflicting" }] };
  if (snapshot.entitlements.length === 0 || snapshot.profiles.length === 0 || snapshot.risks.length === 0 || snapshot.limitWindows.length === 0 || !snapshot.readiness || snapshot.operational.length === 0) return { kind: "rejected", diagnostics: [{ code: "activation_prerequisite_missing" }] };
  if (snapshot.entitlements.length !== 1 || snapshot.profiles.length !== 1 || snapshot.risks.length !== 1 || snapshot.operational.length !== 1) return { kind: "rejected", diagnostics: [{ code: "activation_prerequisite_ambiguous" }] };
  const entitlement = snapshot.entitlements[0]; const profile = snapshot.profiles[0]; const risk = snapshot.risks[0]; const operational = snapshot.operational[0];
  if (entitlement.merchantId !== command.merchantId || entitlement.workspaceId !== command.workspaceId || entitlement.state !== "active_paid" || entitlement.planCode !== command.planCode
    || profile.merchantId !== command.merchantId || profile.planCode !== command.planCode || profile.complianceStatus !== verifiedStatus(command.planCode) || profile.restrictionState !== "active"
    || risk.merchantId !== command.merchantId || risk.reviewed !== true || !["low", "medium"].includes(risk.rating ?? "")
    || operational.merchantId !== command.merchantId || operational.workspaceId !== command.workspaceId) return { kind: "rejected", diagnostics: [{ code: "activation_prerequisite_conflicting" }] };
  if (profile.rowVersion !== command.expectedRowVersions.profile || operational.merchantRowVersion !== command.expectedRowVersions.merchant || operational.workspaceRowVersion !== command.expectedRowVersions.workspace
    || snapshot.limitWindows.length !== command.expectedRowVersions.limitWindows.length
    || snapshot.limitWindows.some((window, index) => window.merchantId !== command.merchantId || window.profileId !== profile.id || window.lifecycle !== "active" || window.approved !== true || window.rowVersion !== command.expectedRowVersions.limitWindows[index])) return { kind: "rejected", diagnostics: [{ code: "activation_prerequisite_stale" }] };
  const readiness = snapshot.readiness;
  if (readiness.payoutReady !== true || readiness.exactProviderEnvironmentMappingReady !== true || readiness.globalCollectionFlagEnabled !== true || readiness.merchantCollectionEntitlementApproved !== true || readiness.setupLiveReadinessApproved !== true) return { kind: "rejected", diagnostics: [{ code: "activation_prerequisite_missing" }] };
  return { kind: "schema_blocked", diagnostics: [{ code: "activation_schema_incompatible" }] };
}
