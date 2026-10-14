import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const read = (name: string) => readFileSync(resolve(name), "utf8");
const root = "tests/sql/phase2b-approve-atomicity/";
const bootstrap = read(`${root}local-bootstrap.sql`);
const install = read(`${root}verify-install.sql`);
const behavior = read(`${root}verify-behavior.sql`);
const hostile = read(`${root}hostile-drift.sql`);
const hostileRollback = read(`${root}verify-hostile-rollback.sql`);
const raceFixture = read(`${root}race-fixture.sql`);
const raceA = read(`${root}race-session-a.sql`);
const raceB = read(`${root}race-session-b.sql`);
const runbook = read("docs/prd-phase-2b-approve-atomicity-disposable-validation-package.md");
const preflight = read("scripts/phase2b-approve-atomicity-local-preflight.ps1");
const migration = read("supabase/migrations/20261014000000_phase2b_approve_atomicity_fail_closed.sql");

// psql resolves \ir beside the containing file, but \i from the process
// working directory. The runbook invokes psql from the repository root.
const repoRoot = resolve(".");
const bootstrapPath = resolve(root, "local-bootstrap.sql");
function includeTargets(filePath: string, source: string): string[] {
  return [...source.matchAll(/^[ \t]*\\(ir|i)[ \t]+([^ \t\r\n]+)[ \t]*$/gm)].map((match) => {
    const target = resolve(match[1] === "ir" ? dirname(filePath) : repoRoot, match[2]);
    const withinRepo = relative(repoRoot, target);
    assert.ok(withinRepo !== ".." && !withinRepo.startsWith(`..\\`) &&
      !withinRepo.startsWith("../") && !isAbsolute(withinRepo),
    `psql include leaves repository: ${filePath} -> ${match[2]}`);
    assert.ok(existsSync(target), `Missing psql include: ${filePath} -> ${match[2]}`);
    return target;
  });
}
function assertIncludeChain(entrySource: string): void {
  const visited = new Set<string>();
  function visit(filePath: string, source: string): void {
    if (visited.has(filePath)) return;
    visited.add(filePath);
    for (const target of includeTargets(filePath, source)) {
      visit(target, readFileSync(target, "utf8"));
    }
  }
  visit(bootstrapPath, entrySource);
}
const expectedBaselineChain = [
  "001_schema_only", "002_onboarding_verification_upgrade_flow", "003_rls_policies",
  "004_phase1_plan_compatibility", "006_solo_plus_prerequisites",
  "007_solo_plus_case_foundation", "008_solo_plus_transactional_repository_rpcs",
  "009_breet_payment_substrate_reconciliation", "010_solo_plus_payment_lifecycle",
  "011_solo_plus_review_decision_rpc", "012_solo_plus_activation_rpc",
  "013_solo_plus_payment_recovery", "014_authorization_hardening",
  "015_verification_disclosure_acknowledgement_rpc",
  "016_verification_disclosure_identity_hardening",
  "017_payment_events_legacy_merchant_compatibility",
  "018_core_merchant_schema_compatibility",
] as const;
const expectedBaselineTargets = expectedBaselineChain.map((name, index) =>
  index === 7 || index === 8
    ? resolve(`supabase/migrations/${index === 7
      ? "20260707010000_breet_payment_substrate_reconciliation"
      : "20260707020000_solo_plus_payment_lifecycle"}.sql`)
    : resolve(`supabase/staging/${name}.sql`));
expectedBaselineTargets.push(resolve("supabase/migrations/20260930000000_phase2b_review_action_intent_hardening.sql"));
assert.deepEqual(includeTargets(bootstrapPath, bootstrap), expectedBaselineTargets,
  "Keep the complete canonical baseline chain in order");
assertIncludeChain(bootstrap);
for (const number of ["009", "010"]) {
  const canonicalPath = number === "009"
    ? "../../../supabase/migrations/20260707010000_breet_payment_substrate_reconciliation.sql"
    : "../../../supabase/migrations/20260707020000_solo_plus_payment_lifecycle.sql";
  const wrapperPath = number === "009"
    ? "../../../supabase/staging/009_breet_payment_substrate_reconciliation.sql"
    : "../../../supabase/staging/010_solo_plus_payment_lifecycle.sql";
  assert.throws(() => assertIncludeChain(bootstrap.replace(canonicalPath, wrapperPath)),
    /psql include leaves repository|Missing psql include/,
    `Broken ${number} wrapper must fail the offline include audit`);
}

