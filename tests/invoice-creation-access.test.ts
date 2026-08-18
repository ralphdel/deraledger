import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  canAccessFeature,
  getInvoiceCreationAccess,
} from "../src/lib/services/access-control";
import { isSuperadminSandboxMerchant } from "../src/lib/services/onboarding-flow.service";

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

  const actionsSource = readFileSync("src/lib/actions.ts", "utf8");
  assert.match(actionsSource, /requirePermission\(data\.merchant_id, "create_invoice"\)/);
  assert.match(actionsSource, /\.maybeSingle\(\)[\s\S]+Workspace could not be resolved/);
  assert.match(
    actionsSource,
    /if \(invoiceAccess\.shouldSyncMerchantSetup\) \{[\s\S]+syncMerchantSetupStatus/,
    "Only collection-capable plans may enter the setup/verification synchronization path.",
  );

  console.log("invoice-creation-access.test.ts passed");
}

void run();
