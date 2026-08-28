import "server-only";

import {
  createAdminReadinessCsrfLifecycleValidator,
  type AdminReadinessCsrfLifecycleInput,
} from "./admin-readiness-csrf-issuer";
import type { AdminReadinessCsrfStorage } from "./admin-readiness-csrf-storage";

export interface AdminReadinessCsrfInput {
  operation: "issue" | "snapshot";
  method: "GET" | "POST";
  csrfEvidence: string | null;
  sessionBindingReference?: string | null;
}
export type AdminReadinessCsrfResult =
  | { kind: "allow" }
  | { kind: "deny"; code: "csrf_denied" }
  | { kind: "unavailable"; code: "csrf_unavailable" };
export interface AdminReadinessCsrfValidator { validate(input: AdminReadinessCsrfInput): Promise<AdminReadinessCsrfResult>; }
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value as object).length === keys.length && keys.every((key) => Object.hasOwn(value as object, key));
}
function validInput(input: AdminReadinessCsrfInput): boolean {
  return /^(issue|snapshot)$/.test(input.operation) && /^(GET|POST)$/.test(input.method)
    && typeof input.csrfEvidence === "string" && input.csrfEvidence.length > 0 && input.csrfEvidence.length <= 512
    && (input.sessionBindingReference === undefined || input.sessionBindingReference === null || /^[a-f0-9]{12,128}$/i.test(input.sessionBindingReference));
}
function normalize(value: unknown): AdminReadinessCsrfResult {
  if (exact(value, ["kind"]) && value.kind === "allow") return { kind: "allow" };
  if (exact(value, ["kind", "code"]) && value.kind === "deny" && value.code === "csrf_denied") return { kind: "deny", code: "csrf_denied" };
  if (exact(value, ["kind", "code"]) && value.kind === "unavailable" && value.code === "csrf_unavailable") return { kind: "unavailable", code: "csrf_unavailable" };
  return { kind: "unavailable", code: "csrf_unavailable" };
}
export function createAdminReadinessCsrfValidator(validator?: AdminReadinessCsrfValidator | null): AdminReadinessCsrfValidator {
  return { async validate(input) {
    if (!validInput(input)) return { kind: "deny", code: "csrf_denied" };
    if (!validator) return { kind: "unavailable", code: "csrf_unavailable" };
    try { return normalize(await validator.validate(input)); } catch { return { kind: "unavailable", code: "csrf_unavailable" }; }
  } };
}

/** Wraps the synchronizer-token lifecycle in the route's normalized result boundary. */
export function createAdminReadinessLifecycleCsrfValidator(dependencies: Readonly<{
  storage: AdminReadinessCsrfStorage | null;
  now?: () => number;
}>): AdminReadinessCsrfValidator {
  const lifecycle = createAdminReadinessCsrfLifecycleValidator(dependencies);
  return createAdminReadinessCsrfValidator({
    validate(input: AdminReadinessCsrfInput) {
      return lifecycle.validate(input as AdminReadinessCsrfLifecycleInput);
    },
  });
}
