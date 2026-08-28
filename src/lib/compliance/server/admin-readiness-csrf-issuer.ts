import "server-only";

import {
  createAdminReadinessCsrfToken,
  digestAdminReadinessCsrfValue,
  equalAdminReadinessCsrfDigests,
  isAdminReadinessCsrfDigest,
  isAdminReadinessCsrfSessionBinding,
  isAdminReadinessCsrfToken,
  type AdminReadinessCsrfMethod,
  type AdminReadinessCsrfOperation,
} from "./admin-readiness-csrf-token";
import type { AdminReadinessCsrfStorage, AdminReadinessCsrfStoredRecord } from "./admin-readiness-csrf-storage";

export type AdminReadinessCsrfSafeResult =
  | { kind: "allow" }
  | { kind: "deny"; code: "csrf_denied" }
  | { kind: "unavailable"; code: "csrf_unavailable" };

export type AdminReadinessCsrfLifecycleInput = Readonly<{
  operation: AdminReadinessCsrfOperation;
  method: AdminReadinessCsrfMethod;
  csrfEvidence: string | null;
  sessionBindingReference: string | null;
}>;

export type AdminReadinessCsrfIssueInput = Readonly<{
  operation: AdminReadinessCsrfOperation;
  method: AdminReadinessCsrfMethod;
  sessionBindingReference: string;
  expiresInMs?: number;
}>;

export type AdminReadinessCsrfIssuedToken = Readonly<{
  token: string;
  expiresAt: string;
}>;

type Clock = () => number;
type Dependencies = Readonly<{ storage: AdminReadinessCsrfStorage | null; now?: Clock }>;

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_TTL_MS = 60 * 60 * 1000;
const DIGEST = /^[a-f0-9]{64}$/i;

function exact(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value as object).length === expected.length
    && expected.every((key) => Object.hasOwn(value as object, key));
}

function validOperation(value: unknown): value is AdminReadinessCsrfOperation {
  return value === "issue" || value === "snapshot";
}

function validMethod(value: unknown): value is AdminReadinessCsrfMethod {
  return value === "GET" || value === "POST";
}

