import "server-only";

import {
  createSoloPlusOrchestration,
  type ApproveSoloPlusCaseInput,
  type RejectSoloPlusCaseInput,
  type ReopenSoloPlusCaseInput,
  type RequestMoreInformationSoloPlusCaseInput,
  type SoloPlusOrchestrationDependencies,
} from "../orchestration";
import type { SoloPlusReviewerDecision } from "../review-action-contract";
import type {
  SoloPlusCaseMutationResult,
  SoloPlusCaseRepository,
} from "../repository";
import {
  resolveDbBackedSuperAdminSession,
  type DbBackedSuperAdminSession,
} from "@/lib/admin-rbac";
import {
  assertSoloPlusServerEnvironment,
  type ResolveSoloPlusServerAccessOptions,
} from "./access-context";
import {
  createSoloPlusServiceRoleClient,
  createSoloPlusSupabaseRepository,
  type SoloPlusSupabaseClientLike,
} from "./supabase-repository";
import {
  isSoloPlusReviewActionWithinScope,
  resolveSoloPlusReviewActionScope,
} from "@/lib/server/solo-plus-review-action-release";

export type { SoloPlusReviewerDecision } from "../review-action-contract";

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
  resolveAdminAuthority?: (options: {
    authClient?: ResolveSoloPlusServerAccessOptions["authClient"];
    authorityClient?: SoloPlusSupabaseClientLike;
    env?: NodeJS.ProcessEnv;
  }) => Promise<DbBackedSuperAdminSession>;
};

export type SoloPlusReviewerService = {
  repository: SoloPlusCaseRepository;
  reviewerId: string;
  reviewCase(input: ReviewSoloPlusCaseInput): Promise<SoloPlusCaseMutationResult>;
};

export class SoloPlusReviewerServiceError extends Error {
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
    this.name = "SoloPlusReviewerServiceError";
    this.code = code;
  }
}

function buildReviewerAccessContext(reviewerId: string) {
  return {
    mode: "admin_review" as const,
    authenticatedAdminId: reviewerId,
  };
}

export async function createSoloPlusReviewerService(
  options: CreateSoloPlusReviewerServiceOptions = {},
): Promise<SoloPlusReviewerService> {
  const env = options.env ?? process.env;
  const reviewActionScope = resolveSoloPlusReviewActionScope(env);
  if (!reviewActionScope) {
    throw new SoloPlusReviewerServiceError(
      "SOLO_PLUS_SERVER_FORBIDDEN",
      "Solo Plus review actions are disabled for this release gate.",
    );
  }

  assertSoloPlusServerEnvironment(env);

  const authority = await (options.resolveAdminAuthority ?? resolveDbBackedSuperAdminSession)({
    authClient: options.authClient,
    authorityClient: options.serviceClient,
    env: options.env,
  });

  if (!authority.ok) {
    const code = authority.status === 401
      ? "SOLO_PLUS_SERVER_UNAUTHORIZED"
      : authority.status === 503
      ? "SOLO_PLUS_SERVER_CONFIG_ERROR"
      : "SOLO_PLUS_SERVER_FORBIDDEN";
    throw new SoloPlusReviewerServiceError(
      code,
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
  const accessContext = buildReviewerAccessContext(authority.userId);

  return {
    repository,
    reviewerId: authority.userId,
    async reviewCase(input) {
      if (!isSoloPlusReviewActionWithinScope(reviewActionScope, input)) {
        throw new SoloPlusReviewerServiceError(
          "SOLO_PLUS_SERVER_FORBIDDEN",
          "Solo Plus review action is outside the approved staging scope.",
        );
      }

      const scopedCase = await repository.findCaseById(input.caseId);
      if (
        !scopedCase
        || scopedCase.auditMetadata.fixture_scope !== "phase2b_admin_detail_smoke"
        || scopedCase.auditMetadata.fixture_run_id !== reviewActionScope.runId
      ) {
        throw new SoloPlusReviewerServiceError(
          "SOLO_PLUS_SERVER_FORBIDDEN",
          "Solo Plus review fixture marker does not match the approved staging scope.",
        );
      }

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
