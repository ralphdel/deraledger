import type {
  CollectionLimitCommandPayload,
  CollectionReservationLifecycle,
} from "./collection-limit-engine-command-core";

/**
 * Pure persistence boundary for the future collection-limit engine. This core
 * creates no client and performs no transaction or write; a later service-role
 * transport must consume a `ready` result inside one atomic transaction.
 */

export const PERSISTED_COLLECTION_WINDOW_TYPES = [
  "cumulative",
  "monthly",
  "daily_velocity",
  "outstanding_receivable",
] as const;

export const PERSISTED_COLLECTION_USAGE_EVENT_TYPES = [
  "collection_committed",
  "reservation_released",
  "refund_adjustment",
  "chargeback_adjustment",
  "manual_correction",
] as const;

export type PersistedCollectionWindowType = (typeof PERSISTED_COLLECTION_WINDOW_TYPES)[number];
export type PersistedCollectionUsageEventType = (typeof PERSISTED_COLLECTION_USAGE_EVENT_TYPES)[number];

export interface CollectionLimitServiceRoleContext {
  databaseRole: "service_role" | "anon" | "authenticated" | "browser" | "unknown";
  internalCollectionEngineAuthorized: boolean;
}

export interface PersistedCollectionLimitWindow {
  id: string;
  merchantId: string;
  profileId: string;
  windowType: PersistedCollectionWindowType;
  lifecycle: "active" | "exhausted" | "expired" | "suspended" | "revoked";
  rowVersion: number | null;
}

export interface PersistedCollectionReservation {
  id: string;
  merchantId: string;
  profileId: string;
  internalReference: string;
  amountNgn: number;
  currency: "NGN";
  status: CollectionReservationLifecycle;
  rowVersion: number | null;
}

export interface PersistedCollectionReservationWindowLink {
  reservationId: string;
  windowId: string;
  amountNgn: number;
}

export interface PersistedCollectionUsageEvent {
  id: string;
  merchantId: string;
  profileId: string;
  windowId: string;
  reservationId: string | null;
  internalReference: string;
  idempotencyKey: string;
  eventType: PersistedCollectionUsageEventType;
  reasonCode: string | null;
}

export interface CollectionLimitEnginePersistenceSnapshot {
  windows: readonly PersistedCollectionLimitWindow[];
  reservations: readonly PersistedCollectionReservation[];
  links: readonly PersistedCollectionReservationWindowLink[];
  events: readonly PersistedCollectionUsageEvent[];
}

/**
 * A future transaction transport may expose only these four-table operations.
 * There are intentionally no merchant/workspace/payment/provider/invoice,
 * activation, entitlement, or checkout operations in this interface.
 */
export interface CollectionLimitEngineAtomicWriter {
  findWindows(input: { merchantId: string; profileId: string }): Promise<readonly PersistedCollectionLimitWindow[]>;
  findReservations(input: { merchantId: string; idempotencyKey: string; internalReference: string }): Promise<readonly PersistedCollectionReservation[]>;
  findReservationLinks(reservationId: string): Promise<readonly PersistedCollectionReservationWindowLink[]>;
  findUsageEvents(input: { merchantId: string; idempotencyKey: string }): Promise<readonly PersistedCollectionUsageEvent[]>;
  createLimitWindow(row: Record<string, unknown>): Promise<{ id: string; rowVersion: number } | null>;
  updateLimitWindow(row: Record<string, unknown>): Promise<{ id: string; rowVersion: number } | null>;
  createReservation(row: Record<string, unknown>): Promise<{ id: string; rowVersion: number } | null>;
  updateReservation(row: Record<string, unknown>): Promise<{ id: string; rowVersion: number } | null>;
  createReservationWindowLink(row: Record<string, unknown>): Promise<{ reservationId: string; windowId: string } | null>;
  appendUsageEvent(row: Record<string, unknown>): Promise<{ id: string } | null>;
}

export interface CollectionLimitEnginePersistenceDatabase {
  executeAtomically<T>(operation: (writer: CollectionLimitEngineAtomicWriter) => Promise<T>): Promise<T>;
}

export type CollectionLimitEnginePersistenceReasonCode =
  | "limit_persistence_command_missing"
  | "limit_persistence_context_denied"
  | "limit_persistence_payload_invalid"
  | "limit_window_missing"
  | "limit_window_ambiguous"
  | "limit_window_not_reservable"
  | "limit_window_row_version_stale"
  | "limit_reservation_missing"
  | "limit_reservation_ambiguous"
  | "limit_reservation_status_invalid"
  | "limit_reservation_row_version_stale"
  | "limit_reservation_identity_mismatch"
  | "limit_link_missing"
  | "limit_link_ambiguous"
  | "limit_event_ambiguous"
  | "limit_replay_inconsistent"
  | "limit_idempotent_replay";

