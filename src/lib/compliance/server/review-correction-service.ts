import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { evaluateBusiness, evaluateSoloLite, type BusinessDiagnostic } from "../policy-adapters/adapters";
import type { PolicyDiagnostic } from "../policy-adapters/contract";
import { fromLegacyBusinessSnapshot, fromLegacyLiteSnapshot, type LegacyMerchantSnapshot, type LegacyRegistrySnapshot } from "../policy-adapters/source-snapshots";
import {
  DRAFT_REVIEW_POLICY_VERSION,
  type ReviewCorrectionReasonCode,
  type ReviewFindingSummary,
  type ReviewHistoryItem,
  type ReviewMutationKind,
  type ReviewPlan,
  type ReviewReadModel,
  type MerchantReviewState,
  type ReviewSubmissionEligibilityReason,
  isReviewCorrectionReasonCode,
  isUuid,
  validFindingCodesForPlan,
} from "../review-correction-contract";

const REVIEW_COLUMNS = "id,merchant_id,profile_id,review_type,target_plan_code,review_status,evidence_snapshot,decision_reason_code,policy_version,submitted_at,reviewed_at,idempotency_key,row_version";
const MERCHANT_COLUMNS = "id,user_id,business_name,trading_name,owner_name,email,phone,subscription_plan,merchant_tier,verification_status,bvn_status,selfie_status,cac_document_url,utility_document_url,cac_status,utility_status,business_street,business_city,business_state,business_country,verification_step_state,business_registry_snapshot_id,relationship_claim";
const EVENT_COLUMNS = "event_type,reason_code,metadata,created_at";

type DatabaseError = { message?: string } | null;

type MerchantRow = {
  id: string;
  user_id: string | null;
  business_name: string | null;
  trading_name: string | null;
  owner_name: string | null;
  email: string | null;
  phone: string | null;
  subscription_plan: string | null;
  merchant_tier: string | null;
  verification_status: string | null;
  bvn_status: string | null;
  selfie_status: string | null;
  cac_document_url: string | null;
  utility_document_url: string | null;
  cac_status: string | null;
  utility_status: string | null;
  business_street: string | null;
  business_city: string | null;
  business_state: string | null;
  business_country: string | null;
  verification_step_state: LegacyMerchantSnapshot["verification_step_state"];
  business_registry_snapshot_id: string | null;
  relationship_claim: string | null;
};

type ProfileRow = { id: string; merchant_id: string; plan_code: string; row_version: number };
type WorkspaceRow = { merchant_id: string; workspace_id: string };
type ReviewRow = {
  id: string;
  merchant_id: string;
  profile_id: string;
  review_type: string;
  target_plan_code: string;
  review_status: string;
  evidence_snapshot: unknown;
  decision_reason_code: string | null;
  policy_version: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  idempotency_key: string | null;
  row_version: number;
};
type EventRow = {
  event_type: string;
  reason_code: string | null;
  metadata: unknown;
  created_at: string;
};
type MutationReceiptRow = {
  event_type: string;
  source_id: string | null;
  actor_id: string | null;
  expected_row_version: number | null;
  metadata: unknown;
};
type RegistryRow = {
  id: string;
  business_type: string | null;
  registered_name: string | null;
  registration_number: string | null;
  registration_status: string | null;
  directors_json: unknown;
};

export type ReviewCorrectionRpcResult = {
  kind: ReviewMutationKind;
  review_id?: string;
  new_review_id?: string;
  row_version?: number;
};

export type ReviewCorrectionRepository = {
  findOwnedMerchant(userId: string, merchantId: string): Promise<MerchantRow | null>;
  findMerchant(merchantId: string): Promise<MerchantRow | null>;
  findMerchants(merchantIds: readonly string[]): Promise<MerchantRow[]>;
  findCanonicalWorkspace(merchantId: string): Promise<WorkspaceRow | null>;
  findProfile(merchantId: string): Promise<ProfileRow | null>;
  findReview(reviewId: string): Promise<ReviewRow | null>;
  findCurrentReview(merchantId: string): Promise<ReviewRow | null>;
  listOpenReviews(): Promise<ReviewRow[]>;
  findReviewEvents(merchantId: string, reviewId: string): Promise<EventRow[]>;
  findMutationReceipt(merchantId: string, idempotencyKey: string): Promise<MutationReceiptRow | null>;
  findRegistrySnapshot(snapshotId: string | null): Promise<RegistryRow | null>;
  submitInitialReview(args: Record<string, unknown>): Promise<ReviewCorrectionRpcResult>;
  requestCorrection(args: Record<string, unknown>): Promise<ReviewCorrectionRpcResult>;
  resubmitCorrection(args: Record<string, unknown>): Promise<ReviewCorrectionRpcResult>;
};

