import type {
  SoloPlusAdminCaseDetailDto,
  SoloPlusBrowserCaseDto,
  SoloPlusBrowserRequirementSummaryDto,
  SoloPlusMerchantActionRequired,
} from "./server/route-contracts";

export type SoloPlusMerchantStatusPresentation = {
  heading: string;
  badge: string;
  description: string;
  tone: "neutral" | "warning" | "success" | "danger";
  showReason: boolean;
};

export type SoloPlusRequirementPresentation = {
  label: string;
  stateLabel: string;
  description: string;
  tone: "neutral" | "warning" | "success" | "danger";
  actionable: boolean;
  usesStructuredForm: boolean;
};

export const SOLO_PLUS_REQUIREMENT_LABELS: Record<
  SoloPlusBrowserRequirementSummaryDto["requirementCode"],
  string
> = {
  bvn: "Bank Verification Number",
  selfie_liveness: "Selfie and liveness check",
  id_document: "Identity document",
  proof_of_address: "Proof of address",
  settlement_account: "Settlement account",
  activity_profile: "Activity profile",
};

function hasActionableRequirements(
  requirements: readonly SoloPlusBrowserRequirementSummaryDto[],
): boolean {
  return requirements.some(
    (requirement) =>
      requirement.requirementState === "not_started" ||
      requirement.requirementState === "failed",
  );
}

export function isSoloPlusOwnerEligible(input: {
  currentUserRole?: string | null;
  subscriptionPlan?: string | null;
} | null): boolean {
  if (!input) {
    return false;
  }

  return input.currentUserRole === "owner";
}

export function getSoloPlusStatusPath(flowOrigin: "onboarding" | "upgrade"): string {
  return flowOrigin === "onboarding"
    ? "/onboarding/solo_plus/status"
    : "/settings/upgrade/solo_plus/status";
}

export function getSoloPlusCheckoutPath(flowOrigin: "onboarding" | "upgrade"): string {
  return flowOrigin === "onboarding"
    ? "/checkout/subscription?plan=solo_plus"
    : "/checkout/upgrade/solo_plus";
}

export type SoloPlusBillingActionPresentation =
  | {
      kind: "link";
      label: string;
      href: string;
    }
  | {
      kind: "disabled";
      label: string;
      helperText: string;
    };

export function getSoloPlusBillingActionPresentation(input: {
  currentPlan: string | null | undefined;
  currentUserRole?: string | null;
  soloPlusAvailable: boolean;
  soloPlusAvailabilityLoaded: boolean;
}): SoloPlusBillingActionPresentation | null {
  const currentPlan = input.currentPlan === "individual" ? "solo_lite" : input.currentPlan;

  if (
    currentPlan !== "starter" &&
    currentPlan !== "solo_lite" &&
    currentPlan !== "solo_plus"
  ) {
    return null;
  }

  if (input.currentUserRole == null) {
    return {
      kind: "disabled",
      label: "Checking Solo Plus access...",
      helperText: "Please wait while we confirm your account access.",
    };
  }

  if (input.currentUserRole !== "owner") {
    return {
      kind: "disabled",
      label: "Solo Plus is owner only",
      helperText: "This upgrade is available only to the account owner.",
    };
  }

  if (currentPlan === "solo_plus") {
    return {
      kind: "link",
      label: "View Solo Plus Status",
      href: getSoloPlusStatusPath("upgrade"),
    };
  }

  if (!input.soloPlusAvailabilityLoaded) {
    return {
      kind: "disabled",
      label: "Checking Solo Plus availability...",
      helperText: "Please wait while we confirm whether Solo Plus can be started right now.",
    };
  }

  if (!input.soloPlusAvailable) {
    return {
      kind: "disabled",
      label: "Solo Plus unavailable",
      helperText: "Solo Plus is not available for this workspace right now.",
    };
  }

  return currentPlan === "starter"
    ? {
        kind: "link",
        label: "Upgrade to Solo Plus",
        href: "/settings/upgrade/solo_plus",
      }
    : {
        kind: "link",
        label: "Open Solo Plus Review",
        href: getSoloPlusStatusPath("upgrade"),
      };
}

