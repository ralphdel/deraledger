import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  reconcileCanonicalWorkspaceForMerchant,
  type CanonicalWorkspaceReconciliationResult,
} from "./canonical-workspace-reconciliation";

type EligiblePlan = "solo_lite" | "business";

type RecoveryMerchant = {
  id: string;
  user_id: string | null;
  subscription_plan: string | null;
};

type RecoverySubscription = {
  plan_type: string | null;
  status: string | null;
};

type RecoveryWorkspace = {
  id: string;
  merchant_id: string | null;
};

export interface CanonicalWorkspaceRecoveryRepository {
  findMerchant(merchantId: string): Promise<RecoveryMerchant | null>;
  findSubscription(merchantId: string): Promise<RecoverySubscription | null>;
  listWorkspaces(merchantId: string): Promise<RecoveryWorkspace[]>;
  reconcile(input: {
    merchantId: string;
    reconciledBy: string;
  }): Promise<CanonicalWorkspaceReconciliationResult>;
}

export type CanonicalWorkspaceRecoveryErrorCode =
  | "MERCHANT_NOT_FOUND"
  | "MERCHANT_NOT_ELIGIBLE"
  | "SUBSCRIPTION_NOT_ACTIVE"
  | "SUBSCRIPTION_PLAN_MISMATCH"
  | "WORKSPACE_REQUIRED"
  | "MULTIPLE_WORKSPACES"
  | "WORKSPACE_OWNERSHIP_MISMATCH"
  | "DATA_ACCESS_ERROR";

const RECOVERY_ERROR_MESSAGES: Record<CanonicalWorkspaceRecoveryErrorCode, string> = {
  MERCHANT_NOT_FOUND: "Canonical workspace recovery requires an existing merchant.",
  MERCHANT_NOT_ELIGIBLE: "Canonical workspace recovery is limited to eligible paid merchants.",
  SUBSCRIPTION_NOT_ACTIVE: "Canonical workspace recovery requires an active subscription.",
  SUBSCRIPTION_PLAN_MISMATCH: "Canonical workspace recovery requires matching merchant and subscription plans.",
  WORKSPACE_REQUIRED: "Canonical workspace recovery requires exactly one merchant workspace.",
  MULTIPLE_WORKSPACES: "Canonical workspace recovery is blocked by multiple merchant workspaces.",
  WORKSPACE_OWNERSHIP_MISMATCH: "Canonical workspace recovery rejected a workspace ownership mismatch.",
  DATA_ACCESS_ERROR: "Canonical workspace recovery could not access its bounded data contract.",
};

export class CanonicalWorkspaceRecoveryError extends Error {
  constructor(public readonly code: CanonicalWorkspaceRecoveryErrorCode) {
    super(RECOVERY_ERROR_MESSAGES[code]);
    this.name = "CanonicalWorkspaceRecoveryError";
  }
}

function eligiblePlan(value: string | null): EligiblePlan | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "individual" || normalized === "solo_lite") return "solo_lite";
  if (normalized === "corporate" || normalized === "business") return "business";
  return null;
}

export async function recoverCanonicalWorkspaceForEligibleMerchant(
  repository: CanonicalWorkspaceRecoveryRepository,
  merchantId: string,
) {
  const [merchant, subscription, workspaces] = await Promise.all([
    repository.findMerchant(merchantId),
    repository.findSubscription(merchantId),
    repository.listWorkspaces(merchantId),
  ]);

  if (!merchant || merchant.id !== merchantId || !merchant.user_id) {
    throw new CanonicalWorkspaceRecoveryError("MERCHANT_NOT_FOUND");
  }

  const merchantPlan = eligiblePlan(merchant.subscription_plan);
  if (!merchantPlan) {
    throw new CanonicalWorkspaceRecoveryError("MERCHANT_NOT_ELIGIBLE");
  }

  if (!subscription || subscription.status?.trim().toLowerCase() !== "active") {
    throw new CanonicalWorkspaceRecoveryError("SUBSCRIPTION_NOT_ACTIVE");
  }

  if (eligiblePlan(subscription.plan_type) !== merchantPlan) {
    throw new CanonicalWorkspaceRecoveryError("SUBSCRIPTION_PLAN_MISMATCH");
  }

  if (workspaces.length === 0) {
    throw new CanonicalWorkspaceRecoveryError("WORKSPACE_REQUIRED");
  }
  if (workspaces.length !== 1) {
    throw new CanonicalWorkspaceRecoveryError("MULTIPLE_WORKSPACES");
  }
  if (workspaces[0]?.merchant_id !== merchantId) {
    throw new CanonicalWorkspaceRecoveryError("WORKSPACE_OWNERSHIP_MISMATCH");
  }

  return repository.reconcile({
    merchantId,
    reconciledBy: merchant.user_id,
  });
}

export function createSupabaseCanonicalWorkspaceRecoveryRepository(
  serviceClient: SupabaseClient,
): CanonicalWorkspaceRecoveryRepository {
  return {
    async findMerchant(merchantId) {
      const { data, error } = await serviceClient
        .from("merchants")
        .select("id,user_id,subscription_plan")
        .eq("id", merchantId)
        .maybeSingle();
      if (error) throw new CanonicalWorkspaceRecoveryError("DATA_ACCESS_ERROR");
      return data as RecoveryMerchant | null;
    },
    async findSubscription(merchantId) {
      const { data, error } = await serviceClient
        .from("subscriptions")
        .select("plan_type,status")
        .eq("merchant_id", merchantId)
        .maybeSingle();
      if (error) throw new CanonicalWorkspaceRecoveryError("DATA_ACCESS_ERROR");
      return data as RecoverySubscription | null;
    },
    async listWorkspaces(merchantId) {
      const { data, error } = await serviceClient
        .from("workspaces")
        .select("id,merchant_id")
        .eq("merchant_id", merchantId);
      if (error) throw new CanonicalWorkspaceRecoveryError("DATA_ACCESS_ERROR");
      return (data ?? []) as RecoveryWorkspace[];
    },
    reconcile(input) {
      return reconcileCanonicalWorkspaceForMerchant(serviceClient, input);
    },
  };
}
