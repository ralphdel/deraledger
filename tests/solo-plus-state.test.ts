import assert from "node:assert/strict";
import {
  SOLO_PLUS_REQUIRED_REQUIREMENTS,
  SoloPlusDomainError,
  areAllSoloPlusRequirementsSatisfied,
  assertSoloPlusCaseConsistency,
  assertSoloPlusCaseTransition,
  assertSoloPlusReopenAllowed,
  assertSoloPlusRequirementConsistency,
  assertSoloPlusRequirementTransition,
  canTransitionSoloPlusCase,
  canTransitionSoloPlusRequirement,
  getMissingSoloPlusRequirements,
  isSatisfiedSoloPlusRequirementState,
  isSoloPlusCaseStatus,
  isSoloPlusRequirementCode,
  isSoloPlusRequirementState,
  isTerminalSoloPlusCaseStatus,
  isTerminalSoloPlusRequirementState,
  validateSoloPlusCaseConsistency,
  validateSoloPlusRequirementConsistency,
} from "../src/lib/solo-plus/state";

function expectCode(fn: () => void, code: string) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof SoloPlusDomainError);
    assert.equal(error.code, code);
    return true;
  });
}

function expectIssues(
  result: ReturnType<typeof validateSoloPlusCaseConsistency> | ReturnType<typeof validateSoloPlusRequirementConsistency>,
) {
  assert.equal(result.ok, false);
  if (result.ok !== false) {
    throw new Error("Expected validation failure.");
  }
  assert.ok(result.issues.length > 0);
}

