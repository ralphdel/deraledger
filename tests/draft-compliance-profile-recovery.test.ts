import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DraftComplianceProfileRecoveryError,
  recoverDraftComplianceProfileForEligibleMerchant,
  type DraftComplianceProfileRecoveryRepository,
} from "../src/lib/server/draft-compliance-profile-recovery";

const merchantId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";
const profileId = "44444444-4444-4444-8444-444444444444";

function repository(
  overrides: Partial<DraftComplianceProfileRecoveryRepository> = {},
): DraftComplianceProfileRecoveryRepository & { ensureCalls: string[] } {
  const ensureCalls: string[] = [];
  return {
    ensureCalls,
    async findMerchant() {
      return { id: merchantId, user_id: ownerId, subscription_plan: "individual" };
    },
    async findSubscription() {
      return { plan_type: "solo_lite", status: "active" };
    },
    async findCanonicalWorkspace() {
      return {
        merchant_id: merchantId,
        workspace_id: workspaceId,
        workspaces: { id: workspaceId, merchant_id: merchantId },
      };
    },
    async listProfiles() { return []; },
    async ensure(target) {
      ensureCalls.push(target);
      return {
        kind: "created",
        merchantId,
        profileId,
        plan: "solo_lite",
        rowVersion: 1,
      };
    },
    ...overrides,
  };
}

async function expectCode(
  repo: DraftComplianceProfileRecoveryRepository,
  code: DraftComplianceProfileRecoveryError["code"],
) {
  await assert.rejects(
    recoverDraftComplianceProfileForEligibleMerchant(repo, merchantId),
    (error: unknown) => error instanceof DraftComplianceProfileRecoveryError
      && error.code === code,
  );
}

async function run() {
  const soloLite = repository();
  assert.equal(
    (await recoverDraftComplianceProfileForEligibleMerchant(soloLite, merchantId)).kind,
    "created",
  );
  assert.deepEqual(soloLite.ensureCalls, [merchantId]);

  const business = repository({
    async findMerchant() {
      return { id: merchantId, user_id: ownerId, subscription_plan: "corporate" };
    },
    async findSubscription() {
      return { plan_type: "business", status: "active" };
    },
    async ensure(target) {
      return { kind: "existing_exact", merchantId: target, profileId, plan: "business", rowVersion: 1 };
    },
  });
  assert.equal(
    (await recoverDraftComplianceProfileForEligibleMerchant(business, merchantId)).plan,
    "business",
  );

  await expectCode(repository({ async findMerchant() { return null; } }), "MERCHANT_NOT_FOUND");
  await expectCode(repository({
    async findMerchant() { return { id: merchantId, user_id: ownerId, subscription_plan: "starter" }; },
  }), "MERCHANT_NOT_ELIGIBLE");
  await expectCode(repository({
    async findMerchant() { return { id: merchantId, user_id: ownerId, subscription_plan: "solo_plus" }; },
  }), "MERCHANT_NOT_ELIGIBLE");
  await expectCode(repository({
    async findSubscription() { return { plan_type: "solo_lite", status: "expired" }; },
  }), "SUBSCRIPTION_NOT_ACTIVE");
  await expectCode(repository({
    async findSubscription() { return { plan_type: "business", status: "active" }; },
  }), "SUBSCRIPTION_PLAN_MISMATCH");
  await expectCode(repository({ async findCanonicalWorkspace() { return null; } }), "CANONICAL_WORKSPACE_REQUIRED");
  await expectCode(repository({
    async findCanonicalWorkspace() {
      return { merchant_id: merchantId, workspace_id: workspaceId, workspaces: { id: workspaceId, merchant_id: ownerId } };
    },
  }), "CANONICAL_WORKSPACE_CONFLICT");
  await expectCode(repository({
    async listProfiles() {
      return [
        { id: profileId, merchant_id: merchantId, plan_code: "solo_lite", compliance_status: "draft", activation_status: "test_mode", row_version: 1 },
        { id: ownerId, merchant_id: merchantId, plan_code: "solo_lite", compliance_status: "draft", activation_status: "test_mode", row_version: 1 },
      ];
    },
  }), "MULTIPLE_PROFILES");
  await expectCode(repository({
    async listProfiles() {
      return [{ id: profileId, merchant_id: merchantId, plan_code: "solo_lite", compliance_status: "lite_verified", activation_status: "approved", row_version: 2 }];
    },
  }), "EXISTING_PROFILE_CONFLICT");

  const script = readFileSync("scripts/recover-draft-compliance-profile-staging.ts", "utf8");
  assert.match(script, /validateCanonicalWorkspaceRecoveryTarget/);
  assert.match(script, /DRAFT_COMPLIANCE_PROFILE_RECOVERY_ENV/);
  const validationCall = script.indexOf(
    "const { supabaseUrl } = validateCanonicalWorkspaceRecoveryTarget",
  );
  const secretAccess = script.indexOf("process.env.SUPABASE_SERVICE_ROLE_KEY");
  const clientConstruction = script.indexOf("const serviceClient = createClient");
  assert.ok(
    validationCall >= 0
      && validationCall < secretAccess
      && secretAccess < clientConstruction,
    "Staging identity validation must precede service-role secret access.",
  );
  assert.doesNotMatch(script, /--workspace-id|--profile-id|--plan/);

  console.log("draft-compliance-profile-recovery.test.ts passed");
}

void run();