export class ReviewCorrectionServiceError extends Error {
  readonly code: "CONFIGURATION_ERROR" | "DATA_ACCESS_ERROR" | "NOT_FOUND" | "FORBIDDEN" | "INVALID_STATE" | "INVALID_EVIDENCE";

  constructor(code: ReviewCorrectionServiceError["code"]) {
    super(code);
    this.name = "ReviewCorrectionServiceError";
    this.code = code;
  }
}

function dataOrThrow<T>(data: T | null, error: DatabaseError): T | null {
  if (error) throw new ReviewCorrectionServiceError("DATA_ACCESS_ERROR");
  return data;
}

function createServiceRoleClient(environment: NodeJS.ProcessEnv): SupabaseClient {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim() || environment.SUPABASE_URL?.trim();
  const key = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new ReviewCorrectionServiceError("CONFIGURATION_ERROR");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function parseRpcResult(value: unknown): ReviewCorrectionRpcResult {
  if (!isRecord(value) || typeof value.kind !== "string" || ![
    "applied", "already_processed", "version_conflict", "state_conflict", "evidence_conflict",
    "actor_unauthorized", "reviewer_unauthorized", "unsupported_isolation", "invalid_transition",
  ].includes(value.kind)) {
    throw new ReviewCorrectionServiceError("DATA_ACCESS_ERROR");
  }
  if (
    (value.review_id !== undefined && !isUuid(value.review_id))
    || (value.new_review_id !== undefined && !isUuid(value.new_review_id))
    || (value.row_version !== undefined && !isPositiveSafeInteger(value.row_version))
  ) {
    throw new ReviewCorrectionServiceError("DATA_ACCESS_ERROR");
  }
  return {
    kind: value.kind as ReviewMutationKind,
    review_id: value.review_id as string | undefined,
    new_review_id: value.new_review_id as string | undefined,
    row_version: value.row_version as number | undefined,
  };
}

export function createSupabaseReviewCorrectionRepository(
  environment: NodeJS.ProcessEnv = process.env,
): ReviewCorrectionRepository {
  const client = createServiceRoleClient(environment);
  const one = async <T>(query: PromiseLike<{ data: unknown; error: DatabaseError }>): Promise<T | null> => {
    const { data, error } = await query;
    return dataOrThrow(data as T | null, error);
  };
  const many = async <T>(query: PromiseLike<{ data: unknown; error: DatabaseError }>): Promise<T[]> => {
    const { data, error } = await query;
    return dataOrThrow((data ?? []) as T[], error) ?? [];
  };
  const call = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new ReviewCorrectionServiceError("DATA_ACCESS_ERROR");
    return parseRpcResult(data);
  };

  return {
    findOwnedMerchant: (userId, merchantId) => one<MerchantRow>(client.from("merchants").select(MERCHANT_COLUMNS).eq("id", merchantId).eq("user_id", userId).maybeSingle()),
    findMerchant: (merchantId) => one<MerchantRow>(client.from("merchants").select(MERCHANT_COLUMNS).eq("id", merchantId).maybeSingle()),
    findMerchants: (merchantIds) => merchantIds.length === 0 ? Promise.resolve([]) : many<MerchantRow>(client.from("merchants").select(MERCHANT_COLUMNS).in("id", [...merchantIds])),
    findCanonicalWorkspace: (merchantId) => one<WorkspaceRow>(client.from("merchant_canonical_workspaces").select("merchant_id,workspace_id").eq("merchant_id", merchantId).maybeSingle()),
    findProfile: (merchantId) => one<ProfileRow>(client.from("merchant_compliance_profiles").select("id,merchant_id,plan_code,row_version").eq("merchant_id", merchantId).maybeSingle()),
    findReview: (reviewId) => one<ReviewRow>(client.from("merchant_compliance_reviews").select(REVIEW_COLUMNS).eq("id", reviewId).maybeSingle()),
    findCurrentReview: (merchantId) => one<ReviewRow>(client.from("merchant_compliance_reviews").select(REVIEW_COLUMNS).eq("merchant_id", merchantId).eq("policy_version", DRAFT_REVIEW_POLICY_VERSION).in("review_status", ["pending", "needs_attention"]).in("target_plan_code", ["solo_lite", "business"]).order("submitted_at", { ascending: false }).limit(1).maybeSingle()),
    listOpenReviews: () => many<ReviewRow>(client.from("merchant_compliance_reviews").select(REVIEW_COLUMNS).eq("policy_version", DRAFT_REVIEW_POLICY_VERSION).in("review_status", ["pending", "needs_attention"]).in("target_plan_code", ["solo_lite", "business"]).order("submitted_at", { ascending: true }).limit(200)),
    findReviewEvents: (merchantId, reviewId) => many<EventRow>(client.from("merchant_compliance_events").select(EVENT_COLUMNS).eq("merchant_id", merchantId).eq("source_id", reviewId).in("event_type", ["phase2c_draft_review_submit_v1", "phase2c_draft_review_needs_attention_v1", "phase2c_draft_review_superseded_v1"]).order("created_at", { ascending: true })),
    findMutationReceipt: (merchantId, idempotencyKey) => one<MutationReceiptRow>(client.from("merchant_compliance_events").select("event_type,source_id,actor_id,expected_row_version,metadata").eq("merchant_id", merchantId).eq("idempotency_key", idempotencyKey).maybeSingle()),
    findRegistrySnapshot: (snapshotId) => snapshotId ? one<RegistryRow>(client.from("business_registry_snapshots").select("id,business_type,registered_name,registration_number,registration_status,directors_json").eq("id", snapshotId).maybeSingle()) : Promise.resolve(null),
    submitInitialReview: (args) => call("submit_draft_plan_review_v1", args),
    requestCorrection: (args) => call("request_draft_plan_review_correction_v1", args),
    resubmitCorrection: (args) => call("resubmit_corrected_draft_plan_review_v1", args),
  };
}

