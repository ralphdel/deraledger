import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  createApprovalRuntimeBoundary,
  type ApprovalReviewerIdentityRepository,
  type CanonicalApprovalReadRepository,
} from "../src/lib/compliance/approval-runtime-boundary-core";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function reads(overrides: Partial<CanonicalApprovalReadRepository> = {}): CanonicalApprovalReadRepository {
  return {
    async loadOneCanonicalProfile() { return { merchantId: "merchant-canonical", workspaceId: "workspace-canonical", profileId: "profile-canonical", planCode: "solo_lite", complianceStatus: "lite_pending", rowVersion: 3, freshness: "current" }; },
    async loadOneCanonicalSource() { return { sourceType: "solo_lite_review", sourceId: "source-canonical", merchantId: "merchant-canonical", profileId: "profile-canonical", planCode: "solo_lite", sourceVersion: 2, reviewedSourceVersion: 2, policyVersion: "phase-2-v1", evidenceState: "complete", freshness: "current" }; },
    async reconcileDecisionIdempotency() { return { decisionIdempotencyKey: "server-generated-key" }; },
    ...overrides,
  };
}

function reviewer(actorKind: ApprovalReviewerIdentityRepository extends never ? never : "super_admin" | "merchant_owner" | "merchant_team" | "customer" | "anonymous" | "browser_direct" | "compliance_reviewer_deferred", origin: "server_session" | "browser_input" = "server_session"): ApprovalReviewerIdentityRepository {
  return { async resolveAuthenticatedReviewer() { return actorKind === "anonymous" ? null : { actorKind, reviewerId: actorKind === "super_admin" ? "reviewer-server" : "reviewer-untrusted", origin }; } };
}

async function run() {
  const boundary = createApprovalRuntimeBoundary({ reviewerIdentityRepository: reviewer("super_admin"), canonicalReadRepository: reads(), now: () => new Date("2026-08-25T12:00:00.000Z") });
  const prepared = await boundary.prepare({
    targetComplianceStatus: "lite_verified", reasonCode: null,
    merchant_id: "ignored" as never, profile_id: "ignored" as never, source_version: 999 as never,
  } as never);
  assert.equal(prepared.kind, "prepared");
  if (prepared.kind === "prepared") {
    assert.deepEqual({ merchant: prepared.payload.merchantId, profile: prepared.profileId, source: prepared.payload.reviewSourceId, version: prepared.payload.evidenceVersion, reviewer: prepared.payload.reviewedBy, key: prepared.payload.approvalDecisionKey, reviewedAt: prepared.payload.reviewedAt }, {
      merchant: "merchant-canonical", profile: "profile-canonical", source: "source-canonical", version: 2, reviewer: "reviewer-server", key: "server-generated-key", reviewedAt: "2026-08-25T12:00:00.000Z",
    });
  }
  for (const actorKind of ["merchant_owner", "merchant_team", "customer", "anonymous", "browser_direct", "compliance_reviewer_deferred"] as const) {
    const result = await createApprovalRuntimeBoundary({ reviewerIdentityRepository: reviewer(actorKind), canonicalReadRepository: reads() }).prepare({ targetComplianceStatus: "lite_verified" });
    assert.deepEqual(result, { kind: "rejected", diagnostics: [{ code: "approval_runtime_reviewer_denied" }] });
  }
  const browserOrigin = await createApprovalRuntimeBoundary({ reviewerIdentityRepository: reviewer("super_admin", "browser_input"), canonicalReadRepository: reads() }).prepare({ targetComplianceStatus: "lite_verified" });
  assert.equal(browserOrigin.kind, "rejected");
  const staleProfile = await createApprovalRuntimeBoundary({ reviewerIdentityRepository: reviewer("super_admin"), canonicalReadRepository: reads({ async loadOneCanonicalProfile() { return { merchantId: "m", workspaceId: "w", profileId: "p", planCode: "solo_lite", complianceStatus: "lite_pending", rowVersion: 2, freshness: "stale" }; } }) }).prepare({ targetComplianceStatus: "lite_verified" });
  assert.deepEqual(staleProfile, { kind: "rejected", diagnostics: [{ code: "approval_runtime_profile_stale" }] });
  const staleSource = await createApprovalRuntimeBoundary({ reviewerIdentityRepository: reviewer("super_admin"), canonicalReadRepository: reads({ async loadOneCanonicalSource() { return { sourceType: "solo_lite_review", sourceId: "s", merchantId: "merchant-canonical", profileId: "profile-canonical", planCode: "solo_lite", sourceVersion: 1, reviewedSourceVersion: 2, policyVersion: "v", evidenceState: "complete", freshness: "current" }; } }) }).prepare({ targetComplianceStatus: "lite_verified" });
  assert.deepEqual(staleSource, { kind: "rejected", diagnostics: [{ code: "approval_runtime_source_stale" }] });
  const missingSource = await createApprovalRuntimeBoundary({ reviewerIdentityRepository: reviewer("super_admin"), canonicalReadRepository: reads({ async loadOneCanonicalSource() { return null; } }) }).prepare({ targetComplianceStatus: "lite_verified" });
  assert.deepEqual(missingSource, { kind: "rejected", diagnostics: [{ code: "approval_runtime_source_missing" }] });
  const invalidReason = await boundary.prepare({ targetComplianceStatus: "rejected", reasonCode: "unsafe detail" as never });
  assert.deepEqual(invalidReason, { kind: "rejected", diagnostics: [{ code: "approval_reason_code_unsafe" }] });
  const invalidTransition = await boundary.prepare({ targetComplianceStatus: "business_verified" });
  assert.deepEqual(invalidTransition, { kind: "rejected", diagnostics: [{ code: "approval_source_target_mismatch" }] });
  const portFailure = await boundary.executeWithInjectedPortForTest({ targetComplianceStatus: "lite_verified" }, { async execute() { throw new Error("sensitive"); } });
  assert.deepEqual(portFailure, { kind: "rejected", diagnostics: [{ code: "approval_runtime_execution_failed" }] });
  const unknown = await boundary.executeWithInjectedPortForTest({ targetComplianceStatus: "lite_verified" }, { async execute() { return { kind: "unexpected" }; } });
  assert.deepEqual(unknown, { kind: "rejected", diagnostics: [{ code: "approval_runtime_execution_unknown" }] });

  const facade = readFileSync("src/lib/compliance/approval-runtime-boundary.ts", "utf8");
  const core = readFileSync("src/lib/compliance/approval-runtime-boundary-core.ts", "utf8");
  assert.match(facade, /import\s+["']server-only["']/);
  assert.doesNotMatch(core, /createClient\(|createSupabase|\.from\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(|rpc\(|paystack|monnify|breet|checkout/i);
  assert.doesNotMatch(core, /setup_mode|live_features_enabled|can_collect_payments|activation_status|payment_records|providers|invoices|subscriptions|storefront/i);
  for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /approval-runtime-boundary/);
  }
  console.log("approval-runtime-boundary.test.ts passed");
}

void run();
