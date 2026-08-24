import type {
  ReviewedProfileBootstrapAtomicWriter,
  ReviewedProfileBootstrapPersistenceDatabase,
} from "./reviewed-profile-bootstrap-persistence-core";

/**
 * Server-side transaction executor contract. It does not create a database
 * client; a future service-role implementation injects its transaction client.
 */
export interface ReviewedBootstrapServiceRoleContext {
  databaseRole: "service_role" | "anon" | "authenticated" | "browser" | "unknown";
  internalReviewAuthorized: boolean;
}

export interface ReviewedProfileBootstrapTransactionClient {
  runServiceRoleTransaction<T>(
    operation: (writer: ReviewedProfileBootstrapAtomicWriter) => Promise<T>,
  ): Promise<T>;
}

export type ReviewedProfileBootstrapTransactionExecutorReasonCode =
  | "bootstrap_executor_context_denied"
  | "bootstrap_executor_transaction_failed";

export class ReviewedProfileBootstrapTransactionExecutorError extends Error {
  readonly code: ReviewedProfileBootstrapTransactionExecutorReasonCode;

  constructor(code: ReviewedProfileBootstrapTransactionExecutorReasonCode) {
    super(code);
    this.code = code;
  }
}

function canExecute(context: ReviewedBootstrapServiceRoleContext): boolean {
  return context.databaseRole === "service_role" && context.internalReviewAuthorized === true;
}

/**
 * Creates no client and performs no transaction until executeAtomically is
 * invoked by the persistence adapter. Every callback gets one trusted
 * transaction writer and errors are deliberately non-sensitive.
 */
export function createReviewedProfileBootstrapTransactionExecutor(
  context: ReviewedBootstrapServiceRoleContext,
  client: ReviewedProfileBootstrapTransactionClient,
): ReviewedProfileBootstrapPersistenceDatabase {
  return {
    async executeAtomically<T>(
      operation: (writer: ReviewedProfileBootstrapAtomicWriter) => Promise<T>,
    ): Promise<T> {
      if (!canExecute(context)) {
        throw new ReviewedProfileBootstrapTransactionExecutorError(
          "bootstrap_executor_context_denied",
        );
      }
      try {
        return await client.runServiceRoleTransaction(operation);
      } catch {
        throw new ReviewedProfileBootstrapTransactionExecutorError(
          "bootstrap_executor_transaction_failed",
        );
      }
    },
  };
}
