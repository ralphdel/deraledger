import "server-only";

// Keep the production entry point server-only. The adjacent core module is
// intentionally dependency-injected so its fail-closed mapping can be tested
// without a browser, Supabase client, provider call, or database connection.
export {
  loadTrustedRuntimeCapabilityContext,
  type CollectionLimitStateSnapshot,
  type CommercialEntitlementRecord,
  type CommercialEntitlementSnapshot,
  type LoadTrustedRuntimeCapabilityContextRequest,
  type MerchantComplianceProfileSnapshot,
  type MerchantWorkspaceOperationalStateSnapshot,
  type PayoutReadinessSnapshot,
  type ProviderSettlementReadinessSnapshot,
  type TrustedMerchantWorkspace,
  type TrustedRuntimeCapabilityDiagnostic,
  type TrustedRuntimeCapabilityDiagnosticCode,
  type TrustedRuntimeCapabilityLoaderOptions,
  type TrustedRuntimeCapabilityLoaderRepository,
  type TrustedRuntimeCapabilityLoaderResult,
  type TrustedRuntimeCapabilityReadResult,
  type TrustedCollectionProvider,
  type TrustedPaymentEnvironment,
  type WorkspaceCommercialEntitlementRecord,
} from "./trusted-runtime-capability-loader-core";
