import type {
  ActivationPersistenceServiceRoleContext,
  ActivationTransitionAtomicWriter,
} from "./activation-transition-persistence-core";
import type { ActivationTransitionTransactionRunner } from "./activation-transition-transaction-executor-core";

/** Dependency-injected transport boundary for the future activation transaction. */
export interface ActivationTransitionTransactionSession extends ActivationTransitionAtomicWriter {}
export interface ActivationTransitionServiceRoleTransactionTransport {
  runInTransaction<T>(
    operation: (session: ActivationTransitionTransactionSession) => Promise<T>,
  ): Promise<T>;
}
export type ActivationTransitionTransactionClientReasonCode =
  | "activation_transaction_client_context_denied"
  | "activation_transaction_client_transport_missing"
  | "activation_transaction_client_failed";
export class ActivationTransitionTransactionClientError extends Error {
  readonly code: ActivationTransitionTransactionClientReasonCode;
  constructor(code: ActivationTransitionTransactionClientReasonCode) { super(code); this.code = code; }
}
function isServiceRoleContext(context: ActivationPersistenceServiceRoleContext): boolean {
  return context.databaseRole === "service_role" && context.internalActivationAuthorized === true;
}

/** Construction is inert; the injected transport owns all future DB interaction. */
export function createActivationTransitionServiceRoleTransactionClient(
  context: ActivationPersistenceServiceRoleContext,
  transport: ActivationTransitionServiceRoleTransactionTransport | null,
): ActivationTransitionTransactionRunner {
  return {
    async runServiceRoleTransaction<T>(
      operation: (writer: ActivationTransitionAtomicWriter) => Promise<T>,
    ): Promise<T> {
      if (!isServiceRoleContext(context)) throw new ActivationTransitionTransactionClientError("activation_transaction_client_context_denied");
      if (!transport) throw new ActivationTransitionTransactionClientError("activation_transaction_client_transport_missing");
      try { return await transport.runInTransaction(operation); }
      catch { throw new ActivationTransitionTransactionClientError("activation_transaction_client_failed"); }
    },
  };
}