function validExpiry(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validTtl(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MAX_TTL_MS;
}

function validStoredRecord(value: unknown): value is AdminReadinessCsrfStoredRecord {
  if (!exact(value, ["tokenDigest", "sessionBindingDigest", "operation", "method", "expiresAtEpochMs"])) return false;
  return isAdminReadinessCsrfDigest(value.tokenDigest)
    && isAdminReadinessCsrfDigest(value.sessionBindingDigest)
    && validOperation(value.operation)
    && validMethod(value.method)
    && validExpiry(value.expiresAtEpochMs);
}

function validIssueInput(input: AdminReadinessCsrfIssueInput): boolean {
  return validOperation(input.operation)
    && validMethod(input.method)
    && isAdminReadinessCsrfSessionBinding(input.sessionBindingReference)
    && (input.expiresInMs === undefined || validTtl(input.expiresInMs));
}

function validLifecycleInput(input: AdminReadinessCsrfLifecycleInput): boolean {
  return validOperation(input.operation)
    && validMethod(input.method)
    && isAdminReadinessCsrfToken(input.csrfEvidence)
    && isAdminReadinessCsrfSessionBinding(input.sessionBindingReference);
}

function epoch(clock: Clock): number | null {
  const value = clock();
  return validExpiry(value) ? value : null;
}

function unavailable(): AdminReadinessCsrfSafeResult {
  return { kind: "unavailable", code: "csrf_unavailable" };
}

function denied(): AdminReadinessCsrfSafeResult {
  return { kind: "deny", code: "csrf_denied" };
}

function digestEqual(left: unknown, right: string): boolean {
  return typeof left === "string" && DIGEST.test(left) && equalAdminReadinessCsrfDigests(left, right);
}

async function issueToken(
  storage: AdminReadinessCsrfStorage,
  clock: Clock,
  input: AdminReadinessCsrfIssueInput,
): Promise<AdminReadinessCsrfIssuedToken | null> {
  if (!validIssueInput(input)) return null;
  const now = epoch(clock);
  const ttl = input.expiresInMs ?? DEFAULT_TTL_MS;
  if (now === null || !validTtl(ttl) || now > Number.MAX_SAFE_INTEGER - ttl) return null;
  const token = createAdminReadinessCsrfToken();
  const expiresAtEpochMs = now + ttl;
  const record: AdminReadinessCsrfStoredRecord = {
    tokenDigest: digestAdminReadinessCsrfValue(token),
    sessionBindingDigest: digestAdminReadinessCsrfValue(input.sessionBindingReference),
    operation: input.operation,
    method: input.method,
    expiresAtEpochMs,
  };
  try {
    await storage.write(record);
    return { token, expiresAt: new Date(expiresAtEpochMs).toISOString() };
  } catch {
    return null;
  }
}

/** Creates session-bound synchronizer tokens; it neither reads a session nor grants authority. */
export function createAdminReadinessCsrfIssuer(dependencies: Dependencies): {
  issue(input: AdminReadinessCsrfIssueInput): Promise<AdminReadinessCsrfIssuedToken | null>;
  rotate(input: AdminReadinessCsrfIssueInput & { previousToken: string }): Promise<AdminReadinessCsrfIssuedToken | null>;
  invalidateSessionBinding(sessionBindingReference: string): Promise<boolean>;
} {
  const storage = dependencies.storage;
  const clock = dependencies.now ?? Date.now;
  return {
    async issue(input) {
      return storage ? issueToken(storage, clock, input) : null;
    },
    async rotate(input) {
      if (!storage || !validIssueInput(input) || !isAdminReadinessCsrfToken(input.previousToken)) return null;
      const now = epoch(clock);
      if (now === null) return null;
      const previousDigest = digestAdminReadinessCsrfValue(input.previousToken);
      try {
        const previous = await storage.read(previousDigest);
        if (!validStoredRecord(previous) || previous.expiresAtEpochMs <= now
          || !digestEqual(previous.tokenDigest, previousDigest)
          || !digestEqual(previous.sessionBindingDigest, digestAdminReadinessCsrfValue(input.sessionBindingReference))
          || previous.operation !== input.operation || previous.method !== input.method) return null;
        const issued = await issueToken(storage, clock, input);
        if (!issued) return null;
        await storage.remove(previousDigest);
        return issued;
      } catch {
        return null;
      }
    },
    async invalidateSessionBinding(sessionBindingReference) {
      if (!storage || !isAdminReadinessCsrfSessionBinding(sessionBindingReference)) return false;
      try {
        await storage.invalidateSessionBinding(digestAdminReadinessCsrfValue(sessionBindingReference));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Structural match for the existing route CSRF seam, with all dependency output normalized. */
export function createAdminReadinessCsrfLifecycleValidator(dependencies: Dependencies): {
  validate(input: AdminReadinessCsrfLifecycleInput): Promise<AdminReadinessCsrfSafeResult>;
} {
  const storage = dependencies.storage;
  const clock = dependencies.now ?? Date.now;
  return {
    async validate(input) {
      if (!validLifecycleInput(input)) return denied();
      if (!storage) return unavailable();
      const now = epoch(clock);
      if (now === null) return unavailable();
      const csrfEvidence = input.csrfEvidence;
      const sessionBindingReference = input.sessionBindingReference;
      if (!isAdminReadinessCsrfToken(csrfEvidence) || !isAdminReadinessCsrfSessionBinding(sessionBindingReference)) return denied();
      const tokenDigest = digestAdminReadinessCsrfValue(csrfEvidence);
      const bindingDigest = digestAdminReadinessCsrfValue(sessionBindingReference);
      try {
        const record = await storage.read(tokenDigest);
        if (record === null) return denied();
        if (!validStoredRecord(record) || !digestEqual(record.tokenDigest, tokenDigest)) return unavailable();
        if (record.expiresAtEpochMs <= now) return denied();
        if (!digestEqual(record.sessionBindingDigest, bindingDigest)
          || record.operation !== input.operation || record.method !== input.method) return denied();
        return { kind: "allow" };
      } catch {
        return unavailable();
      }
    },
  };
}
