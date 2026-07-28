import assert from "node:assert/strict";

import {
  getUpgradeCheckoutDisabledReason,
  isPlaceholderOwnerName,
  selectUpgradePaymentMethod,
  type UpgradeCheckoutAvailableMethod,
  type UpgradeCheckoutReadinessInput,
} from "../src/lib/checkout/upgrade-rules";

const cardMethod: UpgradeCheckoutAvailableMethod = {
  method: "card",
  enabled: true,
};

const cryptoMethod: UpgradeCheckoutAvailableMethod = {
  method: "crypto",
  enabled: true,
};

function readyInput(
  overrides: Partial<UpgradeCheckoutReadinessInput> = {},
): UpgradeCheckoutReadinessInput {
  return {
    loadingMerchant: false,
    paymentMethodsLoading: false,
    availableMethods: [cardMethod],
    selectedPaymentMethod: "card",
    ownerName: "Ada Lovelace",
    relationshipClaim: "owner_affiliated_claim",
    verificationDisclosureAccepted: true,
    disclosureVersion: "1.0",
    currentUserIsOwner: true,
    isSubmitting: false,
    ...overrides,
  };
}

async function run() {
  assert.equal(getUpgradeCheckoutDisabledReason(readyInput()), null);

  assert.equal(
    getUpgradeCheckoutDisabledReason(readyInput({ paymentMethodsLoading: true })),
    "Payment methods are still loading.",
  );

  assert.equal(
    getUpgradeCheckoutDisabledReason(readyInput({ availableMethods: [], selectedPaymentMethod: null })),
    "No supported payment method is currently available.",
  );

  assert.equal(
    getUpgradeCheckoutDisabledReason(readyInput({ selectedPaymentMethod: null })),
    "Select a payment method.",
  );

  assert.equal(
    getUpgradeCheckoutDisabledReason(readyInput({ verificationDisclosureAccepted: false })),
    "Accept the verification disclosure.",
  );

  assert.equal(
    getUpgradeCheckoutDisabledReason(readyInput({ relationshipClaim: null })),
    "Confirm your relationship to this business.",
  );

  assert.equal(
    getUpgradeCheckoutDisabledReason(readyInput({ ownerName: "" })),
    "Enter the account owner's name.",
  );

  assert.equal(isPlaceholderOwnerName("John Doe"), true);
  assert.equal(isPlaceholderOwnerName("  john   doe  "), true);
  assert.equal(isPlaceholderOwnerName("Ada Lovelace"), false);
  assert.equal(
    getUpgradeCheckoutDisabledReason(readyInput({ ownerName: "John Doe" })),
    "Enter the account owner's real name.",
  );

  assert.equal(
    getUpgradeCheckoutDisabledReason(readyInput({ currentUserIsOwner: false })),
    "Only the account owner can make this payment.",
  );

  assert.equal(
    getUpgradeCheckoutDisabledReason(readyInput({ isSubmitting: true })),
    "Payment initialization is already in progress.",
  );

  assert.equal(
    getUpgradeCheckoutDisabledReason(readyInput({ paymentResumeAvailable: true })),
    "A payment is already available to resume.",
  );

  assert.equal(
    getUpgradeCheckoutDisabledReason(readyInput({ disclosureVersion: "" })),
    "Verification disclosure version is missing.",
  );

  assert.equal(
    getUpgradeCheckoutDisabledReason(
      readyInput({
        availableMethods: [cardMethod],
        selectedPaymentMethod: "card",
      }),
    ),
    null,
    "Breet absence must not disable a valid fiat/card method.",
  );

  assert.equal(
    selectUpgradePaymentMethod("crypto", [cardMethod]),
    "card",
    "The first fiat method is selected when crypto is unavailable.",
  );

  assert.equal(
    selectUpgradePaymentMethod("crypto", [cardMethod, cryptoMethod]),
    "crypto",
    "Crypto remains selectable when the endpoint explicitly returns it.",
  );

  assert.equal(
    getUpgradeCheckoutDisabledReason(
      readyInput({
        // Case-level pending is the initial Solo Plus state; provider payment state is separate.
        availableMethods: [cardMethod],
        selectedPaymentMethod: "card",
      }),
    ),
    null,
    "Initial case payment_status=pending alone must not disable payment initialization.",
  );

  console.log("upgrade-checkout-rules.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
