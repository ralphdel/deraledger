import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { readFileSync } from "node:fs";

const requireForShim = createRequire(import.meta.url);
const serverOnlyShimPath = requireForShim.resolve("server-only");
const serverOnlyShimModule = new Module(serverOnlyShimPath);
serverOnlyShimModule.filename = serverOnlyShimPath;
serverOnlyShimModule.loaded = true;
serverOnlyShimModule.exports = {};
requireForShim.cache[serverOnlyShimPath] = serverOnlyShimModule;

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "service-role-key";

type Row = Record<string, unknown>;
type QueryResponse = { data: unknown; error: { message: string } | null };

class FakeQuery {
  private filters: Array<{ column: string; value: unknown }> = [];

  constructor(
    private readonly client: FakeClient,
    private readonly table: string,
  ) {}

  select() { return this; }
  order() { return this; }
  limit() { return this; }
  or() { return this; }
  eq(column: string, value: unknown) {
    this.filters.push({ column, value });
    return this;
  }
  async maybeSingle(): Promise<QueryResponse> {
    const row = (this.client.tables.get(this.table) || []).find((candidate) =>
      this.filters.every((filter) => candidate[filter.column] === filter.value)
    );
    return { data: row || null, error: null };
  }
  async single(): Promise<QueryResponse> {
    return this.maybeSingle();
  }
  async insert(value: Row): Promise<QueryResponse> {
    this.client.writes.push({ table: this.table, kind: "insert", value: structuredClone(value) });
    return { data: null, error: null };
  }
  async upsert(value: Row): Promise<QueryResponse> {
    this.client.writes.push({ table: this.table, kind: "upsert", value: structuredClone(value) });
    return { data: null, error: null };
  }
}

class FakeClient {
  readonly tables = new Map<string, Row[]>();
  readonly rpcCalls: Array<{ name: string; args: Row }> = [];
  readonly writes: Array<{ table: string; kind: string; value: Row }> = [];
  rpcResponse: QueryResponse = {
    data: {
      kind: "already_processed",
      period_end: "2026-12-01T00:00:00.000Z",
    },
    error: null,
  };

  from(table: string) { return new FakeQuery(this, table); }
  async rpc(name: string, args: Row) {
    this.rpcCalls.push({ name, args: structuredClone(args) });
    return this.rpcResponse;
  }
}

function renewalRecord(overrides: Row = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    internal_reference: "rnw_merchant_1",
    provider_name: "paystack",
    provider_reference: null,
    payment_purpose: "plan_renewal",
    payment_method: "card",
    payment_status: "pending",
    processing_status: "pending_payment",
    account_setup_status: "pending_payment",
    merchant_id: "22222222-2222-2222-2222-222222222222",
    onboarding_session_id: null,
    solo_plus_case_id: null,
    expected_amount: 5000,
    amount_paid: 0,
    currency: "NGN",
    customer_email: "merchant@example.test",
    plan_id: "individual",
    plan_name: "solo_lite",
    metadata: {
      type: "subscription_renewal",
      payment_purpose: "plan_renewal",
    },
    raw_provider_payload: {},
    failure_reason: null,
    ...overrides,
  };
}

