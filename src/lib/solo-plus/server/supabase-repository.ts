import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  normalizeSoloPlusAmount,
  type SoloPlusAmount,
  type SoloPlusAdminCaseCursor,
  type SoloPlusAdminCaseDetailRecord,
  type SoloPlusAdminCaseEventCursor,
  type SoloPlusAdminCaseEventListInput,
  type SoloPlusAdminCaseEventListResult,
  type SoloPlusAdminCaseListInput,
  type SoloPlusAdminCaseListRecord,
  type SoloPlusAdminCaseListResult,
  type SoloPlusAdminCaseMerchantRecord,
  type SoloPlusActivationMerchantRecord,
  type SoloPlusActivationWorkspaceRecord,
  type SoloPlusActivationWorkspaceSubscriptionRecord,
  type SoloPlusCaseActivationAtomicParams,
  type SoloPlusCaseActivationAtomicResult,
  type SoloPlusCaseCreateAtomicInput,
  type SoloPlusCaseCreateAtomicResult,
  type SoloPlusCaseEventRecord,
  type SoloPlusCaseRecord,
  type SoloPlusCaseRepository,
  type SoloPlusCaseRequirementRecord,
  type SoloPlusCaseTransitionAtomicParams,
  type SoloPlusCaseTransitionAtomicResult,
  type SoloPlusAttachMerchantAtomicParams,
  type SoloPlusAttachMerchantAtomicResult,
  type SoloPlusFlowOrigin,
  type SoloPlusPaymentProvider,
  type SoloPlusSafeJsonObject,
  SOLO_PLUS_ACTIVE_CASE_STATUSES,
  type SoloPlusSourcePlan,
} from "../repository";
import {
  isSoloPlusCaseStatus,
  isSoloPlusRequirementCode,
  isSoloPlusRequirementState,
  type SoloPlusPaymentStatus,
  type SoloPlusRefundStatus,
} from "../state";

const CREATE_CASE_BUNDLE_RPC = "create_solo_plus_case_bundle_v1";
const ATTACH_ONBOARDING_MERCHANT_RPC = "attach_solo_plus_onboarding_merchant_v1";
const MARK_AWAITING_PAYMENT_RPC = "mark_solo_plus_case_awaiting_payment_v1";
const CASE_BUNDLE_PAYLOAD_RPC = "solo_plus_case_bundle_payload_v1";
const REVIEW_CASE_RPC = "review_solo_plus_case_v1";
const ACTIVATE_CASE_RPC = "activate_solo_plus_case_v1";
const REVIEW_DECISION_EVENT_TYPES = [
  "case_review_requested_more_information",
  "case_approved",
  "case_rejected",
  "case_reopened",
] as const;

const UUID_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type SupabaseLikeError = {
  message: string;
};

type SupabaseLikeResponse<T> = Promise<{
  data: T;
  error: SupabaseLikeError | null;
}>;

type SupabaseLikeQueryBuilder = {
  select(columns?: string): SupabaseLikeQueryBuilder;
  eq(column: string, value: unknown): SupabaseLikeQueryBuilder;
  in(column: string, values: readonly unknown[]): SupabaseLikeQueryBuilder;
  or?(filters: string): SupabaseLikeQueryBuilder;
  lt?(column: string, value: unknown): SupabaseLikeQueryBuilder;
  lte?(column: string, value: unknown): SupabaseLikeQueryBuilder;
  ilike?(column: string, value: string): SupabaseLikeQueryBuilder;
  order(column: string, options?: { ascending?: boolean }): SupabaseLikeQueryBuilder;
  limit(count: number): SupabaseLikeQueryBuilder;
  insert(
    values: Record<string, unknown> | readonly Record<string, unknown>[],
  ): SupabaseLikeQueryBuilder;
  update(values: Record<string, unknown>): SupabaseLikeQueryBuilder;
  upsert(
    values: Record<string, unknown> | readonly Record<string, unknown>[],
    options?: { onConflict?: string },
  ): SupabaseLikeResponse<unknown>;
  maybeSingle(): SupabaseLikeResponse<unknown | null>;
  single(): SupabaseLikeResponse<unknown>;
  then?<TResult1 = { data: unknown; error: SupabaseLikeError | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: SupabaseLikeError | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
};

export type SoloPlusSupabaseClientLike = {
  from(table: string): SupabaseLikeQueryBuilder;
  rpc(name: string, args: Record<string, unknown>): SupabaseLikeResponse<unknown>;
};

export type SoloPlusSupabaseRepositoryErrorCode =
  | "SOLO_PLUS_ATOMIC_PERSISTENCE_UNAVAILABLE"
  | "SOLO_PLUS_REPOSITORY_MAPPING_ERROR";

export type SoloPlusCaseBundleRecord = {
  caseRecord: SoloPlusCaseRecord;
  requirements: readonly SoloPlusCaseRequirementRecord[];
  createdEvent: SoloPlusCaseEventRecord | null;
};

export class SoloPlusSupabaseRepositoryError extends Error {
  readonly code: SoloPlusSupabaseRepositoryErrorCode;

  constructor(code: SoloPlusSupabaseRepositoryErrorCode, message: string) {
    super(message);
    this.name = "SoloPlusSupabaseRepositoryError";
    this.code = code;
  }
}

type SoloPlusCaseRow = Record<string, unknown>;
type SoloPlusRequirementRow = Record<string, unknown>;
type SoloPlusEventRow = Record<string, unknown>;
type SoloPlusMerchantRow = Record<string, unknown>;
type SoloPlusActivationMerchantRow = Record<string, unknown>;
type SoloPlusActivationWorkspaceRow = Record<string, unknown>;
type SoloPlusActivationWorkspaceSubscriptionRow = Record<string, unknown>;
type SoloPlusRpcPayload = Record<string, unknown>;

export function createSoloPlusServiceRoleClient(): SoloPlusSupabaseClientLike {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_ATOMIC_PERSISTENCE_UNAVAILABLE",
      "Solo Plus service-role Supabase environment variables are unavailable.",
    );
  }

  return createSupabaseClient(url, serviceRoleKey) as unknown as SoloPlusSupabaseClientLike;
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function assertUuidLike(value: unknown, field: string, nullable = false): string | null {
  if (value == null) {
    if (nullable) {
      return null;
    }

    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      `Solo Plus repository mapping rejected ${field}.`,
    );
  }

  if (!hasNonEmptyString(value) || !UUID_LIKE_PATTERN.test(value.trim())) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      `Solo Plus repository mapping rejected ${field}.`,
    );
  }

  return value.trim();
}

function assertTimestamp(value: unknown, field: string, nullable = false): string | null {
  if (value == null) {
    if (nullable) {
      return null;
    }

    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      `Solo Plus repository mapping rejected ${field}.`,
    );
  }

  if (!hasNonEmptyString(value)) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      `Solo Plus repository mapping rejected ${field}.`,
    );
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      `Solo Plus repository mapping rejected ${field}.`,
    );
  }

  return parsed.toISOString();
}

function mappingError(field: string): SoloPlusSupabaseRepositoryError {
  return new SoloPlusSupabaseRepositoryError(
    "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
    `Solo Plus repository mapping rejected ${field}.`,
  );
}

