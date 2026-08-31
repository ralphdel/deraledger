import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const migrationFile = "20260831_00_admin_readiness_durable_security_storage.sql";
const scriptPaths = [
  "scripts/admin-readiness-security-staging-preflight.ps1",
  "scripts/admin-readiness-security-staging-apply.ps1",
  "scripts/admin-readiness-security-staging-postflight.ps1",
  "scripts/admin-readiness-security-staging-behavior.ps1",
] as const;
const scripts = scriptPaths.map((scriptPath) => {
  assert.ok(existsSync(scriptPath), `${scriptPath} must exist`);
  const bytes = readFileSync(scriptPath);
  assert.notEqual(bytes[0], 0xef, `${scriptPath} must be UTF-8 without a BOM`);
  return { scriptPath, source: bytes.toString("utf8") };
});

const approvedTables = [
  "admin_readiness_csrf_tokens",
  "admin_readiness_csrf_binding_index",
  "admin_readiness_throttle_windows",
] as const;
const approvedRpcs = [
  "create_admin_readiness_csrf_token_v1",
  "read_admin_readiness_csrf_token_v1",
  "rotate_admin_readiness_csrf_token_v1",
  "invalidate_admin_readiness_csrf_binding_v1",
  "decide_admin_readiness_throttle_v1",
  "cleanup_admin_readiness_security_storage_v1",
] as const;
const isolatedPgVariables = [
  "PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD",
  "PGSERVICE", "PGSERVICEFILE", "PGPASSFILE", "PGOPTIONS", "PGSSLMODE",
] as const;
const approvedStagingProjectRef = "fsjljliiyfchkwbjifzw";
const approvedStagingPoolerHost = "aws-1-eu-central-2.pooler.supabase.com";
const approvedStagingPort = "5432";
const approvedStagingDatabase = "postgres";
const approvedStagingUser = "postgres.fsjljliiyfchkwbjifzw";
const unapprovedOpaquePoolerHost = "aws-1-eu-central-2.pooler.supabase.com";
const unapprovedOpaquePoolerUser = "postgres.abcdefghijklmnopqrst";

function sourceAnchoredStagingTargetAllows(host: string, port: string, database: string, user: string, confirmedProjectRef: string): boolean {
  const parsed = /^postgres\.([a-z0-9]+)$/.exec(user);
  return host === approvedStagingPoolerHost
    && port === approvedStagingPort
    && database === approvedStagingDatabase
    && user === approvedStagingUser
    && parsed?.[1] === approvedStagingProjectRef
    && confirmedProjectRef === approvedStagingProjectRef;
}

assert.equal(sourceAnchoredStagingTargetAllows(approvedStagingPoolerHost, approvedStagingPort, approvedStagingDatabase, approvedStagingUser, approvedStagingProjectRef), true, "the reviewed staging pooler identity tuple must be accepted");
assert.equal(sourceAnchoredStagingTargetAllows(unapprovedOpaquePoolerHost, approvedStagingPort, approvedStagingDatabase, unapprovedOpaquePoolerUser, "abcdefghijklmnopqrst"), false, "a syntactically valid opaque Supabase pooler ref must be rejected when it is not source-approved");
assert.equal(sourceAnchoredStagingTargetAllows("aws-1-eu-west-1.pooler.supabase.com", approvedStagingPort, approvedStagingDatabase, approvedStagingUser, approvedStagingProjectRef), false, "an unapproved pooler host must be rejected even when its user has the approved ref");