export function shouldPollSoloPlusCase(caseDto: SoloPlusBrowserCaseDto): boolean {
  if (caseDto.refundStatus === "processing") {
    return true;
  }

  if (caseDto.activationState === "approved_pending_activation") {
    return true;
  }

  return caseDto.reviewState === "under_review" ||
    (caseDto.reviewState === "verification_pending" && caseDto.paymentStatus === "pending");
}

export function getSoloPlusMerchantStatusPresentation(
  caseDto: SoloPlusBrowserCaseDto,
): SoloPlusMerchantStatusPresentation {
  if (caseDto.refundStatus === "review_required") {
    return {
      heading: "Refund review",
      badge: "Refund review",
      description: "A refund review is in progress for this Solo Plus request.",
      tone: "warning",
      showReason: false,
    };
  }

  if (caseDto.refundStatus === "processing") {
    return {
      heading: "Refund processing",
      badge: "Refund processing",
      description: "A refund is being processed for this Solo Plus request.",
      tone: "warning",
      showReason: false,
    };
  }

  if (caseDto.caseStatus === "draft") {
    return {
      heading: "Setup started",
      badge: "Setup started",
      description: "Your Solo Plus request has been started but not submitted for payment yet.",
      tone: "neutral",
      showReason: false,
    };
  }

  if (caseDto.caseStatus === "awaiting_payment") {
    return {
      heading: caseDto.paymentStatus === "failed" ? "Payment required" : "Payment pending",
      badge: caseDto.paymentStatus === "failed" ? "Payment required" : "Payment pending",
      description: caseDto.paymentStatus === "failed"
        ? "Your last payment attempt did not complete. Continue payment to keep this Solo Plus request moving."
        : "We are waiting for payment confirmation before verification can continue.",
      tone: "warning",
      showReason: false,
    };
  }

  if (caseDto.reviewState === "more_information_required") {
    return {
      heading: "More information required",
      badge: "More information required",
      description: "Update the requested verification details so this Solo Plus review can continue.",
      tone: "warning",
      showReason: true,
    };
  }

  if (caseDto.reviewState === "under_review") {
    return {
      heading: "Under review",
      badge: "Under review",
      description: "Your verification details are with our review team right now.",
      tone: "neutral",
      showReason: false,
    };
  }

  if (caseDto.reviewState === "rejected") {
    return {
      heading: "Not approved",
      badge: "Not approved",
      description: "This Solo Plus request was not approved.",
      tone: "danger",
      showReason: true,
    };
  }

  if (caseDto.reviewState === "approved" && caseDto.activationState === "activated") {
    return {
      heading: "Active",
      badge: "Active",
      description: "Solo Plus has been approved and activated for this workspace.",
      tone: "success",
      showReason: false,
    };
  }

  if (caseDto.reviewState === "approved") {
    return {
      heading: "Activation pending",
      badge: "Approved",
      description: "Your Solo Plus request has been approved and is waiting for activation.",
      tone: "success",
      showReason: false,
    };
  }

  if (caseDto.reviewState === "cancelled" || caseDto.caseStatus === "cancelled") {
    return {
      heading: "Cancelled",
      badge: "Cancelled",
      description: "This Solo Plus request is closed and can no longer continue.",
      tone: "danger",
      showReason: false,
    };
  }

  if (
    caseDto.reviewState === "verification_pending" &&
    hasActionableRequirements(caseDto.requirements)
  ) {
    return {
      heading: "Complete your requirements",
      badge: "Requirements needed",
      description: "Payment has been received. Complete the required verification details to continue the review.",
      tone: "warning",
      showReason: false,
    };
  }

  return {
    heading: "Payment received",
    badge: "Payment received",
    description: "Your payment has been confirmed and the Solo Plus verification process is continuing.",
    tone: "success",
    showReason: false,
  };
}

