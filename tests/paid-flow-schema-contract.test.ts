import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

async function run() {
  const sql = readFileSync("supabase/ops/paid_flow_schema_contract_check.sql", "utf8");
  for (const table of [
    "onboarding_sessions", "payment_records", "payment_events", "subscriptions",
    "subscription_payments", "workspace_subscriptions", "plan_migrations",
  ]) {
    assert.match(sql, new RegExp(`\\('${table}'\\)`));
  }
  for (const column of [
    "expected_amount", "account_setup_status", "onboarding_session_id",
    "payment_reference", "paystack_ref", "expiry_date", "migration_key",
  ]) {
    assert.match(sql, new RegExp(column));
  }
  assert.match(sql, /check_name, object_type, expected, actual, status, details/);
  assert.match(sql, /'PASS'/);
  assert.match(sql, /'WARN'/);
  assert.match(sql, /'FAIL'/);
  assert.doesNotMatch(sql, /\\(?:set|pset|i)\b/i);
  assert.doesNotMatch(sql, /\b(?:insert\s+into|update\s+public|delete\s+from|alter\s+table|create\s+table|drop\s+table|truncate)\b/i);

  console.log("paid-flow-schema-contract tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
