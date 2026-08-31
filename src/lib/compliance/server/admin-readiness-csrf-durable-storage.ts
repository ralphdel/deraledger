import "server-only";

import type { AdminReadinessCsrfStorage, AdminReadinessCsrfStoredRecord } from "./admin-readiness-csrf-storage";

export type AdminReadinessSupabaseSecurityRpcClient = Readonly<{
  rpc(functionName: string, arguments_: Record<string, unknown>): Promise<Readonly<{ data: unknown; error: unknown | null }>>;
}>;

type Dependencies = Readonly<{
  client: AdminReadinessSupabaseSecurityRpcClient | null;
  now?: () => number;
}>;

const DIGEST = /^[a-f0-9]{64}$/;
const MAX_ACTIVE_PER_BINDING = 4;
const MAX_TTL_MS = 30 * 60 * 1_000;

const CREATE_RPC = "create_admin_readiness_csrf_token_v1";
const READ_RPC = "read_admin_readiness_csrf_token_v1";
const ROTATE_RPC = "rotate_admin_readiness_csrf_token_v1";
const INVALIDATE_RPC = "invalidate_admin_readiness_csrf_binding_v1";

type CreateRow = Readonly<{ result_code: "created" | "conflict" | "invalid" | "csrf_unavailable" }>;
type ReadRow = Readonly<{
  result_code: "found" | "missing" | "expired" | "invalid" | "csrf_unavailable";
  operation: string | null;
  method: string | null;
  session_binding_digest: string | null;
  expires_at: string | null;
}>;
type RotateRow = Readonly<{ result_code: "rotated" | "conflict" | "missing" | "expired" | "binding_mismatch" | "operation_mismatch" | "method_mismatch" | "invalid" | "csrf_unavailable" }>;
type InvalidateRow = Readonly<{ result_code: "invalidated" | "missing" | "invalid" | "csrf_unavailable"; deleted_count: number | null }>;

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value as object).length === keys.length
    && keys.every((key) => Object.hasOwn(value as object, key));
}

function oneRow(value: unknown): Record<string, unknown> | null {
  return Array.isArray(value) && value.length === 1 && value[0] && typeof value[0] === "object" && !Array.isArray(value[0])
    ? value[0] as Record<string, unknown>
    : null;
}

function operationForRpc(operation: AdminReadinessCsrfStoredRecord["operation"]): "readiness_issue" | "readiness_snapshot" {
  return operation === "issue" ? "readiness_issue" : "readiness_snapshot";
}

function operationFromRpc(value: unknown): AdminReadinessCsrfStoredRecord["operation"] | null {
  if (value === "readiness_issue") return "issue";
  if (value === "readiness_snapshot") return "snapshot";
  return null;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const epochMs = Date.parse(value);
  return Number.isSafeInteger(epochMs) && epochMs > 0 ? epochMs : null;
}

function validRecord(value: AdminReadinessCsrfStoredRecord): boolean {
  return DIGEST.test(value.tokenDigest) && DIGEST.test(value.sessionBindingDigest)
    && (value.operation === "issue" || value.operation === "snapshot")
    && value.method === "POST"
    && Number.isSafeInteger(value.expiresAtEpochMs) && value.expiresAtEpochMs > 0;
}

function ttl(record: AdminReadinessCsrfStoredRecord, clock: () => number): number | null {
  const now = clock();
  if (!validRecord(record) || !Number.isSafeInteger(now) || now <= 0 || record.expiresAtEpochMs <= now) return null;
  const ttlMs = record.expiresAtEpochMs - now;
  return ttlMs <= MAX_TTL_MS ? ttlMs : null;
}

function createResult(value: unknown): CreateRow | null {
  const row = oneRow(value);
  return row && exact(row, ["result_code"])
    && (row.result_code === "created" || row.result_code === "conflict" || row.result_code === "invalid" || row.result_code === "csrf_unavailable")
    ? row as CreateRow
    : null;
}

function readResult(value: unknown): ReadRow | null {
  const row = oneRow(value);
  return row && exact(row, ["result_code", "operation", "method", "session_binding_digest", "expires_at"])
    && (row.result_code === "found" || row.result_code === "missing" || row.result_code === "expired" || row.result_code === "invalid" || row.result_code === "csrf_unavailable")
    && (typeof row.operation === "string" || row.operation === null)
    && (typeof row.method === "string" || row.method === null)
    && (typeof row.session_binding_digest === "string" || row.session_binding_digest === null)
    && (typeof row.expires_at === "string" || row.expires_at === null)
    ? row as ReadRow
    : null;
}

