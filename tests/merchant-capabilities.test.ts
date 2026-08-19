import assert from "node:assert/strict";
import {
  resolveMerchantCapabilities,
  type MerchantCapabilityBlockingReasonCode,
  type ResolveMerchantCapabilitiesInput,
} from "../src/lib/compliance/merchant-capabilities";

function approvedInput(
  commercialPlan: "solo_lite" | "solo_plus" | "business" | "individual" | "corporate",
): ResolveMerchantCapabilitiesInput {
  const normalizedPlan =
    commercialPlan === "individual"
      ? "solo_lite"
      : commercialPlan === "corporate"
        ? "business"
        : commercialPlan;

  return {
    commercialPlan,
    complianceStatus:
      normalizedPlan === "solo_lite"
        ? "lite_verified"
        : normalizedPlan === "solo_plus"
          ? "enhanced_verified"
          : "business_verified",
    activationStatus: "approved",
    riskRating: "low",
    restrictionState: "active",
    setupMode: false,
    liveFeaturesEnabled: true,
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
    collectionLimit: {
      basis: normalizedPlan === "solo_lite" ? "cumulative" : "approved_volume",
      limitNgn: normalizedPlan === "solo_lite" ? 8_000_000 : 10_000_000,
      usedNgn: 250_000,
      approved: true,
    },
  };
}

function assertHasReason(
  input: ResolveMerchantCapabilitiesInput,
  code: MerchantCapabilityBlockingReasonCode,
) {
  const result = resolveMerchantCapabilities(input);
  assert.ok(
    result.requiredBlockingReasons.some((item) => item.code === code),
    `Expected blocking reason ${code}`,
  );
  return result;
}

