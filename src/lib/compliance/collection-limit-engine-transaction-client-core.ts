import type {
  CollectionLimitEngineAtomicWriter,
  CollectionLimitServiceRoleContext,
} from "./collection-limit-engine-persistence-core";
import type { CollectionLimitTransactionRunner } from "./collection-limit-engine-transaction-executor-core";

/**
 * Dependency-injected transport boundary for the future four-table collection
 * limit transaction. It creates no database client and gives callers no
 * operations outside the existing atomic limit writer contract.
 */
export interface CollectionLimitEngineTransactionSession
  extends CollectionLimitEngineAtomicWriter {}

export interface CollectionLimitEngineServiceRoleTransactionTransport {
  runInTransaction<T>(
    operation: (session: CollectionLimitEngineTransactionSession) => Promise<T>,
  ): Promise<T>;
}

export type CollectionLimitTransactionClientReasonCode =
  | "limit_transaction_client_context_denied"
  | "limit_transaction_client_transport_missing"
  | "limit_transaction_client_failed";

export class CollectionLimitTransactionClientError extends Error {
  readonly code: CollectionLimitTransactionClientReasonCode;

  constructor(code: CollectionLimitTransactionClientReasonCode) {
    super(code);
    this.code = code;
  }
}

function isServiceRoleContext(context: CollectionLimitServiceRoleContext): boolean {
  return context.databaseRole === "service_role" && context.internalCollectionEngineAuthorized === true;
}

/**
 * Inert construction of an executor-compatible runner. Context validation is
 * repeated at invocation before the injected transaction transport is used.
 */
export function createCollectionLimitServiceRoleTransactionClient(
  context: CollectionLimitServiceRoleContext,
  transport: CollectionLimitEngineServiceRoleTransactionTransport | null,
): CollectionLimitTransactionRunner {
  return {
    async runServiceRoleTransaction<T>(
      operation: (writer: CollectionLimitEngineAtomicWriter) => Promise<T>,
    ): Promise<T> {
      if (!isServiceRoleContext(context)) {
        throw new CollectionLimitTransactionClientError("limit_transaction_client_context_denied");
      }
      if (!transport) {
        throw new CollectionLimitTransactionClientError("limit_transaction_client_transport_missing");
      }
      try {
        return await transport.runInTransaction(operation);
      } catch {
        throw new CollectionLimitTransactionClientError("limit_transaction_client_failed");
      }
    },
  };
}
