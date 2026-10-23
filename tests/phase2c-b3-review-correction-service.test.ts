import assert from "node:assert/strict";
import { createRequire } from "node:module";

import type { ReviewCorrectionRepository } from "../src/lib/compliance/server/review-correction-service";

const ids = {
  merchant: "11111111-1111-4111-8111-111111111111",
  owner: "22222222-2222-4222-8222-222222222222",
  reviewer: "33333333-3333-4333-8333-333333333333",
  workspace: "44444444-4444-4444-8444-444444444444",
  profile: "55555555-5555-4555-8555-555555555555",
  review: "66666666-6666-4666-8666-666666666666",
  replacement: "77777777-7777-4777-8777-777777777777",
  registry: "88888888-8888-4888-8888-888888888888",
};

const baseMerchant = {
  id: ids.merchant,
  user_id: ids.owner,
  business_name: "Example Merchant",
  trading_name: null,
  owner_name: "Example Owner",
  email: "owner@example.test",
  phone: "+2348000000000",
  subscription_plan: "individual",
  merchant_tier: "individual",
  verification_status: "pending_admin_review",
  bvn: "sensitive-bvn-must-not-appear",
  bvn_status: "verified",
  selfie_status: "verified",
  cac_document_url: null,
  utility_document_url: null,
  cac_status: "unverified",
  utility_status: "unverified",
  business_street: "1 Example Street",
  business_city: "Lagos",
  business_state: "Lagos",
  business_country: "Nigeria",
  verification_step_state: {},
  business_registry_snapshot_id: null,
  relationship_claim: "owner_affiliated_claim",
};

function snapshot() {
  return {
    schemaVersion: "phase2c-review-v1",
    policyId: "solo_lite_evidence",
    policyVersion: "2c-2b-draft-v1",
    policyStatus: "draft",
    adapterVersion: "2c-2b-v1",
    evaluatedAt: "2026-10-23T12:00:00.000Z",
    findings: [{ code: "legal_name", status: "needs_review", reasonCode: "positive_evidence_provenance_missing", sourceType: "merchant", sourceId: ids.merchant, sourceVersion: null }],
  };
}

function review(status: "pending" | "needs_attention" = "pending", id = ids.review) {
  return {
    id,
    merchant_id: ids.merchant,
    profile_id: ids.profile,
    review_type: "solo_lite",
    target_plan_code: "solo_lite",
    review_status: status,
    evidence_snapshot: snapshot(),
    decision_reason_code: status === "needs_attention" ? "evidence_incomplete" : null,
    policy_version: "2c-2b-draft-v1",
    submitted_at: "2026-10-23T12:00:00.000Z",
    reviewed_at: status === "needs_attention" ? "2026-10-23T12:05:00.000Z" : null,
    row_version: status === "needs_attention" ? 2 : 1,
  };
}

function repository(options: { owned?: boolean; status?: "pending" | "needs_attention" } = {}) {
  let current = review(options.status ?? "pending");
  let correctionArgs: Record<string, unknown> | null = null;
  let resubmitArgs: Record<string, unknown> | null = null;
  let receipt: Record<string, unknown> | null = null;
  let eventOverride: Array<Record<string, unknown>> | null = null;
  const repo = {
    findOwnedMerchant: async (userId: string, merchantId: string) => options.owned === false || userId !== ids.owner || merchantId !== ids.merchant ? null : baseMerchant,
    findMerchant: async () => baseMerchant,
    findMerchants: async () => [baseMerchant],
    findCanonicalWorkspace: async () => ({ merchant_id: ids.merchant, workspace_id: ids.workspace }),
    findProfile: async () => ({ id: ids.profile, merchant_id: ids.merchant, plan_code: "solo_lite", row_version: 9 }),
    findReview: async (reviewId: string) => reviewId === ids.replacement ? review("pending", ids.replacement) : current,
    findCurrentReview: async () => current,
    listOpenReviews: async () => [current],
    findReviewEvents: async (_merchantId: string, reviewId: string) => eventOverride ?? (reviewId === ids.review && current.review_status === "needs_attention" ? [{
      event_type: "phase2c_draft_review_needs_attention_v1",
      reason_code: "evidence_incomplete",
      metadata: { requested_finding_codes: ["legal_name"] },
      created_at: "2026-10-23T12:05:00.000Z",
    }] : [{ event_type: "phase2c_draft_review_submit_v1", reason_code: null, metadata: {}, created_at: "2026-10-23T12:00:00.000Z" }]),
    findMutationReceipt: async () => receipt,
    findRegistrySnapshot: async () => null,
    requestCorrection: async (args: Record<string, unknown>) => {
      correctionArgs = args;
      current = review("needs_attention");
      return { kind: "applied" as const, review_id: ids.review, row_version: 2 };
    },
    resubmitCorrection: async (args: Record<string, unknown>) => {
      resubmitArgs = args;
      return { kind: "applied" as const, new_review_id: ids.replacement, row_version: 1 };
    },
  };
  return {
    repo: repo as unknown as ReviewCorrectionRepository,
    correctionArgs: () => correctionArgs,
    resubmitArgs: () => resubmitArgs,
    setReceipt: (value: Record<string, unknown> | null) => { receipt = value; },
    setCurrent: (value: ReturnType<typeof review>) => { current = value; },
    setEvents: (value: Array<Record<string, unknown>> | null) => { eventOverride = value; },
  };
}

