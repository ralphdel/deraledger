import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

type BrowserCaseServiceModule = typeof import("../src/lib/solo-plus/server/browser-case-service");
type AccessContextModule = typeof import("../src/lib/solo-plus/server/access-context");

let createSoloPlusBrowserCaseService: BrowserCaseServiceModule["createSoloPlusBrowserCaseService"];
let SoloPlusServerAccessError: AccessContextModule["SoloPlusServerAccessError"];

type QueryResponse = {
  data: unknown;
  error: { message: string } | null;
};

type FakeUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
  email_confirmed_at?: string | null;
};

class FakeQueryBuilder {
  private readonly client: FakeSupabaseClient;
  private readonly table: string;
  private filters: Array<{ type: "eq" | "in"; column: string; value: unknown }> = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private limitCount: number | null = null;

  constructor(client: FakeSupabaseClient, table: string) {
    this.client = client;
    this.table = table;
  }

  select(): FakeQueryBuilder {
    return this;
  }

  eq(column: string, value: unknown): FakeQueryBuilder {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  in(column: string, values: readonly unknown[]): FakeQueryBuilder {
    this.filters.push({ type: "in", column, value: [...values] });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): FakeQueryBuilder {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(count: number): FakeQueryBuilder {
    this.limitCount = count;
    return this;
  }

  async maybeSingle(): Promise<QueryResponse> {
    const error = this.client.queryErrors.get(this.table) ?? null;
    if (error) {
      return { data: null, error };
    }

    const rows = this.resolveRows();
    return { data: rows[0] ?? null, error: null };
  }

  async single(): Promise<QueryResponse> {
    const error = this.client.queryErrors.get(this.table) ?? null;
    if (error) {
      return { data: null, error };
    }

    const rows = this.resolveRows();
    return { data: rows[0] ?? null, error: null };
  }

  then<TResult1 = QueryResponse, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResponse) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const error = this.client.queryErrors.get(this.table) ?? null;
    if (error) {
      return Promise.resolve({ data: null, error }).then(onfulfilled, onrejected);
    }

    return Promise.resolve({ data: this.resolveRows(), error: null }).then(
      onfulfilled,
      onrejected,
    );
  }

  private resolveRows(): unknown[] {
    let rows = (this.client.tables.get(this.table) ?? []).map((row) =>
      JSON.parse(JSON.stringify(row)),
    );

    for (const filter of this.filters) {
      rows = rows.filter((row) => {
        const value = (row as Record<string, unknown>)[filter.column];
        if (filter.type === "eq") {
          return value === filter.value;
        }

        return (filter.value as readonly unknown[]).includes(value);
      });
    }

    for (const order of [...this.orders].reverse()) {
      rows.sort((left, right) => {
        const leftValue = (left as Record<string, unknown>)[order.column];
        const rightValue = (right as Record<string, unknown>)[order.column];
        if (leftValue === rightValue) {
          return 0;
        }

        if (leftValue == null) {
          return order.ascending ? -1 : 1;
        }

        if (rightValue == null) {
          return order.ascending ? 1 : -1;
        }

        const comparison = String(leftValue).localeCompare(String(rightValue));
        return order.ascending ? comparison : -comparison;
      });
    }

    if (this.limitCount != null) {
      rows = rows.slice(0, this.limitCount);
    }

    return rows;
  }
}

class FakeSupabaseClient {
  readonly tables = new Map<string, unknown[]>();
  readonly queryErrors = new Map<string, { message: string }>();
  readonly rpcResponses = new Map<string, QueryResponse>();
  currentUser: FakeUser | null = null;

  auth = {
    getUser: async () => ({
      data: { user: this.currentUser },
      error: this.currentUser ? null : { message: "missing user" },
    }),
  };

  from(table: string) {
    return new FakeQueryBuilder(this, table) as never;
  }

  async rpc(name: string) {
    return this.rpcResponses.get(name) ?? { data: null, error: null };
  }
}

function createEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  };
}

function seedBaseTables(client: FakeSupabaseClient) {
  client.tables.set("merchants", []);
  client.tables.set("solo_plus_cases", []);
  client.tables.set("solo_plus_case_requirements", []);
  client.tables.set("solo_plus_case_events", []);
}

function buildCaseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    merchant_id: "22222222-2222-4222-8222-222222222222",
    onboarding_session_id: null,
    flow_origin: "upgrade",
    source_plan: "solo_lite",
    target_plan: "solo_plus",
    case_status: "awaiting_payment",
    payment_status: "pending",
    refund_status: "none",
    payment_record_id: null,
    payment_provider: null,
    payment_reference: null,
    expected_amount: "13000.00",
    payment_currency: "NGN",
    requirements_policy_version: "solo-plus-payment-init-v1",
    requirements_snapshot: { commitScope: "solo-plus" },
    active_plan_snapshot: "solo_lite",
    rejection_reason: null,
    approved_at: null,
    approved_by_admin_id: null,
    rejected_at: null,
    rejected_by_admin_id: null,
    reopened_at: null,
    reopened_by_admin_id: null,
    idempotency_key: "solo-plus:upgrade:22222222-2222-4222-8222-222222222222",
    activation_idempotency_key: null,
    refund_idempotency_key: null,
    row_version: 1,
    audit_metadata: {},
    created_at: "2026-07-16T08:00:00.000Z",
    updated_at: "2026-07-16T08:05:00.000Z",
    ...overrides,
  };
}

