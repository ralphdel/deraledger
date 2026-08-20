import {
  buildTrustedRuntimeCapabilityContext,
  toResolveMerchantCapabilitiesInput,
  type TrustedRuntimeCapabilityContext,
} from "./runtime-capability-context";
import { PLAN_ALIASES, normalizePlanCode } from "@/lib/plans";
import type {
  MerchantCapabilityEntitlements,
  MerchantCapabilityFeatureFlags,
  MerchantCollectionLimitProfile,
  MerchantSettlementReadiness,
  ResolveMerchantCapabilitiesInput,
} from "./merchant-capabilities";

/**
 * This is the testable implementation behind the server-only loader facade.
 * It deliberately accepts only values returned by server-side adapters. It has
 * no Supabase, request, provider, or browser dependency.
 */

export type TrustedRuntimeCapabilityReadResult<T> =
  | { kind: "found"; value: T }
  | { kind: "missing" }
  | { kind: "error" };

export interface LoadTrustedRuntimeCapabilityContextRequest {
  /** Derived by a future caller from trusted server auth.getUser(). */
  authenticatedUserId: string;
}

export interface TrustedMerchantWorkspace {
  authenticatedUserId: string;
  merchantId: string;
  workspaceId: string;
  relationship: "owner" | "team_member";
}

export interface CommercialEntitlementRecord {
  plan: string | null;
  status: string | null;
  expiresAt: string | null;
}

export interface WorkspaceCommercialEntitlementRecord {
  plan: string | null;
  status: string | null;
}

export interface CommercialEntitlementSnapshot {
  merchantPlan: string | null;
  workspacePlan: string | null;
  subscriptions: readonly CommercialEntitlementRecord[];
  workspaceSubscriptions: readonly WorkspaceCommercialEntitlementRecord[];
  /** Reserved for a future explicitly-reviewed grace policy. */
  graceReadOnly?: boolean | null;
}

export interface MerchantComplianceProfileSnapshot {
  complianceStatus: string | null;
  activationStatus: string | null;
  riskRating: string | null;
  restrictionState: string | null;
  approvedMonthlyVolumeNgn: number | null;
  cumulativeCollectionCapNgn: number | null;
  cumulativeCollectionUsedNgn: number | null;
  hiddenDailyVelocityLimitNgn: number | null;
  singleTransactionLimitNgn: number | null;
  merchantEntitlements: MerchantCapabilityEntitlements | null;
  soloPlusEnhancedVerificationStatus: string | null;
  businessKybVerificationStatus: string | null;
}

export interface CollectionLimitStateSnapshot {
  collectionLimit: MerchantCollectionLimitProfile | null;
}

export interface PayoutReadinessSnapshot {
  payoutAccountVerified: boolean | null;
}

export type TrustedCollectionProvider = "paystack" | "monnify" | "breet";
export type TrustedPaymentEnvironment = "sandbox" | "live";

export interface ProviderSettlementReadinessSnapshot {
  providerMappingReady: boolean | null;
  /** Both pairs come from trusted server-side routing/mapping adapters. */
  selectedProvider: TrustedCollectionProvider | null;
  selectedEnvironment: TrustedPaymentEnvironment | null;
  mappingProvider: TrustedCollectionProvider | null;
  mappingEnvironment: TrustedPaymentEnvironment | null;
}

export interface MerchantWorkspaceOperationalStateSnapshot {
  merchantSetupMode: boolean | null;
  workspaceSetupMode: boolean | null;
  merchantLiveFeaturesEnabled: boolean | null;
  workspaceLiveFeaturesEnabled: boolean | null;
}

/**
 * Every adapter is expected to scope its query to the already-resolved
 * merchant/workspace pair. No browser-selected merchant, plan, provider, or
 * payment metadata appears in this contract.
 */
