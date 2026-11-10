import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

const RPC_NAME = "ensure_draft_compliance_profile_v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type EligibleProfilePlan = "solo_lite" | "business";

type RpcResult = {
  kind?: unknown;
  merchant_id?: unknown;
  profile_id?: unknown;
  plan_code?: unknown;
  row_version?: unknown;
};

export type DraftComplianceProfileProvisioningResult = {
  kind: "created" | "existing_exact";
  merchantId: string;
  profileId: string;
  plan: EligibleProfilePlan;
  rowVersion: 1;
};

export type DraftComplianceProfileProvisioningErrorCode =
  | "INVALID_SERVER_IDENTITY"
  | "MERCHANT_NOT_FOUND"
  | "OWNER_REQUIRED"
  | "PLAN_NOT_ELIGIBLE"
  | "SUBSCRIPTION_INACTIVE"
  | "SUBSCRIPTION_PLAN_MISMATCH"
  | "CANONICAL_WORKSPACE_REQUIRED"
  | "CANONICAL_WORKSPACE_CONFLICT"
  | "EXISTING_PROFILE_CONFLICT"
  | "STATE_INCOMPATIBLE"
  | "DATA_ACCESS_ERROR"
  | "INVALID_RPC_RESULT";

const ERROR_MESSAGES: Record<DraftComplianceProfileProvisioningErrorCode, string> = {
  INVALID_SERVER_IDENTITY: "Draft compliance profile provisioning requires a valid server-derived merchant identity.",
  MERCHANT_NOT_FOUND: "Draft compliance profile provisioning requires an existing merchant.",
  OWNER_REQUIRED: "Draft compliance profile provisioning requires an authoritative merchant owner.",
  PLAN_NOT_ELIGIBLE: "Draft compliance profile provisioning is limited to eligible plans.",
  SUBSCRIPTION_INACTIVE: "Draft compliance profile provisioning requires an active subscription.",
  SUBSCRIPTION_PLAN_MISMATCH: "Draft compliance profile provisioning requires matching merchant and subscription plans.",
  CANONICAL_WORKSPACE_REQUIRED: "Draft compliance profile provisioning requires a canonical workspace.",
  CANONICAL_WORKSPACE_CONFLICT: "Draft compliance profile provisioning rejected a conflicting canonical workspace.",
  EXISTING_PROFILE_CONFLICT: "Draft compliance profile provisioning preserved a conflicting or stronger existing profile.",
  STATE_INCOMPATIBLE: "Draft compliance profile provisioning rejected incompatible persisted state.",
  DATA_ACCESS_ERROR: "Draft compliance profile provisioning could not access its bounded data contract.",
  INVALID_RPC_RESULT: "Draft compliance profile provisioning returned an invalid bounded result.",
};

export class DraftComplianceProfileProvisioningError extends Error {
  constructor(public readonly code: DraftComplianceProfileProvisioningErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "DraftComplianceProfileProvisioningError";
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function requiredMerchant(row: RpcResult, merchantId: string) {
  if (row.merchant_id !== merchantId) {
    throw new DraftComplianceProfileProvisioningError("INVALID_RPC_RESULT");
  }
}

function parseSuccess(
  row: RpcResult,
  merchantId: string,
  kind: DraftComplianceProfileProvisioningResult["kind"],
): DraftComplianceProfileProvisioningResult {
  requiredMerchant(row, merchantId);
  if (
    !isUuid(row.profile_id)
    || (row.plan_code !== "solo_lite" && row.plan_code !== "business")
    || (row.row_version !== 1 && row.row_version !== "1")
  ) {
    throw new DraftComplianceProfileProvisioningError("INVALID_RPC_RESULT");
  }
  return {
    kind,
    merchantId,
    profileId: row.profile_id,
    plan: row.plan_code,
    rowVersion: 1,
  };
}

function parseRpcResult(data: unknown, merchantId: string): DraftComplianceProfileProvisioningResult {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new DraftComplianceProfileProvisioningError("INVALID_RPC_RESULT");
  }
  const row = data as RpcResult;
  const kind = typeof row.kind === "string" ? row.kind : "";
  switch (kind) {
    case "draft_profile_created":
      return parseSuccess(row, merchantId, "created");
    case "draft_profile_existing_exact":
      return parseSuccess(row, merchantId, "existing_exact");
    case "draft_profile_merchant_missing":
      requiredMerchant(row, merchantId);
      throw new DraftComplianceProfileProvisioningError("MERCHANT_NOT_FOUND");
    case "draft_profile_owner_required":
      requiredMerchant(row, merchantId);
      throw new DraftComplianceProfileProvisioningError("OWNER_REQUIRED");
    case "draft_profile_plan_not_eligible":
      requiredMerchant(row, merchantId);
      throw new DraftComplianceProfileProvisioningError("PLAN_NOT_ELIGIBLE");
    case "draft_profile_subscription_inactive":
      requiredMerchant(row, merchantId);
      throw new DraftComplianceProfileProvisioningError("SUBSCRIPTION_INACTIVE");
    case "draft_profile_subscription_plan_mismatch":
      requiredMerchant(row, merchantId);
      throw new DraftComplianceProfileProvisioningError("SUBSCRIPTION_PLAN_MISMATCH");
    case "draft_profile_canonical_workspace_missing":
      requiredMerchant(row, merchantId);
      throw new DraftComplianceProfileProvisioningError("CANONICAL_WORKSPACE_REQUIRED");
    case "draft_profile_canonical_workspace_conflict":
      requiredMerchant(row, merchantId);
      throw new DraftComplianceProfileProvisioningError("CANONICAL_WORKSPACE_CONFLICT");
    case "draft_profile_existing_conflict":
      requiredMerchant(row, merchantId);
      throw new DraftComplianceProfileProvisioningError("EXISTING_PROFILE_CONFLICT");
    case "draft_profile_state_incompatible":
      if (row.merchant_id !== undefined) requiredMerchant(row, merchantId);
      throw new DraftComplianceProfileProvisioningError("STATE_INCOMPATIBLE");
    default:
      throw new DraftComplianceProfileProvisioningError("INVALID_RPC_RESULT");
  }
}

export async function ensureDraftComplianceProfileForEligibleMerchant(
  serviceClient: SupabaseClient,
  input: { merchantId: string },
): Promise<DraftComplianceProfileProvisioningResult> {
  if (!isUuid(input.merchantId)) {
    throw new DraftComplianceProfileProvisioningError("INVALID_SERVER_IDENTITY");
  }

  const { data, error } = await serviceClient.rpc(RPC_NAME, {
    p_merchant_id: input.merchantId,
  });
  if (error) {
    throw new DraftComplianceProfileProvisioningError("DATA_ACCESS_ERROR");
  }
  return parseRpcResult(data, input.merchantId);
}
