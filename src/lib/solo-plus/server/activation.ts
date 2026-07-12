import "server-only";

import type {
  SoloPlusCaseActivationAtomicParams,
  SoloPlusCaseActivationAtomicResult,
  SoloPlusCaseRepository,
} from "../repository";
import { assertSoloPlusServerEnvironment, resolveSoloPlusAuthenticatedUser } from "./access-context";
import {
  createSoloPlusServiceRoleClient,
  createSoloPlusSupabaseRepository,
  type SoloPlusSupabaseClientLike,
} from "./supabase-repository";

export type ActivateSoloPlusCaseInput = Pick<
  SoloPlusCaseActivationAtomicParams,
  "caseId" | "expectedRowVersion" | "requestIdempotencyKey" | "policyVersion"
>;

type ResolveAuthenticatedUserOptions = NonNullable<
  Parameters<typeof resolveSoloPlusAuthenticatedUser>[0]
>;

export type CreateSoloPlusActivationServiceOptions = {
  authClient?: ResolveAuthenticatedUserOptions["authClient"];
  serviceClient?: SoloPlusSupabaseClientLike;
  repository?: SoloPlusCaseRepository;
  repositoryFactory?: (client: SoloPlusSupabaseClientLike) => SoloPlusCaseRepository;
  env?: NodeJS.ProcessEnv;
};

export type SoloPlusActivationService = {
  repository: SoloPlusCaseRepository;
  activatorId: string;
  activateCase(input: ActivateSoloPlusCaseInput): Promise<SoloPlusCaseActivationAtomicResult>;
};

export class SoloPlusActivationServiceError extends Error {
  readonly code:
    | "SOLO_PLUS_SERVER_CONFIG_ERROR"
    | "SOLO_PLUS_SERVER_FORBIDDEN";

  constructor(
    code: "SOLO_PLUS_SERVER_CONFIG_ERROR" | "SOLO_PLUS_SERVER_FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "SoloPlusActivationServiceError";
    this.code = code;
  }
}

export async function createSoloPlusActivationService(
  options: CreateSoloPlusActivationServiceOptions = {},
): Promise<SoloPlusActivationService> {
  assertSoloPlusServerEnvironment(options.env ?? process.env);

  const authenticatedUser = await resolveSoloPlusAuthenticatedUser({
    authClient: options.authClient,
    env: options.env,
  });

  if (authenticatedUser.isSuperAdmin !== true) {
    throw new SoloPlusActivationServiceError(
      "SOLO_PLUS_SERVER_FORBIDDEN",
      "Solo Plus activation requires an authenticated super-admin operator.",
    );
  }

  const serviceClient =
    options.repository ? options.serviceClient || null : (options.serviceClient || createSoloPlusServiceRoleClient());
  const repository =
    options.repository ||
    (options.repositoryFactory
      ? options.repositoryFactory(serviceClient!)
      : createSoloPlusSupabaseRepository({ client: serviceClient! }));

  return {
    repository,
    activatorId: authenticatedUser.id,
    async activateCase(input) {
      return repository.activateSoloPlusCase({
        caseId: input.caseId,
        expectedRowVersion: input.expectedRowVersion,
        requestIdempotencyKey: input.requestIdempotencyKey,
        activatorAdminId: authenticatedUser.id,
        policyVersion: input.policyVersion ?? null,
      });
    },
  };
}
