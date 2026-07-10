import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { readFileSync } from "node:fs";

const requireForShim = createRequire(import.meta.url);
const serverOnlyShimPath = requireForShim.resolve("server-only");

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "service-role-key";

const serverOnlyShimModule = new Module(serverOnlyShimPath);

serverOnlyShimModule.filename = serverOnlyShimPath;
serverOnlyShimModule.loaded = true;
serverOnlyShimModule.exports = {};

requireForShim.cache[serverOnlyShimPath] = serverOnlyShimModule;

type PaymentLifecycleModule = typeof import("../src/lib/solo-plus/server/payment-lifecycle");
type FiatConfirmationModule = typeof import("../src/lib/services/fiat-payment-confirmation.service");
type PlanPaymentRecoveryModule = typeof import("../src/lib/services/plan-payment-recovery.service");

let confirmSoloPlusPayment: PaymentLifecycleModule["confirmSoloPlusPayment"];
let processSuccessfulFiatPayment: FiatConfirmationModule["processSuccessfulFiatPayment"];
let upsertWebhookAuditEvent: PlanPaymentRecoveryModule["upsertWebhookAuditEvent"];

type QueryResponse = {
  data: unknown;
  error: { message: string } | null;
};

class FakeQueryBuilder {
  private readonly client: FakeSupabaseClient;
  private readonly table: string;
  private filters: Array<{ type: "eq" | "or"; column?: string; value: unknown }> = [];
  private limitCount: number | null = null;

  constructor(client: FakeSupabaseClient, table: string) {
    this.client = client;
    this.table = table;
  }

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  or(value: string) {
    this.filters.push({ type: "or", value });
    return this;
  }

  order() {
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  async maybeSingle(): Promise<QueryResponse> {
    const rows = this.resolveRows();
    return { data: rows[0] ?? null, error: null };
  }

  async upsert(value: Record<string, unknown>): Promise<QueryResponse> {
    this.client.upsertCalls.push({
      table: this.table,
      value: JSON.parse(JSON.stringify(value)),
    });
    return { data: null, error: null };
  }

  private resolveRows() {
    let rows = [...(this.client.tables.get(this.table) || [])];

    for (const filter of this.filters) {
      if (filter.type === "eq") {
        rows = rows.filter((row) => row[filter.column as string] === filter.value);
        continue;
      }

      const [left, right] = String(filter.value).split(",");
      const internalValue = left.replace("internal_reference.eq.", "");
      const providerValue = right.replace("provider_reference.eq.", "");
      rows = rows.filter((row) => {
        const internalMatch = row.internal_reference === internalValue;
        const providerMatch = row.provider_reference === providerValue;
        return internalMatch || providerMatch;
      });
    }

    if (this.limitCount != null) {
      rows = rows.slice(0, this.limitCount);
    }

    return rows;
  }
}

class FakeSupabaseClient {
  readonly tables = new Map<string, Array<Record<string, unknown>>>();
  readonly rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  readonly rpcResponses = new Map<string, QueryResponse>();
  readonly upsertCalls: Array<{ table: string; value: Record<string, unknown> }> = [];

  from(table: string) {
    return new FakeQueryBuilder(this, table);
  }

  async rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args: JSON.parse(JSON.stringify(args)) });
    return this.rpcResponses.get(name) ?? { data: null, error: null };
  }
}

function seedPaymentRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "payment-1",
    internal_reference: "SPL-SUB-TEST",
    provider_name: "paystack",
    provider_reference: null,
    payment_purpose: "plan_subscription",
    payment_method: "card",
    payment_status: "pending",
    processing_status: "pending_payment",
    account_setup_status: "pending_payment",
    merchant_id: null,
    onboarding_session_id: "session-1",
    solo_plus_case_id: "case-1",
    expected_amount: 13000,
    amount_paid: 0,
    currency: "NGN",
    customer_email: "merchant@example.test",
    ...overrides,
  };
}

async function loadModules() {
  ({ confirmSoloPlusPayment } = await import(new URL("../src/lib/solo-plus/server/payment-lifecycle.ts", import.meta.url).href));
  ({ processSuccessfulFiatPayment } = await import(new URL("../src/lib/services/fiat-payment-confirmation.service.ts", import.meta.url).href));
  ({ upsertWebhookAuditEvent } = await import(new URL("../src/lib/services/plan-payment-recovery.service.ts", import.meta.url).href));
}

