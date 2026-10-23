import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const runner = readFileSync("scripts/rehearse-phase2c-b2-local.ps1", "utf8");
const prerequisite = readFileSync("scripts/phase2c-b2-local/00-prerequisite.sql", "utf8");
const behavior = readFileSync("scripts/phase2c-b2-local/01-behavior.sql", "utf8");
const matrix = readFileSync("scripts/phase2c-b2-local/02-contract-matrix.sql", "utf8");
const setup = readFileSync("scripts/phase2c-b2-local/03-concurrency-setup.sql", "utf8");
const worker = readFileSync("scripts/phase2c-b2-local/04-concurrency-worker.sql", "utf8");
const final = readFileSync("scripts/phase2c-b2-local/05-final.sql", "utf8");
const installed = readFileSync("scripts/phase2c-b2-local/01-installed-state.sql", "utf8");
const b1Migration = readFileSync("supabase/migrations/20261021000000_phase2c_nonadopted_review_substrate.sql");
const b1Contract = readFileSync("tests/phase2c-nonadopted-review-substrate.test.ts");
const b2Migration = readFileSync("supabase/migrations/20261022000000_phase2c_nonadopted_review_triage_resubmission.sql");
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex").toUpperCase();
assert.equal(hash(b1Migration), "49FD3E667E464D18512C0EF48CC84D475525FB9E635793BD789C6B6326D1B528");
assert.equal(hash(b1Contract), "4CD41A85B4302F4906EFCED634A5470ADE437DDAFA00A7A815EF5DC9A445696F");
assert.equal(hash(b2Migration), "23F66A123C89CB2E2C6C2F7001FF83840538DEF9CCB0AAFDADC0BB755A12ADF2");
const b2Pin=runner.match(/\$ExpectedB2MigrationHash = '([A-F0-9]{64})'/)?.[1];
assert.equal(hash(b2Migration), b2Pin, "The local gate must use the reviewed B2 migration bytes");

