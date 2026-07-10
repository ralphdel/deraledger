import assert from "node:assert/strict";
import {
  SOLO_PLUS_KYC_REQUIREMENTS_POLICY,
  buildActivityProfileRequirementEvidence,
  buildDocumentRequirementEvidence,
  orchestrateSoloPlusRequirements,
  type SoloPlusCollectedRequirementEvidence,
} from "../src/lib/solo-plus/requirement-orchestration";
import type { SoloPlusEvidenceCandidate } from "../src/lib/solo-plus/evidence-reuse";
import type { SoloPlusCaseRequirementRecord } from "../src/lib/solo-plus/repository";
import { SOLO_PLUS_REQUIRED_REQUIREMENTS } from "../src/lib/solo-plus/state";

function buildRequirement(
  overrides: Partial<SoloPlusCaseRequirementRecord> & {
    requirementCode: SoloPlusCaseRequirementRecord["requirementCode"];
  },
): SoloPlusCaseRequirementRecord {
  return {
    id: `${overrides.requirementCode}-id`,
    caseId: "case-1",
    requirementState: "not_started",
    verificationLogId: null,
    evidenceSourceType: null,
    evidenceSourceId: null,
    evidenceReference: null,
    originalCompletedAt: null,
    reuseDecisionAt: null,
    reuseReason: null,
    policyRuleApplied: null,
    reviewedByAdminId: null,
    reviewNote: null,
    providerName: null,
    providerReference: null,
    failureReason: null,
    completedAt: null,
    metadata: {},
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
    requirementCode: overrides.requirementCode,
  };
}

function buildCandidate(
  overrides: Partial<SoloPlusEvidenceCandidate> & {
    requirementCode: SoloPlusEvidenceCandidate["requirementCode"];
  },
): SoloPlusEvidenceCandidate {
  return {
    evidenceId: `${overrides.requirementCode}-evidence-1`,
    merchantId: "merchant-1",
    sourceType: "verification_log",
    status: "passed",
    assuranceLevel: "enhanced",
    verificationLogId: "11111111-1111-4111-8111-111111111111",
    sourceRowId: "22222222-2222-4222-8222-222222222222",
    evidenceReference: `${overrides.requirementCode}-ref-1`,
    providerReference: `${overrides.requirementCode}-provider-ref-1`,
    completedAt: "2026-07-01T00:00:00.000Z",
    expiresAt: null,
    revokedAt: null,
    invalidatedAt: null,
    identityMatch: "match",
    subjectMatch: "match",
    ...overrides,
    requirementCode: overrides.requirementCode,
  };
}

function buildCollectedEvidence(): SoloPlusCollectedRequirementEvidence[] {
  return [
    buildDocumentRequirementEvidence("id_document", {
      storageKey: "kyc-documents/id-document.pdf",
      checksumSha256: "abc123",
      uploadedAt: "2026-07-10T00:00:00.000Z",
      contentType: "application/pdf",
      fileSizeBytes: 1024,
      providerName: "manual_upload",
      providerReference: "doc-upload-1",
      sourceId: "33333333-3333-4333-8333-333333333333",
    }),
    buildDocumentRequirementEvidence("proof_of_address", {
      storageKey: "kyc-documents/address.pdf",
      checksumSha256: "def456",
      uploadedAt: "2026-07-10T00:00:00.000Z",
      contentType: "application/pdf",
      fileSizeBytes: 2048,
      providerName: "manual_upload",
      providerReference: "doc-upload-2",
      sourceId: "33333333-3333-4333-8333-333333333333",
    }),
    buildActivityProfileRequirementEvidence({
      businessActivityType: "retail",
      expectedMonthlyTransactionValue: "500000",
      expectedTransactionCount: 120,
      typicalCustomerType: "consumers",
      reasonForHigherCollectionNeed: "seasonal demand",
      expectedSettlementBehaviour: "daily",
      submittedAt: "2026-07-10T00:00:00.000Z",
    }),
  ];
}

