import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  canAccessFeature,
  getInvoiceCreationAccess,
} from "../src/lib/services/access-control";
import { isSuperadminSandboxMerchant } from "../src/lib/services/onboarding-flow.service";
import {
  getMerchantContextResolutionError,
  hasMerchantContextPermission,
} from "../src/lib/rbac";

const starterMerchant = {
  subscription_plan: "starter",
  merchant_tier: "starter",
  verification_status: "unverified",
  bvn_status: "unverified",
  cac_status: "unverified",
  selfie_status: "unverified",
  utility_status: "unverified",
  business_affiliation_status: null,
  live_features_enabled: false,
  setup_mode: false,
  email: "starter@example.test",
  is_super_admin: false,
} as const;

async function run() {
  assert.doesNotThrow(
    () => isSuperadminSandboxMerchant(null),
    "The verification/onboarding helper must never dereference a missing merchant.",
  );
  assert.equal(isSuperadminSandboxMerchant(null), false);

  const recordAccess = getInvoiceCreationAccess(starterMerchant, "record", 0);
  assert.deepEqual(recordAccess, {
    allowed: true,
    invoiceType: "record",
    shouldSyncMerchantSetup: false,
  }, "Starter record invoices must only use the invoice-creation capability path.");

  const paidRecordAccess = getInvoiceCreationAccess({
    ...starterMerchant,
    subscription_plan: "individual",
    merchant_tier: "individual",
  }, "record", 0);
  assert.deepEqual(paidRecordAccess, {
    allowed: true,
    invoiceType: "record",
    shouldSyncMerchantSetup: false,
  }, "Paid-plan record invoices must remain offline and must not request setup synchronization.");

  const missingMerchant = getInvoiceCreationAccess(null, "record", 0);
  assert.deepEqual(missingMerchant, {
    allowed: false,
    reason: "Workspace could not be resolved. Please refresh and try again.",
  }, "A missing merchant must produce a structured error, not a TypeError.");

  const collectionAccess = getInvoiceCreationAccess(starterMerchant, "collection", 0);
  assert.equal(collectionAccess.allowed, false);
  if (!collectionAccess.allowed) {
    assert.match(collectionAccess.reason, /not available on the Starter plan/i);
  }
  assert.equal(canAccessFeature(starterMerchant, "view_references").allowed, false);

  const starterAdminContext = {
    status: "resolved" as const,
    merchantId: "starter-merchant",
    relationship: "team_member" as const,
    roleName: "admin",
    permissions: { create_invoice: true, manage_clients: true },
  };
  assert.equal(
    hasMerchantContextPermission(starterAdminContext, "create_invoice"),
    true,
    "A valid Starter admin context with create_invoice may create a record invoice.",
  );
  assert.equal(
    hasMerchantContextPermission({ ...starterAdminContext, permissions: {} }, "create_invoice"),
    false,
    "A team member without create_invoice must receive a permission denial.",
  );
  assert.equal(
    getMerchantContextResolutionError({ status: "not_found" }),
    "Workspace could not be resolved. Please refresh and try again.",
  );

  const actionsSource = readFileSync("src/lib/actions.ts", "utf8");
  const accessControlSource = readFileSync("src/lib/services/access-control.ts", "utf8");
  const rbacSource = readFileSync("src/lib/rbac.ts", "utf8");
  assert.match(actionsSource, /resolveMerchantAccess\(data\.merchant_id, "create_invoice"\)/);
  assert.match(actionsSource, /merchant_id\?: string \| null/);
  assert.match(actionsSource, /\.eq\("id", merchantId\)/);
  assert.match(actionsSource, /Invoice workspace settings could not be loaded/);
  assert.match(rbacSource, /auth\.getUser\(\)/);
  assert.doesNotMatch(rbacSource, /auth\.getSession\(\)/);
  assert.match(rbacSource, /resolveMerchantContextForUser\(sb, user/);
  assert.match(rbacSource, /preferredMerchantId: preferredMerchantId \|\| null/);
  assert.match(
    actionsSource,
    /if \(requestedType === "collection" && invoiceAccess\.shouldSyncMerchantSetup\) \{[\s\S]+syncMerchantSetupStatus/,
    "Only Collection Invoices may enter the setup/verification synchronization path.",
  );
  assert.match(
    accessControlSource,
    /shouldSyncMerchantSetup:\s*requestedInvoiceType === "collection" && getPlan\(merchant\) !== "starter"/,
    "Record Invoice access must never request setup synchronization for a paid plan.",
  );

  console.log("invoice-creation-access.test.ts passed");
}

void run();