assert.match(runner, /C:\\Program Files\\PostgreSQL\\15\\bin\\psql\.exe/);
assert.match(runner, /\$DbHost = '127\.0\.0\.1'/);
assert.match(runner, /\$DbPort = '55432'/);
assert.match(runner, /\$DbUser = 'postgres'/);
assert.match(runner, /\$MaintenanceDatabase = 'postgres'/);
assert.match(runner, /15\[0-9\]\{4\}/);
assert.match(runner, /127\\\.0\\\.0\\\.1\(\?:\/32\)\?/);
assert.match(runner, /deraledger_phase2c_b2_rehearsal_/);
assert.match(runner, /Read-Host 'Local PostgreSQL password \(memory only\)' -AsSecureString/);
assert.match(runner, /ZeroFreeBSTR/);
assert.match(runner, /finally \{/);
assert.match(runner, /DROP DATABASE IF EXISTS \$DatabaseName WITH \(FORCE\)/);
assert.match(runner, /\$DatabaseName -cnotmatch '\^deraledger_phase2c_b2_rehearsal_/);
assert.match(runner, /\$ExpectedB1MigrationHash = '49FD3E667E464D18512C0EF48CC84D475525FB9E635793BD789C6B6326D1B528'/);
assert.match(runner, /\$ExpectedB1ContractHash = '4CD41A85B4302F4906EFCED634A5470ADE437DDAFA00A7A815EF5DC9A445696F'/);
assert.match(runner, /\$b2Hash = \(Get-FileHash -Algorithm SHA256 -LiteralPath \$B2Migration\)\.Hash/);
assert.match(runner, /Invoke-LocalPsql \$DatabaseName '06-b2-apply.txt'/);
assert.match(runner, /Invoke-LocalPsql \$DatabaseName '07-behavior.txt'/);
assert.match(runner, /PASS 'phase2c_b2_local_rehearsal_complete'/);
assert.doesNotMatch(runner, /local_functional_rehearsal_complete/);
assert.match(runner, /host\(inet_server_addr\(\)\)/);
assert.match(runner, /SetEnvironmentVariable\('PGSSLMODE','disable','Process'\)/);
assert.doesNotMatch(runner, /supabase\.co|https?:\/\/|staging\.supabase|production\.supabase/i);

assert.match(prerequisite, /ALTER TABLE public\.merchants\s+ADD COLUMN is_super_admin boolean NOT NULL DEFAULT false/);
assert.doesNotMatch(prerequisite, /ALTER ROLE|GRANT UPDATE|DROP ROLE/i);
assert.match(behavior, /SET ROLE service_role;[\s\S]*?DO \$behavior\$/);
assert.match(behavior, /\$behavior\$;\s+RESET ROLE;\s+-- Owner-only, disposable-harness verification[\s\S]*?DO \$owner_verification\$/);
const restrictedBehavior = behavior.match(/SET ROLE service_role;([\s\S]*?)\$behavior\$;/)?.[1];
const ownerVerification = behavior.match(/DO \$owner_verification\$([\s\S]*?)\$owner_verification\$;/)?.[1];
assert.ok(restrictedBehavior, "restricted behavior block must exist");
assert.ok(ownerVerification, "owner verification block must exist");
assert.match(restrictedBehavior, /B2_DIRECT_SERVICE_ROLE_UPDATE_ALLOWED/);
assert.match(restrictedBehavior, /public\.request_draft_plan_review_correction_v1\(/);
assert.match(restrictedBehavior, /public\.resubmit_corrected_draft_plan_review_v1\(/);
assert.doesNotMatch(restrictedBehavior, /FROM public\.workspaces/);
assert.match(ownerVerification, /FROM public\.merchant_compliance_reviews/);
assert.match(ownerVerification, /FROM public\.merchant_compliance_events/);
assert.match(ownerVerification, /FROM public\.merchant_compliance_profiles/);
assert.match(ownerVerification, /FROM public\.workspaces/);
assert.doesNotMatch(ownerVerification, /\b(?:INSERT|UPDATE|DELETE|GRANT|REVOKE|SET ROLE|RESET ROLE)\b/i);
assert.doesNotMatch(behavior, /GRANT\s+SELECT\s+ON\s+public\.workspaces\s+TO\s+service_role/i);
assert.match(behavior, /public\.submit_draft_plan_review_v1\(/);
assert.match(behavior, /public\.request_draft_plan_review_correction_v1\(/);
assert.match(behavior, /public\.resubmit_corrected_draft_plan_review_v1\(/);
assert.match(behavior, /B2_UNAUTHORIZED_REVIEWER_ACCEPTED/);
assert.match(behavior, /B2_RMI_REPLAY_FAILED/);
assert.match(behavior, /B2_RMI_CHANGED_REPLAY_ACCEPTED/);
assert.match(behavior, /B2_RESUBMIT_REPLAY_FAILED/);
assert.match(behavior, /B2_RESUBMIT_CHANGED_REPLAY_ACCEPTED/);
assert.match(behavior, /B2_STALE_REVIEW_VERSION_ACCEPTED/);
assert.match(behavior, /B2_STALE_PROFILE_VERSION_ACCEPTED/);
assert.match(behavior, /B2_OLD_SNAPSHOT_OR_REPLACEMENT_NOT_PRESERVED/);
assert.match(behavior, /B2_HISTORICAL_RMI_REPLAY_FAILED/);
assert.match(behavior, /B2_FORCED_EVENT_FAILURE/);
assert.match(behavior, /B2_EVENT_ROLLBACK_FAILED/);
assert.match(behavior, /B2_SUPERSESSION_EVENT_ROLLBACK_FAILED/);
assert.match(behavior, /B2_DIRECT_SERVICE_ROLE_UPDATE_ALLOWED/);
assert.match(behavior, /BEGIN ISOLATION LEVEL REPEATABLE READ;[\s\S]*?B2_REPEATABLE_READ_NOT_REJECTED/);
assert.match(behavior, /BEGIN ISOLATION LEVEL SERIALIZABLE;[\s\S]*?B2_SERIALIZABLE_NOT_REJECTED/);
assert.match(behavior, /review_status='cancelled'[\s\S]*?superseded_by_corrected_submission/);
assert.match(behavior, /row_version <> 1 OR compliance_status <> 'draft' OR activation_status <> 'test_mode'/);
assert.match(behavior, /has_table_privilege\('service_role','public\.merchant_compliance_reviews','UPDATE'\)/);
assert.match(behavior, /PASS\|b2_draft_triage_resubmission_behavior/);
assert.match(behavior, /B2_RESUBMIT_REPEATABLE_READ_NOT_REJECTED/);
assert.match(behavior, /B2_RMI_SERIALIZABLE_NOT_REJECTED/);
for (const marker of ["B2_METADATA_AUTHORITY","B2_OWNER_AS_REVIEWER","B2_MERCHANT_SCOPED_KEY",
  "B2_CODE_ORDER_REPLAY","B2_NESTED_BOUNDED_RESULT_COMMITTED","B2_CHANGED_VERSION_REPLAY",
  "B2_TAMPERED_REPLAY","B2_ANON_RMI_ALLOWED","B2_AUTH_RESUBMIT_ALLOWED"]) {
  assert.ok(matrix.includes(marker));
}
assert.match(matrix, /ROLLBACK;\s+SELECT 'PASS\|b2_contract_matrix_rolled_back'/);
assert.match(installed, /pg_catalog\.pg_get_functiondef/);
assert.match(installed, /pg_catalog\.aclexplode/);
assert.match(installed, /t\.tgenabled::text/);
assert.match(runner, /\$preRerunFingerprint=Get-InstalledFingerprint/);
assert.match(runner, /\$postRerunFingerprint=Get-InstalledFingerprint/);
assert.match(runner, /\$preRerunFingerprint -cne \$postRerunFingerprint/);
assert.match(runner, /\$rerun\.ExitCode -ne 3/);
assert.match(runner, /Phase 2C B2 RPC already exists/);
assert.match(runner, /pg_catalog\.pg_blocking_pids\(b\.pid\)/);
assert.match(runner, /B2_WORKER_A_EXITED_BEFORE_READY/);
assert.match(runner, /WITH changed AS \(UPDATE public\.b2_rehearsal_cases[\s\S]*?count\(\*\)[\s\S]*?min\(scenario\)/);
assert.match(runner, /Get-Control \$release\.Stdout\) -cne "1\|\$Scenario"/);
assert.match(runner, /HARNESS_TERMINATED/);
assert.match(runner, /if \(-not \$process\.Start\(\)\) \{ throw 'B2_PSQL_START_FAILED' \}/);
assert.match(runner, /throw \$rootFailure/);
assert.ok(runner.indexOf("$ActiveHandles.ToArray()") < runner.indexOf("DROP DATABASE IF EXISTS"));
assert.ok(runner.indexOf("A_LOCK_READY|") < runner.indexOf("$b=Start-LocalPsql"));
assert.match(worker, /SET LOCAL ROLE service_role/);
assert.match(worker, /SELECT 'B2_WORKER_RESULT\|'[\s\S]*?\(public\.b2_rehearsal_invoke\(:'scenario',:'worker'\)->>'kind'\)/);
assert.match(worker, /pg_catalog\.pg_backend_pid\(\)/);
assert.match(worker, /B2_LOCK_READY/);
assert.match(worker, /FOR UPDATE OF p/);
assert.match(worker, /SET is_super_admin=false/);
assert.match(worker, /INSERT INTO public\.merchant_compliance_events/);
assert.ok(worker.indexOf("public.b2_rehearsal_invoke") < worker.indexOf("B2_LOCK_READY"));
assert.ok(worker.indexOf("$barrier$;") < worker.indexOf("INSERT INTO public.merchant_compliance_events"));
assert.match(final, /b\.body IS DISTINCT FROM pg_catalog\.to_jsonb\(p\)/);
assert.match(final, /b\.body IS DISTINCT FROM pg_catalog\.to_jsonb\(w\)/);
const scenarios = [...setup.matchAll(/^\s*\('([a-z_]+)','([a-z_]+)','([a-z_]+)',(true|false),(true|false),(\d+),(\d+)\)/gm)];
assert.equal(scenarios.length, 11);
const reviews = scenarios.reduce((sum, scenario) => sum + Number(scenario[6]), 0);
const events = scenarios.reduce((sum, scenario) => sum + Number(scenario[7]), 0);
assert.equal(reviews, 16);
assert.equal(events, 33);
assert.ok(final.includes("compliance_reviews)<>" + (4 + reviews)));
assert.ok(final.includes("compliance_events)<>" + (8 + events)));
for (const scenario of scenarios) {
  assert.ok(runner.includes("Invoke-B2Race '" + scenario[1] + "'"), "Missing race " + scenario[1]);
}
for (const name of ["rmi_same", "resubmit_same"]) {
  assert.ok(runner.includes("Invoke-B2Race '" + name + "' @('applied','already_processed')"));
}
for (const name of ["rmi_changed", "resubmit_changed"]) {
  assert.ok(runner.includes("Invoke-B2Race '" + name + "' @('applied','state_conflict')"));
}
for (const name of ["rmi_different", "resubmit_different"]) {
  assert.ok(runner.includes("Invoke-B2Race '" + name + "' @('applied','version_conflict')"));
}
for (const source of [behavior,matrix,setup,worker,final,installed]) {
  assert.doesNotMatch(source, /pg_catalog\.(?:coalesce|nullif|greatest|least)\s*\(/i);
  assert.doesNotMatch(source, /^\s*\\!|\bCOPY\b[\s\S]*?\bPROGRAM\b/im);
}
// Run only pure functions extracted from the real runner AST. No runner,
// credential, executable-resolution, process helper or SQL boundary executes.
const pureChecks = String.raw`
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile('RUNNER_PATH',[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'RUNNER_PARSE_FAILED' }
$allowed=@('Get-Control','Get-WorkerKind','Test-ResultPair','Assert-LocalResult')
$functions=$ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in $allowed},$true)
if (@($functions).Count -ne 4) { throw 'PURE_HELPER_CARDINALITY' }
foreach($function in $functions){ Invoke-Expression $function.Extent.Text }
Set-StrictMode -Version Latest
if ((Get-Control "CONTROL|1|rmi_same") -cne '1|rmi_same') { throw 'CONTROL_VALID' }
foreach($bad in @('',("CONTROL|1|x"+[Environment]::NewLine+"CONTROL|1|x"),'UPDATE 1','CONTROL|')) {
  $denied=$false
  try { $null=Get-Control $bad } catch { $denied=$true }
  if (-not $denied) { throw 'CONTROL_INVALID_ACCEPTED' }
}
if (-not (Test-ResultPair 'applied' 'already_processed' @('already_processed','applied'))) { throw 'PAIR_ORDER' }
if (Test-ResultPair 'applied' 'applied' @('already_processed','applied')) { throw 'PAIR_DUPLICATE' }
$valid=[pscustomobject]@{ExitCode=0;Stdout='CONTROL|1|x';Stderr='';TimedOut=$false}
Assert-LocalResult $valid 'pure'
foreach($bad in @([pscustomobject]@{ExitCode=3;TimedOut=$false},[pscustomobject]@{ExitCode=0;TimedOut=$true},@($valid,$valid))) {
  $denied=$false
  try { Assert-LocalResult $bad 'pure' } catch { $denied=$true }
  if(-not $denied){throw 'RESULT_SHAPE_ACCEPTED'}
}
if ((Get-WorkerKind 'B2_WORKER_RESULT|rmi_same|a|applied' 'rmi_same' 'a') -cne 'applied'){throw 'WORKER_PARSE'}
Write-Output 'PASS B2 pure PowerShell orchestration helpers'
`.replace("RUNNER_PATH", resolve("scripts/rehearse-phase2c-b2-local.ps1").replaceAll("'", "''"));
const powershell = spawnSync("powershell.exe", ["-NoProfile", "-Command", pureChecks], { encoding: "utf8" });
assert.equal(powershell.status, 0, powershell.stdout + "\n" + powershell.stderr);
console.log("PASS Phase 2C-2C-B2 local harness source contract");