type CollectionLimitPersistenceRejectReason = Exclude<
  CollectionLimitEnginePersistenceReasonCode,
  "limit_idempotent_replay"
>;
type CollectionLimitPersistenceOperation =
  | "limit_approval"
  | "reservation"
  | "commit"
  | "release"
  | "expiry"
  | "reversal";

export type CollectionLimitEnginePersistenceResult =
  | {
      kind: "ready";
      operation: CollectionLimitPersistenceOperation;
      persistedUsageEventType: PersistedCollectionUsageEventType | null;
      diagnostics: readonly [];
    }
  | {
      kind: "replay";
      diagnostics: readonly [{ code: "limit_idempotent_replay" }];
    }
  | {
      kind: "rejected";
      diagnostics: readonly [{ code: CollectionLimitPersistenceRejectReason }];
    };

function nonEmpty(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function positiveVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function falseEntitlements(command: CollectionLimitCommandPayload): boolean {
  const entitlements = command.merchantEntitlements;
  return command.activationRequested === false && Object.values(entitlements).every((value) => value === false);
}

function validCommand(command: CollectionLimitCommandPayload): boolean {
  return Boolean(
    nonEmpty(command.merchantId)
      && nonEmpty(command.workspaceId)
      && nonEmpty(command.profileId)
      && nonEmpty(command.policyVersion)
      && nonEmpty(command.idempotencyKey)
      && falseEntitlements(command),
  );
}

function serviceRoleAllowed(context: CollectionLimitServiceRoleContext | null): boolean {
  return context?.databaseRole === "service_role" && context.internalCollectionEngineAuthorized === true;
}

function replayMatchesEvent(
  event: PersistedCollectionUsageEvent,
  command: CollectionLimitCommandPayload,
  eventType: PersistedCollectionUsageEventType,
): boolean {
  const reservationId = "reservationId" in command ? command.reservationId : null;
  const internalReference = "internalReference" in command ? command.internalReference : null;
  return event.merchantId === command.merchantId
    && event.profileId === command.profileId
    && event.idempotencyKey === command.idempotencyKey
    && event.reservationId === reservationId
    && event.internalReference === internalReference
    && event.eventType === eventType;
}

function resolvePersistedUsageEvent(command: CollectionLimitCommandPayload): {
  eventType: PersistedCollectionUsageEventType | null;
  operation: CollectionLimitPersistenceOperation;
} | null {
  if (command.kind === "limit_approval") return { operation: "limit_approval", eventType: null };
  if (command.kind === "reservation") return { operation: "reservation", eventType: null };
  if (command.kind === "commit" && command.usageEventType === "collection_committed") return { operation: "commit", eventType: "collection_committed" };
  if (command.kind === "release") {
    if (command.usageEventType === "reservation_released") return { operation: "release", eventType: "reservation_released" };
    if (command.usageEventType === "reservation_expired" && command.reasonCode === "reservation_expired") {
      return { operation: "expiry", eventType: "reservation_released" };
    }
  }
  if (command.kind === "reversal") {
    const eventType = command.usageEventType;
    if (["refund_adjustment", "chargeback_adjustment", "manual_correction"].includes(eventType)) {
      return { operation: "reversal", eventType: eventType as PersistedCollectionUsageEventType };
    }
  }
  return null;
}

function uniqueById<T extends { id: string }>(rows: readonly T[]): boolean {
  return new Set(rows.map((row) => row.id)).size === rows.length;
}

function resolveMatchingReservation(
  command: Extract<CollectionLimitCommandPayload, { kind: "commit" | "release" | "reversal" }>,
  reservations: readonly PersistedCollectionReservation[],
): PersistedCollectionReservation | CollectionLimitPersistenceRejectReason {
  if (reservations.length === 0) return "limit_reservation_missing";
  if (reservations.length !== 1 || !uniqueById(reservations)) return "limit_reservation_ambiguous";
  const reservation = reservations[0];
  if (reservation.id !== command.reservationId
    || reservation.merchantId !== command.merchantId
    || reservation.profileId !== command.profileId
    || reservation.internalReference !== command.internalReference
    || reservation.amountNgn !== command.amountNgn
    || reservation.currency !== command.currency) return "limit_reservation_identity_mismatch";
  if (!positiveVersion(reservation.rowVersion) || reservation.rowVersion !== command.expectedReservationRowVersion) return "limit_reservation_row_version_stale";
  const expectedStatus = command.kind === "reversal" ? "committed" : "reserved";
  if (reservation.status !== expectedStatus) return "limit_reservation_status_invalid";
  return reservation;
}

/**
 * Validates trusted snapshots before a future transport executes its one
 * transaction. It does not create a transaction, client, query, or write.
 */
export function prepareCollectionLimitEnginePersistence(
  command: CollectionLimitCommandPayload | null,
  context: CollectionLimitServiceRoleContext | null,
  snapshot: CollectionLimitEnginePersistenceSnapshot,
): CollectionLimitEnginePersistenceResult {
  if (!command) return { kind: "rejected", diagnostics: [{ code: "limit_persistence_command_missing" }] };
  if (!serviceRoleAllowed(context)) return { kind: "rejected", diagnostics: [{ code: "limit_persistence_context_denied" }] };
  if (!validCommand(command)) return { kind: "rejected", diagnostics: [{ code: "limit_persistence_payload_invalid" }] };
  const target = resolvePersistedUsageEvent(command);
  if (!target) return { kind: "rejected", diagnostics: [{ code: "limit_persistence_payload_invalid" }] };

  if (snapshot.events.length > 1 || !uniqueById(snapshot.events)) return { kind: "rejected", diagnostics: [{ code: "limit_event_ambiguous" }] };
  if (snapshot.events.length === 1) {
    return target.eventType && replayMatchesEvent(snapshot.events[0], command, target.eventType)
      ? { kind: "replay", diagnostics: [{ code: "limit_idempotent_replay" }] }
      : { kind: "rejected", diagnostics: [{ code: "limit_replay_inconsistent" }] };
  }

  if (command.kind === "limit_approval") {
    if (snapshot.windows.length > 1 || !uniqueById(snapshot.windows)) return { kind: "rejected", diagnostics: [{ code: "limit_window_ambiguous" }] };
    if (snapshot.windows.length === 1 && (!positiveVersion(snapshot.windows[0].rowVersion) || snapshot.windows[0].rowVersion !== command.expectedWindowRowVersion)) {
      return { kind: "rejected", diagnostics: [{ code: "limit_window_row_version_stale" }] };
    }
    return { kind: "ready", operation: target.operation, persistedUsageEventType: null, diagnostics: [] };
  }

  if (command.kind === "reservation") {
    if (snapshot.windows.length === 0) return { kind: "rejected", diagnostics: [{ code: "limit_window_missing" }] };
    if (!uniqueById(snapshot.windows)) return { kind: "rejected", diagnostics: [{ code: "limit_window_ambiguous" }] };
    const commandWindowIds = new Set(command.windows.map((window) => window.windowId));
    if (commandWindowIds.size !== command.windows.length || snapshot.windows.length !== commandWindowIds.size) return { kind: "rejected", diagnostics: [{ code: "limit_window_ambiguous" }] };
    for (const window of snapshot.windows) {
      const expected = command.windows.find((item) => item.windowId === window.id);
      if (!expected) return { kind: "rejected", diagnostics: [{ code: "limit_window_missing" }] };
      if (window.lifecycle !== "active") return { kind: "rejected", diagnostics: [{ code: "limit_window_not_reservable" }] };
      if (!positiveVersion(window.rowVersion) || window.rowVersion !== expected.expectedRowVersion) return { kind: "rejected", diagnostics: [{ code: "limit_window_row_version_stale" }] };
    }
    return { kind: "ready", operation: target.operation, persistedUsageEventType: null, diagnostics: [] };
  }

  const reservation = resolveMatchingReservation(command, snapshot.reservations);
  if (typeof reservation === "string") return { kind: "rejected", diagnostics: [{ code: reservation }] };
  const links = snapshot.links.filter((link) => link.reservationId === reservation.id);
  if (links.length === 0) return { kind: "rejected", diagnostics: [{ code: "limit_link_missing" }] };
  if (new Set(links.map((link) => link.windowId)).size !== links.length) return { kind: "rejected", diagnostics: [{ code: "limit_link_ambiguous" }] };
  return { kind: "ready", operation: target.operation, persistedUsageEventType: target.eventType, diagnostics: [] };
}
