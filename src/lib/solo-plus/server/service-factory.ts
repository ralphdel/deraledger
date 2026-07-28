import "server-only";

import { randomUUID } from "node:crypto";

import {
  createSoloPlusOrchestration,
  type AttachMerchantToSoloPlusOnboardingCaseInput,
  type CreateSoloPlusOnboardingCaseInput,
  type CreateSoloPlusUpgradeCaseInput,
  type MarkSoloPlusCaseAwaitingPaymentInput,
  type SoloPlusOrchestrationDependencies,
  type SoloPlusOrchestrationService,
} from "../orchestration";
import type {
  SoloPlusCaseCreationResult,
  SoloPlusCaseMutationResult,
  SoloPlusCaseRepository,
  SoloPlusSafeJsonObject,
} from "../repository";
import {
  assertSoloPlusServerEnvironment,
  resolveSoloPlusServerAccess,
  type ResolveSoloPlusServerAccessOptions,
  type SoloPlusResolvedServerAccess,
} from "./access-context";
import {
  createSoloPlusSupabaseRepository,
  createSoloPlusServiceRoleClient,
  type SoloPlusSupabaseClientLike,
} from "./supabase-repository";
import {
  createSoloPlusRequirementsService,
  type SyncSoloPlusCaseRequirementsInput,
} from "./requirements";

export type CreateSoloPlusServerServiceOptions = ResolveSoloPlusServerAccessOptions & {
  repository?: SoloPlusCaseRepository;
  repositoryFactory?: (client: SoloPlusSupabaseClientLike) => SoloPlusCaseRepository;
  now?: SoloPlusOrchestrationDependencies["now"];
  generateId?: SoloPlusOrchestrationDependencies["generateId"];
};

export type SoloPlusTrustedServerService = {
  repository: SoloPlusCaseRepository;
  orchestration: SoloPlusOrchestrationService;
  resolvedAccess: SoloPlusResolvedServerAccess;
  createOnboardingCase(
    input: Omit<
      CreateSoloPlusOnboardingCaseInput,
      "accessContext" | "featureFlags" | "onboardingSessionId"
    >,
  ): Promise<SoloPlusCaseCreationResult>;
  createUpgradeCase(
    input: Omit<
      CreateSoloPlusUpgradeCaseInput,
      "accessContext" | "featureFlags" | "merchantId"
    >,
  ): Promise<SoloPlusCaseCreationResult>;
  attachMerchantToOnboardingCase(
    input: Omit<
      AttachMerchantToSoloPlusOnboardingCaseInput,
      "accessContext" | "merchantId" | "onboardingSessionId"
    >,
  ): Promise<SoloPlusCaseMutationResult>;
  markCaseAwaitingPayment(
    input: Omit<MarkSoloPlusCaseAwaitingPaymentInput, "accessContext">,
  ): Promise<SoloPlusCaseMutationResult>;
  syncCaseRequirements(
    input: SyncSoloPlusCaseRequirementsInput,
  ): Promise<{
    caseRecord: NonNullable<Awaited<ReturnType<SoloPlusCaseRepository["findCaseById"]>>>;
    requirements: Awaited<ReturnType<SoloPlusCaseRepository["listRequirements"]>>;
    decisions: Record<string, unknown>;
    merchantId: string | null;
  }>;
};

export class SoloPlusServerServiceFactoryError extends Error {
  readonly code:
    | "SOLO_PLUS_SERVER_CONFIG_ERROR"
    | "SOLO_PLUS_SERVER_FORBIDDEN";

  constructor(
    code: "SOLO_PLUS_SERVER_CONFIG_ERROR" | "SOLO_PLUS_SERVER_FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "SoloPlusServerServiceFactoryError";
    this.code = code;
  }
}

function assertSafeRequirementsSnapshot(snapshot: SoloPlusSafeJsonObject): SoloPlusSafeJsonObject {
  return JSON.parse(JSON.stringify(snapshot)) as SoloPlusSafeJsonObject;
}

function requireResolvedMerchant(
  resolvedAccess: SoloPlusResolvedServerAccess,
): NonNullable<SoloPlusResolvedServerAccess["merchantOwnership"]> {
  if (!resolvedAccess.merchantOwnership) {
    throw new SoloPlusServerServiceFactoryError(
      "SOLO_PLUS_SERVER_FORBIDDEN",
      "Solo Plus service requires a trusted merchant ownership context.",
    );
  }

  return resolvedAccess.merchantOwnership;
}

