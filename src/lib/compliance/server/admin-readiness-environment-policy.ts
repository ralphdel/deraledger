import "server-only";

import { auditAdminReadinessBrowserEnvironmentVariable } from "../admin-readiness-browser-environment-policy";

export type AdminReadinessDeploymentEnvironment = "production" | "staging" | "preview" | "local";

export type AdminReadinessEnvironmentPolicy = Readonly<{
  environment: AdminReadinessDeploymentEnvironment;
  adminOrigin: string;
  allowedOrigins: readonly string[];
}>;

export type AdminReadinessEnvironmentPolicyResult =
  | { ok: true; policy: AdminReadinessEnvironmentPolicy }
  | { ok: false; code: "environment_policy_invalid" };

type BrowserEnvironmentVariable = Readonly<{ name: string; value: string | undefined }>;
type EnvironmentPolicyInput = Readonly<{
  environment: AdminReadinessDeploymentEnvironment;
  supabaseEnvironment: AdminReadinessDeploymentEnvironment;
  adminOrigin: string;
  additionalAllowedOrigins?: readonly string[];
  browserEnvironmentVariables: readonly BrowserEnvironmentVariable[];
}>;

const PRODUCTION_ADMIN_ORIGIN = "https://admin.deraledger.com";
const ENVIRONMENTS = new Set<AdminReadinessDeploymentEnvironment>(["production", "staging", "preview", "local"]);

function isEnvironment(value: unknown): value is AdminReadinessDeploymentEnvironment {
  return typeof value === "string" && ENVIRONMENTS.has(value as AdminReadinessDeploymentEnvironment);
}

function exactOrigin(value: unknown, allowLocalHttp = false): value is string {
  if (typeof value !== "string" || value === "*" || value === "null") return false;
  try {
    const parsed = new URL(value);
    const permittedProtocol = parsed.protocol === "https:"
      || allowLocalHttp && parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]");
    return permittedProtocol && parsed.username === "" && parsed.password === ""
      && parsed.pathname === "/" && parsed.search === "" && parsed.hash === "" && parsed.origin === value;
  } catch {
    return false;
  }
}

function hasClientSecret(variables: readonly BrowserEnvironmentVariable[]): boolean {
  return variables.some((variable) =>
    auditAdminReadinessBrowserEnvironmentVariable(variable.name, variable.value).status === "BLOCKED");
}

/** Validates explicit deployment inputs. Origin is browser defense-in-depth, never authority. */
export function validateAdminReadinessEnvironmentPolicy(input: unknown): AdminReadinessEnvironmentPolicyResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, code: "environment_policy_invalid" };
  const value = input as Partial<EnvironmentPolicyInput>;
  const additionalAllowedOrigins = value.additionalAllowedOrigins ?? [];
  const allowLocalHttp = value.environment === "local";
  if (!isEnvironment(value.environment) || !isEnvironment(value.supabaseEnvironment)
    || value.environment !== value.supabaseEnvironment || !exactOrigin(value.adminOrigin, allowLocalHttp)
    || !Array.isArray(additionalAllowedOrigins) || !additionalAllowedOrigins.every((origin) => exactOrigin(origin, allowLocalHttp))
    || !Array.isArray(value.browserEnvironmentVariables) || hasClientSecret(value.browserEnvironmentVariables)) {
    return { ok: false, code: "environment_policy_invalid" };
  }
  if (value.environment === "production" && value.adminOrigin !== PRODUCTION_ADMIN_ORIGIN) return { ok: false, code: "environment_policy_invalid" };
  if (value.environment !== "production" && value.adminOrigin === PRODUCTION_ADMIN_ORIGIN) return { ok: false, code: "environment_policy_invalid" };
  if (additionalAllowedOrigins.includes(value.adminOrigin)) return { ok: false, code: "environment_policy_invalid" };
  return {
    ok: true,
    policy: { environment: value.environment, adminOrigin: value.adminOrigin, allowedOrigins: [...additionalAllowedOrigins] },
  };
}

export function checkAdminReadinessConfiguredOrigin(
  policy: AdminReadinessEnvironmentPolicy,
  origin: string | null | undefined,
): { ok: true } | { ok: false; code: "origin_denied" } {
  if (!exactOrigin(origin, policy.environment === "local")) return { ok: false, code: "origin_denied" };
  return origin === policy.adminOrigin || policy.allowedOrigins.includes(origin)
    ? { ok: true }
    : { ok: false, code: "origin_denied" };
}
