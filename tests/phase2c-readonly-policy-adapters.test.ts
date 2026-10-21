import assert from "node:assert/strict";
import { evaluateBusiness, evaluateSoloLite, evaluateStarter, projectSoloPlus, type SoloPlusProjectionInput } from "../src/lib/compliance/policy-adapters/adapters";
import { observationFinding, parsePolicyPlan, POLICY_DEFINITIONS, safeTimestamp, safeMetadataReference, type EvidenceObservation } from "../src/lib/compliance/policy-adapters/contract";
import { beneficialOwnershipFinding, screeningFindings, authorityFinding, riskFinding } from "../src/lib/compliance/policy-adapters/findings";
import { composePolicyShadowResult } from "../src/lib/compliance/policy-adapters/shadow";
import { fromLegacyBusinessSnapshot, fromLegacyLiteSnapshot } from "../src/lib/compliance/policy-adapters/source-snapshots";

const at = "2026-10-20T00:00:00.000Z";
const caseId = "11111111-1111-4111-8111-111111111111";
const paymentId = "22222222-2222-4222-8222-222222222222";
const eventId = "33333333-3333-4333-8333-333333333333";
const logId = "44444444-4444-4444-8444-444444444444";
const merchantId = "66666666-6666-4666-8666-666666666666";
const reviewerId = "77777777-7777-4777-8777-777777777777";
const subject = { sourceType: "merchant" as const, sourceId: merchantId, sourceVersion: 1 };
const positive: EvidenceObservation = { status: "verified", sourceType: "verification_log", sourceId: logId, sourceVersion: 1, subject };

assert.deepEqual(["starter", "individual", "solo_lite", "solo_plus", "corporate", "business"].map((raw) => parsePolicyPlan(raw).canonicalPlan),
  ["starter", "solo_lite", "solo_lite", "solo_plus", "business", "business"]);
assert.equal(parsePolicyPlan("individual").provenance, "legacy_alias");
assert.equal(parsePolicyPlan("solo_plus").provenance, "canonical");
assert.equal(parsePolicyPlan("unexpected").canonicalPlan, null);
assert.equal(parsePolicyPlan(null).canonicalPlan, null);
assert.equal(parsePolicyPlan("12345678901").rawPlan, null);

const starter = evaluateStarter({ rawPlan: "starter", evaluatedAt: at, legacyVerificationStatus: "verified" });
assert.equal(starter.sourceAssurance, null);
assert.equal(starter.policy.policyStatus, "approved");
assert.ok(!JSON.stringify(starter).includes("liveFeaturesEnabled"));

const lite = evaluateSoloLite({ rawPlan: "individual", evaluatedAt: at, legacyVerificationStatus: "verified", evidence: {
  bvn: positive,
} });
assert.equal(lite.policy.policyStatus, "draft");
assert.equal(lite.sourceAssurance, null);
assert.equal(lite.projectability, "requires_manual_review");
assert.ok(lite.reasonCodes.includes("legacy_verified_not_canonical_approval"));
assert.equal(lite.findings.find((finding) => finding.code === "bvn")?.status, "verified");
assert.equal(lite.findings.find((finding) => finding.code === "nin")?.status, "missing");
assert.equal(lite.screening.find((finding) => finding.type === "sanctions")?.disposition, "not_screened");
assert.equal(lite.risk.rating, "unknown");
assert.equal(lite.payout.ownershipRelationship.status, "missing");

const business = evaluateBusiness({ rawPlan: "corporate", rawEntityType: "sole_proprietorship", evaluatedAt: at, legacyVerificationStatus: "verified",
  beneficialOwners: [{ roles: ["beneficial_owner"] }], authority: [{ claimedRole: "workspace_owner" }],
});
assert.equal(business.entityClassification.status, "ambiguous");
assert.equal(business.projectability, "requires_manual_review");
assert.equal(business.beneficialOwners[0]?.completeness, "incomplete");
assert.equal(business.authority[0]?.status, "unknown");
assert.equal(business.sourceAssurance, null);
assert.equal(business.policy.policyStatus, "draft");
assert.equal(evaluateBusiness({ rawPlan: "business", rawEntityType: "ltd", evaluatedAt: at }).entityClassification.canonicalEntityClass, "limited_liability_company");
assert.equal(evaluateBusiness({ rawPlan: "business", rawEntityType: "unknown", evaluatedAt: at }).entityClassification.status, "unknown");
assert.equal(beneficialOwnershipFinding({ roles: ["beneficial_owner"], directPercent: 5 }).completeness, "incomplete");
assert.equal(authorityFinding({ claimedRole: "director", subject: { sourceType: "affiliation", sourceId: caseId, sourceVersion: null } }).status, "unknown");

