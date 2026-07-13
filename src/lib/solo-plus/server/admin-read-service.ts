import "server-only";

import type {
  SoloPlusAdminCaseDetailRecord,
  SoloPlusAdminCaseEventListInput,
  SoloPlusAdminCaseListInput,
  SoloPlusAdminCaseMerchantRecord,
  SoloPlusCaseEventRecord,
  SoloPlusCaseRepository,
  SoloPlusCaseRequirementRecord,
} from "../repository";
import { createSoloPlusSupabaseRepository, createSoloPlusServiceRoleClient, type SoloPlusSupabaseClientLike } from "./supabase-repository";
import {
  buildSoloPlusBrowserCaseSummaryDto,
  sanitizeMerchantVisibleReason,
  type SoloPlusAdminCaseDetailDto,
  type SoloPlusAdminEvidenceReferenceSummaryDto,
  type SoloPlusAdminPaymentSummaryDto,
  type SoloPlusAdminQueueItemDto,
  type SoloPlusAdminReviewHistoryEventDto,
  type SoloPlusAdminRefundSummaryDto,
} from "./route-contracts";
import {
  resolveSoloPlusAuthenticatedUser,
  type ResolveSoloPlusServerAccessOptions,
} from "./access-context";
import { isSatisfiedSoloPlusRequirementState } from "../state";

export type CreateSoloPlusAdminReadServiceOptions = Pick<
  ResolveSoloPlusServerAccessOptions,
  "authClient" | "serviceClient" | "env"
> & {
  repository?: SoloPlusCaseRepository;
  repositoryFactory?: (client: SoloPlusSupabaseClientLike) => SoloPlusCaseRepository;
};

export type SoloPlusAdminReadService = {
  repository: SoloPlusCaseRepository;
  adminUserId: string;
  listCases(input: SoloPlusAdminCaseListInput): Promise<{
    items: SoloPlusAdminQueueItemDto[];
    nextCursor: string | null;
  }>;
  getCaseDetail(
    caseId: string,
    historyInput: SoloPlusAdminCaseEventListInput,
  ): Promise<SoloPlusAdminCaseDetailDto | null>;
};

export class SoloPlusAdminReadServiceError extends Error {
  readonly code:
    | "SOLO_PLUS_SERVER_CONFIG_ERROR"
    | "SOLO_PLUS_SERVER_UNAUTHORIZED"
    | "SOLO_PLUS_SERVER_FORBIDDEN";

  constructor(
    code:
      | "SOLO_PLUS_SERVER_CONFIG_ERROR"
      | "SOLO_PLUS_SERVER_UNAUTHORIZED"
      | "SOLO_PLUS_SERVER_FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "SoloPlusAdminReadServiceError";
    this.code = code;
  }
}

function resolveRepository(
  options: CreateSoloPlusAdminReadServiceOptions,
  serviceClient?: SoloPlusSupabaseClientLike,
): SoloPlusCaseRepository {
  if (options.repository) {
    return options.repository;
  }

  const resolvedServiceClient = serviceClient || createSoloPlusServiceRoleClient();
  return options.repositoryFactory
    ? options.repositoryFactory(resolvedServiceClient)
    : createSoloPlusSupabaseRepository({ client: resolvedServiceClient });
}

function getMerchantDisplayName(merchant: SoloPlusAdminCaseMerchantRecord | null): string | null {
  if (!merchant) {
    return null;
  }

  return merchant.businessName || merchant.ownerName || null;
}

function buildRequirementSummary(
  requirements: readonly SoloPlusCaseRequirementRecord[],
): SoloPlusAdminQueueItemDto["requirementSummary"] {
  let satisfied = 0;
  let actionable = 0;
  let inProgress = 0;

  for (const requirement of requirements) {
    if (isSatisfiedSoloPlusRequirementState(requirement.requirementState)) {
      satisfied += 1;
      continue;
    }

    if (
      requirement.requirementState === "not_started" ||
      requirement.requirementState === "failed"
    ) {
      actionable += 1;
      continue;
    }

    inProgress += 1;
  }

  return {
    total: requirements.length,
    satisfied,
    actionable,
    inProgress,
  };
}

