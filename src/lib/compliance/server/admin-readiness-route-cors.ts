import "server-only";

export type AdminReadinessOriginResult = { ok: true } | { ok: false; code: "origin_denied" };
export function checkAdminReadinessOrigin(origin: string | null | undefined, expectedOrigin: string, allowedOrigins: readonly string[] = []): AdminReadinessOriginResult {
  if (!origin || origin === "null" || !/^https:\/\//i.test(origin) || !/^https:\/\//i.test(expectedOrigin)) return { ok: false, code: "origin_denied" };
  return origin === expectedOrigin || allowedOrigins.includes(origin) ? { ok: true } : { ok: false, code: "origin_denied" };
}
export function adminReadinessPreflight(): { status: 204; headers: Readonly<Record<string, string>> } { return { status: 204, headers: { "Cache-Control": "no-store" } }; }