const clearWithoutProvenance = screeningFindings([{ type: "sanctions", disposition: "clear" }]);
assert.notEqual(clearWithoutProvenance[0].disposition, "clear");
assert.equal(screeningFindings(undefined)[0].disposition, "not_screened");
assert.equal(observationFinding("document", { status: "not_applicable", sourceType: "document" }, POLICY_DEFINITIONS.business, at).status, "unknown");
assert.equal(observationFinding("document", { status: "verified", sourceType: "document", expiresAt: "2026-10-19T00:00:00.000Z" }, POLICY_DEFINITIONS.business, at).status, "needs_review");

const requiredCodes = ["bvn", "selfie_liveness", "id_document", "proof_of_address", "settlement_account", "activity_profile"] as const;
const plusInput: SoloPlusProjectionInput = {
  rawPlan: "solo_plus", evaluatedAt: at,
  caseRecord: { id: caseId, merchantId, onboardingSessionId: null, flowOrigin: "upgrade", sourcePlan: "solo_lite", targetPlan: "solo_plus", rowVersion: 5, caseStatus: "approved", paymentStatus: "paid", paymentRecordId: paymentId, requirementsPolicyVersion: "controlled-launch-v1", approvedAt: at, approvedByAdminId: reviewerId },
  requirements: requiredCodes.map((requirementCode, index) => ({
    id: `55555555-5555-4555-8555-55555555555${index}`,
    caseId, sourceCaseVersion: 5,
    requirementCode, requirementState: "passed" as const,
    evidenceSourceType: "verification_log" as const, evidenceSourceId: logId,
    evidenceReference: null, verificationLogId: logId, originalCompletedAt: null, reuseDecisionAt: null,
    reuseReason: null, policyRuleApplied: null, reviewedByAdminId: null, reviewNote: null, completedAt: at,
  })),
  paymentRecord: { id: paymentId, solo_plus_case_id: caseId, merchant_id: merchantId, onboarding_session_id: null, payment_status: "successful", payment_purpose: "plan_upgrade", sourceCaseVersion: 5 },
  events: [{ id: eventId, caseId, eventType: "case_approved", policyVersion: "controlled-launch-v1", actorType: "admin", actorId: reviewerId, createdAt: at, previousState: { rowVersion: 4, caseStatus: "manual_review" }, newState: { rowVersion: 5, caseStatus: "approved", approvedByAdminId: reviewerId, approvedAt: at } }],
};
const plus = projectSoloPlus(plusInput);
assert.equal(plus.projectability, "confidently_projectable");
assert.equal(plus.sourceAssurance, "enhanced_verified");
assert.deepEqual(plus.findings.map((finding) => finding.code), requiredCodes);
assert.equal(plus.caseSource.rowVersion, 5);
assert.equal(plus.caseSource.reviewEventId, eventId);
assert.equal(plus.screening[0].disposition, "not_screened");
assert.equal(projectSoloPlus({ ...plusInput, caseRecord: { ...plusInput.caseRecord, caseStatus: "rejected" } }).sourceAssurance, null);
assert.equal(projectSoloPlus({ ...plusInput, requirements: plusInput.requirements.slice(1) }).sourceAssurance, null);
assert.equal(projectSoloPlus({ ...plusInput, requirements: [...plusInput.requirements, plusInput.requirements[0]] }).sourceAssurance, null);
assert.equal(projectSoloPlus({ ...plusInput, requirements: [
  { ...plusInput.requirements[0], requirementState: "waived", reviewNote: null, policyRuleApplied: null },
  ...plusInput.requirements.slice(1),
] }).sourceAssurance, null);