function buildEvidenceReferenceSummary(
  requirement: SoloPlusCaseRequirementRecord,
): SoloPlusAdminEvidenceReferenceSummaryDto | null {
  if (!requirement.evidenceSourceType) {
    return null;
  }

  const metadata = requirement.metadata;
  const fileType =
    typeof metadata.contentType === "string" && metadata.contentType.trim() !== ""
      ? metadata.contentType.trim()
      : null;
  const fileSizeBytes =
    typeof metadata.fileSizeBytes === "number" && Number.isSafeInteger(metadata.fileSizeBytes)
      ? metadata.fileSizeBytes
      : null;
  const capturedAt =
    typeof metadata.uploadedAt === "string" && metadata.uploadedAt.trim() !== ""
      ? metadata.uploadedAt.trim()
      : requirement.completedAt;

  const label =
    requirement.evidenceSourceType === "verification_log"
      ? "Verification evidence on file"
      : requirement.evidenceSourceType === "settlement_account"
      ? "Verified settlement account on file"
      : requirement.requirementCode === "activity_profile"
      ? "Activity profile submitted"
      : "Merchant evidence on file";

  return {
    sourceType: requirement.evidenceSourceType,
    label,
    capturedAt,
    fileType,
    fileSizeBytes,
  };
}

function buildPaymentSummary(
  detail: SoloPlusAdminCaseDetailRecord,
  events: readonly SoloPlusCaseEventRecord[],
): SoloPlusAdminPaymentSummaryDto | null {
  const caseRecord = detail.caseRecord;
  if (
    caseRecord.paymentProvider == null &&
    caseRecord.paymentReference == null &&
    caseRecord.paymentStatus === "pending"
  ) {
    return null;
  }

  const confirmedEvent = events.find((event) =>
    event.eventType === "case_payment_confirmed" ||
    event.eventType === "payment_confirmed",
  );

  return {
    provider: caseRecord.paymentProvider,
    amount: caseRecord.expectedAmount,
    currency: caseRecord.paymentCurrency,
    status: caseRecord.paymentStatus,
    providerReference: caseRecord.paymentReference,
    confirmedAt: confirmedEvent?.createdAt ?? null,
  };
}

function buildRefundSummary(
  detail: SoloPlusAdminCaseDetailRecord,
  events: readonly SoloPlusCaseEventRecord[],
): SoloPlusAdminRefundSummaryDto | null {
  if (detail.caseRecord.refundStatus === "none") {
    return null;
  }

  const reviewRequiredAt =
    detail.caseRecord.refundStatus === "review_required"
      ? detail.caseRecord.rejectedAt
      : null;
  const processingEvent = events.find((event) => event.eventType === "refund_processing");
  const completedEvent = events.find((event) => event.eventType === "refund_completed");
  const failedEvent = events.find((event) => event.eventType === "refund_failed");
  const approvedEvent = events.find((event) => event.eventType === "refund_approved");

  return {
    status: detail.caseRecord.refundStatus,
    reasonSummary: null,
    requestedAt: reviewRequiredAt,
    approvedAt: approvedEvent?.createdAt ?? null,
    processingAt: processingEvent?.createdAt ?? null,
    completedAt: completedEvent?.createdAt ?? null,
    failedAt: failedEvent?.createdAt ?? null,
  };
}

function mapReviewDecision(
  eventType: string,
): SoloPlusAdminReviewHistoryEventDto["decision"] {
  switch (eventType) {
    case "case_review_requested_more_information":
      return "request_more_information";
    case "case_approved":
      return "approve";
    case "case_rejected":
      return "reject";
    case "case_reopened":
      return "reopen";
    default:
      return null;
  }
}

function buildReviewHistoryEvent(
  event: SoloPlusCaseEventRecord,
): SoloPlusAdminReviewHistoryEventDto {
  return {
    eventType: event.eventType,
    decision: mapReviewDecision(event.eventType),
    reason: sanitizeMerchantVisibleReason(event.reason),
    actorType: event.actorType,
    reviewerDisplayName: event.actorType === "admin" ? "Super Admin" : null,
    policyVersion: event.policyVersion || null,
    createdAt: event.createdAt,
  };
}

