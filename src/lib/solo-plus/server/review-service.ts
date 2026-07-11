import "server-only";

import {
  createSoloPlusOrchestration,
  type ApproveSoloPlusCaseInput,
  type RejectSoloPlusCaseInput,
  type ReopenSoloPlusCaseInput,
  type RequestMoreInformationSoloPlusCaseInput,
  type SoloPlusOrchestrationDependencies,
} from "../orchestration";
import type {
  SoloPlusCaseMutationResult,
  SoloPlusCaseRepository,
} from "../repository";
import {
  assertSoloPlusServerEnvironment,
  resolveSoloPlusAuthenticatedUser,
  type ResolveSoloPlusServerAccessOptions,
} from "./access-context";
import {
  createSoloPlusServiceRoleClient,
  createSoloPlusSupabaseRepository,
  type SoloPlusSupabaseClientLike,
} from "./supabase-repository";

export type SoloPlusReviewerDecision =
  | "request_more_information"
  | "approve"
  | "reject"
  | "reopen";

export type ReviewSoloPlusCaseInput = {
  caseId: string;
  expectedRowVersion: number;
  requestIdempotencyKey: string;
  decision: SoloPlusReviewerDecision;
  reason?: string | null;
};

export type CreateSoloPlusReviewerServiceOptions = Pick<
  ResolveSoloPlusServerAccessOptions,
  "authClient" | "serviceClient" | "env"
> & {
  repository?: SoloPlusCaseRepository;
  repositoryFactory?: (client: SoloPlusSupabaseClientLike) => SoloPlusCaseRepository;
  now?: SoloPlusOrchestrationDependencies["now"];
  generateId?: SoloPlusOrchestrationDependencies["generateId"];
};

export type SoloPlusReviewerService = {
  repository: SoloPlusCaseRepository;
  reviewerId: string;
  reviewCase(input: ReviewSoloPlusCaseInput): Promise<SoloPlusCaseMutationResult>;
};

export class SoloPlusReviewerServiceError extends Error {
  readonly code:
    | "SOLO_PLUS_SERVER_CONFIG_ERROR"
    | "SOLO_PLUS_SERVER_FORBIDDEN";

  constructor(
    code: "SOLO_PLUS_SERVER_CONFIG_ERROR" | "SOLO_PLUS_SERVER_FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "SoloPlusReviewerServiceError";
    this.code = code;
  }
}

function buildReviewerAccessContext(reviewerId: string) {
  return {
    mode: "internal_test" as const,
    authenticatedAdminId: reviewerId,
    isAuthorizedAdmin: true,
    isSandboxMerchant: false,
  };
}

export async function createSoloPlusReviewerService(
  options: CreateSoloPlusReviewerServiceOptions = {},
): Promise<SoloPlusReviewerService> {
  assertSoloPlusServerEnvironment(options.env ?? process.env);

  const authenticatedUser = await resolveSoloPlusAuthenticatedUser({
    authClient: options.authClient,
    env: options.env,
  });

  if (authenticatedUser.isSuperAdmin !== true) {
    throw new SoloPlusReviewerServiceError(
      "SOLO_PLUS_SERVER_FORBIDDEN",
      "Solo Plus reviewer decisions require an authenticated super-admin reviewer.",
    );
  }

  const serviceClient =
    options.repository
      ? options.serviceClient || null
      : (options.serviceClient || createSoloPlusServiceRoleClient());
  const repository =
    options.repository ||
    (options.repositoryFactory
      ? options.repositoryFactory(serviceClient!)
      : createSoloPlusSupabaseRepository({ client: serviceClient! }));

  const orchestration = createSoloPlusOrchestration({
    repository,
    now: options.now,
    generateId: options.generateId,
  });
  const accessContext = buildReviewerAccessContext(authenticatedUser.id);

  return {
    repository,
    reviewerId: authenticatedUser.id,
    async reviewCase(input) {
      const baseInput = {
        caseId: input.caseId,
        expectedRowVersion: input.expectedRowVersion,
        requestIdempotencyKey: input.requestIdempotencyKey,
        reason: input.reason,
        accessContext,
      };

      switch (input.decision) {
        case "request_more_information":
          return orchestration.requestMoreInformationForSoloPlusCase(
            baseInput as RequestMoreInformationSoloPlusCaseInput,
          );
        case "approve":
          return orchestration.approveSoloPlusCase(
            baseInput as ApproveSoloPlusCaseInput,
          );
        case "reject":
          return orchestration.rejectSoloPlusCase(
            baseInput as RejectSoloPlusCaseInput,
          );
        case "reopen":
          return orchestration.reopenSoloPlusCase(
            baseInput as ReopenSoloPlusCaseInput,
          );
        default: {
          const unreachableDecision: never = input.decision;
          throw new SoloPlusReviewerServiceError(
            "SOLO_PLUS_SERVER_CONFIG_ERROR",
            `Unsupported Solo Plus reviewer decision: ${String(unreachableDecision)}.`,
          );
        }
      }
    },
  };
}