for (const { scriptPath, source } of scripts) {
  assert.match(source, /Set-StrictMode -Version Latest/, `${scriptPath} must use strict mode`);
  assert.match(source, /\$ErrorActionPreference\s*=\s*'Stop'/, `${scriptPath} must stop on error`);
  assert.doesNotMatch(source, /\$Host\b/, `${scriptPath} must not use PowerShell's built-in $Host variable`);
  for (const safeVariable of ["$DbHost", "$DbPort", "$DbName", "$DbUser", "$ApprovedStagingProjectRef", "$ApprovedStagingPoolerHost", "$ApprovedStagingPort", "$ApprovedStagingDatabase", "$ApprovedStagingUser", "$ConfirmedStagingProjectRef"]) {
    assert.ok(source.includes(safeVariable), `${scriptPath} must use ${safeVariable}`);
  }
  assert.match(source, new RegExp(`\\$ApprovedStagingProjectRef\\s*=\\s*'${approvedStagingProjectRef}'`), `${scriptPath} must source-anchor the approved staging project ref`);
  assert.match(source, new RegExp(`\\$ApprovedStagingPoolerHost\\s*=\\s*'${approvedStagingPoolerHost.replace(/\./g, "\\.")}'`), `${scriptPath} must source-anchor the approved staging pooler host`);
  assert.match(source, new RegExp(`\\$ApprovedStagingPort\\s*=\\s*'${approvedStagingPort}'`), `${scriptPath} must source-anchor the approved staging port`);
  assert.match(source, new RegExp(`\\$ApprovedStagingDatabase\\s*=\\s*'${approvedStagingDatabase}'`), `${scriptPath} must source-anchor the approved staging database`);
  assert.match(source, new RegExp(`\\$ApprovedStagingUser\\s*=\\s*'${approvedStagingUser}'`), `${scriptPath} must source-anchor the approved staging pooler user`);
  assert.match(source, /\$DbHost\s+-cne\s+\$ApprovedStagingPoolerHost/, `${scriptPath} must compare entered host to the approved pooler host`);
  assert.match(source, /\$DbPort\s+-cne\s+\$ApprovedStagingPort/, `${scriptPath} must compare entered port to the approved port`);
  assert.match(source, /\$DbName\s+-cne\s+\$ApprovedStagingDatabase/, `${scriptPath} must compare entered database to the approved database`);
  assert.match(source, /\$DbUser\s+-cne\s+\$ApprovedStagingUser/, `${scriptPath} must compare entered user to the approved pooler user`);
  assert.match(source, /\$UserMatch\s*=\s*\[regex\]::Match\(\$DbUser/, `${scriptPath} must parse the project ref from the pooler user`);
  assert.match(source, /\$ParsedStagingProjectRef\s+-cne\s+\$ApprovedStagingProjectRef/, `${scriptPath} must compare parsed pooler-user ref to the approved ref`);
  assert.match(source, /\$ConfirmedStagingProjectRef\s+-cne\s+\$ApprovedStagingProjectRef/, `${scriptPath} must treat user ref input as confirmation only`);
  assert.doesNotMatch(source, /\$ExpectedStagingProjectRef/, `${scriptPath} must not allow user-provided ref input to define target authority`);
  assert.match(source, /ADMIN_READINESS_STAGING_POOLER_HOST_NOT_APPROVED/, `${scriptPath} must fail closed for unapproved opaque Supabase pooler hosts`);
  assert.match(source, /Read-Host/, `${scriptPath} must prompt locally`);
  assert.match(source, /CONNECTION_STRING_REJECTED/, `${scriptPath} must reject connection strings`);
  assert.match(source, /localhost/, `${scriptPath} must identify localhost for rejection`);
  assert.match(source, /127\.0\.0\.1/, `${scriptPath} must identify loopback IPv4 for rejection`);
  assert.match(source, /STAGING_LOCALHOST_REJECTED/, `${scriptPath} must reject local targets`);
  assert.match(source, /STAGING_PRODUCTION_INDICATOR_REJECTED/, `${scriptPath} must reject production-looking targets`);
  assert.match(source, /STAGING_PROJECT_REF_CONFIRMATION_MISMATCH/, `${scriptPath} must require exact staging host/project-ref confirmation`);
  assert.match(source, /STAGING_UNRECOGNIZED_HOST_REJECTED/, `${scriptPath} must fail closed on ambiguous hosts`);
  assert.match(source, /DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED/, `${scriptPath} must keep routes disabled`);
  assert.match(source, /Process[\s\S]*User[\s\S]*Machine/, `${scriptPath} must check route flag across process, user, and machine scopes`);
  assert.match(source, /local-evidence\/admin-readiness-security\/staging/, `${scriptPath} must keep evidence local and untracked`);
  assert.match(source, /UTF8Encoding\]::new\(\$false\)/, `${scriptPath} must write UTF-8 evidence without a BOM`);
  assert.match(source, /PsqlPath = 'psql'/, `${scriptPath} must use psql only when a user later runs it`);
  assert.doesNotMatch(source, /SHA256\]::HashData/, `${scriptPath} must not use unavailable SHA256.HashData`);
  assert.match(source, /SHA256\]::Create\(\)/, `${scriptPath} must use a Windows PowerShell-compatible SHA-256 implementation`);
  assert.match(source, /PGSSLMODE.*require/, `${scriptPath} must require SSL for the approved pooler path`);
  assert.doesNotMatch(source, /\^db\\\.\(\[a-z0-9-\]\+\)\\\.supabase\\\.co\$/, `${scriptPath} must not require the unused direct Supabase database host`);
  assert.doesNotMatch(source, /Get-Command\s+(?:docker|wsl|supabase)/i, `${scriptPath} must not require Docker, WSL, or Supabase CLI`);
  assert.doesNotMatch(source, /(?:issue_canonical_approval|review_compliance_profile_decision|activate merchant|collection unlock|checkout|paystack|subscription|invoice|storefront)/i, `${scriptPath} must not introduce forbidden behavior`);
  for (const environmentName of isolatedPgVariables) assert.match(source, new RegExp(environmentName), `${scriptPath} must isolate inherited ${environmentName}`);
  assert.match(source, /SavedPgEnvironment/, `${scriptPath} must preserve inherited PostgreSQL values for restoration`);
  assert.match(source, /SetEnvironmentVariable\(\$environmentName,\s*\$null,\s*'Process'\)/, `${scriptPath} must neutralize inherited PostgreSQL settings`);
  assert.match(source, /SetEnvironmentVariable\(\$environmentName,\s*\$SavedPgEnvironment\[\$environmentName\],\s*'Process'\)/, `${scriptPath} must restore inherited PostgreSQL settings`);
  assert.match(source, /Read-Host .*password.*-AsSecureString/i, `${scriptPath} must prompt for password locally as a secure string when run`);
  assert.match(source, /ZeroFreeBSTR/, `${scriptPath} must clear temporary password material`);
  assert.doesNotMatch(source, /(?:Set-Content|WriteAllText|WriteAllLines)\([^\n]*(?:Password|PGPASSWORD)/i, `${scriptPath} must not persist password material`);
}