async function run() {
  assert.equal(isSoloPlusCaseStatus("draft"), true);
  assert.equal(isSoloPlusCaseStatus("archived"), false);
  assert.equal(isSoloPlusRequirementCode("bvn"), true);
  assert.equal(isSoloPlusRequirementCode("admin_review"), false);
  assert.equal(isSoloPlusRequirementState("passed"), true);
  assert.equal(isSoloPlusRequirementState("verified"), false);

  assert.equal(canTransitionSoloPlusCase("draft", "awaiting_payment"), true);
  assert.equal(canTransitionSoloPlusCase("awaiting_payment", "rejected"), false);
  assert.equal(canTransitionSoloPlusCase("verification_pending", "manual_review"), true);
  assert.equal(canTransitionSoloPlusCase("manual_review", "approved"), true);
  assert.equal(canTransitionSoloPlusCase("approved", "cancelled"), false);
  assert.equal(canTransitionSoloPlusCase("cancelled", "draft"), false);

  assertSoloPlusCaseTransition("draft", "awaiting_payment");
  expectCode(() => assertSoloPlusCaseTransition("draft", "approved"), "SOLO_PLUS_INVALID_CASE_TRANSITION");
  assertSoloPlusCaseTransition("awaiting_payment", "verification_pending");
  expectCode(
    () => assertSoloPlusCaseTransition("awaiting_payment", "rejected"),
    "SOLO_PLUS_INVALID_CASE_TRANSITION",
  );
  assertSoloPlusCaseTransition("verification_pending", "manual_review");
  expectCode(
    () => assertSoloPlusCaseTransition("verification_pending", "approved"),
    "SOLO_PLUS_INVALID_CASE_TRANSITION",
  );
  assertSoloPlusCaseTransition("manual_review", "approved");
  assertSoloPlusCaseTransition("manual_review", "verification_pending");
  expectCode(() => assertSoloPlusCaseTransition("approved", "manual_review"), "SOLO_PLUS_TERMINAL_CASE");
  expectCode(() => assertSoloPlusCaseTransition("cancelled", "draft"), "SOLO_PLUS_TERMINAL_CASE");
  expectCode(
    () => assertSoloPlusCaseTransition("rejected", "verification_pending"),
    "SOLO_PLUS_REOPEN_REQUIRED",
  );
  assert.equal(isTerminalSoloPlusCaseStatus("approved"), true);
  assert.equal(isTerminalSoloPlusCaseStatus("rejected"), true);
  assert.equal(isTerminalSoloPlusCaseStatus("manual_review"), false);
  assertSoloPlusReopenAllowed("rejected");
  expectCode(() => assertSoloPlusReopenAllowed("manual_review"), "SOLO_PLUS_REOPEN_REQUIRED");

  assert.equal(canTransitionSoloPlusRequirement("not_started", "pending"), true);
  assert.equal(canTransitionSoloPlusRequirement("processing", "passed"), true);
  assert.equal(canTransitionSoloPlusRequirement("failed", "pending"), true);
  assert.equal(canTransitionSoloPlusRequirement("passed", "pending"), false);
  assert.equal(canTransitionSoloPlusRequirement("reused", "processing"), false);
  assert.equal(canTransitionSoloPlusRequirement("waived", "pending"), false);
  assertSoloPlusRequirementTransition("not_started", "pending");
  assertSoloPlusRequirementTransition("processing", "passed");
  assertSoloPlusRequirementTransition("failed", "pending");
  expectCode(
    () => assertSoloPlusRequirementTransition("passed", "pending"),
    "SOLO_PLUS_INVALID_REQUIREMENT_TRANSITION",
  );
  expectCode(
    () => assertSoloPlusRequirementTransition("reused", "processing"),
    "SOLO_PLUS_INVALID_REQUIREMENT_TRANSITION",
  );
  expectCode(
    () => assertSoloPlusRequirementTransition("waived", "pending"),
    "SOLO_PLUS_INVALID_REQUIREMENT_TRANSITION",
  );
  assert.equal(isSatisfiedSoloPlusRequirementState("passed"), true);
  assert.equal(isSatisfiedSoloPlusRequirementState("reused"), true);
  assert.equal(isSatisfiedSoloPlusRequirementState("waived"), true);
  assert.equal(isSatisfiedSoloPlusRequirementState("pending"), false);
  assert.equal(isTerminalSoloPlusRequirementState("waived"), true);
  assert.equal(isTerminalSoloPlusRequirementState("processing"), false);

  assert.deepEqual(validateSoloPlusCaseConsistency({
    caseStatus: "approved",
    paymentStatus: "paid",
    refundStatus: "none",
    approvedAt: new Date().toISOString(),
    approvedByAdminId: "admin-1",
  }), { ok: true });

  expectIssues(validateSoloPlusCaseConsistency({
    caseStatus: "approved",
    paymentStatus: "pending",
    refundStatus: "none",
    approvedAt: new Date().toISOString(),
    approvedByAdminId: "admin-1",
  }));

  expectIssues(validateSoloPlusCaseConsistency({
    caseStatus: "approved",
    paymentStatus: "paid",
    refundStatus: "review_required",
    approvedAt: new Date().toISOString(),
    approvedByAdminId: "admin-1",
  }));

  expectIssues(validateSoloPlusCaseConsistency({
    caseStatus: "rejected",
    paymentStatus: "paid",
    refundStatus: "none",
    rejectedAt: new Date().toISOString(),
    rejectedByAdminId: "admin-1",
    rejectionReason: "Declined",
  }));

  expectIssues(validateSoloPlusCaseConsistency({
    caseStatus: "cancelled",
    paymentStatus: "paid",
    refundStatus: "none",
  }));

  expectIssues(validateSoloPlusCaseConsistency({
    caseStatus: "rejected",
    paymentStatus: "pending",
    refundStatus: "none",
  }));

  expectIssues(validateSoloPlusCaseConsistency({
    caseStatus: "manual_review",
    paymentStatus: "pending",
    refundStatus: "none",
    approvedAt: new Date().toISOString(),
    approvedByAdminId: "admin-1",
  }));

  expectIssues(validateSoloPlusCaseConsistency({
    caseStatus: "verification_pending",
    paymentStatus: "pending",
    refundStatus: "none",
    rejectedAt: new Date().toISOString(),
    rejectedByAdminId: "admin-1",
    rejectionReason: "Nope",
  }));

  assert.deepEqual(validateSoloPlusRequirementConsistency({
    code: "bvn",
    state: "passed",
    completedAt: new Date().toISOString(),
  }), { ok: true });

  expectIssues(validateSoloPlusRequirementConsistency({
    code: "bvn",
    state: "passed",
  }));

  assert.deepEqual(validateSoloPlusRequirementConsistency({
    code: "selfie_liveness",
    state: "reused",
    completedAt: new Date().toISOString(),
    originalCompletedAt: new Date().toISOString(),
    reuseDecisionAt: new Date().toISOString(),
    reuseReason: "same merchant evidence still valid",
    policyRuleApplied: "policy-v1",
    verificationLogId: "log-1",
  }), { ok: true });

  expectIssues(validateSoloPlusRequirementConsistency({
    code: "selfie_liveness",
    state: "reused",
    completedAt: new Date().toISOString(),
    originalCompletedAt: new Date().toISOString(),
    reuseDecisionAt: new Date().toISOString(),
    reuseReason: "same merchant evidence still valid",
    policyRuleApplied: "policy-v1",
  }));

  assert.deepEqual(validateSoloPlusRequirementConsistency({
    code: "activity_profile",
    state: "waived",
    completedAt: new Date().toISOString(),
    reviewedByAdminId: "admin-1",
    reviewNote: "Manual waiver",
    policyRuleApplied: "waiver-v1",
  }), { ok: true });

  expectIssues(validateSoloPlusRequirementConsistency({
    code: "activity_profile",
    state: "waived",
    completedAt: new Date().toISOString(),
    reviewedByAdminId: "admin-1",
    reviewNote: "Manual waiver",
  }));

  assert.equal(
    areAllSoloPlusRequirementsSatisfied(
      SOLO_PLUS_REQUIRED_REQUIREMENTS.map((code) => ({ code, state: "passed" as const })),
    ),
    true,
  );

  assert.deepEqual(
    getMissingSoloPlusRequirements([
      { code: "bvn", state: "passed" },
      { code: "selfie_liveness", state: "passed" },
      { code: "id_document", state: "passed" },
      { code: "proof_of_address", state: "passed" },
      { code: "settlement_account", state: "passed" },
    ]),
    ["activity_profile"],
  );

  assert.equal(
    areAllSoloPlusRequirementsSatisfied([
      { code: "bvn", state: "passed" },
      { code: "selfie_liveness", state: "passed" },
      { code: "id_document", state: "passed" },
      { code: "proof_of_address", state: "passed" },
      { code: "settlement_account", state: "passed" },
      { code: "activity_profile", state: "pending" },
    ]),
    false,
  );

  expectCode(
    () => getMissingSoloPlusRequirements([
      { code: "bvn", state: "passed" },
      { code: "bvn", state: "reused" },
    ]),
    "SOLO_PLUS_DUPLICATE_REQUIREMENT",
  );

  expectCode(
    () => getMissingSoloPlusRequirements([
      { code: "admin_review", state: "passed" },
    ]),
    "SOLO_PLUS_REQUIREMENTS_INCOMPLETE",
  );

  expectCode(
    () => getMissingSoloPlusRequirements([
      { code: "bvn", state: "passed" },
      { code: "admin_review", state: "passed" },
    ]),
    "SOLO_PLUS_REQUIREMENTS_INCOMPLETE",
  );

  assertSoloPlusCaseConsistency({
    caseStatus: "approved",
    paymentStatus: "paid",
    refundStatus: "none",
    approvedAt: new Date().toISOString(),
    approvedByAdminId: "admin-1",
  });

  assertSoloPlusRequirementConsistency({
    code: "bvn",
    state: "passed",
    completedAt: new Date().toISOString(),
  });

  console.log("solo-plus-state.test.ts passed");
}

void run();
