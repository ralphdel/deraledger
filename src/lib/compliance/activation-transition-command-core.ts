/**
 * Pure command contracts for the future activation transition. These commands
 * prepare reviewed intents only; they do not write a database, call a
 * provider, initialize checkout, or change any merchant capability.
 */

export type ActivationPlanCode = "starter" | "solo_lite" | "solo_plus" | "business";
export type VerifiedActivationComplianceStatus =
  | "lite_verified"
  | "enhanced_verified"
  | "business_verified";
export type ActivationRiskRating = "low" | "medium";
export type ActivationLimitLifecycle =
  | "active"
  | "exhausted"
  | "expired"
  | "suspended"
  | "revoked";

export interface TrustedActivationIdentity {
  merchantId: string;
  workspaceId: string;
  authority: "trusted_server";
}

export interface TrustedActivePaidEntitlement {
  entitlementId: string;
  planCode: ActivationPlanCode;
  state: "active_paid";
  authority: "trusted_commercial_entitlement";
}

export interface TrustedVerifiedComplianceProfile {
  profileId: string;
  planCode: ActivationPlanCode;
  complianceStatus: VerifiedActivationComplianceStatus;
  rowVersion: number;
  authority: "trusted_compliance_profile";
}

export interface TrustedActivationRiskApproval {
  decisionId: string;
  rating: ActivationRiskRating;
  authority: "trusted_risk_review";
}

export interface TrustedActivationLimitWindow {
  windowId: string;
  lifecycle: ActivationLimitLifecycle;
  approved: boolean;
  expectedRowVersion: number;
  authority: "trusted_limit_window";
}

export interface TrustedActivationReadinessReference {
  referenceId: string;
  approved: true;
  authority:
    | "trusted_payout_readiness"
    | "trusted_provider_mapping"
    | "trusted_global_feature_flag"
    | "trusted_merchant_entitlement"
    | "trusted_setup_live_approval";
}

export interface TrustedActivationOperator {
  operatorId: string;
  authorization: "internal_activation_operator" | "compliance_operator";
  authorized: true;
}

export interface ActivationExpectedRowVersions {
  merchant: number;
  workspace: number;
  profile: number;
  limitWindows: readonly number[];
}

export type ActivationReasonCode =
  | "commercial_entitlement_lost"
  | "compliance_no_longer_verified"
  | "risk_review_required"
  | "limit_unavailable"
  | "payout_readiness_lost"
  | "provider_mapping_lost"
  | "global_collection_disabled"
  | "merchant_entitlement_revoked"
  | "operational_state_conflict"
  | "emergency_risk_suspension"
  | "emergency_compliance_suspension";

interface ActivationCommandBase {
  identity: TrustedActivationIdentity | null;
  operator: TrustedActivationOperator | null;
  policyVersion: string;
  idempotencyKey: string;
  expectedRowVersions: ActivationExpectedRowVersions | null;
}

export interface PrepareActivationCommandRequest extends ActivationCommandBase {
  entitlement: TrustedActivePaidEntitlement | null;
  complianceProfile: TrustedVerifiedComplianceProfile | null;
  riskApproval: TrustedActivationRiskApproval | null;
  limitWindows: readonly TrustedActivationLimitWindow[] | null;
  payoutReadiness: TrustedActivationReadinessReference | null;
  providerMappingReadiness: TrustedActivationReadinessReference | null;
  globalCollectionFlag: TrustedActivationReadinessReference | null;
  merchantCollectionEntitlement: TrustedActivationReadinessReference | null;
  setupLiveReadinessApproval: TrustedActivationReadinessReference | null;
  restrictionState: "active" | "restricted" | "suspended" | null;
}

export interface PrepareRelockCommandRequest extends ActivationCommandBase {
  reasonCode: ActivationReasonCode;
  sourceReferenceId: string;
}

export interface PrepareEmergencySuspensionCommandRequest extends ActivationCommandBase {
  reasonCode:
    | "emergency_risk_suspension"
    | "emergency_compliance_suspension";
  sourceReferenceId: string;
}

export interface ActivationAuditEventContract {
  eventType: "activation_prepared" | "merchant_relocked" | "merchant_suspended";
  reasonCode: ActivationReasonCode | null;
  actorId: string;
  policyVersion: string;
  idempotencyKey: string;
}

export interface PreparedActivationTarget {
  setupMode: false;
  liveFeaturesEnabled: true;
  /** Product target; Migration 024 does not currently allow this literal. */
  activationStatus: "active";
  merchantEntitlements: { canCollectPayments: true };
  schemaCompatibility: {
    currentMigration024SupportsActivationStatusActive: false;
    persistenceBlockedPendingSchemaDecision: true;
  };
}

