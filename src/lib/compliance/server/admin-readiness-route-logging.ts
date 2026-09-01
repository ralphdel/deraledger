import "server-only";

import { randomUUID } from "node:crypto";

export type AdminReadinessOperationalEvent = Readonly<{
  timestamp: string;
  operation: "issue" | "snapshot";
  correlationId: string;
  resultKind: "issued" | "created" | "replay" | "ready" | "denied" | "missing" | "conflict" | "throttled" | "unavailable";
  resultCode: string;
  redactedIdentifier?: string;
}>;
export function createAdminReadinessCorrelationId(): string { return randomUUID(); }
export function createAdminReadinessOperationalEvent(input: Omit<AdminReadinessOperationalEvent, "timestamp" | "correlationId"> & Partial<Pick<AdminReadinessOperationalEvent, "timestamp" | "correlationId">>): AdminReadinessOperationalEvent | null {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const correlationId = input.correlationId ?? createAdminReadinessCorrelationId();
  if (!/^(issue|snapshot)$/.test(input.operation) || !/^[a-z0-9_]{1,96}$/.test(input.resultCode) || !/^[0-9a-f-]{36}$/i.test(correlationId) || Number.isNaN(Date.parse(timestamp)) || (input.redactedIdentifier !== undefined && !/^\.\.\.[a-z0-9_-]{4,32}$/i.test(input.redactedIdentifier))) return null;
  return { timestamp, operation: input.operation, correlationId, resultKind: input.resultKind, resultCode: input.resultCode, ...(input.redactedIdentifier ? { redactedIdentifier: input.redactedIdentifier } : {}) };
}