function rotateResult(value: unknown): RotateRow | null {
  const row = oneRow(value);
  return row && exact(row, ["result_code"])
    && (row.result_code === "rotated" || row.result_code === "conflict" || row.result_code === "missing" || row.result_code === "expired"
      || row.result_code === "binding_mismatch" || row.result_code === "operation_mismatch" || row.result_code === "method_mismatch"
      || row.result_code === "invalid" || row.result_code === "csrf_unavailable")
    ? row as RotateRow
    : null;
}

function invalidateResult(value: unknown): InvalidateRow | null {
  const row = oneRow(value);
  return row && exact(row, ["result_code", "deleted_count"])
    && (row.result_code === "invalidated" || row.result_code === "missing" || row.result_code === "invalid" || row.result_code === "csrf_unavailable")
    && (typeof row.deleted_count === "number" || row.deleted_count === null)
    ? row as InvalidateRow
    : null;
}

/**
 * Server-only adapter for the reviewed Supabase CSRF RPCs. It stores no raw
 * token/session material, exposes no generic client, and maps every malformed
 * provider response or error to the existing fail-closed storage seam.
 */
export function createAdminReadinessDurableCsrfStorage(dependencies: Dependencies): AdminReadinessCsrfStorage {
  const client = dependencies.client;
  const clock = dependencies.now ?? Date.now;

  return {
    async write(record) {
      if (!client || ttl(record, clock) === null) throw new Error("csrf storage unavailable");
      try {
        const response = await client.rpc(CREATE_RPC, {
          p_token_digest: record.tokenDigest,
          p_session_binding_digest: record.sessionBindingDigest,
          p_operation: operationForRpc(record.operation),
          p_method: record.method,
          p_expires_at: new Date(record.expiresAtEpochMs).toISOString(),
        });
        const row = response.error ? null : createResult(response.data);
        if (!row || row.result_code !== "created") throw new Error("csrf storage unavailable");
      } catch {
        throw new Error("csrf storage unavailable");
      }
    },
    async read(tokenDigest) {
      if (!client || !DIGEST.test(tokenDigest)) throw new Error("csrf storage unavailable");
      try {
        const response = await client.rpc(READ_RPC, { p_token_digest: tokenDigest });
        const row = response.error ? null : readResult(response.data);
        if (!row) throw new Error("csrf storage unavailable");
        if (row.result_code === "missing" || row.result_code === "expired") return null;
        if (row.result_code !== "found" || !row.session_binding_digest || !DIGEST.test(row.session_binding_digest)
          || row.method !== "POST") throw new Error("csrf storage unavailable");
        const operation = operationFromRpc(row.operation);
        const expiresAtEpochMs = timestamp(row.expires_at);
        if (!operation || expiresAtEpochMs === null) throw new Error("csrf storage unavailable");
        return { tokenDigest, sessionBindingDigest: row.session_binding_digest, operation, method: "POST", expiresAtEpochMs };
      } catch {
        throw new Error("csrf storage unavailable");
      }
    },
    async remove() {
      // The reviewed RPC surface deliberately has no single-token delete. The
      // issuer uses atomic rotate, so a fallback remove must fail closed.
      throw new Error("csrf storage unavailable");
    },
    async invalidateSessionBinding(sessionBindingDigest) {
      if (!client || !DIGEST.test(sessionBindingDigest)) throw new Error("csrf storage unavailable");
      try {
        const response = await client.rpc(INVALIDATE_RPC, {
          p_session_binding_digest: sessionBindingDigest,
          p_max_delete_count: MAX_ACTIVE_PER_BINDING,
        });
        const row = response.error ? null : invalidateResult(response.data);
        if (!row || (row.result_code !== "invalidated" && row.result_code !== "missing")) throw new Error("csrf storage unavailable");
      } catch {
        throw new Error("csrf storage unavailable");
      }
    },
    async rotate(previousTokenDigest, record) {
      if (!client || !DIGEST.test(previousTokenDigest) || ttl(record, clock) === null) return false;
      try {
        const response = await client.rpc(ROTATE_RPC, {
          p_previous_token_digest: previousTokenDigest,
          p_new_token_digest: record.tokenDigest,
          p_session_binding_digest: record.sessionBindingDigest,
          p_operation: operationForRpc(record.operation),
          p_method: record.method,
          p_expires_at: new Date(record.expiresAtEpochMs).toISOString(),
        });
        const row = response.error ? null : rotateResult(response.data);
        return row?.result_code === "rotated";
      } catch {
        return false;
      }
    },
  };
}