export interface PreparedNonOperationalTarget {
  setupMode: true;
  liveFeaturesEnabled: false;
  activationStatus: "restricted" | "suspended";
  restrictionState: "restricted" | "suspended";
  merchantEntitlements: { canCollectPayments: false };
}

export type ActivationTransitionCommandReasonCode =
  | "activation_identity_missing"
  | "activation_authority_untrusted"
  | "activation_operator_unauthorized"
  | "activation_idempotency_key_missing"
  | "activation_policy_version_missing"
  | "activation_row_versions_missing"
  | "activation_paid_entitlement_missing"
  | "activation_paid_entitlement_unsafe"
  | "activation_starter_plan"
  | "activation_compliance_missing"
  | "activation_compliance_mismatch"
  | "activation_risk_missing"
  | "activation_risk_unsafe"
  | "activation_restriction_not_active"
  | "activation_limit_windows_missing"
  | "activation_limit_window_blocking"
  | "activation_payout_readiness_missing"
  | "activation_provider_mapping_missing"
  | "activation_global_flag_missing"
  | "activation_merchant_entitlement_missing"
  | "activation_setup_live_approval_missing"
  | "activation_reason_code_unsafe"
  | "activation_source_reference_missing";

export type ActivationTransitionCommandResult =
  | { kind: "prepared"; family: "activation"; target: PreparedActivationTarget; audit: ActivationAuditEventContract; diagnostics: readonly [] }
  | { kind: "prepared"; family: "relock" | "emergency_suspension"; target: PreparedNonOperationalTarget; audit: ActivationAuditEventContract; diagnostics: readonly [] }
  | { kind: "rejected"; diagnostics: readonly [{ code: ActivationTransitionCommandReasonCode }] };

const VERIFIED_STATUS_BY_PLAN: Record<Exclude<ActivationPlanCode, "starter">, VerifiedActivationComplianceStatus> = {
  solo_lite: "lite_verified",
  solo_plus: "enhanced_verified",
  business: "business_verified",
};

const SAFE_REASON_CODES = new Set<ActivationReasonCode>([
  "commercial_entitlement_lost", "compliance_no_longer_verified", "risk_review_required",
  "limit_unavailable", "payout_readiness_lost", "provider_mapping_lost",
  "global_collection_disabled", "merchant_entitlement_revoked", "operational_state_conflict",
  "emergency_risk_suspension", "emergency_compliance_suspension",
]);

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
function validIdentity(value: TrustedActivationIdentity | null): value is TrustedActivationIdentity {
  return Boolean(value && value.authority === "trusted_server" && nonEmpty(value.merchantId) && nonEmpty(value.workspaceId));
}
function validOperator(value: TrustedActivationOperator | null): value is TrustedActivationOperator {
  return Boolean(value && value.authorized === true && nonEmpty(value.operatorId)
    && ["internal_activation_operator", "compliance_operator"].includes(value.authorization));
}
function validVersions(value: ActivationExpectedRowVersions | null): value is ActivationExpectedRowVersions {
  return Boolean(value && positiveInteger(value.merchant) && positiveInteger(value.workspace)
    && positiveInteger(value.profile) && value.limitWindows.length > 0 && value.limitWindows.every(positiveInteger));
}
function validReadiness(value: TrustedActivationReadinessReference | null, authority: TrustedActivationReadinessReference["authority"]): boolean {
  return Boolean(value && value.approved === true && value.authority === authority && nonEmpty(value.referenceId));
}
function baseFailure(request: ActivationCommandBase): ActivationTransitionCommandReasonCode | null {
  if (!validIdentity(request.identity)) return request.identity ? "activation_authority_untrusted" : "activation_identity_missing";
  if (!validOperator(request.operator)) return "activation_operator_unauthorized";
  if (!nonEmpty(request.idempotencyKey)) return "activation_idempotency_key_missing";
  if (!nonEmpty(request.policyVersion)) return "activation_policy_version_missing";
  if (!validVersions(request.expectedRowVersions)) return "activation_row_versions_missing";
  return null;
}
function audit(request: ActivationCommandBase, eventType: ActivationAuditEventContract["eventType"], reasonCode: ActivationReasonCode | null): ActivationAuditEventContract {
  return { eventType, reasonCode, actorId: request.operator!.operatorId.trim(), policyVersion: request.policyVersion.trim(), idempotencyKey: request.idempotencyKey.trim() };
}

