import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(path), "utf8").replace(/\r\n?/g, "\n");
const root = "supabase/ops/phase2b_approve_paid_staging_";
const names = [
  "preflight", "apply", "fixture", "fixture_preflight", "boundary",
  "postflight", "cleanup", "postcleanup",
] as const;
const sql = Object.fromEntries(names.map((name) => [name, read(`${root}${name}.sql`)]));
const runner = read("scripts/phase2b-approve-paid-staging.ps1");
const doc = read("docs/prd-phase-2b-approve-paid-staging-acceptance.md");
const hash = (path: string) => createHash("sha256").update(readFileSync(resolve(path))).digest("hex").toUpperCase();

assert.match(runner, /\$projectRef = 'fsjljliiyfchkwbjifzw'/);
assert.match(runner, /\$hostName = 'aws-1-eu-central-2\.pooler\.supabase\.com'/);
assert.match(runner, /\$dbUser = 'postgres\.fsjljliiyfchkwbjifzw'/);
assert.match(runner, /port=5432 dbname=postgres/);
assert.match(runner, /'PGHOSTADDR'[\s\S]*'PGPASSWORD'[\s\S]*'PGPASSFILE'[\s\S]*'PGSERVICE'/);
assert.match(runner, /'-X', '-W'/);
assert.doesNotMatch(runner, /\[string\]\s*\$(?:DbHost|DbUser|ProjectRef|ConnectionString|Password)/i);
assert.doesNotMatch(runner, /Read-Host\s+-AsSecureString|PGPASSWORD\s*=|\.pgpass|postgresql:\/\//i);
assert.doesNotMatch(runner + doc, /production\.supabase|db\.[a-z0-9]{20}\.supabase\.co/i);
assert.match(doc, /separate migration-apply approval/);
assert.match(doc, /one fresh browser tab/);
assert.match(doc, /click Approve \*\*once\*\*/);
assert.match(doc, /Keep the approved synthetic fixture/);
assert.doesNotMatch(doc, /race-session|hostile-drift\.sql|hostile-drift\.ps1/i);

const predecessor = "supabase/migrations/20261014000000_phase2b_approve_atomicity_fail_closed.sql";
const success = "supabase/migrations/20261015000000_phase2b_approve_success_atomic.sql";
assert.ok(runner.includes(hash(predecessor)), "Reviewed predecessor SHA-256 must be pinned");
assert.ok(runner.includes(hash(success)), "Reviewed success SHA-256 must be pinned");
assert.match(sql.apply, /\\ir \.\.\/migrations\/20261015000000_phase2b_approve_success_atomic\.sql/);
assert.doesNotMatch(sql.apply, /\\ir .*20261014000000/);
assert.match(sql.preflight, /migration_success_installed/);
assert.match(sql.preflight, /migration_predecessor_only/);
assert.match(sql.preflight, /59a78faa12cc7abad8d93637b4a60125/);
assert.match(sql.preflight, /5cc81f443c678a15bed43de6df472077/);
assert.match(sql.preflight, /27710a7819d8413aa8764d8762a6a0ca/);
assert.match(sql.preflight, /policy_semantic_drift/);
assert.match(sql.preflight, /p\.polroles IS DISTINCT FROM ARRAY\[0\]::oid\[\]/);
assert.match(sql.preflight, /p\.polwithcheck IS NOT NULL/);
assert.match(sql.preflight, /pg_get_expr\(p\.polqual/);
for (const name of names) {
  const source = sql[name];
  assert.ok(!source.startsWith("\uFEFF"), `${name} must be BOM-free`);
  assert.doesNotMatch(source, /PGPASSWORD|\\connect|\\c\s|postgresql:\/\//i);
  assert.doesNotMatch(source, /deraledger\.com|production\.supabase|db\.[a-z0-9]{20}\.supabase\.co/i);
  for (const include of source.matchAll(/^\\ir\s+([^\s]+)$/gm)) {
    read(resolve(dirname(`${root}${name}.sql`), include[1]));
  }
  for (const block of source.matchAll(/DO (\$[a-z_]+\$)([\s\S]*?)\1;/g)) {
    assert.doesNotMatch(block[2], /:'[a-z_]+'/,
      `${name} must set psql variables outside dollar-quoted blocks`);
  }
}
for (const name of ["preflight", "apply", "fixture", "fixture_preflight", "postflight", "cleanup", "postcleanup"] as const) {
  assert.match(sql[name], /fsjljliiyfchkwbjifzw/);
  assert.match(sql[name], /current_database\(\) IS DISTINCT FROM 'postgres'/);
  assert.match(sql[name], /current_user IS DISTINCT FROM 'postgres'/);
}
assert.match(sql.fixture, /phase2b_approve_acceptance/);
assert.match(sql.fixture, /'successful', 'manual_review', 'manual_review', v_marker/);
assert.match(sql.fixture, /'manual_review'/);
assert.match(sql.fixture, /\\ir phase2b_approve_paid_staging_fixture_preflight\.sql/);
assert.doesNotMatch(sql.fixture + sql.postflight, /SELECT\s+public\.review_solo_plus_case_approve_atomic_v1\s*\(/i);
assert.match(sql.fixture_preflight, /payment_status IS DISTINCT FROM 'paid'/);
assert.doesNotMatch(sql.fixture_preflight + sql.postflight + sql.cleanup, / <> /,
  "Nullable staging boundary comparisons must fail closed on NULL");
for (const key of ["fixture_scope", "fixture_run_id", "synthetic_approve_acceptance"]) {
  assert.match(sql.fixture_preflight, new RegExp(`->> '${key}' IS DISTINCT FROM`));
  assert.match(sql.postflight, new RegExp(`->> '${key}' IS DISTINCT FROM`));
  assert.match(sql.cleanup, new RegExp(`->> '${key}' IS DISTINCT FROM`));
}
assert.match(sql.postflight, /v_event\.request_idempotency_key IS NULL/);
assert.match(sql.fixture_preflight, /v_codes IS DISTINCT FROM ARRAY/);
assert.match(sql.fixture_preflight, /PASS\|APPROVE_PREFLIGHT\|ready/);
assert.match(sql.boundary, /'payment', to_jsonb\(p\)/);
assert.match(sql.boundary, /'requirements'/);
assert.match(sql.boundary, /'subscriptions'/);
assert.match(sql.boundary, /'settlements'/);
assert.match(sql.postflight, /current_setting\('deraledger\.phase2b_observed_boundary'\)/);
assert.match(sql.postflight, /case_approved/);
assert.match(sql.postflight, /approved_without_activation/);
assert.match(sql.cleanup, /cleanup_unknown_fk_descendant/);
assert.match(sql.cleanup, /fixture_run_id/);
assert.match(sql.cleanup, /DELETE FROM public\.solo_plus_cases WHERE id = v_case\.id/);
assert.doesNotMatch(sql.cleanup, /DELETE FROM public\.(?:solo_plus_cases|merchants|payment_records)\s*;/);
for (const table of ["solo_plus_case_events", "solo_plus_case_requirements", "solo_plus_cases", "payment_records", "workspaces", "merchants"]) {
  assert.match(sql.cleanup, new RegExp(`DELETE FROM public\\.${table} WHERE (?:case_id|id) = v_(?:case|payment|workspace|merchant)\\.id`));
}
assert.equal((sql.cleanup.match(/DELETE FROM public\.[a-z_]+/g) ?? []).length, 6);
assert.equal((sql.cleanup.match(/UPDATE public\.[a-z_]+/g) ?? []).length, 1);
assert.match(sql.cleanup, /UPDATE public\.merchants SET workspace_id = NULL WHERE id = v_merchant\.id/);
assert.match(sql.postcleanup, /postcleanup_absent/);
console.log("PASS|APPROVE_STAGING|offline_package_contract");
