import assert from "node:assert/strict";
import {
  assertSoloPlusEvidenceReusePolicy,
  evaluateSoloPlusEvidenceCandidates,
  evaluateSoloPlusEvidenceReuse,
  getSoloPlusEvidenceAssuranceRank,
  meetsSoloPlusEvidenceAssurance,
  selectBestReusableSoloPlusEvidence,
  SoloPlusEvidenceReuseError,
  type SoloPlusEvidenceCandidate,
  type SoloPlusEvidenceReusePolicy,
  validateSoloPlusEvidenceReusePolicy,
} from "../src/lib/solo-plus/evidence-reuse";

function buildValidPolicy(): SoloPlusEvidenceReusePolicy {
  return {
    version: "solo-plus-reuse-v1",
    rules: [
      {
        requirementCode: "bvn",
        allowReuse: true,
        allowedSourceTypes: ["verification_log"],
        minimumAssuranceLevel: "standard",
        maximumAgeDays: 365,
        requireIdentityMatch: true,
        requireSubjectMatch: false,
        policyRuleCode: "reuse_bvn_v1",
      },
      {
        requirementCode: "selfie_liveness",
        allowReuse: true,
        allowedSourceTypes: ["verification_log"],
        minimumAssuranceLevel: "enhanced",
        maximumAgeDays: 180,
        requireIdentityMatch: true,
        requireSubjectMatch: false,
        policyRuleCode: "reuse_selfie_v1",
      },
      {
        requirementCode: "id_document",
        allowReuse: true,
        allowedSourceTypes: ["verification_log", "merchant_document"],
        minimumAssuranceLevel: "standard",
        maximumAgeDays: 365,
        requireIdentityMatch: true,
        requireSubjectMatch: false,
        policyRuleCode: "reuse_id_document_v1",
      },
      {
        requirementCode: "proof_of_address",
        allowReuse: true,
        allowedSourceTypes: ["merchant_document", "verification_log"],
        minimumAssuranceLevel: "basic",
        maximumAgeDays: 90,
        requireIdentityMatch: true,
        requireSubjectMatch: false,
        policyRuleCode: "reuse_address_v1",
      },
      {
        requirementCode: "settlement_account",
        allowReuse: true,
        allowedSourceTypes: ["settlement_account", "verification_log"],
        minimumAssuranceLevel: "standard",
        maximumAgeDays: 180,
        requireIdentityMatch: false,
        requireSubjectMatch: true,
        policyRuleCode: "reuse_settlement_account_v1",
      },
      {
        requirementCode: "activity_profile",
        allowReuse: false,
        allowedSourceTypes: ["manual_submission"],
        minimumAssuranceLevel: "basic",
        maximumAgeDays: 30,
        requireIdentityMatch: false,
        requireSubjectMatch: false,
        policyRuleCode: "reuse_activity_profile_v1",
      },
    ],
  };
}

function buildCandidate(
  overrides: Partial<SoloPlusEvidenceCandidate> = {},
): SoloPlusEvidenceCandidate {
  return {
    evidenceId: "evidence-1",
    merchantId: "merchant-1",
    requirementCode: "bvn",
    sourceType: "verification_log",
    status: "passed",
    assuranceLevel: "standard",
    verificationLogId: "verification-log-1",
    sourceRowId: null,
    evidenceReference: "evidence-ref-1",
    providerReference: "provider-ref-1",
    completedAt: "2026-06-01T00:00:00.000Z",
    expiresAt: null,
    revokedAt: null,
    invalidatedAt: null,
    identityMatch: "match",
    subjectMatch: "not_applicable",
    ...overrides,
  };
}

function expectCode(fn: () => void, code: string) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof SoloPlusEvidenceReuseError);
    assert.equal(error.code, code);
    return true;
  });
}

function expectDecision(
  result: ReturnType<typeof evaluateSoloPlusEvidenceReuse>,
  expected: {
    outcome: string;
    reasonCode: string;
  },
) {
  assert.equal(result.outcome, expected.outcome);
  assert.equal(result.reasonCode, expected.reasonCode);
}

