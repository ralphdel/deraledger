import assert from "node:assert/strict";

import { buildSoloPlusBrowserCaseDto } from "../src/lib/solo-plus/server/route-contracts";
import type {
  SoloPlusCaseEventRecord,
  SoloPlusCaseRecord,
  SoloPlusCaseRequirementRecord,
} from "../src/lib/solo-plus/repository";

function buildCaseRecord(
  overrides: Partial<SoloPlusCaseRecord> = {},
): SoloPlusCaseRecord {
  return {
    id: overrides.id || "11111111-1111-4111-8111-111111111111",
    merchantId: overrides.merchantId ?? "22222222-2222-4222-8222-222222222222",
    onboardingSessionId: overrides.onboardingSessionId ?? null,
    flowOrigin: overrides.flowOrigin ?? "upgrade",
    sourcePlan: overrides.sourcePlan ?? "solo_lite",
    targetPlan: "solo_plus",
    caseStatus: overrides.caseStatus ?? "verification_pending",
    paymentStatus: overrides.paymentStatus ?? "paid",
    refundStatus: overrides.refundStatus ?? "none",
    paymentRecordId: overrides.paymentRecordId ?? null,
    paymentProvider: overrides.paymentProvider ?? "paystack",
    paymentReference: overrides.paymentReference ?? "solo-plus-pay-ref",
    expectedAmount: overrides.expectedAmount ?? "13000.00",
    paymentCurrency: "NGN",
    requirementsPolicyVersion: overrides.requirementsPolicyVersion ?? "solo-plus-payment-init-v1",
    requirementsSnapshot: overrides.requirementsSnapshot ?? { hidden: true },
    activePlanSnapshot: overrides.activePlanSnapshot ?? "solo_lite",
    rejectionReason: overrides.rejectionReason ?? null,
    approvedAt: overrides.approvedAt ?? null,
    approvedByAdminId: overrides.approvedByAdminId ?? null,
    rejectedAt: overrides.rejectedAt ?? null,
    rejectedByAdminId: overrides.rejectedByAdminId ?? null,
    reopenedAt: overrides.reopenedAt ?? null,
    reopenedByAdminId: overrides.reopenedByAdminId ?? null,
    idempotencyKey: overrides.idempotencyKey ?? "solo-plus-case-idem",
    activationIdempotencyKey: overrides.activationIdempotencyKey ?? null,
    refundIdempotencyKey: overrides.refundIdempotencyKey ?? null,
    rowVersion: overrides.rowVersion ?? 4,
    auditMetadata: overrides.auditMetadata ?? { internalOnly: true },
    createdAt: overrides.createdAt ?? "2026-07-10T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-12T00:00:00.000Z",
  };
}

function buildRequirementRecord(
  overrides: Partial<SoloPlusCaseRequirementRecord> & {
    requirementCode: SoloPlusCaseRequirementRecord["requirementCode"];
  },
): SoloPlusCaseRequirementRecord {
  return {
    id: `${overrides.requirementCode}-requirement`,
    caseId: overrides.caseId || "11111111-1111-4111-8111-111111111111",
    requirementCode: overrides.requirementCode,
    requirementState: overrides.requirementState ?? "not_started",
    verificationLogId: overrides.verificationLogId ?? null,
    evidenceSourceType: overrides.evidenceSourceType ?? null,
    evidenceSourceId: overrides.evidenceSourceId ?? null,
    evidenceReference: overrides.evidenceReference ?? null,
    originalCompletedAt: overrides.originalCompletedAt ?? null,
    reuseDecisionAt: overrides.reuseDecisionAt ?? null,
    reuseReason: overrides.reuseReason ?? null,
    policyRuleApplied: overrides.policyRuleApplied ?? null,
    reviewedByAdminId: overrides.reviewedByAdminId ?? null,
    reviewNote: overrides.reviewNote ?? "internal review note",
    providerName: overrides.providerName ?? "trusted-provider",
    providerReference: overrides.providerReference ?? "provider-ref-1",
    failureReason: overrides.failureReason ?? "internal failure reason",
    completedAt: overrides.completedAt ?? null,
    metadata: overrides.metadata ?? { providerPayload: "hidden" },
    createdAt: overrides.createdAt ?? "2026-07-10T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-12T00:00:00.000Z",
  };
}

