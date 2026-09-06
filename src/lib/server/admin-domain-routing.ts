export const ADMIN_PORTAL_HOST = "admin.deraledger.com";
export const PUBLIC_PORTAL_HOSTS = ["deraledger.com", "www.deraledger.com"] as const;

// Add future operational departments here only after their separate routing
// and authorization gates are reviewed.
export const OPERATIONAL_PORTAL_PREFIXES = ["/admin", "/compliance"] as const;

export type OperationalPortalRoutingDecision = "allow" | "redirect_to_admin" | "redirect_to_public_root";

function isOperationalPortalPath(pathname: string): boolean {
  return OPERATIONAL_PORTAL_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Keeps production public hosts from rendering operational portal paths while
 * leaving staging, preview, and API paths outside this host-routing policy.
 */
export function resolveOperationalPortalRouting(hostname: string, pathname: string): OperationalPortalRoutingDecision {
  const host = hostname.toLowerCase();
  if (host === ADMIN_PORTAL_HOST && pathname === "/") return "redirect_to_admin";
  if ((PUBLIC_PORTAL_HOSTS as readonly string[]).includes(host) && isOperationalPortalPath(pathname)) {
    return "redirect_to_public_root";
  }
  return "allow";
}
