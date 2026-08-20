import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { resolveMerchantCapabilities } from "../src/lib/compliance/merchant-capabilities";
import {
  loadTrustedRuntimeCapabilityContext,
  type TrustedRuntimeCapabilityLoaderRepository,
  type TrustedRuntimeCapabilityReadResult,
} from "../src/lib/compliance/trusted-runtime-capability-loader-core";

const found = <T>(value: T): TrustedRuntimeCapabilityReadResult<T> => ({
  kind: "found",
  value,
});

function baseRepository(): TrustedRuntimeCapabilityLoaderRepository {
  return {
    async resolveTrustedMerchantWorkspace() {
      return found({
        authenticatedUserId: "user-1",
        merchantId: "merchant-1",
        workspaceId: "workspace-1",
        relationship: "owner" as const,
      });
    },
    async loadCommercialEntitlement() {
      return found({
        merchantPlan: "individual",
        workspacePlan: "solo_lite",
        subscriptions: [
          { plan: "solo_lite", status: "active", expiresAt: "2027-01-01T00:00:00.000Z" },
        ],
        workspaceSubscriptions: [{ plan: "individual", status: "active" }],
      });
    },
    async loadComplianceProfiles() {
      return found([
        {
          complianceStatus: "lite_verified",
          activationStatus: "approved",
          riskRating: "low",
          restrictionState: "active",
          approvedMonthlyVolumeNgn: 5_000_000,
          cumulativeCollectionCapNgn: 8_000_000,
          cumulativeCollectionUsedNgn: 250_000,
          hiddenDailyVelocityLimitNgn: 250_000,
          singleTransactionLimitNgn: 100_000,
          merchantEntitlements: {
            canCollectPayments: true,
            canUseInstantSale: true,
            canUseReceivableSale: true,
            canUseStorefront: true,
            canActivateSettlement: true,
            canUseDepositBalance: true,
          },
          soloPlusEnhancedVerificationStatus: null,
          businessKybVerificationStatus: null,
        },
      ]);
    },
    async loadGlobalFeatureFlags() {
      return found({
        storefrontEnabled: true,
        instantSaleEnabled: true,
        receivableSaleEnabled: true,
        merchantConfirmationBeforeDepositEnabled: true,
        customerRegistrationRequiredForReceivables: true,
      });
    },
    async loadCollectionLimitState() {
      return found({
        collectionLimit: {
          basis: "cumulative" as const,
          limitNgn: 8_000_000,
          usedNgn: 250_000,
          approved: true,
        },
      });
    },
    async loadPayoutReadiness() {
      return found({ payoutAccountVerified: true });
    },
    async loadProviderSettlementReadiness() {
      return found({
        providerMappingReady: true,
        selectedProvider: "paystack",
        selectedEnvironment: "live",
        mappingProvider: "paystack",
        mappingEnvironment: "live",
      });
    },
    async loadOperationalState() {
      return found({
        merchantSetupMode: false,
        workspaceSetupMode: false,
        merchantLiveFeaturesEnabled: true,
        workspaceLiveFeaturesEnabled: true,
      });
    },
  };
}

function withRepository(
  overrides: Partial<TrustedRuntimeCapabilityLoaderRepository>,
): TrustedRuntimeCapabilityLoaderRepository {
  return { ...baseRepository(), ...overrides };
}

async function load(repository = baseRepository()) {
  return loadTrustedRuntimeCapabilityContext(
    repository,
    { authenticatedUserId: "user-1" },
    { now: () => new Date("2026-08-20T00:00:00.000Z") },
  );
}

function assertCollectionDenied(result: Awaited<ReturnType<typeof load>>) {
  const capabilities = resolveMerchantCapabilities(result.resolverInput);
  assert.equal(capabilities.canCreateCollectionInvoice, false);
  assert.equal(capabilities.canUseCheckout, false);
  assert.equal(capabilities.canCreateRecordInvoice, true);
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : /\.(?:ts|tsx)$/.test(entry.name)
        ? [path]
        : [];
  });
}

