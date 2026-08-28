import "server-only";

import { createCanonicalApprovalReadinessReviewerResolver } from "./canonical-approval-readiness-reviewer-resolver";
import { createCanonicalApprovalReadinessSessionReader } from "./canonical-approval-readiness-session-reader";
import { createCanonicalApprovalReadinessService } from "./canonical-approval-readiness-service";

/**
 * Private server composition for the canonical-readiness boundary.
 * It deliberately accepts no caller-provided authority, session, or transport.
 */
export function createCanonicalApprovalReadinessServerService(): Pick<
  ReturnType<typeof createCanonicalApprovalReadinessService>,
  "issue" | "readSnapshot"
> {
  const sessionUserReader = createCanonicalApprovalReadinessSessionReader();
  const reviewerResolver = createCanonicalApprovalReadinessReviewerResolver({ sessionUserReader });
  const service = createCanonicalApprovalReadinessService({ reviewerResolver });

  return {
    issue: service.issue,
    readSnapshot: service.readSnapshot,
  };
}