function buildRequirementRow(
  requirementCode: string,
  overrides: Record<string, unknown> = {},
) {
  const requirementIds: Record<string, string> = {
    activity_profile: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    bvn: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    id_document: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    proof_of_address: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    selfie_liveness: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    settlement_account: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  };

  return {
    id: requirementIds[requirementCode] || "99999999-9999-4999-8999-999999999999",
    case_id: "11111111-1111-4111-8111-111111111111",
    requirement_code: requirementCode,
    requirement_state: "not_started",
    verification_log_id: null,
    evidence_source_type: null,
    evidence_source_id: null,
    evidence_reference: null,
    original_completed_at: null,
    reuse_decision_at: null,
    reuse_reason: null,
    policy_rule_applied: null,
    reviewed_by_admin_id: null,
    review_note: null,
    provider_name: null,
    provider_reference: null,
    failure_reason: null,
    completed_at: null,
    metadata: {},
    created_at: "2026-07-16T08:00:00.000Z",
    updated_at: "2026-07-16T08:05:00.000Z",
    ...overrides,
  };
}

async function run() {
  assert.match(
    readFileSync("src/lib/solo-plus/server/browser-case-service.ts", "utf8"),
    /^import "server-only";/,
  );

  const require = createRequire(import.meta.url);
  const serverOnlyId = require.resolve("server-only");
  require.cache[serverOnlyId] = {
    exports: {},
    filename: serverOnlyId,
    id: serverOnlyId,
    loaded: true,
    path: serverOnlyId,
    children: [],
    paths: [],
    isPreloading: false,
    parent: null,
    require,
  } as NodeModule;

  ({ createSoloPlusBrowserCaseService } = await import("../src/lib/solo-plus/server/browser-case-service"));
  ({ SoloPlusServerAccessError } = await import("../src/lib/solo-plus/server/access-context"));

  {
    const authClient = new FakeSupabaseClient();
    const serviceClient = new FakeSupabaseClient();
    seedBaseTables(authClient);
    seedBaseTables(serviceClient);

    authClient.currentUser = {
      id: "owner-user-id",
      email: "solo-plus-owner-staging@example.com",
      email_confirmed_at: "2026-07-16T08:00:00.000Z",
    };
    serviceClient.tables.set("merchants", [
      {
        id: "22222222-2222-4222-8222-222222222222",
        user_id: "owner-user-id",
        subscription_plan: "starter",
      },
    ]);

    const service = await createSoloPlusBrowserCaseService({
      authClient,
      serviceClient,
      env: createEnv(),
    });

    const result = await service.readCurrentCase({});
    assert.equal(result, null);
  }

  {
    const authClient = new FakeSupabaseClient();
    const serviceClient = new FakeSupabaseClient();
    seedBaseTables(authClient);
    seedBaseTables(serviceClient);

    authClient.currentUser = {
      id: "owner-user-id",
      email: "solo-plus-owner-staging@example.com",
      email_confirmed_at: "2026-07-16T08:00:00.000Z",
    };
    serviceClient.tables.set("merchants", [
      {
        id: "22222222-2222-4222-8222-222222222222",
        user_id: "owner-user-id",
        subscription_plan: "starter",
      },
    ]);
    serviceClient.tables.set("solo_plus_cases", [buildCaseRow()]);
    serviceClient.queryErrors.set("solo_plus_case_requirements", {
      message: "Could not find the table 'public.solo_plus_case_requirements' in the schema cache",
    });
    serviceClient.rpcResponses.set("solo_plus_case_bundle_payload_v1", {
      data: {
        case: buildCaseRow(),
        requirements: [
          buildRequirementRow("activity_profile"),
          buildRequirementRow("bvn"),
          buildRequirementRow("id_document"),
          buildRequirementRow("proof_of_address"),
          buildRequirementRow("selfie_liveness"),
          buildRequirementRow("settlement_account"),
        ],
        created_event: {
          id: "33333333-3333-4333-8333-333333333333",
          case_id: "11111111-1111-4111-8111-111111111111",
          event_type: "case_created",
          previous_state: {},
          new_state: { caseStatus: "draft" },
          actor_type: "merchant",
          actor_id: "44444444-4444-4444-8444-444444444444",
          request_idempotency_key: "solo-plus:create",
          reason: null,
          policy_version: "solo-plus-payment-init-v1",
          created_at: "2026-07-16T08:00:00.000Z",
        },
      },
      error: null,
    });

    const service = await createSoloPlusBrowserCaseService({
      authClient,
      serviceClient,
      env: createEnv(),
    });

    const firstResult = await service.readCurrentCase({});
    const secondResult = await service.readCurrentCase({});
    assert.ok(firstResult);
    assert.ok(secondResult);
    assert.equal(firstResult.caseRecord.caseStatus, "awaiting_payment");
    assert.equal(firstResult.caseRecord.paymentStatus, "pending");
    assert.equal(firstResult.caseRecord.paymentReference, null);
    assert.equal(firstResult.latestReviewDecisionEvent, null);
    assert.equal(firstResult.requirements.length, 6);
    assert.deepEqual(
      JSON.parse(JSON.stringify(firstResult)),
      JSON.parse(JSON.stringify(secondResult)),
    );
  }

  {
    const authClient = new FakeSupabaseClient();
    const serviceClient = new FakeSupabaseClient();
    seedBaseTables(authClient);
    seedBaseTables(serviceClient);

    await assert.rejects(
      () =>
        createSoloPlusBrowserCaseService({
          authClient,
          serviceClient,
          env: createEnv(),
        }),
      (error: unknown) => {
        assert.ok(error instanceof SoloPlusServerAccessError);
        assert.equal(error.code, "SOLO_PLUS_SERVER_UNAUTHORIZED");
        return true;
      },
    );
  }

  console.log("solo-plus-browser-case-service.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
