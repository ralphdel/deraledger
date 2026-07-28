import assert from "node:assert/strict";
import {
  getPlanDisplayName,
  getPlanPrice,
  getStoragePlanCode,
  isPlanAvailable,
  logPlanMigration,
  normalizePlanCode,
} from "../src/lib/plans";

async function run() {
  assert.equal(normalizePlanCode("individual"), "solo_lite");
  assert.equal(normalizePlanCode("solo_lite"), "solo_lite");
  assert.equal(normalizePlanCode("corporate"), "business");
  assert.equal(normalizePlanCode("business"), "business");
  assert.equal(normalizePlanCode("solo_plus"), "solo_plus");

  assert.equal(getPlanDisplayName("individual"), "Solo Lite");
  assert.equal(getPlanDisplayName("corporate"), "Business");
  assert.equal(getPlanDisplayName("solo_plus"), "Solo Plus");

  assert.equal(getPlanPrice("starter"), 0);
  assert.equal(getPlanPrice("individual"), 5000);
  assert.equal(getPlanPrice("solo_plus"), 13000);
  assert.equal(getPlanPrice("corporate"), 20000);

  assert.equal(getStoragePlanCode("solo_lite"), "individual");
  assert.equal(getStoragePlanCode("business"), "business");
  assert.equal(getStoragePlanCode("corporate"), "business");
  assert.equal(getStoragePlanCode("solo_plus"), "solo_plus");

  assert.equal(isPlanAvailable("starter", { solo_plus: false }), true);
  assert.equal(
    isPlanAvailable("solo_plus", { solo_plus: false, solo_plus_kyc: false }),
    false,
  );
  assert.equal(
    isPlanAvailable("solo_plus", { solo_plus: true, solo_plus_kyc: false }),
    false,
  );
  assert.equal(
    isPlanAvailable("solo_plus", { solo_plus: false, solo_plus_kyc: true }),
    false,
  );
  assert.equal(
    isPlanAvailable("solo_plus", { solo_plus: true, solo_plus_kyc: true }),
    true,
  );

  const upserts: Array<{ payload: Record<string, unknown>; options: Record<string, unknown> }> = [];
  const adminClient = {
    from(table: string) {
      assert.equal(table, "plan_migrations");
      return {
        upsert(payload: Record<string, unknown>, options: Record<string, unknown>) {
          upserts.push({ payload, options });
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  const logged = await logPlanMigration(adminClient, {
    merchantId: "merchant-1",
    sourceTable: "merchants",
    sourceRecordId: "merchant-1",
    oldPlanCode: "individual",
    context: "test",
  });
  assert.deepEqual(logged, { logged: true });
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].payload.old_plan_code, "individual");
  assert.equal(upserts[0].payload.new_plan_code, "solo_lite");
  assert.equal(upserts[0].payload.migration_type, "compatibility_alias");

  const skipped = await logPlanMigration(adminClient, {
    merchantId: "merchant-1",
    sourceTable: "merchants",
    sourceRecordId: "merchant-1",
    oldPlanCode: "solo_plus",
    context: "test",
  });
  assert.deepEqual(skipped, { logged: false, reason: "not_alias" });

  console.log("plans.test.ts passed");
}

void run();
