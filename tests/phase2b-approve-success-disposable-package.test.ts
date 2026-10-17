import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sqlRoot = resolve(root, "tests/sql/phase2b-approve-success");
const sqlNames = [
  "local-master.sql", "postflight.sql", "fixture.sql", "writer-contract.sql",
  "legacy-payment-writers.sql", "protected-case.sql", "approval-success.sql",
  "atomic-failure.sql", "replay.sql", "legacy-regression.sql",
  "drift-flow-origin.sql", "drift-flow-ownership.sql", "concurrency-fixture.sql",
  "concurrency-session-a.sql", "concurrency-session-b.sql", "local-teardown.sql",
];
const read = (path: string) => {
  const bytes = readFileSync(path);
  assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], `BOM in ${path}`);
  const value = bytes.toString("utf8");
  assert.doesNotMatch(value, /ï»¿|\uFFFD/, `Encoding artifact in ${path}`);
  assert.doesNotMatch(value, /[\t ]+$/m, `Trailing whitespace in ${path}`);
  return value;
};
const sql = Object.fromEntries(sqlNames.map(name => [name, read(resolve(sqlRoot, name))]));
const master = sql["local-master.sql"];
const doc = read(resolve(root, "docs/prd-phase-2b-approve-success-disposable-validation-package.md"));
const driftRunner = read(resolve(root, "scripts/phase2b-approve-success-drift-check.ps1"));

