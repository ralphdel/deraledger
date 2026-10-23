import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { AdminComplianceReviewDetail } from "../src/components/compliance/admin-review-detail";
import { AdminComplianceReviewQueue } from "../src/components/compliance/admin-review-queue";
import { MerchantComplianceReviewStatus } from "../src/components/compliance/merchant-review-status";
import {
  BUSINESS_REVIEW_FINDING_CODES,
  LITE_REVIEW_FINDING_CODES,
  REVIEW_CORRECTION_REASON_CODES,
  findingLabel,
  isResubmissionIdempotencyKey,
  mapReviewMutationKind,
  normalizeRequestedFindingCodes,
} from "../src/lib/compliance/review-correction-contract";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

assert.deepEqual(REVIEW_CORRECTION_REASON_CODES, [
  "evidence_incomplete", "evidence_expired", "evidence_mismatch", "reviewer_requested_correction",
]);
assert.equal(LITE_REVIEW_FINDING_CODES.includes("manual_review"), true);
assert.equal(BUSINESS_REVIEW_FINDING_CODES.includes("beneficial_owners"), true);
assert.equal(LITE_REVIEW_FINDING_CODES.includes("approved_volume" as never), false);
assert.equal(findingLabel("legal_name"), "Legal name");
assert.deepEqual(normalizeRequestedFindingCodes(["phone", "legal_name"]), ["legal_name", "phone"]);
assert.equal(normalizeRequestedFindingCodes(["legal_name", "legal_name"]), null);
assert.equal(mapReviewMutationKind("applied").body.code, "APPLIED");
assert.equal(mapReviewMutationKind("already_processed").body.code, "ALREADY_PROCESSED");
assert.equal(mapReviewMutationKind("version_conflict").status, 409);
assert.equal(mapReviewMutationKind("unsupported_isolation").status, 503);
assert.equal(isResubmissionIdempotencyKey(`a${"b".repeat(123)}`), true);
assert.equal(isResubmissionIdempotencyKey(`a${"b".repeat(124)}`), false);

const queueMarkup = renderToStaticMarkup(<AdminComplianceReviewQueue />);
const detailMarkup = renderToStaticMarkup(<AdminComplianceReviewDetail reviewId="11111111-1111-4111-8111-111111111111" />);
const merchantMarkup = renderToStaticMarkup(<MerchantComplianceReviewStatus />);
assert.match(queueMarkup, /Loading compliance reviews/);
assert.match(detailMarkup, /Loading review/);
assert.match(merchantMarkup, /Loading review status/);

const adminDetail = read("src/components/compliance/admin-review-detail.tsx");
const merchantStatus = read("src/components/compliance/merchant-review-status.tsx");
const service = read("src/lib/compliance/server/review-correction-service.ts");
const adminMutation = read("src/app/api/admin/compliance/reviews/[reviewId]/request-correction/route.ts");
const merchantMutation = read("src/app/api/compliance/review/resubmit/route.ts");
const adminLayout = read("src/app/(admin)/layout.tsx");
const settings = read("src/app/(dashboard)/settings/page.tsx");

assert.match(adminDetail, /Request correction/);
assert.match(adminDetail, /review\.status === "pending"/);
assert.match(adminDetail, /requestedFindingCodes/);
assert.match(adminDetail, /value=\{reasonCode\}/);
assert.match(adminDetail, /useState<string\[\]>\(\[\]\)/);
assert.match(adminDetail, /role="alert"/);
assert.match(adminDetail, /await load\(false\)/);
assert.doesNotMatch(adminDetail, />Approve</);
assert.doesNotMatch(adminDetail, />Reject</);
assert.doesNotMatch(adminDetail, /Enable Settlement/);

assert.match(merchantStatus, /state\?\.status === "PENDING"/);
assert.match(merchantStatus, /Action Required/);
assert.match(merchantStatus, /Resubmit for review/);
assert.match(merchantStatus, /requestedFindingCodes\.map/);
assert.match(merchantStatus, /await load\(false\)/);
assert.match(merchantStatus, /role="alert"/);
assert.doesNotMatch(merchantStatus, /\.rpc\(/);
assert.doesNotMatch(merchantStatus, /SUPABASE_SERVICE_ROLE_KEY/);

assert.match(service, /import "server-only"/);
assert.match(service, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(service, /fromLegacyLiteSnapshot/);
assert.match(service, /fromLegacyBusinessSnapshot/);
assert.match(service, /evaluateSoloLite/);
assert.match(service, /evaluateBusiness/);
assert.match(service, /request_draft_plan_review_correction_v1/);
assert.match(service, /resubmit_corrected_draft_plan_review_v1/);
assert.match(service, /review\.review_status !== "pending"/);
assert.match(service, /review\.review_status !== "needs_attention"/);
assert.match(service, /target_plan_code === "solo_lite"/);
assert.match(service, /target_plan_code === "business"/);
assert.doesNotMatch(service, /lite_verified|business_verified/);
assert.doesNotMatch(service, /review_compliance_profile_decision_v1/);
assert.doesNotMatch(service, /app_metadata/);
assert.match(service, /findOwnedMerchant: \(userId, merchantId\)/);
assert.match(service, /profile_row_version/);
assert.match(service, /canonicalMerchantPlan/);

assert.match(adminMutation, /guard\.userId/);
assert.doesNotMatch(adminMutation, /reviewerId.*body|body.*reviewerId/);
assert.match(adminMutation, /assertOrigin/);
assert.match(merchantMutation, /session\.userId/);
assert.doesNotMatch(merchantMutation, /actorId.*body|body.*actorId/);
assert.match(merchantMutation, /assertOrigin/);
assert.doesNotMatch(adminMutation + merchantMutation, /SUPABASE_SERVICE_ROLE_KEY/);

assert.match(adminLayout, /\/admin\/compliance-reviews/);
assert.match(settings, /\/settings\/compliance-review/);

const runtimeFiles = [
  "src/components/compliance/admin-review-detail.tsx",
  "src/components/compliance/admin-review-queue.tsx",
  "src/components/compliance/merchant-review-status.tsx",
  "src/app/api/admin/compliance/reviews/route.ts",
  "src/app/api/admin/compliance/reviews/[reviewId]/route.ts",
  "src/app/api/admin/compliance/reviews/[reviewId]/request-correction/route.ts",
  "src/app/api/compliance/review/route.ts",
  "src/app/api/compliance/review/resubmit/route.ts",
].map(read).join("\n");
assert.doesNotMatch(runtimeFiles, /submit_draft_plan_review_v1/);
assert.doesNotMatch(runtimeFiles, /review_compliance_profile_decision_v1/);
assert.doesNotMatch(runtimeFiles, /\.from\(["']merchant_compliance_profiles["']\)\.update/);
assert.doesNotMatch(runtimeFiles, /live_features_enabled|setup_mode|settlement_activated_at/);

console.log("Phase 2C-2C-B3 runtime and UI contract tests passed.");
