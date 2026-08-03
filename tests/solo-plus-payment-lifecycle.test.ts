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
let buildSoloPlusPaymentReference: PlanPaymentRecoveryModule["buildSoloPlusPaymentReference"];
let createPendingPlanPaymentRecord: PlanPaymentRecoveryModule["createPendingPlanPaymentRecord"];
let hasReusablePaymentInitialization: PlanPaymentRecoveryModule["hasReusablePaymentInitialization"];
let readPaymentInitializationSnapshot: PlanPaymentRecoveryModule["readPaymentInitializationSnapshot"];

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
  ({
    upsertWebhookAuditEvent,
    buildSoloPlusPaymentReference,
    createPendingPlanPaymentRecord,
    hasReusablePaymentInitialization,
    readPaymentInitializationSnapshot,
  } = await import(new URL("../src/lib/services/plan-payment-recovery.service.ts", import.meta.url).href));
}

class PendingPaymentWriteClient {
  readonly records = new Map<string, Record<string, unknown>>();

  from(table: string) {
    assert.equal(table, "payment_records");
    const client = this;

    return {
      upsert(value: Record<string, unknown>) {
        const recordId = "425fa617-d714-4d1c-9db8-4f46cb98bff1";
        const stored = {
          id: recordId,
          ...JSON.parse(JSON.stringify(value)),
          metadata: JSON.parse(JSON.stringify(value.metadata ?? {})),
          raw_provider_payload: JSON.parse(JSON.stringify(value.raw_provider_payload ?? {})),
          failure_reason: null,
        };
        client.records.set(recordId, stored);

        return {
          select() {
            return {
              async single() {
                return { data: JSON.parse(JSON.stringify(stored)), error: null };
              },
            };
          },
        };
      },
      update(updates: Record<string, unknown>) {
        return {
          async eq(column: string, id: string) {
            assert.equal(column, "id");
            const existing = client.records.get(id);
            assert.ok(existing, "expected pending payment record to exist");
            client.records.set(id, {
              ...existing,
              ...JSON.parse(JSON.stringify(updates)),
            });
            return { error: null };
          },
        };
      },
    };
  }
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

  {
    assert.equal(
      buildSoloPlusPaymentReference(
        "425fa617-d714-4d1c-9db8-4f46cb98bff1",
        "plan_upgrade",
      ),
      "SPL-UPG-425FA617D7144D1C9DB84F46CB98BFF1",
    );

    const client = new PendingPaymentWriteClient();
    const created = await createPendingPlanPaymentRecord(client as never, {
      internalReference: "SPL-UPG-TMP-8B32FB1C144D4013A80C6A8E146754F9",
      provider: "paystack",
      paymentMethod: "card",
      paymentPurpose: "plan_upgrade",
      customerEmail: "merchant@example.test",
      expectedAmount: 13000,
      planName: "solo_plus",
      planId: "solo_plus",
      merchantId: "11111111-1111-1111-1111-111111111111",
      soloPlusCaseId: "8b32fb1c-144d-4013-a80c-6a8e146754f9",
      metadata: { type: "subscription_upgrade" },
    });

    assert.equal(created.internal_reference, "SPL-UPG-425FA617D7144D1C9DB84F46CB98BFF1");
    assert.equal(created.provider_reference, "SPL-UPG-425FA617D7144D1C9DB84F46CB98BFF1");
    assert.equal(
      readPaymentInitializationSnapshot(created.metadata)?.status,
      "created",
    );
    assert.equal(
      readPaymentInitializationSnapshot(created.metadata)?.providerReference,
      "SPL-UPG-425FA617D7144D1C9DB84F46CB98BFF1",
    );
  }