function assertAmount(value: unknown, field: string): SoloPlusAmount {
  let amountCandidate: string;

  if (typeof value === "string") {
    amountCandidate = value;
  } else if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    const cents = value * 100;
    const roundedCents = Math.round(cents);
    const isTwoDecimalNumber =
      Math.abs(cents - roundedCents) <= Number.EPSILON * Math.max(1, Math.abs(cents));
    if (!isTwoDecimalNumber || !Number.isSafeInteger(roundedCents)) {
      throw mappingError(field);
    }
    amountCandidate = (roundedCents / 100).toFixed(2);
  } else {
    throw mappingError(field);
  }

  try {
    return normalizeSoloPlusAmount(amountCandidate);
  } catch {
    // fall through to the same safe mapping error shape
  }

  throw mappingError(field);
}

function assertOptionalAmount(value: unknown, field: string): SoloPlusAmount | null {
  if (value == null) {
    return null;
  }

  return assertAmount(value, field);
}

function assertOptionalNumber(value: unknown, field: string): number | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new SoloPlusSupabaseRepositoryError(
    "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
    `Solo Plus repository mapping rejected ${field}.`,
  );
}

function assertOptionalBoolean(value: unknown, field: string): boolean | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    if (normalized === "1") return true;
    if (normalized === "0") return false;
  }

  throw new SoloPlusSupabaseRepositoryError(
    "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
    `Solo Plus repository mapping rejected ${field}.`,
  );
}

function assertNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value >= 0) {
      return value;
    }

    throw mappingError(field);
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (/^(0|[1-9][0-9]*)$/.test(normalized)) {
      const parsed = Number(normalized);
      if (Number.isSafeInteger(parsed)) {
        return parsed;
      }
    }
  }

  throw mappingError(field);
}

function assertJsonValue(value: unknown): value is string | number | boolean | null | unknown[] | Record<string, unknown> {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return Number.isFinite(value as number) || typeof value !== "number";
  }

  if (Array.isArray(value)) {
    return value.every((item) => assertJsonValue(item));
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every((entry) => assertJsonValue(entry));
  }

  return false;
}

function assertJsonObject(value: unknown, field: string): SoloPlusSafeJsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !assertJsonValue(value)) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      `Solo Plus repository mapping rejected ${field}.`,
    );
  }

  return JSON.parse(JSON.stringify(value)) as SoloPlusSafeJsonObject;
}

function assertFlowOrigin(value: unknown): SoloPlusFlowOrigin {
  if (value === "onboarding" || value === "upgrade") {
    return value;
  }

  throw new SoloPlusSupabaseRepositoryError(
    "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
    "Solo Plus repository mapping rejected flowOrigin.",
  );
}

function assertSourcePlan(value: unknown): SoloPlusSourcePlan {
  if (value === null || value === undefined) {
    return null;
  }

  if (value === "solo_lite") {
    return value;
  }

  throw new SoloPlusSupabaseRepositoryError(
    "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
    "Solo Plus repository mapping rejected sourcePlan.",
  );
}

function assertTargetPlan(value: unknown): "solo_plus" {
  if (value === "solo_plus") {
    return value;
  }

  throw new SoloPlusSupabaseRepositoryError(
    "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
    "Solo Plus repository mapping rejected targetPlan.",
  );
}

function assertPaymentStatus(value: unknown): SoloPlusPaymentStatus {
  if (value === "pending" || value === "paid" || value === "failed") {
    return value;
  }

  throw new SoloPlusSupabaseRepositoryError(
    "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
    "Solo Plus repository mapping rejected paymentStatus.",
  );
}

function assertRefundStatus(value: unknown): SoloPlusRefundStatus {
  if (
    value === "none" ||
    value === "review_required" ||
    value === "approved" ||
    value === "processing" ||
    value === "completed" ||
    value === "failed"
  ) {
    return value;
  }

  throw new SoloPlusSupabaseRepositoryError(
    "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
    "Solo Plus repository mapping rejected refundStatus.",
  );
}

function assertPaymentProvider(value: unknown): SoloPlusPaymentProvider {
  if (value == null) {
    return null;
  }

  if (value === "paystack" || value === "monnify" || value === "breet") {
    return value;
  }

  throw new SoloPlusSupabaseRepositoryError(
    "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
    "Solo Plus repository mapping rejected paymentProvider.",
  );
}

function assertText(value: unknown, field: string, nullable = false): string | null {
  if (value == null) {
    if (nullable) {
      return null;
    }

    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      `Solo Plus repository mapping rejected ${field}.`,
    );
  }

  if (!hasNonEmptyString(value)) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      `Solo Plus repository mapping rejected ${field}.`,
    );
  }

  return value.trim();
}

function assertOptionalUuidLike(value: unknown, field: string): string | null {
  return assertUuidLike(value, field, true);
}

function assertOptionalIsoTimestamp(value: unknown, field: string): string | null {
  return assertTimestamp(value, field, true);
}

function mapCaseRow(row: unknown): SoloPlusCaseRecord {
  const candidate = row as SoloPlusCaseRow;
  const caseStatusValue = assertText(candidate.case_status, "case_status")!;

  if (!isSoloPlusCaseStatus(caseStatusValue)) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      "Solo Plus repository mapping rejected caseStatus.",
    );
  }
  const caseStatus = caseStatusValue as SoloPlusCaseRecord["caseStatus"];

  const paymentCurrency = assertText(candidate.payment_currency, "payment_currency");
  if (paymentCurrency !== "NGN") {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      "Solo Plus repository mapping rejected paymentCurrency.",
    );
  }

  const activePlanSnapshot = candidate.active_plan_snapshot;
  if (
    activePlanSnapshot != null &&
    activePlanSnapshot !== "starter" &&
    activePlanSnapshot !== "solo_lite" &&
    activePlanSnapshot !== "solo_plus" &&
    activePlanSnapshot !== "business"
  ) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      "Solo Plus repository mapping rejected activePlanSnapshot.",
    );
  }

  return {
    id: assertUuidLike(candidate.id, "id")!,
    merchantId: assertUuidLike(candidate.merchant_id, "merchant_id", true),
    onboardingSessionId: assertUuidLike(
      candidate.onboarding_session_id,
      "onboarding_session_id",
      true,
    ),
    flowOrigin: assertFlowOrigin(candidate.flow_origin),
    sourcePlan: assertSourcePlan(candidate.source_plan),
    targetPlan: assertTargetPlan(candidate.target_plan),
    caseStatus,
    paymentStatus: assertPaymentStatus(candidate.payment_status),
    refundStatus: assertRefundStatus(candidate.refund_status),
    paymentRecordId: assertUuidLike(candidate.payment_record_id, "payment_record_id", true),
    paymentProvider: assertPaymentProvider(candidate.payment_provider),
    paymentReference: assertText(candidate.payment_reference, "payment_reference", true),
    expectedAmount: assertAmount(candidate.expected_amount, "expected_amount"),
    paymentCurrency: "NGN",
    requirementsPolicyVersion: assertText(
      candidate.requirements_policy_version,
      "requirements_policy_version",
    )!,
    requirementsSnapshot: assertJsonObject(
      candidate.requirements_snapshot,
      "requirements_snapshot",
    ),
    activePlanSnapshot: (activePlanSnapshot ?? null) as SoloPlusCaseRecord["activePlanSnapshot"],
    rejectionReason: assertText(candidate.rejection_reason, "rejection_reason", true),
    approvedAt: assertTimestamp(candidate.approved_at, "approved_at", true),
    approvedByAdminId: assertUuidLike(candidate.approved_by_admin_id, "approved_by_admin_id", true),
    rejectedAt: assertTimestamp(candidate.rejected_at, "rejected_at", true),
    rejectedByAdminId: assertUuidLike(candidate.rejected_by_admin_id, "rejected_by_admin_id", true),
    reopenedAt: assertTimestamp(candidate.reopened_at, "reopened_at", true),
    reopenedByAdminId: assertUuidLike(candidate.reopened_by_admin_id, "reopened_by_admin_id", true),
    idempotencyKey: assertText(candidate.idempotency_key, "idempotency_key")!,
    activationIdempotencyKey: assertText(
      candidate.activation_idempotency_key,
      "activation_idempotency_key",
      true,
    ),
    refundIdempotencyKey: assertText(
      candidate.refund_idempotency_key,
      "refund_idempotency_key",
      true,
    ),
    rowVersion: assertNonNegativeInteger(candidate.row_version, "row_version"),
    auditMetadata: assertJsonObject(candidate.audit_metadata ?? {}, "audit_metadata"),
    createdAt: assertTimestamp(candidate.created_at, "created_at")!,
    updatedAt: assertTimestamp(candidate.updated_at, "updated_at")!,
  };
}

