const ADMIN_API_ROOT = "/api/admin";
const PHASE_2B_SOLO_PLUS_API_ROOT = "/api/admin/solo-plus";
const PHASE_2B_SOLO_PLUS_CASES_API = `${PHASE_2B_SOLO_PLUS_API_ROOT}/cases`;
const PHASE_2B_SOLO_PLUS_REVIEW_API = `${PHASE_2B_SOLO_PLUS_API_ROOT}/review`;

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

export function isExcludedLegacyAdminApiPath(pathname: string): boolean {
  return (
    isPathWithin(pathname, ADMIN_API_ROOT) &&
    !isPhase2BSoloPlusAdminApiPath(pathname)
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