async function main() {
  const { processSuccessfulFiatPayment } = await import(
    new URL("../src/lib/services/fiat-payment-confirmation.service.ts", import.meta.url).href
  );

  for (const provider of ["paystack", "monnify"] as const) {
    const client = new FakeClient();
    client.tables.set("payment_records", [renewalRecord({ provider_name: provider })]);

    const result = await processSuccessfulFiatPayment(client as never, {
      provider,
      metadata: { type: "subscription_renewal" },
      amountKobo: 500000,
      reference: "rnw_merchant_1",
      providerReference: `${provider}-renewal-1`,
      channel: "card",
      currency: "NGN",
      rawProviderPayload: { provider },
    });

    assert.equal(result.already_processed, true);
    assert.equal(client.rpcCalls.length, 1);
    assert.equal(client.rpcCalls[0]?.name, "confirm_fiat_plan_renewal_v1");
    assert.deepEqual(client.rpcCalls[0]?.args, {
      p_payment_record_id: "11111111-1111-1111-1111-111111111111",
      p_provider: provider,
      p_internal_reference: "rnw_merchant_1",
      p_provider_reference: `${provider}-renewal-1`,
      p_amount_kobo: 500000,
      p_currency: "NGN",
      p_merchant_id: "22222222-2222-2222-2222-222222222222",
      p_canonical_plan: "solo_lite",
      p_raw_provider_payload: { provider },
    });
  }

  {
    const client = new FakeClient();
    client.tables.set("payment_records", [renewalRecord({
      plan_id: "business",
      plan_name: "corporate",
      expected_amount: 20000,
    })]);
    client.rpcResponse = {
      data: {
        kind: "applied",
        period_start: "2026-11-01T00:00:00.000Z",
        period_end: "2026-12-01T00:00:00.000Z",
      },
      error: null,
    };

    const result = await processSuccessfulFiatPayment(client as never, {
      provider: "paystack",
      metadata: {},
      amountKobo: 2000000,
      reference: "rnw_merchant_1",
      providerReference: "paystack-business-renewal-1",
      channel: "card",
      currency: "NGN",
    });

    assert.equal(result.processed, true);
    assert.equal(result.already_processed, false);
    assert.equal(client.rpcCalls[0]?.args.p_canonical_plan, "business");
    assert.equal(client.writes.filter((write) => write.table === "audit_logs").length, 1);
  }

  {
    const client = new FakeClient();
    client.tables.set("payment_records", [renewalRecord({ plan_name: "business" })]);
    await assert.rejects(
      () => processSuccessfulFiatPayment(client as never, {
        provider: "paystack",
        metadata: {},
        amountKobo: 500000,
        reference: "rnw_merchant_1",
        channel: "card",
        currency: "NGN",
      }),
      /unsupported or inconsistent/i,
    );
    assert.equal(client.rpcCalls.length, 0);
  }

  {
    const client = new FakeClient();
    client.tables.set("payment_records", [renewalRecord()]);
    client.rpcResponse = {
      data: { kind: "state_conflict", reason: "merchant_plan_mismatch" },
      error: null,
    };
    await assert.rejects(
      () => processSuccessfulFiatPayment(client as never, {
        provider: "paystack",
        metadata: {},
        amountKobo: 500000,
        reference: "rnw_merchant_1",
        channel: "card",
        currency: "NGN",
      }),
      /failed closed/i,
    );
    assert.equal(client.rpcCalls.length, 1);
    assert.equal(client.writes.length, 0);
  }

  {
    const client = new FakeClient();
    client.tables.set("payment_records", [renewalRecord({ plan_id: "solo_plus", plan_name: "solo_plus" })]);
    await assert.rejects(
      () => processSuccessfulFiatPayment(client as never, {
        provider: "paystack",
        metadata: {},
        amountKobo: 1300000,
        reference: "rnw_merchant_1",
        channel: "card",
        currency: "NGN",
      }),
      /Solo Plus renewal remains deferred/i,
    );
    assert.equal(client.rpcCalls.length, 0);
  }

  {
    const client = new FakeClient();
    client.tables.set("payment_records", [renewalRecord({
      payment_purpose: "plan_subscription",
      solo_plus_case_id: "33333333-3333-3333-3333-333333333333",
      metadata: {
        type: "subscription_renewal",
        payment_purpose: "plan_subscription",
      },
    })]);
    await assert.rejects(
      () => processSuccessfulFiatPayment(client as never, {
        provider: "paystack",
        metadata: { type: "subscription_renewal" },
        amountKobo: 500000,
        reference: "rnw_merchant_1",
        channel: "card",
        currency: "NGN",
      }),
      /Legacy renewal payment is not eligible for automatic processing/i,
    );
    assert.equal(client.rpcCalls.length, 0);
  }

  const renewInitialize = readFileSync("src/app/api/payment/renew-initialize/route.ts", "utf8");
  const legacyRenew = readFileSync("src/app/api/payment/renew/route.ts", "utf8");
  const paymentMethods = readFileSync("src/app/api/checkout/payment-methods/route.ts", "utf8");
  const confirmation = readFileSync("src/lib/services/fiat-payment-confirmation.service.ts", "utf8");
  const verifyRenew = readFileSync("src/app/api/payment/verify-renew/route.ts", "utf8");
  const paystack = readFileSync("src/app/api/webhooks/paystack/route.ts", "utf8");
  const monnify = readFileSync("src/app/api/webhooks/monnify/route.ts", "utf8");
  const onboardingInitialize = readFileSync("src/app/api/onboarding/initialize-payment/route.ts", "utf8");

  assert.match(renewInitialize, /parsePaidPlanCode\(plan\)/);
  assert.match(renewInitialize, /normalizedPlan === "solo_plus"[\s\S]*Solo Plus renewal remains deferred/);
  assert.match(renewInitialize, /currentPlan !== normalizedPlan[\s\S]*status: 409/);
  assert.match(renewInitialize, /resolvePaymentRoute\("plan_renewal"/);
  assert.match(renewInitialize, /paymentPurpose: "plan_renewal"/);
  assert.equal((renewInitialize.match(/payment_purpose: "plan_renewal"/g) || []).length, 2);
  assert.doesNotMatch(renewInitialize, /paymentPurpose: "plan_subscription"/);
  assert.doesNotMatch(renewInitialize, /payment_purpose: "plan_subscription"/);
  assert.match(onboardingInitialize, /paymentPurpose: "plan_subscription"/);

  assert.match(legacyRenew, /POST as initializeRenewal/);
  assert.match(legacyRenew, /return initializeRenewal\(request\)/);
  assert.match(paymentMethods, /kind === "renewal"\) return "plan_renewal"/);
  assert.match(paymentMethods, /purpose === "plan_subscription" \|\| purpose === "plan_renewal"/);
  assert.match(paymentMethods, /context === "renewal" && resolvedPurpose === "plan_subscription"/);

  assert.match(confirmation, /payment_purpose === "plan_subscription"[\s\S]*\? "subscription"/);
  assert.match(confirmation, /payment_purpose === "plan_renewal"[\s\S]*\? "subscription_renewal"/);
  assert.match(confirmation, /linkedPaymentRecord\s*\?[\s\S]*linkedPaymentRecord\.payment_purpose[\s\S]*:\s*String\(payment\.metadata/);
  assert.match(confirmation, /confirm_fiat_plan_renewal_v1/);
  assert.match(confirmation, /payment\.provider === "breet"[\s\S]*confirmCryptoSubscriptionRenewal/);
  assert.match(confirmation, /kind === "already_processed"/);
  assert.match(confirmation, /kind !== "applied"[\s\S]*failed closed/);
  assert.match(confirmation, /Legacy renewal payment is not eligible for automatic processing/);
  assert.ok(
    confirmation.indexOf("confirm_fiat_plan_renewal_v1") < confirmation.indexOf('from("audit_logs").insert'),
    "Atomic renewal persistence must occur before audit/email side effects.",
  );
  assert.match(verifyRenew, /processSuccessfulFiatPayment/);
  assert.match(verifyRenew, /currency: stringValue\(payload\.currency\) \|\| "NGN"/);
  assert.match(paystack, /processSuccessfulFiatPayment/);
  assert.match(monnify, /processSuccessfulFiatPayment/);

  console.log("phase2c-fiat-plan-renewal-routing.test.ts passed");
}

void main();
