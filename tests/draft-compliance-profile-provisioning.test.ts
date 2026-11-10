import assert from "node:assert/strict";

import {
  DraftComplianceProfileProvisioningError,
  ensureDraftComplianceProfileForEligibleMerchant,
} from "../src/lib/server/draft-compliance-profile-provisioning";

const merchantId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";

class FakeClient {
  calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  data: unknown = {
    kind: "draft_profile_created",
    merchant_id: merchantId,
    profile_id: profileId,
    plan_code: "solo_lite",
    row_version: 1,
  };
  error: { message: string } | null = null;

  async rpc(name: string, args: Record<string, unknown>) {
    this.calls.push({ name, args });
    return { data: this.data, error: this.error };
  }
}

async function expectCode(client: FakeClient, code: DraftComplianceProfileProvisioningError["code"]) {
  await assert.rejects(
    ensureDraftComplianceProfileForEligibleMerchant(client as never, { merchantId }),
    (error: unknown) => error instanceof DraftComplianceProfileProvisioningError
      && error.code === code
      && !/postgres|supabase|secret/i.test(error.message),
  );
}

async function run() {
  const createdClient = new FakeClient();
  const created = await ensureDraftComplianceProfileForEligibleMerchant(
    createdClient as never,
    { merchantId },
  );
  assert.deepEqual(created, {
    kind: "created",
    merchantId,
    profileId,
    plan: "solo_lite",
    rowVersion: 1,
  });
  assert.deepEqual(createdClient.calls, [{
    name: "ensure_draft_compliance_profile_v1",
    args: { p_merchant_id: merchantId },
  }]);

  const businessReplay = new FakeClient();
  businessReplay.data = {
    kind: "draft_profile_existing_exact",
    merchant_id: merchantId,
    profile_id: profileId,
    plan_code: "business",
    row_version: "1",
  };
  assert.equal(
    (await ensureDraftComplianceProfileForEligibleMerchant(businessReplay as never, { merchantId })).kind,
    "existing_exact",
  );

  for (const [kind, code] of [
    ["draft_profile_merchant_missing", "MERCHANT_NOT_FOUND"],
    ["draft_profile_owner_required", "OWNER_REQUIRED"],
    ["draft_profile_plan_not_eligible", "PLAN_NOT_ELIGIBLE"],
    ["draft_profile_subscription_inactive", "SUBSCRIPTION_INACTIVE"],
    ["draft_profile_subscription_plan_mismatch", "SUBSCRIPTION_PLAN_MISMATCH"],
    ["draft_profile_canonical_workspace_missing", "CANONICAL_WORKSPACE_REQUIRED"],
    ["draft_profile_canonical_workspace_conflict", "CANONICAL_WORKSPACE_CONFLICT"],
    ["draft_profile_existing_conflict", "EXISTING_PROFILE_CONFLICT"],
    ["draft_profile_state_incompatible", "STATE_INCOMPATIBLE"],
  ] as const) {
    const client = new FakeClient();
    client.data = { kind, merchant_id: merchantId };
    await expectCode(client, code);
  }

  for (const malformed of [
    null,
    [],
    [{ kind: "draft_profile_created" }],
    { kind: "unknown", merchant_id: merchantId },
    { ...createdClient.data as object, merchant_id: "33333333-3333-4333-8333-333333333333" },
    { ...createdClient.data as object, profile_id: "malformed" },
    { ...createdClient.data as object, row_version: 2 },
    { ...createdClient.data as object, plan_code: "solo_plus" },
  ]) {
    const client = new FakeClient();
    client.data = malformed;
    await expectCode(client, "INVALID_RPC_RESULT");
  }

  const dataError = new FakeClient();
  dataError.data = {
    kind: "draft_profile_state_incompatible",
    merchant_id: merchantId,
  };
  dataError.error = { message: "raw database relation detail" };
  const dataAccessError = await ensureDraftComplianceProfileForEligibleMerchant(
    dataError as never,
    { merchantId },
  ).then(
    () => assert.fail("RPC database failure must not return a business-state result"),
    (error: unknown) => error,
  );
  assert.ok(dataAccessError instanceof DraftComplianceProfileProvisioningError);
  assert.equal(dataAccessError.code, "DATA_ACCESS_ERROR");
  assert.notEqual(dataAccessError.code, "STATE_INCOMPATIBLE");
  assert.equal(
    dataAccessError.message,
    "Draft compliance profile provisioning could not access its bounded data contract.",
  );
  assert.doesNotMatch(dataAccessError.message, /raw database relation detail|postgres|supabase|secret/i);

  await assert.rejects(
    ensureDraftComplianceProfileForEligibleMerchant(new FakeClient() as never, { merchantId: "bad" }),
    (error: unknown) => error instanceof DraftComplianceProfileProvisioningError
      && error.code === "INVALID_SERVER_IDENTITY",
  );

  console.log("draft-compliance-profile-provisioning.test.ts passed");
}

void run();
