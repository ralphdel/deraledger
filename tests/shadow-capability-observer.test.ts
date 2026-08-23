import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  observeShadowCapability,
  type ShadowCapabilityObservationEvent,
} from "../src/lib/compliance/shadow-capability-observer-core";
import {
  buildTrustedRuntimeCapabilityContext,
  toResolveMerchantCapabilitiesInput,
} from "../src/lib/compliance/runtime-capability-context";
import type { TrustedRuntimeCapabilityLoaderResult } from "../src/lib/compliance/trusted-runtime-capability-loader-core";

function loaderResult(
  status: "ready" | "incomplete" | "source_error",
  overrides: Record<string, unknown> = {},
): TrustedRuntimeCapabilityLoaderResult {
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
    collectionLimit: { basis: "cumulative", limitNgn: 1000, usedNgn: 0, approved: true },
    ...overrides,
  });
  return {
    status,
    context,
    resolverInput: toResolveMerchantCapabilitiesInput(context),
    diagnostics: status === "incomplete" ? [{ code: "compliance_profile_missing" }] : [],
  };
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

async function run() {
  const existingGate = { outcome: "allow" as const, reasonCodes: ["plan_gate"], value: { response: "unchanged" } };
  let loadCount = 0;
  let emitCount = 0;
  const base = {
    correlationId: "correlation-1",
    routeClass: "collection_invoice" as const,
    existingGate,
    trustedMerchantId: "merchant-1",
    trustedWorkspaceId: "workspace-1",
    load: async () => { loadCount += 1; return loaderResult("ready"); },
    emit: async (_event: ShadowCapabilityObservationEvent) => { emitCount += 1; },
    hashIdentifier: (value: string) => `hash:${value}`,
  };

  const defaultOff = await observeShadowCapability(base);
  assert.strictEqual(defaultOff.existingGate, existingGate);
  assert.equal(defaultOff.observation, "not_run");
  assert.equal(loadCount, 0);
  assert.equal(emitCount, 0);

  const killed = await observeShadowCapability({ ...base, config: { enabled: true, sampled: true, killSwitchActive: true } });
  assert.strictEqual(killed.existingGate, existingGate);
  assert.equal(loadCount, 0);
  assert.equal(emitCount, 0);

  const unsampled = await observeShadowCapability({ ...base, config: { enabled: true, sampled: false } });
  assert.strictEqual(unsampled.existingGate, existingGate);
  assert.equal(loadCount, 0);
  assert.equal(emitCount, 0);

  const events: ShadowCapabilityObservationEvent[] = [];
  const enabled = await observeShadowCapability({
    ...base,
    config: { enabled: true, sampled: true },
    emit: async (event) => { events.push(event); },
  });
  assert.strictEqual(enabled.existingGate, existingGate);
  assert.equal(enabled.observation, "emitted");
  assert.equal(loadCount, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].comparison, "agree_allow");
  assert.equal(events[0].merchantHash, "hash:merchant-1");
  assert.equal(events[0].workspaceHash, "hash:workspace-1");
  assert.equal("merchantId" in events[0], false);
  assert.equal("workspaceId" in events[0], false);

  const resolverDeny = await observeShadowCapability({
    ...base,
    config: { enabled: true, sampled: true },
    load: async () => loaderResult("ready", { liveFeaturesEnabled: false }),
  });
  assert.strictEqual(resolverDeny.existingGate, existingGate);

  const deniedGate = { outcome: "deny" as const, reasonCodes: ["verification_gate"], value: { response: "deny unchanged" } };
  const resolverAllow = await observeShadowCapability({
    ...base,
    existingGate: deniedGate,
    config: { enabled: true, sampled: true },
  });
  assert.strictEqual(resolverAllow.existingGate, deniedGate);

  const missingProfileEvents: ShadowCapabilityObservationEvent[] = [];
  const missingProfile = await observeShadowCapability({
    ...base,
    config: { enabled: true, sampled: true },
    load: async () => loaderResult("incomplete"),
    emit: async (event) => { missingProfileEvents.push(event); },
  });
  assert.strictEqual(missingProfile.existingGate, existingGate);
  assert.equal(missingProfileEvents[0]?.comparison, "source_incomplete");
  assert.deepEqual(missingProfileEvents[0]?.reasonCodes, ["plan_gate", "compliance_profile_missing"]);

  const errorEvents: ShadowCapabilityObservationEvent[] = [];
  const sourceError = await observeShadowCapability({
    ...base,
    config: { enabled: true, sampled: true },
    load: async () => { throw new Error("BVN 123 provider reference secret"); },
    emit: async (event) => { errorEvents.push(event); },
  });
  assert.strictEqual(sourceError.existingGate, existingGate);
  assert.equal(errorEvents[0]?.comparison, "source_error");
  assert.deepEqual(errorEvents[0]?.reasonCodes, ["observer_loader_error"]);
  assert.doesNotMatch(JSON.stringify(errorEvents[0]), /BVN|provider reference|secret/i);

  const timeoutEvents: ShadowCapabilityObservationEvent[] = [];
  const timeoutResult = await observeShadowCapability({
    ...base,
    config: { enabled: true, sampled: true, timeoutMs: 1 },
    load: () => new Promise<TrustedRuntimeCapabilityLoaderResult>(() => undefined),
    emit: async (event) => { timeoutEvents.push(event); },
  });
  assert.strictEqual(timeoutResult.existingGate, existingGate);
  assert.equal(timeoutEvents[0]?.reasonCodes[0], "observer_timeout");

  const facade = readFileSync("src/lib/compliance/shadow-capability-observer.ts", "utf8");
  const core = readFileSync("src/lib/compliance/shadow-capability-observer-core.ts", "utf8");
  assert.match(facade, /import\s+["']server-only["']/);
  assert.doesNotMatch(core, /\.from\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(|rpc\(|paystack|monnify|breet/i);
  for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /shadow-capability-observer/);
  }

  console.log("shadow-capability-observer.test.ts passed");
}

void run();