function requireResolvedOnboardingSession(
  resolvedAccess: SoloPlusResolvedServerAccess,
): NonNullable<SoloPlusResolvedServerAccess["onboardingSessionOwnership"]> {
  if (!resolvedAccess.onboardingSessionOwnership) {
    throw new SoloPlusServerServiceFactoryError(
      "SOLO_PLUS_SERVER_FORBIDDEN",
      "Solo Plus service requires a trusted onboarding-session ownership context.",
    );
  }

  return resolvedAccess.onboardingSessionOwnership;
}

export async function createSoloPlusServerService(
  options: CreateSoloPlusServerServiceOptions,
): Promise<SoloPlusTrustedServerService> {
  assertSoloPlusServerEnvironment(options.env ?? process.env);

  const resolvedAccess = await resolveSoloPlusServerAccess(options);
  const generateId = options.generateId || randomUUID;
  const serviceClient = options.serviceClient || createSoloPlusServiceRoleClient();
  const repository =
    options.repository ||
    (options.repositoryFactory
      ? options.repositoryFactory(serviceClient)
      : createSoloPlusSupabaseRepository({ client: serviceClient }));

  const orchestration = createSoloPlusOrchestration({
    repository,
    now: options.now,
    generateId,
  });
  const requirementsService = createSoloPlusRequirementsService({
    repository,
    serviceClient,
    now: options.now,
    generateId,
  });

  return {
    repository,
    orchestration,
    resolvedAccess,
    async createOnboardingCase(input) {
      const onboardingSession = requireResolvedOnboardingSession(resolvedAccess);
      return orchestration.createSoloPlusOnboardingCase({
        onboardingSessionId: onboardingSession.onboardingSessionId,
        idempotencyKey: input.idempotencyKey,
        expectedAmount: input.expectedAmount,
        paymentCurrency: input.paymentCurrency,
        requirementsPolicyVersion: input.requirementsPolicyVersion,
        requirementsSnapshot: assertSafeRequirementsSnapshot(input.requirementsSnapshot),
        accessContext: resolvedAccess.accessContext,
        featureFlags: resolvedAccess.featureFlags,
      });
    },
    async createUpgradeCase(input) {
      const merchant = requireResolvedMerchant(resolvedAccess);
      return orchestration.createSoloPlusUpgradeCase({
        merchantId: merchant.merchantId,
        currentPlan: input.currentPlan,
        idempotencyKey: input.idempotencyKey,
        expectedAmount: input.expectedAmount,
        paymentCurrency: input.paymentCurrency,
        requirementsPolicyVersion: input.requirementsPolicyVersion,
        requirementsSnapshot: assertSafeRequirementsSnapshot(input.requirementsSnapshot),
        accessContext: resolvedAccess.accessContext,
        featureFlags: resolvedAccess.featureFlags,
      });
    },
    async attachMerchantToOnboardingCase(input) {
      const onboardingSession = requireResolvedOnboardingSession(resolvedAccess);
      const merchant = requireResolvedMerchant(resolvedAccess);

      return orchestration.attachMerchantToSoloPlusOnboardingCase({
        caseId: input.caseId,
        onboardingSessionId: onboardingSession.onboardingSessionId,
        merchantId: merchant.merchantId,
        expectedRowVersion: input.expectedRowVersion,
        requestIdempotencyKey: input.requestIdempotencyKey,
        accessContext: resolvedAccess.accessContext,
      });
    },
    async markCaseAwaitingPayment(input) {
      return orchestration.markSoloPlusCaseAwaitingPayment({
        caseId: input.caseId,
        expectedRowVersion: input.expectedRowVersion,
        requestIdempotencyKey: input.requestIdempotencyKey,
        accessContext: resolvedAccess.accessContext,
      });
    },
    async syncCaseRequirements(input) {
      const result = await requirementsService.syncCaseRequirements(input, {
        merchantOwnership: resolvedAccess.merchantOwnership,
        onboardingSessionOwnership: resolvedAccess.onboardingSessionOwnership,
      });

      return result as {
        caseRecord: NonNullable<Awaited<ReturnType<SoloPlusCaseRepository["findCaseById"]>>>;
        requirements: Awaited<ReturnType<SoloPlusCaseRepository["listRequirements"]>>;
        decisions: Record<string, unknown>;
        merchantId: string | null;
      };
    },
  };
}
