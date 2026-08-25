import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire, Module } from "node:module";

import { REVIEW_COMPLIANCE_PROFILE_DECISION_RPC } from "../src/lib/compliance/compliance-profile-approval-rpc-client-core";

type TransportModule = typeof import("../src/lib/compliance/server/reviewed-profile-approval-rpc-service-role-transport");
let createReviewedProfileApprovalServiceRoleTransport: TransportModule["createReviewedProfileApprovalServiceRoleTransport"];
let ReviewedProfileApprovalServiceRoleTransportError: TransportModule["ReviewedProfileApprovalServiceRoleTransportError"];

const arguments_ = {
  p_merchant_id: "merchant-1", p_profile_id: "profile-1", p_plan_code: "solo_lite" as const,
  p_source_type: "solo_lite_review" as const, p_source_id: "source-1", p_source_version: 2,
  p_target_compliance_status: "lite_verified", p_expected_profile_row_version: 4,
  p_reviewer_id: "reviewer-1", p_decision_idempotency_key: "decision-1",
  p_policy_version: "phase-2-v1", p_reviewed_at: "2026-08-25T12:00:00.000Z", p_reason_code: null,
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

async function rejectsWith(
  invoke: () => Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(invoke, (error: unknown) => (
    error instanceof ReviewedProfileApprovalServiceRoleTransportError && error.code === code
  ));
}

async function run() {
  const require = createRequire(import.meta.url);
  const serverOnlyShimPath = require.resolve("server-only");
  const serverOnlyShim = new Module(serverOnlyShimPath);
  serverOnlyShim.filename = serverOnlyShimPath;
  serverOnlyShim.loaded = true;
  serverOnlyShim.exports = {};
  require.cache[serverOnlyShimPath] = serverOnlyShim as never;
  const transportModule = require("../src/lib/compliance/server/reviewed-profile-approval-rpc-service-role-transport") as TransportModule;
  createReviewedProfileApprovalServiceRoleTransport = transportModule.createReviewedProfileApprovalServiceRoleTransport;
  ReviewedProfileApprovalServiceRoleTransportError = transportModule.ReviewedProfileApprovalServiceRoleTransportError;

  let call: { name: string; args: unknown } | null = null;
  const transport = createReviewedProfileApprovalServiceRoleTransport({
    createServiceRoleRpcClient: () => ({
      async rpc(name, args) {
        call = { name, args };
        return { data: [{ result_code: "approval_applied", profile_id: "profile-1", event_id: "event-1", resulting_row_version: 5 }], error: null };
      },
    }),
  });
  const rows = await transport.callApprovalDecisionRpc(REVIEW_COMPLIANCE_PROFILE_DECISION_RPC, arguments_);
  assert.equal(rows.length, 1);
  assert.deepEqual(call, { name: REVIEW_COMPLIANCE_PROFILE_DECISION_RPC, args: arguments_ });
  assert.equal(Object.keys(arguments_).length, 13);

  const configMissing = createReviewedProfileApprovalServiceRoleTransport({ environment: {} });
  await rejectsWith(
    () => configMissing.callApprovalDecisionRpc(REVIEW_COMPLIANCE_PROFILE_DECISION_RPC, arguments_),
    "approval_service_role_config_missing",
  );
  const rpcError = createReviewedProfileApprovalServiceRoleTransport({
    createServiceRoleRpcClient: () => ({ async rpc() { return { data: null, error: { message: "sensitive" } }; } }),
  });
  await rejectsWith(
    () => rpcError.callApprovalDecisionRpc(REVIEW_COMPLIANCE_PROFILE_DECISION_RPC, arguments_),
    "approval_service_role_rpc_failed",
  );
  const malformed = createReviewedProfileApprovalServiceRoleTransport({
    createServiceRoleRpcClient: () => ({ async rpc() { return { data: { result_code: "approval_applied" }, error: null }; } }),
  });
  await rejectsWith(
    () => malformed.callApprovalDecisionRpc(REVIEW_COMPLIANCE_PROFILE_DECISION_RPC, arguments_),
    "approval_service_role_response_invalid",
  );

  const source = readFileSync("src/lib/compliance/server/reviewed-profile-approval-rpc-service-role-transport.ts", "utf8");
  assert.match(source, /^import\s+["']server-only["'];/);
  assert.match(source, /REVIEW_COMPLIANCE_PROFILE_DECISION_RPC/);
  assert.doesNotMatch(source, /export\s+(?:const|function|class|interface|type)\s+.*(?:SupabaseClient|genericRpc|from|authAdmin)/i);
  assert.doesNotMatch(source, /\.from\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|paystack|monnify|breet|checkout|activation|collection|invoice|subscription/i);
  for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /reviewed-profile-approval-rpc-service-role-transport/);
  }
  console.log("compliance-profile-approval-rpc-service-role-transport.test.ts passed");
}

void run();