function canonicalPlan(review: ReviewRow): ReviewPlan | null {
  if (review.target_plan_code === "solo_lite" && review.review_type === "solo_lite") return "solo_lite";
  if (review.target_plan_code === "business" && review.review_type === "business_kyb") return "business";
  return null;
}

function canonicalMerchantPlan(value: string | null): ReviewPlan | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "solo_lite" || normalized === "individual") return "solo_lite";
  if (normalized === "business" || normalized === "corporate") return "business";
  return null;
}

function isOpenReview(review: ReviewRow): boolean {
  return review.review_status === "pending" || review.review_status === "needs_attention";
}

const EVIDENCE_STATUSES = new Set([
  "verified", "failed", "missing", "unknown", "ambiguous", "not_applicable", "needs_review",
]);

function safeFindingSummaries(snapshot: unknown, plan: ReviewPlan): ReviewFindingSummary[] {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.findings)) return [];
  const allowed = new Set(validFindingCodesForPlan(plan));
  return snapshot.findings.flatMap((finding) => {
    if (
      !isRecord(finding)
      || typeof finding.code !== "string"
      || !allowed.has(finding.code)
      || typeof finding.status !== "string"
      || !EVIDENCE_STATUSES.has(finding.status)
      || typeof finding.reasonCode !== "string"
      || !/^[a-z][a-z0-9_]{1,63}$/.test(finding.reasonCode)
    ) return [];
    return [{ code: finding.code, status: finding.status, reasonCode: finding.reasonCode }];
  });
}

function requestedCodes(events: readonly EventRow[], plan: ReviewPlan): string[] {
  const rmi = [...events].reverse().find((event) => event.event_type === "phase2c_draft_review_needs_attention_v1");
  if (!rmi || !isRecord(rmi.metadata) || !Array.isArray(rmi.metadata.requested_finding_codes)) return [];
  const allowed = new Set(validFindingCodesForPlan(plan));
  return [...new Set(rmi.metadata.requested_finding_codes.filter(
    (code): code is string => typeof code === "string" && allowed.has(code),
  ))].sort();
}

function history(events: readonly EventRow[]): ReviewHistoryItem[] {
  return events.flatMap((event) => {
    const action = event.event_type === "phase2c_draft_review_submit_v1" ? "submitted"
      : event.event_type === "phase2c_draft_review_needs_attention_v1" ? "correction_requested"
        : event.event_type === "phase2c_draft_review_superseded_v1" ? "superseded" : null;
    return action ? [{ action, occurredAt: event.created_at, reasonCode: event.reason_code }] : [];
  });
}

function toReadModel(review: ReviewRow, merchant: MerchantRow, events: readonly EventRow[]): ReviewReadModel {
  const plan = canonicalPlan(review);
  if (
    !plan
    || merchant.id !== review.merchant_id
    || canonicalMerchantPlan(merchant.subscription_plan) !== plan
    || (review.review_status !== "pending" && review.review_status !== "needs_attention")
    || !review.submitted_at
    || review.policy_version !== DRAFT_REVIEW_POLICY_VERSION
    || !isPositiveSafeInteger(review.row_version)
  ) {
    throw new ReviewCorrectionServiceError("INVALID_STATE");
  }
  const reason = review.decision_reason_code;
  const acceptedReason = isReviewCorrectionReasonCode(reason) ? reason : null;
  const requestedFindingCodes = requestedCodes(events, plan);
  if (review.review_status === "needs_attention" && (!acceptedReason || requestedFindingCodes.length === 0)) {
    throw new ReviewCorrectionServiceError("INVALID_STATE");
  }
  return {
    reviewId: review.id,
    merchantId: review.merchant_id,
    merchantName: merchant.business_name?.trim() || merchant.trading_name?.trim() || "Merchant",
    plan,
    planLabel: plan === "solo_lite" ? "Solo Lite" : "Business",
    status: review.review_status,
    submittedAt: review.submitted_at,
    reviewedAt: review.reviewed_at,
    policyVersion: review.policy_version,
    rowVersion: review.row_version,
    reasonCode: acceptedReason,
    requestedFindingCodes,
    findings: safeFindingSummaries(review.evidence_snapshot, plan),
    history: history(events),
  };
}

