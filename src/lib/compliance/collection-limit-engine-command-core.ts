/**
 * Pure command contracts for the future collection-limit engine. They prepare
 * fail-closed intents only: no database, provider, checkout, or runtime work
 * is performed here.
 */

export const COLLECTION_LIMIT_TYPES = [
  "single_transaction",
  "daily_cumulative",
  "monthly_cumulative",
  "velocity_frequency",
  "plan_cap",
  "reviewer_risk_override",
  "cumulative",
  "outstanding_receivable",
] as const;

export const COLLECTION_LIMIT_LIFECYCLES = [
  "proposed",
  "approved",
  "active",
  "exhausted",
  "expired",
  "suspended",
  "revoked",
] as const;

export const COLLECTION_RESERVATION_LIFECYCLES = [
  "reserved",
  "committed",
  "released",
  "expired",
  "reversed",
] as const;

export const COLLECTION_USAGE_EVENT_TYPES = [
  "reservation_created",
  "collection_committed",
  "reservation_released",
  "reservation_expired",
  "refund_adjustment",
  "chargeback_adjustment",
  "manual_correction",
] as const;

export type CollectionLimitType = (typeof COLLECTION_LIMIT_TYPES)[number];
export type CollectionLimitLifecycle = (typeof COLLECTION_LIMIT_LIFECYCLES)[number];
export type CollectionReservationLifecycle = (typeof COLLECTION_RESERVATION_LIFECYCLES)[number];
export type CollectionUsageEventType = (typeof COLLECTION_USAGE_EVENT_TYPES)[number];
export type CollectionLimitPlanCode = "solo_lite" | "solo_plus" | "business";

export interface TrustedCollectionCommandIdentity {
  merchantId: string;
  workspaceId: string;
  authority: "trusted_server";
}

export interface TrustedCollectionApprovalReference {
  profileId: string;
  complianceStatus: "lite_verified" | "enhanced_verified" | "business_verified";
  entitlementId: string;
  entitlementState: "active_paid";
  planCode: CollectionLimitPlanCode;
  riskTier: "low" | "medium" | "high";
  reviewerDecisionId: string;
  payoutReadinessId: string;
  providerEnvironmentMappingId: string;
  authority: "trusted_collection_readiness";
}

export interface CollectionPolicyWindowMetadata {
  policyTimezone: "Africa/Lagos";
  windowStart: string;
  windowEnd: string | null;
}

export interface TrustedLimitWindowSnapshot {
  windowId: string;
  limitType: CollectionLimitType;
  lifecycle: CollectionLimitLifecycle;
  expectedRowVersion: number;
  policy: CollectionPolicyWindowMetadata;
}

export interface TrustedReservationSnapshot {
  reservationId: string;
  merchantId: string;
  workspaceId: string;
  internalReference: string;
  amountNgn: number;
  currency: "NGN";
  status: CollectionReservationLifecycle;
  expectedRowVersion: number;
  authority: "trusted_limit_repository";
}

export interface TrustedStoredLimitCommandSnapshot {
  commandFamily: "limit_approval" | "reservation" | "commit" | "release" | "reversal";
  merchantId: string;
  workspaceId: string;
  idempotencyKey: string;
  amountNgn: number | null;
  internalReference: string | null;
  reservationStatus: CollectionReservationLifecycle | null;
  authority: "trusted_limit_repository";
}

export interface CollectionCommandSafetyState {
  /** Commands never activate collection or set merchant entitlements. */
  activationRequested: false;
  merchantEntitlements: {
    canCollectPayments: false;
    canUseInstantSale: false;
    canUseReceivableSale: false;
    canUseStorefront: false;
    canActivateSettlement: false;
    canUseDepositBalance: false;
  };
}

interface CollectionCommandBase {
  identity: TrustedCollectionCommandIdentity | null;
  readiness: TrustedCollectionApprovalReference | null;
  policyVersion: string;
  idempotencyKey: string;
  storedCommand?: TrustedStoredLimitCommandSnapshot | null;
}

