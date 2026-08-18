import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const migrationPath = "supabase/migrations/20260818_02_paid_flow_subscription_payments_compatibility.sql";
const preflightPath = "supabase/staging/preflight/020_paid_flow_subscription_payments_compatibility_check.sql";
const postflightPath = "supabase/staging/postflight/020_paid_flow_subscription_payments_compatibility_verify.sql";
const contractPath = "supabase/ops/paid_flow_schema_contract_check.sql";

function executableSql(source: string) {
  return source
    .replace(/--.*$/gm, "")
    .replace(/'(?:''|[^'])*'/g, "''");
}

async function run() {
  for (const path of [migrationPath, preflightPath, postflightPath, contractPath]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  const migration = readFileSync(migrationPath, "utf8");
  const preflight = readFileSync(preflightPath, "utf8");
  const postflight = readFileSync(postflightPath, "utf8");
  const contract = readFileSync(contractPath, "utf8");

  const requiredColumns = [
    "id", "merchant_id", "plan", "amount_ngn", "period_start", "period_end",
    "paystack_ref", "payment_type", "status", "created_at",
  ];
  for (const column of requiredColumns) {
    assert.match(
      migration,
      new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`),
      `Migration 020 must idempotently cover subscription_payments.${column}.`,
    );
    assert.match(preflight, new RegExp(`\\('${column}'`));
    assert.match(postflight, new RegExp(`\\('${column}'`));
    assert.match(contract, new RegExp(`\\('subscription_payments', '${column}'\\)`));
  }

  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.subscription_payments/);
  assert.match(migration, /amount_ngn NUMERIC\(10,2\) NOT NULL/);
  assert.match(migration, /subscription_payments_pkey/);
  assert.match(migration, /subscription_payments_paystack_ref_key UNIQUE \(paystack_ref\)/);
  assert.match(migration, /subscription_payments_merchant_id_fkey[\s\S]*REFERENCES public\.merchants\(id\) ON DELETE CASCADE/);
  assert.match(migration, /ALTER TABLE public\.subscription_payments ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /CREATE POLICY sub_payments_merchant[\s\S]*FOR SELECT[\s\S]*TO authenticated/);
  assert.match(migration, /merchants\.user_id = auth\.uid\(\)/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.subscription_payments FROM PUBLIC/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.subscription_payments FROM anon/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.subscription_payments FROM authenticated/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.subscription_payments TO authenticated/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.subscription_payments TO service_role/);
  assert.match(migration, /populated public\.subscription_payments is missing columns/);

  const executableMigration = executableSql(migration);
  assert.match(executableMigration, /BEGIN;[\s\S]*COMMIT;/);
  assert.doesNotMatch(executableMigration, /\b(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE|DROP\s+)\b/i);
  assert.doesNotMatch(executableMigration, /ALTER TABLE public\.payment_events/i);
  assert.doesNotMatch(executableMigration, /ALTER TABLE public\.(?:subscriptions|workspace_subscriptions|payment_records|onboarding_sessions|plan_migrations)/i);

  for (const source of [preflight, postflight, contract]) {
    assert.doesNotMatch(source, /^\s*\\(?:set|pset|ir|i)\b/im);
    assert.match(source, /check_name, object_type, expected, actual, status, details/);
  }
  for (const source of [preflight, postflight]) {
    assert.match(source, /SET TRANSACTION READ ONLY/);
    assert.match(source, /ROLLBACK;/);
    assert.doesNotMatch(
      executableSql(source),
      /\b(?:CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|GRANT|REVOKE)\b/i,
      "Preflight and postflight executable SQL must remain read-only.",
    );
  }

  assert.match(preflight, /target\.relid IS NULL THEN 'WARN'/);
  assert.match(preflight, /Stop on every FAIL/);
  assert.match(postflight, /subscription_payments=0 if absent at preflight/i);
  for (const source of [preflight, postflight, contract]) {
    assert.match(source, /Migration 017[\s\S]*service-only/i);
    assert.match(source, /payment_events/);
    assert.match(source, /PUBLIC/);
    assert.match(source, /anon/);
    assert.match(source, /authenticated/);
  }

  assert.match(contract, /payment testing remains prohibited unless every returned row is PASS/i);

  console.log("paid-flow-schema-migration-020.test.ts passed");
}

void run();