function mapRequirementRow(row: unknown): SoloPlusCaseRequirementRecord {
  const candidate = row as SoloPlusRequirementRow;
  const requirementCode = assertText(candidate.requirement_code, "requirement_code")!;
  const requirementState = assertText(candidate.requirement_state, "requirement_state")!;

  if (!isSoloPlusRequirementCode(requirementCode)) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      "Solo Plus repository mapping rejected requirementCode.",
    );
  }
  const mappedRequirementCode = requirementCode as SoloPlusCaseRequirementRecord["requirementCode"];

  if (!isSoloPlusRequirementState(requirementState)) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      "Solo Plus repository mapping rejected requirementState.",
    );
  }
  const mappedRequirementState =
    requirementState as SoloPlusCaseRequirementRecord["requirementState"];

  const evidenceSourceType = candidate.evidence_source_type;
  if (
    evidenceSourceType != null &&
    evidenceSourceType !== "verification_log" &&
    evidenceSourceType !== "merchant_document" &&
    evidenceSourceType !== "settlement_account" &&
    evidenceSourceType !== "manual_submission"
  ) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      "Solo Plus repository mapping rejected evidenceSourceType.",
    );
  }

  return {
    id: assertUuidLike(candidate.id, "requirement.id")!,
    caseId: assertUuidLike(candidate.case_id, "requirement.case_id")!,
    requirementCode: mappedRequirementCode,
    requirementState: mappedRequirementState,
    verificationLogId: assertUuidLike(
      candidate.verification_log_id,
      "verification_log_id",
      true,
    ),
    evidenceSourceType: (evidenceSourceType ?? null) as SoloPlusCaseRequirementRecord["evidenceSourceType"],
    evidenceSourceId: assertUuidLike(candidate.evidence_source_id, "evidence_source_id", true),
    evidenceReference: assertText(candidate.evidence_reference, "evidence_reference", true),
    originalCompletedAt: assertTimestamp(
      candidate.original_completed_at,
      "original_completed_at",
      true,
    ),
    reuseDecisionAt: assertTimestamp(candidate.reuse_decision_at, "reuse_decision_at", true),
    reuseReason: assertText(candidate.reuse_reason, "reuse_reason", true),
    policyRuleApplied: assertText(candidate.policy_rule_applied, "policy_rule_applied", true),
    reviewedByAdminId: assertUuidLike(
      candidate.reviewed_by_admin_id,
      "reviewed_by_admin_id",
      true,
    ),
    reviewNote: assertText(candidate.review_note, "review_note", true),
    providerName: assertText(candidate.provider_name, "provider_name", true),
    providerReference: assertText(candidate.provider_reference, "provider_reference", true),
    failureReason: assertText(candidate.failure_reason, "failure_reason", true),
    completedAt: assertTimestamp(candidate.completed_at, "completed_at", true),
    metadata: assertJsonObject(candidate.metadata, "metadata"),
    createdAt: assertTimestamp(candidate.created_at, "requirement.created_at")!,
    updatedAt: assertTimestamp(candidate.updated_at, "requirement.updated_at")!,
  };
}

function mapRequirementRecordToRow(
  record: SoloPlusCaseRequirementRecord,
): Record<string, unknown> {
  return {
    id: record.id,
    case_id: record.caseId,
    requirement_code: record.requirementCode,
    requirement_state: record.requirementState,
    verification_log_id: record.verificationLogId,
    evidence_source_type: record.evidenceSourceType,
    evidence_source_id: record.evidenceSourceId,
    evidence_reference: record.evidenceReference,
    original_completed_at: record.originalCompletedAt,
    reuse_decision_at: record.reuseDecisionAt,
    reuse_reason: record.reuseReason,
    policy_rule_applied: record.policyRuleApplied,
    reviewed_by_admin_id: record.reviewedByAdminId,
    review_note: record.reviewNote,
    provider_name: record.providerName,
    provider_reference: record.providerReference,
    failure_reason: record.failureReason,
    completed_at: record.completedAt,
    metadata: record.metadata,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function mapEventRow(row: unknown): SoloPlusCaseEventRecord {
  const candidate = row as SoloPlusEventRow;
  const eventType = assertText(candidate.event_type, "event_type");
  const actorType = assertText(candidate.actor_type, "actor_type");

  if (
    actorType !== "merchant" &&
    actorType !== "admin" &&
    actorType !== "system" &&
    actorType !== "provider"
  ) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      "Solo Plus repository mapping rejected actorType.",
    );
  }

  return {
    id: assertUuidLike(candidate.id, "event.id")!,
    caseId: assertUuidLike(candidate.case_id, "event.case_id")!,
    eventType: eventType!,
    previousState: assertJsonObject(candidate.previous_state, "previous_state"),
    newState: assertJsonObject(candidate.new_state, "new_state"),
    actorType,
    actorId: assertUuidLike(candidate.actor_id, "actor_id", true),
    requestIdempotencyKey: assertText(
      candidate.request_idempotency_key,
      "request_idempotency_key",
      true,
    ),
    reason: assertText(candidate.reason, "reason", true),
    policyVersion: assertText(candidate.policy_version, "policy_version")!,
    createdAt: assertTimestamp(candidate.created_at, "event.created_at")!,
  };
}

function mapAdminMerchantRow(row: unknown): SoloPlusAdminCaseMerchantRecord {
  const candidate = row as SoloPlusMerchantRow;
  return {
    merchantId: assertUuidLike(candidate.id, "merchant.id")!,
    businessName: assertText(candidate.business_name, "business_name", true),
    ownerName: null,
    email: assertText(candidate.email, "email", true),
    subscriptionPlan: assertText(candidate.subscription_plan, "subscription_plan", true),
  };
}

function compareAdminCaseCursor(
  caseRecord: SoloPlusCaseRecord,
  cursor: SoloPlusAdminCaseCursor,
): number {
  const updatedAtComparison = caseRecord.updatedAt.localeCompare(cursor.updatedAt);
  if (updatedAtComparison !== 0) {
    return updatedAtComparison;
  }

  return caseRecord.id.localeCompare(cursor.caseId);
}