function addressFromMerchant(merchant: MerchantRow): string | null {
  const parts = [merchant.business_street, merchant.business_city, merchant.business_state, merchant.business_country]
    .map((part) => part?.trim()).filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : null;
}

function safeDirectors(value: unknown): readonly { name?: string; role?: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    return [{
      name: typeof item.name === "string" ? item.name : undefined,
      role: typeof item.role === "string" ? item.role : undefined,
    }];
  });
}

function adapterMerchant(merchant: MerchantRow): LegacyMerchantSnapshot {
  return {
    id: merchant.id,
    row_version: null,
    owner_name: merchant.owner_name,
    email: merchant.email,
    phone: merchant.phone,
    business_name: merchant.business_name,
    trading_name: merchant.trading_name,
    subscription_plan: merchant.subscription_plan,
    merchant_tier: merchant.merchant_tier,
    verification_status: merchant.verification_status,
    bvn_status: merchant.bvn_status,
    selfie_status: merchant.selfie_status,
    cac_status: merchant.cac_status,
    utility_status: merchant.utility_status,
    cac_document_url: merchant.cac_document_url,
    utility_document_url: merchant.utility_document_url,
    verification_step_state: merchant.verification_step_state,
    relationship_claim: merchant.relationship_claim,
    declared_address: addressFromMerchant(merchant),
  };
}

function adapterRegistry(registry: RegistryRow | null): LegacyRegistrySnapshot | null {
  return registry ? {
    id: registry.id,
    business_type: registry.business_type,
    registered_name: registry.registered_name,
    registration_number: registry.registration_number,
    registration_status: registry.registration_status,
    registered_address: null,
    directors_json: safeDirectors(registry.directors_json),
    verified_at: null,
  } : null;
}

function evidenceSnapshot(diagnostic: PolicyDiagnostic | BusinessDiagnostic, evaluatedAt: string) {
  return {
    schemaVersion: "phase2c-review-v1",
    policyId: diagnostic.policy.policyId,
    policyVersion: diagnostic.policy.policyVersion,
    policyStatus: diagnostic.policy.policyStatus,
    adapterVersion: "2c-2b-v1",
    evaluatedAt,
    findings: diagnostic.findings.map((finding) => ({
      code: finding.code,
      status: finding.status,
      reasonCode: finding.reasonCode,
      sourceType: finding.source?.sourceType ?? null,
      sourceId: finding.source?.sourceId ?? null,
      sourceVersion: finding.source?.sourceVersion ?? null,
    })),
  };
}

export function buildCorrectedDraftEvidenceSnapshot(
  merchant: MerchantRow,
  registry: RegistryRow | null,
  evaluatedAt: string,
): Record<string, unknown> {
  const legacyMerchant = adapterMerchant(merchant);
  const plan = canonicalMerchantPlan(merchant.subscription_plan);
  if (!plan) throw new ReviewCorrectionServiceError("INVALID_STATE");
  const diagnostic = plan === "business"
    ? evaluateBusiness(fromLegacyBusinessSnapshot(legacyMerchant, adapterRegistry(registry), evaluatedAt))
    : evaluateSoloLite(fromLegacyLiteSnapshot(legacyMerchant, evaluatedAt));
  return evidenceSnapshot(diagnostic, evaluatedAt);
}

const SNAPSHOT_KEYS = new Set([
  "schemaVersion", "policyId", "policyVersion", "policyStatus", "adapterVersion", "evaluatedAt", "findings",
]);
const FINDING_KEYS = new Set(["code", "status", "reasonCode", "sourceType", "sourceId", "sourceVersion"]);
const EVIDENCE_REASON_CODES = new Set([
  "evidence_verified", "evidence_failed", "evidence_missing", "evidence_unknown", "evidence_ambiguous",
  "evidence_needs_review", "evidence_revoked", "evidence_expired", "evidence_time_indeterminate",
  "positive_evidence_provenance_missing", "unapproved_non_applicability",
]);
const EVIDENCE_SOURCE_TYPES = new Set([
  "merchant", "verification_log", "verification_step", "registry_snapshot", "director_verification",
  "affiliation", "document", "settlement_account", "provider_mapping", "review", "risk_review", "screening",
]);

function hasExactKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}

