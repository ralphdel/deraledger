import { resolveMerchantCapabilities } from "./merchant-capabilities";
import type {
  MerchantCapabilityBlockingReasonCode,
  MerchantCapabilities,
} from "./merchant-capabilities";
import type {
  TrustedRuntimeCapabilityLoaderResult,
} from "./trusted-runtime-capability-loader-core";

export type ShadowRouteClass =
  | "collection_invoice"
  | "checkout_preflight"
  | "provider_collection_preflight"
  | "instant_sale"
  | "receivable_sale"
  | "storefront_checkout";

export type ExistingGateOutcome = "allow" | "deny" | "not_evaluated";
export type ResolverOutcome = "allow" | "deny" | "incomplete" | "source_error";
export type ShadowComparisonCode =
  | "agree_allow"
  | "agree_deny"
  | "existing_allow_resolver_deny"
  | "existing_deny_resolver_allow"
  | "source_incomplete"
  | "source_error";
export type ShadowTimingBucket = "under_50ms" | "under_250ms" | "under_1000ms" | "over_1000ms";

export interface ExistingGateDecision<T> {
  outcome: ExistingGateOutcome;
  reasonCodes?: readonly string[];
  /** The observer returns this opaque value by reference and never inspects it. */
  value: T;
}

export interface ShadowCapabilityObservationEvent {
  schemaVersion: "shadow_capability_observation_v1";
  correlationId: string;
  merchantHash: string | null;
  workspaceHash: string | null;
  routeClass: ShadowRouteClass;
  existingGateOutcome: ExistingGateOutcome;
  resolverOutcome: ResolverOutcome;
  comparison: ShadowComparisonCode;
  entitlementState:
    | "starter_free" | "active_paid" | "grace_read_only" | "inactive"
    | "expired" | "cancelled" | "missing" | "conflicting";
  normalizedPlanClass: "starter" | "solo_lite" | "solo_plus" | "business" | "unknown";
  reasonCodes: readonly string[];
  timingBucket: ShadowTimingBucket;
}

export interface ShadowCapabilityObserverConfig {
  /** Default false. When false, no loader or logger call is made. */
  enabled?: boolean;
  /** Emergency stop. When true, no loader or logger call is made. */
  killSwitchActive?: boolean;
  /** Sampling is an explicit independent opt-in. */
  sampled?: boolean;
  timeoutMs?: number;
}

export interface ObserveShadowCapabilityInput<T> {
  config?: ShadowCapabilityObserverConfig;
  correlationId: string;
  routeClass: ShadowRouteClass;
  existingGate: ExistingGateDecision<T>;
  trustedMerchantId?: string | null;
  trustedWorkspaceId?: string | null;
  /** This function must resolve trusted server identity through the injected loader. */
  load: () => Promise<TrustedRuntimeCapabilityLoaderResult>;
  hashIdentifier?: (identifier: string) => string | null | undefined;
  emit?: (event: ShadowCapabilityObservationEvent) => void | Promise<void>;
  now?: () => number;
}

export interface ShadowCapabilityObservationResult<T> {
  /** Always the exact original gate object; this module has no authority to change it. */
  existingGate: ExistingGateDecision<T>;
  observation: "not_run" | "emitted" | "failed_silent";
}

const EXISTING_GATE_REASON_CODES = new Set([
  "plan_gate", "rbac_gate", "verification_gate", "setup_gate", "live_feature_gate",
  "settlement_gate", "invoice_type_gate", "unknown_existing_deny",
]);

const LOADER_DIAGNOSTIC_CODES = new Set([
  "trusted_identity_missing", "merchant_workspace_missing", "merchant_workspace_query_error",
  "commercial_entitlement_missing", "commercial_entitlement_query_error", "commercial_entitlement_conflicting",
  "compliance_profile_missing", "compliance_profile_ambiguous", "compliance_profile_query_error",
  "merchant_entitlements_missing", "global_feature_flags_missing", "global_feature_flags_query_error",
  "collection_limit_missing", "collection_limit_query_error", "payout_readiness_missing",
  "payout_readiness_query_error", "provider_mapping_missing", "provider_mapping_query_error",
  "operational_state_disagreement", "operational_state_missing", "operational_state_query_error",
  "observer_timeout", "observer_loader_error", "observer_emit_error",
]);