const poison = "12345678901";
const privateInput = evaluateSoloLite({ rawPlan: "solo_lite", evaluatedAt: at,
  evidence: { bvn: { status: "verified", sourceType: "verification_log", sourceId: poison } },
});
assert.equal(privateInput.findings.find((finding) => finding.code === "bvn")?.source?.sourceId, null);
assert.ok(!JSON.stringify(privateInput).includes(poison));
assert.ok(!JSON.stringify(plus).includes("canCollectPayments"));
assert.ok(!JSON.stringify(business).includes("business_verified"));

const same = evaluateSoloLite({ rawPlan: "individual", evaluatedAt: at, legacyVerificationStatus: "verified", evidence: { bvn: positive } });
assert.deepEqual(lite, same);
const gate = { outcome: "allow" as const, value: { allowed: true }, reasonCodes: [] };
const shadow = composePolicyShadowResult(gate, lite);
assert.equal(shadow.existingGate, gate);
assert.equal(shadow.existingGate.value, gate.value);
assert.equal(shadow.comparison, "requires_reconciliation");

const legacyLite = fromLegacyLiteSnapshot({
  id: caseId, subscription_plan: "individual", verification_status: "verified", bvn_status: "verified",
  owner_name: "Sensitive Person", email: "person@example.test", nin: "12345678901",
  settlement_account_number: "9999999999", utility_document_url: "private/document/path",
}, at);
const mappedLite = evaluateSoloLite(legacyLite);
assert.equal(mappedLite.plan.canonicalPlan, "solo_lite");
assert.equal(mappedLite.findings.find((finding) => finding.code === "distinct_liveness")?.status, "missing");
assert.equal(mappedLite.findings.find((finding) => finding.code === "manual_review")?.status, "missing");
assert.equal(mappedLite.findings.find((finding) => finding.code === "nin")?.status, "needs_review");
assert.equal(mappedLite.sourceAssurance, null);
for (const secret of ["Sensitive Person", "person@example.test", "12345678901", "9999999999", "private/document/path"]) {
  assert.ok(!JSON.stringify(legacyLite).includes(secret));
  assert.ok(!JSON.stringify(mappedLite).includes(secret));
}

const legacyBusiness = fromLegacyBusinessSnapshot({ id: caseId, subscription_plan: "corporate", owner_name: "Sensitive Person" }, {
  id: logId, business_type: "sole_proprietorship", registered_name: "Private Company",
  registration_number: "RC123456", registration_status: "active",
  directors_json: [{ name: "Private Director", role: "beneficial_owner" }],
}, at);
const mappedBusiness = evaluateBusiness(legacyBusiness);
assert.equal(mappedBusiness.entityClassification.status, "ambiguous");
assert.equal(mappedBusiness.beneficialOwners[0]?.completeness, "incomplete");
assert.equal(mappedBusiness.authority[0]?.status, "unknown");
for (const secret of ["Private Company", "RC123456", "Private Director", "Sensitive Person"]) {
  assert.ok(!JSON.stringify(legacyBusiness).includes(secret));
  assert.ok(!JSON.stringify(mappedBusiness).includes(secret));
}

// H1: all generic metadata is normalized or represented by opaque source references.
const privateText = "synthetic-private-value";
assert.equal(parsePolicyPlan(`${" ".repeat(10000)}INDIVIDUAL   `).rawPlan, "individual");
assert.equal(safeTimestamp(privateText), null);
assert.equal(safeMetadataReference("private text / token"), null);
assert.equal(safeMetadataReference("x".repeat(81)), null);
assert.equal(safeMetadataReference(poison), null);
assert.match(safeMetadataReference(privateText)!, /^sha256:[0-9a-f]{64}$/);
const invalidTime = evaluateSoloLite({ rawPlan: "individual", evaluatedAt: privateText, evidence: { bvn: positive } });
assert.equal(invalidTime.evaluatedAt, null);
assert.equal(invalidTime.risk.evaluatedAt, null);
assert.equal(invalidTime.findings.find((finding) => finding.code === "bvn")?.status, "needs_review");
assert.equal(invalidTime.projectability, "requires_shadow_reconciliation");
assert.ok(!JSON.stringify(invalidTime).includes(privateText));
const unknownPolicy = observationFinding(privateText, positive, { ...POLICY_DEFINITIONS.solo_lite, policyId: privateText, policyVersion: privateText }, at);
assert.equal(unknownPolicy.policyVersion, null);
assert.equal(unknownPolicy.code, "unknown_evidence");
assert.notEqual(unknownPolicy.status, "verified");
assert.ok(!JSON.stringify(unknownPolicy).includes(privateText));
const unprovenScreening = screeningFindings([{ type: "sanctions", disposition: "clear", listVersion: privateText, screenedAt: privateText }], at);
assert.equal(unprovenScreening[0].listVersion, null);
assert.equal(unprovenScreening[0].source, null);
assert.notEqual(unprovenScreening[0].disposition, "clear");
assert.ok(!JSON.stringify(unprovenScreening).includes(privateText));
const privateSnapshot = fromLegacyLiteSnapshot({ subscription_plan: privateText, verification_status: privateText, bvn_status: privateText, id: privateText }, privateText);
assert.ok(!JSON.stringify(privateSnapshot).includes(privateText));

