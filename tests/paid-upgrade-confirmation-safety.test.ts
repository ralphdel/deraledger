import assert from "node:assert/strict";
import { createRequire } from "node:module";

import type { PaidUpgradeProviderObservation } from "../src/lib/services/paid-upgrade-confirmation.service";
import type { PendingPlanPaymentRecord } from "../src/lib/services/plan-payment-recovery.service";
import { parsePaidPlanCode } from "../src/lib/plans";

let PaidUpgradeConfirmationError: typeof import("../src/lib/services/paid-upgrade-confirmation.service").PaidUpgradeConfirmationError;
type PaidUpgradeConfirmationErrorInstance = import("../src/lib/services/paid-upgrade-confirmation.service").PaidUpgradeConfirmationError;

const record: PendingPlanPaymentRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "22222222-2222-4222-8222-222222222222",
  internal_reference: "upg_merchant_1",
  provider_name: "paystack",
  provider_reference: null,
  payment_purpose: "plan_upgrade",
  payment_method: "card",
  payment_status: "pending",
  processing_status: "pending_payment",
  account_setup_status: "pending_payment",
  merchant_id: "33333333-3333-4333-8333-333333333333",
  onboarding_session_id: null,
  solo_plus_case_id: null,
  expected_amount: 5000,
  amount_paid: 0,
  currency: "NGN",
  customer_email: "owner@example.com",
  plan_id: "individual",
  plan_name: "solo_lite",
  metadata: {},
  raw_provider_payload: null,
  failure_reason: null,
};

const observation: PaidUpgradeProviderObservation = {
  provider: "paystack",
  reference: record.internal_reference,
  providerReference: "987654321",
  amountKobo: 500_000,
  currency: "NGN",
  customerEmail: "OWNER@example.com",
  metadata: {
    type: "subscription_upgrade",
    merchant_id: record.merchant_id,
    new_plan: "individual",
    payment_purpose: "plan_upgrade",
    resolved_provider: "paystack",
    amount_expected_kobo: 500_000,
    email: "owner@example.com",
  },
  rawProviderPayload: { status: "success" },
};

function expectCode(fn: () => unknown, code: PaidUpgradeConfirmationErrorInstance["code"]) {
  assert.throws(
    fn,
    (error: unknown) => error instanceof PaidUpgradeConfirmationError && error.code === code,
  );
}

class FakeQuery {
  constructor(private readonly row: PendingPlanPaymentRecord | null) {}
  select() { return this; }
  or() { return this; }
  order() { return this; }
  limit() { return this; }
  async maybeSingle() { return { data: this.row, error: null }; }
}

class FakeClient {
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  rpcError: { message: string } | null = null;
  rpcData: Record<string, unknown> = { kind: "applied" };
  canonicalRpcData: Array<Record<string, unknown>> = [{
    result_code: "canonical_workspace_link_created",
    merchant_id: record.merchant_id,
    workspace_id: "44444444-4444-4444-8444-444444444444",
    link_version: 1,
  }];
  constructor(readonly row: PendingPlanPaymentRecord | null = record) {}
  from() { return new FakeQuery(this.row); }
  async rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    if (name === "reconcile_canonical_merchant_workspace_link_v1") {
      return { data: this.canonicalRpcData, error: null };
    }
    return { data: this.rpcData, error: this.rpcError };
  }
}