function buildReviewDecisionEvent(
  overrides: Partial<SoloPlusCaseEventRecord> = {},
): SoloPlusCaseEventRecord {
  return {
    id: overrides.id || "33333333-3333-4333-8333-333333333333",
    caseId: overrides.caseId || "11111111-1111-4111-8111-111111111111",
    eventType: overrides.eventType || "case_review_requested_more_information",
    previousState: overrides.previousState || { caseStatus: "manual_review" },
    newState: overrides.newState || { caseStatus: "verification_pending" },
    actorType: overrides.actorType || "admin",
    actorId: overrides.actorId ?? "admin-user-id",
    requestIdempotencyKey:
      overrides.requestIdempotencyKey ?? "review-idem-1",
    reason: overrides.reason ?? "Need clearer proof of address.",
    policyVersion: overrides.policyVersion ?? "solo-plus-policy-v1",
    createdAt: overrides.createdAt ?? "2026-07-11T00:00:00.000Z",
  };
}

function buildSafeDto(
  caseRecord: Partial<SoloPlusCaseRecord>,
  requirements: readonly SoloPlusCaseRequirementRecord[],
  latestReviewDecisionEvent: SoloPlusCaseEventRecord | null,
) {
  return buildSoloPlusBrowserCaseDto(
    buildCaseRecord(caseRecord),
    requirements,
    latestReviewDecisionEvent,
  );
}

