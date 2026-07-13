import "server-only";

import type {
  SoloPlusCaseCreationResult,
  SoloPlusCaseEventRecord,
  SoloPlusCaseRecord,
  SoloPlusCaseRequirementRecord,
  SoloPlusCaseRepository,
} from "../repository";
import type { SoloPlusActivityProfileInput } from "../requirement-orchestration";
import { getSoloPlusCreationExpectedAmount, buildSoloPlusCreationRequirementsSnapshot } from "./route-contracts";
import {
  assertSoloPlusServerEnvironment,
  resolveSoloPlusAuthenticatedUser,
  resolveSoloPlusOnboardingSessionOwnership,
  type ResolveSoloPlusServerAccessOptions,
} from "./access-context";
import {
  createSoloPlusServiceRoleClient,
  createSoloPlusSupabaseRepository,
  type SoloPlusSupabaseClientLike,
} from "./supabase-repository";
import { createSoloPlusServerService } from "./service-factory";

export type SoloPlusBrowserCaseFlowOrigin = "onboarding" | "upgrade";

export type CreateOrResumeSoloPlusCaseInput = {
  flowOrigin: SoloPlusBrowserCaseFlowOrigin;
  requestIdempotencyKey: string;
  onboardingSessionId?: string | null;
};

export type ReadSoloPlusCaseInput = {
  caseId?: string | null;
  onboardingSessionId?: string | null;
};

export type SubmitSoloPlusCaseEvidenceInput = {
  caseId: string;
  onboardingSessionId?: string | null;
  activityProfile?: SoloPlusActivityProfileInput | null;
  idDocument?: {
    storageKey: string;
    checksumSha256?: string | null;
    uploadedAt: string;
    contentType?: string | null;
    fileSizeBytes?: number | null;
    providerName?: string | null;
    providerReference?: string | null;
  } | null;
  proofOfAddress?: {
    storageKey: string;
    checksumSha256?: string | null;
    uploadedAt: string;
    contentType?: string | null;
    fileSizeBytes?: number | null;
    providerName?: string | null;
    providerReference?: string | null;
  } | null;
};

export type SoloPlusBrowserCaseLookupResult = {
  caseRecord: SoloPlusCaseRecord;
  requirements: readonly SoloPlusCaseRequirementRecord[];
  latestReviewDecisionEvent: SoloPlusCaseEventRecord | null;
};

export type SoloPlusBrowserCaseService = {
  createOrResumeCase(
    input: CreateOrResumeSoloPlusCaseInput,
  ): Promise<SoloPlusCaseCreationResult & { latestReviewDecisionEvent: SoloPlusCaseEventRecord | null }>;
  readCurrentCase(input: ReadSoloPlusCaseInput): Promise<SoloPlusBrowserCaseLookupResult | null>;
  submitEvidence(input: SubmitSoloPlusCaseEvidenceInput): Promise<{
    caseRecord: SoloPlusCaseRecord;
    requirements: readonly SoloPlusCaseRequirementRecord[];
    decisions: Record<string, unknown>;
    merchantId: string | null;
    latestReviewDecisionEvent: SoloPlusCaseEventRecord | null;
  }>;
};

export class SoloPlusBrowserCaseServiceError extends Error {
  readonly code:
    | "SOLO_PLUS_SERVER_NOT_FOUND"
    | "SOLO_PLUS_ACCESS_DENIED"
    | "SOLO_PLUS_CASE_OWNERSHIP_CONFLICT"
    | "SOLO_PLUS_INVALID_REVIEW_INPUT";

  constructor(
    code:
      | "SOLO_PLUS_SERVER_NOT_FOUND"
      | "SOLO_PLUS_ACCESS_DENIED"
      | "SOLO_PLUS_CASE_OWNERSHIP_CONFLICT"
      | "SOLO_PLUS_INVALID_REVIEW_INPUT",
    message: string,
  ) {
    super(message);
    this.name = "SoloPlusBrowserCaseServiceError";
    this.code = code;
  }
}

export type CreateSoloPlusBrowserCaseServiceOptions = Pick<
  ResolveSoloPlusServerAccessOptions,
  "authClient" | "serviceClient" | "env"
> & {
  repository?: SoloPlusCaseRepository;
  repositoryFactory?: (client: SoloPlusSupabaseClientLike) => SoloPlusCaseRepository;
};

