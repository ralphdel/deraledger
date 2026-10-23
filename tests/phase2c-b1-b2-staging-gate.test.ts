import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const runner = read("scripts/reconcile-phase2c-b1-b2-staging.ps1");
const identity = read("scripts/phase2c-b1-b2-staging/00-identity.sql");
const installed = read("scripts/phase2c-b1-b2-staging/01-installed-state.sql");
const preflight = read("scripts/phase2c-b1-b2-staging/02-preflight.sql");
const b1Postflight = read("scripts/phase2c-b1-b2-staging/03-b1-postflight.sql");
const b2Postflight = read("scripts/phase2c-b1-b2-staging/04-b2-postflight.sql");
const final = read("scripts/phase2c-b1-b2-staging/05-final.sql");
const runbook = read("docs/phase2c-b1-b2-staging-database-gate.md");
const b1MigrationPath = "supabase/migrations/20261021000000_phase2c_nonadopted_review_substrate.sql";
const b2MigrationPath = "supabase/migrations/20261022000000_phase2c_nonadopted_review_triage_resubmission.sql";
const b1Migration = read(b1MigrationPath);
const b2Migration = read(b2MigrationPath);

assert.equal(sha256(b1MigrationPath), "49FD3E667E464D18512C0EF48CC84D475525FB9E635793BD789C6B6326D1B528");
assert.equal(sha256(b2MigrationPath), "23F66A123C89CB2E2C6C2F7001FF83840538DEF9CCB0AAFDADC0BB755A12ADF2");

