import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migrationPath = "supabase/migrations/20260819_00_merchant_business_address_compatibility.sql";
const preflightPath = "supabase/staging/preflight/022_merchant_business_address_compatibility_snapshot.sql";
const postflightPath = "supabase/staging/postflight/022_merchant_business_address_compatibility_verify.sql";
const addressColumns = [
  "business_street",
  "business_city",
  "business_state",
  "business_country",
] as const;

function stripSqlComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\r\n]*/g, " ");
}

async function run() {
  const migration = readFileSync(migrationPath, "utf8");
  const preflight = readFileSync(preflightPath, "utf8");
  const postflight = readFileSync(postflightPath, "utf8");
  const historicalCanonicalSql = readFileSync("business_address_migration.sql", "utf8");
  const actions = readFileSync("src/lib/actions.ts", "utf8");
  const settings = readFileSync("src/app/(dashboard)/settings/page.tsx", "utf8");
  const dashboardLayout = readFileSync("src/app/(dashboard)/layout.tsx", "utf8");

  assert.match(migration, /^BEGIN;[\s\S]*COMMIT;\s*$/m);
  assert.match(migration, /NOTIFY pgrst, 'reload schema';/);
  assert.match(migration, /ALTER TABLE public\.merchants[\s\S]*ADD COLUMN IF NOT EXISTS business_street text/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS business_city text/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS business_state text/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS business_country text/);
  assert.match(migration, /expected nullable text without a default/);
  for (const column of addressColumns) {
    assert.match(historicalCanonicalSql, new RegExp(`ADD COLUMN IF NOT EXISTS ${column} TEXT`, "i"));
  }

  const migrationWithoutComments = stripSqlComments(migration);
  assert.doesNotMatch(migrationWithoutComments, /^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/im);
  assert.doesNotMatch(migrationWithoutComments, /\b(?:setup_mode|live_features_enabled|verification_status)\b/);

  for (const source of [preflight, postflight]) {
    assert.match(source, /SET TRANSACTION READ ONLY;/);
    assert.match(source, /ROLLBACK;/);
    assert.doesNotMatch(source, /^\s*\\(?:set|pset|ir|i)\b/im);
    assert.match(source, /check_name, object_type, expected, actual, status, details/);
    for (const column of addressColumns) assert.match(source, new RegExp(column));
  }
  assert.match(preflight, /actual_type IS NULL THEN 'WARN'/);
  assert.match(postflight, /actual_type = 'text'[\s\S]*NOT actual_not_null[\s\S]*actual_default IS NULL THEN 'PASS'/);

  for (const column of addressColumns) {
    assert.match(settings, new RegExp(`${column}:`));
    assert.match(dashboardLayout, new RegExp(`merchant\\?\\.${column}`));
  }
  assert.doesNotMatch(settings, /\b(?:business_address|address|city|state):\s*(?:business|merchant)/);

  const submitKycStart = actions.indexOf("export async function submitKycAction");
  const submitKycEnd = actions.indexOf("export async function", submitKycStart + 1);
  assert.notEqual(submitKycStart, -1);
  assert.notEqual(submitKycEnd, -1);
  const submitKycAction = actions.slice(submitKycStart, submitKycEnd);
  for (const column of addressColumns) assert.match(submitKycAction, new RegExp(column));
  assert.doesNotMatch(submitKycAction, /syncMerchantSetupStatus/);
  assert.doesNotMatch(submitKycAction, /\b(?:setup_mode|live_features_enabled|verification_status)\b/);

  console.log("merchant-business-address-compatibility.test.ts passed");
}

void run();