export interface PrepareLimitApprovalCommandRequest extends CollectionCommandBase {
  limitType: CollectionLimitType;
  currentLifecycle: "proposed";
  targetLifecycle: "approved";
  amountNgn: number;
  policy: CollectionPolicyWindowMetadata;
  expectedWindowRowVersion: number | null;
}

export interface PrepareReservationCommandRequest extends CollectionCommandBase {
  amountNgn: number;
  currency: "NGN";
  sourceType: "invoice" | "storefront_order" | "receivable";
  sourceId: string;
  internalReference: string;
  expiresAt: string;
  windows: readonly TrustedLimitWindowSnapshot[];
}

export interface PrepareCommitCommandRequest extends CollectionCommandBase {
  reservation: TrustedReservationSnapshot | null;
  verifiedPaymentReference: string;
  expectedReservationRowVersion: number | null;
}

export interface PrepareReleaseCommandRequest extends CollectionCommandBase {
  reservation: TrustedReservationSnapshot | null;
  expectedReservationRowVersion: number | null;
  reasonCode: CollectionLimitReasonCode;
  outcome: "released" | "expired";
}

export interface PrepareReversalCommandRequest extends CollectionCommandBase {
  reservation: TrustedReservationSnapshot | null;
  expectedReservationRowVersion: number | null;
  reasonCode: CollectionLimitReasonCode;
  reversalType: "refund_adjustment" | "chargeback_adjustment" | "manual_correction";
}

export type CollectionLimitReasonCode =
  | "provider_attempt_failed"
  | "reservation_expired"
  | "payment_refunded"
  | "payment_chargeback"
  | "reviewed_manual_correction";

export type CollectionLimitCommandReasonCode =
  | "collection_identity_missing"
  | "collection_authority_untrusted"
  | "collection_readiness_missing"
  | "collection_readiness_unsafe"
  | "collection_plan_profile_mismatch"
  | "collection_policy_version_missing"
  | "collection_idempotency_key_missing"
  | "collection_amount_invalid"
  | "collection_currency_invalid"
  | "collection_policy_window_invalid"
  | "collection_window_version_missing"
  | "collection_window_not_reservable"
  | "collection_source_invalid"
  | "collection_reservation_missing"
  | "collection_reservation_untrusted"
  | "collection_reservation_status_invalid"
  | "collection_reservation_version_missing"
  | "collection_reservation_identity_mismatch"
  | "collection_payment_reference_missing"
  | "collection_reason_code_unsafe"
  | "collection_replay_conflict";

export interface CollectionLimitCommandDiagnostic {
  code: CollectionLimitCommandReasonCode;
}

export interface CollectionLimitApprovalPayload extends CollectionCommandSafetyState {
  kind: "limit_approval";
  merchantId: string;
  workspaceId: string;
  profileId: string;
  planCode: CollectionLimitPlanCode;
  limitType: CollectionLimitType;
  lifecycle: "approved";
  amountNgn: number;
  policy: CollectionPolicyWindowMetadata;
  expectedWindowRowVersion: number;
  policyVersion: string;
  idempotencyKey: string;
}

export interface CollectionReservationPayload extends CollectionCommandSafetyState {
  kind: "reservation";
  merchantId: string;
  workspaceId: string;
  profileId: string;
  planCode: CollectionLimitPlanCode;
  amountNgn: number;
  currency: "NGN";
  sourceType: "invoice" | "storefront_order" | "receivable";
  sourceId: string;
  internalReference: string;
  expiresAt: string;
  windows: readonly TrustedLimitWindowSnapshot[];
  policyVersion: string;
  idempotencyKey: string;
}

export interface CollectionReservationTransitionPayload extends CollectionCommandSafetyState {
  kind: "commit" | "release" | "reversal";
  merchantId: string;
  workspaceId: string;
  profileId: string;
  planCode: CollectionLimitPlanCode;
  reservationId: string;
  internalReference: string;
  amountNgn: number;
  currency: "NGN";
  expectedReservationRowVersion: number;
  usageEventType: CollectionUsageEventType;
  reasonCode: CollectionLimitReasonCode | null;
  verifiedPaymentReference: string | null;
  policyVersion: string;
  idempotencyKey: string;
}