/** Prepares, but never persists, the product-target activation state. */
export function prepareActivationCommand(request: PrepareActivationCommandRequest): ActivationTransitionCommandResult {
  const failure = baseFailure(request);
  if (failure) return { kind: "rejected", diagnostics: [{ code: failure }] };
  const entitlement = request.entitlement;
  if (!entitlement) return { kind: "rejected", diagnostics: [{ code: "activation_paid_entitlement_missing" }] };
  if (entitlement.authority !== "trusted_commercial_entitlement" || entitlement.state !== "active_paid" || !nonEmpty(entitlement.entitlementId)) return { kind: "rejected", diagnostics: [{ code: "activation_paid_entitlement_unsafe" }] };
  if (entitlement.planCode === "starter") return { kind: "rejected", diagnostics: [{ code: "activation_starter_plan" }] };
  const profile = request.complianceProfile;
  if (!profile) return { kind: "rejected", diagnostics: [{ code: "activation_compliance_missing" }] };
  if (profile.authority !== "trusted_compliance_profile" || !nonEmpty(profile.profileId) || !positiveInteger(profile.rowVersion)
    || profile.planCode !== entitlement.planCode || profile.complianceStatus !== VERIFIED_STATUS_BY_PLAN[entitlement.planCode]) return { kind: "rejected", diagnostics: [{ code: "activation_compliance_mismatch" }] };
  const risk = request.riskApproval;
  if (!risk) return { kind: "rejected", diagnostics: [{ code: "activation_risk_missing" }] };
  if (risk.authority !== "trusted_risk_review" || !nonEmpty(risk.decisionId) || !["low", "medium"].includes(risk.rating)) return { kind: "rejected", diagnostics: [{ code: "activation_risk_unsafe" }] };
  if (request.restrictionState !== "active") return { kind: "rejected", diagnostics: [{ code: "activation_restriction_not_active" }] };
  if (!request.limitWindows?.length) return { kind: "rejected", diagnostics: [{ code: "activation_limit_windows_missing" }] };
  if (request.limitWindows.some((window) => window.authority !== "trusted_limit_window" || !nonEmpty(window.windowId) || !positiveInteger(window.expectedRowVersion) || window.lifecycle !== "active" || window.approved !== true)) return { kind: "rejected", diagnostics: [{ code: "activation_limit_window_blocking" }] };
  if (!validReadiness(request.payoutReadiness, "trusted_payout_readiness")) return { kind: "rejected", diagnostics: [{ code: "activation_payout_readiness_missing" }] };
  if (!validReadiness(request.providerMappingReadiness, "trusted_provider_mapping")) return { kind: "rejected", diagnostics: [{ code: "activation_provider_mapping_missing" }] };
  if (!validReadiness(request.globalCollectionFlag, "trusted_global_feature_flag")) return { kind: "rejected", diagnostics: [{ code: "activation_global_flag_missing" }] };
  if (!validReadiness(request.merchantCollectionEntitlement, "trusted_merchant_entitlement")) return { kind: "rejected", diagnostics: [{ code: "activation_merchant_entitlement_missing" }] };
  if (!validReadiness(request.setupLiveReadinessApproval, "trusted_setup_live_approval")) return { kind: "rejected", diagnostics: [{ code: "activation_setup_live_approval_missing" }] };
  return { kind: "prepared", family: "activation", target: { setupMode: false, liveFeaturesEnabled: true, activationStatus: "active", merchantEntitlements: { canCollectPayments: true }, schemaCompatibility: { currentMigration024SupportsActivationStatusActive: false, persistenceBlockedPendingSchemaDecision: true } }, audit: audit(request, "activation_prepared", null), diagnostics: [] };
}

function prepareNonOperationalCommand(request: PrepareRelockCommandRequest | PrepareEmergencySuspensionCommandRequest, family: "relock" | "emergency_suspension"): ActivationTransitionCommandResult {
  const failure = baseFailure(request);
  if (failure) return { kind: "rejected", diagnostics: [{ code: failure }] };
  if (!SAFE_REASON_CODES.has(request.reasonCode)) return { kind: "rejected", diagnostics: [{ code: "activation_reason_code_unsafe" }] };
  if (!nonEmpty(request.sourceReferenceId)) return { kind: "rejected", diagnostics: [{ code: "activation_source_reference_missing" }] };
  const suspended = family === "emergency_suspension";
  return { kind: "prepared", family, target: { setupMode: true, liveFeaturesEnabled: false, activationStatus: suspended ? "suspended" : "restricted", restrictionState: suspended ? "suspended" : "restricted", merchantEntitlements: { canCollectPayments: false } }, audit: audit(request, suspended ? "merchant_suspended" : "merchant_relocked", request.reasonCode), diagnostics: [] };
}

export function prepareRelockCommand(request: PrepareRelockCommandRequest): ActivationTransitionCommandResult {
  return prepareNonOperationalCommand(request, "relock");
}
export function prepareEmergencySuspensionCommand(request: PrepareEmergencySuspensionCommandRequest): ActivationTransitionCommandResult {
  return prepareNonOperationalCommand(request, "emergency_suspension");
}
