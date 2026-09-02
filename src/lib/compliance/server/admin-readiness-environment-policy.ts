import "server-only";

export type AdminReadinessDeploymentEnvironment = "production" | "staging" | "preview" | "local";

export type AdminReadinessEnvironmentPolicy = Readonly<{
  environment: AdminReadinessDeploymentEnvironment;
  adminOrigin: string;
  allowedOrigins: readonly string[];
}>;

export type AdminReadinessEnvironmentPolicyResult =
  | { ok: true; policy: AdminReadinessEnvironmentPolicy }
  | { ok: false; code: "environment_policy_invalid" };

/** Safe-to-log policy facts only; it deliberately contains no environment values. */
export type AdminReadinessRedactedOriginPolicyDiagnostic = Readonly<{
  request_origin_present: boolean;
  request_origin_matches_admin_origin: boolean;
  admin_origin_present: boolean;
  admin_origin_parse_valid: boolean;
  allowed_origins_key_present: boolean;
  allowed_origins_empty_string: boolean;
  allowed_origins_duplicates_admin_origin: boolean;
  deployment_environment_present: boolean;
  supabase_environment_present: boolean;
  deployment_and_supabase_environment_equal: boolean;
  origin_policy_created: boolean;
  final_failure_category: "origin_policy_ready" | "environment_policy_invalid" | "request_origin_missing_or_invalid" | "request_origin_mismatch";
}>;

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
const CLIENT_SECRET_NAME = /(?:service[_-]?role|sb[_-]?secret|secret|private|password|token)/i;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_JWT_PAYLOAD_CHARS = 4_096;

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

function isServiceRoleJwtLike(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const payload = parts[1];
  if (!parts[0] || !parts[2] || !BASE64URL.test(parts[0]) || !BASE64URL.test(parts[2])) return false;
  if (!payload || payload.length > MAX_JWT_PAYLOAD_CHARS || !BASE64URL.test(payload)) return true;
  try {
    const padding = "=".repeat((4 - payload.length % 4) % 4);
    const binary = atob(payload.replace(/-/g, "+").replace(/_/g, "/") + padding);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return true;
    const role = (parsed as { role?: unknown }).role;
    return typeof role === "string" && role.trim().toLowerCase().replace(/[\s-]+/g, "_") === "service_role";
  } catch {
    return true;
  }
}

function hasClientSecret(variables: readonly BrowserEnvironmentVariable[]): boolean {
  return variables.some((variable) => typeof variable.name !== "string"
    || !variable.name.startsWith("NEXT_PUBLIC_")
    || CLIENT_SECRET_NAME.test(variable.name)
    || typeof variable.value === "string" && (/^sb_secret_/i.test(variable.value) || isServiceRoleJwtLike(variable.value)));
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

/**
 * Produces only redacted booleans and a fixed category for staging log diagnosis.
 * It never returns an origin, environment value, key, cookie, or token.
 */
export function createAdminReadinessRedactedOriginPolicyDiagnostic(input: Readonly<{
  environment: unknown;
  supabaseEnvironment: unknown;
  adminOrigin: unknown;
  additionalAllowedOrigins: unknown;
  allowedOriginsKeyPresent: boolean;
  allowedOriginsEmptyString: boolean;
  browserEnvironmentVariables: readonly BrowserEnvironmentVariable[];
  requestOrigin: unknown;
}>): AdminReadinessRedactedOriginPolicyDiagnostic {
  const additionalAllowedOrigins = Array.isArray(input.additionalAllowedOrigins)
    ? input.additionalAllowedOrigins
    : [];
  const environment = input.environment;
  const allowLocalHttp = environment === "local";
  const adminOrigin = input.adminOrigin;
  const requestOrigin = input.requestOrigin;
  const policyResult = validateAdminReadinessEnvironmentPolicy({
    environment: input.environment,
    supabaseEnvironment: input.supabaseEnvironment,
    adminOrigin,
    additionalAllowedOrigins,
    browserEnvironmentVariables: input.browserEnvironmentVariables,
  });
  const requestOriginValid = exactOrigin(requestOrigin, allowLocalHttp);
  const requestOriginMatchesAdminOrigin = typeof requestOrigin === "string"
    && typeof adminOrigin === "string"
    && requestOrigin === adminOrigin;
  const requestOriginAllowed = typeof requestOrigin === "string"
    && additionalAllowedOrigins.includes(requestOrigin);
  const finalFailureCategory = !policyResult.ok
    ? "environment_policy_invalid"
    : !requestOriginValid
      ? "request_origin_missing_or_invalid"
      : requestOriginMatchesAdminOrigin || requestOriginAllowed
        ? "origin_policy_ready"
        : "request_origin_mismatch";

  return {
    request_origin_present: typeof requestOrigin === "string" && requestOrigin.length > 0,
    request_origin_matches_admin_origin: requestOriginMatchesAdminOrigin,
    admin_origin_present: typeof adminOrigin === "string" && adminOrigin.length > 0,
    admin_origin_parse_valid: exactOrigin(adminOrigin, allowLocalHttp),
    allowed_origins_key_present: input.allowedOriginsKeyPresent,
    allowed_origins_empty_string: input.allowedOriginsEmptyString,
    allowed_origins_duplicates_admin_origin: typeof adminOrigin === "string" && additionalAllowedOrigins.includes(adminOrigin),
    deployment_environment_present: typeof environment === "string" && environment.length > 0,
    supabase_environment_present: typeof input.supabaseEnvironment === "string" && input.supabaseEnvironment.length > 0,
    deployment_and_supabase_environment_equal: typeof environment === "string"
      && typeof input.supabaseEnvironment === "string"
      && environment === input.supabaseEnvironment,
    origin_policy_created: policyResult.ok,
    final_failure_category: finalFailureCategory,
  };
}
