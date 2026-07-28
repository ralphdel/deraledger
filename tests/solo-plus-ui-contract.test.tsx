import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { AdminReviewForm } from "../src/components/solo-plus/admin-review-form";
import { RequirementsChecklist } from "../src/components/solo-plus/requirements-checklist";
import {
  getSoloPlusDecisionConfirmationCopy,
  getSoloPlusBillingActionPresentation,
  getSoloPlusMerchantStatusPresentation,
  getSoloPlusQueueEmptyState,
  getSoloPlusRequirementPresentation,
  getSoloPlusStatusPath,
  isSoloPlusOwnerEligible,
  shouldPollSoloPlusCase,
} from "../src/lib/solo-plus/ui";
import type { SoloPlusBrowserCaseDto } from "../src/lib/solo-plus/server/route-contracts";

function buildCaseDto(
  overrides: Partial<SoloPlusBrowserCaseDto> = {},
): SoloPlusBrowserCaseDto {
  return {
    caseId: "11111111-1111-4111-8111-111111111111",
    flowOrigin: "upgrade",
    caseStatus: "verification_pending",
    paymentStatus: "paid",
    refundStatus: "none",
    rowVersion: 4,
    reviewState: "verification_pending",
    actionRequired: "complete_requirements",
    merchantVisibleReason: null,
    statusChangedAt: "2026-07-14T10:00:00.000Z",
    reviewOutcome: "verification_pending",
    activationState: "inactive",
    createdAt: "2026-07-13T10:00:00.000Z",
    updatedAt: "2026-07-14T10:00:00.000Z",
    requirements: [
      {
        requirementCode: "id_document",
        requirementState: "not_started",
        evidenceSourceType: null,
        evidenceReference: null,
        completedAt: null,
        updatedAt: "2026-07-14T10:00:00.000Z",
      },
      {
        requirementCode: "activity_profile",
        requirementState: "failed",
        evidenceSourceType: null,
        evidenceReference: null,
        completedAt: null,
        updatedAt: "2026-07-14T10:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

async function run() {
  assert.equal(
    isSoloPlusOwnerEligible({ currentUserRole: "owner", subscriptionPlan: "individual" }),
    true,
  );
  assert.equal(
    isSoloPlusOwnerEligible({ currentUserRole: "owner", subscriptionPlan: "starter" }),
    true,
  );
  assert.equal(
    isSoloPlusOwnerEligible({ currentUserRole: "viewer", subscriptionPlan: "individual" }),
    false,
  );
  assert.equal(isSoloPlusOwnerEligible({ currentUserRole: null, subscriptionPlan: "starter" }), false);

  assert.deepEqual(
    getSoloPlusBillingActionPresentation({
      currentPlan: "starter",
      currentUserRole: null,
      soloPlusAvailable: true,
      soloPlusAvailabilityLoaded: false,
    }),
    {
      kind: "disabled",
      label: "Checking Solo Plus access...",
      helperText: "Please wait while we confirm your account access.",
    },
  );

  assert.deepEqual(
    getSoloPlusBillingActionPresentation({
      currentPlan: "starter",
      currentUserRole: "owner",
      soloPlusAvailable: true,
      soloPlusAvailabilityLoaded: true,
    }),
    {
      kind: "link",
      label: "Upgrade to Solo Plus",
      href: "/settings/upgrade/solo_plus",
    },
  );

  assert.deepEqual(
    getSoloPlusBillingActionPresentation({
      currentPlan: "starter",
      currentUserRole: "owner",
      soloPlusAvailable: false,
      soloPlusAvailabilityLoaded: true,
    }),
    {
      kind: "disabled",
      label: "Solo Plus unavailable",
      helperText: "Solo Plus is not available for this workspace right now.",
    },
  );

  assert.deepEqual(
    getSoloPlusBillingActionPresentation({
      currentPlan: "starter",
      currentUserRole: "viewer",
      soloPlusAvailable: true,
      soloPlusAvailabilityLoaded: true,
    }),
    {
      kind: "disabled",
      label: "Solo Plus is owner only",
      helperText: "This upgrade is available only to the account owner.",
    },
  );

  assert.deepEqual(
    getSoloPlusBillingActionPresentation({
      currentPlan: "starter",
      currentUserRole: "owner",
      soloPlusAvailable: false,
      soloPlusAvailabilityLoaded: false,
    }),
    {
      kind: "disabled",
      label: "Checking Solo Plus availability...",
      helperText: "Please wait while we confirm whether Solo Plus can be started right now.",
    },
  );

  {
    const presentation = getSoloPlusMerchantStatusPresentation(buildCaseDto());
    assert.equal(presentation.heading, "Complete your requirements");
    assert.equal(presentation.badge, "Requirements needed");
  }

  {
    const presentation = getSoloPlusMerchantStatusPresentation(
      buildCaseDto({
        reviewState: "more_information_required",
        actionRequired: "resubmit_information",
        merchantVisibleReason: "Need a clearer proof of address.",
      }),
    );
    assert.equal(presentation.heading, "More information required");
    assert.equal(presentation.showReason, true);
  }

  {
    const presentation = getSoloPlusMerchantStatusPresentation(
      buildCaseDto({
        reviewState: "approved",
        actionRequired: "none",
        activationState: "approved_pending_activation",
        caseStatus: "approved",
      }),
    );
    assert.equal(presentation.heading, "Activation pending");
    assert.equal(shouldPollSoloPlusCase(buildCaseDto({
      reviewState: "approved",
      actionRequired: "none",
      activationState: "approved_pending_activation",
      caseStatus: "approved",
    })), true);
  }

  {
    const presentation = getSoloPlusRequirementPresentation(
      buildCaseDto().requirements[1],
      "resubmit_information",
    );
    assert.equal(presentation.label, "Activity profile");
    assert.equal(presentation.usesStructuredForm, true);
    assert.equal(presentation.actionable, true);
  }

  assert.equal(getSoloPlusStatusPath("upgrade"), "/settings/upgrade/solo_plus/status");
  assert.equal(getSoloPlusStatusPath("onboarding"), "/onboarding/solo_plus/status");

  assert.deepEqual(
    getSoloPlusBillingActionPresentation({
      currentPlan: "solo_lite",
      currentUserRole: "owner",
      soloPlusAvailable: true,
      soloPlusAvailabilityLoaded: true,
    }),
    {
      kind: "link",
      label: "Open Solo Plus Review",
      href: "/settings/upgrade/solo_plus/status",
    },
  );

  assert.deepEqual(
    getSoloPlusBillingActionPresentation({
      currentPlan: "solo_plus",
      currentUserRole: "owner",
      soloPlusAvailable: false,
      soloPlusAvailabilityLoaded: false,
    }),
    {
      kind: "link",
      label: "View Solo Plus Status",
      href: "/settings/upgrade/solo_plus/status",
    },
  );

  const checklistMarkup = renderToStaticMarkup(
    <RequirementsChecklist caseData={buildCaseDto()} onCaseRefresh={() => undefined} />,
  );
  assert.equal(checklistMarkup.includes("Submit activity profile"), true);
  assert.equal(
    checklistMarkup.includes("Additional verification for this requirement will be handled through the existing verification process."),
    true,
  );
  assert.equal(checklistMarkup.includes('type="file"'), false);
  assert.equal(checklistMarkup.includes("storageKey"), false);
  assert.equal(checklistMarkup.includes("providerReference"), false);

  const reviewFormMarkup = renderToStaticMarkup(
    <AdminReviewForm
      caseId="11111111-1111-4111-8111-111111111111"
      rowVersion={4}
      onSuccess={() => undefined}
    />,
  );
  assert.equal(reviewFormMarkup.includes("Activate"), false);
  assert.equal(reviewFormMarkup.includes("Approve"), true);

  const confirmation = getSoloPlusDecisionConfirmationCopy("approve");
  assert.equal(confirmation.description.includes("does not activate"), true);

  const emptyState = getSoloPlusQueueEmptyState("manual_review");
  assert.equal(emptyState.heading, "No cases waiting for review");

  console.log("solo-plus-ui-contract.test.tsx passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