// H2: legacy/caller claims are not substantiated positive evidence.
assert.equal(beneficialOwnershipFinding({ verification: "verified" }).verification, "needs_review");
assert.equal(beneficialOwnershipFinding({ verification: "failed" }).verification, "failed");
for (const input of [
  { status: "verified", sourceType: "verification_log" as const },
  { ...positive, sourceId: poison },
  { ...positive, sourceVersion: null },
  { ...positive, subject: null },
  { ...positive, subject: { ...subject, sourceId: poison } },
  { ...positive, sourceType: "merchant" as const },
]) assert.notEqual(observationFinding("bvn", input, POLICY_DEFINITIONS.solo_lite, at).status, "verified");
assert.equal(observationFinding("bvn", positive, POLICY_DEFINITIONS.solo_lite, at).status, "verified");
assert.notEqual(mappedLite.findings.find((finding) => finding.code === "bvn")?.status, "verified");
const unsupportedAuthority = authorityFinding({ claimedRole: "workspace_owner", verifiedRole: "authorised_signatory", subject });
assert.equal(unsupportedAuthority.verifiedRole, null);
assert.notEqual(unsupportedAuthority.status, "verified");
const ownershipInput = {
  subject, entity: { sourceType: "registry_snapshot" as const, sourceId: caseId, sourceVersion: 1 },
  directPercent: 5, evidence: [{ sourceType: "review" as const, sourceId: logId, sourceVersion: 1 }], verification: "verified" as const,
};
assert.equal(beneficialOwnershipFinding(ownershipInput).verification, "verified");
assert.equal(beneficialOwnershipFinding(ownershipInput).completeness, "needs_review");
assert.notEqual(beneficialOwnershipFinding({ ...ownershipInput, entity: null }).verification, "verified");
assert.notEqual(beneficialOwnershipFinding({ ...ownershipInput, evidence: [{ sourceType: "review", sourceId: poison, sourceVersion: 1 }] }).verification, "verified");
const payoutWithoutOwnership = evaluateSoloLite({ rawPlan: "solo_lite", evaluatedAt: at, payout: { ownership: { status: "verified", sourceType: "settlement_account" } } });
assert.notEqual(payoutWithoutOwnership.payout.ownershipRelationship.status, "verified");
assert.notEqual(evaluateSoloLite({ rawPlan: "solo_lite", evaluatedAt: at, payout: { ownership: { ...positive, sourceType: "settlement_account" } } }).payout.ownershipRelationship.status, "verified");
assert.equal(riskFinding({ rating: "low" }, POLICY_DEFINITIONS.solo_lite, at).rating, "unknown");