const RESOLVER_REASON_CODES = new Set<MerchantCapabilityBlockingReasonCode>([
  "unknown_plan", "commercial_entitlement_missing", "commercial_entitlement_read_only",
  "commercial_entitlement_inactive", "commercial_entitlement_expired", "commercial_entitlement_cancelled",
  "commercial_entitlement_conflicting", "commercial_entitlement_plan_invalid", "starter_plan",
  "compliance_status_missing", "lite_verification_required", "enhanced_verification_required",
  "business_verification_required", "activation_status_missing", "final_approval_required", "risk_rating_missing",
  "risk_review_required", "restriction_state_missing", "merchant_restricted", "merchant_suspended",
  "setup_mode_missing", "setup_mode_active", "live_features_state_missing", "live_features_disabled",
  "feature_flags_missing", "merchant_entitlements_missing", "collection_entitlement_missing",
  "collection_entitlement_disabled", "settlement_activation_entitlement_missing",
  "settlement_activation_entitlement_disabled", "settlement_readiness_missing", "payout_account_not_verified",
  "settlement_mapping_not_ready", "collection_limit_missing", "collection_limit_not_approved",
  "collection_limit_invalid", "collection_limit_reached", "storefront_flag_missing", "storefront_disabled",
  "storefront_entitlement_missing", "storefront_entitlement_disabled", "instant_sale_flag_missing",
  "instant_sale_disabled", "instant_sale_entitlement_missing", "instant_sale_entitlement_disabled",
  "receivable_sale_not_in_plan", "receivable_sale_flag_missing", "receivable_sale_disabled",
  "receivable_sale_entitlement_missing", "receivable_sale_entitlement_disabled",
  "merchant_confirmation_flag_missing", "merchant_confirmation_disabled", "customer_registration_flag_missing",
  "customer_registration_not_required", "deposit_balance_entitlement_missing",
  "deposit_balance_entitlement_disabled",
]);

function timingBucket(elapsedMs: number): ShadowTimingBucket {
  if (elapsedMs < 50) return "under_50ms";
  if (elapsedMs < 250) return "under_250ms";
  if (elapsedMs < 1000) return "under_1000ms";
  return "over_1000ms";
}

function safeHash(identifier: string | null | undefined, hash?: (value: string) => string | null | undefined) {
  if (!identifier || !hash) return null;
  const candidate = hash(identifier);
  return typeof candidate === "string" && candidate.trim() && candidate !== identifier
    ? candidate.trim()
    : null;
}

function safeExistingReasons(reasons: readonly string[] | undefined): string[] {
  return (reasons ?? []).filter((reason) => EXISTING_GATE_REASON_CODES.has(reason));
}

function safeResolverReasons(capabilities: MerchantCapabilities): string[] {
  return capabilities.requiredBlockingReasons
    .map((reason) => reason.code)
    .filter((reason) => RESOLVER_REASON_CODES.has(reason));
}

function requestedCapabilityAllowed(routeClass: ShadowRouteClass, capabilities: MerchantCapabilities): boolean {
  switch (routeClass) {
    case "collection_invoice": return capabilities.canCreateCollectionInvoice;
    case "instant_sale": return capabilities.canUseInstantSale;
    case "receivable_sale": return capabilities.canUseReceivableSale;
    case "storefront_checkout": return capabilities.canUseLiveStorefront;
    case "checkout_preflight":
    case "provider_collection_preflight": return capabilities.canUseCheckout;
  }
}

function planClass(plan: MerchantCapabilities["normalizedPlan"], known: boolean) {
  return known && (plan === "starter" || plan === "solo_lite" || plan === "solo_plus" || plan === "business")
    ? plan
    : "unknown";
}

