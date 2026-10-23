import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { MerchantComplianceReviewStatus } from "../src/components/compliance/merchant-review-status";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const markup = renderToStaticMarkup(<MerchantComplianceReviewStatus />);
assert.match(markup, /Loading review status/);

const ui = read("src/components/compliance/merchant-review-status.tsx");
const route = read("src/app/api/compliance/review/submit/route.ts");
const service = read("src/lib/compliance/server/review-correction-service.ts");
const readRoute = read("src/app/api/compliance/review/route.ts");
const adminQueue = read("src/components/compliance/admin-review-queue.tsx");
const adminLayout = read("src/app/(admin)/layout.tsx");

assert.match(ui, /Verification ready for review/);
assert.match(ui, /Submit for Review/);
assert.match(ui, /current identity or business verification information/);
assert.match(ui, /EVIDENCE_INCOMPLETE/);
assert.match(ui, /Complete verification information/);
assert.match(ui, /submitting \? "Submitting…"/);
assert.match(ui, /if \(mutationInFlight\.current \|\| state\?\.status !== "NO_REVIEW_ELIGIBLE"/);
assert.match(ui, /mutationInFlight\.current = true/);
assert.match(ui, /mutationInFlight\.current = false/);
assert.match(ui, /disabled=\{submitting\}/);
assert.match(ui, /initialRequestKey \?\? initialAttemptKey\(\)/);
assert.match(ui, /resubmissionRequestKey \?\? resubmissionAttemptKey\(\)/);
assert.match(ui, /setInitialRequestKey\(requestIdempotencyKey\)/);
assert.match(ui, /setResubmissionRequestKey\(requestIdempotencyKey\)/);
assert.match(ui, /setInitialRequestKey\(null\)/);
assert.match(ui, /setResubmissionRequestKey\(null\)/);
assert.match(ui, /We could not confirm whether your review was submitted/);
assert.match(ui, /payload\.state\.status !== "PENDING"/);
assert.match(ui, /Under Review/);
assert.match(ui, /state\?\.status === "PENDING"/);
assert.match(ui, /state\?\.status === "NEEDS_ATTENTION"/);
assert.match(ui, /Resubmit for review/);
assert.match(ui, /PLAN_NOT_ELIGIBLE/);
assert.doesNotMatch(ui, />Approve</);
assert.doesNotMatch(ui, />Reject</);
assert.doesNotMatch(ui, />Activate</);
assert.doesNotMatch(ui, /Settlement/);
assert.doesNotMatch(ui, /evidenceSnapshot|actorId|merchantId|workspaceId|profileId|policyVersion/);

assert.match(route, /hasOnlyKeys\(body, \["requestIdempotencyKey"\]\)/);
assert.match(route, /assertOrigin/);
assert.match(route, /session\.userId/);
assert.match(route, /session\.merchantId/);
assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(route, /error\.name|error\.message/);
assert.match(readRoute, /getMerchantReviewState/);
assert.match(readRoute, /noStoreJson/);

assert.match(service, /submit_draft_plan_review_v1/);
assert.match(service, /p_merchant_id: merchant\.id/);
assert.match(service, /p_workspace_id: workspace\.workspace_id/);
assert.match(service, /p_expected_profile_row_version: expectedProfileRowVersion/);
assert.match(service, /p_actor_id: input\.actorId/);
assert.match(service, /p_policy_version: DRAFT_REVIEW_POLICY_VERSION/);
assert.match(service, /p_evidence_snapshot: snapshot/);
assert.match(service, /p_idempotency_key: input\.idempotencyKey/);
assert.match(service, /fromLegacyLiteSnapshot/);
assert.match(service, /fromLegacyBusinessSnapshot/);
assert.match(service, /evaluateSoloLite/);
assert.match(service, /evaluateBusiness/);
assert.doesNotMatch(service, /lite_verified|business_verified/);
assert.doesNotMatch(service, /review_compliance_profile_decision_v1/);
assert.doesNotMatch(service, /UPDATE public|INSERT INTO public/);

assert.doesNotMatch(adminQueue, />Approve|>Reject|>Activate|Settlement/);
assert.match(adminLayout, />Admin Portal</);
assert.doesNotMatch(adminLayout, />Production</);

console.log("Phase 2C-2C-B4 runtime and UI contract tests passed.");