async function main() {
  await loadModules();

  {
    const client = new FakeSupabaseClient();
    client.tables.set("payment_records", [seedPaymentRecord({ solo_plus_case_id: null })]);

    const result = await confirmSoloPlusPayment({
      provider: "paystack",
      internalReference: "SPL-SUB-TEST",
      providerReference: "paystack-ref-1",
      paymentPurpose: "plan_subscription",
      amountNgn: "13000.00",
      currency: "NGN",
      onboardingSessionId: "session-1",
      requestIdempotencyKey: "solo-plus:test:none",
      serviceClient: client as never,
    });

    assert.equal(result, null);
    assert.equal(client.rpcCalls.length, 0);
  }

  {
    const client = new FakeSupabaseClient();
    client.tables.set("payment_records", [seedPaymentRecord()]);
    client.rpcResponses.set("confirm_solo_plus_payment_v1", {
      data: { kind: "confirmed" },
      error: null,
    });

    const result = await confirmSoloPlusPayment({
      provider: "paystack",
      internalReference: "SPL-SUB-TEST",
      providerReference: "paystack-ref-1",
      paymentPurpose: "plan_subscription",
      amountNgn: "13000.00",
      currency: "NGN",
      onboardingSessionId: "session-1",
      requestIdempotencyKey: "solo-plus:test:confirmed",
      rawProviderPayload: { provider: "paystack" },
      serviceClient: client as never,
    });

    assert.deepEqual(result, { kind: "confirmed" });
    assert.equal(client.rpcCalls.length, 1);
    assert.equal(client.rpcCalls[0]?.name, "confirm_solo_plus_payment_v1");
    assert.equal(client.rpcCalls[0]?.args.p_internal_reference, "SPL-SUB-TEST");
    assert.equal(client.rpcCalls[0]?.args.p_provider_reference, "paystack-ref-1");
    assert.equal(client.rpcCalls[0]?.args.p_onboarding_session_id, "session-1");
  }

  {
    const client = new FakeSupabaseClient();
    client.tables.set("payment_records", [seedPaymentRecord()]);
    client.rpcResponses.set("confirm_solo_plus_payment_v1", {
      data: { kind: "confirmed" },
      error: null,
    });

    const result = await processSuccessfulFiatPayment(client as never, {
      provider: "paystack",
      metadata: {
        type: "subscription",
        session_id: "session-1",
        amount_expected_kobo: 1300000,
      },
      amountKobo: 1300000,
      reference: "SPL-SUB-TEST",
      providerReference: "paystack-ref-1",
      channel: "card",
      rawProviderPayload: { provider: "paystack" },
    });

    assert.equal((result as { solo_plus?: boolean }).solo_plus, true);
    assert.equal((result as { status?: string }).status, "verification_pending");
    assert.equal(client.rpcCalls.length, 1);
  }

  await assert.rejects(
    () => processSuccessfulFiatPayment((() => {
      const client = new FakeSupabaseClient();
      client.tables.set("payment_records", [seedPaymentRecord({ payment_purpose: "plan_renewal" })]);
      return client;
    })() as never, {
      provider: "paystack",
      metadata: {
        type: "subscription_renewal",
        session_id: "session-1",
        amount_expected_kobo: 1300000,
      },
      amountKobo: 1300000,
      reference: "SPL-SUB-TEST",
      providerReference: "paystack-ref-1",
      channel: "card",
      rawProviderPayload: { provider: "paystack" },
    }),
    /Solo Plus renewal remains deferred/i,
  );

  await assert.rejects(
    () =>
      upsertWebhookAuditEvent((new FakeSupabaseClient()) as never, {
        provider: "paystack",
        eventType: "paystack.received",
        paymentMethod: "card",
        paymentPurpose: "plan_subscription",
        paymentReference: "SPL-SUB-TEST",
        providerReference: "paystack-ref-1",
        rawPayload: {},
        processingStatus: "received",
        idempotencyKey: "paystack:test:received",
      }),
    /requires merchantId/i,
  );

  {
    const client = new FakeSupabaseClient();
    await upsertWebhookAuditEvent(client as never, {
      provider: "paystack",
      eventType: "paystack.received",
      paymentMethod: "card",
      paymentPurpose: "plan_subscription",
      paymentReference: "SPL-SUB-TEST",
      providerReference: "paystack-ref-1",
      paidAmount: 13000,
      merchantId: "merchant-1",
      rawPayload: {},
      processingStatus: "received",
      idempotencyKey: "paystack:test:received",
    });

    assert.equal(client.upsertCalls.length, 1);
    assert.equal(client.upsertCalls[0]?.value.merchant_id, "merchant-1");
    assert.equal(client.upsertCalls[0]?.value.amount_kobo, 1300000);
  }

  const cryptoSubscriptionSource = readFileSync("src/app/api/checkout/crypto-subscription/route.ts", "utf8");
  const cryptoUpgradeSource = readFileSync("src/app/api/checkout/crypto-upgrade/route.ts", "utf8");
  const breetWebhookSource = readFileSync("src/app/api/webhooks/breet/route.ts", "utf8");
  const verifyAndProvisionSource = readFileSync("src/app/api/onboarding/verify-and-provision/route.ts", "utf8");

  assert.match(cryptoSubscriptionSource, /payment_record_id:\s*pendingPaymentRecord\.id/);
  assert.match(cryptoUpgradeSource, /payment_record_id:\s*pendingPaymentRecord\.id/);
  assert.match(breetWebhookSource, /const soloPlusConfirmation = await confirmSoloPlusPayment\(/);
  assert.match(breetWebhookSource, /Skipping payment_events audit without merchant_id/);
  assert.match(verifyAndProvisionSource, /Skipping payment_events audit without merchant_id during payment verification attempt/);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
