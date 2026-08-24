import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  prepareActivationCommand,
  prepareEmergencySuspensionCommand,
  prepareRelockCommand,
  type PrepareActivationCommandRequest,
} from "../src/lib/compliance/activation-transition-command-core";

const identity = { merchantId: "merchant-1", workspaceId: "workspace-1", authority: "trusted_server" as const };
const operator = { operatorId: "operator-1", authorization: "internal_activation_operator" as const, authorized: true as const };
const versions = { merchant: 1, workspace: 1, profile: 1, limitWindows: [1] };
const readiness = (authority: "trusted_payout_readiness" | "trusted_provider_mapping" | "trusted_global_feature_flag" | "trusted_merchant_entitlement" | "trusted_setup_live_approval") => ({ referenceId: `${authority}-1`, approved: true as const, authority });

function activation(planCode: "solo_lite" | "solo_plus" | "business" = "solo_lite", overrides: Partial<PrepareActivationCommandRequest> = {}): PrepareActivationCommandRequest {
  const verified = planCode === "solo_lite" ? "lite_verified" : planCode === "solo_plus" ? "enhanced_verified" : "business_verified";
  return {
    identity, operator, policyVersion: "phase-2-v1", idempotencyKey: "activate-1", expectedRowVersions: versions,
    entitlement: { entitlementId: "entitlement-1", planCode, state: "active_paid", authority: "trusted_commercial_entitlement" },
    complianceProfile: { profileId: "profile-1", planCode, complianceStatus: verified, rowVersion: 1, authority: "trusted_compliance_profile" },
    riskApproval: { decisionId: "risk-1", rating: "low", authority: "trusted_risk_review" },
    limitWindows: [{ windowId: "window-1", lifecycle: "active", approved: true, expectedRowVersion: 1, authority: "trusted_limit_window" }],
    payoutReadiness: readiness("trusted_payout_readiness"), providerMappingReadiness: readiness("trusted_provider_mapping"),
    globalCollectionFlag: readiness("trusted_global_feature_flag"), merchantCollectionEntitlement: readiness("trusted_merchant_entitlement"),
    setupLiveReadinessApproval: readiness("trusted_setup_live_approval"), restrictionState: "active", ...overrides,
  };
}
function rejected(result: ReturnType<typeof prepareActivationCommand>, code: string) {
  assert.equal(result.kind, "rejected");
  assert.deepEqual(result.diagnostics, [{ code }]);
}
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.(?:ts|tsx)$/.test(entry.name) ? [file] : [];
  });
}

function run() {
  for (const plan of ["solo_lite", "solo_plus", "business"] as const) {
    const result = prepareActivationCommand(activation(plan));
    assert.equal(result.kind, "prepared");
    if (result.kind === "prepared") {
      assert.equal(result.target.setupMode, false);
      assert.equal(result.target.liveFeaturesEnabled, true);
      assert.equal(result.target.activationStatus, "active");
      assert.equal(result.target.merchantEntitlements.canCollectPayments, true);
      assert.equal(result.target.schemaCompatibility.persistenceBlockedPendingSchemaDecision, true);
    }
  }
  rejected(prepareActivationCommand(activation("solo_lite", { entitlement: { entitlementId: "e", planCode: "starter", state: "active_paid", authority: "trusted_commercial_entitlement" } })), "activation_starter_plan");
  rejected(prepareActivationCommand(activation("solo_lite", { entitlement: null })), "activation_paid_entitlement_missing");
  rejected(prepareActivationCommand(activation("solo_lite", { complianceProfile: { ...activation().complianceProfile!, complianceStatus: "business_verified" } })), "activation_compliance_mismatch");
  rejected(prepareActivationCommand(activation("solo_lite", { riskApproval: null })), "activation_risk_missing");
  rejected(prepareActivationCommand(activation("solo_lite", { restrictionState: "restricted" })), "activation_restriction_not_active");
  rejected(prepareActivationCommand(activation("solo_lite", { restrictionState: "suspended" })), "activation_restriction_not_active");
  rejected(prepareActivationCommand(activation("solo_lite", { limitWindows: null })), "activation_limit_windows_missing");
  for (const lifecycle of ["exhausted", "expired", "suspended", "revoked"] as const) rejected(prepareActivationCommand(activation("solo_lite", { limitWindows: [{ ...activation().limitWindows![0], lifecycle }] })), "activation_limit_window_blocking");
  rejected(prepareActivationCommand(activation("solo_lite", { payoutReadiness: null })), "activation_payout_readiness_missing");
  rejected(prepareActivationCommand(activation("solo_lite", { providerMappingReadiness: null })), "activation_provider_mapping_missing");
  rejected(prepareActivationCommand(activation("solo_lite", { globalCollectionFlag: null })), "activation_global_flag_missing");
  rejected(prepareActivationCommand(activation("solo_lite", { merchantCollectionEntitlement: null })), "activation_merchant_entitlement_missing");
  rejected(prepareActivationCommand(activation("solo_lite", { setupLiveReadinessApproval: null })), "activation_setup_live_approval_missing");
  rejected(prepareActivationCommand(activation("solo_lite", { idempotencyKey: "" })), "activation_idempotency_key_missing");
  rejected(prepareActivationCommand(activation("solo_lite", { expectedRowVersions: null })), "activation_row_versions_missing");
  rejected(prepareActivationCommand(activation("solo_lite", { entitlement: { entitlementId: "payment-only", planCode: "solo_lite", state: "active_paid", authority: "payment" as never } })), "activation_paid_entitlement_unsafe");

  const relock = prepareRelockCommand({ identity, operator, policyVersion: "phase-2-v1", idempotencyKey: "relock-1", expectedRowVersions: versions, reasonCode: "limit_unavailable", sourceReferenceId: "window-1" });
  assert.equal(relock.kind, "prepared");
  if (relock.kind === "prepared") assert.deepEqual(relock.target, { setupMode: true, liveFeaturesEnabled: false, activationStatus: "restricted", restrictionState: "restricted", merchantEntitlements: { canCollectPayments: false } });
  const suspension = prepareEmergencySuspensionCommand({ identity, operator, policyVersion: "phase-2-v1", idempotencyKey: "suspend-1", expectedRowVersions: versions, reasonCode: "emergency_risk_suspension", sourceReferenceId: "risk-1" });
  assert.equal(suspension.kind, "prepared");
  if (suspension.kind === "prepared") assert.equal(suspension.target.activationStatus, "suspended");

  const core = readFileSync("src/lib/compliance/activation-transition-command-core.ts", "utf8");
  const facade = readFileSync("src/lib/compliance/activation-transition-command.ts", "utf8");
  assert.match(facade, /import\s+["']server-only["']/);
  assert.doesNotMatch(core, /\.from\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(|(?:paystack|monnify|breet)\s*[.(]|(?:initialize|create|open)[A-Z]\w*Checkout\s*\(/i);
  for (const file of sourceFiles("src/app")) assert.doesNotMatch(readFileSync(file, "utf8"), /activation-transition-command/);
  assert.doesNotMatch(readFileSync("src/lib/actions.ts", "utf8"), /activation-transition-command/);
}
run();
console.log("activation transition command contracts: PASS");