export interface TrustedRuntimeCapabilityLoaderRepository {
  resolveTrustedMerchantWorkspace(input: {
    authenticatedUserId: string;
  }): Promise<TrustedRuntimeCapabilityReadResult<TrustedMerchantWorkspace>>;
  loadCommercialEntitlement(input: {
    merchantId: string;
    workspaceId: string;
  }): Promise<TrustedRuntimeCapabilityReadResult<CommercialEntitlementSnapshot>>;
  loadComplianceProfiles(input: {
    merchantId: string;
  }): Promise<TrustedRuntimeCapabilityReadResult<readonly MerchantComplianceProfileSnapshot[]>>;
  loadGlobalFeatureFlags(): Promise<
    TrustedRuntimeCapabilityReadResult<MerchantCapabilityFeatureFlags>
  >;
  loadCollectionLimitState(input: {
    merchantId: string;
    workspaceId: string;
  }): Promise<TrustedRuntimeCapabilityReadResult<CollectionLimitStateSnapshot>>;
  loadPayoutReadiness(input: {
    merchantId: string;
  }): Promise<TrustedRuntimeCapabilityReadResult<PayoutReadinessSnapshot>>;
  loadProviderSettlementReadiness(input: {
    merchantId: string;
    workspaceId: string;
  }): Promise<TrustedRuntimeCapabilityReadResult<ProviderSettlementReadinessSnapshot>>;
  loadOperationalState(input: {
    merchantId: string;
    workspaceId: string;
  }): Promise<TrustedRuntimeCapabilityReadResult<MerchantWorkspaceOperationalStateSnapshot>>;
}

export type TrustedRuntimeCapabilityDiagnosticCode =
  | "trusted_identity_missing"
  | "merchant_workspace_missing"
  | "merchant_workspace_query_error"
  | "commercial_entitlement_missing"
  | "commercial_entitlement_query_error"
  | "commercial_entitlement_conflicting"
  | "compliance_profile_missing"
  | "compliance_profile_ambiguous"
  | "compliance_profile_query_error"
  | "merchant_entitlements_missing"
  | "global_feature_flags_missing"
  | "global_feature_flags_query_error"
  | "collection_limit_missing"
  | "collection_limit_query_error"
  | "payout_readiness_missing"
  | "payout_readiness_query_error"
  | "provider_mapping_missing"
  | "provider_mapping_query_error"
  | "operational_state_disagreement"
  | "operational_state_missing"
  | "operational_state_query_error";

export interface TrustedRuntimeCapabilityDiagnostic {
  code: TrustedRuntimeCapabilityDiagnosticCode;
}

export interface TrustedRuntimeCapabilityLoaderResult {
  status: "ready" | "incomplete" | "source_error";
  context: TrustedRuntimeCapabilityContext;
  resolverInput: ResolveMerchantCapabilitiesInput;
  diagnostics: readonly TrustedRuntimeCapabilityDiagnostic[];
}

export interface TrustedRuntimeCapabilityLoaderOptions {
  now?: () => Date;
}

interface CommercialEntitlementResolution {
  state:
    | "starter_free"
    | "active_paid"
    | "grace_read_only"
    | "inactive"
    | "expired"
    | "cancelled"
    | "missing"
    | "conflicting";
  commercialPlan: string | null;
  activeEntitlementPlan: string | null;
  diagnostic?: TrustedRuntimeCapabilityDiagnosticCode;
}

function normalizedText(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized || null;
}

function normalizedPlan(value: string | null | undefined): string | null {
  const plan = normalizedText(value);
  return plan && Object.prototype.hasOwnProperty.call(PLAN_ALIASES, plan)
    ? normalizePlanCode(plan)
    : null;
}

function normalizedStatus(value: string | null | undefined): string | null {
  return normalizedText(value);
}

function hasExpired(expiresAt: string | null, now: Date): boolean {
  if (!expiresAt) return false;
  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) && timestamp <= now.getTime();
}