for (const [name, source] of Object.entries(sql)) {
  for (const match of source.matchAll(/^\\ir\s+(.+)$/gm)) {
    const target = resolve(dirname(resolve(sqlRoot, name)), match[1].trim());
    assert.ok(readFileSync(target).length > 0, `${name}: broken psql include ${match[1]}`);
  }
  assert.doesNotMatch(source, /(?:https?:\/\/|supabase\.co|DATABASE_URL|PGPASSWORD|PGPASSFILE|\.pgpass)/i);
  assert.doesNotMatch(source, /phase2b-approve-atomicity\/(?:hostile-drift|race-session)/i);
}
assert.match(master, /inet_server_addr\(\)::text <> '127\.0\.0\.1'/);
assert.match(master, /inet_server_port\(\) <> 55432/);
assert.match(master, /current_user <> 'postgres'/);
assert.match(master, /r\.rolbypassrls = e\.bypass_rls/);
assert.match(master, /pg_auth_members/);
assert.match(master, /baseline_disposable/);
assert.match(master, /COMMENT ON DATABASE deraledger_phase2b_approve_success_disposable/);
assert.match(master, /EXISTS \(SELECT 1 FROM pg_database WHERE datname IN/);
const predecessor = master.indexOf("20261014000000_phase2b_approve_atomicity_fail_closed.sql");
const success = master.indexOf("20261015000000_phase2b_approve_success_atomic.sql");
const rerun = master.lastIndexOf("20261015000000_phase2b_approve_success_atomic.sql");
assert.ok(predecessor > 0 && predecessor < success && success < rerun);
assert.equal((master.match(/20261014000000_phase2b_approve_atomicity_fail_closed\.sql/g) ?? []).length, 1);
assert.equal((master.match(/20261015000000_phase2b_approve_success_atomic\.sql/g) ?? []).length, 2);
for (const marker of ["predecessor_applied", "first_apply", "postflight", "rerun",
  "sequential_gates_complete"]) assert.ok(master.includes(`PASS|APPROVE_SUCCESS|${marker}`));
for (const gate of ["writer-contract.sql", "protected-case.sql", "approval-success.sql",
  "atomic-failure.sql", "replay.sql", "legacy-regression.sql", "concurrency-fixture.sql"])
  assert.ok(master.includes(`\\ir ${gate}`), `Missing gate ${gate}`);
assert.ok(master.indexOf("concurrency-fixture.sql") > master.indexOf("\\connect deraledger_phase2b_approve_success_race_disposable"));

for (const drift of ["drift-flow-origin.sql", "drift-flow-ownership.sql"]) {
  assert.match(sql[drift], /DROP CONSTRAINT solo_plus_cases_flow_/);
  assert.match(sql[drift], /20261014000000_phase2b_approve_atomicity_fail_closed\.sql[\s\S]*DROP CONSTRAINT[\s\S]*20261015000000_phase2b_approve_success_atomic\.sql/);
  assert.match(sql[drift], /inet_server_addr\(\)::text <> '127\.0\.0\.1'/);
  assert.match(sql[drift], /r\.rolbypassrls = e\.bypass_rls/);
}
assert.match(driftRunner, /-X -W -q -A -t -v ON_ERROR_STOP=1/);
assert.match(driftRunner, /-h 127\.0\.0\.1 -p 55432 -U postgres -d postgres/);
assert.match(driftRunner, /\$status -ne 0 -and \$errors\.Count -eq 1 -and \$errors\[0\] -match \$expected/);
assert.match(driftRunner, /flow CHECK expression drift/);
assert.doesNotMatch(driftRunner, /PGPASSWORD|PGPASSFILE|\.pgpass|SecureString|Read-Host|DATABASE_URL/i);

for (const category of ["payment_noop", "requirement_noop", "unrelated_payment",
  "relevant_payment", "six_requirement_statement", "mixed_upsert_version_bound",
  "confirmation_version", "recovery_version"])
  assert.ok((sql["writer-contract.sql"] + sql["legacy-payment-writers.sql"]).includes(category));
for (const probe of ["writer-contract.sql", "legacy-payment-writers.sql",
  "protected-case.sql", "approval-success.sql", "atomic-failure.sql",
  "replay.sql", "legacy-regression.sql"]) {
  assert.match(sql[probe], /^BEGIN;/m, `${probe}: missing rollback transaction`);
  assert.match(sql[probe], /^ROLLBACK;/m, `${probe}: missing rollback`);
}
for (const field of ["payment_record_id", "merchant_id", "flow_origin",
  "onboarding_session_id", "source_plan", "expected_amount", "payment_currency"])
  assert.ok(sql["protected-case.sql"].includes(field));
for (const category of ["wrong_merchant", "wrong_purpose", "wrong_case_linkage",
  "wrong_session_linkage", "wrong_amount", "wrong_currency", "missing_onboarding_session",
  "duplicate_success", "valid_initial_link"])
  assert.ok(sql["protected-case.sql"].includes(category));
assert.match(sql["approval-success.sql"], /unexpected_public_table_mutation/);
assert.match(sql["atomic-failure.sql"], /local_approve_event_failure[\s\S]*event_failure_partial_commit/);
assert.match(sql["replay.sql"], /idempotent_replay[\s\S]*idempotency_conflict/);
assert.match(sql["legacy-regression.sql"], /request_more_information[\s\S]*reject/);
assert.match(sql["concurrency-session-a.sql"], /same-key[\s\S]*different-key[\s\S]*child/);
assert.match(sql["concurrency-session-a.sql"], /pg_stat_activity[\s\S]*wait_event_type = 'Lock'/);
assert.match(sql["concurrency-session-a.sql"], /race_overlap_unproven/);
assert.match(sql["concurrency-session-b.sql"], /SET application_name = 'phase2b_approve_success_b'/);
assert.match(sql["concurrency-session-b.sql"], /idempotent_replay[\s\S]*version_conflict[\s\S]*race_matrix\|count=3/);
assert.match(sql["local-teardown.sql"], /inet_server_addr\(\)::text <> '127\.0\.0\.1'/);
assert.match(sql["local-teardown.sql"], /shobj_description\(oid, 'pg_database'\)[\s\S]*phase2b-approve-success:local-disposable/);
assert.doesNotMatch(sql["local-teardown.sql"], /DROP DATABASE(?: IF EXISTS)? deraledger_phase2b_approve_atomicity_baseline_disposable/);
assert.match(doc, /Expected password prompts: \*\*one\*\*/i);
assert.match(doc, /An unrelated\s+SQL error,[\s\S]*?is `FAIL`/i);
assert.match(doc, /not invoked/i);
assert.match(doc, /no.*staging\/production connection/i);
assert.doesNotMatch(doc, /docker\s+run|wsl\s+|PGPASSWORD\s*=|DATABASE_URL\s*=/i);
console.log("PASS|APPROVE_SUCCESS|offline_package_contract");