// M1: UTC/offset instants are equivalent; invalid or expired time cannot clear evidence.
assert.equal(safeTimestamp("2026-10-20T00:00:00Z"), at);
assert.equal(safeTimestamp("2026-10-20T00:00:00+00:00"), at);
assert.equal(safeTimestamp("2026-10-20T01:00:00+01:00"), at);
assert.equal(safeTimestamp("2026-10-19T19:00:00-05:00"), at);
assert.equal(safeTimestamp("2026-10-20T00:00:00.000000+00:00"), at);
for (const bad of ["2026-02-30T00:00:00Z", "2026-10-20T25:00:00Z", "2026-10-20", "invalid", "2026-10-20T00:00:00+25:00"]) assert.equal(safeTimestamp(bad), null);
for (const expiresAt of ["2026-10-19T00:00:00Z", "2026-10-19T00:00:00+00:00", "2026-10-19T01:00:00+01:00"]) {
  assert.equal(observationFinding("bvn", { ...positive, expiresAt }, POLICY_DEFINITIONS.solo_lite, at).status, "needs_review");
  assert.equal(observationFinding("bvn", { ...positive, status: "failed", expiresAt }, POLICY_DEFINITIONS.solo_lite, at).status, "failed");
}
assert.equal(observationFinding("bvn", { ...positive, revoked: true }, POLICY_DEFINITIONS.solo_lite, at).status, "failed");
assert.equal(observationFinding("bvn", { ...positive, expiresAt: privateText }, POLICY_DEFINITIONS.solo_lite, at).status, "needs_review");
assert.equal(observationFinding("bvn", { ...positive, expiresAt: "2026-10-19T00:00:00Z" }, POLICY_DEFINITIONS.solo_lite, privateText).status, "needs_review");
assert.equal(observationFinding("bvn", { ...positive, status: "failed" }, POLICY_DEFINITIONS.solo_lite, privateText).status, "failed");

// M2: exact parent, source-version, payment and approval-event associations are required.
function notConfident(input: SoloPlusProjectionInput) {
  const result = projectSoloPlus(input);
  assert.notEqual(result.projectability, "confidently_projectable");
  assert.equal(result.sourceAssurance, null);
  return result;
}
notConfident({ ...plusInput, requirements: [{ ...plusInput.requirements[0], caseId: paymentId }, ...plusInput.requirements.slice(1)] });
notConfident({ ...plusInput, events: [{ ...plusInput.events[0], caseId: paymentId }] });
for (const id of ["", privateText, poison]) {
  notConfident({ ...plusInput, caseRecord: { ...plusInput.caseRecord, id } });
  notConfident({ ...plusInput, caseRecord: { ...plusInput.caseRecord, paymentRecordId: id } });
  notConfident({ ...plusInput, requirements: [{ ...plusInput.requirements[0], id }, ...plusInput.requirements.slice(1)] });
  notConfident({ ...plusInput, events: [{ ...plusInput.events[0], id }] });
}
for (const rowVersion of [0, -1, NaN, Infinity, 1.5]) notConfident({ ...plusInput, caseRecord: { ...plusInput.caseRecord, rowVersion } });
notConfident({ ...plusInput, requirements: [{ ...plusInput.requirements[0], sourceCaseVersion: 4 }, ...plusInput.requirements.slice(1)] });
notConfident({ ...plusInput, requirements: [{ ...plusInput.requirements[0], evidenceSourceId: privateText }, ...plusInput.requirements.slice(1)] });
notConfident({ ...plusInput, requirements: plusInput.requirements.map((entry) => ({ ...entry, id: logId })) });
notConfident({ ...plusInput, events: [{ ...plusInput.events[0], newState: { ...plusInput.events[0].newState, rowVersion: 4 } }] });
notConfident({ ...plusInput, events: [{ ...plusInput.events[0], actorId: merchantId }] });
notConfident({ ...plusInput, events: [{ ...plusInput.events[0], policyVersion: "different-v1" }] });
notConfident({ ...plusInput, events: [{ ...plusInput.events[0], previousState: { rowVersion: 4 } }] });
for (const caseStatus of ["rejected", "cancelled", "verification_pending", "approved"] as const) {
  notConfident({ ...plusInput, events: [{ ...plusInput.events[0], previousState: { rowVersion: 4, caseStatus } }] });
}
notConfident({ ...plusInput, paymentRecord: undefined });
for (const paymentRecord of [
  { ...plusInput.paymentRecord!, solo_plus_case_id: paymentId },
  { ...plusInput.paymentRecord!, merchant_id: logId },
  { ...plusInput.paymentRecord!, sourceCaseVersion: 4 },
  { ...plusInput.paymentRecord!, payment_status: "pending" },
  { ...plusInput.paymentRecord!, payment_purpose: "plan_subscription" },
]) notConfident({ ...plusInput, paymentRecord });
for (const caseStatus of ["draft", "awaiting_payment", "verification_pending", "manual_review", "rejected", "cancelled"] as const) notConfident({ ...plusInput, caseRecord: { ...plusInput.caseRecord, caseStatus } });
const privatePolicy = notConfident({ ...plusInput, caseRecord: { ...plusInput.caseRecord, requirementsPolicyVersion: privateText } });
assert.ok(!JSON.stringify(privatePolicy).includes(privateText));
assert.equal(plus.caseSource.requirementsPolicyVersion, safeMetadataReference("controlled-launch-v1"));
assert.equal(plus.caseSource.approvalPolicyVersion, plus.caseSource.requirementsPolicyVersion);
assert.equal(plus.caseSource.reviewerId, reviewerId);
assert.equal(projectSoloPlus(plusInput).sourceAssurance, "enhanced_verified");
assert.equal(projectSoloPlus({ ...plusInput, requirements: [{ ...plusInput.requirements[0], requirementState: "reused", originalCompletedAt: "2026-10-18T00:00:00Z", reuseDecisionAt: at, reuseReason: "reviewed reuse", policyRuleApplied: "reuse-v1" }, ...plusInput.requirements.slice(1)] }).sourceAssurance, "enhanced_verified");
notConfident({ ...plusInput, requirements: [{ ...plusInput.requirements[0], requirementState: "reused", reuseReason: null }, ...plusInput.requirements.slice(1)] });
const onboarding = { ...plusInput, caseRecord: { ...plusInput.caseRecord, flowOrigin: "onboarding" as const, sourcePlan: null, onboardingSessionId: logId }, paymentRecord: { ...plusInput.paymentRecord!, payment_purpose: "plan_subscription", onboarding_session_id: logId } };
assert.equal(projectSoloPlus(onboarding).sourceAssurance, "enhanced_verified");
notConfident({ ...onboarding, caseRecord: { ...onboarding.caseRecord, onboardingSessionId: null } });

