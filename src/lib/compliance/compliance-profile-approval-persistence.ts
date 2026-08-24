import "server-only";

// Server-only facade. The core is a pure contract and has no client creation,
// query, write, or import-time side effect.
export {
  prepareComplianceProfileApprovalPersistence,
  type ComplianceApprovalServiceRoleContext,
  type ComplianceProfileApprovalAtomicWriter,
  type ComplianceProfileApprovalPersistenceDatabase,
  type ComplianceProfileApprovalPersistenceReasonCode,
  type ComplianceProfileApprovalPersistenceResult,
  type ComplianceProfileApprovalPersistenceSnapshot,
  type PersistedApprovalEvent,
  type PersistedApprovalProfile,
  type PersistedApprovalReview,
  type PersistedSoloPlusApprovalCase,
} from "./compliance-profile-approval-persistence-core";