async function run() {
  const result = orchestrateSoloPlusRequirements({
    caseId: "case-1",
    merchantId: "merchant-1",
    currentRequirements: [],
    evidenceCandidates: [],
    collectedEvidence: [],
    policy: SOLO_PLUS_KYC_REQUIREMENTS_POLICY,
    evaluatedAt: "2026-07-10T00:00:00.000Z",
    now: () => new Date("2026-07-10T00:00:00.000Z"),
    generateId: (() => {
      let index = 1;
      return () => `generated-${index++}`;
    })(),
  });

  assert.deepEqual(
    result.requirements.map((requirement) => requirement.requirementCode),
    SOLO_PLUS_REQUIRED_REQUIREMENTS,
  );
  assert.equal(new Set(result.requirements.map((requirement) => requirement.requirementCode)).size, 6);
  assert.equal(result.requirements.some((requirement) => requirement.requirementCode === ("admin_review" as never)), false);

  const reusable = orchestrateSoloPlusRequirements({
    caseId: "case-1",
    merchantId: "merchant-1",
    currentRequirements: [],
    evidenceCandidates: [
      buildCandidate({
        requirementCode: "bvn",
        assuranceLevel: "standard",
        identityMatch: "match",
        subjectMatch: "not_applicable",
      }),
    ],
    collectedEvidence: [],
    policy: SOLO_PLUS_KYC_REQUIREMENTS_POLICY,
    evaluatedAt: "2026-07-10T00:00:00.000Z",
    now: () => new Date("2026-07-10T00:00:00.000Z"),
    generateId: (() => {
      let index = 1;
      return () => `reused-${index++}`;
    })(),
  });
  const reusedBvn = reusable.requirements.find((requirement) => requirement.requirementCode === "bvn");
  assert.equal(reusedBvn?.requirementState, "reused");
  assert.equal(reusedBvn?.policyRuleApplied, "reuse_bvn_v1");
  assert.equal(reusedBvn?.metadata.provenance != null, true);
  assert.equal(reusedBvn?.reuseDecisionAt, "2026-07-10T00:00:00.000Z");

  const stale = orchestrateSoloPlusRequirements({
    caseId: "case-1",
    merchantId: "merchant-1",
    currentRequirements: [buildRequirement({ requirementCode: "bvn", requirementState: "reused" })],
    evidenceCandidates: [
      buildCandidate({
        requirementCode: "bvn",
        assuranceLevel: "standard",
        identityMatch: "match",
        subjectMatch: "not_applicable",
        completedAt: "2024-01-01T00:00:00.000Z",
      }),
    ],
    collectedEvidence: [],
    policy: SOLO_PLUS_KYC_REQUIREMENTS_POLICY,
    evaluatedAt: "2026-07-10T00:00:00.000Z",
    now: () => new Date("2026-07-10T00:00:00.000Z"),
    generateId: () => "stale-1",
  });
  const staleBvn = stale.requirements.find((requirement) => requirement.requirementCode === "bvn");
  assert.equal(staleBvn?.requirementState, "pending");
  assert.equal(staleBvn?.failureReason, "EVIDENCE_TOO_OLD");

  for (const [reasonCode, candidate] of [
    [
      "MERCHANT_MISMATCH",
      buildCandidate({
        requirementCode: "bvn",
        assuranceLevel: "standard",
        identityMatch: "match",
        subjectMatch: "not_applicable",
        merchantId: "merchant-2",
      }),
    ],
    [
      "EVIDENCE_INVALIDATED",
      buildCandidate({
        requirementCode: "proof_of_address",
        sourceType: "merchant_document",
        assuranceLevel: "basic",
        status: "invalidated",
        identityMatch: "match",
        subjectMatch: "not_applicable",
      }),
    ],
    [
      "EVIDENCE_REVOKED",
      buildCandidate({
        requirementCode: "settlement_account",
        sourceType: "settlement_account",
        assuranceLevel: "standard",
        status: "revoked",
        identityMatch: "not_applicable",
        subjectMatch: "match",
      }),
    ],
  ] as const) {
    const outcome = orchestrateSoloPlusRequirements({
      caseId: "case-1",
      merchantId: "merchant-1",
      currentRequirements: [],
      evidenceCandidates: [candidate],
      collectedEvidence: [],
      policy: SOLO_PLUS_KYC_REQUIREMENTS_POLICY,
      evaluatedAt: "2026-07-10T00:00:00.000Z",
      now: () => new Date("2026-07-10T00:00:00.000Z"),
      generateId: () => `${reasonCode}-id`,
    });
    const requirement = outcome.requirements.find(
      (entry) => entry.requirementCode === candidate.requirementCode,
    );
    assert.equal(requirement?.requirementState, "pending");
    assert.equal(requirement?.failureReason, reasonCode);
  }

  const ambiguous = orchestrateSoloPlusRequirements({
    caseId: "case-1",
    merchantId: "merchant-1",
    currentRequirements: [],
    evidenceCandidates: [
      buildCandidate({
        requirementCode: "selfie_liveness",
        identityMatch: "unknown",
        subjectMatch: "not_applicable",
      }),
    ],
    collectedEvidence: [],
    policy: SOLO_PLUS_KYC_REQUIREMENTS_POLICY,
    evaluatedAt: "2026-07-10T00:00:00.000Z",
    now: () => new Date("2026-07-10T00:00:00.000Z"),
    generateId: () => "ambiguous-1",
  });
  const ambiguousSelfie = ambiguous.requirements.find(
    (requirement) => requirement.requirementCode === "selfie_liveness",
  );
  assert.equal(ambiguousSelfie?.requirementState, "needs_review");
  assert.match(String(ambiguousSelfie?.reviewNote), /requires review/i);

  const collected = orchestrateSoloPlusRequirements({
    caseId: "case-1",
    merchantId: null,
    currentRequirements: [],
    evidenceCandidates: [],
    collectedEvidence: buildCollectedEvidence(),
    policy: SOLO_PLUS_KYC_REQUIREMENTS_POLICY,
    evaluatedAt: "2026-07-10T00:00:00.000Z",
    now: () => new Date("2026-07-10T00:00:00.000Z"),
    generateId: (() => {
      let index = 1;
      return () => `collected-${index++}`;
    })(),
  });

  const idDocument = collected.requirements.find((requirement) => requirement.requirementCode === "id_document");
  assert.equal(idDocument?.requirementState, "pending");
  assert.equal(idDocument?.evidenceReference, "kyc-documents/id-document.pdf");
  assert.equal(idDocument?.metadata.storageKey, "kyc-documents/id-document.pdf");
  assert.equal("rawDocument" in (idDocument?.metadata || {}), false);
  assert.equal("documentBytes" in (idDocument?.metadata || {}), false);

  const proofOfAddress = collected.requirements.find((requirement) => requirement.requirementCode === "proof_of_address");
  assert.equal(proofOfAddress?.requirementState, "pending");
  assert.equal(proofOfAddress?.metadata.storageKey, "kyc-documents/address.pdf");

  const activityProfile = collected.requirements.find((requirement) => requirement.requirementCode === "activity_profile");
  assert.equal(activityProfile?.requirementState, "pending");
  assert.deepEqual(activityProfile?.metadata.activityProfile, {
    businessActivityType: "retail",
    expectedMonthlyTransactionValue: "500000",
    expectedTransactionCount: 120,
    typicalCustomerType: "consumers",
    reasonForHigherCollectionNeed: "seasonal demand",
    expectedSettlementBehaviour: "daily",
  });

  console.log("solo-plus-requirement-orchestration.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