function isValidDraftSnapshot(snapshot: unknown, plan: ReviewPlan): snapshot is Record<string, unknown> {
  if (!isRecord(snapshot) || !hasExactKeys(snapshot, SNAPSHOT_KEYS)) return false;
  if (
    snapshot.schemaVersion !== "phase2c-review-v1"
    || snapshot.policyId !== (plan === "solo_lite" ? "solo_lite_evidence" : "business_kyb_evidence")
    || snapshot.policyVersion !== DRAFT_REVIEW_POLICY_VERSION
    || snapshot.policyStatus !== "draft"
    || snapshot.adapterVersion !== "2c-2b-v1"
    || typeof snapshot.evaluatedAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(snapshot.evaluatedAt)
    || !Number.isFinite(Date.parse(snapshot.evaluatedAt))
    || !Array.isArray(snapshot.findings)
    || snapshot.findings.length < 1
    || snapshot.findings.length > 32
    || JSON.stringify(snapshot).length > 16_384
  ) return false;
  const allowedCodes = new Set(validFindingCodesForPlan(plan));
  const seen = new Set<string>();
  return snapshot.findings.every((finding) => {
    if (!isRecord(finding) || !hasExactKeys(finding, FINDING_KEYS)) return false;
    if (
      typeof finding.code !== "string" || !allowedCodes.has(finding.code) || seen.has(finding.code)
      || typeof finding.status !== "string" || !EVIDENCE_STATUSES.has(finding.status)
      || typeof finding.reasonCode !== "string" || !EVIDENCE_REASON_CODES.has(finding.reasonCode)
      || !(finding.sourceType === null || typeof finding.sourceType === "string" && EVIDENCE_SOURCE_TYPES.has(finding.sourceType))
      || !(finding.sourceId === null || isUuid(finding.sourceId))
      || !(finding.sourceVersion === null || isPositiveSafeInteger(finding.sourceVersion))
      || finding.status === "verified" && (
        finding.sourceId === null || finding.sourceVersion === null || finding.sourceType === null
        || finding.sourceType === "merchant" || finding.reasonCode !== "evidence_verified"
      )
    ) return false;
    seen.add(finding.code);
    return true;
  });
}

function hasSubmissionEvidence(snapshot: Record<string, unknown>): boolean {
  // Draft Lite/Business policies do not define an approved completion checklist.
  // Treat only an entirely missing/unknown diagnostic as incomplete; do not turn
  // this submission gate into an assurance or approval decision.
  return (snapshot.findings as Record<string, unknown>[]).some(
    (finding) => finding.status !== "missing" && finding.status !== "unknown",
  );
}

function noReviewState(
  plan: ReviewPlan | null,
  reason: ReviewSubmissionEligibilityReason,
): MerchantReviewState {
  return {
    status: "NO_REVIEW_ELIGIBLE",
    eligibility: {
      canSubmit: reason === "READY",
      reason,
      plan,
      planLabel: plan === "solo_lite" ? "Solo Lite" : plan === "business" ? "Business" : null,
    },
  };
}

function receiptProfileRowVersion(receipt: MutationReceiptRow | null): number | null {
  if (!receipt || !isRecord(receipt.metadata)) return null;
  const version = receipt.metadata.profile_row_version;
  return isPositiveSafeInteger(version) ? version : null;
}

