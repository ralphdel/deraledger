import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const runner = readFileSync("scripts/rehearse-phase2c-b1-local.ps1", "utf8");
const bootstrap = readFileSync("scripts/phase2c-b1-local/00-bootstrap.sql", "utf8");
const postflight = readFileSync("scripts/phase2c-b1-local/01-postflight.sql", "utf8");
const fingerprint = readFileSync("scripts/phase2c-b1-local/01-installed-state-fingerprint.sql", "utf8");
const behavior = readFileSync("scripts/phase2c-b1-local/02-behavior.sql", "utf8");
const migration = readFileSync("supabase/migrations/20261021000000_phase2c_nonadopted_review_substrate.sql", "utf8");
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
assert.equal(sha256("supabase/migrations/20261021000000_phase2c_nonadopted_review_substrate.sql"), "49FD3E667E464D18512C0EF48CC84D475525FB9E635793BD789C6B6326D1B528");
assert.equal(sha256("tests/phase2c-nonadopted-review-substrate.test.ts"), "4CD41A85B4302F4906EFCED634A5470ADE437DDAFA00A7A815EF5DC9A445696F");
for (const [path, hash] of [
  ["scripts/phase2c-b1-local/00-bootstrap.sql", "DB8AEE2F39EFF98E21F44CAE26F87EC42FC495C147A77433B72E2FBA8B65D2BF"],
  ["scripts/phase2c-b1-local/01-installed-state-fingerprint.sql", "44EFF3B5622BBE986F853123406D464D7AC05FE0F2A0D4A1C8A3174A6796E4AE"],
  ["scripts/phase2c-b1-local/01-postflight.sql", "522138D44D947E516D234DFF311B21452F1BFD6810C559F059327D5C0305E883"],
  ["scripts/phase2c-b1-local/02-behavior.sql", "930B1A4DF32D7AFA1C5E5A2ED6A0EEE06FF2807EB176FEFD59157A7BBE766114"],
]) assert.equal(sha256(path), hash, `${path} is a passed rehearsal gate`);
const worker = readFileSync("scripts/phase2c-b1-local/03-concurrency-worker.sql", "utf8");
const mixed = readFileSync("scripts/phase2c-b1-local/04-mixed-writer.sql", "utf8");
const final = readFileSync("scripts/phase2c-b1-local/05-final.sql", "utf8");
assert.match(runner, /C:\\Program Files\\PostgreSQL\\15\\bin\\psql\.exe/);
assert.match(runner, /\$DbHost = '127\.0\.0\.1'/);
assert.match(runner, /\$DbPort = '55432'/);
assert.match(runner, /function Test-LocalMaintenanceIdentity/);
assert.match(runner, /\^127\\\.0\\\.0\\\.1\(\?:\/32\)\?\$/);
assert.match(runner, /Test-LocalMaintenanceIdentity \$identity\.Stdout/);
assert.doesNotMatch(runner, /\(\?:127\\\.0\\\.0\\\.1\|::1\)/);
const maintenanceAddress = /^127\.0\.0\.1(?:\/32)?$/;
const maintenanceIdentity = (value: string) => {
  const parts = value.trim().split("|");
  return parts.length === 5 && parts[0] === "postgres" && parts[1] === "postgres" && /^15\d{4}$/.test(parts[2]) && maintenanceAddress.test(parts[3]) && parts[4] === "55432";
};
assert.equal(maintenanceIdentity("postgres|postgres|150018|127.0.0.1|55432"), true);
assert.equal(maintenanceIdentity("postgres|postgres|150018|127.0.0.1/32|55432"), true);
assert.equal(maintenanceIdentity("postgres|postgres|150018|127.0.0.2|55432"), false);
assert.equal(maintenanceIdentity("postgres|postgres|150018|127.0.0.1/24|55432"), false);
assert.equal(maintenanceIdentity("postgres|postgres|150018|10.0.0.1|55432"), false);
assert.equal(maintenanceIdentity("postgres|postgres|150018|db.supabase.co|55432"), false);
assert.equal(maintenanceIdentity("postgres|postgres|150018|127.0.0.1|5432"), false);
assert.equal(maintenanceIdentity("other|postgres|150018|127.0.0.1|55432"), false);
assert.equal(maintenanceIdentity("postgres|other|150018|127.0.0.1|55432"), false);
assert.equal(maintenanceIdentity("postgres|postgres|160000|127.0.0.1|55432"), false);
assert.match(runner, /\^deraledger_phase2c_b1_rehearsal_\[a-z0-9_\]\+\$/);
assert.match(runner, /Read-Host 'Local PostgreSQL password \(used in memory only\)' -AsSecureString/);
assert.match(runner, /HARNESS_APPROVED_SOURCE_HASH_REJECTED/);
assert.match(runner, /49FD3E667E464D18512C0EF48CC84D475525FB9E635793BD789C6B6326D1B528/);
assert.match(runner, /4CD41A85B4302F4906EFCED634A5470ADE437DDAFA00A7A815EF5DC9A445696F/);
assert.match(runner, /SetEnvironmentVariable\('PGPASSWORD',\$PlainPassword,'Process'\)/);
assert.match(runner, /ZeroFreeBSTR/);
assert.match(runner, /finally \{/);
assert.match(runner, /DROP DATABASE IF EXISTS \$DatabaseName WITH \(FORCE\)/);
assert.doesNotMatch(runner, /Start-Process|Invoke-Expression|connection string|supabase\.co/i);
assert.doesNotMatch(runner, /password\s*=\s*['"][^'"]+['"]/i);
for (const name of ["00-environment.txt","01-bootstrap.txt","02-apply.txt","03-postflight.txt","04-behavior.txt","05-concurrency.txt","06-mixed-writer.txt","07-cleanup.txt","summary.txt"]) {
  assert.match(runner, new RegExp(name.replace(".", "\\.")));
}
assert.match(runner, /PASS\|/);
assert.match(runner, /Add-Summary BLOCKED/);
assert.match(runner, /FAIL\|/);
const firstApply = runner.indexOf("$firstApply = Invoke-Psql $DatabaseName $Logs.Apply");
const prePostflight = runner.indexOf("Invoke-Psql $DatabaseName $Logs.Postflight", firstApply);
const preFingerprint = runner.indexOf("$preRerunFingerprint = Get-InstalledStateFingerprint", prePostflight);
const secondApply = runner.indexOf("$rerun = Invoke-Psql $DatabaseName $Logs.Apply", preFingerprint);
const postFingerprint = runner.indexOf("$postRerunFingerprint = Get-InstalledStateFingerprint", secondApply);
const fingerprintComparison = runner.indexOf("$preRerunFingerprint -cne $postRerunFingerprint", postFingerprint);
const fullPostflight = runner.indexOf("Invoke-Psql $DatabaseName $Logs.Postflight", postFingerprint);
assert.ok(firstApply >= 0 && firstApply < prePostflight && prePostflight < preFingerprint &&
  preFingerprint < secondApply && secondApply < postFingerprint &&
  postFingerprint < fingerprintComparison && fingerprintComparison < fullPostflight,
  "First apply, installed-state checks, rejection, equality proof, and full postflight must stay ordered");
assert.match(runner, /HARNESS_FIRST_APPLY_COMMIT_MISSING/);
assert.match(runner, /\$rerun\.ExitCode -ne 3/);
assert.match(runner, /migration_rerun_unexpected_error/);
assert.match(runner, /migration_rerun_changed_installed_state/);
assert.match(runner, /PASS 'migration_rerun_rejected_without_state_change'/);
assert.match(runner, /Get-InstalledStateFingerprint[\s\S]*B1_FINGERPRINT\\\|\[0-9a-f\]\{64\}/);
const stdoutPattern = runner.match(/\$expectedRerunStdout = '([^']+)'/)?.[1];
const errorPattern = runner.match(/\$expectedRerunError = '([^']+)'/)?.[1];
assert.ok(stdoutPattern && errorPattern, "Expected rerun boundaries must be explicit");
const expectedStdout = new RegExp(stdoutPattern);
const expectedError = new RegExp(errorPattern.replace(/^\(\?s\)/, ""), "s");
const observedStdout = "BEGIN\nSET\nSET\nSET\n";
const observedError = "psql:C:/work/20261021000000_phase2c_nonadopted_review_substrate.sql:175: ERROR: Phase 2C review substrate security prerequisite incompatible\nCONTEXT: PL/pgSQL function inline_code_block line 116 at RAISE\n";
assert.equal(expectedStdout.test(observedStdout) && expectedError.test(observedError), true);
assert.equal(expectedError.test(observedError.replace("security prerequisite", "column prerequisite")), false);
assert.equal(expectedError.test(observedError.replace(":175:", ":177:")), false);
assert.equal(expectedStdout.test("BEGIN\nSET\nSET\nSET\nCREATE FUNCTION\n"), false);
for (const field of ["pg_get_functiondef", "pg_get_triggerdef", "proowner", "prosecdef", "proconfig", "proacl", "tgenabled", "relacl", "relrowsecurity", "has_function_privilege", "has_table_privilege", "sha256"]) {
  assert.match(fingerprint, new RegExp(field), `Installed-state fingerprint must include ${field}`);
}
assert.match(fingerprint, /B1_FINGERPRINT\|/);
assert.match(runner, /finally \{[\s\S]*DROP DATABASE IF EXISTS \$DatabaseName WITH \(FORCE\)/);
for (const [scenario, loser] of [["identical","already_processed"],["changed","state_conflict"],["different","state_conflict"]]) {
  assert.match(runner, new RegExp(`Assert-RacePair '${scenario}' \\$pair '${loser}'`));
  assert.match(runner, new RegExp(`phase2c_b1_${scenario}-a_lock_held`));
  assert.match(runner, new RegExp(`SCENARIO_PASS\\|\\$Scenario`));
}
assert.match(runner, /HARNESS_RACE_MISMATCH:[\s\S]*worker_a=[\s\S]*worker_b=/);
assert.match(runner, /@\(\$kindA,\$kindB\) -notcontains 'applied'[\s\S]*@\(\$kindA,\$kindB\) -notcontains \$LoserKind/);
assert.match(runner, /\$counts -cne '1\|1'/);
assert.match(runner, /HARNESS_WORKER_A_EXITED_BEFORE_LOCK_READY/);
assert.match(runner, /if \(\$a\.Process\.HasExited\)[\s\S]*Complete-PsqlProcess \$a[\s\S]*HARNESS_WORKER_A_EXITED_BEFORE_LOCK_READY/);
assert.match(runner, /SCENARIO_FAILED\|\$Scenario\|milestone=\$milestone\|worker_a_exit=\$aExit\|worker_b_exit=\$bExit\|worker_a_stderr=\$aError\|worker_b_stderr=\$bError/);
assert.match(runner, /Get-WorkerKind \$mixed\[1\] 'mixed_writer' 'b'/);
assert.match(runner, /b_waiting_on_profile/);
assert.match(runner, /HARNESS_MIXED_WRITER_MILESTONE_ORDER/);
assert.match(runner, /Get-BlockingProof[\s\S]*pg_stat_activity[\s\S]*pg_blocking_pids\(b\.pid\)/);
assert.match(runner, /b\.query LIKE '%submit_draft_plan_review_v1%'/);
assert.match(runner, /WORKER_A_LOCK_READY[\s\S]*WORKER_B_STARTED[\s\S]*BLOCKING_PROVEN[\s\S]*Release-RehearsalBarrier/);
assert.match(runner, /function Test-BarrierReleaseResult[\s\S]*\$Result -is \[array\][\s\S]*\$Result\.ExitCode -ne 0/);
assert.match(runner, /Test-BarrierReleaseResult[\s\S]*\$Result\.Stderr[\s\S]*\$Result\.Stdout -split '\\r\?\\n'/);
assert.match(runner, /\$lines\.Count -eq 2[\s\S]*\$lines\[0\] -ceq \$Scenario[\s\S]*\$lines\[1\] -ceq 'UPDATE 1'/);
assert.match(runner, /Release-RehearsalBarrier[\s\S]*Invoke-Psql[^\r\n]*-AllowFailure -Append[\s\S]*Test-BarrierReleaseResult \$result \$Scenario/);
type BarrierResult = { ExitCode: number; Stdout: string; Stderr: string };
const barrierReleaseAccepted = (result: BarrierResult | BarrierResult[] | null, scenario: string) => {
  if (result === null || Array.isArray(result) || result.ExitCode !== 0 || result.Stderr.trim() !== "") return false;
  const lines = result.Stdout.split(/\r?\n/).filter(line => line !== "");
  return lines.length === 2 && lines[0] === scenario && lines[1] === "UPDATE 1";
};
assert.equal(barrierReleaseAccepted({ ExitCode: 0, Stdout: "identical\r\nUPDATE 1\r\n", Stderr: "" }, "identical"), true);
assert.equal(barrierReleaseAccepted({ ExitCode: 3, Stdout: "identical\r\nUPDATE 1\r\n", Stderr: "" }, "identical"), false);
assert.equal(barrierReleaseAccepted({ ExitCode: 0, Stdout: "identical\r\nUPDATE 0\r\n", Stderr: "" }, "identical"), false);
assert.equal(barrierReleaseAccepted({ ExitCode: 0, Stdout: "changed\r\nUPDATE 1\r\n", Stderr: "" }, "identical"), false);
assert.equal(barrierReleaseAccepted({ ExitCode: 0, Stdout: "identical\r\nUPDATE 2\r\n", Stderr: "" }, "identical"), false);
assert.equal(barrierReleaseAccepted({ ExitCode: 0, Stdout: "identical UPDATE 1", Stderr: "" }, "identical"), false);
assert.equal(barrierReleaseAccepted([{ ExitCode: 0, Stdout: "identical\r\nUPDATE 1\r\n", Stderr: "" }], "identical"), false);
assert.match(runner, /WORKER_TERMINATED_BY_HARNESS[\s\S]*classification=HARNESS_TERMINATED[\s\S]*native_exit=/);
assert.match(runner, /SCENARIO_FAILED[\s\S]*reason=\$\(\$failure\.Exception\.Message\)[\s\S]*throw \$failure/);
assert.match(runner, /CREATE TABLE public\.phase2c_b1_rehearsal_barriers[\s\S]*\('identical'\),\('changed'\),\('different'\),\('mixed_writer'\)/);
assert.match(runner, /DROP TABLE public\.phase2c_b1_rehearsal_barriers/);
assert.ok(runner.indexOf("$barrierSql =") < runner.indexOf("Invoke-PsqlPair $Logs.Concurrency 'identical'"));
assert.ok(runner.indexOf("DROP TABLE public.phase2c_b1_rehearsal_barriers") < runner.indexOf("$Logs.Mixed @('-f',(Join-Path $SqlRoot '05-final.sql'))"));
assert.match(runner, /MIXED_B_BLOCKED_BY_A/);
assert.match(runner, /HARNESS_BACKEND_PID_MISMATCH[\s\S]*BACKEND_PIDS_VERIFIED/);
assert.match(runner, /\$blockedBackendPid = \(\$proof -split '\\\|'\)\[2\]/);
assert.match(runner, /MIXED_STATE_COUNTS_OK\|reviews=1\|b1_events=1\|probe_events=1/);
assert.match(runner, /finally \{[\s\S]*ActivePairHandles\.ToArray\(\)[\s\S]*DROP DATABASE IF EXISTS \$DatabaseName WITH \(FORCE\)/);
assert.match(runner, /if \(\$OverallPassed\) \{ Add-Summary PASS 'phase2c_b1_local_rehearsal_complete'/);
assert.doesNotMatch(runner, /Start-Sleep -Milliseconds \$DelayMs/);

const roleCreationFlags = "NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB NOLOGIN NOREPLICATION";
for (const role of ["anon", "authenticated"]) {
  assert.match(bootstrap, new RegExp(`CREATE ROLE ${role} ${roleCreationFlags} NOBYPASSRLS`));
}
assert.match(bootstrap, new RegExp(`CREATE ROLE service_role ${roleCreationFlags} BYPASSRLS`));
for (const sql of [bootstrap, postflight]) {
  assert.match(sql, /\(VALUES \('anon', false\), \('authenticated', false\), \('service_role', true\)\)/);
  assert.match(sql, /LEFT JOIN pg_catalog\.pg_roles AS actual ON actual\.rolname = expected\.rolname/);
  for (const [field, test] of [
    ["rolsuper", "IF v_role.rolsuper THEN"],
    ["rolinherit", "IF NOT v_role.rolinherit THEN"],
    ["rolcreaterole", "IF v_role.rolcreaterole THEN"],
    ["rolcreatedb", "IF v_role.rolcreatedb THEN"],
    ["rolcanlogin", "IF v_role.rolcanlogin THEN"],
    ["rolreplication", "IF v_role.rolreplication THEN"],
    ["rolbypassrls", "IF v_role.rolbypassrls IS DISTINCT FROM v_role.expected_bypassrls THEN"],
  ]) {
    assert.ok(sql.includes(test), `${field} must be checked per role`);
  }
  assert.doesNotMatch(sql, /rolsuper OR rolbypassrls|rolbypassrls OR rolcanlogin/);
}
type RoleAttributes = { superuser: boolean; inherit: boolean; createRole: boolean; createDb: boolean; login: boolean; replication: boolean; bypassRls: boolean };
const expectedBypassRls: Record<string, boolean> = { anon: false, authenticated: false, service_role: true };
const standardRole: RoleAttributes = { superuser: false, inherit: true, createRole: false, createDb: false, login: false, replication: false, bypassRls: false };
const roleMatchesContract = (name: string, role: RoleAttributes) =>
  Object.hasOwn(expectedBypassRls, name) && !role.superuser && role.inherit && !role.createRole &&
  !role.createDb && !role.login && !role.replication && role.bypassRls === expectedBypassRls[name];
assert.equal(roleMatchesContract("anon", standardRole), true);
assert.equal(roleMatchesContract("authenticated", standardRole), true);
assert.equal(roleMatchesContract("service_role", { ...standardRole, bypassRls: true }), true);
assert.equal(roleMatchesContract("anon", { ...standardRole, bypassRls: true }), false);
assert.equal(roleMatchesContract("authenticated", { ...standardRole, bypassRls: true }), false);
for (const elevated of ["superuser", "createRole", "createDb", "login", "replication"] as const) {
  assert.equal(roleMatchesContract("service_role", { ...standardRole, bypassRls: true, [elevated]: true }), false);
}
assert.equal(roleMatchesContract("service_role", standardRole), false);
assert.equal(roleMatchesContract("service_role", { ...standardRole, inherit: false, bypassRls: true }), false);
assert.doesNotMatch(bootstrap, /\b(?:ALTER|DROP) ROLE\b/i);
for (const table of ["merchants","workspaces","merchant_canonical_workspaces","merchant_compliance_profiles","merchant_compliance_reviews","merchant_compliance_events"]) {
  assert.match(bootstrap, new RegExp(`CREATE TABLE (?:public\\.)?${table}`));
}
assert.match(bootstrap, /uq_merchant_compliance_reviews_idempotency UNIQUE \(merchant_id, idempotency_key\)/);
assert.match(bootstrap, /uq_merchant_compliance_events_idempotency UNIQUE \(merchant_id, idempotency_key\)/);
assert.match(bootstrap, /BOOTSTRAP_ROLE_CONTRACT_INCOMPATIBLE:%:bypassrls/);
assert.match(postflight, /POSTFLIGHT_ROLE_CONTRACT_INCOMPATIBLE:%:bypassrls/);
assert.match(postflight, /server_version_num/);
assert.match(postflight, /POSTFLIGHT_RPC_ACL_MISMATCH/);
assert.match(postflight, /POSTFLIGHT_DIRECT_REVIEW_UPDATE_NOT_REVOKED/);
assert.match(postflight, /POSTFLIGHT_BROAD_MERCHANT_UPDATE_PRESENT/);
assert.match(postflight, /POSTFLIGHT_GUARD_SECURITY_MISMATCH/);
assert.match(postflight, /POSTFLIGHT_RLS_MISMATCH/);

for (const probe of ["solo_lite","individual_alias","business","corporate_alias","starter_reject","plus_reject","unknown_reject","workspace_mismatch","owner_mismatch","missing_profile","exact_replay","changed_replay","same_key_other_merchant","legacy_pending","legacy_attention","malformed_snapshot","oversized_snapshot","policy_snapshot_mismatch","unsupported_policy"]) {
  assert.match(behavior, new RegExp(`'${probe}'`));
}
assert.match(migration, /p_policy_version IS DISTINCT FROM '2c-2b-draft-v1'[\s\S]*?'kind', 'invalid_transition'/);
assert.ok(migration.indexOf("p_policy_version IS DISTINCT FROM '2c-2b-draft-v1'") <
  migration.indexOf("p_evidence_snapshot ->> 'policyVersion' IS DISTINCT FROM p_policy_version"));
assert.match(behavior, /'business_future_policy', jsonb_set\(body, '\{policyVersion\}', '"future-approved-v1"'::jsonb\)/);
assert.match(behavior, /'policy_snapshot_mismatch'[\s\S]*?'2c-2b-draft-v1',\(SELECT body FROM rehearsal_snapshots WHERE name='business_future_policy'\)/);
assert.match(behavior, /'unsupported_policy'[\s\S]*?'future-approved-v1',\(SELECT body FROM rehearsal_snapshots WHERE name='business_future_policy'\)/);
assert.match(behavior, /\('policy_snapshot_mismatch','evidence_conflict'\),\('unsupported_policy','invalid_transition'\)/);
assert.match(behavior, /BEHAVIOR_MISMATCH:%:expected=%:actual=%/);
assert.match(behavior, /COALESCE\(\(SELECT actual FROM rehearsal_results WHERE name=v_probe\.name\), '<missing>'\)/);
const expectedKinds: Record<string, string> = {
  solo_lite: "applied", individual_alias: "applied", business: "applied", corporate_alias: "applied",
  starter_reject: "state_conflict", plus_reject: "state_conflict", unknown_reject: "state_conflict",
  workspace_mismatch: "state_conflict", owner_mismatch: "actor_unauthorized", stale_version: "version_conflict",
  exact_replay: "already_processed", changed_replay: "state_conflict", same_key_other_merchant: "applied",
  missing_profile: "state_conflict", legacy_pending: "state_conflict", legacy_attention: "state_conflict",
  malformed_snapshot: "evidence_conflict", oversized_snapshot: "evidence_conflict",
  policy_snapshot_mismatch: "evidence_conflict", unsupported_policy: "invalid_transition",
};
const resultNames = [
  ...[...behavior.matchAll(/INSERT INTO rehearsal_results\s+SELECT '([^']+)'/g)].map(match => match[1]),
  ...[...behavior.matchAll(/INSERT INTO rehearsal_receipts\s+SELECT '([^']+)'/g)].map(match => match[1]),
];
const expectationBlock = behavior.match(/FOR v_probe IN SELECT \* FROM \(VALUES([\s\S]*?)\) x\(name,expected\)/)?.[1];
assert.ok(expectationBlock);
const actualExpectations = Object.fromEntries([...expectationBlock.matchAll(/\('([^']+)','([^']+)'\)/g)].map(match => [match[1],match[2]]));
assert.deepEqual(resultNames.slice().sort(), Object.keys(expectedKinds).sort());
assert.deepEqual(actualExpectations, expectedKinds);
const rpcKinds = new Set([...migration.matchAll(/jsonb_build_object\('kind',\s*'([^']+)'/g)].map(match => match[1]));
assert.deepEqual([...rpcKinds].sort(), ["unsupported_isolation","invalid_transition","state_conflict","actor_unauthorized","version_conflict","evidence_conflict","already_processed","applied"].sort());
for (const kind of Object.values(expectedKinds)) assert.ok(rpcKinds.has(kind));
assert.doesNotMatch(behavior, /DECLARE\s+r\s+record/i);
assert.doesNotMatch(behavior, /merchant_compliance_reviews\s+r\b/i);
for (const sql of [bootstrap, fingerprint, postflight, behavior, worker, mixed, final]) {
  assert.doesNotMatch(sql, /\bDECLARE\s+(?:r|e|m|p|v)\s+record\b/i);
}
assert.match(behavior, /FOR v_probe IN SELECT/);
assert.match(behavior, /merchant_compliance_reviews review_row[\s\S]*merchant_compliance_events event_row/);
for (const field of ["id","merchant_id","profile_id","review_type","target_plan_code","evidence_snapshot","policy_version","submitted_at","idempotency_key"]) {
  assert.match(behavior, new RegExp(`SET ${field}=`));
}
assert.match(behavior, /SQLERRM<>'Submitted review source is immutable'/);
assert.match(behavior, /SQLERRM<>'Submitted review cannot return to draft'/);
assert.match(behavior, /SQLERRM IS DISTINCT FROM 'FORCED_EVENT_FAILURE'/);
assert.match(behavior, /BEHAVIOR_PERSISTENCE_COUNT:expected_reviews=7:actual_reviews=%:expected_events=5:actual_events=%/);
assert.match(behavior, /BEHAVIOR_RESULT_PROVENANCE_MISMATCH/);
assert.match(behavior, /BEHAVIOR_APPLIED_RESULT_PROVENANCE_MISMATCH/);
assert.match(behavior, /INSERT INTO rehearsal_results SELECT name, body->>'kind' FROM rehearsal_receipts WHERE name='solo_lite'/);
assert.match(behavior, /BEHAVIOR_SUBMISSION_LINK_COUNT:expected=5/);
assert.match(migration, /FROM public\.merchants[\s\S]*?FOR NO KEY UPDATE/);
assert.match(migration, /FROM public\.merchant_compliance_profiles[\s\S]*?FOR UPDATE/);
assert.match(migration, /current_setting\('transaction_isolation'\) IS DISTINCT FROM 'read committed'/);
assert.match(migration, /REVOKE UPDATE ON TABLE public\.merchant_compliance_reviews FROM service_role/);
assert.match(migration, /RETURNING id, row_version INTO v_review_id, v_review_version/);
assert.match(migration, /v_event_id, p_merchant_id,[\s\S]*v_review_version,[\s\S]*'row_version', v_review_version/);
assert.match(behavior, /BEGIN ISOLATION LEVEL REPEATABLE READ/);
assert.match(behavior, /BEGIN ISOLATION LEVEL SERIALIZABLE/);
assert.match(behavior, /unsupported_isolation/);
assert.match(behavior, /ID_MUTATION_ALLOWED/);
assert.match(behavior, /SNAPSHOT_MUTATION_ALLOWED/);
assert.match(behavior, /PENDING_TO_DRAFT_ALLOWED/);
assert.match(behavior, /FUTURE_LIFECYCLE_FIELD_BLOCKED/);
assert.match(behavior, /FORCED_EVENT_FAILURE/);
assert.match(behavior, /EVENT_FAILURE_DID_NOT_ROLL_BACK_REVIEW/);
assert.match(behavior, /SERVICE_ROLE_DIRECT_REVIEW_UPDATE_NOT_DENIED/);
assert.match(behavior, /SET ROLE service_role;[\s\S]*?UPDATE public\.merchant_compliance_reviews[\s\S]*?WHEN insufficient_privilege THEN denied := true/);
assert.match(postflight, /has_table_privilege\('service_role','public\.merchant_compliance_reviews','UPDATE'\)/);
// Bootstrap reproduces the prerequisite grant; B1 revokes it before postflight and behavior.
assert.match(bootstrap, /GRANT SELECT, INSERT, UPDATE ON public\.merchant_compliance_reviews TO service_role/);
assert.match(migration, /REVOKE UPDATE ON TABLE public\.merchant_compliance_reviews FROM service_role/);
assert.doesNotMatch([postflight, behavior, runner].join("\n"), /GRANT\s+[^;]*\bUPDATE\b\s+ON\s+(?:TABLE\s+)?(?:public\.)?merchant_compliance_reviews\s+TO\s+service_role/i);
assert.match(worker, /BEGIN;[\s\S]*SET LOCAL ROLE service_role[\s\S]*pg_sleep[\s\S]*COMMIT;/);
assert.match(runner, /@\('-At','-q','-v',"label=\$label"/);
assert.match(worker, /SELECT 'B1_WORKER_RESULT\|'[\s\S]*\(public\.submit_draft_plan_review_v1\([\s\S]*\)->>'kind'\) AS result;/);
assert.doesNotMatch(worker, /\)->>'kind' AS result;/);
assert.match(worker, /B1_WORKER_LOCK_READY\|[\s\S]*pg_backend_pid\(\)/);
assert.match(worker, /phase2c_b1_[\s\S]*_lock_held[\s\S]*B1_WORKER_LOCK_READY/);
assert.match(worker, /phase2c_b1_rehearsal_barriers[\s\S]*B1_RELEASE_BARRIER_TIMEOUT/);
assert.ok(worker.indexOf("public.submit_draft_plan_review_v1") < worker.indexOf("B1_WORKER_LOCK_READY") &&
  worker.indexOf("RESET ROLE;") < worker.indexOf("FROM public.phase2c_b1_rehearsal_barriers"));
assert.match(worker, /statement_timeout = '45s'[\s\S]*lock_timeout = '30s'[\s\S]*interval '25 seconds'/);
assert.match(mixed, /statement_timeout = '45s'[\s\S]*lock_timeout = '30s'[\s\S]*interval '25 seconds'/);
assert.match(runner, /Elapsed\.TotalSeconds -lt 15[\s\S]*Complete-PsqlProcess \$a \$LogPath 60/);
for (const variable of ["label","scenario","worker","merchant_id","workspace_id","actor_id","idempotency_key","policy_id","finding_status","reason_code","evaluated_at","wait_for_release"]) {
  assert.match(runner, new RegExp(`(?:^|[,\\s])(?:\"|')?${variable}=`, "m"));
  assert.match(worker, new RegExp(`:'${variable}'`));
}
assert.ok(worker.indexOf("public.submit_draft_plan_review_v1") < worker.indexOf("'_lock_held'"));
assert.match(mixed, /merchant_compliance_profiles[\s\S]*FOR UPDATE[\s\S]*MILESTONE\|mixed_writer\|profile_locked[\s\S]*phase2c_b1_rehearsal_barriers[\s\S]*INSERT INTO public\.merchant_compliance_events[\s\S]*COMMIT;/);
assert.match(mixed, /MIXED_WRITER_RELEASE_BARRIER_TIMEOUT/);
assert.match(mixed, /MILESTONE\|mixed_writer\|profile_locked\|' \|\| pg_backend_pid\(\)/);
assert.ok(mixed.indexOf("FOR UPDATE") < mixed.indexOf("phase2c_b1_mixed_writer_profile_locked"));
assert.match(final, /FINAL_NON_ADOPTION_VIOLATION/);
assert.match(final, /v_review_count<>11 OR v_event_count<>10 OR v_submission_event_count<>9/);
assert.match(final, /FINAL_SUBMISSION_EVENT_COHERENCE/);
assert.match(final, /FINAL_NON_ADOPTION_VIOLATION:workspace/);
assert.match(final, /FINAL_NON_ADOPTION_VIOLATION:commercial_plan/);
assert.match(final, /review_status='needs_attention'\)<>2/);
assert.match(final, /CONCURRENCY_IDENTICAL_COUNT/);
assert.match(final, /MIXED_WRITER_B1_COUNT/);
assert.match(final, /review_status='pending'\)<>9/);
assert.equal(2 + 5 + 3 + 1, 11);
assert.equal(5 + 3 + 1 + 1, 10);
assert.equal(5 + 3 + 1, 9);
assert.doesNotMatch([behavior, worker, mixed].join("\n"), /UPDATE\s+public\.merchant_compliance_profiles|SET\s+compliance_status\s*=|SET\s+activation_status\s*=/i);

console.log("PASS Phase 2C-2C-B1 disposable local rehearsal harness source contract");