function compareAdminEventCursor(
  eventRecord: SoloPlusCaseEventRecord,
  cursor: SoloPlusAdminCaseEventCursor,
): number {
  const createdAtComparison = eventRecord.createdAt.localeCompare(cursor.createdAt);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  return eventRecord.id.localeCompare(cursor.eventId);
}

function mapActivationMerchantRow(row: unknown): SoloPlusActivationMerchantRecord {
  const candidate = row as SoloPlusActivationMerchantRow;
  return {
    id: assertUuidLike(candidate.id, "merchant.id")!,
    subscriptionPlan: assertText(candidate.subscription_plan, "subscription_plan", true),
    merchantTier: assertText(candidate.merchant_tier, "merchant_tier", true),
    monthlyCollectionLimit: assertOptionalNumber(
      candidate.monthly_collection_limit,
      "monthly_collection_limit",
    ),
    setupMode: assertOptionalBoolean(candidate.setup_mode, "setup_mode"),
    liveFeaturesEnabled: assertOptionalBoolean(
      candidate.live_features_enabled,
      "live_features_enabled",
    ),
    liveFeaturesActivatedAt: assertTimestamp(
      candidate.live_features_activated_at,
      "live_features_activated_at",
      true,
    ),
    onboardingStatus: assertText(candidate.onboarding_status, "onboarding_status", true),
    workspaceId: assertUuidLike(candidate.workspace_id, "workspace_id", true),
    verificationStatus: assertText(candidate.verification_status, "verification_status", true),
    updatedAt: assertTimestamp(candidate.updated_at, "merchant.updated_at")!,
  };
}

function mapActivationWorkspaceRow(row: unknown): SoloPlusActivationWorkspaceRecord {
  const candidate = row as SoloPlusActivationWorkspaceRow;
  return {
    id: assertUuidLike(candidate.id, "workspace.id")!,
    merchantId: assertUuidLike(candidate.merchant_id, "merchant_id", true),
    ownerUserId: assertUuidLike(candidate.owner_user_id, "owner_user_id", true),
    workspaceType: assertText(candidate.workspace_type, "workspace_type", true),
    displayName: assertText(candidate.display_name, "display_name", true),
    planType: assertText(candidate.plan_type, "plan_type", true),
    onboardingStatus: assertText(candidate.onboarding_status, "onboarding_status", true),
    setupMode: assertOptionalBoolean(candidate.setup_mode, "setup_mode"),
    liveFeaturesEnabled: assertOptionalBoolean(
      candidate.live_features_enabled,
      "live_features_enabled",
    ),
    updatedAt: assertTimestamp(candidate.updated_at, "workspace.updated_at")!,
  };
}

function mapActivationWorkspaceSubscriptionRow(
  row: unknown,
): SoloPlusActivationWorkspaceSubscriptionRecord {
  const candidate = row as SoloPlusActivationWorkspaceSubscriptionRow;
  return {
    id: assertUuidLike(candidate.id, "workspace_subscription.id")!,
    workspaceId: assertUuidLike(candidate.workspace_id, "workspace_id", true),
    merchantId: assertUuidLike(candidate.merchant_id, "merchant_id", true),
    planType: assertText(candidate.plan_type, "plan_type", true),
    subscriptionStatus: assertText(candidate.subscription_status, "subscription_status", true),
    paymentReference: assertText(candidate.payment_reference, "payment_reference", true),
    amountPaid: assertOptionalAmount(candidate.amount_paid, "amount_paid"),
    periodStart: assertTimestamp(candidate.period_start, "period_start", true),
    periodEnd: assertTimestamp(candidate.period_end, "period_end", true),
    updatedAt: assertTimestamp(candidate.updated_at, "workspace_subscription.updated_at")!,
  };
}

function assertRpcPayload(value: unknown): SoloPlusRpcPayload {
  const singleValue =
    Array.isArray(value) && value.length === 1
      ? value[0]
      : value;

  if (typeof singleValue !== "object" || singleValue === null || Array.isArray(singleValue)) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      "Solo Plus repository received a malformed RPC payload.",
    );
  }

  const payloadCandidate =
    "payload" in (singleValue as Record<string, unknown>) &&
    typeof (singleValue as Record<string, unknown>).payload === "object" &&
    (singleValue as Record<string, unknown>).payload !== null &&
    !Array.isArray((singleValue as Record<string, unknown>).payload)
      ? (singleValue as Record<string, unknown>).payload
      : singleValue;

  return payloadCandidate as SoloPlusRpcPayload;
}

function isCaseBundleEnvelope(value: unknown): value is SoloPlusRpcPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "case" in (value as Record<string, unknown>) &&
    ("requirements" in (value as Record<string, unknown>) ||
      "created_event" in (value as Record<string, unknown>) ||
      "event" in (value as Record<string, unknown>))
  );
}

function extractCaseBundleEnvelope(payload: SoloPlusRpcPayload): {
  caseRow: unknown | null;
  requirements: unknown[] | null;
  createdEvent: unknown | null;
} {
  const nestedEnvelope = isCaseBundleEnvelope(payload.case) ? payload.case : null;
  const effectivePayload = nestedEnvelope ?? payload;
  const requirements =
    Array.isArray(payload.requirements)
      ? payload.requirements
      : Array.isArray(effectivePayload.requirements)
        ? effectivePayload.requirements
        : null;
  const createdEvent =
    payload.created_event ??
    payload.event ??
    effectivePayload.created_event ??
    effectivePayload.event ??
    null;

  return {
    caseRow: effectivePayload.case ?? null,
    requirements,
    createdEvent,
  };
}

function mapCreateResult(value: unknown): SoloPlusCaseCreateAtomicResult {
  const payload = assertRpcPayload(value);
  const kind = assertText(payload.kind, "rpc.kind");
  const bundle = extractCaseBundleEnvelope(payload);

  if (kind === "created") {
    const event = bundle.createdEvent;
    if (event == null) {
      throw new SoloPlusSupabaseRepositoryError(
        "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
        "Solo Plus repository received a malformed RPC payload.",
      );
    }

    if (!Array.isArray(bundle.requirements)) {
      throw new SoloPlusSupabaseRepositoryError(
        "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
        "Solo Plus repository received a malformed RPC payload.",
      );
    }

    return {
      kind,
      caseRecord: mapCaseRow(bundle.caseRow),
      requirements: bundle.requirements.map((row) => mapRequirementRow(row)),
      event: mapEventRow(event),
    };
  }

  if (kind === "idempotent_replay" || kind === "existing_active_case") {
    return {
      kind,
      existingCase: mapCaseRow(bundle.caseRow),
    };
  }

  if (kind === "idempotency_conflict" || kind === "active_case_conflict") {
    return {
      kind,
      existingCase: mapCaseRow(bundle.caseRow),
    };
  }

  throw new SoloPlusSupabaseRepositoryError(
    "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
    "Solo Plus repository received an unknown create RPC outcome.",
  );
}