async function run() {
  const require = createRequire(import.meta.url);
  const serverOnlyId = require.resolve("server-only");
  require.cache[serverOnlyId] = {
    exports: {}, filename: serverOnlyId, id: serverOnlyId, loaded: true, path: serverOnlyId,
    children: [], paths: [], isPreloading: false, parent: null, require,
  } as NodeModule;

  const { createReviewCorrectionService, ReviewCorrectionServiceError, buildCorrectedDraftEvidenceSnapshot } = await import("../src/lib/compliance/server/review-correction-service");

  {
    const fake = repository();
    const service = createReviewCorrectionService({ repository: fake.repo });
    const outcome = await service.requestCorrection({
      reviewId: ids.review,
      reviewerId: ids.reviewer,
      reasonCode: "evidence_incomplete",
      requestedFindingCodes: ["legal_name"],
      idempotencyKey: "phase2c-b3-rmi-test",
    });
    assert.equal(outcome.result.kind, "applied");
    assert.deepEqual(fake.correctionArgs(), {
      p_merchant_id: ids.merchant,
      p_workspace_id: ids.workspace,
      p_profile_id: ids.profile,
      p_review_id: ids.review,
      p_expected_review_row_version: 1,
      p_expected_profile_row_version: 9,
      p_reviewer_id: ids.reviewer,
      p_policy_version: "2c-2b-draft-v1",
      p_reason_code: "evidence_incomplete",
      p_requested_finding_codes: ["legal_name"],
      p_idempotency_key: "phase2c-b3-rmi-test",
    });
  }

  {
    const fake = repository({ status: "needs_attention" });
    fake.setReceipt({
      event_type: "phase2c_draft_review_needs_attention_v1",
      source_id: ids.review,
      actor_id: ids.reviewer,
      expected_row_version: 1,
      metadata: { profile_row_version: 4 },
    });
    const service = createReviewCorrectionService({ repository: fake.repo });
    await service.requestCorrection({
      reviewId: ids.review, reviewerId: ids.reviewer, reasonCode: "evidence_incomplete",
      requestedFindingCodes: ["legal_name"], idempotencyKey: "phase2c-b3-rmi-replay",
    });
    assert.equal((fake.correctionArgs() as Record<string, unknown>).p_expected_review_row_version, 1);
    assert.equal((fake.correctionArgs() as Record<string, unknown>).p_expected_profile_row_version, 4);
  }

  {
    const fake = repository();
    const service = createReviewCorrectionService({ repository: fake.repo });
    await assert.rejects(
      () => service.requestCorrection({
        reviewId: ids.review, reviewerId: ids.reviewer, reasonCode: "evidence_incomplete",
        requestedFindingCodes: ["approved_volume"], idempotencyKey: "phase2c-b3-rmi-invalid",
      }),
      (error: unknown) => error instanceof ReviewCorrectionServiceError && error.code === "INVALID_EVIDENCE",
    );
    assert.equal(fake.correctionArgs(), null);
  }


  {
    const fake = repository({ status: "needs_attention" });
    fake.setCurrent({ ...review("needs_attention"), review_status: "cancelled", decision_reason_code: "superseded_by_corrected_submission", row_version: 3 } as never);
    fake.setReceipt({
      event_type: "phase2c_draft_review_superseded_v1",
      source_id: ids.review,
      actor_id: ids.owner,
      expected_row_version: 2,
      metadata: { new_review_id: ids.replacement, profile_row_version: 4 },
    });
    const service = createReviewCorrectionService({ repository: fake.repo });
    await service.resubmitCorrection({ reviewId: ids.review, actorId: ids.owner, merchantId: ids.merchant, idempotencyKey: "phase2c-b3-resubmit-replay" });
    const args = fake.resubmitArgs() as Record<string, unknown>;
    assert.equal(args.p_expected_old_row_version, 2);
    assert.equal(args.p_expected_profile_row_version, 4);
    assert.deepEqual(args.p_new_evidence_snapshot, snapshot());
  }

  {
    const fake = repository({ status: "needs_attention" });
    const service = createReviewCorrectionService({ repository: fake.repo, now: () => new Date("2026-10-23T13:00:00.000Z") });
    const outcome = await service.resubmitCorrection({ reviewId: ids.review, actorId: ids.owner, merchantId: ids.merchant, idempotencyKey: "phase2c-b3-resubmit-test" });
    assert.equal(outcome.result.kind, "applied");
    const args = fake.resubmitArgs() as Record<string, unknown>;
    assert.equal(args.p_actor_id, ids.owner);
    assert.equal(args.p_expected_old_row_version, 2);
    assert.equal(args.p_expected_profile_row_version, 9);
    assert.equal(args.p_policy_version, "2c-2b-draft-v1");
    const newSnapshot = args.p_new_evidence_snapshot as Record<string, unknown>;
    assert.equal(newSnapshot.policyStatus, "draft");
    assert.equal(newSnapshot.policyId, "solo_lite_evidence");
    assert.equal(newSnapshot.evaluatedAt, "2026-10-23T13:00:00.000Z");
    assert.equal(JSON.stringify(newSnapshot).includes("sensitive-bvn-must-not-appear"), false);
  }

  {
    const fake = repository({ owned: false, status: "needs_attention" });
    const service = createReviewCorrectionService({ repository: fake.repo });
    await assert.rejects(
      () => service.resubmitCorrection({ reviewId: ids.review, actorId: "99999999-9999-4999-8999-999999999999", merchantId: ids.merchant, idempotencyKey: "phase2c-b3-owner-only" }),
      (error: unknown) => error instanceof ReviewCorrectionServiceError && error.code === "FORBIDDEN",
    );
    assert.equal(fake.resubmitArgs(), null);
  }

  {
    const fake = repository();
    const service = createReviewCorrectionService({ repository: fake.repo });
    await assert.rejects(
      () => service.getMerchantReview(ids.owner, "99999999-9999-4999-8999-999999999999"),
      (error: unknown) => error instanceof ReviewCorrectionServiceError && error.code === "FORBIDDEN",
    );
  }

  {
    const fake = repository();
    fake.setCurrent({
      ...review(),
      evidence_snapshot: {
        ...snapshot(),
        findings: [
          ...snapshot().findings,
          { code: "approved_volume", status: "verified", reasonCode: "approved_volume_present" },
          { code: "legal_name", status: "invented_status", reasonCode: "invalid_status" },
        ],
      },
    });
    const service = createReviewCorrectionService({ repository: fake.repo });
    const model = await service.getMerchantReview(ids.owner, ids.merchant);
    assert.deepEqual(model?.findings.map((finding) => finding.code), ["legal_name"]);
  }

  {
    const fake = repository({ status: "needs_attention" });
    fake.setEvents([{
      event_type: "phase2c_draft_review_needs_attention_v1",
      reason_code: "evidence_incomplete",
      metadata: { requested_finding_codes: ["approved_volume", "unknown_code"] },
      created_at: "2026-10-23T12:05:00.000Z",
    }]);
    const service = createReviewCorrectionService({ repository: fake.repo });
    await assert.rejects(
      () => service.getMerchantReview(ids.owner, ids.merchant),
      (error: unknown) => error instanceof ReviewCorrectionServiceError && error.code === "INVALID_STATE",
    );
  }

  const built = buildCorrectedDraftEvidenceSnapshot(baseMerchant as never, null, "2026-10-23T13:00:00.000Z");
  assert.deepEqual(Object.keys(built).sort(), ["adapterVersion", "evaluatedAt", "findings", "policyId", "policyStatus", "policyVersion", "schemaVersion"]);
  assert.equal(built.policyStatus, "draft");
  assert.ok(JSON.stringify(built).length < 16 * 1024);

  const businessBuilt = buildCorrectedDraftEvidenceSnapshot(
    { ...baseMerchant, subscription_plan: "corporate", merchant_tier: "corporate", business_registry_snapshot_id: ids.registry } as never,
    {
      id: ids.registry,
      business_type: "ltd",
      registered_name: "Sensitive Registered Name",
      registration_number: "RC-SENSITIVE",
      registration_status: "verified",
      directors_json: [{ name: "Sensitive Director", role: "director" }],
    } as never,
    "2026-10-23T13:00:00.000Z",
  );
  assert.equal(businessBuilt.policyId, "business_kyb_evidence");
  assert.equal(businessBuilt.policyStatus, "draft");
  assert.ok(JSON.stringify(businessBuilt).length < 16 * 1024);
  assert.equal(JSON.stringify(businessBuilt).includes("Sensitive Registered Name"), false);
  assert.equal(JSON.stringify(businessBuilt).includes("Sensitive Director"), false);

  assert.throws(
    () => buildCorrectedDraftEvidenceSnapshot({ ...baseMerchant, subscription_plan: "solo_plus" } as never, null, "2026-10-23T13:00:00.000Z"),
    (error: unknown) => error instanceof ReviewCorrectionServiceError && error.code === "INVALID_STATE",
  );

  console.log("Phase 2C-2C-B3 review-correction service tests passed.");
}

void run();
