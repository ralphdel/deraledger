import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildTrustedRuntimeCapabilityContext,
  toResolveMerchantCapabilitiesInput,
} from "../src/lib/compliance/runtime-capability-context";
import { resolveMerchantCapabilities } from "../src/lib/compliance/merchant-capabilities";

function baseSource() {
  return {
    merchantId: "merchant-1",
    workspaceId: "workspace-1",
    commercialPlan: "solo_lite",
    subscriptionStatus: "active",
    paymentEntitlementState: "paid_setup",
    setupMode: false,
    liveFeaturesEnabled: true,
    complianceStatus: "lite_verified",
    activationStatus: "approved",
    riskRating: "low",
    restrictionState: "active",
    approvedMonthlyVolumeNgn: 5_000_000,
    cumulativeCollectionCapNgn: 8_000_000,
    cumulativeCollectionUsedNgn: 250_000,
    hiddenDailyVelocityLimitNgn: 250_000,
    singleTransactionLimitNgn: 100_000,
    collectionLimit: {
      basis: "cumulative" as const,
      limitNgn: 8_000_000,
      usedNgn: 250_000,
      approved: true,
    },
    featureFlags: {
      storefrontEnabled: true,
      instantSaleEnabled: true,
      receivableSaleEnabled: true,
      merchantConfirmationBeforeDepositEnabled: true,
      customerRegistrationRequiredForReceivables: true,
    },
    settlementReadiness: {
      payoutAccountVerified: true,
      providerMappingReady: true,
    },
    soloPlusEnhancedVerificationStatus: null,
    businessKybVerificationStatus: null,
  };
}

function run() {
  const incomplete = buildTrustedRuntimeCapabilityContext({
    merchantId: "merchant-1",
    workspaceId: "workspace-1",
    commercialPlan: "individual",
  });
  assert.equal(incomplete.commercialPlan, "solo_lite");
  assert.equal(incomplete.complianceStatus, null);
  assert.equal(incomplete.riskRating, null);
  assert.equal(incomplete.limits.collectionLimit, null);
  assert.equal(incomplete.setupMode, null);
  assert.equal(incomplete.liveFeaturesEnabled, null);
  assert.equal(incomplete.settlementReadiness, null);

  const incompleteCapabilities = resolveMerchantCapabilities(
    toResolveMerchantCapabilitiesInput(incomplete),
  );
  assert.equal(incompleteCapabilities.canCreateRecordInvoice, true);
  assert.equal(incompleteCapabilities.canCreateCollectionInvoice, false);
  assert.equal(incompleteCapabilities.canUseCheckout, false);
  assert.ok(
    incompleteCapabilities.requiredBlockingReasons.some(
      (reason) => reason.code === "compliance_status_missing",
    ),
  );
  assert.ok(
    incompleteCapabilities.requiredBlockingReasons.some(
      (reason) => reason.code === "risk_rating_missing",
    ),
  );
  assert.ok(
    incompleteCapabilities.requiredBlockingReasons.some(
      (reason) => reason.code === "collection_limit_missing",
    ),
  );
  assert.ok(
    incompleteCapabilities.requiredBlockingReasons.some(
      (reason) => reason.code === "feature_flags_missing",
    ),
  );

  const corporate = buildTrustedRuntimeCapabilityContext({
    ...baseSource(),
    commercialPlan: "corporate",
    complianceStatus: "business_verified",
    businessKybVerificationStatus: "approved",
  });
  assert.equal(corporate.commercialPlan, "business");

  const soloPlus = buildTrustedRuntimeCapabilityContext({
    ...baseSource(),
    commercialPlan: "solo_plus",
    complianceStatus: "lite_verified",
    soloPlusEnhancedVerificationStatus: "pending",
  });
  assert.equal(soloPlus.commercialPlan, "solo_plus");
  assert.notEqual(soloPlus.commercialPlan, "solo_lite");
  const soloPlusCapabilities = resolveMerchantCapabilities(
    toResolveMerchantCapabilitiesInput(soloPlus),
  );
  assert.equal(soloPlusCapabilities.canCreateCollectionInvoice, false);
  assert.ok(
    soloPlusCapabilities.requiredBlockingReasons.some(
      (reason) => reason.code === "enhanced_verification_required",
    ),
  );

  const missingLiveStates = buildTrustedRuntimeCapabilityContext({
    ...baseSource(),
    setupMode: null,
    liveFeaturesEnabled: undefined,
    settlementReadiness: { payoutAccountVerified: true },
  });
  assert.equal(missingLiveStates.setupMode, null);
  assert.equal(missingLiveStates.liveFeaturesEnabled, null);
  assert.deepEqual(missingLiveStates.settlementReadiness, {
    payoutAccountVerified: true,
    providerMappingReady: null,
  });
  const missingLiveCapabilities = resolveMerchantCapabilities(
    toResolveMerchantCapabilitiesInput(missingLiveStates),
  );
  assert.equal(missingLiveCapabilities.canCreateCollectionInvoice, false);
  assert.ok(
    missingLiveCapabilities.requiredBlockingReasons.some(
      (reason) => reason.code === "setup_mode_missing",
    ),
  );
  assert.ok(
    missingLiveCapabilities.requiredBlockingReasons.some(
      (reason) => reason.code === "live_features_state_missing",
    ),
  );
  assert.ok(
    missingLiveCapabilities.requiredBlockingReasons.some(
      (reason) => reason.code === "settlement_mapping_not_ready",
    ),
  );

  const businessWithoutApprovedVolume = buildTrustedRuntimeCapabilityContext({
    ...baseSource(),
    commercialPlan: "business",
    complianceStatus: "business_verified",
    approvedMonthlyVolumeNgn: null,
    collectionLimit: null,
    businessKybVerificationStatus: "approved",
  });
  assert.equal(businessWithoutApprovedVolume.limits.approvedMonthlyVolumeNgn, null);
  assert.equal(businessWithoutApprovedVolume.limits.collectionLimit, null);
  assert.equal(
    resolveMerchantCapabilities(
      toResolveMerchantCapabilitiesInput(businessWithoutApprovedVolume),
    ).canCreateCollectionInvoice,
    false,
  );

  const businessKybOnly = buildTrustedRuntimeCapabilityContext({
    ...baseSource(),
    commercialPlan: "business",
    complianceStatus: null,
    businessKybVerificationStatus: "approved",
  });
  assert.equal(businessKybOnly.complianceStatus, null);
  assert.equal(
    resolveMerchantCapabilities(
      toResolveMerchantCapabilitiesInput(businessKybOnly),
    ).canCreateCollectionInvoice,
    false,
  );

  const missingIdentity = buildTrustedRuntimeCapabilityContext(baseSource());
  const unresolvedIdentity = buildTrustedRuntimeCapabilityContext({
    ...baseSource(),
    merchantId: null,
  });
  assert.equal(missingIdentity.hasTrustedMerchantWorkspace, true);
  assert.equal(unresolvedIdentity.hasTrustedMerchantWorkspace, false);
  assert.equal(
    resolveMerchantCapabilities(
      toResolveMerchantCapabilitiesInput(unresolvedIdentity),
    ).canCreateCollectionInvoice,
    false,
  );

  const moduleSource = readFileSync(
    "src/lib/compliance/runtime-capability-context.ts",
    "utf8",
  );
  assert.doesNotMatch(moduleSource, /isSuperadminSandboxMerchant|SUPERADMIN_SANDBOX_EMAIL/);

  console.log("runtime-capability-context.test.ts passed");
}

run();
