import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

const RPC_NAME = "reconcile_canonical_merchant_workspace_link_v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CanonicalWorkspaceRpcRow = {
  result_code?: unknown;
  merchant_id?: unknown;
  workspace_id?: unknown;
  link_version?: unknown;
};

export type CanonicalWorkspaceReconciliationResult = {
  kind: "created" | "replayed" | "existing_exact_link";
  merchantId: string;
  workspaceId: string | null;
  linkVersion: 1 | null;
};

export type CanonicalWorkspaceReconciliationErrorCode =
  | "INVALID_SERVER_IDENTITY"
  | "MERCHANT_NOT_FOUND"
  | "RECONCILER_NOT_FOUND"
  | "WORKSPACE_REQUIRED"
  | "MULTIPLE_WORKSPACES"
  | "IDEMPOTENCY_CONFLICT"
  | "CANONICAL_LINK_CONFLICT"
  | "RECONCILIATION_FAILED"
  | "DATA_ACCESS_ERROR"
  | "INVALID_RPC_RESULT";

const ERROR_MESSAGES: Record<CanonicalWorkspaceReconciliationErrorCode, string> = {
  INVALID_SERVER_IDENTITY: "Canonical workspace reconciliation requires valid server-derived identities.",
  MERCHANT_NOT_FOUND: "Canonical workspace reconciliation requires an existing merchant.",
  RECONCILER_NOT_FOUND: "Canonical workspace reconciliation requires an existing authoritative user.",
  WORKSPACE_REQUIRED: "Canonical workspace reconciliation requires exactly one merchant workspace.",
  MULTIPLE_WORKSPACES: "Canonical workspace reconciliation is blocked by multiple merchant workspaces.",
  IDEMPOTENCY_CONFLICT: "Canonical workspace reconciliation encountered an idempotency conflict.",
  CANONICAL_LINK_CONFLICT: "Canonical workspace reconciliation encountered a conflicting canonical link.",
  RECONCILIATION_FAILED: "Canonical workspace reconciliation failed safely.",
  DATA_ACCESS_ERROR: "Canonical workspace reconciliation could not access its bounded data contract.",
  INVALID_RPC_RESULT: "Canonical workspace reconciliation returned an invalid bounded result.",
};

