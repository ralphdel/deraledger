export type UpgradeCheckoutPaymentMethod = "card" | "bank_transfer" | "ussd" | "crypto";

export type UpgradeCheckoutAvailableMethod = {
  method: UpgradeCheckoutPaymentMethod;
  enabled?: boolean;
};

export type UpgradeCheckoutReadinessInput = {
  loadingMerchant: boolean;
  paymentMethodsLoading: boolean;
  availableMethods: readonly UpgradeCheckoutAvailableMethod[];
  selectedPaymentMethod: UpgradeCheckoutPaymentMethod | null;
  ownerName: string;
  relationshipClaim: string | null;
  verificationDisclosureAccepted: boolean;
  disclosureVersion: string | null;
  currentUserIsOwner: boolean;
  isSubmitting: boolean;
  paymentResumeAvailable?: boolean;
};

const PLACEHOLDER_OWNER_NAMES = new Set(["john doe", "jane doe"]);

export function isPlaceholderOwnerName(value: string): boolean {
  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  return PLACEHOLDER_OWNER_NAMES.has(normalized);
}

export function selectUpgradePaymentMethod(
  currentMethod: UpgradeCheckoutPaymentMethod,
  methods: readonly UpgradeCheckoutAvailableMethod[],
): UpgradeCheckoutPaymentMethod | null {
  if (methods.some((method) => method.method === currentMethod)) {
    return currentMethod;
  }

  return methods[0]?.method ?? null;
}

export function getUpgradeCheckoutDisabledReason(
  input: UpgradeCheckoutReadinessInput,
): string | null {
  if (input.isSubmitting) {
    return "Payment initialization is already in progress.";
  }

  if (input.loadingMerchant) {
    return "Loading workspace details.";
  }

  if (input.paymentMethodsLoading) {
    return "Payment methods are still loading.";
  }

  if (!input.currentUserIsOwner) {
    return "Only the account owner can make this payment.";
  }

  if (input.paymentResumeAvailable) {
    return "A payment is already available to resume.";
  }

  if (input.availableMethods.length === 0) {
    return "No supported payment method is currently available.";
  }

  if (!input.selectedPaymentMethod) {
    return "Select a payment method.";
  }

  if (!input.ownerName.trim()) {
    return "Enter the account owner's name.";
  }

  if (isPlaceholderOwnerName(input.ownerName)) {
    return "Enter the account owner's real name.";
  }

  if (!input.relationshipClaim) {
    return "Confirm your relationship to this business.";
  }

  if (!input.verificationDisclosureAccepted) {
    return "Accept the verification disclosure.";
  }

  if (!input.disclosureVersion?.trim()) {
    return "Verification disclosure version is missing.";
  }

  return null;
}
