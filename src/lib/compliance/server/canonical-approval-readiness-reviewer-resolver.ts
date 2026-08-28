import "server-only";

import type {
  CanonicalApprovalReadinessDerivedReviewer,
  CanonicalApprovalReadinessReviewerResolver,
} from "../canonical-approval-readiness-core";

type ServerSessionUserReader = {
  readAuthenticatedServerSessionUser(): Promise<unknown>;
};

type AuthenticatedServerUser = {
  id: string;
  app_metadata?: unknown;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAuthenticatedServerUser(value: unknown): value is AuthenticatedServerUser {
  return isRecord(value) && typeof value.id === "string";
}

function hasDeniedServerIdentityMarker(metadata: Record<string, unknown>): boolean {
  const markers = [metadata.role, metadata.actor_kind, metadata.authority, metadata.origin];
  return markers.some((marker) => marker === "merchant_owner"
    || marker === "merchant_team"
    || marker === "customer"
    || marker === "compliance_reviewer"
    || marker === "compliance_reviewer_deferred"
    || marker === "anonymous"
    || marker === "browser_direct");
}

function hasDerivedSuperAdminAuthority(user: AuthenticatedServerUser): boolean {
  if (!UUID.test(user.id.trim()) || !isRecord(user.app_metadata)) return false;
  return user.app_metadata.is_super_admin === true && !hasDeniedServerIdentityMarker(user.app_metadata);
}

/**
 * Produces the sole reviewer-authority seam used by canonical readiness.
 * It accepts no caller claims: authority is derived only from the injected,
 * server-session reader and the server-controlled app_metadata boolean.
 */
export function createCanonicalApprovalReadinessReviewerResolver(
  dependencies: { sessionUserReader: ServerSessionUserReader },
): CanonicalApprovalReadinessReviewerResolver {
  return {
    async resolveServerSessionReviewer(): Promise<CanonicalApprovalReadinessDerivedReviewer | null> {
      try {
        const sessionUser = await dependencies.sessionUserReader.readAuthenticatedServerSessionUser();
        if (!isAuthenticatedServerUser(sessionUser) || !hasDerivedSuperAdminAuthority(sessionUser)) return null;
        return { actorKind: "super_admin", reviewerId: sessionUser.id.trim() };
      } catch {
        return null;
      }
    },
  };
}