for (const value of [
  "fsjljliiyfchkwbjifzw",
  "aws-1-eu-central-2.pooler.supabase.com",
  "postgres.fsjljliiyfchkwbjifzw",
  "336d090a769a15b127e0101ff88bbfadaef77fae",
  "C:\\Program Files\\PostgreSQL\\15\\bin\\psql.exe",
]) assert.ok(runner.includes(value), `runner must pin ${value}`);
assert.match(runner, /\$ExpectedServerMajor = '17'/);
assert.match(runner, /"expected_server_major=\$ExpectedServerMajor"/);
assert.match(runner, /\$psqlVersion -cnotmatch [\s\S]*PostgreSQL[\s\S]*15/);
assert.match(runner, /server_major=\$ExpectedServerMajor/);
assert.match(runner, /\$ReviewedB3Baseline = '336d090a769a15b127e0101ff88bbfadaef77fae'/);
assert.match(runner, /\$ExpectedUpstream = 'origin\/staging\/phase-2-rebuild-safe-baseline'/);
assert.doesNotMatch(runner, /\$ExpectedHead\s*=/);
assert.doesNotMatch(runner, /\$head\s+-cne\s+\$ReviewedB3Baseline/);
assert.match(runner, /rev-parse --abbrev-ref --symbolic-full-name '@\{upstream\}'/);
assert.match(runner, /\$upstreamName -cne \$ExpectedUpstream/);
assert.match(runner, /rev-parse --verify "refs\/remotes\/\$ExpectedUpstream"/);
assert.match(runner, /\$head -cne \$upstream/);
assert.match(runner, /cat-file -e "\$ReviewedB3Baseline\^\{commit\}"/);
assert.match(runner, /merge-base --is-ancestor \$ReviewedB3Baseline \$head/);
assert.match(runner, /git -C \$RepoRoot status --porcelain=v1 --untracked-files=all/);
assert.match(runner, /repository_tracked_changes_rejected/);
assert.match(runner, /repository_untracked_source_rejected/);
assert.match(runner, /\$_ -cne '\.local-evidence\/' -and -not \$_.StartsWith\('\.local-evidence\/'\)/);
assert.equal((runner.match(/gznwibespgkwknnvbrlv/g) ?? []).length, 1, "production ref is only a forbidden sentinel");
assert.match(runner, /\$TargetProjectRef -ceq \$ForbiddenProductionRef/);
assert.doesNotMatch(runner, /postgresql:\/\//i);
assert.doesNotMatch(runner, /supabase db (push|reset)/i);
assert.doesNotMatch(runner, /SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE/i);

assert.match(runner, /Read-Host 'Staging database password' -AsSecureString/);
assert.match(runner, /\$env:PGPASSWORD = \$PlainPassword/);
assert.match(runner, /\$env:PGSSLMODE = 'require'/);
assert.match(runner, /\$env:PGGSSENCMODE = 'disable'/);
assert.match(runner, /'PGSSLMODE','PGGSSENCMODE'/);
assert.doesNotMatch(runner, /\$env:PGSSLMODE = '(prefer|allow|disable)'/i);
assert.match(runner, /finally \{[\s\S]*SetEnvironmentVariable[\s\S]*ZeroFreeBSTR/);
assert.match(runner, /foreach \(\$name in \$EnvironmentNames\)[\s\S]*SetEnvironmentVariable\(\$name,\$SavedEnvironment\[\$name\],'Process'\)/);
assert.equal((runner.match(/Read-Host/g) ?? []).length, 1, "one password prompt only");
assert.doesNotMatch(runner, /-W(?:['"\s,])/);
assert.doesNotMatch(runner, /Write(?:AllText|Line)\([^)]*\$(?:PlainPassword|SecurePassword)/);

for (const filename of [
  "00-environment.txt","01-source-hashes.txt","02-installed-state.txt","03-preflight.txt",
  "04-b1-apply.txt","05-b1-postflight.txt","06-b2-apply.txt","07-b2-postflight.txt",
  "08-final.txt","summary.txt",
]) assert.ok(runner.includes(filename), `evidence file ${filename} is required`);
assert.match(runner, /\.local-evidence\/phase2c-b1-b2-staging\/\$Stamp/);

for (const state of ["ABSENT","EXACTLY_INSTALLED","PARTIALLY_INSTALLED","INCOMPATIBLE"]) {
  assert.ok(installed.includes(`'${state}'`), `installed-state classifier must include ${state}`);
}
assert.match(runner, /PARTIALLY_INSTALLED','INCOMPATIBLE/);
assert.match(runner, /migration_ledger_incompatible/);
assert.match(runner, /b1_ledger_object_contradiction/);
assert.match(runner, /b2_ledger_object_contradiction/);
assert.doesNotMatch([installed, preflight, b1Postflight, b2Postflight, final].join("\n"),
  /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE)\b/im);
assert.doesNotMatch([runner, installed, preflight, b1Postflight, b2Postflight, final].join("\n"),
  /(INSERT|UPDATE|DELETE)\s+(INTO\s+|FROM\s+)?supabase_migrations\.schema_migrations/i);
assert.match(installed, /20261021000000_phase2c_nonadopted_review_substrate/);
assert.match(installed, /20261022000000_phase2c_nonadopted_review_triage_resubmission/);

assert.match(identity, /set_config\('deraledger\.phase2c_expected_database',[\s\S]*expected_database/);
assert.match(identity, /current_database\(\)[\s\S]*current_setting\('deraledger\.phase2c_expected_database'\)/);
assert.match(identity, /current_user[\s\S]*current_setting\('deraledger\.phase2c_expected_current_user'\)/);
assert.match(identity, /session_user[\s\S]*current_setting\('deraledger\.phase2c_expected_current_user'\)/);
assert.match(identity, /set_config\('deraledger\.phase2c_expected_server_major',[\s\S]*expected_server_major/);
assert.match(identity, /current_setting\('server_version_num'\)::integer \/ 10000[\s\S]*current_setting\('deraledger\.phase2c_expected_server_major'\)::integer/);
assert.doesNotMatch(identity, /server_version_num'\)::integer\s*(<|>=)\s*1[56]0000/);
for (const reason of ["database", "current_user", "session_user", "server_major", "auth_schema", "auth_users"]) {
  assert.ok(identity.includes(`PHASE2C_STAGING_TARGET_IDENTITY_REJECTED:${reason}`), `identity must distinguish ${reason}`);
}
assert.doesNotMatch(identity, /PHASE2C_STAGING_TARGET_IDENTITY_REJECTED:tls/);
assert.match(identity, /\\conninfo/);
assert.match(identity, /CONTROL\|IDENTITY_FACTS\|/);
assert.match(identity, /client_ssl_required=true/);
assert.match(identity, /backend_ssl=/);
assert.match(identity, /pg_stat_ssl/);
assert.match(identity, /auth\.users/);
const identityGuard = identity.slice(identity.indexOf("DO $identity$"), identity.indexOf("$identity$;"));
assert.doesNotMatch(identityGuard, /pg_stat_ssl|backend_ssl/,
  "backend-visible SSL state must remain informational rather than gate client TLS");
assert.match(runner, /client_pooler_tls_required/);
for (const source of [identity, installed, preflight, b1Postflight, b2Postflight, final]) {
  assert.match(source, /BEGIN READ ONLY;/);
  assert.match(source, /COMMIT;/);
}
assert.doesNotMatch(identity.slice(identity.indexOf("DO $identity$")), /:'expected_/);
assert.doesNotMatch(preflight.slice(preflight.indexOf("DO $preflight$")), /:'b[12]_state'/);
for (const table of ["merchants","workspaces","merchant_canonical_workspaces","merchant_compliance_profiles",
  "merchant_compliance_reviews","merchant_compliance_events"]) assert.ok(preflight.includes(table));
assert.match(installed, /CONTROL\|CATALOG_FACTS\|/);
assert.match(installed, /CONTROL\|LEDGER_FACTS\|/);
assert.match(installed, /shape=' \|\| CASE[\s\S]*'missing'[\s\S]*'compatible'[\s\S]*'incompatible'/);
assert.ok(installed.indexOf("CONTROL|LEDGER_FACTS|") < installed.indexOf("WITH expected AS"),
  "ledger shape facts and guard must precede installed-object classification");
assert.match(preflight, /CONTROL\|PREFLIGHT_FACTS\|/);
assert.match(preflight, /server_major_compatible=/);
assert.match(preflight, /PHASE2C_STAGING_SERVER_MAJOR_INCOMPATIBLE/);
assert.ok(identity.indexOf("CONTROL|IDENTITY_FACTS|") < identity.indexOf("DO $identity$"),
  "identity facts must be emitted before a bounded identity rejection");
assert.ok(preflight.indexOf("CONTROL|PREFLIGHT_FACTS|") < preflight.indexOf("DO $preflight$"),
  "preflight facts must be emitted before a bounded prerequisite rejection");
for (const contract of ["is_super_admin","review_status","row_version","uq_merchant_compliance_reviews_idempotency",
  "uq_merchant_compliance_events_idempotency","merchant_canonical_workspaces_workspace_owner_fkey",
  "merchant_compliance_profiles_plan_code_check","merchant_compliance_reviews_type_plan_check",
  "merchant_compliance_reviews_status_check","relrowsecurity","relforcerowsecurity"]) assert.ok(preflight.includes(contract));

const extractBody = (source: string, tag: string) => {
  const open = `AS $${tag}$`;
  const close = `$${tag}$;`;
  const start = source.indexOf(open);
  assert.ok(start >= 0, `missing ${tag} body`);
  const bodyStart = start + open.length;
  const end = source.indexOf(close, bodyStart);
  assert.ok(end >= 0, `missing ${tag} terminator`);
  return source.slice(bodyStart, end).replaceAll("\r", "");
};
for (const [source, tag, expected] of [
  [b1Migration, "freeze_submitted_plan_review_v1", "3ab9e2fbeb9d503865b1beedd7cfbe5663bbb34c0ddd289398b53e8e0b11d26f"],
  [b1Migration, "submit_draft_plan_review_v1", "409afc2d25dbeb698de5bfbfba65c64860e75d570a1d7499fb8c9710f9fd40cd"],
  [b2Migration, "b2_rmi", "9d3b4e4b0d580287322947471e9e2631674f5cc688d472c631c3cbe295d54569"],
  [b2Migration, "b2_resubmit", "b8093b4402828ae6b7b47aebcaf912f12ca65d0b326c37ebb28aecc3f82f0e88"],
] as const) {
  const actual = createHash("sha256").update(extractBody(source, tag)).digest("hex");
  assert.equal(actual, expected);
  assert.ok(installed.includes(expected), `${tag} installed-state hash must be pinned`);
}

for (const contract of ["prosecdef","proowner","proconfig","prosrc","proacl","aclexplode",
  "has_function_privilege","has_table_privilege","tgenabled","tgfoid","search_path=pg_catalog, pg_temp"]) {
  assert.ok([installed, b1Postflight, b2Postflight].join("\n").includes(contract), `missing ${contract} proof`);
}
assert.match(final, /2c-2b-draft-v1/);
assert.match(final, /UPDATE\[\[:space:\]\]\+public\[\.\]merchant_compliance_profiles/);
assert.match(final, /lite_verified\|business_verified\|live_features_enabled\|setup_mode/);

const firstInspect = runner.indexOf("$state = Get-InstalledState");
const firstPreflight = runner.indexOf("Invoke-Preflight $state");
const b1Apply = runner.indexOf("Invoke-StagingPsql '04-b1-apply.txt'");
const b1Post = runner.indexOf("Invoke-StagingPsql '05-b1-postflight.txt'");
const b2Apply = runner.indexOf("Invoke-StagingPsql '06-b2-apply.txt'");
const b2Post = runner.indexOf("Invoke-StagingPsql '07-b2-postflight.txt'");
const finalCheck = runner.indexOf("Invoke-StagingPsql '08-final.txt'");
assert.ok(firstInspect < firstPreflight && firstPreflight < b1Apply && b1Apply < b1Post &&
  b1Post < b2Apply && b2Apply < b2Post && b2Post < finalCheck, "gate ordering must remain fail-closed");
assert.ok(runner.indexOf("Invoke-StagingPsql '00-environment.txt'") < firstInspect,
  "identity and connection facts must precede installed-state inspection");
assert.match(runner, /if \(\$state\.B1 -eq 'ABSENT'\)[\s\S]*else \{[\s\S]*b1_exactly_installed/);
assert.match(runner, /if \(\$state\.B2 -eq 'ABSENT'\)[\s\S]*else \{[\s\S]*b2_exactly_installed/);

for (const marker of ["staging_target_identity","b1_b2_source_hashes","staging_schema_compatibility",
  "b1_security_postflight","b2_security_postflight","draft_policy_nonadoption",
  "profile_activation_firewall","staging_b1_b2_database_gate_complete"]) assert.ok(runner.includes(marker));
assert.match(runner, /Add-Marker 'BLOCKED'/);
assert.match(runbook, /powershell\.exe -NoProfile -ExecutionPolicy Bypass -File \.\\scripts\\reconcile-phase2c-b1-b2-staging\.ps1/);
assert.match(runbook, /does not insert, update, delete, or repair `supabase_migrations\.schema_migrations`/i);

console.log("Phase 2C B1+B2 staging gate source contract passed.");