// Solo Plus is an individual-plan flow. Upgrade access is intentionally owner-only:
// we resolve only the merchant row directly owned by the authenticated user and do
// not broaden access to merchant team members for Commit 11.
async function loadOwnerMerchantForUser(
  client: SoloPlusSupabaseClientLike,
  userId: string,
): Promise<{ id: string; subscriptionPlan: string | null } | null> {
  const { data, error } = await client
    .from("merchants")
    .select("id, user_id, subscription_plan")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve merchant ownership: ${error.message}`);
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const candidate = data as Record<string, unknown>;
  if (typeof candidate.id !== "string" || candidate.id.trim() === "") {
    return null;
  }

  return {
    id: candidate.id.trim(),
    subscriptionPlan: typeof candidate.subscription_plan === "string" && candidate.subscription_plan.trim() !== ""
      ? candidate.subscription_plan.trim()
      : null,
  };
}

function assertCaseOwnership(
  caseRecord: SoloPlusCaseRecord | null,
  merchantId: string | null,
  onboardingSessionId: string | null,
): SoloPlusCaseRecord {
  if (!caseRecord) {
    throw new SoloPlusBrowserCaseServiceError(
      "SOLO_PLUS_SERVER_NOT_FOUND",
      "Solo Plus case was not found.",
    );
  }

  if (caseRecord.merchantId && merchantId && caseRecord.merchantId === merchantId) {
    return caseRecord;
  }

  if (
    caseRecord.onboardingSessionId &&
    onboardingSessionId &&
    caseRecord.onboardingSessionId === onboardingSessionId
  ) {
    return caseRecord;
  }

  throw new SoloPlusBrowserCaseServiceError(
    "SOLO_PLUS_SERVER_NOT_FOUND",
    "Solo Plus case was not found.",
  );
}

function resolveRepository(
  options: CreateSoloPlusBrowserCaseServiceOptions,
  serviceClient: SoloPlusSupabaseClientLike,
): SoloPlusCaseRepository {
  return (
    options.repository ||
    (options.repositoryFactory
      ? options.repositoryFactory(serviceClient)
      : createSoloPlusSupabaseRepository({ client: serviceClient }))
  );
}

async function loadBrowserCaseLookupResult(
  repository: SoloPlusCaseRepository,
  caseRecord: SoloPlusCaseRecord,
  requirements?: readonly SoloPlusCaseRequirementRecord[],
): Promise<SoloPlusBrowserCaseLookupResult> {
  return {
    caseRecord,
    requirements: requirements ?? (await repository.listRequirements(caseRecord.id)),
    latestReviewDecisionEvent: await repository.findLatestReviewDecisionEvent(caseRecord.id),
  };
}

export async function createSoloPlusBrowserCaseService(
  options: CreateSoloPlusBrowserCaseServiceOptions = {},
): Promise<SoloPlusBrowserCaseService> {
  assertSoloPlusServerEnvironment(options.env ?? process.env);

  const authenticatedUser = await resolveSoloPlusAuthenticatedUser({
    authClient: options.authClient,
    env: options.env,
  });

  const serviceClient = options.serviceClient || createSoloPlusServiceRoleClient();
  const repository = resolveRepository(options, serviceClient);

  return {
    async createOrResumeCase(input) {
      if (input.flowOrigin === "onboarding") {
        if (!input.onboardingSessionId) {
          throw new SoloPlusBrowserCaseServiceError(
            "SOLO_PLUS_INVALID_REVIEW_INPUT",
            "onboardingSessionId is required for onboarding case creation.",
          );
        }

        const service = await createSoloPlusServerService({
          requestedMode: "public",
          onboardingSessionId: input.onboardingSessionId,
          authClient: options.authClient,
          serviceClient,
          repository,
          env: options.env,
        });

        const result = await service.createOnboardingCase({
          idempotencyKey: input.requestIdempotencyKey,
          expectedAmount: getSoloPlusCreationExpectedAmount(),
          paymentCurrency: "NGN",
          requirementsPolicyVersion: "solo-plus-payment-init-v1",
          requirementsSnapshot: buildSoloPlusCreationRequirementsSnapshot("onboarding"),
        });

        return {
          ...result,
          latestReviewDecisionEvent: await repository.findLatestReviewDecisionEvent(
            result.caseRecord.id,
          ),
        };
      }

      const merchant = await loadOwnerMerchantForUser(serviceClient, authenticatedUser.id);
      if (!merchant) {
        throw new SoloPlusBrowserCaseServiceError(
          "SOLO_PLUS_SERVER_NOT_FOUND",
          "Solo Plus merchant was not found.",
        );
      }

      const service = await createSoloPlusServerService({
        requestedMode: "public",
        merchantId: merchant.id,
        authClient: options.authClient,
        serviceClient,
        repository,
        env: options.env,
      });

      const result = await service.createUpgradeCase({
        currentPlan: "solo_lite",
        idempotencyKey: input.requestIdempotencyKey,
        expectedAmount: getSoloPlusCreationExpectedAmount(),
        paymentCurrency: "NGN",
        requirementsPolicyVersion: "solo-plus-payment-init-v1",
        requirementsSnapshot: buildSoloPlusCreationRequirementsSnapshot("upgrade"),
      });

      return {
        ...result,
        latestReviewDecisionEvent: await repository.findLatestReviewDecisionEvent(
          result.caseRecord.id,
        ),
      };
    },

    async readCurrentCase(input) {
      if (input.caseId) {
        const caseRecord = await repository.findCaseById(input.caseId);
        if (!caseRecord) {
          return null;
        }

        const merchant = await loadOwnerMerchantForUser(serviceClient, authenticatedUser.id);
        let onboardingSessionId = input.onboardingSessionId || null;

        if (caseRecord.onboardingSessionId) {
          const ownership = await resolveSoloPlusOnboardingSessionOwnership(caseRecord.onboardingSessionId, {
            authClient: options.authClient,
            serviceClient,
            env: options.env,
          });
          onboardingSessionId = ownership.onboardingSessionId;
        }

        assertCaseOwnership(caseRecord, merchant?.id || null, onboardingSessionId);
        return loadBrowserCaseLookupResult(repository, caseRecord);
      }

      if (input.onboardingSessionId) {
        const ownership = await resolveSoloPlusOnboardingSessionOwnership(input.onboardingSessionId, {
          authClient: options.authClient,
          serviceClient,
          env: options.env,
        });
        const caseRecord = await repository.findActiveCaseByOnboardingSessionId(
          ownership.onboardingSessionId,
        );
        if (!caseRecord) {
          return null;
        }

        return loadBrowserCaseLookupResult(repository, caseRecord);
      }

      const merchant = await loadOwnerMerchantForUser(serviceClient, authenticatedUser.id);
      if (!merchant) {
        return null;
      }

      const caseRecord = await repository.findActiveCaseByMerchantId(merchant.id);
      if (!caseRecord) {
        return null;
      }

      return loadBrowserCaseLookupResult(repository, caseRecord);
    },

    async submitEvidence(input) {
      const caseRecord = await repository.findCaseById(input.caseId);
      if (!caseRecord) {
        throw new SoloPlusBrowserCaseServiceError(
          "SOLO_PLUS_SERVER_NOT_FOUND",
          "Solo Plus case was not found.",
        );
      }

      let merchantId = caseRecord.merchantId || null;
      let onboardingSessionId = caseRecord.onboardingSessionId || input.onboardingSessionId || null;

      if (caseRecord.merchantId) {
        const currentMerchant = await loadOwnerMerchantForUser(serviceClient, authenticatedUser.id);
        if (currentMerchant?.id !== caseRecord.merchantId) {
          throw new SoloPlusBrowserCaseServiceError(
            "SOLO_PLUS_SERVER_NOT_FOUND",
            "Solo Plus case was not found.",
          );
        }
        merchantId = currentMerchant.id;
      } else if (caseRecord.onboardingSessionId) {
        const ownership = await resolveSoloPlusOnboardingSessionOwnership(caseRecord.onboardingSessionId, {
          authClient: options.authClient,
          serviceClient,
          env: options.env,
        });
        onboardingSessionId = ownership.onboardingSessionId;
      } else {
        throw new SoloPlusBrowserCaseServiceError(
          "SOLO_PLUS_SERVER_NOT_FOUND",
          "Solo Plus case was not found.",
        );
      }

      const service = await createSoloPlusServerService({
        requestedMode: "public",
        merchantId: merchantId || undefined,
        onboardingSessionId: onboardingSessionId || undefined,
        authClient: options.authClient,
        serviceClient,
        repository,
        env: options.env,
      });

      const result = await service.syncCaseRequirements({
        caseId: input.caseId,
        activityProfile: input.activityProfile || undefined,
        idDocument: input.idDocument || undefined,
        proofOfAddress: input.proofOfAddress || undefined,
      });

      return {
        ...result,
        latestReviewDecisionEvent: await repository.findLatestReviewDecisionEvent(result.caseRecord.id),
      };
    },
  };
}
