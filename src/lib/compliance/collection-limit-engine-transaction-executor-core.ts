import type { CollectionLimitCommandPayload } from "./collection-limit-engine-command-core";
import {
  prepareCollectionLimitEnginePersistence,
  type CollectionLimitEngineAtomicWriter,
  type CollectionLimitEnginePersistenceReasonCode,
  type CollectionLimitEnginePersistenceResult,
  type CollectionLimitServiceRoleContext,
  type PersistedCollectionLimitWindow,
} from "./collection-limit-engine-persistence-core";

/**
 * Mockable orchestration for the future collection-limit transport. This file
 * constructs no database client and is intentionally not imported by runtime
 * routes, actions, external payment initialization, callbacks, or webhooks.
 */
export interface CollectionLimitTransactionRunner {
  runServiceRoleTransaction<T>(
    operation: (writer: CollectionLimitEngineAtomicWriter) => Promise<T>,
  ): Promise<T>;
}

export type CollectionLimitTransactionExecutorReasonCode =
  | "limit_transaction_context_denied"
  | "limit_transaction_runner_missing"
  | "limit_transaction_atomic_write_failed";

export type CollectionLimitTransactionExecutorResult =
  | Extract<CollectionLimitEnginePersistenceResult, { kind: "rejected" | "replay" }>
  | {
      kind: "created";
      operation: "limit_approval" | "reservation" | "commit" | "release" | "expiry" | "reversal";
      windowIds: readonly string[];
      reservationId: string | null;
      eventIds: readonly string[];
      diagnostics: readonly [];
    }
  | {
      kind: "rejected";
      diagnostics: readonly [{ code: CollectionLimitEnginePersistenceReasonCode | CollectionLimitTransactionExecutorReasonCode }];
    };

function isServiceRoleContext(context: CollectionLimitServiceRoleContext | null): boolean {
  return context?.databaseRole === "service_role" && context.internalCollectionEngineAuthorized === true;
}

function operationFor(command: CollectionLimitCommandPayload): "limit_approval" | "reservation" | "commit" | "release" | "expiry" | "reversal" {
  if (command.kind === "limit_approval" || command.kind === "reservation" || command.kind === "commit" || command.kind === "reversal") return command.kind;
  return command.usageEventType === "reservation_expired" ? "expiry" : "release";
}

function expectedWindowIds(command: CollectionLimitCommandPayload, windows: readonly PersistedCollectionLimitWindow[]): readonly string[] {
  return command.kind === "reservation" ? command.windows.map((window) => window.windowId) : windows.map((window) => window.id);
}

function assertWrite<T extends { id?: string } | null>(value: T, failure: string): asserts value is Exclude<T, null> {
  if (!value || !("id" in value) || !value.id) throw new Error(failure);
}

function safeEventDirection(operation: ReturnType<typeof operationFor>): "debit" | "credit" {
  return operation === "commit" ? "debit" : "credit";
}