async function run() {
  const require = createRequire(import.meta.url);
  const serverOnlyId = require.resolve("server-only");
  require.cache[serverOnlyId] = {
    exports: {}, filename: serverOnlyId, id: serverOnlyId, loaded: true, path: serverOnlyId,
    children: [], paths: [], isPreloading: false, parent: null, require,
  } as NodeModule;
  const service = await import("../src/lib/services/paid-upgrade-confirmation.service");
  const {
    confirmPaidUpgradeAtomically,
    validatePaidUpgradeIntent,
    validatePaidUpgradeProviderObservation,
  } = service;
  PaidUpgradeConfirmationError = service.PaidUpgradeConfirmationError;

  assert.equal(parsePaidPlanCode("starter"), null);
  assert.equal(parsePaidPlanCode("unknown-plan"), null);
  assert.equal(parsePaidPlanCode("solo_lite"), "solo_lite");

  const intent = validatePaidUpgradeIntent(record, {
    id: record.user_id!,
    email: " OWNER@example.com ",
  });
  assert.equal(intent.plan, "solo_lite");
  assert.equal(intent.expectedAmountKobo, 500_000);
  assert.equal(intent.status, "pending");
  validatePaidUpgradeProviderObservation(intent, observation);

  expectCode(
    () => validatePaidUpgradeIntent({ ...record, expected_amount: 0 }),
    "INVALID_EXPECTED_AMOUNT",
  );
  expectCode(
    () => validatePaidUpgradeIntent({ ...record, expected_amount: null }),
    "INVALID_EXPECTED_AMOUNT",
  );
  expectCode(
    () => validatePaidUpgradeIntent({ ...record, plan_id: "starter", plan_name: "starter" }),
    "INVALID_UPGRADE_PLAN",
  );
  expectCode(
    () => validatePaidUpgradeIntent(record, { id: "wrong-user", email: record.customer_email }),
    "PAYMENT_RECORD_IDENTITY_MISMATCH",
  );

  const mismatches: Array<[Partial<PaidUpgradeProviderObservation>, PaidUpgradeConfirmationErrorInstance["code"]]> = [
    [{ amountKobo: 499_999 }, "AMOUNT_MISMATCH"],
    [{ provider: "monnify" }, "PROVIDER_MISMATCH"],
    [{ reference: "wrong-ref" }, "REFERENCE_MISMATCH"],
    [{ providerReference: null }, "REFERENCE_MISMATCH"],
    [{ currency: "USD" }, "CURRENCY_MISMATCH"],
    [{ customerEmail: "attacker@example.com" }, "EMAIL_MISMATCH"],
    [{ metadata: { ...observation.metadata, merchant_id: "wrong-merchant" } }, "MERCHANT_MISMATCH"],
    [{ metadata: { ...observation.metadata, new_plan: "business" } }, "PLAN_MISMATCH"],
    [{ metadata: { ...observation.metadata, payment_purpose: "invoice_payment" } }, "PURPOSE_MISMATCH"],
    [{ metadata: { ...observation.metadata, email: "attacker@example.com" } }, "EMAIL_MISMATCH"],
  ];
  for (const [overrides, code] of mismatches) {
    expectCode(
      () => validatePaidUpgradeProviderObservation(intent, { ...observation, ...overrides }),
      code,
    );
  }

  for (const statusRecord of [
    { payment_status: "pending", processing_status: "manual_review", account_setup_status: "manual_review" },
    { payment_status: "failed", processing_status: "failed", account_setup_status: "failed" },
    { payment_status: "pending", processing_status: "underpaid", account_setup_status: "manual_review" },
  ]) {
    expectCode(
      () => validatePaidUpgradeIntent({ ...record, ...statusRecord }),
      "PAYMENT_RECORD_NOT_PENDING",
    );
  }

  const processedRecord = {
    ...record,
    payment_status: "successful",
    processing_status: "processed",
    account_setup_status: "paid_pending_setup",
  };
  assert.equal(validatePaidUpgradeIntent(processedRecord).status, "processed");

  const client = new FakeClient();
  const applied = await confirmPaidUpgradeAtomically(client as never, observation);
  assert.equal(applied.applied, true);
  assert.equal(client.rpcCalls.length, 2);
  assert.equal(client.rpcCalls[0].name, "confirm_paid_upgrade_v1");
  assert.equal(client.rpcCalls[0].args.p_payment_record_id, record.id);
  assert.equal("p_merchant_id" in client.rpcCalls[0].args, false);
  assert.equal("p_plan" in client.rpcCalls[0].args, false);
  assert.equal("p_expected_amount" in client.rpcCalls[0].args, false);
  assert.equal(client.rpcCalls[1].name, "reconcile_canonical_merchant_workspace_link_v1");
  assert.equal(client.rpcCalls[1].args.p_merchant_id, record.merchant_id);
  assert.equal(client.rpcCalls[1].args.p_reconciled_by, record.user_id);
  assert.equal("p_workspace_id" in client.rpcCalls[1].args, false);

  const replayClient = new FakeClient(processedRecord);
  replayClient.rpcData = { kind: "idempotent_replay" };
  replayClient.canonicalRpcData = [{
    result_code: "canonical_workspace_link_replay",
    merchant_id: record.merchant_id,
    workspace_id: "44444444-4444-4444-8444-444444444444",
    link_version: 1,
  }];
  const replay = await confirmPaidUpgradeAtomically(replayClient as never, observation);
  assert.equal(replay.alreadyProcessed, true);
  assert.equal(replayClient.rpcCalls.length, 2);

  const ambiguousWorkspaceClient = new FakeClient();
  ambiguousWorkspaceClient.canonicalRpcData = [{
    result_code: "canonical_workspace_link_ambiguous",
    merchant_id: record.merchant_id,
    workspace_id: null,
    link_version: null,
  }];
  await assert.rejects(
    confirmPaidUpgradeAtomically(ambiguousWorkspaceClient as never, observation),
    (error: unknown) =>
      error instanceof PaidUpgradeConfirmationError
      && error.code === "CANONICAL_WORKSPACE_RECOVERY_REQUIRED"
      && !/ambiguous|database|supabase/i.test(error.message),
  );
  assert.equal(ambiguousWorkspaceClient.rpcCalls.length, 2);

  const initializedIntent = validatePaidUpgradeIntent({
    ...record,
    provider_reference: "initialized-provider-ref",
  });
  expectCode(
    () => validatePaidUpgradeProviderObservation(initializedIntent, observation),
    "REFERENCE_MISMATCH",
  );

  const failedLedgerClient = new FakeClient();
  failedLedgerClient.rpcError = { message: "subscription_payments insert failed" };
  await assert.rejects(
    confirmPaidUpgradeAtomically(failedLedgerClient as never, observation),
    (error: unknown) =>
      error instanceof PaidUpgradeConfirmationError &&
      error.code === "ATOMIC_ACTIVATION_FAILED",
  );
  assert.equal(failedLedgerClient.rpcCalls.length, 1);

  console.log("paid-upgrade-confirmation-safety.test.ts passed");
}

void run();