function mapAttachResult(value: unknown): SoloPlusAttachMerchantAtomicResult {
  const payload = assertRpcPayload(value);
  const kind = assertText(payload.kind, "rpc.kind");
  const bundle = extractCaseBundleEnvelope(payload);

  if (kind === "updated") {
    return {
      kind,
      caseRecord: mapCaseRow(bundle.caseRow),
      event: mapEventRow(bundle.createdEvent),
    };
  }

  if (kind === "idempotent_replay") {
    return {
      kind,
      caseRecord: mapCaseRow(bundle.caseRow),
      event: bundle.createdEvent == null ? null : mapEventRow(bundle.createdEvent),
    };
  }

  if (kind === "not_found") {
    return { kind };
  }

  if (
    kind === "idempotency_conflict" ||
    kind === "active_case_conflict" ||
    kind === "version_conflict" ||
    kind === "state_conflict" ||
    kind === "ownership_conflict"
  ) {
    return {
      kind,
      currentCase: mapCaseRow(bundle.caseRow),
    } as SoloPlusAttachMerchantAtomicResult;
  }

  throw new SoloPlusSupabaseRepositoryError(
    "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
    "Solo Plus repository received an unknown attach RPC outcome.",
  );
}

function mapTransitionResult(value: unknown): SoloPlusCaseTransitionAtomicResult {
  const payload = assertRpcPayload(value);
  const kind = assertText(payload.kind, "rpc.kind");
  const bundle = extractCaseBundleEnvelope(payload);

  if (kind === "updated") {
    return {
      kind,
      caseRecord: mapCaseRow(bundle.caseRow),
      event: mapEventRow(bundle.createdEvent),
    };
  }

  if (kind === "idempotent_replay") {
    return {
      kind,
      caseRecord: mapCaseRow(bundle.caseRow),
      event: bundle.createdEvent == null ? null : mapEventRow(bundle.createdEvent),
    };
  }

  if (kind === "not_found") {
    return { kind };
  }

  if (kind === "idempotency_conflict" || kind === "version_conflict" || kind === "state_conflict") {
    return {
      kind,
      currentCase: mapCaseRow(bundle.caseRow),
    } as SoloPlusCaseTransitionAtomicResult;
  }

  throw new SoloPlusSupabaseRepositoryError(
    "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
    "Solo Plus repository received an unknown transition RPC outcome.",
  );
}

function mapActivationResult(value: unknown): SoloPlusCaseActivationAtomicResult {
  const payload = assertRpcPayload(value);
  const kind = assertText(payload.kind, "rpc.kind");
  const bundle = extractCaseBundleEnvelope(payload);

  if (kind === "applied" || kind === "idempotent_replay") {
    const caseRow = bundle.caseRow;
    const eventRow = bundle.createdEvent;

    if (caseRow == null || eventRow == null) {
      throw new SoloPlusSupabaseRepositoryError(
        "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
        "Solo Plus repository received a malformed activation RPC payload.",
      );
    }

    return {
      kind,
      caseRecord: mapCaseRow(caseRow),
      event: mapEventRow(eventRow),
      merchant: payload.merchant == null ? null : mapActivationMerchantRow(payload.merchant),
      workspace: payload.workspace == null ? null : mapActivationWorkspaceRow(payload.workspace),
      workspaceSubscription:
        payload.workspace_subscription == null
          ? null
          : mapActivationWorkspaceSubscriptionRow(payload.workspace_subscription),
    };
  }

  if (kind === "not_found") {
    return { kind };
  }

  if (
    kind === "idempotency_conflict" ||
    kind === "version_conflict" ||
    kind === "state_conflict"
  ) {
    return {
      kind,
      currentCase: mapCaseRow(bundle.caseRow),
    } as SoloPlusCaseActivationAtomicResult;
  }

  if (kind === "prerequisite_conflict") {
    return {
      kind,
      currentCase: mapCaseRow(bundle.caseRow),
      reason: assertText(payload.reason, "reason", true) ?? undefined,
    };
  }

  if (kind === "feature_disabled") {
    return {
      kind,
      currentCase: bundle.caseRow == null ? undefined : mapCaseRow(bundle.caseRow),
    };
  }

  throw new SoloPlusSupabaseRepositoryError(
    "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
    "Solo Plus repository received an unknown activation RPC outcome.",
  );
}

function mapCaseBundlePayload(payload: SoloPlusRpcPayload): SoloPlusCaseBundleRecord | null {
  const bundle = extractCaseBundleEnvelope(payload);
  if (bundle.caseRow == null) {
    return null;
  }

  if (!Array.isArray(bundle.requirements)) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      "Solo Plus repository received a malformed RPC payload.",
    );
  }

  return {
    caseRecord: mapCaseRow(bundle.caseRow),
    requirements: bundle.requirements.map((row) => mapRequirementRow(row)),
    createdEvent: bundle.createdEvent == null ? null : mapEventRow(bundle.createdEvent),
  };
}

function wrapSupabaseError(error: SupabaseLikeError | null): never {
  throw new SoloPlusSupabaseRepositoryError(
    "SOLO_PLUS_ATOMIC_PERSISTENCE_UNAVAILABLE",
    `Solo Plus repository operation failed: ${error?.message || "unknown error"}.`,
  );
}

function assertAwaitingPaymentTransitionInput(
  input: SoloPlusCaseTransitionAtomicParams,
): void {
  if (input.expectedCurrentStatus !== "draft" || input.targetStatus !== "awaiting_payment") {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_ATOMIC_PERSISTENCE_UNAVAILABLE",
      "Solo Plus repository only supports draft to awaiting_payment transitions in Commit 5.",
    );
  }

  const allowedKeys = new Set([
    "caseStatus",
    "paymentStatus",
    "paymentProvider",
    "paymentReference",
    "paymentRecordId",
  ]);

  for (const key of Object.keys(input.patch)) {
    if (!allowedKeys.has(key)) {
      throw new SoloPlusSupabaseRepositoryError(
        "SOLO_PLUS_ATOMIC_PERSISTENCE_UNAVAILABLE",
        "Solo Plus repository rejected an unsupported transition patch.",
      );
    }
  }

  if (
    (input.patch.caseStatus != null && input.patch.caseStatus !== "awaiting_payment") ||
    (input.patch.paymentStatus != null && input.patch.paymentStatus !== "pending") ||
    (input.patch.paymentProvider !== undefined && input.patch.paymentProvider !== null) ||
    (input.patch.paymentReference !== undefined && input.patch.paymentReference !== null) ||
    (input.patch.paymentRecordId !== undefined && input.patch.paymentRecordId !== null)
  ) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_ATOMIC_PERSISTENCE_UNAVAILABLE",
      "Solo Plus repository rejected an unsupported transition patch.",
    );
  }
}

function assertReviewTransitionInput(
  input: SoloPlusCaseTransitionAtomicParams,
): "request_more_information" | "approve" | "reject" | "reopen" {
  if (input.event.actorType !== "admin" || !hasNonEmptyString(input.event.actorId)) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_ATOMIC_PERSISTENCE_UNAVAILABLE",
      "Solo Plus repository review transitions require an authenticated admin actor.",
    );
  }

  const supportedDecision =
    input.expectedCurrentStatus === "manual_review" &&
    input.targetStatus === "verification_pending" &&
    input.event.eventType === "case_review_requested_more_information"
      ? "request_more_information"
      : input.expectedCurrentStatus === "manual_review" &&
          input.targetStatus === "approved" &&
          input.event.eventType === "case_approved"
        ? "approve"
        : input.expectedCurrentStatus === "manual_review" &&
            input.targetStatus === "rejected" &&
            input.event.eventType === "case_rejected"
          ? "reject"
          : input.expectedCurrentStatus === "rejected" &&
              input.targetStatus === "verification_pending" &&
              input.event.eventType === "case_reopened"
            ? "reopen"
            : null;

  if (supportedDecision == null) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_ATOMIC_PERSISTENCE_UNAVAILABLE",
      "Solo Plus repository rejected an unsupported review transition payload.",
    );
  }

  return supportedDecision;
}

