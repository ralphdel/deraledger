import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ensureDraftComplianceProfileForEligibleMerchant,
  type DraftComplianceProfileProvisioningResult,
} from "./draft-compliance-profile-provisioning";

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

type CanonicalWorkspace = {
  merchant_id: string;
  workspace_id: string;
  workspaces: { id: string; merchant_id: string | null } | null;
};

type ExistingProfile = {
  id: string;
  merchant_id: string;
  plan_code: string;
  compliance_status: string;
  activation_status: string;
  row_version: number;
};

export interface DraftComplianceProfileRecoveryRepository {
  findMerchant(merchantId: string): Promise<RecoveryMerchant | null>;
  findSubscription(merchantId: string): Promise<RecoverySubscription | null>;
  findCanonicalWorkspace(merchantId: string): Promise<CanonicalWorkspace | null>;
  listProfiles(merchantId: string): Promise<ExistingProfile[]>;
  ensure(merchantId: string): Promise<DraftComplianceProfileProvisioningResult>;
}

export type DraftComplianceProfileRecoveryErrorCode =
  | "MERCHANT_NOT_FOUND"
  | "MERCHANT_NOT_ELIGIBLE"
  | "SUBSCRIPTION_NOT_ACTIVE"
  | "SUBSCRIPTION_PLAN_MISMATCH"
  | "CANONICAL_WORKSPACE_REQUIRED"
  | "CANONICAL_WORKSPACE_CONFLICT"
  | "MULTIPLE_PROFILES"
  | "EXISTING_PROFILE_CONFLICT"
  | "DATA_ACCESS_ERROR";

const ERROR_MESSAGES: Record<DraftComplianceProfileRecoveryErrorCode, string> = {
  MERCHANT_NOT_FOUND: "Draft compliance profile recovery requires an existing merchant owner.",
  MERCHANT_NOT_ELIGIBLE: "Draft compliance profile recovery is limited to eligible paid merchants.",
  SUBSCRIPTION_NOT_ACTIVE: "Draft compliance profile recovery requires an active subscription.",
  SUBSCRIPTION_PLAN_MISMATCH: "Draft compliance profile recovery requires matching merchant and subscription plans.",
  CANONICAL_WORKSPACE_REQUIRED: "Draft compliance profile recovery requires an existing canonical workspace.",
  CANONICAL_WORKSPACE_CONFLICT: "Draft compliance profile recovery rejected a canonical workspace ownership conflict.",
  MULTIPLE_PROFILES: "Draft compliance profile recovery rejected invalid profile cardinality.",
  EXISTING_PROFILE_CONFLICT: "Draft compliance profile recovery preserved a conflicting existing profile.",
  DATA_ACCESS_ERROR: "Draft compliance profile recovery could not access its bounded data contract.",
};

export class DraftComplianceProfileRecoveryError extends Error {
  constructor(public readonly code: DraftComplianceProfileRecoveryErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "DraftComplianceProfileRecoveryError";
  }
}

function eligiblePlan(value: string | null): EligiblePlan | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "individual" || normalized === "solo_lite") return "solo_lite";
  if (normalized === "corporate" || normalized === "business") return "business";
  return null;
}

export async function recoverDraftComplianceProfileForEligibleMerchant(
  repository: DraftComplianceProfileRecoveryRepository,
  merchantId: string,
) {
  const [merchant, subscription, canonicalWorkspace, profiles] = await Promise.all([
    repository.findMerchant(merchantId),
    repository.findSubscription(merchantId),
    repository.findCanonicalWorkspace(merchantId),
    repository.listProfiles(merchantId),
  ]);

  if (!merchant || merchant.id !== merchantId || !merchant.user_id) {
    throw new DraftComplianceProfileRecoveryError("MERCHANT_NOT_FOUND");
  }

  const merchantPlan = eligiblePlan(merchant.subscription_plan);
  if (!merchantPlan) {
    throw new DraftComplianceProfileRecoveryError("MERCHANT_NOT_ELIGIBLE");
  }
  if (!subscription || subscription.status?.trim().toLowerCase() !== "active") {
    throw new DraftComplianceProfileRecoveryError("SUBSCRIPTION_NOT_ACTIVE");
  }
  if (eligiblePlan(subscription.plan_type) !== merchantPlan) {
    throw new DraftComplianceProfileRecoveryError("SUBSCRIPTION_PLAN_MISMATCH");
  }

  if (!canonicalWorkspace) {
    throw new DraftComplianceProfileRecoveryError("CANONICAL_WORKSPACE_REQUIRED");
  }
  if (
    canonicalWorkspace.merchant_id !== merchantId
    || canonicalWorkspace.workspaces?.id !== canonicalWorkspace.workspace_id
    || canonicalWorkspace.workspaces.merchant_id !== merchantId
  ) {
    throw new DraftComplianceProfileRecoveryError("CANONICAL_WORKSPACE_CONFLICT");
  }

  if (profiles.length > 1) {
    throw new DraftComplianceProfileRecoveryError("MULTIPLE_PROFILES");
  }
  if (profiles.length === 1) {
    const profile = profiles[0];
    if (
      profile.merchant_id !== merchantId
      || profile.plan_code !== merchantPlan
      || profile.compliance_status !== "draft"
      || profile.activation_status !== "test_mode"
      || profile.row_version !== 1
    ) {
      throw new DraftComplianceProfileRecoveryError("EXISTING_PROFILE_CONFLICT");
    }
  }

  return repository.ensure(merchantId);
}

export function createSupabaseDraftComplianceProfileRecoveryRepository(
  serviceClient: SupabaseClient,
): DraftComplianceProfileRecoveryRepository {
  return {
    async findMerchant(merchantId) {
      const { data, error } = await serviceClient
        .from("merchants")
        .select("id,user_id,subscription_plan")
        .eq("id", merchantId)
        .maybeSingle();
      if (error) throw new DraftComplianceProfileRecoveryError("DATA_ACCESS_ERROR");
      return data as RecoveryMerchant | null;
    },
    async findSubscription(merchantId) {
      const { data, error } = await serviceClient
        .from("subscriptions")
        .select("plan_type,status")
        .eq("merchant_id", merchantId)
        .maybeSingle();
      if (error) throw new DraftComplianceProfileRecoveryError("DATA_ACCESS_ERROR");
      return data as RecoverySubscription | null;
    },
    async findCanonicalWorkspace(merchantId) {
      const { data, error } = await serviceClient
        .from("merchant_canonical_workspaces")
        .select("merchant_id,workspace_id,workspaces!inner(id,merchant_id)")
        .eq("merchant_id", merchantId)
        .maybeSingle();
      if (error) throw new DraftComplianceProfileRecoveryError("DATA_ACCESS_ERROR");
      return data as unknown as CanonicalWorkspace | null;
    },
    async listProfiles(merchantId) {
      const { data, error } = await serviceClient
        .from("merchant_compliance_profiles")
        .select("id,merchant_id,plan_code,compliance_status,activation_status,row_version")
        .eq("merchant_id", merchantId);
      if (error) throw new DraftComplianceProfileRecoveryError("DATA_ACCESS_ERROR");
      return (data ?? []) as ExistingProfile[];
    },
    ensure(merchantId) {
      return ensureDraftComplianceProfileForEligibleMerchant(serviceClient, { merchantId });
    },
  };
}
