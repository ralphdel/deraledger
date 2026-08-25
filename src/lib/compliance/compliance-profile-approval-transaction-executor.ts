import "server-only";

// Server-only facade. The core has no database client construction and is not
// imported by a production route, action, page, checkout, callback, or webhook.
export {
  executeComplianceProfileApprovalRpcTransaction,
  executeComplianceProfileApprovalTransaction,
  type ComplianceProfileApprovalTransactionExecutorReasonCode,
  type ComplianceProfileApprovalTransactionExecutorResult,
  type ComplianceProfileApprovalTransactionRunner,
} from "./compliance-profile-approval-transaction-executor-core";
