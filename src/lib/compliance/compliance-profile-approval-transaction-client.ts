import "server-only";

// Server-only facade. The core is dependency-injected and performs no client
// construction, query, write, or import-time transaction work.
export {
  createComplianceProfileApprovalServiceRoleTransactionClient,
  ComplianceProfileApprovalTransactionClientError,
  type ComplianceProfileApprovalServiceRoleTransactionTransport,
  type ComplianceProfileApprovalTransactionClientReasonCode,
  type ComplianceProfileApprovalTransactionSession,
} from "./compliance-profile-approval-transaction-client-core";
