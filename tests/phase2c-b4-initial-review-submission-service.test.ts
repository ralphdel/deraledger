import assert from "node:assert/strict";
import { createRequire } from "node:module";

import type { ReviewCorrectionRepository } from "../src/lib/compliance/server/review-correction-service";

const ids = {
  merchant: "11111111-1111-4111-8111-111111111111",
  owner: "22222222-2222-4222-8222-222222222222",
  workspace: "33333333-3333-4333-8333-333333333333",
  profile: "44444444-4444-4444-8444-444444444444",
  review: "55555555-5555-4555-8555-555555555555",
  registry: "66666666-6666-4666-8666-666666666666",
};

const merchant = {
  id: ids.merchant,
  user_id: ids.owner,
  business_name: "Bounded Merchant",
  trading_name: null,
  owner_name: "Merchant Owner",
  email: "owner@example.test",
  phone: "+2348000000000",
  subscription_plan: "individual",
  merchant_tier: "individual",
  verification_status: "pending_admin_review",
  bvn_status: "verified",
  selfie_status: "verified",
  cac_document_url: null,
  utility_document_url: "private-document-reference",
  cac_status: "unverified",
  utility_status: "pending",
  business_street: "1 Example Street",
  business_city: "Lagos",
  business_state: "Lagos",
  business_country: "Nigeria",
  verification_step_state: {},
  business_registry_snapshot_id: null,
  relationship_claim: null,
};

type Options = {
  plan?: string;
  owned?: boolean;
  currentStatus?: "pending" | "needs_attention" | null;
  profile?: null | { id?: string; merchant_id?: string; plan_code?: string; row_version?: number };
  workspace?: null | { merchant_id?: string; workspace_id?: string };
  resultKind?: string;
  receipt?: Record<string, unknown> | null;
};

function makeRepository(options: Options = {}) {
  const selectedMerchant = { ...merchant, subscription_plan: options.plan ?? merchant.subscription_plan };
  const plan = ["corporate", "business"].includes(selectedMerchant.subscription_plan) ? "business" : "solo_lite";
  const key = "phase2c-b4-submit-test";
  const evidence = {
    schemaVersion: "phase2c-review-v1",
    policyId: plan === "business" ? "business_kyb_evidence" : "solo_lite_evidence",
    policyVersion: "2c-2b-draft-v1",
    policyStatus: "draft",
    adapterVersion: "2c-2b-v1",
    evaluatedAt: "2026-10-23T12:00:00.000Z",
    findings: [{
      code: "legal_name", status: "needs_review", reasonCode: "positive_evidence_provenance_missing",
      sourceType: "merchant", sourceId: ids.merchant, sourceVersion: null,
    }],
  };
  const review = (status: "pending" | "needs_attention", idempotencyKey = key) => ({
    id: ids.review,
    merchant_id: ids.merchant,
    profile_id: ids.profile,
    review_type: plan === "business" ? "business_kyb" : "solo_lite",
    target_plan_code: plan,
    review_status: status,
    evidence_snapshot: evidence,
    decision_reason_code: status === "needs_attention" ? "evidence_incomplete" : null,
    policy_version: "2c-2b-draft-v1",
    submitted_at: "2026-10-23T12:00:01.000Z",
    reviewed_at: status === "needs_attention" ? "2026-10-23T12:05:00.000Z" : null,
    idempotency_key: idempotencyKey,
    row_version: status === "needs_attention" ? 2 : 1,
  });
  type TestReview = Omit<ReturnType<typeof review>, "evidence_snapshot"> & { evidence_snapshot: unknown };
  let current: TestReview | null = options.currentStatus ? review(options.currentStatus) : null;
  let submitted: TestReview | null = options.receipt ? review("pending") : null;
  let submitArgs: Record<string, unknown> | null = null;
  const profile = options.profile === null ? null : {
    id: options.profile?.id ?? ids.profile,
    merchant_id: options.profile?.merchant_id ?? ids.merchant,
    plan_code: options.profile?.plan_code ?? plan,
    row_version: options.profile?.row_version ?? 7,
  };
  const workspace = options.workspace === null ? null : {
    merchant_id: options.workspace?.merchant_id ?? ids.merchant,
    workspace_id: options.workspace?.workspace_id ?? ids.workspace,
  };
  const repo = {
    findOwnedMerchant: async (userId: string, merchantId: string) => options.owned === false || userId !== ids.owner || merchantId !== ids.merchant ? null : selectedMerchant,
    findMerchant: async () => selectedMerchant,
    findMerchants: async () => [selectedMerchant],
    findCanonicalWorkspace: async () => workspace,
    findProfile: async () => profile,
    findReview: async (reviewId: string) => reviewId === ids.review ? submitted ?? current : null,
    findCurrentReview: async () => current,
    listOpenReviews: async () => current ? [current] : [],
    findReviewEvents: async () => current?.review_status === "needs_attention" ? [
      { event_type: "phase2c_draft_review_submit_v1", reason_code: null, metadata: {}, created_at: "2026-10-23T12:00:01.000Z" },
      { event_type: "phase2c_draft_review_needs_attention_v1", reason_code: "evidence_incomplete", metadata: { requested_finding_codes: ["legal_name"] }, created_at: "2026-10-23T12:05:00.000Z" },
    ] : [{ event_type: "phase2c_draft_review_submit_v1", reason_code: null, metadata: {}, created_at: "2026-10-23T12:00:01.000Z" }],
    findMutationReceipt: async () => options.receipt ?? null,
    findRegistrySnapshot: async () => selectedMerchant.business_registry_snapshot_id ? {
      id: ids.registry, business_type: "ltd", registered_name: "Bounded Merchant Ltd",
      registration_number: "bounded-reference", registration_status: "active", directors_json: [],
    } : null,
    submitInitialReview: async (args: Record<string, unknown>) => {
      submitArgs = args;
      const kind = options.resultKind ?? "applied";
      if (kind === "applied" || kind === "already_processed") {
        submitted = { ...review("pending", String(args.p_idempotency_key)), evidence_snapshot: args.p_evidence_snapshot };
        current = submitted;
        return { kind, review_id: ids.review, row_version: 1 };
      }
      return { kind };
    },
    requestCorrection: async () => ({ kind: "state_conflict" as const }),
    resubmitCorrection: async () => ({ kind: "state_conflict" as const }),
  };
  return { repo: repo as unknown as ReviewCorrectionRepository, submitArgs: () => submitArgs, evidence, key };
}