export type CollectionLimitCommandPayload =
  | CollectionLimitApprovalPayload
  | CollectionReservationPayload
  | CollectionReservationTransitionPayload;

export type CollectionLimitCommandResult =
  | { kind: "prepared"; payload: CollectionLimitCommandPayload; diagnostics: readonly [] }
  | { kind: "existing"; diagnostics: readonly [] }
  | { kind: "rejected"; diagnostics: readonly [CollectionLimitCommandDiagnostic] };

const SAFE_REASON_CODES = new Set<CollectionLimitReasonCode>([
  "provider_attempt_failed",
  "reservation_expired",
  "payment_refunded",
  "payment_chargeback",
  "reviewed_manual_correction",
]);

const VERIFIED_STATUS_BY_PLAN: Record<CollectionLimitPlanCode, TrustedCollectionApprovalReference["complianceStatus"]> = {
  solo_lite: "lite_verified",
  solo_plus: "enhanced_verified",
  business: "business_verified",
};

function text(value: unknown): string | null {
  const result = typeof value === "string" ? value.trim() : "";
  return result || null;
}

function positiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function ngnAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && Math.round(value * 100) === value * 100;
}

function validIdentity(value: TrustedCollectionCommandIdentity | null): value is TrustedCollectionCommandIdentity {
  return Boolean(value && value.authority === "trusted_server" && text(value.merchantId) && text(value.workspaceId));
}

function validReadiness(value: TrustedCollectionApprovalReference | null): value is TrustedCollectionApprovalReference {
  return Boolean(
    value
      && value.authority === "trusted_collection_readiness"
      && value.entitlementState === "active_paid"
      && value.complianceStatus === VERIFIED_STATUS_BY_PLAN[value.planCode]
      && text(value.profileId)
      && text(value.entitlementId)
      && text(value.reviewerDecisionId)
      && text(value.payoutReadinessId)
      && text(value.providerEnvironmentMappingId),
  );
}

function validPolicy(policy: CollectionPolicyWindowMetadata, allowOpenEnd: boolean): boolean {
  return Boolean(
    policy
      && policy.policyTimezone === "Africa/Lagos"
      && text(policy.windowStart)
      && (allowOpenEnd ? policy.windowEnd === null || Boolean(text(policy.windowEnd)) : Boolean(text(policy.windowEnd))),
  );
}

function safetyState(): CollectionCommandSafetyState {
  return {
    activationRequested: false,
    merchantEntitlements: {
      canCollectPayments: false,
      canUseInstantSale: false,
      canUseReceivableSale: false,
      canUseStorefront: false,
      canActivateSettlement: false,
      canUseDepositBalance: false,
    },
  };
}

function reject(code: CollectionLimitCommandReasonCode): CollectionLimitCommandResult {
  return { kind: "rejected", diagnostics: [{ code }] };
}

function validateBase(request: CollectionCommandBase): CollectionLimitCommandReasonCode | null {
  if (!validIdentity(request.identity)) {
    return request.identity ? "collection_authority_untrusted" : "collection_identity_missing";
  }
  if (!request.readiness) return "collection_readiness_missing";
  if (!validReadiness(request.readiness)) return "collection_readiness_unsafe";
  if (!text(request.policyVersion)) return "collection_policy_version_missing";
  if (!text(request.idempotencyKey)) return "collection_idempotency_key_missing";
  return null;
}

