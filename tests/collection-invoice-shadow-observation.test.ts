import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { observeCollectionInvoiceAccessDecision } from "../src/lib/compliance/collection-invoice-shadow-observation-core";
import { buildTrustedRuntimeCapabilityContext, toResolveMerchantCapabilitiesInput } from "../src/lib/compliance/runtime-capability-context";
import type { TrustedRuntimeCapabilityLoaderResult } from "../src/lib/compliance/trusted-runtime-capability-loader-core";

function readyLoaderResult(): TrustedRuntimeCapabilityLoaderResult {
  const context = buildTrustedRuntimeCapabilityContext({
    merchantId: "merchant-1",
    workspaceId: "workspace-1",
    commercialPlan: "solo_lite",
    commercialEntitlementState: "active_paid",
    activeEntitlementPlan: "solo_lite",
    setupMode: false,
    liveFeaturesEnabled: true,
    complianceStatus: "lite_verified",
    activationStatus: "approved",
    riskRating: "low",
    restrictionState: "active",
    featureFlags: {
      storefrontEnabled: true,
      instantSaleEnabled: true,
      receivableSaleEnabled: true,
      merchantConfirmationBeforeDepositEnabled: true,
      customerRegistrationRequiredForReceivables: true,
    },
    merchantEntitlements: {
      canCollectPayments: true,
      canUseInstantSale: true,
      canUseReceivableSale: false,
      canUseStorefront: true,
      canActivateSettlement: true,
      canUseDepositBalance: false,
    },
    settlementReadiness: { payoutAccountVerified: true, providerMappingReady: true },
    collectionLimit: { basis: "cumulative", limitNgn: 1_000, usedNgn: 0, approved: true },
  });
  return {
    status: "ready",
    context,
    resolverInput: toResolveMerchantCapabilitiesInput(context),
    diagnostics: [],
  };
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

async function run() {
  const allow = {
    allowed: true as const,
    invoiceType: "collection" as const,
    shouldSyncMerchantSetup: true,
  };
  let loadCount = 0;
  let emitCount = 0;
  const observation = {
    correlationId: "correlation-1",
    trustedMerchantId: "merchant-1",
    trustedWorkspaceId: "workspace-1",
    hashIdentifier: (value: string) => `hash:${value}`,
    load: async () => { loadCount += 1; return readyLoaderResult(); },
    emit: async () => { emitCount += 1; },
  };

  const defaultOff = await observeCollectionInvoiceAccessDecision({
    requestedInvoiceType: "collection",
    invoiceAccess: allow,
    observation,
  });
  assert.strictEqual(defaultOff, allow, "Default-off observation must return the exact existing access object.");
  assert.equal(loadCount, 0);
  assert.equal(emitCount, 0);

  const record = await observeCollectionInvoiceAccessDecision({
    requestedInvoiceType: "record",
    invoiceAccess: { allowed: true, invoiceType: "record", shouldSyncMerchantSetup: false },
    observation: { ...observation, config: { enabled: true, sampled: true } },
  });
  assert.deepEqual(record, { allowed: true, invoiceType: "record", shouldSyncMerchantSetup: false });
  assert.equal(loadCount, 0, "Record Invoice must never invoke shadow loading.");
  assert.equal(emitCount, 0);

  const enabled = await observeCollectionInvoiceAccessDecision({
    requestedInvoiceType: "collection",
    invoiceAccess: allow,
    observation: { ...observation, config: { enabled: true, sampled: true } },
  });
  assert.strictEqual(enabled, allow, "Resolver output must never replace an allowed existing result.");
  assert.equal(loadCount, 1);
  assert.equal(emitCount, 1);

  const denied = { allowed: false as const, reason: "Existing collection gate denial." };
  const observedDeny = await observeCollectionInvoiceAccessDecision({
    requestedInvoiceType: "collection",
    invoiceAccess: denied,
    observation: { ...observation, config: { enabled: true, sampled: true } },
  });
  assert.strictEqual(observedDeny, denied, "Resolver output must never replace a denied existing result.");

  const actionSource = readFileSync("src/lib/actions.ts", "utf8");
  const wrapperSource = readFileSync("src/lib/compliance/collection-invoice-shadow-observation.ts", "utf8");
  const coreSource = readFileSync("src/lib/compliance/collection-invoice-shadow-observation-core.ts", "utf8");
  assert.match(wrapperSource, /import\s+["']server-only["']/);
  assert.match(actionSource, /import\s+\{\s*observeCollectionInvoiceAccess\s*\}/);
  assert.ok(
    actionSource.indexOf("const invoiceAccess = getInvoiceCreationAccess(") < actionSource.indexOf("observeCollectionInvoiceAccess({"),
    "The observer must be invoked only after the existing invoice gate has produced its result.",
  );
  assert.match(actionSource, /requestedType === "collection"\s*\?\s*await observeCollectionInvoiceAccess/);
  assert.match(
    coreSource,
    /if \(input\.requestedInvoiceType !== "collection"\) \{\s*return input\.invoiceAccess;\s*\}/,
    "Record Invoice must return before the generic observer is invoked.",
  );
  assert.doesNotMatch(wrapperSource, /PaymentService|resolvePaymentRoute|paystack.*initialize|monnify.*initialize|webhook|callback/i);

  const approvedImporters = new Set([
    "src/lib/actions.ts",
    "src/lib/compliance/collection-invoice-shadow-observation.ts",
  ]);
  for (const file of [...sourceFiles("src/app"), ...sourceFiles("src/lib")]) {
    if (approvedImporters.has(file.replace(/\\/g, "/"))) continue;
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /collection-invoice-shadow-observation(?:["']|\s)/,
      `${file} must not import the approved collection-invoice shadow boundary.`,
    );
  }

  console.log("collection-invoice-shadow-observation.test.ts passed");
}

void run();
