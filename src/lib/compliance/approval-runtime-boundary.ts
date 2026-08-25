import "server-only";

// Server-only facade for the source-only RBAC/canonical-read boundary. It has
// no database client, route, action, RPC transport, or import-time side effect.
export {
  createApprovalRuntimeBoundary,
  type ApprovalReviewerActorKind,
  type ApprovalReviewerIdentityRepository,
  type ApprovalRuntimeBoundaryReasonCode,
  type ApprovalRuntimeBoundaryResult,
  type ApprovalRuntimeExecutionPort,
  type ApprovalRuntimeExecutionResult,
  type ApprovalRuntimeUiIntent,
  type CanonicalApprovalProfile,
  type CanonicalApprovalReadRepository,
  type CanonicalApprovalSource,
} from "./approval-runtime-boundary-core";