async function run() {
  const ready = await load();
  assert.equal(ready.status, "ready");
  assert.equal(ready.context.commercialPlan, "solo_lite");
  assert.equal(resolveMerchantCapabilities(ready.resolverInput).canCreateCollectionInvoice, true);

  for (const [name, entitlement] of [
    ["expired", { plan: "solo_lite", status: "active", expiresAt: "2026-08-19T00:00:00.000Z" }],
    ["cancelled", { plan: "solo_lite", status: "cancelled", expiresAt: null }],
  ] as const) {
    const result = await load(
      withRepository({
        async loadCommercialEntitlement() {
          return found({
            merchantPlan: "solo_lite",
            workspacePlan: "solo_lite",
            subscriptions: [entitlement],
            workspaceSubscriptions: [{ plan: "solo_lite", status: entitlement.status }],
          });
        },
      }),
    );
    assert.equal(result.context.commercialEntitlementState, name);
    assertCollectionDenied(result);
  }

  const conflicting = await load(
    withRepository({
      async loadCommercialEntitlement() {
        return found({
          merchantPlan: "solo_lite",
          workspacePlan: "solo_lite",
          subscriptions: [
            { plan: "solo_lite", status: "active", expiresAt: "2027-01-01T00:00:00.000Z" },
            { plan: "solo_lite", status: "active", expiresAt: "2027-02-01T00:00:00.000Z" },
          ],
          workspaceSubscriptions: [{ plan: "solo_lite", status: "active" }],
        });
      },
    }),
  );
  assert.equal(conflicting.context.commercialEntitlementState, "conflicting");
  assert.ok(conflicting.diagnostics.some((item) => item.code === "commercial_entitlement_conflicting"));
  assertCollectionDenied(conflicting);

  const missingEntitlement = await load(
    withRepository({
      async loadCommercialEntitlement() {
        return { kind: "missing" };
      },
    }),
  );
  assert.equal(missingEntitlement.status, "incomplete");
  assert.ok(missingEntitlement.diagnostics.some((item) => item.code === "commercial_entitlement_missing"));
  assertCollectionDenied(missingEntitlement);

  const graceReadOnly = await load(
    withRepository({
      async loadCommercialEntitlement() {
        return found({
          merchantPlan: "solo_lite",
          workspacePlan: "solo_lite",
          subscriptions: [],
          workspaceSubscriptions: [],
          graceReadOnly: true,
        });
      },
    }),
  );
  assert.equal(graceReadOnly.context.commercialEntitlementState, "grace_read_only");
  assertCollectionDenied(graceReadOnly);

  const activeWithoutVerifiableExpiry = await load(
    withRepository({
      async loadCommercialEntitlement() {
        return found({
          merchantPlan: "solo_lite",
          workspacePlan: "solo_lite",
          subscriptions: [{ plan: "solo_lite", status: "active", expiresAt: null }],
          workspaceSubscriptions: [{ plan: "solo_lite", status: "active" }],
        });
      },
    }),
  );
  assert.equal(activeWithoutVerifiableExpiry.context.commercialEntitlementState, "conflicting");
  assertCollectionDenied(activeWithoutVerifiableExpiry);

  const missingProfile = await load(
    withRepository({
      async loadComplianceProfiles() {
        return { kind: "missing" };
      },
    }),
  );
  assert.equal(missingProfile.context.complianceStatus, null);
  assertCollectionDenied(missingProfile);

  const duplicateProfiles = await load(
    withRepository({
      async loadComplianceProfiles() {
        const one = await baseRepository().loadComplianceProfiles({ merchantId: "merchant-1" });
        return one.kind === "found" ? found([one.value[0], one.value[0]]) : one;
      },
    }),
  );
  assert.equal(duplicateProfiles.context.merchantEntitlements, null);
  assert.ok(duplicateProfiles.diagnostics.some((item) => item.code === "compliance_profile_ambiguous"));
  assertCollectionDenied(duplicateProfiles);

  const missingMerchantEntitlements = await load(
    withRepository({
      async loadComplianceProfiles() {
        const one = await baseRepository().loadComplianceProfiles({ merchantId: "merchant-1" });
        return one.kind === "found" ? found([{ ...one.value[0], merchantEntitlements: null }]) : one;
      },
    }),
  );
  assert.ok(
    missingMerchantEntitlements.diagnostics.some(
      (item) => item.code === "merchant_entitlements_missing",
    ),
  );
  assertCollectionDenied(missingMerchantEntitlements);

  const collectionEntitlementDisabled = await load(
    withRepository({
      async loadComplianceProfiles() {
        const one = await baseRepository().loadComplianceProfiles({ merchantId: "merchant-1" });
        return one.kind === "found"
          ? found([
              {
                ...one.value[0],
                merchantEntitlements: { ...one.value[0].merchantEntitlements!, canCollectPayments: false },
              },
            ])
          : one;
      },
    }),
  );
  assertCollectionDenied(collectionEntitlementDisabled);

  const globalFlagsOnly = await load(
    withRepository({
      async loadComplianceProfiles() {
        const one = await baseRepository().loadComplianceProfiles({ merchantId: "merchant-1" });
        return one.kind === "found" ? found([{ ...one.value[0], merchantEntitlements: null }]) : one;
      },
    }),
  );
  assertCollectionDenied(globalFlagsOnly);

  const merchantEntitlementsOnly = await load(
    withRepository({
      async loadGlobalFeatureFlags() {
        return { kind: "missing" };
      },
    }),
  );
  assertCollectionDenied(merchantEntitlementsOnly);

  for (const [name, override] of [
    ["limits", { async loadCollectionLimitState() { return { kind: "missing" } as const; } }],
    ["payout", { async loadPayoutReadiness() { return { kind: "missing" } as const; } }],
    ["provider", { async loadProviderSettlementReadiness() { return { kind: "missing" } as const; } }],
  ] as const) {
    const incomplete = await load(withRepository(override));
    assert.equal(incomplete.status, "incomplete", `Expected ${name} to be incomplete`);
    assertCollectionDenied(incomplete);
  }

  const wrongProviderEnvironmentMapping = await load(
    withRepository({
      async loadProviderSettlementReadiness() {
        return found({
          providerMappingReady: true,
          selectedProvider: "paystack",
          selectedEnvironment: "live",
          mappingProvider: "paystack",
          mappingEnvironment: "sandbox",
        });
      },
    }),
  );
  assert.ok(
    wrongProviderEnvironmentMapping.diagnostics.some(
      (item) => item.code === "provider_mapping_missing",
    ),
  );
  assertCollectionDenied(wrongProviderEnvironmentMapping);

  const lockDisagreement = await load(
    withRepository({
      async loadOperationalState() {
        return found({
          merchantSetupMode: false,
          workspaceSetupMode: true,
          merchantLiveFeaturesEnabled: true,
          workspaceLiveFeaturesEnabled: true,
        });
      },
    }),
  );
  assert.equal(lockDisagreement.context.setupMode, null);
  assert.ok(lockDisagreement.diagnostics.some((item) => item.code === "operational_state_disagreement"));
  assertCollectionDenied(lockDisagreement);

  const sourceError = await load(
    withRepository({
      async loadProviderSettlementReadiness() {
        throw new Error("sensitive provider payload must not reach diagnostics");
      },
    }),
  );
  assert.equal(sourceError.status, "source_error");
  assert.deepEqual(sourceError.diagnostics, [{ code: "provider_mapping_query_error" }]);
  assert.doesNotMatch(JSON.stringify(sourceError), /sensitive|payload/i);
  assertCollectionDenied(sourceError);

  const facade = readFileSync("src/lib/compliance/trusted-runtime-capability-loader.ts", "utf8");
  const core = readFileSync("src/lib/compliance/trusted-runtime-capability-loader-core.ts", "utf8");
  assert.match(facade, /import\s+["']server-only["']/);
  assert.doesNotMatch(
    core,
    /from\s+["'][^"']*supabase|createClient\(|syncMerchantSetupStatus|setupStatusForMerchant/i,
  );
  assert.doesNotMatch(core, /provider_metadata|payment_records|subscription_payments/i);
  assert.doesNotMatch(core, /requestedWorkspaceId|merchantId\?:|planId|provider\?:/);

  const routeAndActionSources = [
    ...sourceFiles("src/app"),
    "src/lib/actions.ts",
  ];
  for (const file of routeAndActionSources) {
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /trusted-runtime-capability-loader/,
      `Runtime call site unexpectedly imports loader: ${file}`,
    );
  }

  console.log("trusted-runtime-capability-loader.test.ts passed");
}

void run();
