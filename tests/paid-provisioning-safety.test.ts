import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ensurePaidCreatorMembership,
  PaidProvisioningError,
} from "../src/lib/services/paid-provisioning.service";

class Query {
  error: { message: string } | null = null;
  private operation = "select";
  private value: Record<string, unknown> | null = null;

  constructor(private client: FakeClient, private table: string) {}
  select() { this.operation = "select"; return this; }
  eq() { return this; }
  limit() { return this; }
  update(value: Record<string, unknown>) { this.operation = "update"; this.value = value; this.error = this.client.writeError; this.client.writes.push({ table: this.table, operation: this.operation, value }); return this; }
  insert(value: Record<string, unknown>) { this.operation = "insert"; this.value = value; this.error = this.client.writeError; this.client.writes.push({ table: this.table, operation: this.operation, value }); return this; }
  async maybeSingle() {
    if (this.table === "roles") return { data: this.client.role, error: this.client.roleError };
    return { data: this.client.membership, error: this.client.membershipError };
  }
}

class FakeClient {
  role: { id: string } | null = { id: "admin-role-id" };
  membership: { id: string } | null = null;
  roleError: { message: string } | null = null;
  membershipError: { message: string } | null = null;
  writeError: { message: string } | null = null;
  writes: Array<{ table: string; operation: string; value: Record<string, unknown> }> = [];
  from(table: string) { return new Query(this, table); }
}

async function run() {
  const created = new FakeClient();
  await ensurePaidCreatorMembership(created as never, { merchantId: "merchant-1", userId: "user-1" });
  assert.deepEqual(created.writes[0], {
    table: "merchant_team",
    operation: "insert",
    value: {
      merchant_id: "merchant-1",
      user_id: "user-1",
      role_id: "admin-role-id",
      is_active: true,
      must_change_password: true,
    },
  });

  const existing = new FakeClient();
  existing.membership = { id: "membership-1" };
  await ensurePaidCreatorMembership(existing as never, { merchantId: "merchant-1", userId: "user-1" });
  assert.equal(existing.writes[0]?.operation, "update");
  assert.equal(existing.writes[0]?.value.role_id, "admin-role-id");

  const failed = new FakeClient();
  failed.writeError = { message: "write failed" };
  await assert.rejects(
    ensurePaidCreatorMembership(failed as never, { merchantId: "merchant-1", userId: "user-1" }),
    (error: unknown) => error instanceof PaidProvisioningError && error.stage === "membership_write",
  );

  const confirmation = readFileSync("src/lib/services/fiat-payment-confirmation.service.ts", "utf8");
  const initialConfirmation = confirmation.slice(
    confirmation.indexOf("async function confirmInitialSubscription"),
    confirmation.indexOf("async function confirmInvoicePayment"),
  );
  assert.doesNotMatch(initialConfirmation, /role:\s*["']owner["']/);
  assert.doesNotMatch(initialConfirmation, /\.from\("merchants"\)\.delete\(/);
  assert.doesNotMatch(initialConfirmation, /\.from\("merchant_team"\)\.delete\(/);
  assert.match(initialConfirmation, /ensurePaidCreatorMembership/);
  assert.match(initialConfirmation, /subscriptionError/);
  assert.match(initialConfirmation, /subscriptionPaymentError/);
  assert.ok(
    initialConfirmation.indexOf("subscriptionPaymentError") < initialConfirmation.indexOf("planActivationError"),
    "The merchant plan must remain fail-closed until all subscription writes succeed.",
  );
  assert.match(initialConfirmation, /sessionConfirmError/);
  assert.match(initialConfirmation, /plan: "starter"/);
  assert.match(initialConfirmation, /auth\.admin\.updateUserById\(userId/);

  console.log("paid-provisioning-safety tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