  {
    const reusable = hasReusablePaymentInitialization(
      {
        provider_reference: "SPL-UPG-425FA617D7144D1C9DB84F46CB98BFF1",
        metadata: {
          payment_initialization: {
            status: "initialized",
            provider: "paystack",
            completionMode: "paystack_resume",
            providerReference: "SPL-UPG-425FA617D7144D1C9DB84F46CB98BFF1",
            authorizationUrl: "https://checkout.paystack.test/abc",
            accessCode: "ACCESS_CODE",
            checkoutUrl: null,
            providerTransactionReference: null,
            failureCode: null,
            failureMessage: null,
            initializedAt: "2026-07-17T10:00:00.000Z",
            lastUpdatedAt: "2026-07-17T10:00:00.000Z",
          },
        },
      },
      "paystack",
    );

    assert.equal(reusable?.authorizationUrl, "https://checkout.paystack.test/abc");
    assert.equal(reusable?.accessCode, "ACCESS_CODE");
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

  for (const provider of ["paystack", "monnify", "breet"] as const) {
    const client = new FakeSupabaseClient();
    await assert.rejects(
      () =>
        upsertWebhookAuditEvent(client as never, {
          provider,
          eventType: `${provider}.received`,
          paymentMethod: provider === "breet" ? "crypto" : "card",
          paymentPurpose: "plan_subscription",
          paymentReference: "SPL-SUB-TEST",
          providerReference: `${provider}-ref-1`,
          rawPayload: {},
          processingStatus: "received",
          idempotencyKey: `${provider}:test:received`,
        }),
      /requires merchantId/i,
    );
    assert.equal(client.upsertCalls.length, 0);
  }

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
  const paystackWebhookSource = readFileSync("src/app/api/webhooks/paystack/route.ts", "utf8");
  const monnifyWebhookSource = readFileSync("src/app/api/webhooks/monnify/route.ts", "utf8");
  const verifyAndProvisionSource = readFileSync("src/app/api/onboarding/verify-and-provision/route.ts", "utf8");
  const fiatConfirmationSource = readFileSync("src/lib/services/fiat-payment-confirmation.service.ts", "utf8");
  const legacyCompatibilityMigrationSource = readFileSync(
    "supabase/migrations/20260803_00_payment_events_legacy_merchant_compatibility.sql",
    "utf8",
  );

  assert.match(cryptoSubscriptionSource, /payment_record_id:\s*pendingPaymentRecord\.id/);
  assert.match(cryptoUpgradeSource, /payment_record_id:\s*pendingPaymentRecord\.id/);
  assert.match(breetWebhookSource, /const soloPlusConfirmation = await confirmSoloPlusPayment\(/);
  assert.match(breetWebhookSource, /Skipping payment_events audit without merchant_id/);
  assert.match(paystackWebhookSource, /if \(normalized\.merchantId\) \{[\s\S]*?await upsertWebhookAuditEvent/);
  assert.match(paystackWebhookSource, /Skipping payment_events audit without merchant_id for Paystack processed webhook/);
  assert.match(monnifyWebhookSource, /if \(normalized\.merchantId\) \{[\s\S]*?await upsertWebhookAuditEvent/);
  assert.match(monnifyWebhookSource, /Skipping payment_events audit without merchant_id for Monnify processed webhook/);
  assert.match(verifyAndProvisionSource, /Skipping payment_events audit without merchant_id during payment verification attempt/);
  assert.match(fiatConfirmationSource, /from\("payment_events"\)\.upsert\(\{[\s\S]*?merchant_id: invoice\.merchant_id/);
  assert.doesNotMatch(fiatConfirmationSource, /from\("payment_events"\)\.upsert\(\{[\s\S]*?merchant_id:\s*null/);
  assert.doesNotMatch(legacyCompatibilityMigrationSource, /\b(UPDATE|DELETE FROM)\s+public\.payment_events\b/i);
  assert.doesNotMatch(
    legacyCompatibilityMigrationSource,
    /\b(UPDATE|INSERT INTO|DELETE FROM)\s+public\.(solo_plus_cases|subscriptions|subscription_payments|refunds|payment_records)\b/i,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
