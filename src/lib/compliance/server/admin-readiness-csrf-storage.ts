import "server-only";

import type { AdminReadinessCsrfMethod, AdminReadinessCsrfOperation } from "./admin-readiness-csrf-token";

/** Storage contains only SHA-256 representations, never raw CSRF token material. */
export type AdminReadinessCsrfStoredRecord = Readonly<{
  tokenDigest: string;
  sessionBindingDigest: string;
  operation: AdminReadinessCsrfOperation;
  method: AdminReadinessCsrfMethod;
  expiresAtEpochMs: number;
}>;

/** Production callers must inject reviewed durable storage; no production default exists. */
export interface AdminReadinessCsrfStorage {
  write(record: AdminReadinessCsrfStoredRecord): Promise<void>;
  read(tokenDigest: string): Promise<unknown | null>;
  remove(tokenDigest: string): Promise<void>;
  invalidateSessionBinding(sessionBindingDigest: string): Promise<void>;
  /** Durable stores may replace a predecessor atomically during rotation. */
  rotate?(previousTokenDigest: string, record: AdminReadinessCsrfStoredRecord): Promise<boolean>;
}

function copy(record: AdminReadinessCsrfStoredRecord): AdminReadinessCsrfStoredRecord {
  return { ...record };
}

/** Test/development-only in-memory seam. It is not a production storage configuration. */
export function createInMemoryAdminReadinessCsrfStorage(): AdminReadinessCsrfStorage {
  const records = new Map<string, AdminReadinessCsrfStoredRecord>();
  return {
    async write(record) { records.set(record.tokenDigest, copy(record)); },
    async read(tokenDigest) {
      const record = records.get(tokenDigest);
      return record ? copy(record) : null;
    },
    async remove(tokenDigest) { records.delete(tokenDigest); },
    async invalidateSessionBinding(sessionBindingDigest) {
      for (const [tokenDigest, record] of records) {
        if (record.sessionBindingDigest === sessionBindingDigest) records.delete(tokenDigest);
      }
    },
    async rotate(previousTokenDigest, record) {
      const previous = records.get(previousTokenDigest);
      if (!previous) return false;
      records.set(record.tokenDigest, copy(record));
      records.delete(previousTokenDigest);
      return true;
    },
  };
}