function assertActivationInput(input: SoloPlusCaseActivationAtomicParams): void {
  if (!hasNonEmptyString(input.caseId) || !UUID_LIKE_PATTERN.test(input.caseId.trim())) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_ATOMIC_PERSISTENCE_UNAVAILABLE",
      "Solo Plus repository rejected an invalid activation caseId.",
    );
  }

  if (
    typeof input.expectedRowVersion !== "number" ||
    !Number.isInteger(input.expectedRowVersion) ||
    input.expectedRowVersion < 0 ||
    !Number.isSafeInteger(input.expectedRowVersion)
  ) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_ATOMIC_PERSISTENCE_UNAVAILABLE",
      "Solo Plus repository rejected an invalid activation row version.",
    );
  }

  if (!hasNonEmptyString(input.requestIdempotencyKey)) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_ATOMIC_PERSISTENCE_UNAVAILABLE",
      "Solo Plus repository rejected an invalid activation idempotency key.",
    );
  }

  if (!hasNonEmptyString(input.activatorAdminId) || !UUID_LIKE_PATTERN.test(input.activatorAdminId.trim())) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_ATOMIC_PERSISTENCE_UNAVAILABLE",
      "Solo Plus repository rejected an invalid activation admin id.",
    );
  }

  if (input.policyVersion != null && !hasNonEmptyString(input.policyVersion)) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_ATOMIC_PERSISTENCE_UNAVAILABLE",
      "Solo Plus repository rejected an invalid activation policy version.",
    );
  }
}

async function maybeSingle(
  query: SupabaseLikeQueryBuilder,
): Promise<unknown | null> {
  const { data, error } = await query.maybeSingle();
  if (error) {
    wrapSupabaseError(error);
  }
  return normalizeZeroOrOneResult(data);
}

function normalizeZeroOrOneResult(data: unknown): unknown | null {
  if (data == null) {
    return null;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return null;
    }

    if (data.length === 1) {
      return data[0] ?? null;
    }

    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      "Solo Plus repository expected at most one row.",
    );
  }

  return data;
}

type ZeroOrOneQueryResponse = {
  data: unknown;
  error: SupabaseLikeError | null;
  count?: unknown;
  status?: unknown;
  statusText?: unknown;
};

function assertCaseMerchantMatches(
  caseRecord: SoloPlusCaseRecord,
  merchantId: string,
): SoloPlusCaseRecord {
  if (caseRecord.merchantId !== merchantId) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      "Solo Plus repository rejected a cross-merchant active case.",
    );
  }

  return caseRecord;
}

function assertActiveCaseRowHasMerchantId(row: unknown): unknown {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      "Solo Plus repository mapping rejected merchant_id.",
    );
  }

  const candidate = row as Record<string, unknown>;
  if (!hasNonEmptyString(candidate.merchant_id)) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      "Solo Plus repository mapping rejected merchant_id.",
    );
  }

  return row;
}

async function callBundlePayloadRpc(
  client: SoloPlusSupabaseClientLike,
  caseId: string,
): Promise<SoloPlusRpcPayload | null> {
  const { data, error } = await client.rpc(CASE_BUNDLE_PAYLOAD_RPC, {
    p_case_id: caseId,
  });

  if (error) {
    wrapSupabaseError(error);
  }

  if (data == null) {
    return null;
  }

  return assertRpcPayload(data);
}

async function readCaseThroughBundlePayload(
  client: SoloPlusSupabaseClientLike,
  caseId: string,
): Promise<SoloPlusCaseRecord | null> {
  const payload = await callBundlePayloadRpc(client, caseId);
  const bundle = payload == null ? null : mapCaseBundlePayload(payload);
  return bundle?.caseRecord ?? null;
}

async function readCaseDirectly(
  client: SoloPlusSupabaseClientLike,
  caseId: string,
): Promise<SoloPlusCaseRecord | null> {
  const row = await maybeSingle(
    client.from("solo_plus_cases").select("*").eq("id", caseId),
  );

  return row == null ? null : mapCaseRow(row);
}

export async function readSoloPlusCaseBundle(
  client: SoloPlusSupabaseClientLike,
  caseId: string,
): Promise<SoloPlusCaseBundleRecord | null> {
  const payload = await callBundlePayloadRpc(client, caseId);
  return payload == null ? null : mapCaseBundlePayload(payload);
}

async function readSoloPlusRequirementsThroughBundle(
  client: SoloPlusSupabaseClientLike,
  caseId: string,
): Promise<readonly SoloPlusCaseRequirementRecord[] | null> {
  const bundle = await readSoloPlusCaseBundle(client, caseId);
  return bundle?.requirements ?? null;
}

async function many(
  promiseLike: SupabaseLikeQueryBuilder,
): Promise<unknown[]> {
  const { data, error } = await (promiseLike as unknown as Promise<{
    data: unknown;
    error: SupabaseLikeError | null;
  }>);
  if (error) {
    wrapSupabaseError(error);
  }

  if (!Array.isArray(data)) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      "Solo Plus repository expected an array result.",
    );
  }

  return data;
}

async function loadAdminMerchantsById(
  client: SoloPlusSupabaseClientLike,
  merchantIds: readonly string[],
): Promise<Map<string, SoloPlusAdminCaseMerchantRecord>> {
  if (merchantIds.length === 0) {
    return new Map();
  }

  const rows = await many(
    client
      .from("merchants")
      .select("id, business_name, email, subscription_plan")
      .in("id", merchantIds),
  );

  return new Map(
    rows.map((row) => {
      const merchant = mapAdminMerchantRow(row);
      return [merchant.merchantId, merchant] as const;
    }),
  );
}

async function loadAdminRequirementsByCaseId(
  client: SoloPlusSupabaseClientLike,
  caseIds: readonly string[],
): Promise<Map<string, readonly SoloPlusCaseRequirementRecord[]>> {
  if (caseIds.length === 0) {
    return new Map();
  }

  const rows = await many(
    client
      .from("solo_plus_case_requirements")
      .select("*")
      .in("case_id", caseIds)
      .order("requirement_code", { ascending: true }),
  );

  const mappedRows = rows.map((row) => mapRequirementRow(row));
  const grouped = new Map<string, SoloPlusCaseRequirementRecord[]>();
  for (const row of mappedRows) {
    const current = grouped.get(row.caseId) ?? [];
    current.push(row);
    grouped.set(row.caseId, current);
  }

  return grouped;
}

async function loadLatestReviewDecisionEventsByCaseId(
  client: SoloPlusSupabaseClientLike,
  caseIds: readonly string[],
): Promise<Map<string, SoloPlusCaseEventRecord | null>> {
  if (caseIds.length === 0) {
    return new Map();
  }

  const rows = await many(
    client
      .from("solo_plus_case_events")
      .select("*")
      .in("case_id", caseIds)
      .in("event_type", [...REVIEW_DECISION_EVENT_TYPES])
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
  );

  const mappedRows = rows.map((row) => mapEventRow(row));
  const latestByCase = new Map<string, SoloPlusCaseEventRecord | null>();
  for (const row of mappedRows) {
    if (!latestByCase.has(row.caseId)) {
      latestByCase.set(row.caseId, row);
    }
  }

  for (const caseId of caseIds) {
    if (!latestByCase.has(caseId)) {
      latestByCase.set(caseId, null);
    }
  }

  return latestByCase;
}

