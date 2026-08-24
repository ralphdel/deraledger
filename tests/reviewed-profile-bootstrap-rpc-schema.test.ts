import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const migration = "supabase/migrations/20260824_00_reviewed_profile_bootstrap_rpc.sql";
const preflight = "supabase/staging/preflight/025_reviewed_profile_bootstrap_rpc_snapshot.sql";
const postflight = "supabase/staging/postflight/025_reviewed_profile_bootstrap_rpc_verify.sql";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function run() {
  const sql = readFileSync(migration, "utf8");
  const before = sql.slice(0, sql.indexOf("CREATE OR REPLACE FUNCTION"));
  assert.match(sql, /^BEGIN;[\s\S]*COMMIT;\s*$/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.bootstrap_reviewed_profile_v1\(/);
  assert.match(sql, /SECURITY INVOKER/);
  assert.doesNotMatch(sql, /SECURITY DEFINER/);
  assert.match(sql, /SET search_path TO pg_catalog, public/);
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/);
  assert.match(before, /Migration 025 prerequisite missing/);
  assert.match(before, /unexpected bootstrap_reviewed_profile_v1 overload/);
  for (const table of ["merchant_compliance_profiles", "merchant_compliance_reviews", "merchant_compliance_events"]) {
    assert.match(sql, new RegExp(`INSERT INTO public\\.${table}`));
  }
  for (const table of ["merchants", "workspaces", "payment_records", "subscriptions", "invoices", "merchant_settlement_accounts", "merchant_provider_settlement_accounts"]) {
    assert.doesNotMatch(sql, new RegExp(`(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE) public\\.${table}`));
  }
  assert.match(sql, /p_plan_code = 'solo_plus'[\s\S]*FROM public\.solo_plus_cases/);
  assert.match(sql, /v_source_type := 'solo_plus_case'/);
  assert.doesNotMatch(sql, /p_plan_code = 'solo_plus'[\s\S]{0,700}INSERT INTO public\.merchant_compliance_reviews/);
  assert.match(sql, /can_collect_payments[\s\S]*false/);
  assert.match(sql, /p_activation_status NOT IN \('test_mode','restricted','suspended'\)/);
  assert.match(sql, /p_restriction_state = 'active'/);
  assert.match(sql, /bootstrap_event_ambiguous|bootstrap_review_ambiguous|bootstrap_profile_ambiguous/);
  assert.match(sql, /NOTIFY pgrst, 'reload schema'/);
  assert.match(readFileSync(preflight, "utf8"), /prerequisite\.tables[\s\S]*prerequisite\.rls[\s\S]*browser_grants/);
  assert.match(readFileSync(postflight, "utf8"), /rpc\.signature[\s\S]*rpc\.security[\s\S]*rpc\.browser_grants[\s\S]*data\.empty_after_apply/);
  for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /bootstrap_reviewed_profile_v1|reviewed-profile-bootstrap-transaction-client/);
  }
  console.log("reviewed-profile-bootstrap-rpc-schema.test.ts passed");
}
run();