function replayIsConsistent(
  stored: TrustedStoredLimitCommandSnapshot | null | undefined,
  family: TrustedStoredLimitCommandSnapshot["commandFamily"],
  identity: TrustedCollectionCommandIdentity,
  key: string,
  amountNgn: number | null,
  internalReference: string | null,
  status: CollectionReservationLifecycle | null,
): "none" | "existing" | "conflict" {
  if (!stored) return "none";
  if (stored.authority !== "trusted_limit_repository") return "conflict";
  return stored.commandFamily === family
    && stored.merchantId === identity.merchantId
    && stored.workspaceId === identity.workspaceId
    && stored.idempotencyKey === key
    && stored.amountNgn === amountNgn
    && stored.internalReference === internalReference
    && stored.reservationStatus === status
    ? "existing"
    : "conflict";
}

function validReservation(
  value: TrustedReservationSnapshot | null,
  identity: TrustedCollectionCommandIdentity,
): value is TrustedReservationSnapshot {
  return Boolean(
    value
      && value.authority === "trusted_limit_repository"
      && value.merchantId === identity.merchantId
      && value.workspaceId === identity.workspaceId
      && text(value.reservationId)
      && text(value.internalReference)
      && ngnAmount(value.amountNgn)
      && value.currency === "NGN"
      && positiveInt(value.expectedRowVersion),
  );
}

function validateTransitionBase(
  request: PrepareCommitCommandRequest | PrepareReleaseCommandRequest | PrepareReversalCommandRequest,
  expectedStatus: CollectionReservationLifecycle,
): { code: CollectionLimitCommandReasonCode | null; reservation?: TrustedReservationSnapshot } {
  const base = validateBase(request);
  if (base) return { code: base };
  const identity = request.identity!;
  if (!request.reservation) return { code: "collection_reservation_missing" };
  if (!validReservation(request.reservation, identity)) return { code: "collection_reservation_untrusted" };
  if (request.reservation.status !== expectedStatus) return { code: "collection_reservation_status_invalid" };
  if (!positiveInt(request.expectedReservationRowVersion)
    || request.expectedReservationRowVersion !== request.reservation.expectedRowVersion) {
    return { code: "collection_reservation_version_missing" };
  }
  return { code: null, reservation: request.reservation };
}

/** Prepares an approved limit-window intent; it does not activate the limit. */
export function prepareLimitApprovalCommand(
  request: PrepareLimitApprovalCommandRequest,
): CollectionLimitCommandResult {
  const base = validateBase(request);
  if (base) return reject(base);
  if (!ngnAmount(request.amountNgn)) return reject("collection_amount_invalid");
  if (!validPolicy(request.policy, request.limitType === "cumulative")) return reject("collection_policy_window_invalid");
  if (!positiveInt(request.expectedWindowRowVersion)) return reject("collection_window_version_missing");
  const replay = replayIsConsistent(request.storedCommand, "limit_approval", request.identity!, request.idempotencyKey.trim(), request.amountNgn, null, null);
  if (replay === "conflict") return reject("collection_replay_conflict");
  if (replay === "existing") return { kind: "existing", diagnostics: [] };
  return {
    kind: "prepared",
    diagnostics: [],
    payload: {
      ...safetyState(), kind: "limit_approval", merchantId: request.identity!.merchantId.trim(), workspaceId: request.identity!.workspaceId.trim(),
      profileId: request.readiness!.profileId.trim(), planCode: request.readiness!.planCode, limitType: request.limitType,
      lifecycle: "approved", amountNgn: request.amountNgn, policy: request.policy,
      expectedWindowRowVersion: request.expectedWindowRowVersion, policyVersion: request.policyVersion.trim(), idempotencyKey: request.idempotencyKey.trim(),
    },
  };
}

