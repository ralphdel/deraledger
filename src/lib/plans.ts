// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

export type CanonicalPlanCode = "starter" | "solo_lite" | "solo_plus" | "business";
export type LegacyPlanCode =
  | "starter"
  | "individual"
  | "solo_lite"
  | "solo_plus"
  | "corporate"
  | "business";
export type CapabilityPlanCode = "starter" | "individual" | "corporate";

export const PLAN_ALIASES: Record<string, CanonicalPlanCode> = {
  starter: "starter",
  individual: "solo_lite",
  solo_lite: "solo_lite",
  solo_plus: "solo_plus",
  corporate: "business",
  business: "business",
};

export const PLAN_CATALOG: Record<
  CanonicalPlanCode,
  {
    displayName: string;
    priceNgn: number;
    priceLabel: string;
    monthlyPriceLabel: string;
    storageCode: LegacyPlanCode;
    capabilityCode: CapabilityPlanCode;
    routeSegment: string;
    requiresVerificationDisclosure: boolean;
  }
> = {
  starter: {
    displayName: "Starter",
    priceNgn: 0,
    priceLabel: "Free",
    monthlyPriceLabel: "Free",
    storageCode: "starter",
    capabilityCode: "starter",
    routeSegment: "starter",
    requiresVerificationDisclosure: false,
  },
  solo_lite: {
    displayName: "Solo Lite",
    priceNgn: 5000,
    priceLabel: "NGN 5,000",
    monthlyPriceLabel: "₦5,000/month",
    storageCode: "individual",
    capabilityCode: "individual",
    routeSegment: "individual",
    requiresVerificationDisclosure: true,
  },
  solo_plus: {
    displayName: "Solo Plus",
    priceNgn: 13000,
    priceLabel: "NGN 13,000",
    monthlyPriceLabel: "₦13,000/month",
    storageCode: "solo_plus",
    capabilityCode: "individual",
    routeSegment: "solo_plus",
    requiresVerificationDisclosure: true,
  },
  business: {
    displayName: "Business",
    priceNgn: 20000,
    priceLabel: "NGN 20,000",
    monthlyPriceLabel: "₦20,000/month",
    storageCode: "corporate",
    capabilityCode: "corporate",
    routeSegment: "corporate",
    requiresVerificationDisclosure: true,
  },
};

const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);
export type PlanAvailabilityFlags = Partial<Record<CanonicalPlanCode, boolean>> & {
  solo_plus_kyc?: boolean;
};

export function normalizePlanCode(plan: string | null | undefined): CanonicalPlanCode {
  const normalized = String(plan || "").trim().toLowerCase();
  return PLAN_ALIASES[normalized] || "starter";
}

export function normalizeCapabilityPlanCode(
  plan: string | null | undefined,
): CapabilityPlanCode {
  return PLAN_CATALOG[normalizePlanCode(plan)].capabilityCode;
}

export function getStoragePlanCode(plan: string | null | undefined): LegacyPlanCode {
  return PLAN_CATALOG[normalizePlanCode(plan)].storageCode;
}

export function getPlanDisplayName(plan: string | null | undefined): string {
  return PLAN_CATALOG[normalizePlanCode(plan)].displayName;
}

export function getPlanPrice(plan: string | null | undefined): number {
  return PLAN_CATALOG[normalizePlanCode(plan)].priceNgn;
}

export function getPlanPriceKobo(plan: string | null | undefined): number {
  return getPlanPrice(plan) * 100;
}

export function getPlanPriceLabel(plan: string | null | undefined): string {
  return PLAN_CATALOG[normalizePlanCode(plan)].priceLabel;
}

export function getPlanMonthlyPriceLabel(plan: string | null | undefined): string {
  return PLAN_CATALOG[normalizePlanCode(plan)].monthlyPriceLabel;
}

export function getPlanRouteSegment(plan: string | null | undefined): string {
  return PLAN_CATALOG[normalizePlanCode(plan)].routeSegment;
}

export function requiresPlanVerificationDisclosure(plan: string | null | undefined): boolean {
  return PLAN_CATALOG[normalizePlanCode(plan)].requiresVerificationDisclosure;
}

export function isPlanAvailable(
  plan: string | null | undefined,
  flags?: PlanAvailabilityFlags,
): boolean {
  const normalized = normalizePlanCode(plan);
  if (normalized === "solo_plus") {
    return flags?.solo_plus === true && flags.solo_plus_kyc === true;
  }
  return true;
}

export async function getPlanAvailabilityFlags(
  adminClient: SupabaseClient,
): Promise<Record<CanonicalPlanCode, boolean> & { solo_plus_kyc: boolean }> {
  const { data } = await adminClient
    .from("platform_settings")
    .select("key, value")
    .in("key", ["solo_plus_enabled", "solo_plus_kyc_enabled"]);

  const map = new Map((data || []).map((row: { key: string; value: string }) => [row.key, row.value]));
  return {
    starter: true,
    solo_lite: true,
    solo_plus: TRUE_VALUES.has(String(map.get("solo_plus_enabled") || "").toLowerCase()),
    solo_plus_kyc: TRUE_VALUES.has(
      String(map.get("solo_plus_kyc_enabled") || "").toLowerCase(),
    ),
    business: true,
  };
}

export async function assertPlanAvailable(
  adminClient: SupabaseClient,
  plan: string | null | undefined,
): Promise<{ ok: true; plan: CanonicalPlanCode } | { ok: false; plan: CanonicalPlanCode }> {
  const normalized = normalizePlanCode(plan);
  const flags = await getPlanAvailabilityFlags(adminClient);
  return isPlanAvailable(normalized, flags)
    ? { ok: true, plan: normalized }
    : { ok: false, plan: normalized };
}

export async function logPlanMigration(
  adminClient: SupabaseClient,
  params: {
    merchantId: string;
    sourceTable: "merchants" | "subscriptions" | "workspace_subscriptions" | "subscription_payments";
    sourceRecordId?: string | null;
    oldPlanCode: string | null | undefined;
    context?: string | null;
  },
) {
  const rawOldPlan = String(params.oldPlanCode || "").trim().toLowerCase();
  const normalizedPlan = normalizePlanCode(rawOldPlan);
  const isAliasMigration = rawOldPlan === "individual" || rawOldPlan === "corporate";

  if (!isAliasMigration) {
    return { logged: false, reason: "not_alias" as const };
  }

  const newPlanCode = normalizedPlan;
  const migrationKey = [
    params.merchantId,
    params.sourceTable,
    params.sourceRecordId || "none",
    rawOldPlan,
    newPlanCode,
    "compatibility_alias",
  ].join(":");

  const payload = {
    merchant_id: params.merchantId,
    source_table: params.sourceTable,
    source_record_id: params.sourceRecordId || null,
    old_plan_code: rawOldPlan,
    new_plan_code: newPlanCode,
    migration_type: "compatibility_alias",
    migration_key: migrationKey,
    metadata_json: {
      context: params.context || null,
    },
  };

  const { error } = await adminClient.from("plan_migrations").upsert(payload, {
    onConflict: "migration_key",
  });

  if (error) {
    console.warn("[Plans] Plan migration log skipped:", error.message);
    return { logged: false, reason: "error" as const, error: error.message };
  }

  return { logged: true };
}