function isInDateActive(record: CommercialEntitlementRecord, now: Date): boolean {
  if (normalizedStatus(record.status) !== "active" || !record.expiresAt) return false;
  const timestamp = Date.parse(record.expiresAt);
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

function resolveCommercialEntitlement(
  snapshot: CommercialEntitlementSnapshot,
  now: Date,
): CommercialEntitlementResolution {
  const merchantPlan = normalizedPlan(snapshot.merchantPlan);
  const workspacePlan = normalizedPlan(snapshot.workspacePlan);
  const subscriptions = snapshot.subscriptions;
  const workspaceSubscriptions = snapshot.workspaceSubscriptions;

  if (!merchantPlan || !workspacePlan) {
    return { state: "missing", commercialPlan: null, activeEntitlementPlan: null };
  }
  if (merchantPlan !== workspacePlan) {
    return {
      state: "conflicting",
      commercialPlan: null,
      activeEntitlementPlan: null,
      diagnostic: "commercial_entitlement_conflicting",
    };
  }
  if (snapshot.graceReadOnly === true) {
    return { state: "grace_read_only", commercialPlan: null, activeEntitlementPlan: null };
  }
  if (subscriptions.some((record) => normalizedStatus(record.status) === "cancelled") ||
      workspaceSubscriptions.some((record) => normalizedStatus(record.status) === "cancelled")) {
    return { state: "cancelled", commercialPlan: null, activeEntitlementPlan: null };
  }
  if (subscriptions.some((record) => hasExpired(record.expiresAt, now))) {
    return { state: "expired", commercialPlan: null, activeEntitlementPlan: null };
  }

  const activeSubscriptions = subscriptions.filter((record) => isInDateActive(record, now));
  const activeWorkspaceSubscriptions = workspaceSubscriptions.filter(
    (record) => normalizedStatus(record.status) === "active",
  );
  if (activeSubscriptions.length > 1 || activeWorkspaceSubscriptions.length > 1) {
    return {
      state: "conflicting",
      commercialPlan: null,
      activeEntitlementPlan: null,
      diagnostic: "commercial_entitlement_conflicting",
    };
  }
  if (activeSubscriptions.length === 1 || activeWorkspaceSubscriptions.length === 1) {
    const subscriptionPlan = activeSubscriptions[0]
      ? normalizedPlan(activeSubscriptions[0].plan)
      : null;
    const workspaceSubscriptionPlan = activeWorkspaceSubscriptions[0]
      ? normalizedPlan(activeWorkspaceSubscriptions[0].plan)
      : null;
    if (
      !subscriptionPlan ||
      !workspaceSubscriptionPlan ||
      subscriptionPlan === "starter" ||
      workspaceSubscriptionPlan === "starter" ||
      subscriptionPlan !== workspaceSubscriptionPlan ||
      subscriptionPlan !== merchantPlan
    ) {
      return {
        state: "conflicting",
        commercialPlan: null,
        activeEntitlementPlan: null,
        diagnostic: "commercial_entitlement_conflicting",
      };
    }
    return {
      state: "active_paid",
      commercialPlan: merchantPlan,
      activeEntitlementPlan: subscriptionPlan,
    };
  }
  if (subscriptions.length > 0 || workspaceSubscriptions.length > 0) {
    return { state: "inactive", commercialPlan: null, activeEntitlementPlan: null };
  }
  if (merchantPlan === "starter") {
    return { state: "starter_free", commercialPlan: "starter", activeEntitlementPlan: null };
  }
  return { state: "missing", commercialPlan: null, activeEntitlementPlan: null };
}

function emptyResult(
  status: "incomplete" | "source_error",
  diagnostics: readonly TrustedRuntimeCapabilityDiagnostic[],
  merchantWorkspace?: TrustedMerchantWorkspace,
) : TrustedRuntimeCapabilityLoaderResult {
  const context = buildTrustedRuntimeCapabilityContext({
    merchantId: merchantWorkspace?.merchantId ?? null,
    workspaceId: merchantWorkspace?.workspaceId ?? null,
    commercialEntitlementState: "missing",
  });
  return {
    status,
    context,
    resolverInput: toResolveMerchantCapabilitiesInput(context),
    diagnostics,
  };
}

async function readSafely<T>(
  read: () => Promise<TrustedRuntimeCapabilityReadResult<T>>,
): Promise<TrustedRuntimeCapabilityReadResult<T>> {
  try {
    return await read();
  } catch {
    return { kind: "error" };
  }
}

function resolveOperationalValue(
  merchantValue: boolean | null,
  workspaceValue: boolean | null,
): boolean | null {
  return typeof merchantValue === "boolean" && merchantValue === workspaceValue
    ? merchantValue
    : null;
}

function hasExactProviderSettlementMapping(
  readiness: ProviderSettlementReadinessSnapshot,
): boolean {
  return readiness.providerMappingReady === true
    && readiness.selectedProvider !== null
    && readiness.selectedEnvironment !== null
    && readiness.selectedProvider === readiness.mappingProvider
    && readiness.selectedEnvironment === readiness.mappingEnvironment;
}

/**
 * Loads a resolver-ready context from injected, trusted repository adapters.
 * It is read-only: it never calls a provider, writes a limit reservation, or
 * synchronizes merchant setup/live state.
 */
export async function loadTrustedRuntimeCapabilityContext(
  repository: TrustedRuntimeCapabilityLoaderRepository,
  request: LoadTrustedRuntimeCapabilityContextRequest,
  options: TrustedRuntimeCapabilityLoaderOptions = {},
): Promise<TrustedRuntimeCapabilityLoaderResult> {
  if (!request.authenticatedUserId.trim()) {
    return emptyResult("incomplete", [{ code: "trusted_identity_missing" }]);
  }

  const merchantWorkspaceResult = await readSafely(() =>
    repository.resolveTrustedMerchantWorkspace({
      authenticatedUserId: request.authenticatedUserId,
    }),
  );
  if (merchantWorkspaceResult.kind === "error") {
    return emptyResult("source_error", [{ code: "merchant_workspace_query_error" }]);
  }
  if (merchantWorkspaceResult.kind === "missing") {
    return emptyResult("incomplete", [{ code: "merchant_workspace_missing" }]);
  }
  const merchantWorkspace = merchantWorkspaceResult.value;
  if (
    merchantWorkspace.authenticatedUserId !== request.authenticatedUserId ||
    !merchantWorkspace.merchantId.trim() ||
    !merchantWorkspace.workspaceId.trim()
  ) {
    return emptyResult("incomplete", [{ code: "merchant_workspace_missing" }]);
  }

  const scopedInput = {
    merchantId: merchantWorkspace.merchantId,
    workspaceId: merchantWorkspace.workspaceId,
  };
  const commercialResult = await readSafely(() =>
    repository.loadCommercialEntitlement(scopedInput),
  );
  if (commercialResult.kind === "error") {
    return emptyResult(
      "source_error",
      [{ code: "commercial_entitlement_query_error" }],
      merchantWorkspace,
    );
  }
  if (commercialResult.kind === "missing") {
    return emptyResult(
      "incomplete",
      [{ code: "commercial_entitlement_missing" }],
      merchantWorkspace,
    );
  }

  const profilesResult = await readSafely(() =>
    repository.loadComplianceProfiles({ merchantId: merchantWorkspace.merchantId }),
  );
  if (profilesResult.kind === "error") {
    return emptyResult(
      "source_error",
      [{ code: "compliance_profile_query_error" }],
      merchantWorkspace,
    );
  }
  const featureFlagsResult = await readSafely(() => repository.loadGlobalFeatureFlags());
  if (featureFlagsResult.kind === "error") {
    return emptyResult(
      "source_error",
      [{ code: "global_feature_flags_query_error" }],
      merchantWorkspace,
    );
  }
  const limitResult = await readSafely(() => repository.loadCollectionLimitState(scopedInput));
  if (limitResult.kind === "error") {
    return emptyResult(
      "source_error",
      [{ code: "collection_limit_query_error" }],
      merchantWorkspace,
    );
  }
  const payoutResult = await readSafely(() =>
    repository.loadPayoutReadiness({ merchantId: merchantWorkspace.merchantId }),
  );
  if (payoutResult.kind === "error") {
    return emptyResult(
      "source_error",
      [{ code: "payout_readiness_query_error" }],
      merchantWorkspace,
    );
  }
  const providerResult = await readSafely(() =>
    repository.loadProviderSettlementReadiness(scopedInput),
  );
  if (providerResult.kind === "error") {
    return emptyResult(
      "source_error",
      [{ code: "provider_mapping_query_error" }],
      merchantWorkspace,
    );
  }
  const operationalResult = await readSafely(() => repository.loadOperationalState(scopedInput));
  if (operationalResult.kind === "error") {
    return emptyResult(
      "source_error",
      [{ code: "operational_state_query_error" }],
      merchantWorkspace,
    );
  }

  const diagnostics: TrustedRuntimeCapabilityDiagnostic[] = [];
  const entitlement = resolveCommercialEntitlement(
    commercialResult.value,
    (options.now ?? (() => new Date()))(),
  );
  if (entitlement.diagnostic) diagnostics.push({ code: entitlement.diagnostic });

  let profile: MerchantComplianceProfileSnapshot | null = null;
  if (profilesResult.kind === "missing" || profilesResult.value.length === 0) {
    diagnostics.push({ code: "compliance_profile_missing" });
  } else if (profilesResult.value.length !== 1) {
    diagnostics.push({ code: "compliance_profile_ambiguous" });
  } else {
    profile = profilesResult.value[0];
    if (!profile.merchantEntitlements) {
      diagnostics.push({ code: "merchant_entitlements_missing" });
    }
  }

  if (featureFlagsResult.kind === "missing") {
    diagnostics.push({ code: "global_feature_flags_missing" });
  }
  if (limitResult.kind === "missing" || !limitResult.value.collectionLimit) {
    diagnostics.push({ code: "collection_limit_missing" });
  }
  if (payoutResult.kind === "missing" || payoutResult.value.payoutAccountVerified !== true) {
    diagnostics.push({ code: "payout_readiness_missing" });
  }
  if (
    providerResult.kind === "missing" ||
    !hasExactProviderSettlementMapping(providerResult.value)
  ) {
    diagnostics.push({ code: "provider_mapping_missing" });
  }

  const operational = operationalResult.kind === "found" ? operationalResult.value : null;
  const setupMode = operational
    ? resolveOperationalValue(operational.merchantSetupMode, operational.workspaceSetupMode)
    : null;
  const liveFeaturesEnabled = operational
    ? resolveOperationalValue(
        operational.merchantLiveFeaturesEnabled,
        operational.workspaceLiveFeaturesEnabled,
      )
    : null;
  if (!operational) {
    diagnostics.push({ code: "operational_state_missing" });
  } else if (setupMode === null || liveFeaturesEnabled === null) {
    diagnostics.push({ code: "operational_state_disagreement" });
  }

  const settlementReadiness: MerchantSettlementReadiness | null =
    payoutResult.kind === "found" && providerResult.kind === "found"
      ? {
          payoutAccountVerified: payoutResult.value.payoutAccountVerified,
          providerMappingReady: hasExactProviderSettlementMapping(providerResult.value),
        }
      : null;
  const context = buildTrustedRuntimeCapabilityContext({
    merchantId: merchantWorkspace.merchantId,
    workspaceId: merchantWorkspace.workspaceId,
    commercialPlan: entitlement.commercialPlan,
    commercialEntitlementState: entitlement.state,
    activeEntitlementPlan: entitlement.activeEntitlementPlan,
    setupMode,
    liveFeaturesEnabled,
    complianceStatus: profile?.complianceStatus ?? null,
    activationStatus: profile?.activationStatus ?? null,
    riskRating: profile?.riskRating ?? null,
    restrictionState: profile?.restrictionState ?? null,
    approvedMonthlyVolumeNgn: profile?.approvedMonthlyVolumeNgn ?? null,
    cumulativeCollectionCapNgn: profile?.cumulativeCollectionCapNgn ?? null,
    cumulativeCollectionUsedNgn: profile?.cumulativeCollectionUsedNgn ?? null,
    hiddenDailyVelocityLimitNgn: profile?.hiddenDailyVelocityLimitNgn ?? null,
    singleTransactionLimitNgn: profile?.singleTransactionLimitNgn ?? null,
    collectionLimit: limitResult.kind === "found" ? limitResult.value.collectionLimit : null,
    featureFlags: featureFlagsResult.kind === "found" ? featureFlagsResult.value : null,
    merchantEntitlements: profile?.merchantEntitlements ?? null,
    settlementReadiness,
    soloPlusEnhancedVerificationStatus: profile?.soloPlusEnhancedVerificationStatus ?? null,
    businessKybVerificationStatus: profile?.businessKybVerificationStatus ?? null,
  });
  return {
    status: diagnostics.length === 0 ? "ready" : "incomplete",
    context,
    resolverInput: toResolveMerchantCapabilitiesInput(context),
    diagnostics,
  };
}