async function loadAdminListRecords(
  client: SoloPlusSupabaseClientLike,
  caseRows: readonly unknown[],
): Promise<readonly SoloPlusAdminCaseListRecord[]> {
  const caseRecords = caseRows.map((row) => mapCaseRow(row));
  const merchantIds = [...new Set(caseRecords.map((record) => record.merchantId).filter(hasNonEmptyString))];
  const caseIds = caseRecords.map((record) => record.id);
  const [merchantMap, requirementsMap, latestReviewMap] = await Promise.all([
    loadAdminMerchantsById(client, merchantIds),
    loadAdminRequirementsByCaseId(client, caseIds),
    loadLatestReviewDecisionEventsByCaseId(client, caseIds),
  ]);

  return caseRecords.map((caseRecord) => ({
    caseRecord,
    merchant: caseRecord.merchantId ? merchantMap.get(caseRecord.merchantId) ?? null : null,
    requirements: requirementsMap.get(caseRecord.id) ?? [],
    latestReviewDecisionEvent: latestReviewMap.get(caseRecord.id) ?? null,
  }));
}

export function createSoloPlusSupabaseRepository(
  options: { client?: SoloPlusSupabaseClientLike } = {},
): SoloPlusCaseRepository {
  const client = options.client || createSoloPlusServiceRoleClient();

  return {
    async findCaseById(caseId: string): Promise<SoloPlusCaseRecord | null> {
      return readCaseDirectly(client, caseId);
    },

    async findCaseByIdempotencyKey(idempotencyKey: string): Promise<SoloPlusCaseRecord | null> {
      const row = await maybeSingle(
        client
          .from("solo_plus_cases")
          .select("*")
          .eq("idempotency_key", idempotencyKey),
      );

      return row == null ? null : mapCaseRow(row);
    },

    async findActiveCaseByMerchantId(merchantId: string): Promise<SoloPlusCaseRecord | null> {
      const query = client
          .from("solo_plus_cases")
          .select("*")
          .eq("merchant_id", merchantId)
          .in("case_status", SOLO_PLUS_ACTIVE_CASE_STATUSES)
          .order("created_at", { ascending: true })
          .limit(1);
      const result = await (query as unknown as Promise<ZeroOrOneQueryResponse>);
      if (result.error) {
        wrapSupabaseError(result.error);
      }

      const row = normalizeZeroOrOneResult(result.data);

      return row == null
        ? null
        : assertCaseMerchantMatches(mapCaseRow(assertActiveCaseRowHasMerchantId(row)), merchantId);
    },

    async findActiveCaseByOnboardingSessionId(
      onboardingSessionId: string,
    ): Promise<SoloPlusCaseRecord | null> {
      const row = await maybeSingle(
        client
          .from("solo_plus_cases")
          .select("*")
          .eq("flow_origin", "onboarding")
          .eq("onboarding_session_id", onboardingSessionId)
          .in("case_status", SOLO_PLUS_ACTIVE_CASE_STATUSES)
          .order("created_at", { ascending: true })
          .limit(1),
      );

      return row == null ? null : mapCaseRow(row);
    },

    async listRequirements(caseId: string): Promise<readonly SoloPlusCaseRequirementRecord[]> {
      try {
        const rows = await many(
          client
            .from("solo_plus_case_requirements")
            .select("*")
            .eq("case_id", caseId)
            .order("requirement_code", { ascending: true }),
        );

        return rows.map((row) => mapRequirementRow(row));
      } catch (error) {
        if (
          error instanceof SoloPlusSupabaseRepositoryError &&
          error.code === "SOLO_PLUS_ATOMIC_PERSISTENCE_UNAVAILABLE"
        ) {
          const requirements = await readSoloPlusRequirementsThroughBundle(client, caseId);
          if (requirements) {
            return requirements;
          }
        }

        throw error;
      }
    },

    async listSafeEvents(caseId: string): Promise<readonly SoloPlusCaseEventRecord[]> {
      const rows = await many(
        client
          .from("solo_plus_case_events")
          .select("*")
          .eq("case_id", caseId)
          .order("created_at", { ascending: true }),
      );

      return rows.map((row) => mapEventRow(row));
    },

    async findLatestReviewDecisionEvent(caseId: string): Promise<SoloPlusCaseEventRecord | null> {
      const row = await maybeSingle(
        client
          .from("solo_plus_case_events")
          .select("*")
          .eq("case_id", caseId)
          .in("event_type", [...REVIEW_DECISION_EVENT_TYPES])
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1),
      );

      return row == null ? null : mapEventRow(row);
    },

    async listAdminCases(input: SoloPlusAdminCaseListInput): Promise<SoloPlusAdminCaseListResult> {
      let merchantIdsFilter: readonly string[] | null = null;
      if (hasNonEmptyString(input.merchantSearch)) {
        const normalizedSearch = input.merchantSearch.trim();
        const merchantQuery = client
          .from("merchants")
          .select("id, business_name, email, subscription_plan");

        if (typeof merchantQuery.or === "function") {
          merchantQuery.or(
            [
              `business_name.ilike.%${normalizedSearch}%`,
              `email.ilike.%${normalizedSearch}%`,
            ].join(","),
          );
        }

        merchantQuery.limit(100);
        const merchantRows = await many(merchantQuery);
        const merchantIds = merchantRows
          .map((row) => mapAdminMerchantRow(row))
          .map((merchant) => merchant.merchantId);

        if (merchantIds.length === 0) {
          return { items: [], nextCursor: null };
        }

        merchantIdsFilter = merchantIds;
      }

      const caseQuery = client
        .from("solo_plus_cases")
        .select("*")
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false });

      if (input.caseStatus) {
        caseQuery.eq("case_status", input.caseStatus);
      }
      if (input.flowOrigin) {
        caseQuery.eq("flow_origin", input.flowOrigin);
      }
      if (input.paymentStatus) {
        caseQuery.eq("payment_status", input.paymentStatus);
      }
      if (input.refundStatus) {
        caseQuery.eq("refund_status", input.refundStatus);
      }
      if (merchantIdsFilter) {
        caseQuery.in("merchant_id", merchantIdsFilter);
      }
      if (input.cursor) {
        if (typeof caseQuery.or === "function") {
          caseQuery.or(
            `updated_at.lt.${input.cursor.updatedAt},and(updated_at.eq.${input.cursor.updatedAt},id.lt.${input.cursor.caseId})`,
          );
        }
      }

      caseQuery.limit(input.limit + 1);

      const caseRows = await many(caseQuery);
      const pageRows = caseRows.slice(0, input.limit);
      const items = await loadAdminListRecords(client, pageRows);
      const lastItem = items.at(-1)?.caseRecord ?? null;

      return {
        items,
        nextCursor:
          caseRows.length > input.limit && lastItem
            ? {
                updatedAt: lastItem.updatedAt,
                caseId: lastItem.id,
              }
            : null,
      };
    },

    async getAdminCaseDetail(caseId: string): Promise<SoloPlusAdminCaseDetailRecord | null> {
      const caseRecord = await readCaseDirectly(client, caseId);
      if (!caseRecord) {
        return null;
      }

      const [merchantMap, requirementsMap, latestReviewMap] = await Promise.all([
        loadAdminMerchantsById(
          client,
          caseRecord.merchantId ? [caseRecord.merchantId] : [],
        ),
        loadAdminRequirementsByCaseId(client, [caseRecord.id]),
        loadLatestReviewDecisionEventsByCaseId(client, [caseRecord.id]),
      ]);

      return {
        caseRecord,
        merchant: caseRecord.merchantId ? merchantMap.get(caseRecord.merchantId) ?? null : null,
        requirements: requirementsMap.get(caseRecord.id) ?? [],
        latestReviewDecisionEvent: latestReviewMap.get(caseRecord.id) ?? null,
      };
    },

    async listAdminCaseEvents(
      caseId: string,
      input: SoloPlusAdminCaseEventListInput,
    ): Promise<SoloPlusAdminCaseEventListResult> {
      const eventsQuery = client
        .from("solo_plus_case_events")
        .select("*")
        .eq("case_id", caseId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

      if (input.cursor && typeof eventsQuery.or === "function") {
        eventsQuery.or(
          `created_at.lt.${input.cursor.createdAt},and(created_at.eq.${input.cursor.createdAt},id.lt.${input.cursor.eventId})`,
        );
      }

      eventsQuery.limit(input.limit + 1);

      const rows = await many(eventsQuery);
      const eventRecords = rows.slice(0, input.limit).map((row) => mapEventRow(row));
      const lastItem = eventRecords.at(-1) ?? null;

      return {
        items: eventRecords,
        nextCursor:
          rows.length > input.limit && lastItem
            ? {
                createdAt: lastItem.createdAt,
                eventId: lastItem.id,
              }
            : null,
      };
    },

    async createCaseWithRequirementsAndEvent(
      input: SoloPlusCaseCreateAtomicInput,
    ): Promise<SoloPlusCaseCreateAtomicResult> {
      const { data, error } = await client.rpc(CREATE_CASE_BUNDLE_RPC, {
        p_flow_origin: input.intent.flowOrigin,
        p_merchant_id: input.intent.merchantId,
        p_onboarding_session_id: input.intent.onboardingSessionId,
        p_source_plan: input.intent.sourcePlan,
        p_target_plan: input.intent.targetPlan,
        p_expected_amount: input.intent.expectedAmount,
        p_payment_currency: input.intent.paymentCurrency,
        p_requirements_policy_version: input.intent.requirementsPolicyVersion,
        p_requirements_snapshot: input.intent.requirementsSnapshot,
        p_active_plan_snapshot: input.intent.activePlanSnapshot,
        p_idempotency_key: input.caseRecord.idempotencyKey,
        p_actor_type: input.event.actorType,
        p_actor_id: input.event.actorId,
        p_access_mode:
          typeof input.event.newState.accessMode === "string"
            ? input.event.newState.accessMode
            : "public",
      });

      if (error) {
        wrapSupabaseError(error);
      }

      return mapCreateResult(data);
    },

    async attachMerchantToOnboardingCase(
      input: SoloPlusAttachMerchantAtomicParams,
    ): Promise<SoloPlusAttachMerchantAtomicResult> {
      const { data, error } = await client.rpc(ATTACH_ONBOARDING_MERCHANT_RPC, {
        p_case_id: input.caseId,
        p_onboarding_session_id: input.onboardingSessionId,
        p_merchant_id: input.merchantId,
        p_expected_row_version: input.expectedRowVersion,
        p_request_idempotency_key: input.requestIdempotencyKey,
        p_actor_type: input.event.actorType,
        p_actor_id: input.event.actorId,
      });

      if (error) {
        wrapSupabaseError(error);
      }

      return mapAttachResult(data);
    },

    async transitionCaseStatus(
      input: SoloPlusCaseTransitionAtomicParams,
    ): Promise<SoloPlusCaseTransitionAtomicResult> {
      if (
        input.expectedCurrentStatus === "draft" &&
        input.targetStatus === "awaiting_payment"
      ) {
        assertAwaitingPaymentTransitionInput(input);

        const { data, error } = await client.rpc(MARK_AWAITING_PAYMENT_RPC, {
          p_case_id: input.caseId,
          p_expected_row_version: input.expectedRowVersion,
          p_request_idempotency_key: input.requestIdempotencyKey,
          p_actor_type: input.event.actorType,
          p_actor_id: input.event.actorId,
        });

        if (error) {
          wrapSupabaseError(error);
        }

        return mapTransitionResult(data);
      }

      const reviewDecision = assertReviewTransitionInput(input);
      const { data, error } = await client.rpc(REVIEW_CASE_RPC, {
        p_case_id: input.caseId,
        p_expected_row_version: input.expectedRowVersion,
        p_request_idempotency_key: input.requestIdempotencyKey,
        p_decision: reviewDecision,
        p_reviewer_admin_id: input.event.actorId,
        p_reason: input.event.reason,
        p_policy_version: input.event.policyVersion,
      });

      if (error) {
        wrapSupabaseError(error);
      }

      return mapTransitionResult(data);
    },

    async activateSoloPlusCase(
      input: SoloPlusCaseActivationAtomicParams,
    ): Promise<SoloPlusCaseActivationAtomicResult> {
      assertActivationInput(input);

      const { data, error } = await client.rpc(ACTIVATE_CASE_RPC, {
        p_case_id: input.caseId,
        p_expected_row_version: input.expectedRowVersion,
        p_request_idempotency_key: input.requestIdempotencyKey,
        p_activator_admin_id: input.activatorAdminId,
        p_policy_version: input.policyVersion ?? null,
      });

      if (error) {
        wrapSupabaseError(error);
      }

      return mapActivationResult(data);
    },

    async upsertCaseRequirements(
      caseId: string,
      requirements: readonly SoloPlusCaseRequirementRecord[],
    ): Promise<readonly SoloPlusCaseRequirementRecord[]> {
      if (requirements.some((requirement) => requirement.caseId !== caseId)) {
        throw new SoloPlusSupabaseRepositoryError(
          "SOLO_PLUS_ATOMIC_PERSISTENCE_UNAVAILABLE",
          "Solo Plus requirement persistence rejected a cross-case payload.",
        );
      }

      if (requirements.length > 0) {
        const { error } = await client
          .from("solo_plus_case_requirements")
          .upsert(
            requirements.map((requirement) => mapRequirementRecordToRow(requirement)),
            { onConflict: "case_id,requirement_code" },
          );

        if (error) {
          wrapSupabaseError(error);
        }
      }

      return this.listRequirements(caseId);
    },
  };
}

export const soloPlusSupabaseRpcNames = {
  caseBundlePayload: CASE_BUNDLE_PAYLOAD_RPC,
  createCaseBundle: CREATE_CASE_BUNDLE_RPC,
  attachOnboardingMerchant: ATTACH_ONBOARDING_MERCHANT_RPC,
  markAwaitingPayment: MARK_AWAITING_PAYMENT_RPC,
  reviewCase: REVIEW_CASE_RPC,
  activateCase: ACTIVATE_CASE_RPC,
} as const;
