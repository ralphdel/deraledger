import assert from "node:assert/strict";

import {
  VERIFICATION_DISCLOSURE_VERSION,
  recordVerificationDisclosure,
} from "../src/lib/services/onboarding-flow.service";

type QueryResult = {
  data?: unknown;
  error: { message: string } | null;
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
  readonly insertErrors = new Map<string, { message: string }>();
  readonly updateErrors = new Map<string, { message: string }>();

  from(table: string) {
    return new FakeQueryBuilder(this, table);
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

    assert.deepEqual(result, { success: true });
    assert.equal(client.inserts.length, 1);
    assert.equal(client.inserts[0]?.table, "verification_disclosures");
    assert.equal(client.inserts[0]?.value.disclosure_version, "1.2");
    assert.equal(client.updates.length, 1);
    assert.equal(client.updates[0]?.table, "merchants");
    assert.equal(client.updates[0]?.filter?.column, "id");
    assert.equal(client.updates[0]?.filter?.value, "merchant-1");
  }

  {
    const client = new FakeSupabaseClient();
    const result = await recordVerificationDisclosure(client as never, {
      planType: "starter",
      context: "upgrade",
      merchantId: "merchant-1",
    });

    assert.deepEqual(result, { success: true });
    assert.equal(client.inserts.length, 0);
    assert.equal(client.updates.length, 0);
  }

  {
    const client = new FakeSupabaseClient();
    await recordVerificationDisclosure(client as never, {
      planType: "solo_plus",
      context: "upgrade",
      merchantId: "merchant-1",
    });

    assert.equal(
      client.inserts[0]?.value.disclosure_version,
      VERIFICATION_DISCLOSURE_VERSION,
    );
  }

  await assert.rejects(
    () => {
      const client = new FakeSupabaseClient();
      client.insertErrors.set("verification_disclosures", {
        message: "new row violates row-level security policy for table \"verification_disclosures\"",
      });
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
      client.updateErrors.set("merchants", {
        message: "permission denied for table merchants",
      });
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