export function getSoloPlusRequirementPresentation(
  requirement: SoloPlusBrowserRequirementSummaryDto,
  actionRequired: SoloPlusMerchantActionRequired,
): SoloPlusRequirementPresentation {
  switch (requirement.requirementState) {
    case "passed":
      return {
        label: SOLO_PLUS_REQUIREMENT_LABELS[requirement.requirementCode],
        stateLabel: "Satisfied",
        description: "This requirement has already been completed.",
        tone: "success",
        actionable: false,
        usesStructuredForm: false,
      };
    case "reused":
      return {
        label: SOLO_PLUS_REQUIREMENT_LABELS[requirement.requirementCode],
        stateLabel: "Reused",
        description: "We reused trusted information already on file for this requirement.",
        tone: "success",
        actionable: false,
        usesStructuredForm: false,
      };
    case "waived":
      return {
        label: SOLO_PLUS_REQUIREMENT_LABELS[requirement.requirementCode],
        stateLabel: "Waived",
        description: "This requirement does not need any extra action right now.",
        tone: "success",
        actionable: false,
        usesStructuredForm: false,
      };
    case "pending":
      return {
        label: SOLO_PLUS_REQUIREMENT_LABELS[requirement.requirementCode],
        stateLabel: "Pending",
        description: "We have your submission and it is waiting for the next review step.",
        tone: "neutral",
        actionable: false,
        usesStructuredForm: false,
      };
    case "processing":
      return {
        label: SOLO_PLUS_REQUIREMENT_LABELS[requirement.requirementCode],
        stateLabel: "Processing",
        description: "This verification step is still being processed.",
        tone: "neutral",
        actionable: false,
        usesStructuredForm: false,
      };
    case "needs_review":
      return {
        label: SOLO_PLUS_REQUIREMENT_LABELS[requirement.requirementCode],
        stateLabel: "Needs review",
        description: "This requirement is waiting for manual verification review.",
        tone: "warning",
        actionable: false,
        usesStructuredForm: false,
      };
    case "failed":
      return {
        label: SOLO_PLUS_REQUIREMENT_LABELS[requirement.requirementCode],
        stateLabel: actionRequired === "resubmit_information"
          ? "Needs resubmission"
          : "Needs attention",
        description: actionRequired === "resubmit_information"
          ? "Please resubmit the requested verification details for this requirement."
          : "This requirement still needs updated verification details.",
        tone: "danger",
        actionable: true,
        usesStructuredForm: requirement.requirementCode === "activity_profile",
      };
    case "not_started":
    default:
      return {
        label: SOLO_PLUS_REQUIREMENT_LABELS[requirement.requirementCode],
        stateLabel: "Not started",
        description: "This requirement still needs to be completed.",
        tone: "warning",
        actionable: true,
        usesStructuredForm: requirement.requirementCode === "activity_profile",
      };
  }
}

export function getSoloPlusQueueEmptyState(status: string): {
  heading: string;
  description: string;
} {
  if (status === "manual_review") {
    return {
      heading: "No cases waiting for review",
      description: "When a Solo Plus case reaches manual review, it will appear here.",
    };
  }

  return {
    heading: "No Solo Plus cases found",
    description: "Try adjusting the current filters or search term.",
  };
}

export function getSoloPlusReviewHistoryLabel(
  event: SoloPlusAdminCaseDetailDto["reviewHistory"][number],
): string {
  switch (event.decision) {
    case "request_more_information":
      return "Requested more information";
    case "approve":
      return "Approved";
    case "reject":
      return "Rejected";
    case "reopen":
      return "Reopened";
    default:
      return event.eventType.replaceAll("_", " ");
  }
}

export function getSoloPlusDecisionConfirmationCopy(decision: string): {
  title: string;
  description: string;
} {
  switch (decision) {
    case "approve":
      return {
        title: "Approve Solo Plus review?",
        description: "Approval does not activate Solo Plus immediately. Activation remains a separate internal step.",
      };
    case "reject":
      return {
        title: "Reject Solo Plus review?",
        description: "This will mark the current Solo Plus request as not approved.",
      };
    default:
      return {
        title: "Send review decision?",
        description: "This decision will be recorded against the current Solo Plus review.",
      };
  }
}
