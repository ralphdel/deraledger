export type AdminReadinessBrowserEnvironmentAuditReason =
  | "allowed_public_name"
  | "public_name_no_sensitive_marker"
  | "forbidden_public_name"
  | "sensitive_value_pattern"
  | "not_browser_public_name";

export type AdminReadinessBrowserEnvironmentAuditResult = Readonly<{
  status: "PASS" | "BLOCKED";
  reason: AdminReadinessBrowserEnvironmentAuditReason;
}>;

export const ADMIN_READINESS_INTENTIONAL_PUBLIC_BROWSER_VARIABLE_NAMES = new Set([
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_APP_ENV",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY",
]);

const CLIENT_SECRET_NAME = /(?:service[_-]?role|sb[_-]?secret|secret|private|password|token)/i;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_JWT_PAYLOAD_CHARS = 4_096;

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

export function auditAdminReadinessBrowserEnvironmentVariable(
  name: unknown,
  value: unknown,
): AdminReadinessBrowserEnvironmentAuditResult {
  if (typeof name !== "string" || !name.startsWith("NEXT_PUBLIC_")) {
    return { status: "BLOCKED", reason: "not_browser_public_name" };
  }
  if (typeof value === "string" && (/^sb_secret_/i.test(value) || isServiceRoleJwtLike(value))) {
    return { status: "BLOCKED", reason: "sensitive_value_pattern" };
  }
  if (ADMIN_READINESS_INTENTIONAL_PUBLIC_BROWSER_VARIABLE_NAMES.has(name)) {
    return { status: "PASS", reason: "allowed_public_name" };
  }
  return CLIENT_SECRET_NAME.test(name)
    ? { status: "BLOCKED", reason: "forbidden_public_name" }
    : { status: "PASS", reason: "public_name_no_sensitive_marker" };
}
