import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";

type QueryResponse = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

type FakeUser = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
};

class FakeQueryBuilder {
  private readonly client: FakeSupabaseClient;
  private readonly table: string;
  private filters: Array<{ column: string; value: unknown }> = [];
  private limitCount: number | null = null;

  constructor(client: FakeSupabaseClient, table: string) {
    this.client = client;
    this.table = table;
  }

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, value });
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
    this.client.lastMethodByTable.set(this.table, "maybeSingle");
    const error = this.client.errorsByTable.get(this.table) || null;
    if (error) {
      return { data: null, error };
    }
    const rows = this.resolveRows();
    return { data: rows[0] ?? null, error: null };
  }

  async single(): Promise<QueryResponse> {
    this.client.lastMethodByTable.set(this.table, "single");
    const error = this.client.errorsByTable.get(this.table) || null;
    if (error) {
      return { data: null, error };
    }
    const rows = this.resolveRows();
    return { data: rows[0] ?? null, error: null };
  }

  private resolveRows(): unknown[] {
    let rows = (this.client.tables.get(this.table) ?? []).map((row) =>
      JSON.parse(JSON.stringify(row)),
    );

    for (const filter of this.filters) {
      rows = rows.filter((row) => (row as Record<string, unknown>)[filter.column] === filter.value);
    }

    if (this.limitCount != null) {
      rows = rows.slice(0, this.limitCount);
    }

    return rows;
  }
}

class FakeSupabaseClient {
  readonly tables = new Map<string, unknown[]>();
  readonly errorsByTable = new Map<string, { message: string; code?: string }>();
  readonly lastMethodByTable = new Map<string, string>();
  currentUser: FakeUser | null = null;

  auth = {
    getSession: async () => ({
      data: { session: this.currentUser ? { user: this.currentUser } : null },
      error: null,
    }),
  };

  from(table: string) {
    return new FakeQueryBuilder(this, table) as never;
  }
}

function installSupabaseClientStub(fakeClient: FakeSupabaseClient) {
  const require = createRequire(import.meta.url);
  const clientModulePath = require.resolve("../src/lib/supabase/client.ts");
  const shim = new Module(clientModulePath);
  shim.filename = clientModulePath;
  shim.loaded = true;
  shim.exports = {
    createClient: () => fakeClient,
  };
  require.cache[clientModulePath] = shim;
}

async function loadDataModule() {
  return import(new URL("../src/lib/data.ts", import.meta.url).href);
}

async function run() {
  const fakeClient = new FakeSupabaseClient();
  installSupabaseClientStub(fakeClient);

  const dataModule = await loadDataModule();
  const { getMerchant, getActiveSubscription } = dataModule as typeof import("../src/lib/data");

  fakeClient.currentUser = {
    id: "user-1",
    email: "owner@example.test",
    email_confirmed_at: "2026-07-16T00:00:00.000Z",
    user_metadata: {},
    app_metadata: {},
  };
  fakeClient.tables.set("merchants", [
    {
      id: "merchant-1",
      user_id: "user-1",
      email: "owner@example.test",
      verification_status: "unverified",
      subscription_plan: "starter",
      merchant_tier: "starter",
    },
  ]);
  fakeClient.tables.set("subscriptions", []);
  fakeClient.tables.set("merchant_team", []);

  const merchant = await getMerchant("merchant-1");
  assert.equal(merchant?.currentUserRole, "owner");
  assert.equal(merchant?.subscription_status, "none");
  assert.equal(fakeClient.lastMethodByTable.get("subscriptions"), "maybeSingle");

  const subscription = await getActiveSubscription("merchant-1");
  assert.equal(subscription, null);
  assert.equal(fakeClient.lastMethodByTable.get("subscriptions"), "maybeSingle");

  const consoleErrors: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args);
  };

  try {
    fakeClient.errorsByTable.set("subscriptions", {
      message: "Could not find table in schema cache",
      code: "PGRST205",
    });

    const errorMerchant = await getMerchant("merchant-1");
    assert.equal(errorMerchant?.currentUserRole, "owner");
    assert.equal(errorMerchant?.subscription_status, "none");

    const erroredSubscription = await getActiveSubscription("merchant-1");
    assert.equal(erroredSubscription, null);
    assert.equal(consoleErrors.length >= 2, true);
    assert.equal(
      consoleErrors.some((args) =>
        String(args[0]).includes("getMerchant subscription lookup:"),
      ),
      true,
    );
    assert.equal(
      consoleErrors.some((args) => String(args[0]).includes("getActiveSubscription:")),
      true,
    );
  } finally {
    console.error = originalConsoleError;
  }

  console.log("subscription-data-contract.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