function run() {
  const starter = resolveMerchantCapabilities({
    commercialPlan: "starter",
    restrictionState: "active",
  });
  assert.equal(starter.canCreateRecordInvoice, true);
  assert.equal(starter.canCreateCollectionInvoice, false);
  assert.equal(starter.canUseCheckout, false);
  assert.equal(starter.canUseLiveStorefront, false);
  assert.equal(starter.canUseInstantSale, false);
  assert.equal(starter.canUseReceivableSale, false);
  assert.equal(starter.canUseDepositBalance, false);
  assert.equal(starter.requiresVerification, false);
  assert.ok(starter.requiredBlockingReasons.some((item) => item.code === "starter_plan"));

  const soloLitePaidSetup = resolveMerchantCapabilities({
    ...approvedInput("solo_lite"),
    complianceStatus: "lite_pending",
    activationStatus: "paid_setup",
    setupMode: true,
    liveFeaturesEnabled: false,
    settlementReadiness: {
      payoutAccountVerified: false,
      providerMappingReady: false,
    },
  });
  assert.equal(soloLitePaidSetup.canCreateRecordInvoice, true);
  assert.equal(soloLitePaidSetup.canCreateCollectionInvoice, false);
  assert.equal(soloLitePaidSetup.canUseInstantSale, false);
  assert.equal(soloLitePaidSetup.requiresVerification, true);
  assert.ok(
    soloLitePaidSetup.requiredBlockingReasons.some(
      (item) => item.code === "lite_verification_required",
    ),
  );
  assert.ok(
    soloLitePaidSetup.requiredBlockingReasons.some((item) => item.code === "setup_mode_active"),
  );
  assert.ok(
    soloLitePaidSetup.requiredBlockingReasons.some(
      (item) => item.code === "live_features_disabled",
    ),
  );

  const soloLiteApproved = resolveMerchantCapabilities(approvedInput("solo_lite"));
  assert.equal(soloLiteApproved.canCreateCollectionInvoice, true);
  assert.equal(soloLiteApproved.canUseCheckout, true);
  assert.equal(soloLiteApproved.canUseLiveStorefront, true);
  assert.equal(soloLiteApproved.canUseInstantSale, true);
  assert.equal(soloLiteApproved.canUseReceivableSale, false);
  assert.equal(soloLiteApproved.canUseDepositBalance, false);
  assert.equal(soloLiteApproved.requiresVerification, false);
  assert.equal(soloLiteApproved.collectionLimit?.remainingNgn, 7_750_000);
  assert.ok(
    soloLiteApproved.blockingReasons.receivableSale.some(
      (item) => item.code === "receivable_sale_not_in_plan",
    ),
  );

  const soloPlusPaidUnapproved = resolveMerchantCapabilities({
    ...approvedInput("solo_plus"),
    complianceStatus: "enhanced_pending",
    activationStatus: "awaiting_review",
    setupMode: true,
    liveFeaturesEnabled: false,
  });
  assert.equal(soloPlusPaidUnapproved.canCreateCollectionInvoice, false);
  assert.equal(soloPlusPaidUnapproved.canUseReceivableSale, false);
  assert.equal(soloPlusPaidUnapproved.canUseDepositBalance, false);
  assert.equal(soloPlusPaidUnapproved.requiresVerification, true);

  const soloPlusApproved = resolveMerchantCapabilities(approvedInput("solo_plus"));
  assert.equal(soloPlusApproved.canCreateCollectionInvoice, true);
  assert.equal(soloPlusApproved.canUseInstantSale, true);
  assert.equal(soloPlusApproved.canUseReceivableSale, true);
  assert.equal(soloPlusApproved.canUseDepositBalance, true);

  const businessApproved = resolveMerchantCapabilities(approvedInput("business"));
  assert.equal(businessApproved.canCreateCollectionInvoice, true);
  assert.equal(businessApproved.canUseLiveStorefront, true);
  assert.equal(businessApproved.canUseReceivableSale, true);

  const missingSettlement = assertHasReason(
    { ...approvedInput("solo_plus"), settlementReadiness: null },
    "settlement_readiness_missing",
  );
  assert.equal(missingSettlement.canCreateCollectionInvoice, false);
  assert.equal(missingSettlement.canUseReceivableSale, false);

  const missingFeatureFlags = assertHasReason(
    { ...approvedInput("solo_lite"), featureFlags: null },
    "feature_flags_missing",
  );
  assert.equal(missingFeatureFlags.canCreateCollectionInvoice, false);
  assert.equal(missingFeatureFlags.canUseLiveStorefront, false);
  assert.equal(missingFeatureFlags.canUseInstantSale, false);

  const missingInstantSaleFlag = resolveMerchantCapabilities({
    ...approvedInput("solo_lite"),
    featureFlags: {
      storefrontEnabled: true,
      receivableSaleEnabled: true,
      merchantConfirmationBeforeDepositEnabled: true,
      customerRegistrationRequiredForReceivables: true,
    },
  });
  assert.equal(missingInstantSaleFlag.canCreateCollectionInvoice, true);
  assert.equal(missingInstantSaleFlag.canUseLiveStorefront, true);
  assert.equal(missingInstantSaleFlag.canUseInstantSale, false);
  assert.ok(
    missingInstantSaleFlag.blockingReasons.instantSale.some(
      (item) => item.code === "instant_sale_flag_missing",
    ),
  );

  const setupModeActive = assertHasReason(
    { ...approvedInput("solo_lite"), setupMode: true },
    "setup_mode_active",
  );
  assert.equal(setupModeActive.canCreateCollectionInvoice, false);

  const liveFeaturesDisabled = assertHasReason(
    { ...approvedInput("solo_lite"), liveFeaturesEnabled: false },
    "live_features_disabled",
  );
  assert.equal(liveFeaturesDisabled.canUseInstantSale, false);

  const restricted = assertHasReason(
    { ...approvedInput("business"), restrictionState: "restricted" },
    "merchant_restricted",
  );
  assert.equal(restricted.canCreateRecordInvoice, true);
  assert.equal(restricted.canCreateCollectionInvoice, false);
  assert.equal(restricted.canUseLiveStorefront, false);

  const suspended = assertHasReason(
    { ...approvedInput("solo_plus"), restrictionState: "suspended" },
    "merchant_suspended",
  );
  assert.equal(suspended.canCreateCollectionInvoice, false);
  assert.equal(suspended.canUseReceivableSale, false);

  const individualAlias = resolveMerchantCapabilities(approvedInput("individual"));
  assert.equal(individualAlias.normalizedPlan, "solo_lite");
  assert.equal(individualAlias.canUseInstantSale, true);
  assert.equal(individualAlias.canUseReceivableSale, false);

  const corporateAlias = resolveMerchantCapabilities(approvedInput("corporate"));
  assert.equal(corporateAlias.normalizedPlan, "business");
  assert.equal(corporateAlias.canUseInstantSale, true);
  assert.equal(corporateAlias.canUseReceivableSale, true);

  const missingRisk = assertHasReason(
    { ...approvedInput("solo_lite"), riskRating: null },
    "risk_rating_missing",
  );
  assert.equal(missingRisk.canCreateCollectionInvoice, false);

  const reachedLimit = assertHasReason(
    {
      ...approvedInput("solo_plus"),
      collectionLimit: {
        basis: "approved_volume",
        limitNgn: 10_000_000,
        usedNgn: 10_000_000,
        approved: true,
      },
    },
    "collection_limit_reached",
  );
  assert.equal(reachedLimit.canUseCheckout, false);

  console.log("merchant-capabilities.test.ts passed");
}

run();