function comparisonFor(
  existing: ExistingGateOutcome,
  resolver: ResolverOutcome,
): ShadowComparisonCode {
  if (resolver === "source_error") return "source_error";
  if (resolver === "incomplete") return "source_incomplete";
  if (existing === "allow" && resolver === "allow") return "agree_allow";
  if (existing === "deny" && resolver === "deny") return "agree_deny";
  if (existing === "allow") return "existing_allow_resolver_deny";
  return "existing_deny_resolver_allow";
}

function timeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | "timeout"> {
  return Promise.race([
    promise,
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), timeoutMs)),
  ]);
}

async function emitSafely(
  emit: ObserveShadowCapabilityInput<unknown>["emit"],
  event: ShadowCapabilityObservationEvent,
): Promise<boolean> {
  if (!emit) return true;
  try {
    await emit(event);
    return true;
  } catch {
    return false;
  }
}

/**
 * Observation-only. It returns the current gate object unchanged regardless of
 * loader result, timeout, or logging failure.
 */
export async function observeShadowCapability<T>(
  input: ObserveShadowCapabilityInput<T>,
): Promise<ShadowCapabilityObservationResult<T>> {
  const existingGate = input.existingGate;
  const config = input.config ?? {};
  if (config.enabled !== true || config.killSwitchActive === true || config.sampled !== true) {
    return { existingGate, observation: "not_run" };
  }

  const now = input.now ?? (() => Date.now());
  const startedAt = now();
  const base = {
    schemaVersion: "shadow_capability_observation_v1" as const,
    correlationId: input.correlationId,
    merchantHash: safeHash(input.trustedMerchantId, input.hashIdentifier),
    workspaceHash: safeHash(input.trustedWorkspaceId, input.hashIdentifier),
    routeClass: input.routeClass,
    existingGateOutcome: existingGate.outcome,
  };

  try {
    const loaded = await timeout(input.load(), config.timeoutMs ?? 100);
    if (loaded === "timeout") {
      const emitted = await emitSafely(input.emit, {
        ...base,
        resolverOutcome: "source_error",
        comparison: "source_error",
        entitlementState: "missing",
        normalizedPlanClass: "unknown",
        reasonCodes: ["observer_timeout"],
        timingBucket: timingBucket(now() - startedAt),
      });
      return { existingGate, observation: emitted ? "emitted" : "failed_silent" };
    }

    const capabilities = resolveMerchantCapabilities(loaded.resolverInput);
    const resolverOutcome: ResolverOutcome = loaded.status === "source_error"
      ? "source_error"
      : loaded.status === "incomplete"
        ? "incomplete"
        : requestedCapabilityAllowed(input.routeClass, capabilities) ? "allow" : "deny";
    const reasonCodes = loaded.status === "source_error" || loaded.status === "incomplete"
      ? loaded.diagnostics.map((item) => item.code).filter((code) => LOADER_DIAGNOSTIC_CODES.has(code))
      : safeResolverReasons(capabilities);
    const emitted = await emitSafely(input.emit, {
      ...base,
      resolverOutcome,
      comparison: comparisonFor(existingGate.outcome, resolverOutcome),
      entitlementState: loaded.context.commercialEntitlementState,
      normalizedPlanClass: planClass(capabilities.normalizedPlan, capabilities.isKnownPlan),
      reasonCodes: [...new Set([...safeExistingReasons(existingGate.reasonCodes), ...reasonCodes])],
      timingBucket: timingBucket(now() - startedAt),
    });
    return { existingGate, observation: emitted ? "emitted" : "failed_silent" };
  } catch {
    const emitted = await emitSafely(input.emit, {
      ...base,
      resolverOutcome: "source_error",
      comparison: "source_error",
      entitlementState: "missing",
      normalizedPlanClass: "unknown",
      reasonCodes: ["observer_loader_error"],
      timingBucket: timingBucket(now() - startedAt),
    });
    return { existingGate, observation: emitted ? "emitted" : "failed_silent" };
  }
}