export function createReviewCorrectionService(dependencies: {
  repository?: ReviewCorrectionRepository;
  now?: () => Date;
  buildEvidenceSnapshot?: typeof buildCorrectedDraftEvidenceSnapshot;
  environment?: NodeJS.ProcessEnv;
} = {}) {
  const repository = dependencies.repository ?? createSupabaseReviewCorrectionRepository(dependencies.environment);
  const now = dependencies.now ?? (() => new Date());
  const buildEvidenceSnapshot = dependencies.buildEvidenceSnapshot ?? buildCorrectedDraftEvidenceSnapshot;

  const readModel = async (review: ReviewRow, merchant?: MerchantRow | null) => {
    const resolvedMerchant = merchant ?? await repository.findMerchant(review.merchant_id);
    if (!resolvedMerchant || resolvedMerchant.id !== review.merchant_id) {
      throw new ReviewCorrectionServiceError("NOT_FOUND");
    }
    const events = await repository.findReviewEvents(review.merchant_id, review.id);
    return toReadModel(review, resolvedMerchant, events);
  };

  return {
    async listAdminReviews(): Promise<ReviewReadModel[]> {
      const reviews = await repository.listOpenReviews();
      const merchantIds = [...new Set(reviews.map((review) => review.merchant_id))];
      const merchants = await repository.findMerchants(merchantIds);
      const byId = new Map(merchants.map((merchant) => [merchant.id, merchant]));
      return Promise.all(reviews.map((review) => readModel(review, byId.get(review.merchant_id) ?? null)));
    },

    async getAdminReview(reviewId: string): Promise<ReviewReadModel | null> {
      const review = await repository.findReview(reviewId);
      return review && isOpenReview(review) && review.policy_version === DRAFT_REVIEW_POLICY_VERSION ? readModel(review) : null;
    },

    async getMerchantReview(actorId: string, merchantId: string): Promise<ReviewReadModel | null> {
      const merchant = await repository.findOwnedMerchant(actorId, merchantId);
      if (!merchant) throw new ReviewCorrectionServiceError("FORBIDDEN");
      const review = await repository.findCurrentReview(merchant.id);
      return review && isOpenReview(review) && review.merchant_id === merchant.id ? readModel(review, merchant) : null;
    },

    async getMerchantReviewState(actorId: string, merchantId: string): Promise<MerchantReviewState> {
      const merchant = await repository.findOwnedMerchant(actorId, merchantId);
      if (!merchant) throw new ReviewCorrectionServiceError("FORBIDDEN");
      const plan = canonicalMerchantPlan(merchant.subscription_plan);
      if (!plan) return noReviewState(null, "PLAN_NOT_ELIGIBLE");
      const review = await repository.findCurrentReview(merchant.id);
      if (review && isOpenReview(review) && review.merchant_id === merchant.id) {
        const model = await readModel(review, merchant);
        return model.status === "pending"
          ? { status: "PENDING", review: model }
          : { status: "NEEDS_ATTENTION", review: model };
      }
      const [profile, workspace, registry] = await Promise.all([
        repository.findProfile(merchant.id),
        repository.findCanonicalWorkspace(merchant.id),
        repository.findRegistrySnapshot(merchant.business_registry_snapshot_id),
      ]);
      if (!workspace || workspace.merchant_id !== merchant.id || !isUuid(workspace.workspace_id)) {
        return noReviewState(plan, "WORKSPACE_REQUIRED");
      }
      if (
        !profile || profile.merchant_id !== merchant.id || profile.plan_code !== plan
        || !isUuid(profile.id) || !isPositiveSafeInteger(profile.row_version)
      ) return noReviewState(plan, "PROFILE_REQUIRED");
      const snapshot = buildEvidenceSnapshot(merchant, registry, now().toISOString());
      return isValidDraftSnapshot(snapshot, plan) && hasSubmissionEvidence(snapshot)
        ? noReviewState(plan, "READY")
        : noReviewState(plan, "EVIDENCE_INCOMPLETE");
    },

    async submitInitialReview(input: {
      actorId: string;
      merchantId: string;
      idempotencyKey: string;
    }): Promise<{ result: ReviewCorrectionRpcResult; state: MerchantReviewState }> {
      const merchant = await repository.findOwnedMerchant(input.actorId, input.merchantId);
      if (!merchant) throw new ReviewCorrectionServiceError("FORBIDDEN");
      const plan = canonicalMerchantPlan(merchant.subscription_plan);
      if (!plan) throw new ReviewCorrectionServiceError("INVALID_STATE");
      const [profile, workspace, registry, receipt] = await Promise.all([
        repository.findProfile(merchant.id),
        repository.findCanonicalWorkspace(merchant.id),
        repository.findRegistrySnapshot(merchant.business_registry_snapshot_id),
        repository.findMutationReceipt(merchant.id, input.idempotencyKey),
      ]);
      if (
        !profile || !workspace || profile.merchant_id !== merchant.id || profile.plan_code !== plan
        || workspace.merchant_id !== merchant.id || !isUuid(profile.id) || !isUuid(workspace.workspace_id)
        || !isPositiveSafeInteger(profile.row_version)
      ) throw new ReviewCorrectionServiceError("INVALID_STATE");

      let snapshot: Record<string, unknown>;
      let expectedProfileRowVersion = profile.row_version;
      if (receipt) {
        const replayProfileVersion = receiptProfileRowVersion(receipt);
        if (
          receipt.event_type !== "phase2c_draft_review_submit_v1"
          || !isUuid(receipt.source_id)
          || receipt.actor_id !== input.actorId
          || receipt.expected_row_version !== null
          || replayProfileVersion === null
        ) throw new ReviewCorrectionServiceError("INVALID_STATE");
        const replayReview = await repository.findReview(receipt.source_id);
        if (
          !replayReview || replayReview.merchant_id !== merchant.id || replayReview.profile_id !== profile.id
          || canonicalPlan(replayReview) !== plan || replayReview.review_status !== "pending"
          || replayReview.policy_version !== DRAFT_REVIEW_POLICY_VERSION
          || replayReview.idempotency_key !== input.idempotencyKey
          || !isValidDraftSnapshot(replayReview.evidence_snapshot, plan)
        ) throw new ReviewCorrectionServiceError("INVALID_STATE");
        snapshot = replayReview.evidence_snapshot;
        expectedProfileRowVersion = replayProfileVersion;
      } else {
        const current = await repository.findCurrentReview(merchant.id);
        if (current && isOpenReview(current)) throw new ReviewCorrectionServiceError("INVALID_STATE");
        snapshot = buildEvidenceSnapshot(merchant, registry, now().toISOString());
        if (!isValidDraftSnapshot(snapshot, plan) || !hasSubmissionEvidence(snapshot)) {
          throw new ReviewCorrectionServiceError("INVALID_EVIDENCE");
        }
      }

      const result = parseRpcResult(await repository.submitInitialReview({
        p_merchant_id: merchant.id,
        p_workspace_id: workspace.workspace_id,
        p_expected_profile_row_version: expectedProfileRowVersion,
        p_actor_id: input.actorId,
        p_policy_version: DRAFT_REVIEW_POLICY_VERSION,
        p_evidence_snapshot: snapshot,
        p_idempotency_key: input.idempotencyKey,
      }));
      const successful = result.kind === "applied" || result.kind === "already_processed";
      if (!successful) return { result, state: noReviewState(plan, "READY") };
      if (!result.review_id) throw new ReviewCorrectionServiceError("DATA_ACCESS_ERROR");
      const submitted = await repository.findReview(result.review_id);
      if (
        !submitted || submitted.merchant_id !== merchant.id || submitted.profile_id !== profile.id
        || canonicalPlan(submitted) !== plan || submitted.review_status !== "pending"
        || submitted.policy_version !== DRAFT_REVIEW_POLICY_VERSION
        || submitted.idempotency_key !== input.idempotencyKey
      ) throw new ReviewCorrectionServiceError("DATA_ACCESS_ERROR");
      const model = await readModel(submitted, merchant);
      return { result, state: { status: "PENDING", review: model } };
    },

    async requestCorrection(input: {
      reviewId: string;
      reviewerId: string;
      reasonCode: ReviewCorrectionReasonCode;
      requestedFindingCodes: string[];
      idempotencyKey: string;
    }): Promise<{ result: ReviewCorrectionRpcResult; review: ReviewReadModel | null }> {
      const review = await repository.findReview(input.reviewId);
      if (!review) throw new ReviewCorrectionServiceError("NOT_FOUND");
      const plan = canonicalPlan(review);
      if (!plan || review.policy_version !== DRAFT_REVIEW_POLICY_VERSION) throw new ReviewCorrectionServiceError("INVALID_STATE");
      const allowed = new Set(validFindingCodesForPlan(plan));
      const present = new Set(safeFindingSummaries(review.evidence_snapshot, plan).map((finding) => finding.code));
      if (input.requestedFindingCodes.some((code) => !allowed.has(code) || !present.has(code))) {
        throw new ReviewCorrectionServiceError("INVALID_EVIDENCE");
      }
      const [profile, workspace] = await Promise.all([
        repository.findProfile(review.merchant_id), repository.findCanonicalWorkspace(review.merchant_id),
      ]);
      if (
        !profile
        || !workspace
        || profile.id !== review.profile_id
        || profile.merchant_id !== review.merchant_id
        || profile.plan_code !== plan
        || workspace.merchant_id !== review.merchant_id
        || !isPositiveSafeInteger(review.row_version)
        || !isPositiveSafeInteger(profile.row_version)
      ) throw new ReviewCorrectionServiceError("INVALID_STATE");
      const receipt = await repository.findMutationReceipt(review.merchant_id, input.idempotencyKey);
      const replayProfileVersion = receiptProfileRowVersion(receipt);
      const replayExpectedVersion = receipt?.event_type === "phase2c_draft_review_needs_attention_v1"
        && receipt.source_id === review.id && receipt.actor_id === input.reviewerId
        && isPositiveSafeInteger(receipt.expected_row_version)
        && replayProfileVersion !== null
        ? receipt.expected_row_version : null;
      if (review.review_status !== "pending" && replayExpectedVersion === null) throw new ReviewCorrectionServiceError("INVALID_STATE");
      const result = await repository.requestCorrection({
        p_merchant_id: review.merchant_id,
        p_workspace_id: workspace.workspace_id,
        p_profile_id: profile.id,
        p_review_id: review.id,
        p_expected_review_row_version: replayExpectedVersion ?? review.row_version,
        p_expected_profile_row_version: replayExpectedVersion === null ? profile.row_version : replayProfileVersion,
        p_reviewer_id: input.reviewerId,
        p_policy_version: DRAFT_REVIEW_POLICY_VERSION,
        p_reason_code: input.reasonCode,
        p_requested_finding_codes: [...input.requestedFindingCodes].sort(),
        p_idempotency_key: input.idempotencyKey,
      });
      const successful = result.kind === "applied" || result.kind === "already_processed";
      if (successful && result.review_id !== review.id) throw new ReviewCorrectionServiceError("DATA_ACCESS_ERROR");
      const refreshed = successful ? await repository.findReview(review.id) : null;
      if (
        successful && (
          !refreshed
          || refreshed.merchant_id !== review.merchant_id
          || refreshed.profile_id !== profile.id
          || canonicalPlan(refreshed) !== plan
          || refreshed.policy_version !== DRAFT_REVIEW_POLICY_VERSION
          || result.kind === "applied" && refreshed.review_status !== "needs_attention"
          || result.kind === "already_processed" && refreshed.review_status !== "needs_attention" && !(
            refreshed.review_status === "cancelled"
            && refreshed.decision_reason_code === "superseded_by_corrected_submission"
          )
        )
      ) {
        throw new ReviewCorrectionServiceError("DATA_ACCESS_ERROR");
      }
      return {
        result,
        review: refreshed?.review_status === "needs_attention" ? await readModel(refreshed) : null,
      };
    },

    async resubmitCorrection(input: {
      reviewId: string;
      actorId: string;
      merchantId: string;
      idempotencyKey: string;
    }): Promise<{ result: ReviewCorrectionRpcResult; review: ReviewReadModel | null }> {
      const merchant = await repository.findOwnedMerchant(input.actorId, input.merchantId);
      if (!merchant) throw new ReviewCorrectionServiceError("FORBIDDEN");
      const review = await repository.findReview(input.reviewId);
      if (!review || review.merchant_id !== merchant.id) {
        throw new ReviewCorrectionServiceError("NOT_FOUND");
      }
      const plan = canonicalPlan(review);
      if (!plan || canonicalMerchantPlan(merchant.subscription_plan) !== plan || review.policy_version !== DRAFT_REVIEW_POLICY_VERSION) {
        throw new ReviewCorrectionServiceError("INVALID_STATE");
      }
      const [profile, workspace, registry] = await Promise.all([
        repository.findProfile(merchant.id),
        repository.findCanonicalWorkspace(merchant.id),
        repository.findRegistrySnapshot(merchant.business_registry_snapshot_id),
      ]);
      if (
        !profile
        || !workspace
        || profile.id !== review.profile_id
        || profile.merchant_id !== merchant.id
        || profile.plan_code !== plan
        || workspace.merchant_id !== merchant.id
        || !isPositiveSafeInteger(review.row_version)
        || !isPositiveSafeInteger(profile.row_version)
      ) throw new ReviewCorrectionServiceError("INVALID_STATE");
      const receipt = await repository.findMutationReceipt(merchant.id, input.idempotencyKey);
      const replayProfileVersion = receiptProfileRowVersion(receipt);
      const replayExpectedVersion = receipt?.event_type === "phase2c_draft_review_superseded_v1"
        && receipt.source_id === review.id && receipt.actor_id === input.actorId
        && isPositiveSafeInteger(receipt.expected_row_version)
        && replayProfileVersion !== null
        ? receipt.expected_row_version : null;
      let snapshot: Record<string, unknown>;
      if (replayExpectedVersion !== null && isRecord(receipt?.metadata) && isUuid(receipt.metadata.new_review_id)) {
        const replacement = await repository.findReview(receipt.metadata.new_review_id);
        if (
          !replacement
          || replacement.merchant_id !== merchant.id
          || replacement.profile_id !== profile.id
          || canonicalPlan(replacement) !== plan
          || replacement.review_status !== "pending"
          || replacement.policy_version !== DRAFT_REVIEW_POLICY_VERSION
          || !isRecord(replacement.evidence_snapshot)
        ) throw new ReviewCorrectionServiceError("INVALID_STATE");
        snapshot = replacement.evidence_snapshot;
      } else {
        if (review.review_status !== "needs_attention") throw new ReviewCorrectionServiceError("INVALID_STATE");
        snapshot = buildCorrectedDraftEvidenceSnapshot(merchant, registry, now().toISOString());
      }
      const result = await repository.resubmitCorrection({
        p_merchant_id: merchant.id,
        p_workspace_id: workspace.workspace_id,
        p_profile_id: profile.id,
        p_old_review_id: review.id,
        p_expected_old_row_version: replayExpectedVersion ?? review.row_version,
        p_expected_profile_row_version: replayExpectedVersion === null ? profile.row_version : replayProfileVersion,
        p_actor_id: input.actorId,
        p_policy_version: DRAFT_REVIEW_POLICY_VERSION,
        p_new_evidence_snapshot: snapshot,
        p_idempotency_key: input.idempotencyKey,
      });
      const replacementId = result.new_review_id ?? result.review_id;
      const successful = result.kind === "applied" || result.kind === "already_processed";
      if (successful && !replacementId) throw new ReviewCorrectionServiceError("DATA_ACCESS_ERROR");
      const replacement = replacementId && successful ? await repository.findReview(replacementId) : null;
      if (
        successful && (
          !replacement
          || replacement.merchant_id !== merchant.id
          || replacement.profile_id !== profile.id
          || canonicalPlan(replacement) !== plan
          || replacement.review_status !== "pending"
          || replacement.policy_version !== DRAFT_REVIEW_POLICY_VERSION
        )
      ) throw new ReviewCorrectionServiceError("DATA_ACCESS_ERROR");
      return { result, review: replacement ? await readModel(replacement, merchant) : null };
    },
  };
}

export type ReviewCorrectionService = ReturnType<typeof createReviewCorrectionService>;