/** Prepares a limit reservation intent; it never calls a provider or checkout. */
export function prepareReservationCommand(request: PrepareReservationCommandRequest): CollectionLimitCommandResult {
  const base = validateBase(request);
  if (base) return reject(base);
  if (!ngnAmount(request.amountNgn)) return reject("collection_amount_invalid");
  if (request.currency !== "NGN") return reject("collection_currency_invalid");
  if (!text(request.sourceId) || !text(request.internalReference) || !text(request.expiresAt) || request.windows.length === 0) return reject("collection_source_invalid");
  if (request.windows.some((window) => !positiveInt(window.expectedRowVersion) || !validPolicy(window.policy, window.limitType === "cumulative") || window.lifecycle !== "active")) {
    return reject("collection_window_not_reservable");
  }
  const replay = replayIsConsistent(request.storedCommand, "reservation", request.identity!, request.idempotencyKey.trim(), request.amountNgn, request.internalReference.trim(), "reserved");
  if (replay === "conflict") return reject("collection_replay_conflict");
  if (replay === "existing") return { kind: "existing", diagnostics: [] };
  return {
    kind: "prepared", diagnostics: [], payload: {
      ...safetyState(), kind: "reservation", merchantId: request.identity!.merchantId.trim(), workspaceId: request.identity!.workspaceId.trim(),
      profileId: request.readiness!.profileId.trim(), planCode: request.readiness!.planCode, amountNgn: request.amountNgn, currency: "NGN",
      sourceType: request.sourceType, sourceId: request.sourceId.trim(), internalReference: request.internalReference.trim(), expiresAt: request.expiresAt.trim(),
      windows: request.windows, policyVersion: request.policyVersion.trim(), idempotencyKey: request.idempotencyKey.trim(),
    },
  };
}

function transitionPayload(
  kind: CollectionReservationTransitionPayload["kind"],
  request: PrepareCommitCommandRequest | PrepareReleaseCommandRequest | PrepareReversalCommandRequest,
  reservation: TrustedReservationSnapshot,
  usageEventType: CollectionUsageEventType,
  reasonCode: CollectionLimitReasonCode | null,
  verifiedPaymentReference: string | null,
): CollectionLimitCommandResult {
  const replay = replayIsConsistent(request.storedCommand, kind, request.identity!, request.idempotencyKey.trim(), reservation.amountNgn, reservation.internalReference, reservation.status);
  if (replay === "conflict") return reject("collection_replay_conflict");
  if (replay === "existing") return { kind: "existing", diagnostics: [] };
  return {
    kind: "prepared", diagnostics: [], payload: {
      ...safetyState(), kind, merchantId: request.identity!.merchantId.trim(), workspaceId: request.identity!.workspaceId.trim(),
      profileId: request.readiness!.profileId.trim(), planCode: request.readiness!.planCode, reservationId: reservation.reservationId.trim(),
      internalReference: reservation.internalReference.trim(), amountNgn: reservation.amountNgn, currency: "NGN",
      expectedReservationRowVersion: request.expectedReservationRowVersion!, usageEventType, reasonCode,
      verifiedPaymentReference, policyVersion: request.policyVersion.trim(), idempotencyKey: request.idempotencyKey.trim(),
    },
  };
}

export function prepareCommitCommand(request: PrepareCommitCommandRequest): CollectionLimitCommandResult {
  const result = validateTransitionBase(request, "reserved");
  if (result.code) return reject(result.code);
  if (!text(request.verifiedPaymentReference)) return reject("collection_payment_reference_missing");
  return transitionPayload("commit", request, result.reservation!, "collection_committed", null, request.verifiedPaymentReference.trim());
}

export function prepareReleaseCommand(request: PrepareReleaseCommandRequest): CollectionLimitCommandResult {
  const result = validateTransitionBase(request, "reserved");
  if (result.code) return reject(result.code);
  if (!SAFE_REASON_CODES.has(request.reasonCode)) return reject("collection_reason_code_unsafe");
  const usageEventType = request.outcome === "expired" ? "reservation_expired" : "reservation_released";
  return transitionPayload("release", request, result.reservation!, usageEventType, request.reasonCode, null);
}

export function prepareReversalCommand(request: PrepareReversalCommandRequest): CollectionLimitCommandResult {
  const result = validateTransitionBase(request, "committed");
  if (result.code) return reject(result.code);
  if (!SAFE_REASON_CODES.has(request.reasonCode)) return reject("collection_reason_code_unsafe");
  return transitionPayload("reversal", request, result.reservation!, request.reversalType, request.reasonCode, null);
}
