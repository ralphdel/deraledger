import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  prepareReviewedProfileBootstrap,
  type ExistingComplianceProfileSnapshot,
  type ReviewedProfileBootstrapRepository,
  type ReviewedProfileBootstrapRequest,
} from "../src/lib/compliance/reviewed-profile-bootstrap-core";

const identity = { merchantId: "merchant-1", workspaceId: "workspace-1" };
const evidence = { reviewSourceId: "review-1", reviewerId: "admin-1", reviewedAt: "2026-08-23T10:00:00.000Z", disposition: "reviewed" as const };

function request(overrides: Partial<ReviewedProfileBootstrapRequest> = {}): ReviewedProfileBootstrapRequest {
  return { identity, bootstrapKey: "bootstrap-1", plan: "solo_lite", evidence, ...overrides };
}

function repository(overrides: Partial<ReviewedProfileBootstrapRepository> = {}): ReviewedProfileBootstrapRepository {
  return {
    findByMerchantAndBootstrapKey: async () => null,
    findCurrentProfile: async () => null,
    ...overrides,
  };
}

function existing(overrides: Partial<ExistingComplianceProfileSnapshot> = {}): ExistingComplianceProfileSnapshot {
  return {
    merchantId: "merchant-1", workspaceId: "workspace-1", complianceStatus: "lite_pending",
    activationStatus: "test_mode", restrictionState: null, bootstrapKey: "old-key", ...overrides,
  };
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

async function prepared(input: ReviewedProfileBootstrapRequest) {
  const result = await prepareReviewedProfileBootstrap(input, repository());
  assert.equal(result.kind, "prepared");
  return result.payload;
}

async function run() {
  assert.equal((await prepared(request())).complianceStatus, "lite_pending");
  assert.equal((await prepared(request({ plan: "solo_plus" }))).complianceStatus, "enhanced_pending");
  assert.equal((await prepared(request({ plan: "business" }))).complianceStatus, "business_pending");
  assert.equal((await prepared(request({ plan: "generic" }))).complianceStatus, "draft");

  // No payment, legacy verification, or operational flag is accepted by this
  // contract, so none can create an approved profile.
  const base = await prepared(request());
  assert.notEqual(base.complianceStatus, "lite_verified");
  assert.equal(base.activationStatus, "test_mode");
  assert.equal(base.restrictionState, null);
  assert.equal(base.merchantEntitlements.canCollectPayments, false);

  for (const invalid of [
    request({ identity: null }),
    request({ evidence: null }),
    request({ bootstrapKey: "" }),
  ]) {
    const result = await prepareReviewedProfileBootstrap(invalid, repository());
    assert.equal(result.kind, "rejected");
  }

  const ambiguous = await prepareReviewedProfileBootstrap(
    request({ evidence: { ...evidence, disposition: "ambiguous" } }), repository(),
  );
  assert.equal(ambiguous.kind, "rejected");
  assert.deepEqual(ambiguous.diagnostics, [{ code: "reviewed_evidence_ambiguous" }]);
  const incomplete = await prepareReviewedProfileBootstrap(
    request({ evidence: { ...evidence, disposition: "incomplete" } }), repository(),
  );
  assert.equal(incomplete.kind, "rejected");

  const verified = await prepareReviewedProfileBootstrap(
    request(), repository({ findCurrentProfile: async () => existing({ complianceStatus: "lite_verified", activationStatus: "approved" }) }),
  );
  assert.equal(verified.kind, "existing");
  assert.deepEqual(verified.diagnostics, [{ code: "existing_profile_preserved" }]);

  for (const current of [
    existing({ complianceStatus: "restricted", activationStatus: "restricted", restrictionState: "restricted" }),
    existing({ complianceStatus: "rejected", activationStatus: "restricted" }),
  ]) {
    const result = await prepareReviewedProfileBootstrap(
      request(), repository({ findCurrentProfile: async () => current }),
    );
    assert.equal(result.kind, "existing");
  }

  const repeated = await prepareReviewedProfileBootstrap(
    request(), repository({ findByMerchantAndBootstrapKey: async () => existing({ bootstrapKey: "bootstrap-1" }) }),
  );
  assert.equal(repeated.kind, "existing");
  assert.equal(repeated.diagnostics.length, 0);

  const rejected = await prepared(request({ outcome: "rejected" }));
  assert.deepEqual([rejected.complianceStatus, rejected.activationStatus, rejected.restrictionState], ["rejected", "restricted", null]);
  const restricted = await prepared(request({ outcome: "restricted" }));
  assert.deepEqual([restricted.complianceStatus, restricted.activationStatus, restricted.restrictionState], ["restricted", "restricted", "restricted"]);
  const suspended = await prepared(request({ outcome: "suspended" }));
  assert.deepEqual([suspended.complianceStatus, suspended.activationStatus, suspended.restrictionState], ["restricted", "suspended", "suspended"]);

  const facade = readFileSync("src/lib/compliance/reviewed-profile-bootstrap.ts", "utf8");
  const core = readFileSync("src/lib/compliance/reviewed-profile-bootstrap-core.ts", "utf8");
  assert.match(facade, /import\s+["']server-only["']/);
  assert.doesNotMatch(core, /\.from\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(|rpc\(|paystack|monnify|breet/i);
  for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /reviewed-profile-bootstrap/);
  }

  console.log("reviewed-profile-bootstrap.test.ts passed");
}

void run();