export class CanonicalWorkspaceReconciliationError extends Error {
  constructor(public readonly code: CanonicalWorkspaceReconciliationErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "CanonicalWorkspaceReconciliationError";
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isNullish(value: unknown) {
  return value === null || value === undefined;
}

function isVersionOne(value: unknown) {
  return value === 1 || value === "1";
}

function requireTargetMerchant(value: unknown, merchantId: string) {
  if (value !== merchantId) {
    throw new CanonicalWorkspaceReconciliationError("INVALID_RPC_RESULT");
  }
}

function requireNullResultFields(row: CanonicalWorkspaceRpcRow) {
  if (!isNullish(row.merchant_id) || !isNullish(row.workspace_id) || !isNullish(row.link_version)) {
    throw new CanonicalWorkspaceReconciliationError("INVALID_RPC_RESULT");
  }
}

function parseSuccessfulResult(
  row: CanonicalWorkspaceRpcRow,
  merchantId: string,
  kind: "created" | "replayed",
): CanonicalWorkspaceReconciliationResult {
  requireTargetMerchant(row.merchant_id, merchantId);
  if (!isUuid(row.workspace_id) || !isVersionOne(row.link_version)) {
    throw new CanonicalWorkspaceReconciliationError("INVALID_RPC_RESULT");
  }
  return {
    kind,
    merchantId,
    workspaceId: row.workspace_id,
    linkVersion: 1,
  };
}

function parseRpcResult(data: unknown, merchantId: string): CanonicalWorkspaceReconciliationResult {
  if (!Array.isArray(data) || data.length !== 1 || typeof data[0] !== "object" || data[0] === null) {
    throw new CanonicalWorkspaceReconciliationError("INVALID_RPC_RESULT");
  }

  const row = data[0] as CanonicalWorkspaceRpcRow;
  const resultCode = typeof row.result_code === "string" ? row.result_code : "";

  switch (resultCode) {
    case "canonical_workspace_link_created":
      return parseSuccessfulResult(row, merchantId, "created");
    case "canonical_workspace_link_replay":
      return parseSuccessfulResult(row, merchantId, "replayed");
    case "canonical_workspace_link_idempotency_mismatch":
      if (row.merchant_id === merchantId && isNullish(row.workspace_id) && isNullish(row.link_version)) {
        // The frozen RPC returns this exact shape only when this merchant is
        // already linked to its sole workspace under an older key or actor.
        return {
          kind: "existing_exact_link",
          merchantId,
          workspaceId: null,
          linkVersion: null,
        };
      }
      requireNullResultFields(row);
      throw new CanonicalWorkspaceReconciliationError("IDEMPOTENCY_CONFLICT");
    case "canonical_workspace_link_payload_invalid":
      requireNullResultFields(row);
      throw new CanonicalWorkspaceReconciliationError("INVALID_SERVER_IDENTITY");
    case "canonical_workspace_link_reconciler_invalid":
      requireNullResultFields(row);
      throw new CanonicalWorkspaceReconciliationError("RECONCILER_NOT_FOUND");
    case "canonical_workspace_link_merchant_missing":
      requireNullResultFields(row);
      throw new CanonicalWorkspaceReconciliationError("MERCHANT_NOT_FOUND");
    case "canonical_workspace_link_unavailable":
      requireTargetMerchant(row.merchant_id, merchantId);
      if (!isNullish(row.workspace_id) || !isNullish(row.link_version)) {
        throw new CanonicalWorkspaceReconciliationError("INVALID_RPC_RESULT");
      }
      throw new CanonicalWorkspaceReconciliationError("WORKSPACE_REQUIRED");
    case "canonical_workspace_link_ambiguous":
      requireTargetMerchant(row.merchant_id, merchantId);
      if (!isNullish(row.workspace_id) || !isNullish(row.link_version)) {
        throw new CanonicalWorkspaceReconciliationError("INVALID_RPC_RESULT");
      }
      throw new CanonicalWorkspaceReconciliationError("MULTIPLE_WORKSPACES");
    case "canonical_workspace_link_conflict":
      requireTargetMerchant(row.merchant_id, merchantId);
      if (!isNullish(row.workspace_id) || !isNullish(row.link_version)) {
        throw new CanonicalWorkspaceReconciliationError("INVALID_RPC_RESULT");
      }
      throw new CanonicalWorkspaceReconciliationError("CANONICAL_LINK_CONFLICT");
    case "canonical_workspace_link_failed":
      requireNullResultFields(row);
      throw new CanonicalWorkspaceReconciliationError("RECONCILIATION_FAILED");
    default:
      throw new CanonicalWorkspaceReconciliationError("INVALID_RPC_RESULT");
  }
}

function canonicalIdempotencyKey(merchantId: string) {
  return `canonical-workspace-link:v1:${merchantId}`;
}

export async function reconcileCanonicalWorkspaceForMerchant(
  serviceClient: SupabaseClient,
  input: {
    merchantId: string;
    reconciledBy: string;
  },
): Promise<CanonicalWorkspaceReconciliationResult> {
  if (!isUuid(input.merchantId) || !isUuid(input.reconciledBy)) {
    throw new CanonicalWorkspaceReconciliationError("INVALID_SERVER_IDENTITY");
  }

  const { data, error } = await serviceClient.rpc(RPC_NAME, {
    p_merchant_id: input.merchantId,
    p_reconciled_by: input.reconciledBy,
    p_reconcile_idempotency_key: canonicalIdempotencyKey(input.merchantId),
  });

  if (error) {
    throw new CanonicalWorkspaceReconciliationError("DATA_ACCESS_ERROR");
  }

  return parseRpcResult(data, input.merchantId);
}