async function executeWrites(
  command: CollectionLimitCommandPayload,
  writer: CollectionLimitEngineAtomicWriter,
  windows: readonly PersistedCollectionLimitWindow[],
  persistence: Extract<CollectionLimitEnginePersistenceResult, { kind: "ready" }>,
): Promise<Extract<CollectionLimitTransactionExecutorResult, { kind: "created" }>> {
  const operation = operationFor(command);
  const windowIds = expectedWindowIds(command, windows);

  if (command.kind === "limit_approval") {
    const existing = windows[0] ?? null;
    const write = existing
      ? writer.updateLimitWindow({ id: existing.id, merchant_id: command.merchantId, profile_id: command.profileId, lifecycle: "approved", limit_amount: command.amountNgn, policy_version: command.policyVersion, expected_row_version: command.expectedWindowRowVersion, row_version: command.expectedWindowRowVersion + 1 })
      : writer.createLimitWindow({ merchant_id: command.merchantId, profile_id: command.profileId, window_type: command.limitType, limit_amount: command.amountNgn, policy_timezone: command.policy.policyTimezone, window_start: command.policy.windowStart, window_end: command.policy.windowEnd, policy_version: command.policyVersion, lifecycle: "approved", idempotency_key: command.idempotencyKey });
    const written = await write;
    assertWrite(written, "limit_window_write_failed");
    return { kind: "created", operation, windowIds: [written.id], reservationId: null, eventIds: [], diagnostics: [] };
  }

  if (command.kind === "reservation") {
    const reservation = await writer.createReservation({ merchant_id: command.merchantId, profile_id: command.profileId, source_type: command.sourceType, source_id: command.sourceId, internal_reference: command.internalReference, idempotency_key: command.idempotencyKey, amount: command.amountNgn, currency: command.currency, status: "reserved", expires_at: command.expiresAt });
    assertWrite(reservation, "limit_reservation_write_failed");
    for (const window of windows) {
      const link = await writer.createReservationWindowLink({ reservation_id: reservation.id, window_id: window.id, amount: command.amountNgn });
      if (!link || link.reservationId !== reservation.id || link.windowId !== window.id) throw new Error("limit_link_write_failed");
      const updated = await writer.updateLimitWindow({ id: window.id, merchant_id: command.merchantId, expected_row_version: window.rowVersion, reserved_amount_delta: command.amountNgn, row_version_delta: 1 });
      assertWrite(updated, "limit_window_write_failed");
    }
    return { kind: "created", operation, windowIds, reservationId: reservation.id, eventIds: [], diagnostics: [] };
  }

  const reservation = await writer.findReservations({ merchantId: command.merchantId, idempotencyKey: command.idempotencyKey, internalReference: command.internalReference });
  const current = reservation[0];
  if (!current) throw new Error("limit_reservation_missing_after_validation");
  const links = await writer.findReservationLinks(current.id);
  if (links.length === 0) throw new Error("limit_link_missing_after_validation");
  const eventIds: string[] = [];
  for (const link of links) {
    const window = windows.find((item) => item.id === link.windowId);
    if (!window) throw new Error("limit_window_missing_after_validation");
    const windowDelta = operation === "commit"
      ? { reserved_amount_delta: -link.amountNgn, committed_amount_delta: link.amountNgn }
      : operation === "reversal"
        ? { committed_amount_delta: -link.amountNgn }
        : { reserved_amount_delta: -link.amountNgn };
    const updated = await writer.updateLimitWindow({ id: window.id, merchant_id: command.merchantId, expected_row_version: window.rowVersion, row_version_delta: 1, ...windowDelta });
    assertWrite(updated, "limit_window_write_failed");
    if (persistence.persistedUsageEventType) {
      const event = await writer.appendUsageEvent({ merchant_id: command.merchantId, profile_id: command.profileId, window_id: window.id, reservation_id: current.id, event_type: persistence.persistedUsageEventType, direction: safeEventDirection(operation), amount: link.amountNgn, currency: command.currency, internal_reference: command.internalReference, idempotency_key: command.idempotencyKey, reason_code: command.reasonCode, actor_type: "system", metadata: { operation } });
      assertWrite(event, "limit_usage_event_write_failed");
      eventIds.push(event.id);
    }
  }
  const status = operation === "commit" ? "committed" : operation === "expiry" ? "expired" : operation === "reversal" ? "reversed" : "released";
  const updatedReservation = await writer.updateReservation({ id: current.id, merchant_id: command.merchantId, expected_row_version: current.rowVersion, status, row_version_delta: 1, release_reason_code: command.reasonCode });
  assertWrite(updatedReservation, "limit_reservation_write_failed");
  return { kind: "created", operation, windowIds: links.map((link) => link.windowId), reservationId: current.id, eventIds, diagnostics: [] };
}

/** Runs a single command inside one injected atomic transaction. */
export async function executeCollectionLimitTransaction(
  command: CollectionLimitCommandPayload | null,
  context: CollectionLimitServiceRoleContext | null,
  runner: CollectionLimitTransactionRunner | null,
): Promise<CollectionLimitTransactionExecutorResult> {
  if (!isServiceRoleContext(context)) return { kind: "rejected", diagnostics: [{ code: "limit_transaction_context_denied" }] };
  if (!runner) return { kind: "rejected", diagnostics: [{ code: "limit_transaction_runner_missing" }] };
  if (!command) return { kind: "rejected", diagnostics: [{ code: "limit_persistence_command_missing" }] };

  try {
    return await runner.runServiceRoleTransaction(async (writer) => {
      const windows = await writer.findWindows({ merchantId: command.merchantId, profileId: command.profileId });
      const reservationRows = command.kind === "limit_approval" || command.kind === "reservation"
        ? []
        : await writer.findReservations({ merchantId: command.merchantId, idempotencyKey: command.idempotencyKey, internalReference: command.internalReference });
      const reservationId = reservationRows.length === 1 ? reservationRows[0].id : "unresolved-reservation";
      const [links, events] = await Promise.all([
        command.kind === "limit_approval" || command.kind === "reservation" ? Promise.resolve([]) : writer.findReservationLinks(reservationId),
        writer.findUsageEvents({ merchantId: command.merchantId, idempotencyKey: command.idempotencyKey }),
      ]);
      const persistence = prepareCollectionLimitEnginePersistence(command, context, { windows, reservations: reservationRows, links, events });
      if (persistence.kind !== "ready") return persistence;
      return executeWrites(command, writer, windows, persistence);
    });
  } catch {
    return { kind: "rejected", diagnostics: [{ code: "limit_transaction_atomic_write_failed" }] };
  }
}
