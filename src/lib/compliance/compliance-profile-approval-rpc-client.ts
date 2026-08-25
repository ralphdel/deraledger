import "server-only";

// Server-only facade for a source-only, injected RPC transport. It constructs
// no client and is deliberately not imported by routes, pages, actions, or
// any live approval path.
export {
  REVIEW_COMPLIANCE_PROFILE_DECISION_RPC,
  createComplianceProfileApprovalRpcAdapter,
  executeReviewedProfileApprovalRpc,
  toReviewedProfileApprovalRpcArguments,
  type ComplianceProfileApprovalRpcClientReasonCode,
  type ComplianceProfileApprovalRpcClientResult,
  type ComplianceProfileApprovalRpcAdapter,
  type ReviewedProfileApprovalRpcArguments,
  type ReviewedProfileApprovalRpcRow,
  type ReviewedProfileApprovalRpcTransport,
} from "./compliance-profile-approval-rpc-client-core";
