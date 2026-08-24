import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync("scripts/rehearse-reviewed-profile-bootstrap-rpc-local.ps1", "utf8");
const runbook = readFileSync("docs/prd-phase-2-bootstrap-rpc-disposable-rehearsal-runbook.md", "utf8");

function run() {
  assert.match(script, /\[string\]\$LocalConnectionString/);
  assert.match(script, /REHEARSE LOCAL DISPOSABLE DB ONLY/);
  assert.match(script, /-not \$Execute/);
  assert.match(script, /supabase\\\.co/i);
  assert.match(script, /supabase\\\.com/i);
  for (const value of ["vercel", "production", "staging", "service_role", "anon", "eyJ"]) assert.match(script, new RegExp(value, "i"));
  assert.match(script, /localhost', '127\.0\.0\.1', 'host\.docker\.internal/);
  assert.match(script, /LOCAL_REHEARSAL_NONLOCAL_HOST_REJECTED/);
  assert.match(script, /LOCAL_REHEARSAL_DISPOSABLE_DATABASE_NAME_REQUIRED/);
  assert.match(script, /Write-LocalSqlFileNoBom/);
  assert.match(script, /\[System\.Text\.UTF8Encoding\]::new\(\$false\)/);
  assert.match(script, /\[System\.IO\.File\]::WriteAllText\(\$Path, \$Content, \$utf8NoBom\)/);
  assert.doesNotMatch(script, /Set-Content -LiteralPath \$BaselineSql -Encoding utf8/);
  assert.doesNotMatch(script, /Set-Content -LiteralPath \$BehaviorSql -Encoding utf8/);
  assert.match(script, /ALTER ROLE service_role BYPASSRLS/);
  assert.match(script, /RESET ROLE;[\s\S]*INSERT INTO public\.merchants[\s\S]*SET LOCAL ROLE service_role;/);
  const serviceRoleSection = script.match(/SET LOCAL ROLE service_role;([\s\S]*?)SET LOCAL ROLE anon;/)?.[1] ?? "";
  assert.match(serviceRoleSection, /bootstrap_reviewed_profile_v1/);
  assert.match(serviceRoleSection, /service_role bootstrap failed/);
  assert.doesNotMatch(serviceRoleSection, /INSERT INTO public\.(?:merchants|solo_plus_cases)/);
  assert.match(script, /SET LOCAL ROLE anon;[\s\S]*insufficient_privilege/);
  assert.match(script, /SET LOCAL ROLE authenticated;[\s\S]*insufficient_privilege/);
  assert.match(script, /20260820_00_prd_phase_2_compliance_schema_substrate\.sql/);
  assert.match(script, /20260824_00_reviewed_profile_bootstrap_rpc\.sql/);
  assert.doesNotMatch(script, /2026081[0-9]|2026082[1-3]/);
  assert.doesNotMatch(script, /paystack|monnify|breet|checkout|src\\app|src\/app|src\\lib\\actions/i);
  assert.match(script, /BEGIN;[\s\S]*ROLLBACK;/);
  assert.match(script, /LOCAL-ONLY TARGET HOST/);
  assert.match(script, /LOCAL_REHEARSAL_CONNECTION_STRING_REJECTED/);
  assert.match(runbook, /forbidden to run it against staging, production, any Supabase project/i);
  console.log("reviewed-profile-bootstrap-rpc-rehearsal-script.test.ts passed");
}
run();
