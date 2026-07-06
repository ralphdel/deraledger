import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  normalizeSoloPlusAmount,
  type SoloPlusAmount,
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

const UUID_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type SupabaseLikeError = {
  message: string;
};

type SupabaseLikeResponse<T> = Promise<{
  data: T;
  error: SupabaseLikeError | null;
}>;

type SupabaseLikeQueryBuilder = {
  select(columns: string): SupabaseLikeQueryBuilder;
  eq(column: string, value: unknown): SupabaseLikeQueryBuilder;
  in(column: string, values: readonly unknown[]): SupabaseLikeQueryBuilder;
  order(column: string, options?: { ascending?: boolean }): SupabaseLikeQueryBuilder;
  limit(count: number): SupabaseLikeQueryBuilder;
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

function assertAmount(value: unknown, field: string): SoloPlusAmount {
  if (typeof value !== "string") {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      `Solo Plus repository mapping rejected ${field}.`,
    );
  }

  try {
    return normalizeSoloPlusAmount(value);
  } catch {
    // fall through to the same safe mapping error shape
  }

  throw new SoloPlusSupabaseRepositoryError(
    "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
    `Solo Plus repository mapping rejected ${field}.`,
  );
}

function assertNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      `Solo Plus repository mapping rejected ${field}.`,
    );
  }

  return value;
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

  if (value === "paystack" || value === "monnify") {
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
    rejectedAt: assertTimestamp(candidate.rejected_at, "rejected_at", true),
    reopenedAt: assertTimestamp(candidate.reopened_at, "reopened_at", true),
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

function assertRpcPayload(value: unknown): SoloPlusRpcPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SoloPlusSupabaseRepositoryError(
      "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
      "Solo Plus repository received a malformed RPC payload.",
    );
  }

  return value as SoloPlusRpcPayload;
}

function mapCreateResult(value: unknown): SoloPlusCaseCreateAtomicResult {
  const payload = assertRpcPayload(value);
  const kind = assertText(payload.kind, "rpc.kind");

  if (kind === "created") {
    const event = payload.event;
    if (event == null) {
      throw new SoloPlusSupabaseRepositoryError(
        "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
        "Solo Plus repository received a malformed RPC payload.",
      );
    }

    if (!Array.isArray(payload.requirements)) {
      throw new SoloPlusSupabaseRepositoryError(
        "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
        "Solo Plus repository received a malformed RPC payload.",
      );
    }

    return {
      kind,
      caseRecord: mapCaseRow(payload.case),
      requirements: payload.requirements.map((row) => mapRequirementRow(row)),
      event: mapEventRow(event),
    };
  }

  if (kind === "idempotent_replay" || kind === "existing_active_case") {
    return {
      kind,
      existingCase: mapCaseRow(payload.case),
    };
  }

  if (kind === "idempotency_conflict" || kind === "active_case_conflict") {
    return {
      kind,
      existingCase: mapCaseRow(payload.case),
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

  if (kind === "updated") {
    return {
      kind,
      caseRecord: mapCaseRow(payload.case),
      event: mapEventRow(payload.event),
    };
  }

  if (kind === "idempotent_replay") {
    return {
      kind,
      caseRecord: mapCaseRow(payload.case),
      event: payload.event == null ? null : mapEventRow(payload.event),
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
      currentCase: mapCaseRow(payload.case),
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

  if (kind === "updated") {
    return {
      kind,
      caseRecord: mapCaseRow(payload.case),
      event: mapEventRow(payload.event),
    };
  }

  if (kind === "idempotent_replay") {
    return {
      kind,
      caseRecord: mapCaseRow(payload.case),
      event: payload.event == null ? null : mapEventRow(payload.event),
    };
  }

  if (kind === "not_found") {
    return { kind };
  }

  if (kind === "idempotency_conflict" || kind === "version_conflict" || kind === "state_conflict") {
    return {
      kind,
      currentCase: mapCaseRow(payload.case),
    } as SoloPlusCaseTransitionAtomicResult;
  }

  throw new SoloPlusSupabaseRepositoryError(
    "SOLO_PLUS_REPOSITORY_MAPPING_ERROR",
    "Solo Plus repository received an unknown transition RPC outcome.",
  );
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

async function maybeSingle(
  query: SupabaseLikeQueryBuilder,
): Promise<unknown | null> {
  const { data, error } = await query.maybeSingle();
  if (error) {
    wrapSupabaseError(error);
  }
  return data;
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
  if (payload == null || payload.case == null) {
    return null;
  }

  return mapCaseRow(payload.case);
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

export function createSoloPlusSupabaseRepository(
  options: { client?: SoloPlusSupabaseClientLike } = {},
): SoloPlusCaseRepository {
  const client = options.client || createSoloPlusServiceRoleClient();

  return {
    async findCaseById(caseId: string): Promise<SoloPlusCaseRecord | null> {
      const row = await maybeSingle(
        client.from("solo_plus_cases").select("id").eq("id", caseId),
      );

      if (row == null) {
        return null;
      }

      return readCaseThroughBundlePayload(client, assertUuidLike((row as SoloPlusCaseRow).id, "id")!);
    },

    async findCaseByIdempotencyKey(idempotencyKey: string): Promise<SoloPlusCaseRecord | null> {
      const row = await maybeSingle(
        client
          .from("solo_plus_cases")
          .select("id")
          .eq("idempotency_key", idempotencyKey),
      );

      if (row == null) {
        return null;
      }

      return readCaseThroughBundlePayload(client, assertUuidLike((row as SoloPlusCaseRow).id, "id")!);
    },

    async findActiveCaseByMerchantId(merchantId: string): Promise<SoloPlusCaseRecord | null> {
      const row = await maybeSingle(
        client
          .from("solo_plus_cases")
          .select("id")
          .eq("merchant_id", merchantId)
          .in("case_status", SOLO_PLUS_ACTIVE_CASE_STATUSES)
          .order("created_at", { ascending: true })
          .limit(1),
      );

      if (row == null) {
        return null;
      }

      return readCaseThroughBundlePayload(client, assertUuidLike((row as SoloPlusCaseRow).id, "id")!);
    },

    async findActiveCaseByOnboardingSessionId(
      onboardingSessionId: string,
    ): Promise<SoloPlusCaseRecord | null> {
      const row = await maybeSingle(
        client
          .from("solo_plus_cases")
          .select("id")
          .eq("flow_origin", "onboarding")
          .eq("onboarding_session_id", onboardingSessionId)
          .in("case_status", SOLO_PLUS_ACTIVE_CASE_STATUSES)
          .order("created_at", { ascending: true })
          .limit(1),
      );

      if (row == null) {
        return null;
      }

      return readCaseThroughBundlePayload(client, assertUuidLike((row as SoloPlusCaseRow).id, "id")!);
    },

    async listRequirements(caseId: string): Promise<readonly SoloPlusCaseRequirementRecord[]> {
      const rows = await many(
        client
          .from("solo_plus_case_requirements")
          .select("*")
          .eq("case_id", caseId)
          .order("requirement_code", { ascending: true }),
      );

      return rows.map((row) => mapRequirementRow(row));
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
    },
  };
}

export const soloPlusSupabaseRpcNames = {
  caseBundlePayload: CASE_BUNDLE_PAYLOAD_RPC,
  createCaseBundle: CREATE_CASE_BUNDLE_RPC,
  attachOnboardingMerchant: ATTACH_ONBOARDING_MERCHANT_RPC,
  markAwaitingPayment: MARK_AWAITING_PAYMENT_RPC,
} as const;