async function run() {
  const policy = buildValidPolicy();
  const evaluationTime = "2026-07-01T00:00:00.000Z";

  assert.deepEqual(validateSoloPlusEvidenceReusePolicy(policy), { valid: true });
  assertSoloPlusEvidenceReusePolicy(policy);

  const blankVersionPolicy = { ...policy, version: " " };
  const blankVersionResult = validateSoloPlusEvidenceReusePolicy(blankVersionPolicy);
  assert.equal(blankVersionResult.valid, false);
  if (blankVersionResult.valid !== false) {
    throw new Error("Expected blank version validation failure.");
  }
  assert.ok(blankVersionResult.issues.some((issue) => issue.field === "version"));

  expectCode(
    () =>
      assertSoloPlusEvidenceReusePolicy({
        ...policy,
        rules: [...policy.rules, policy.rules[0]],
      }),
    "SOLO_PLUS_REUSE_DUPLICATE_POLICY_RULE",
  );

  expectCode(
    () =>
      assertSoloPlusEvidenceReusePolicy({
        ...policy,
        rules: policy.rules.slice(0, 5),
      }),
    "SOLO_PLUS_REUSE_POLICY_INVALID",
  );

  expectCode(
    () =>
      assertSoloPlusEvidenceReusePolicy({
        ...policy,
        rules: [
          ...policy.rules.slice(0, 5),
          {
            ...policy.rules[5],
            requirementCode: "admin_review" as never,
          },
        ],
      }),
    "SOLO_PLUS_REUSE_POLICY_INVALID",
  );

  expectCode(
    () =>
      assertSoloPlusEvidenceReusePolicy({
        ...policy,
        rules: policy.rules.map((rule, index) =>
          index === 0 ? { ...rule, maximumAgeDays: 0 } : rule,
        ),
      }),
    "SOLO_PLUS_REUSE_POLICY_INVALID",
  );

  expectCode(
    () =>
      assertSoloPlusEvidenceReusePolicy({
        ...policy,
        rules: policy.rules.map((rule, index) =>
          index === 0 ? { ...rule, maximumAgeDays: 3.5 } : rule,
        ),
      }),
    "SOLO_PLUS_REUSE_POLICY_INVALID",
  );

  expectCode(
    () =>
      assertSoloPlusEvidenceReusePolicy({
        ...policy,
        rules: policy.rules.map((rule, index) =>
          index === 0 ? { ...rule, allowedSourceTypes: [] } : rule,
        ),
      }),
    "SOLO_PLUS_REUSE_POLICY_INVALID",
  );

  const activityRule = policy.rules.find((rule) => rule.requirementCode === "activity_profile");
  assert.ok(activityRule);
  assert.equal(activityRule?.allowReuse, false);

  const reusableDecision = evaluateSoloPlusEvidenceReuse({
    targetMerchantId: "merchant-1",
    targetRequirementCode: "bvn",
    candidate: buildCandidate(),
    policy,
    evaluatedAt: evaluationTime,
  });
  expectDecision(reusableDecision, {
    outcome: "reusable",
    reasonCode: "ELIGIBLE_UNDER_POLICY",
  });
  assert.equal(reusableDecision.policyRuleApplied, "reuse_bvn_v1");
  assert.equal(reusableDecision.originalCompletedAt, "2026-06-01T00:00:00.000Z");

  const exactBoundaryDecision = evaluateSoloPlusEvidenceReuse({
    targetMerchantId: "merchant-1",
    targetRequirementCode: "bvn",
    candidate: buildCandidate({
      completedAt: "2025-07-01T00:00:00.000Z",
    }),
    policy,
    evaluatedAt: evaluationTime,
  });
  expectDecision(exactBoundaryDecision, {
    outcome: "reusable",
    reasonCode: "ELIGIBLE_UNDER_POLICY",
  });

  expectDecision(
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: "merchant-2",
      targetRequirementCode: "bvn",
      candidate: buildCandidate(),
      policy,
      evaluatedAt: evaluationTime,
    }),
    { outcome: "not_reusable", reasonCode: "MERCHANT_MISMATCH" },
  );

  expectDecision(
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: "merchant-1",
      targetRequirementCode: "id_document",
      candidate: buildCandidate(),
      policy,
      evaluatedAt: evaluationTime,
    }),
    { outcome: "not_reusable", reasonCode: "REQUIREMENT_MISMATCH" },
  );

  expectDecision(
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: "merchant-1",
      targetRequirementCode: "activity_profile",
      candidate: buildCandidate({
        requirementCode: "activity_profile",
        sourceType: "manual_submission",
        subjectMatch: "not_applicable",
      }),
      policy,
      evaluatedAt: evaluationTime,
    }),
    { outcome: "not_reusable", reasonCode: "POLICY_REUSE_DISABLED" },
  );

  expectDecision(
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: "merchant-1",
      targetRequirementCode: "bvn",
      candidate: buildCandidate({ sourceType: "merchant_document" }),
      policy,
      evaluatedAt: evaluationTime,
    }),
    { outcome: "not_reusable", reasonCode: "SOURCE_TYPE_NOT_ALLOWED" },
  );

  expectDecision(
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: "merchant-1",
      targetRequirementCode: "bvn",
      candidate: buildCandidate({ status: "failed" }),
      policy,
      evaluatedAt: evaluationTime,
    }),
    { outcome: "not_reusable", reasonCode: "EVIDENCE_NOT_PASSED" },
  );

  expectDecision(
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: "merchant-1",
      targetRequirementCode: "bvn",
      candidate: buildCandidate({ status: "pending" }),
      policy,
      evaluatedAt: evaluationTime,
    }),
    { outcome: "not_reusable", reasonCode: "EVIDENCE_NOT_PASSED" },
  );

  expectDecision(
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: "merchant-1",
      targetRequirementCode: "bvn",
      candidate: buildCandidate({ status: "revoked" }),
      policy,
      evaluatedAt: evaluationTime,
    }),
    { outcome: "not_reusable", reasonCode: "EVIDENCE_REVOKED" },
  );

  expectDecision(
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: "merchant-1",
      targetRequirementCode: "bvn",
      candidate: buildCandidate({ status: "invalidated" }),
      policy,
      evaluatedAt: evaluationTime,
    }),
    { outcome: "not_reusable", reasonCode: "EVIDENCE_INVALIDATED" },
  );

  expectDecision(
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: "merchant-1",
      targetRequirementCode: "bvn",
      candidate: buildCandidate({ revokedAt: "2026-06-15T00:00:00.000Z" }),
      policy,
      evaluatedAt: evaluationTime,
    }),
    { outcome: "not_reusable", reasonCode: "EVIDENCE_REVOKED" },
  );

  expectDecision(
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: "merchant-1",
      targetRequirementCode: "bvn",
      candidate: buildCandidate({ invalidatedAt: "2026-06-15T00:00:00.000Z" }),
      policy,
      evaluatedAt: evaluationTime,
    }),
    { outcome: "not_reusable", reasonCode: "EVIDENCE_INVALIDATED" },
  );

  expectDecision(
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: "merchant-1",
      targetRequirementCode: "bvn",
      candidate: buildCandidate({ completedAt: null }),
      policy,
      evaluatedAt: evaluationTime,
    }),
    { outcome: "not_reusable", reasonCode: "MISSING_COMPLETION_DATE" },
  );

  expectDecision(
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: "merchant-1",
      targetRequirementCode: "bvn",
      candidate: buildCandidate({ completedAt: "not-a-date" }),
      policy,
      evaluatedAt: evaluationTime,
    }),
    { outcome: "not_reusable", reasonCode: "INVALID_COMPLETION_DATE" },
  );

  expectDecision(
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: "merchant-1",
      targetRequirementCode: "bvn",
      candidate: buildCandidate({ completedAt: "2026-08-01T00:00:00.000Z" }),
      policy,
      evaluatedAt: evaluationTime,
    }),
    { outcome: "not_reusable", reasonCode: "COMPLETION_DATE_IN_FUTURE" },
  );

  expectDecision(
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: "merchant-1",
      targetRequirementCode: "bvn",
      candidate: buildCandidate({ expiresAt: "2026-06-30T23:59:59.000Z" }),
      policy,
      evaluatedAt: evaluationTime,
    }),
    { outcome: "not_reusable", reasonCode: "EVIDENCE_EXPIRED" },
  );

  expectDecision(
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: "merchant-1",
      targetRequirementCode: "bvn",
      candidate: buildCandidate({ expiresAt: "invalid-date" }),
      policy,
      evaluatedAt: evaluationTime,
    }),
    { outcome: "not_reusable", reasonCode: "INVALID_EXPIRY_DATE" },
  );

  expectDecision(
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: "merchant-1",
      targetRequirementCode: "bvn",
      candidate: buildCandidate({ completedAt: "2025-06-30T23:59:59.999Z" }),
      policy,
      evaluatedAt: evaluationTime,
    }),
    { outcome: "not_reusable", reasonCode: "EVIDENCE_TOO_OLD" },
  );

  expectDecision(
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: "merchant-1",
      targetRequirementCode: "bvn",
      candidate: buildCandidate({
        verificationLogId: null,
        sourceRowId: null,
        evidenceReference: null,
        providerReference: null,
      }),
      policy,
      evaluatedAt: evaluationTime,
    }),
    { outcome: "not_reusable", reasonCode: "MISSING_SOURCE_PROVENANCE" },
  );

  expectDecision(
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: "merchant-1",
      targetRequirementCode: "bvn",
      candidate: buildCandidate({ assuranceLevel: "basic" }),
      policy,
      evaluatedAt: evaluationTime,
    }),
    { outcome: "not_reusable", reasonCode: "INSUFFICIENT_ASSURANCE" },
  );

  expectDecision(
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: "merchant-1",
      targetRequirementCode: "bvn",
      candidate: buildCandidate({ identityMatch: "mismatch" }),
      policy,
      evaluatedAt: evaluationTime,
    }),
    { outcome: "not_reusable", reasonCode: "IDENTITY_MISMATCH" },
  );

  expectDecision(
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: "merchant-1",
      targetRequirementCode: "settlement_account",
      candidate: buildCandidate({
        requirementCode: "settlement_account",
        sourceType: "settlement_account",
        assuranceLevel: "standard",
        identityMatch: "not_applicable",
        subjectMatch: "mismatch",
      }),
      policy,
      evaluatedAt: evaluationTime,
    }),
    { outcome: "not_reusable", reasonCode: "SUBJECT_MISMATCH" },
  );

  expectDecision(
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: "merchant-1",
      targetRequirementCode: "bvn",
      candidate: buildCandidate({ identityMatch: "unknown" }),
      policy,
      evaluatedAt: evaluationTime,
    }),
    { outcome: "needs_review", reasonCode: "IDENTITY_MATCH_UNKNOWN" },
  );

  expectDecision(
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: "merchant-1",
      targetRequirementCode: "bvn",
      candidate: buildCandidate({ identityMatch: "not_applicable" }),
      policy,
      evaluatedAt: evaluationTime,
    }),
    { outcome: "needs_review", reasonCode: "IDENTITY_MATCH_UNKNOWN" },
  );

  expectDecision(
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: "merchant-1",
      targetRequirementCode: "settlement_account",
      candidate: buildCandidate({
        requirementCode: "settlement_account",
        sourceType: "settlement_account",
        assuranceLevel: "standard",
        identityMatch: "not_applicable",
        subjectMatch: "unknown",
      }),
      policy,
      evaluatedAt: evaluationTime,
    }),
    { outcome: "needs_review", reasonCode: "SUBJECT_MATCH_UNKNOWN" },
  );

  expectDecision(
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: "merchant-1",
      targetRequirementCode: "settlement_account",
      candidate: buildCandidate({
        requirementCode: "settlement_account",
        sourceType: "settlement_account",
        assuranceLevel: "standard",
        identityMatch: "not_applicable",
        subjectMatch: "not_applicable",
      }),
      policy,
      evaluatedAt: evaluationTime,
    }),
    { outcome: "needs_review", reasonCode: "SUBJECT_MATCH_UNKNOWN" },
  );

  const originalCandidate = buildCandidate();
  const originalPolicy = buildValidPolicy();
  const candidateSnapshot = JSON.parse(JSON.stringify(originalCandidate));
  const policySnapshot = JSON.parse(JSON.stringify(originalPolicy));
  const firstDecision = evaluateSoloPlusEvidenceReuse({
    targetMerchantId: "merchant-1",
    targetRequirementCode: "bvn",
    candidate: originalCandidate,
    policy: originalPolicy,
    evaluatedAt: evaluationTime,
  });
  const secondDecision = evaluateSoloPlusEvidenceReuse({
    targetMerchantId: "merchant-1",
    targetRequirementCode: "bvn",
    candidate: originalCandidate,
    policy: originalPolicy,
    evaluatedAt: evaluationTime,
  });
  assert.deepEqual(originalCandidate, candidateSnapshot);
  assert.deepEqual(originalPolicy, policySnapshot);
  assert.deepEqual(firstDecision, secondDecision);

  const earlierDecision = evaluateSoloPlusEvidenceReuse({
    targetMerchantId: "merchant-1",
    targetRequirementCode: "proof_of_address",
    candidate: buildCandidate({
      requirementCode: "proof_of_address",
      sourceType: "merchant_document",
      assuranceLevel: "basic",
      completedAt: "2026-04-02T00:00:00.000Z",
      identityMatch: "match",
    }),
    policy,
    evaluatedAt: "2026-06-30T00:00:00.000Z",
  });
  const laterDecision = evaluateSoloPlusEvidenceReuse({
    targetMerchantId: "merchant-1",
    targetRequirementCode: "proof_of_address",
    candidate: buildCandidate({
      requirementCode: "proof_of_address",
      sourceType: "merchant_document",
      assuranceLevel: "basic",
      completedAt: "2026-04-02T00:00:00.000Z",
      identityMatch: "match",
    }),
    policy,
    evaluatedAt: "2026-07-02T00:00:00.000Z",
  });
  expectDecision(earlierDecision, {
    outcome: "reusable",
    reasonCode: "ELIGIBLE_UNDER_POLICY",
  });
  expectDecision(laterDecision, {
    outcome: "not_reusable",
    reasonCode: "EVIDENCE_TOO_OLD",
  });

  const batchCandidates = [
    buildCandidate({ evidenceId: "candidate-a", assuranceLevel: "standard", completedAt: "2026-06-15T00:00:00.000Z" }),
    buildCandidate({ evidenceId: "candidate-b", assuranceLevel: "enhanced", completedAt: "2026-06-10T00:00:00.000Z" }),
    buildCandidate({ evidenceId: "candidate-c", assuranceLevel: "enhanced", completedAt: "2026-06-10T00:00:00.000Z", identityMatch: "unknown" }),
  ];
  const batchDecisions = evaluateSoloPlusEvidenceCandidates({
    targetMerchantId: "merchant-1",
    targetRequirementCode: "bvn",
    candidates: batchCandidates,
    policy,
    evaluatedAt: evaluationTime,
  });
  assert.deepEqual(batchDecisions.map((decision) => decision.evidenceId), [
    "candidate-a",
    "candidate-b",
    "candidate-c",
  ]);
  const best = selectBestReusableSoloPlusEvidence(batchDecisions);
  assert.ok(best);
  assert.equal(best?.evidenceId, "candidate-b");

  assert.equal(getSoloPlusEvidenceAssuranceRank("basic"), 1);
  assert.equal(getSoloPlusEvidenceAssuranceRank("standard"), 2);
  assert.equal(getSoloPlusEvidenceAssuranceRank("enhanced"), 3);
  assert.equal(meetsSoloPlusEvidenceAssurance("enhanced", "standard"), true);
  assert.equal(meetsSoloPlusEvidenceAssurance("basic", "standard"), false);

  expectCode(
    () =>
      evaluateSoloPlusEvidenceReuse({
        targetMerchantId: "merchant-1",
        targetRequirementCode: "bvn",
        candidate: buildCandidate(),
        policy,
        evaluatedAt: "not-a-date",
      }),
    "SOLO_PLUS_REUSE_INVALID_DATE",
  );

  const sensitiveDecision = evaluateSoloPlusEvidenceReuse({
    targetMerchantId: "merchant-1",
    targetRequirementCode: "bvn",
    candidate: buildCandidate({
      evidenceReference: "safe-ref-1",
      providerReference: "provider-ref-1",
    }),
    policy,
    evaluatedAt: evaluationTime,
  });
  assert.equal(JSON.stringify(sensitiveDecision).includes("12345678901"), false);

  console.log("solo-plus-evidence-reuse.test.ts passed");
}

void run();