async function run() {
  const require = createRequire(import.meta.url);
  const serverOnlyId = require.resolve("server-only");
  require.cache[serverOnlyId] = {
    exports: {}, filename: serverOnlyId, id: serverOnlyId, loaded: true, path: serverOnlyId,
    children: [], paths: [], isPreloading: false, parent: null, require,
  } as NodeModule;
  const { createReviewCorrectionService, ReviewCorrectionServiceError } = await import("../src/lib/compliance/server/review-correction-service");

  for (const [rawPlan, expectedPlan] of [["individual", "solo_lite"], ["solo_lite", "solo_lite"], ["corporate", "business"], ["business", "business"]] as const) {
    const fake = makeRepository({ plan: rawPlan });
    const service = createReviewCorrectionService({ repository: fake.repo, now: () => new Date("2026-10-23T12:00:00.000Z") });
    const outcome = await service.submitInitialReview({ actorId: ids.owner, merchantId: ids.merchant, idempotencyKey: fake.key });
    assert.equal(outcome.result.kind, "applied");
    assert.equal(outcome.state.status, "PENDING");
    assert.equal(JSON.stringify(outcome).includes("private-document-reference"), false);
    const adminQueue = await service.listAdminReviews();
    assert.equal(adminQueue.length, 1);
    assert.equal(adminQueue[0]?.plan, expectedPlan);
    assert.equal(adminQueue[0]?.status, "pending");
    const args = fake.submitArgs() as Record<string, unknown>;
    assert.deepEqual(Object.keys(args), [
      "p_merchant_id", "p_workspace_id", "p_expected_profile_row_version", "p_actor_id",
      "p_policy_version", "p_evidence_snapshot", "p_idempotency_key",
    ]);
    assert.equal(args.p_merchant_id, ids.merchant);
    assert.equal(args.p_workspace_id, ids.workspace);
    assert.equal(args.p_expected_profile_row_version, 7);
    assert.equal(args.p_actor_id, ids.owner);
    assert.equal(args.p_policy_version, "2c-2b-draft-v1");
    assert.equal((args.p_evidence_snapshot as Record<string, unknown>).policyId, expectedPlan === "business" ? "business_kyb_evidence" : "solo_lite_evidence");
    assert.equal(JSON.stringify(args).includes("private-document-reference"), false);
  }

  for (const plan of ["starter", "solo_plus", "unknown", ""] as const) {
    const fake = makeRepository({ plan });
    const service = createReviewCorrectionService({ repository: fake.repo });
    const state = await service.getMerchantReviewState(ids.owner, ids.merchant);
    assert.deepEqual(state, { status: "NO_REVIEW_ELIGIBLE", eligibility: { canSubmit: false, reason: "PLAN_NOT_ELIGIBLE", plan: null, planLabel: null } });
    await assert.rejects(
      () => service.submitInitialReview({ actorId: ids.owner, merchantId: ids.merchant, idempotencyKey: fake.key }),
      (error: unknown) => error instanceof ReviewCorrectionServiceError && error.code === "INVALID_STATE",
    );
    assert.equal(fake.submitArgs(), null);
  }

  {
    const fake = makeRepository({ owned: false });
    const service = createReviewCorrectionService({ repository: fake.repo });
    await assert.rejects(
      () => service.submitInitialReview({ actorId: ids.owner, merchantId: ids.merchant, idempotencyKey: fake.key }),
      (error: unknown) => error instanceof ReviewCorrectionServiceError && error.code === "FORBIDDEN",
    );
  }

  for (const status of ["pending", "needs_attention"] as const) {
    const fake = makeRepository({ currentStatus: status });
    const service = createReviewCorrectionService({ repository: fake.repo });
    const state = await service.getMerchantReviewState(ids.owner, ids.merchant);
    assert.equal(state.status, status === "pending" ? "PENDING" : "NEEDS_ATTENTION");
    await assert.rejects(
      () => service.submitInitialReview({ actorId: ids.owner, merchantId: ids.merchant, idempotencyKey: fake.key }),
      (error: unknown) => error instanceof ReviewCorrectionServiceError && error.code === "INVALID_STATE",
    );
    assert.equal(fake.submitArgs(), null);
  }

  for (const options of [{ profile: null }, { profile: { merchant_id: ids.workspace } }, { profile: { plan_code: "business" } }, { workspace: null }, { workspace: { merchant_id: ids.workspace } }] as Options[]) {
    const fake = makeRepository(options);
    const service = createReviewCorrectionService({ repository: fake.repo });
    await assert.rejects(
      () => service.submitInitialReview({ actorId: ids.owner, merchantId: ids.merchant, idempotencyKey: fake.key }),
      (error: unknown) => error instanceof ReviewCorrectionServiceError && error.code === "INVALID_STATE",
    );
    assert.equal(fake.submitArgs(), null);
  }

  {
    const fake = makeRepository();
    const incomplete = { ...fake.evidence, findings: fake.evidence.findings.map((finding) => ({ ...finding, status: "missing", reasonCode: "evidence_missing" })) };
    const service = createReviewCorrectionService({ repository: fake.repo, buildEvidenceSnapshot: () => incomplete });
    const state = await service.getMerchantReviewState(ids.owner, ids.merchant);
    assert.equal(state.status, "NO_REVIEW_ELIGIBLE");
    if (state.status === "NO_REVIEW_ELIGIBLE") assert.equal(state.eligibility.reason, "EVIDENCE_INCOMPLETE");
    await assert.rejects(
      () => service.submitInitialReview({ actorId: ids.owner, merchantId: ids.merchant, idempotencyKey: fake.key }),
      (error: unknown) => error instanceof ReviewCorrectionServiceError && error.code === "INVALID_EVIDENCE",
    );
  }

  {
    const fake = makeRepository({
      resultKind: "already_processed",
      receipt: {
        event_type: "phase2c_draft_review_submit_v1", source_id: ids.review, actor_id: ids.owner,
        expected_row_version: null, metadata: { profile_row_version: 3 },
      },
    });
    const service = createReviewCorrectionService({ repository: fake.repo, buildEvidenceSnapshot: () => { throw new Error("replay rebuilt evidence"); } });
    const outcome = await service.submitInitialReview({ actorId: ids.owner, merchantId: ids.merchant, idempotencyKey: fake.key });
    assert.equal(outcome.result.kind, "already_processed");
    const args = fake.submitArgs() as Record<string, unknown>;
    assert.equal(args.p_expected_profile_row_version, 3);
    assert.deepEqual(args.p_evidence_snapshot, fake.evidence);
  }

  for (const kind of ["version_conflict", "state_conflict", "evidence_conflict", "actor_unauthorized", "unsupported_isolation", "invalid_transition"] as const) {
    const fake = makeRepository({ resultKind: kind });
    const service = createReviewCorrectionService({ repository: fake.repo });
    const outcome = await service.submitInitialReview({ actorId: ids.owner, merchantId: ids.merchant, idempotencyKey: fake.key });
    assert.equal(outcome.result.kind, kind);
    assert.equal(outcome.state.status, "NO_REVIEW_ELIGIBLE");
  }

  {
    const fake = makeRepository({ resultKind: "unbounded_database_result" });
    const service = createReviewCorrectionService({ repository: fake.repo });
    await assert.rejects(
      () => service.submitInitialReview({ actorId: ids.owner, merchantId: ids.merchant, idempotencyKey: fake.key }),
      (error: unknown) => error instanceof ReviewCorrectionServiceError && error.code === "DATA_ACCESS_ERROR",
    );
  }

  console.log("Phase 2C-2C-B4 initial review submission service tests passed.");
}

void run();