assert.match(bootstrap, /CREATE SCHEMA IF NOT EXISTS auth/);
assert.doesNotMatch(bootstrap, /\b(?:CREATE|ALTER|DROP)\s+ROLE\b/i);
assert.match(bootstrap, /pg_catalog\.pg_roles/);
assert.match(bootstrap, /pg_catalog\.pg_auth_members/);
assert.match(bootstrap, /r\.rolbypassrls = expected\.bypass_rls/);
for (const source of [bootstrap, preflight]) {
  for (const role of ["('service_role', true)", "('anon', false)", "('authenticated', false)"]) {
    assert.ok(source.includes(role), `Missing exact pre-existing role: ${role}`);
  }
  assert.match(source, /pg_catalog\.pg_roles/);
  assert.match(source, /pg_catalog\.pg_auth_members/);
  assert.match(source, /NOT EXISTS\s*\(\s*SELECT 1 FROM pg_catalog\.pg_auth_members/);
}
for (const attribute of [
  "NOT r.rolcanlogin", "NOT r.rolsuper", "NOT r.rolcreatedb",
  "NOT r.rolcreaterole", "NOT r.rolreplication", "r.rolinherit",
  "r.rolconnlimit = -1", "r.rolvaliduntil IS NULL", "r.rolconfig IS NULL",
]) assert.ok(bootstrap.includes(attribute), `Missing exact local role attribute: ${attribute}`);
assert.match(bootstrap, /BLOCKED\|APPROVE_ATOMICITY\|local_roles_unavailable_or_drifted/);
assert.ok(bootstrap.indexOf("local_roles_unavailable_or_drifted") < bootstrap.indexOf("CREATE EXTENSION"),
  "Role drift must stop bootstrap before its first database mutation");
assert.match(bootstrap, /20260930000000_phase2b_review_action_intent_hardening\.sql/);
assert.doesNotMatch(bootstrap, /\\ir .*005_phase1_fake_seed/);
assert.match(bootstrap, /PASS\|APPROVE_ATOMICITY\|local_baseline_loaded/);
assert.match(install, /27710a7819d8413aa8764d8762a6a0ca/);
assert.match(install, /368f905cc19f574df1617acd5a7d812f/);
assert.match(install, /aclexplode/);
assert.match(install, /PASS\|APPROVE_ATOMICITY\|installed_functions_and_grants/);
assert.match(behavior, /BEGIN;[\s\S]*ROLLBACK;[\s\S]*PASS\|APPROVE_ATOMICITY\|fail_closed_behavior_and_rollback/);
assert.match(behavior, /review_solo_plus_case_v1\([\s\S]*'approve'/);
assert.match(behavior, /review_solo_plus_case_approve_atomic_v1\([\s\S]*phase2b-approve-20261014-local001/);
assert.match(behavior, /SAVEPOINT rmi_probe[\s\S]*request_more_information[\s\S]*ROLLBACK TO SAVEPOINT rmi_probe/);
assert.match(behavior, /SAVEPOINT reject_probe[\s\S]*'reject'[\s\S]*ROLLBACK TO SAVEPOINT reject_probe/);
assert.match(behavior, /to_jsonb\(c\)[\s\S]*payment_row[\s\S]*requirement_rows[\s\S]*merchant_row/);
assert.match(behavior, /CREATE TEMP TABLE local_public_table_fingerprints/);
assert.match(behavior, /public_table_mutation/);
assert.match(behavior, /local-approve-wrong-run/);
assert.match(behavior, /local-approve-stale/);

const scenarios = [
  "v1_body", "v1_defaults", "overload", "policy_roles", "policy_using",
  "policy_with_check", "check_expression", "check_requirement_code",
  "check_requirement_state", "fk_target", "fk_columns",
  "fk_actions", "index_key", "index_predicate", "index_collation", "index_opclass",
] as const;
for (const scenario of scenarios) {
  assert.match(hostile, new RegExp(`WHEN '${scenario}' THEN`));
  assert.ok(runbook.includes(scenario), `Missing runbook scenario ${scenario}`);
}
for (const clause of [
  "ALTER POLICY", "WITH CHECK (true)", "DROP CONSTRAINT", "FOREIGN KEY",
  "ON DELETE CASCADE", "COLLATE \"C\"", "text_pattern_ops",
]) assert.ok(hostile.includes(clause), `Missing hostile mutation: ${clause}`);
assert.match(hostile, /FAIL\|HOSTILE_SETUP/);
assert.match(hostileRollback, /old_body_hash[\s\S]*new_rpc_oid/);
assert.match(hostileRollback, /to_regprocedure\('public\.review_solo_plus_case_v1\(uuid,bigint,text,text,uuid,text,text\)'\) IS NULL/);
assert.match(hostileRollback, /PASS\|APPROVE_ATOMICITY\|hostile_guard_rolled_back/);
assert.ok(/SELECT policy\s+with an ALL policy/.test(runbook));
assert.ok(/Runtime rejection does not independently prove/.test(runbook));
assert.match(runbook, /local bootstrap includes the canonical 009 and 010 migration files with\s+`\\ir`/);
assert.match(runbook, /staging wrappers use working-directory-relative `\\i`/);
assert.match(runbook, /Do not rerun\s+bootstrap or clone that database/);
assert.match(runbook, /PostgreSQL roles are \*\*cluster-wide\*\*/);
assert.match(runbook, /never\s+creates or repairs `service_role`, `anon`, or `authenticated`/);
assert.match(runbook, /Database teardown does not remove or own\s+cluster-wide roles/);
assert.match(runbook, /database-only teardown/);
assert.doesNotMatch(runbook, /dropping (?:the )?databases (?:fully |completely )?(?:cleans|removes) (?:the )?roles/i);

const expectedHostileCategories: Record<string, string> = {
  v1_body: "reviewed v1 function drift",
  v1_defaults: "reviewed v1 function drift",
  overload: "unexpected RPC overload",
  policy_roles: "policy role or expression drift",
  policy_using: "policy role or expression drift",
  policy_with_check: "RLS policy drift",
  check_expression: "check constraint expression drift",
  check_requirement_code: "check constraint expression drift",
  check_requirement_state: "check constraint expression drift",
  fk_target: "key or foreign-key semantic drift",
  fk_columns: "key or foreign-key semantic drift",
  fk_actions: "key or foreign-key semantic drift",
  index_key: "review intent index semantic drift",
  index_predicate: "review intent index semantic drift",
  index_collation: "review intent index semantic drift",
  index_opclass: "review intent index semantic drift",
};
const hostileBlock = runbook.match(/\$expectedGuardCategory = @\{([\s\S]*?)\n\}/)?.[1];
assert.ok(hostileBlock, "Missing exact hostile error map");
const actualHostileCategories = Object.fromEntries(
  [...hostileBlock.matchAll(/^  ([a-z0-9_]+) = '([^']+)'$/gm)].map((match) => [match[1], match[2]]),
);
assert.deepEqual(actualHostileCategories, expectedHostileCategories);
for (const category of new Set(Object.values(expectedHostileCategories))) {
  assert.ok(migration.includes(`Phase 2B approve atomicity blocked: ${category}`));
}
const hostileEvidenceClauses = [
  "$migrationOutput = @(& $psql @psqlOptions -d $hostileDb -f $migration 2>&1",
  "$applyExit = $LASTEXITCODE",
  "if ($applyExit -eq 0)",
  "$errorRows = [regex]::Matches(($migrationOutput -join",
  "'(?m)ERROR:[ \\t]*([^\\r\\n]+)\\r?$'",
  "if ($errorRows.Count -ne 1 -or",
  "$errorRows[0].Groups[1].Value.Trim() -cne $expectedError",
  "FAIL|APPROVE_ATOMICITY|hostile_wrong_error",
] as const;
const hostileCommands = runbook.match(/```powershell\n(\$scenario = 'v1_body'[\s\S]*?)```/)?.[1];
assert.ok(hostileCommands, "Missing executable hostile scenario block");
function hasHostileEvidenceContract(source: string): boolean {
  return hostileEvidenceClauses.every((clause) => source.includes(clause));
}
assert.ok(hasHostileEvidenceContract(hostileCommands));
for (const clause of hostileEvidenceClauses) {
  assert.equal(hasHostileEvidenceContract(hostileCommands.replace(clause, "")), false,
    `Lost actual hostile error check: ${clause}`);
}
assert.doesNotMatch(runbook, /\$observedCategory\s*=\s*Read-Host/);
assert.match(runbook, /An unrelated nonzero SQL or connection error is `FAIL\|APPROVE_ATOMICITY\|hostile_wrong_error`,\s+never PASS/);

for (const scenario of [
  "payment_lock", "requirement_lock", "case_lock", "payment_drift",
  "requirement_drift", "case_version", "marker_drift",
]) {
  assert.match(raceA, new RegExp(`WHEN '${scenario}' THEN`));
  assert.match(raceB, new RegExp(`WHEN '${scenario}' THEN`));
  assert.ok(runbook.includes(scenario));
}
assert.match(raceFixture, /BEGIN;[\s\S]*COMMIT;/);
assert.match(raceFixture, /synthetic_approve_acceptance/);
assert.doesNotMatch(raceFixture, /provider_reference|provider_name|document_upload|settlement_instruction/i);
assert.match(raceA, /session_a_lock_held[\s\S]*\\prompt[\s\S]*ROLLBACK/);
assert.match(raceB, /SET lock_timeout = '2s'/);
assert.match(raceB, /EXCEPTION WHEN lock_not_available THEN/);
assert.match(raceB, /PASS\|APPROVE_ATOMICITY\|two_session_fail_closed/);
const commands = [...runbook.matchAll(/```powershell\n([\s\S]*?)```/g)].map((match) => match[1]).join("\n");
assert.ok(commands.length > 0);
assert.doesNotMatch(commands, /\b(?:docker|wsl)\b/i, "Windows PostgreSQL commands must not require Docker or WSL");
assert.match(runbook, /primary path is Windows PostgreSQL/);
assert.match(runbook, /Docker and WSL are not required/);
assert.doesNotMatch(runbook, /must use Docker|Docker is required|WSL is required/i);
assert.match(runbook, /Never switch to\s+staging or production/);
assert.match(runbook, /BLOCKED\|APPROVE_ATOMICITY\|local_postgres_unavailable/);
assert.match(runbook, /A listener bound to `127\.0\.0\.1`, `::1`, `0\.0\.0\.0`, or `::` is eligible only when\s+`Test-NetConnection` succeeds to the requested loopback host and port/);
assert.match(runbook, /BLOCKED\|APPROVE_ATOMICITY\|local_postgres_not_ready/);
assert.match(commands, /phase2b-approve-atomicity-local-preflight\.ps1/);
assert.match(commands, /createdb\.exe/);
assert.match(commands, /dropdb\.exe/);
assert.match(commands, /psql\.exe/);
assert.match(commands, /'127\.0\.0\.1'/);
assert.match(commands, /\$pgPort = 55432/);
assert.match(commands, /\$dbPrefix = 'deraledger_phase2b_approve_atomicity_'/);
assert.match(commands, /'-W'/);
assert.ok(!/'-w'|PGPASSWORD\s*=|postgres(?:ql)?:\/\//.test(commands));
for (const suffix of ["baseline", "clean", "hostile", "race"]) {
  assert.match(runbook, new RegExp(`\\$${suffix}Db = "\\$\\{dbPrefix\\}${suffix}_disposable"`));
}
for (const phase of ["first_apply", "rerun", "hostile_guard", "two_session_fail_closed"]) {
  assert.ok(runbook.includes(phase));
}
assert.match(runbook, /approve fixture planning and execution remain\s+blocked/);
assert.match(runbook, /have \*\*not\*\* been proven yet/);
assert.match(runbook, /git ls-files --others --exclude-standard/);
assert.match(runbook, /Get-Content -LiteralPath \$packageFile/);
assert.match(runbook, /PASS\|APPROVE_ATOMICITY\|package_whitespace/);

const preflightContracts = [
  "[string]$PgHostName = '127.0.0.1'",
  "[int]$PgPort = 55432",
  "[string]$PgUser = 'postgres'",
  "[string]$DatabasePrefix = 'deraledger_phase2b_approve_atomicity_'",
  "$TargetPrefix.Length + 'baseline_disposable'.Length -gt 63",
  "[string]$PgBinDirectory = ''",
  "TargetHost -cnotin @('127.0.0.1', '::1')",
  "BLOCKED|APPROVE_ATOMICITY|nonlocal_host",
  "@('127.0.0.1', '::1', '0.0.0.0', '::')",
  "Test-NetConnection -ComputerName $TargetHost -Port $TargetPort",
  "-InformationLevel Quiet",
  "-not $TcpConnected -or $localListeners.Count -lt 1",
  "Assert-LocalListenerEvidence $TargetHost $tcpConnected $listeners",
  "Get-NetTCPConnection -LocalPort $TargetPort -State Listen",
  "ProcessName -cne 'postgres'",
  "BLOCKED|APPROVE_ATOMICITY|local_listener_not_postgres",
  "BLOCKED|APPROVE_ATOMICITY|local_postgres_unavailable",
  "BLOCKED|APPROVE_ATOMICITY|local_postgres_not_ready",
  "BLOCKED|APPROVE_ATOMICITY|local_identity_mismatch",
  "PGPASSWORD", "PGPASSFILE", "PGSERVICE", "DATABASE_URL",
  "pg_isready.exe", "psql.exe", "createdb.exe", "dropdb.exe",
  "host(inet_server_addr())",
  "pg_catalog.pg_roles", "pg_catalog.pg_auth_members",
  "BLOCKED|APPROVE_ATOMICITY|local_roles_unavailable_or_drifted",
  "Parse-LocalIdentityControl",
  "-X -W -q -A -t -v ON_ERROR_STOP=1",
  "PASS|APPROVE_ATOMICITY|local_preflight_self_test",
  "PASS|APPROVE_ATOMICITY|local_postgres_ready",
  "foreach ($address in @('127.0.0.1', '::1', '0.0.0.0', '::'))",
  "Connected = $false",
  "Listeners = @()",
  "Host = 'db.example.invalid'",
] as const;
function hasPreflightContract(source: string): boolean {
  return preflightContracts.every((clause) => source.includes(clause));
}
assert.ok(hasPreflightContract(preflight));
for (const clause of [
  "TargetHost -cnotin @('127.0.0.1', '::1')",
  "@('127.0.0.1', '::1', '0.0.0.0', '::')",
  "Test-NetConnection -ComputerName $TargetHost -Port $TargetPort",
  "-not $TcpConnected -or $localListeners.Count -lt 1",
  "Assert-LocalListenerEvidence $TargetHost $tcpConnected $listeners",
  "Get-NetTCPConnection -LocalPort $TargetPort -State Listen",
  "ProcessName -cne 'postgres'",
  "PGPASSWORD", "PGPASSFILE", "pg_isready.exe", "host(inet_server_addr())",
  "-X -W -q -A -t -v ON_ERROR_STOP=1",
]) {
  assert.equal(hasPreflightContract(preflight.replaceAll(clause, "")), false, `Lost local guard: ${clause}`);
}
assert.doesNotMatch(preflight, /\b(?:CREATE|ALTER|DROP)\s+ROLE\b/i);
assert.match(migration, /RETURN jsonb_build_object\('kind', 'state_conflict', 'case', to_jsonb\(v_case\)\);\s*END;\s*\$\$;/);
const approveFunction = migration.slice(
  migration.indexOf("CREATE OR REPLACE FUNCTION public.review_solo_plus_case_approve_atomic_v1("),
  migration.indexOf("\n$$;", migration.indexOf("CREATE OR REPLACE FUNCTION public.review_solo_plus_case_approve_atomic_v1(")),
);
assert.doesNotMatch(approveFunction, /\b(?:INSERT|UPDATE|DELETE|MERGE)\s+(?:INTO|FROM|public\.)/i);
assert.doesNotMatch(approveFunction, /activate_solo_plus_case_v1|workspace_subscriptions|provider_settlement/i);

console.log("phase2b-approve-atomicity-disposable-package.test.ts passed (source only; no SQL executed)");