// M3: matching is a source disposition; PEP/media exposure requires review, not rejection.
const screeningSource = { sourceType: "screening" as const, sourceId: logId, sourceVersion: 1 };
const matched = screeningFindings((["sanctions", "pep", "adverse_media"] as const).map((type) => ({ type, disposition: "confirmed_match" as const, source: screeningSource, subject, listVersion: "v1", screenedAt: at })), at);
assert.equal(matched.find((finding) => finding.type === "sanctions")?.status, "failed");
assert.equal(matched.find((finding) => finding.type === "pep")?.status, "needs_review");
assert.equal(matched.find((finding) => finding.type === "adverse_media")?.status, "needs_review");
assert.ok(matched.every((finding) => finding.disposition === "confirmed_match"));
const possible = screeningFindings([{ type: "sanctions", disposition: "possible_match", source: screeningSource, subject, listVersion: "v1", screenedAt: at }], at);
assert.equal(possible[0].disposition, "possible_match");
assert.equal(possible[0].status, "needs_review");
const clear = screeningFindings([{ type: "sanctions", disposition: "clear", source: screeningSource, subject, listVersion: "v1", screenedAt: at }], at);
assert.equal(clear[0].disposition, "clear");
assert.equal(clear[0].listVersion, safeMetadataReference("v1"));
assert.notEqual(screeningFindings([{ type: "sanctions", disposition: "clear", source: { ...screeningSource, sourceId: poison }, subject, listVersion: "v1", screenedAt: at }], at)[0].disposition, "clear");
const opaqueList = screeningFindings([{ type: "sanctions", disposition: "clear", source: screeningSource, subject, listVersion: privateText, screenedAt: at }], at);
assert.ok(!JSON.stringify(opaqueList).includes(privateText));
const isolatedPlus = projectSoloPlus({ ...plusInput, screening: [{ type: "sanctions", disposition: "clear", source: screeningSource, subject, listVersion: "v1", screenedAt: at }] });
assert.ok(isolatedPlus.screening.every((finding) => finding.disposition === "not_screened"));
assert.deepEqual(isolatedPlus.beneficialOwners, []);

assert.deepEqual(projectSoloPlus(plusInput), projectSoloPlus(plusInput));
assert.equal(composePolicyShadowResult(gate, invalidTime).existingGate, gate);
assert.deepEqual(gate, { outcome: "allow", value: { allowed: true }, reasonCodes: [] });
console.log("PASS|PHASE2C_2B|readonly_policy_adapters");