const preflight = scripts.find(({ scriptPath }) => scriptPath.includes("preflight"))!.source;
assert.match(preflight, new RegExp(migrationFile), "preflight must reference the exact migration source");
assert.match(preflight, /RunReadOnlyChecks/, "preflight must default to dry inspection");
assert.match(preflight, /read_only_metadata_check_requires_RunReadOnlyChecks/, "preflight must not connect without explicit user-run opt-in");
for (const preflightCheck of [
  "current_database()", "inet_server_addr()", "inet_server_port()", "version()",
  "service_role_exists", "service_role_bypassrls", "service_role_assumable", "operator_can_apply",
  "existing_security_tables=0", "existing_security_functions=0",
  "business_schema_baseline", "security_table_bytes", "Get-FileHash",
  "STAGING PREFLIGHT TARGET CONFIRMED", "STAGING_AMBIGUOUS_OR_LOCAL_SERVER_IDENTITY",
]) assert.match(preflight, new RegExp(preflightCheck.replace(/[()]/g, "\\$&")), `preflight must verify ${preflightCheck}`);
assert.match(preflight, /current_user=postgres/, "preflight may record the expected pooler current_user without treating it as project identity");
assert.match(preflight, /\$ParsedStagingProjectRef\s*=\s*\$UserMatch\.Groups\[1\]\.Value/, "preflight must derive project identity from DbUser, not SQL current_user");

const apply = scripts.find(({ scriptPath }) => scriptPath.includes("apply"))!.source;
assert.match(apply, new RegExp(migrationFile), "apply must reference the exact migration");
assert.match(apply, /STAGING APPLY ADMIN READINESS SECURITY MIGRATION/, "apply must require exact typed confirmation");
assert.match(apply, /Assert-MatchingPreflightEvidence/, "apply must require matching staging preflight evidence");
assert.match(apply, /-f \$MigrationPath/, "apply must apply only the approved migration file");

const postflight = scripts.find(({ scriptPath }) => scriptPath.includes("postflight"))!.source;
for (const expectedCheck of [
  "exact_rpc_signatures=6", "approved_rpc_overloads=6", "unexpected_security_functions=0",
  "tables=3", "unexpected_security_tables=0", "rls=3", "browser_policies=0",
  "browser_table_grants=0", "service_role_table_grants=3", "service_role_function_grants=6",
  "browser_function_grants=0", "security_invoker=6", "hardened_search_path=6",
  "unsafe_columns=0", "table_bytes=", "business_schema_baseline",
]) assert.match(postflight, new RegExp(expectedCheck.replace(/[=]/g, "\\=")), `postflight must verify ${expectedCheck}`);
assert.match(postflight, /to_regprocedure/, "postflight must verify exact RPC signatures");
assert.match(postflight, /approved_rpc_overloads/, "postflight must reject unexpected RPC overloads");
assert.match(postflight, /Assert-MatchingApplyEvidence/, "postflight must require matching apply evidence");
assert.match(postflight, /security_invoker/, "postflight must verify SECURITY INVOKER");
assert.match(postflight, /search_path=pg_catalog, public/, "postflight must verify hardened search_path");

const behavior = scripts.find(({ scriptPath }) => scriptPath.includes("behavior"))!.source;
for (const scenario of [
  "csrf_create_success", "csrf_create_collision_conflict", "csrf_read_allow", "csrf_expired_denied",
  "csrf_session_mismatch_denied", "csrf_rotate_success", "csrf_predecessor_invalidated",
  "csrf_invalidate_binding_bounded", "throttle_allow", "throttle_rate_limited",
  "cleanup_expired_rows", "malformed_bounds_denied",
]) assert.match(behavior, new RegExp(scenario), `behavior must cover ${scenario}`);
assert.match(behavior, /admin_readiness_staging_v1/, "behavior must use only the staging namespace");
assert.match(behavior, /STAGING RUN ADMIN READINESS SECURITY BEHAVIOR CHECKS/, "behavior must require its own typed confirmation");
assert.match(behavior, /Assert-MatchingPostflightEvidence/, "behavior must require matching postflight evidence");
assert.match(behavior, /BEGIN;[\s\S]*ROLLBACK;/, "behavior must roll back test-only security rows");
assert.match(behavior, /RAW_DIAGNOSTICS=NOT_RECORDED/, "behavior must not record raw diagnostics");

for (const objectName of [...approvedTables, ...approvedRpcs]) assert.ok(scripts.some(({ source }) => source.includes(objectName)), `staging harness must be limited to approved object ${objectName}`);
assert.ok(!existsSync("scripts/admin-readiness-security-staging-rollback.ps1"), "staging rollback must remain a separately approved plan, not a harness script");

console.log("admin-readiness-staging-harness.test.ts passed");
