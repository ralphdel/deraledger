import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasMerchantContextPermission } from "../src/lib/rbac";
import { canAccessFeature } from "../src/lib/services/access-control";

async function run() {
  assert.equal(hasMerchantContextPermission({
    status: "resolved", merchantId: "merchant-1", relationship: "owner", roleName: "owner", permissions: {},
  }, "manage_references"), true);
  assert.equal(hasMerchantContextPermission({
    status: "resolved", merchantId: "merchant-1", relationship: "team_member", roleName: "admin", permissions: { manage_references: true },
  }, "manage_references"), true);
  assert.equal(hasMerchantContextPermission({
    status: "resolved", merchantId: "merchant-1", relationship: "team_member", roleName: "viewer", permissions: { manage_references: false },
  }, "manage_references"), false);
  assert.equal(canAccessFeature({ subscription_plan: "starter", merchant_tier: "starter" }, "view_references").allowed, false);
  assert.equal(canAccessFeature({ subscription_plan: "individual", merchant_tier: "individual" }, "view_references").allowed, true);

  const actions = readFileSync("src/lib/actions.ts", "utf8");
  const referenceSection = actions.slice(
    actions.indexOf("export async function createReferenceAction"),
    actions.indexOf("export async function submitDojahKycAction"),
  );
  assert.equal((referenceSection.match(/resolveMerchantAccess\(data\.merchant_id, "manage_references"\)/g) || []).length, 2);
  assert.equal((referenceSection.match(/data\.merchant_id !== merchantAccess\.merchantId/g) || []).length, 2);
  assert.equal((referenceSection.match(/canAccessFeature\(merchantRow as any, "view_references"\)/g) || []).length, 2);
  assert.match(referenceSection, /merchant_id: trustedMerchantId/);
  assert.match(referenceSection, /\.eq\("merchant_id", trustedMerchantId\)/);

  console.log("reference-mutation-access tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
