import assert from "node:assert/strict";

import {
  VERIFICATION_DISCLOSURE_VERSION,
  recordVerificationDisclosure,
} from "../src/lib/services/onboarding-flow.service";

type QueryResult = {
  data?: unknown;
  error: { message: string } | null;
};

type RpcCall = {
  name: string;
  args: Record<string, unknown>;
};

class FakeQueryBuilder {
  private readonly client: FakeSupabaseClient;
  private readonly table: string;
  private updatePayload: Record<string, unknown> | null = null;
  private eqFilter: { column: string; value: unknown } | null = null;

  constructor(client: FakeSupabaseClient, table: string) {
    this.client = client;
    this.table = table;
  }

  insert(value: Record<string, unknown>): Promise<QueryResult> {
    this.client.inserts.push({ table: this.table, value: JSON.parse(JSON.stringify(value)) });
    const error = this.client.insertErrors.get(this.table) ?? null;
    return Promise.resolve({ error });
  }

  update(value: Record<string, unknown>) {
    this.updatePayload = JSON.parse(JSON.stringify(value));
    return this;
  }

  eq(column: string, value: unknown): Promise<QueryResult> {
    this.eqFilter = { column, value };
    this.client.updates.push({
      table: this.table,
      value: this.updatePayload ? JSON.parse(JSON.stringify(this.updatePayload)) : null,
      filter: this.eqFilter,
    });
    const error = this.client.updateErrors.get(this.table) ?? null;
    return Promise.resolve({ error });
  }
}

class FakeSupabaseClient {
  readonly inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  readonly updates: Array<{
    table: string;
    value: Record<string, unknown> | null;
    filter: { column: string; value: unknown } | null;
  }> = [];
  readonly rpcCalls: RpcCall[] = [];
  readonly insertErrors = new Map<string, { message: string }>();
  readonly updateErrors = new Map<string, { message: string }>();
  rpcResult: QueryResult = { data: { kind: "created" }, error: null };

  from(table: string) {
    return new FakeQueryBuilder(this, table);
  }

  rpc(name: string, args: Record<string, unknown>): Promise<QueryResult> {
    this.rpcCalls.push({ name, args: JSON.parse(JSON.stringify(args)) });
    return Promise.resolve(this.rpcResult);
  }
}

async function run() {
  {
    const client = new FakeSupabaseClient();
    const result = await recordVerificationDisclosure(client as never, {
      planType: "solo_plus",
      context: "upgrade",
      userId: "user-1",
      merchantId: "merchant-1",
      disclosureVersion: "1.2",
      deviceMetadata: { source: "test" },
    });

    assert.deepEqual(result, { success: true, kind: "created" });
    assert.equal(client.rpcCalls.length, 1);
    assert.equal(client.rpcCalls[0]?.name, "record_verification_disclosure_acceptance_v1");
    assert.equal(client.rpcCalls[0]?.args.p_user_id, "user-1");
    assert.equal(client.rpcCalls[0]?.args.p_merchant_id, "merchant-1");
    assert.equal(client.rpcCalls[0]?.args.p_plan_type, "solo_plus");
    assert.equal(client.rpcCalls[0]?.args.p_context, "upgrade");
    assert.equal(client.rpcCalls[0]?.args.p_disclosure_version, VERIFICATION_DISCLOSURE_VERSION);
    assert.equal(client.inserts.length, 0);
    assert.equal(client.updates.length, 0);
  }

  {
    const client = new FakeSupabaseClient();
    const result = await recordVerificationDisclosure(client as never, {
      planType: "starter",
      context: "upgrade",
      merchantId: "merchant-1",
    });

    assert.deepEqual(result, { success: true });
    assert.equal(client.rpcCalls.length, 0);
    assert.equal(client.inserts.length, 0);
    assert.equal(client.updates.length, 0);
  }

  {
    const client = new FakeSupabaseClient();
    client.rpcResult = { data: { kind: "replayed" }, error: null };
    await recordVerificationDisclosure(client as never, {
      planType: "solo_plus",
      context: "upgrade",
      merchantId: "merchant-1",
      disclosureVersion: "9.9",
    });

    assert.equal(
      client.rpcCalls[0]?.args.p_disclosure_version,
      VERIFICATION_DISCLOSURE_VERSION,
    );
    assert.equal(client.rpcCalls[0]?.args.p_device_metadata instanceof Object, true);
  }

  await assert.rejects(
    () => {
      const client = new FakeSupabaseClient();
      client.rpcResult = { data: null, error: {
        message: "new row violates row-level security policy for table \"verification_disclosures\"",
      } };
      return recordVerificationDisclosure(client as never, {
        planType: "solo_plus",
        context: "upgrade",
        merchantId: "merchant-1",
      });
    },
    /Failed to persist verification disclosure audit record\./,
  );

  await assert.rejects(
    () => {
      const client = new FakeSupabaseClient();
      client.rpcResult = { data: { kind: "version_conflict" }, error: null };
      return recordVerificationDisclosure(client as never, {
        planType: "solo_plus",
        context: "upgrade",
        merchantId: "merchant-1",
      });
    },
    /Failed to persist verification disclosure acknowledgement\./,
  );

  console.log("verification-disclosure-contract.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