export async function createSoloPlusAdminReadService(
  options: CreateSoloPlusAdminReadServiceOptions = {},
): Promise<SoloPlusAdminReadService> {
  const authenticatedUser = await resolveSoloPlusAuthenticatedUser({
    authClient: options.authClient,
    env: options.env,
  });

  if (authenticatedUser.isSuperAdmin !== true) {
    throw new SoloPlusAdminReadServiceError(
      "SOLO_PLUS_SERVER_FORBIDDEN",
      "Solo Plus admin reads require an authenticated super-admin reviewer.",
    );
  }

  const repository = resolveRepository(options, options.serviceClient);

  return {
    repository,
    adminUserId: authenticatedUser.id,
    async listCases(input) {
      const result = await repository.listAdminCases(input);
      return {
        items: result.items.map((item) => {
          const caseSummary = buildSoloPlusBrowserCaseSummaryDto(
            item.caseRecord,
            item.requirements,
            item.latestReviewDecisionEvent,
          );

          return {
            caseId: item.caseRecord.id,
            merchantDisplayName: getMerchantDisplayName(item.merchant),
            ownerEmail: item.merchant?.email ?? null,
            flowOrigin: item.caseRecord.flowOrigin,
            caseStatus: item.caseRecord.caseStatus,
            reviewState: caseSummary.reviewState,
            paymentStatus: item.caseRecord.paymentStatus,
            refundStatus: item.caseRecord.refundStatus,
            rowVersion: item.caseRecord.rowVersion,
            requirementSummary: buildRequirementSummary(item.requirements),
            createdAt: item.caseRecord.createdAt,
            updatedAt: item.caseRecord.updatedAt,
            statusChangedAt: caseSummary.statusChangedAt,
          };
        }),
        nextCursor: result.nextCursor
          ? Buffer.from(JSON.stringify(result.nextCursor), "utf8").toString("base64url")
          : null,
      };
    },
    async getCaseDetail(caseId, historyInput) {
      const detail = await repository.getAdminCaseDetail(caseId);
      if (!detail) {
        return null;
      }

      const historyResult = await repository.listAdminCaseEvents(caseId, historyInput);
      const caseSummary = buildSoloPlusBrowserCaseSummaryDto(
        detail.caseRecord,
        detail.requirements,
        detail.latestReviewDecisionEvent,
      );

      return {
        case: {
          caseId: detail.caseRecord.id,
          merchantId: detail.caseRecord.merchantId,
          merchantDisplayName: getMerchantDisplayName(detail.merchant),
          ownerEmail: detail.merchant?.email ?? null,
          currentPlan: detail.merchant?.subscriptionPlan ?? detail.caseRecord.activePlanSnapshot,
          flowOrigin: detail.caseRecord.flowOrigin,
          caseStatus: detail.caseRecord.caseStatus,
          reviewState: caseSummary.reviewState,
          paymentStatus: detail.caseRecord.paymentStatus,
          refundStatus: detail.caseRecord.refundStatus,
          activationState: caseSummary.activationState,
          rowVersion: detail.caseRecord.rowVersion,
          createdAt: detail.caseRecord.createdAt,
          updatedAt: detail.caseRecord.updatedAt,
          statusChangedAt: caseSummary.statusChangedAt,
        },
        requirements: detail.requirements.map((requirement) => ({
          requirementCode: requirement.requirementCode,
          requirementState: requirement.requirementState,
          evidenceSourceType: requirement.evidenceSourceType,
          evidenceReferenceSummary: buildEvidenceReferenceSummary(requirement),
          completedAt: requirement.completedAt,
          updatedAt: requirement.updatedAt,
        })),
        payment: buildPaymentSummary(detail, historyResult.items),
        refund: buildRefundSummary(detail, historyResult.items),
        reviewHistory: historyResult.items.map((event) => buildReviewHistoryEvent(event)),
      };
    },
  };
}
