const ADMIN_API_ROOT = "/api/admin";
const PHASE_2B_SOLO_PLUS_API_ROOT = "/api/admin/solo-plus";
const PHASE_2B_SOLO_PLUS_CASES_API = `${PHASE_2B_SOLO_PLUS_API_ROOT}/cases`;
const PHASE_2B_SOLO_PLUS_REVIEW_API = `${PHASE_2B_SOLO_PLUS_API_ROOT}/review`;
const PHASE_2C_B3_COMPLIANCE_REVIEWS_API = "/api/admin/compliance/reviews";
const UUID_PATH_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LegacyAdminApiReleaseEnvironment = Readonly<Record<string, string | undefined>>;

function isPathWithin(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`);
}

export function isPhase2BSoloPlusAdminApiPath(pathname: string): boolean {
  if (
    pathname === PHASE_2B_SOLO_PLUS_CASES_API ||
    pathname === PHASE_2B_SOLO_PLUS_REVIEW_API
  ) {
    return true;
  }

  if (!pathname.startsWith(`${PHASE_2B_SOLO_PLUS_CASES_API}/`)) {
    return false;
  }

  const caseId = pathname.slice(PHASE_2B_SOLO_PLUS_CASES_API.length + 1);
  return caseId !== "" && !caseId.includes("/");
}

export function isPhase2CB3ComplianceAdminApiPath(pathname: string): boolean {
  if (pathname === PHASE_2C_B3_COMPLIANCE_REVIEWS_API) return true;
  if (!pathname.startsWith(`${PHASE_2C_B3_COMPLIANCE_REVIEWS_API}/`)) return false;
  const segments = pathname.slice(PHASE_2C_B3_COMPLIANCE_REVIEWS_API.length + 1).split("/");
  const reviewId = segments[0];
  const isRouteTemplate = reviewId === "[reviewId]";
  const isConcreteReview = typeof reviewId === "string" && UUID_PATH_SEGMENT.test(reviewId);
  return (isRouteTemplate || isConcreteReview) && (
    segments.length === 1
    || segments.length === 2 && segments[1] === "request-correction"
  );
}

export function isExcludedLegacyAdminApiPath(pathname: string): boolean {
  return (
    isPathWithin(pathname, ADMIN_API_ROOT) &&
    !isPhase2BSoloPlusAdminApiPath(pathname) &&
    !isPhase2CB3ComplianceAdminApiPath(pathname)
  );
}

export function isLegacyAdminApiReleaseEnabled(
  env: LegacyAdminApiReleaseEnvironment = process.env,
): boolean {
  if (env.VERCEL_ENV === "production") {
    return false;
  }

  return env.DERALEDGER_LEGACY_ADMIN_APIS_ENABLED?.trim().toLowerCase() === "true";
}

export function shouldBlockExcludedLegacyAdminApi(
  pathname: string,
  env: LegacyAdminApiReleaseEnvironment = process.env,
): boolean {
  return (
    isExcludedLegacyAdminApiPath(pathname) &&
    !isLegacyAdminApiReleaseEnabled(env)
  );
}
