import type {
  ReviewedProfileBootstrapAtomicWriter,
} from "./reviewed-profile-bootstrap-persistence-core";
import type {
  ReviewedBootstrapServiceRoleContext,
  ReviewedProfileBootstrapTransactionClient,
} from "./reviewed-profile-bootstrap-transaction-executor-core";

/**
 * Dependency-injected service-role transaction client boundary. It deliberately
 * has no Supabase import or client construction: a future infrastructure layer
 * must provide the single transactional transport.
 */

export interface ReviewedProfileBootstrapTransactionSession
  extends ReviewedProfileBootstrapAtomicWriter {}

export interface ReviewedProfileBootstrapServiceRoleTransactionTransport {
  runInTransaction<T>(
    operation: (session: ReviewedProfileBootstrapTransactionSession) => Promise<T>,
  ): Promise<T>;
}

export type ReviewedProfileBootstrapTransactionClientReasonCode =
  | "bootstrap_transaction_client_context_denied"
  | "bootstrap_transaction_client_failed";

export class ReviewedProfileBootstrapTransactionClientError extends Error {
  readonly code: ReviewedProfileBootstrapTransactionClientReasonCode;

  constructor(code: ReviewedProfileBootstrapTransactionClientReasonCode) {
    super(code);
    this.code = code;
  }
}

function isServiceRoleContext(context: ReviewedBootstrapServiceRoleContext): boolean {
  return context.databaseRole === "service_role" && context.internalReviewAuthorized === true;
}

/**
 * Construction is inert. The transport receives exactly one callback only when
 * the executor requests a transaction with an internally authorized service
 * role context. A transport error is redacted to a stable reason code.
 */
export function createReviewedProfileBootstrapServiceRoleTransactionClient(
  context: ReviewedBootstrapServiceRoleContext,
  transport: ReviewedProfileBootstrapServiceRoleTransactionTransport,
): ReviewedProfileBootstrapTransactionClient {
  return {
    async runServiceRoleTransaction<T>(
      operation: (writer: ReviewedProfileBootstrapAtomicWriter) => Promise<T>,
    ): Promise<T> {
      if (!isServiceRoleContext(context)) {
        throw new ReviewedProfileBootstrapTransactionClientError(
          "bootstrap_transaction_client_context_denied",
        );
      }
      try {
        return await transport.runInTransaction(operation);
      } catch {
        throw new ReviewedProfileBootstrapTransactionClientError(
          "bootstrap_transaction_client_failed",
        );
      }
    },
  };
}
