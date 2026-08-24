import type {
  ComplianceApprovalServiceRoleContext,
  ComplianceProfileApprovalAtomicWriter,
} from "./compliance-profile-approval-persistence-core";
import type { ComplianceProfileApprovalTransactionRunner } from "./compliance-profile-approval-transaction-executor-core";

/**
 * Dependency-injected, service-role transaction client boundary. It has no
 * Supabase dependency or client construction; the supplied transport owns any
 * future database interaction and must provide a single atomic callback.
 */

export interface ComplianceProfileApprovalTransactionSession
  extends ComplianceProfileApprovalAtomicWriter {}

export interface ComplianceProfileApprovalServiceRoleTransactionTransport {
  runInTransaction<T>(
    operation: (session: ComplianceProfileApprovalTransactionSession) => Promise<T>,
  ): Promise<T>;
}

export type ComplianceProfileApprovalTransactionClientReasonCode =
  | "approval_transaction_client_context_denied"
  | "approval_transaction_client_transport_missing"
  | "approval_transaction_client_failed";

export class ComplianceProfileApprovalTransactionClientError extends Error {
  readonly code: ComplianceProfileApprovalTransactionClientReasonCode;

  constructor(code: ComplianceProfileApprovalTransactionClientReasonCode) {
    super(code);
    this.code = code;
  }
}

function isServiceRoleContext(context: ComplianceApprovalServiceRoleContext): boolean {
  return context.databaseRole === "service_role" && context.internalReviewAuthorized === true;
}

/**
 * Construction is inert. The transport receives exactly one callback only for
 * a trusted service-role/internal-review context. No direct database client is
 * exposed and no operation can widen the approval writer's permitted scope.
 */
export function createComplianceProfileApprovalServiceRoleTransactionClient(
  context: ComplianceApprovalServiceRoleContext,
  transport: ComplianceProfileApprovalServiceRoleTransactionTransport | null,
): ComplianceProfileApprovalTransactionRunner {
  return {
    async runServiceRoleTransaction<T>(
      operation: (writer: ComplianceProfileApprovalAtomicWriter) => Promise<T>,
    ): Promise<T> {
      if (!isServiceRoleContext(context)) {
        throw new ComplianceProfileApprovalTransactionClientError(
          "approval_transaction_client_context_denied",
        );
      }
      if (!transport) {
        throw new ComplianceProfileApprovalTransactionClientError(
          "approval_transaction_client_transport_missing",
        );
      }
      try {
        return await transport.runInTransaction(operation);
      } catch {
        throw new ComplianceProfileApprovalTransactionClientError(
          "approval_transaction_client_failed",
        );
      }
    },
  };
}
