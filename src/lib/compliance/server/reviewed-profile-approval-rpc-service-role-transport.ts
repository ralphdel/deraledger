import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import {
  REVIEW_COMPLIANCE_PROFILE_DECISION_RPC,
  type ReviewedProfileApprovalRpcArguments,
  type ReviewedProfileApprovalRpcRow,
  type ReviewedProfileApprovalRpcTransport,
} from "../compliance-profile-approval-rpc-client-core";

/** Private, narrow shape retained solely to make source-only tests injectable. */
interface ApprovalDecisionRpcClient {
  rpc(
    functionName: typeof REVIEW_COMPLIANCE_PROFILE_DECISION_RPC,
    arguments_: ReviewedProfileApprovalRpcArguments,
  ): Promise<{ data: unknown; error: unknown | null }>;
}

export type ReviewedProfileApprovalServiceRoleTransportReasonCode =
  | "approval_service_role_config_missing"
  | "approval_service_role_client_unavailable"
  | "approval_service_role_rpc_failed"
  | "approval_service_role_response_invalid";

export class ReviewedProfileApprovalServiceRoleTransportError extends Error {
  readonly code: ReviewedProfileApprovalServiceRoleTransportReasonCode;

  constructor(code: ReviewedProfileApprovalServiceRoleTransportReasonCode) {
    super(code);
    this.name = "ReviewedProfileApprovalServiceRoleTransportError";
    this.code = code;
  }
}

export interface ReviewedProfileApprovalServiceRoleTransportDependencies {
  /** Test-only seam; production leaves this unset and uses the private factory. */
  createServiceRoleRpcClient?: () => ApprovalDecisionRpcClient;
  environment?: Readonly<Record<string, string | undefined>>;
}

function requireNonEmpty(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function createPrivateServiceRoleRpcClient(
  environment: Readonly<Record<string, string | undefined>>,
): ApprovalDecisionRpcClient {
  const url = requireNonEmpty(environment.SUPABASE_URL) ?? requireNonEmpty(environment.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = requireNonEmpty(environment.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceRoleKey) {
    throw new ReviewedProfileApprovalServiceRoleTransportError("approval_service_role_config_missing");
  }
  try {
    return createSupabaseClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    }) as unknown as ApprovalDecisionRpcClient;
  } catch {
    throw new ReviewedProfileApprovalServiceRoleTransportError("approval_service_role_client_unavailable");
  }
}

function isRpcRow(value: unknown): value is ReviewedProfileApprovalRpcRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.result_code === "string"
    && (typeof row.profile_id === "string" || row.profile_id === null)
    && (typeof row.event_id === "string" || row.event_id === null)
    && (typeof row.resulting_row_version === "number" || row.resulting_row_version === null);
}

function responseRows(value: unknown): readonly ReviewedProfileApprovalRpcRow[] {
  if (!Array.isArray(value) || !value.every(isRpcRow)) {
    throw new ReviewedProfileApprovalServiceRoleTransportError("approval_service_role_response_invalid");
  }
  return value;
}

/**
 * Creates the only compliance-owned transport capable of invoking the approval
 * RPC. It exports neither the client nor generic query/RPC/table capabilities.
 * Construction performs no network/database work; the RPC runs only when its
 * single adapter-contract method is invoked by a separately approved caller.
 */
export function createReviewedProfileApprovalServiceRoleTransport(
  dependencies: ReviewedProfileApprovalServiceRoleTransportDependencies = {},
): ReviewedProfileApprovalRpcTransport {
  const environment = dependencies.environment ?? process.env;
  const createClient = dependencies.createServiceRoleRpcClient
    ?? (() => createPrivateServiceRoleRpcClient(environment));

  return {
    async callApprovalDecisionRpc(functionName, arguments_) {
      if (functionName !== REVIEW_COMPLIANCE_PROFILE_DECISION_RPC) {
        throw new ReviewedProfileApprovalServiceRoleTransportError("approval_service_role_rpc_failed");
      }
      let client: ApprovalDecisionRpcClient;
      try {
        client = createClient();
      } catch (error) {
        if (error instanceof ReviewedProfileApprovalServiceRoleTransportError) throw error;
        throw new ReviewedProfileApprovalServiceRoleTransportError("approval_service_role_client_unavailable");
      }
      try {
        const response = await client.rpc(REVIEW_COMPLIANCE_PROFILE_DECISION_RPC, arguments_);
        if (response.error) {
          throw new ReviewedProfileApprovalServiceRoleTransportError("approval_service_role_rpc_failed");
        }
        return responseRows(response.data);
      } catch (error) {
        if (error instanceof ReviewedProfileApprovalServiceRoleTransportError) throw error;
        throw new ReviewedProfileApprovalServiceRoleTransportError("approval_service_role_rpc_failed");
      }
    },
  };
}
