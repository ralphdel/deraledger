import "server-only";

// Server-only facade. The core is deliberately pure: it has no database,
// provider, route, or import-time side effect.
export {
  prepareComplianceProfileApprovalCommand,
  type ComplianceApprovalPlan,
  type ComplianceApprovalReasonCode,
  type ComplianceApprovalSourceState,
  type ComplianceApprovalTargetState,
  type ComplianceProfileApprovalCommandRequest,
  type ComplianceProfileApprovalCommandResult,
  type ComplianceProfileApprovalDiagnostic,
  type ComplianceProfileApprovalPayload,
  type ComplianceProfileApprovalReasonCode,
  type ExistingApprovalProfileSnapshot,
  type TrustedApprovalEvidenceReference,
  type TrustedApprovalIdentity,
  type TrustedApprovalReviewer,
} from "./compliance-profile-approval-command-core";
