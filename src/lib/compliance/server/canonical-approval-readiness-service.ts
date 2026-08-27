import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import {
  ISSUE_CANONICAL_APPROVAL_DECISION_REQUEST_V2_RPC,
  READ_CANONICAL_APPROVAL_SNAPSHOT_V2_RPC,
  createCanonicalApprovalReadiness,
  type CanonicalApprovalIssueRpcRow,
  type CanonicalApprovalReadinessRpcTransport,
  type CanonicalApprovalReadinessReviewerResolver,
  type CanonicalApprovalSnapshotRpcRow,
  type IssueCanonicalApprovalReadinessCommand,
  type ReadCanonicalApprovalSnapshotCommand,
} from "../canonical-approval-readiness-core";

interface NarrowCanonicalApprovalRpcClient {
  rpc(functionName: typeof ISSUE_CANONICAL_APPROVAL_DECISION_REQUEST_V2_RPC, arguments_: {
    p_profile_id: string; p_reviewer_id: string; p_target_compliance_status: string; p_policy_version: string; p_reason_code: string | null;
  }): Promise<{ data: unknown; error: unknown | null }>;
  rpc(functionName: typeof READ_CANONICAL_APPROVAL_SNAPSHOT_V2_RPC, arguments_: { p_decision_request_id: string }): Promise<{ data: unknown; error: unknown | null }>;
}

export interface CanonicalApprovalReadinessServiceDependencies {
  /** Required server-session/RBAC seam; callers cannot pass reviewer authority to an operation. */
  reviewerResolver: CanonicalApprovalReadinessReviewerResolver;
  /** Test seam only; production keeps client construction private and narrow. */
  createServiceRoleRpcClient?: () => NarrowCanonicalApprovalRpcClient;
  environment?: Readonly<Record<string, string | undefined>>;
}

function nonEmpty(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function privateClient(environment: Readonly<Record<string, string | undefined>>): NarrowCanonicalApprovalRpcClient {
  const url = nonEmpty(environment.SUPABASE_URL) ?? nonEmpty(environment.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = nonEmpty(environment.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceKey) throw new Error("canonical_readiness_config_missing");
  try {
    return createSupabaseClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }) as unknown as NarrowCanonicalApprovalRpcClient;
  } catch {
    throw new Error("canonical_readiness_client_unavailable");
  }
}

function issueRows(data: unknown): readonly CanonicalApprovalIssueRpcRow[] {
  if (!Array.isArray(data)) throw new Error("canonical_readiness_response_invalid");
  return data as readonly CanonicalApprovalIssueRpcRow[];
}

function snapshotRows(data: unknown): readonly CanonicalApprovalSnapshotRpcRow[] {
  if (!Array.isArray(data)) throw new Error("canonical_readiness_response_invalid");
  return data as readonly CanonicalApprovalSnapshotRpcRow[];
}

function createPrivateTransport(dependencies: CanonicalApprovalReadinessServiceDependencies): CanonicalApprovalReadinessRpcTransport {
  const environment = dependencies.environment ?? process.env;
  const clientFactory = dependencies.createServiceRoleRpcClient ?? (() => privateClient(environment));
  return {
    async issueCanonicalApprovalDecisionRequestV2(functionName, arguments_) {
      if (functionName !== ISSUE_CANONICAL_APPROVAL_DECISION_REQUEST_V2_RPC) throw new Error("canonical_readiness_rpc_denied");
      const response = await clientFactory().rpc(ISSUE_CANONICAL_APPROVAL_DECISION_REQUEST_V2_RPC, arguments_);
      if (response.error) throw new Error("canonical_readiness_rpc_failed");
      return issueRows(response.data);
    },
    async readCanonicalApprovalSnapshotV2(functionName, arguments_) {
      if (functionName !== READ_CANONICAL_APPROVAL_SNAPSHOT_V2_RPC) throw new Error("canonical_readiness_rpc_denied");
      const response = await clientFactory().rpc(READ_CANONICAL_APPROVAL_SNAPSHOT_V2_RPC, arguments_);
      if (response.error) throw new Error("canonical_readiness_rpc_failed");
      return snapshotRows(response.data);
    },
  };
}

/**
 * Narrow server facade. It exposes only M030 readiness issue/read operations,
 * never a generic client, table surface, or approval-decision operation.
 */
export function createCanonicalApprovalReadinessService(
  dependencies: CanonicalApprovalReadinessServiceDependencies,
): Pick<ReturnType<typeof createCanonicalApprovalReadiness>, "issue" | "readSnapshot"> {
  return createCanonicalApprovalReadiness({ transport: createPrivateTransport(dependencies), reviewerResolver: dependencies.reviewerResolver });
}