async function run() {
  {
    const dto = buildSafeDto(
      { caseStatus: "verification_pending" },
      [buildRequirementRecord({ requirementCode: "id_document", requirementState: "not_started" })],
      null,
    );
    assert.equal(dto.reviewState, "verification_pending");
    assert.equal(dto.actionRequired, "complete_requirements");
    assert.equal(dto.merchantVisibleReason, null);
  }

  {
    const dto = buildSafeDto(
      { caseStatus: "verification_pending" },
      [buildRequirementRecord({ requirementCode: "proof_of_address", requirementState: "failed" })],
      buildReviewDecisionEvent({
        eventType: "case_review_requested_more_information",
        reason: "  <b>Need clearer</b>\r\nproof of address.\u0000  ",
      }),
    );
    assert.equal(dto.reviewState, "more_information_required");
    assert.equal(dto.actionRequired, "resubmit_information");
    assert.equal(dto.merchantVisibleReason, "Need clearer proof of address.");
    assert.equal(dto.reviewOutcome, "verification_pending");
    assert.equal(dto.statusChangedAt, "2026-07-11T00:00:00.000Z");
  }

  {
    const dto = buildSafeDto(
      {
        caseStatus: "approved",
        approvedAt: "2026-07-12T02:00:00.000Z",
      },
      [buildRequirementRecord({ requirementCode: "bvn", requirementState: "passed" })],
      buildReviewDecisionEvent({
        eventType: "case_approved",
        reason: "Old more-info event should not survive.",
        createdAt: "2026-07-12T02:00:00.000Z",
      }),
    );
    assert.equal(dto.reviewState, "approved");
    assert.equal(dto.actionRequired, "none");
    assert.equal(dto.merchantVisibleReason, null);
    assert.equal(dto.activationState, "approved_pending_activation");
  }

  {
    const dto = buildSafeDto(
      {
        caseStatus: "rejected",
        rejectionReason: "  <script>alert(1)</script> KYC mismatch ",
        rejectedAt: "2026-07-12T03:00:00.000Z",
        refundStatus: "review_required",
      },
      [buildRequirementRecord({ requirementCode: "bvn", requirementState: "failed" })],
      buildReviewDecisionEvent({
        eventType: "case_rejected",
        reason: "  <script>alert(1)</script> KYC mismatch ",
        createdAt: "2026-07-12T03:00:00.000Z",
      }),
    );
    assert.equal(dto.reviewState, "rejected");
    assert.equal(dto.actionRequired, "none");
    assert.equal(dto.merchantVisibleReason, "alert(1) KYC mismatch");
    assert.equal(dto.statusChangedAt, "2026-07-12T03:00:00.000Z");
  }

  {
    const dto = buildSafeDto(
      { caseStatus: "manual_review" },
      [buildRequirementRecord({ requirementCode: "settlement_account", requirementState: "needs_review" })],
      null,
    );
    assert.equal(dto.reviewState, "under_review");
    assert.equal(dto.actionRequired, "none");
  }

  {
    const dto = buildSafeDto(
      {
        caseStatus: "approved",
        approvedAt: "2026-07-12T04:00:00.000Z",
        activationIdempotencyKey: "activation-idem-1",
      },
      [buildRequirementRecord({ requirementCode: "selfie_liveness", requirementState: "passed" })],
      buildReviewDecisionEvent({
        eventType: "case_approved",
        createdAt: "2026-07-12T04:00:00.000Z",
      }),
    );
    assert.equal(dto.reviewState, "approved");
    assert.equal(dto.activationState, "activated");
  }

  {
    const dto = buildSafeDto(
      { caseStatus: "verification_pending" },
      [
        buildRequirementRecord({ requirementCode: "bvn", requirementState: "passed" }),
        buildRequirementRecord({ requirementCode: "selfie_liveness", requirementState: "reused" }),
        buildRequirementRecord({ requirementCode: "id_document", requirementState: "waived" }),
        buildRequirementRecord({ requirementCode: "proof_of_address", requirementState: "processing" }),
        buildRequirementRecord({ requirementCode: "settlement_account", requirementState: "pending" }),
        buildRequirementRecord({ requirementCode: "activity_profile", requirementState: "needs_review" }),
      ],
      null,
    );
    assert.equal(dto.actionRequired, "none");
    assert.equal(dto.requirements[0].requirementState, "passed");
    assert.equal(dto.requirements[1].requirementState, "reused");
    assert.equal(dto.requirements[2].requirementState, "waived");
    assert.equal(dto.requirements[3].requirementState, "processing");
    assert.equal(dto.requirements[4].requirementState, "pending");
    assert.equal(dto.requirements[5].requirementState, "needs_review");
  }

  {
    const dto = buildSafeDto(
      { caseStatus: "verification_pending" },
      [buildRequirementRecord({ requirementCode: "proof_of_address", requirementState: "failed" })],
      buildReviewDecisionEvent({
        eventType: "case_review_requested_more_information",
        reason: "Need updated address document.",
      }),
    ) as Record<string, unknown>;
    assert.equal("merchantId" in dto, false);
    assert.equal("paymentReference" in dto, false);
    assert.equal("paymentProvider" in dto, false);
    assert.equal("auditMetadata" in dto, false);
    assert.equal("reviewerAdminId" in dto, false);
    assert.equal("actorId" in dto, false);
    assert.equal("policyVersion" in dto, false);
    assert.equal("eventMetadata" in dto, false);
    assert.equal("riskNotes" in dto, false);
    assert.equal("providerPayload" in dto, false);

    const requirement = (dto.requirements as Array<Record<string, unknown>>)[0];
    assert.equal("providerReference" in requirement, false);
    assert.equal("providerName" in requirement, false);
    assert.equal("metadata" in requirement, false);
    assert.equal("reviewNote" in requirement, false);
    assert.equal("failureReason" in requirement, false);
  }

  console.log("solo-plus-browser-case-contract.test.ts passed");
}

void run();
