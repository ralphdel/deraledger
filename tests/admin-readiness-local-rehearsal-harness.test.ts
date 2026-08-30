import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const migrationFile = "20260831_00_admin_readiness_durable_security_storage.sql";
const scriptPaths = [
  "scripts/admin-readiness-security-local-preflight.ps1",
  "scripts/admin-readiness-security-local-apply.ps1",
  "scripts/admin-readiness-security-local-postflight.ps1",
  "scripts/admin-readiness-security-local-behavior.ps1",
  "scripts/admin-readiness-security-local-rollback.ps1",
] as const;
const scripts = scriptPaths.map((scriptPath) => {
  assert.ok(existsSync(scriptPath), `${scriptPath} must exist`);
  const source = readFileSync(scriptPath, "utf8");
  assert.notEqual(readFileSync(scriptPath)[0], 0xef, `${scriptPath} must be UTF-8 without a BOM`);
  return { scriptPath, source };
});

for (const { scriptPath, source } of scripts) {
  assert.match(source, /Set-StrictMode -Version Latest/, `${scriptPath} must use strict mode`);
  assert.match(source, /\$ErrorActionPreference\s*=\s*'Stop'/, `${scriptPath} must stop on error`);
  assert.doesNotMatch(source, /\$Host\b/, `${scriptPath} must not use PowerShell's built-in $Host variable`);
  for (const safeVariable of ["$DbHost", "$DbPort", "$DbName", "$DbUser"]) {
    assert.ok(source.includes(safeVariable), `${scriptPath} must use ${safeVariable}`);
  }
  assert.match(source, /Read-Host/, `${scriptPath} must prompt locally rather than accept a connection string`);
  assert.match(source, /CONNECTION_STRING_REJECTED/, `${scriptPath} must reject connection strings`);
  assert.match(source, /localhost/, `${scriptPath} must allow localhost`);
  assert.match(source, /127\.0\.0\.1/, `${scriptPath} must allow loopback IPv4`);
  assert.match(source, /NONLOCAL_HOST_REJECTED/, `${scriptPath} must reject remote-looking hosts`);
  assert.match(source, /SUPABASE_CLOUD_HOST_REJECTED/, `${scriptPath} must explicitly reject Supabase cloud hosts`);
  assert.match(source, /DISPOSABLE_DATABASE_NAME_REQUIRED/, `${scriptPath} must require a disposable database name`);
  assert.match(source, /DATABASE_NAME_REJECTED/, `${scriptPath} must reject staging/production-looking database names`);
  assert.match(source, /DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED/, `${scriptPath} must keep the route flag disabled`);
  assert.match(source, /local-evidence\/admin-readiness-security/, `${scriptPath} must write only local evidence`);
  assert.match(source, /UTF8Encoding\]::new\(\$false\)/, `${scriptPath} must write UTF-8 evidence without a BOM`);
  assert.match(source, /PsqlPath = 'psql'/, `${scriptPath} must use psql only when a user later runs it`);
  for (const environmentName of ["PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSERVICE", "PGSERVICEFILE", "PGPASSFILE", "PGOPTIONS", "PGSSLMODE"]) {
    assert.match(source, new RegExp(environmentName), `${scriptPath} must isolate inherited ${environmentName}`);
  }
  assert.match(source, /SavedPgEnvironment/, `${scriptPath} must preserve inherited PostgreSQL environment values only for restoration`);
  assert.match(source, /SetEnvironmentVariable\(\$environmentName,\s*\$null,\s*'Process'\)/, `${scriptPath} must neutralize inherited PostgreSQL environment values before psql`);
  assert.match(source, /SetEnvironmentVariable\(\$environmentName,\s*\$SavedPgEnvironment\[\$environmentName\],\s*'Process'\)/, `${scriptPath} must restore inherited PostgreSQL environment values after psql`);
  assert.doesNotMatch(source, /https?:\/\//i, `${scriptPath} must not embed a remote URL target`);
  assert.doesNotMatch(source, /(?:docker|wsl|supabase\s+cli)/i, `${scriptPath} must not require Docker, WSL, or Supabase CLI`);
  assert.doesNotMatch(source, /(?:issue_canonical_approval|review_compliance_profile_decision|activate merchant|collection unlock|checkout|paystack|subscription|invoice|storefront)/i, `${scriptPath} must not introduce forbidden behavior`);
}

for (const { scriptPath, source } of scripts.filter(({ scriptPath }) => !scriptPath.includes("preflight"))) {
  assert.match(source, /Read-Host .*password.*-AsSecureString/i, `${scriptPath} must use a secure local password prompt`);
  assert.match(source, /ZeroFreeBSTR/, `${scriptPath} must clear transient password material`);
  assert.doesNotMatch(source, /(?:Set-Content|WriteAllText|WriteAllLines)\([^\n]*(?:Password|PGPASSWORD)/i, `${scriptPath} must not write password material`);
}

const preflight = scripts.find(({ scriptPath }) => scriptPath.includes("preflight"))!.source;
assert.match(preflight, new RegExp(migrationFile), "preflight must verify the exact migration source");
assert.match(preflight, /RunReadOnlyChecks/, "preflight must default to dry inspection");
assert.match(preflight, /read_only_metadata_check_requires_RunReadOnlyChecks/, "preflight must not connect unless explicitly requested later");
for (const identityField of ["current_database()", "inet_server_addr()", "inet_server_port()", "version()", "current_user", "CONNECTED_DATABASE_MISMATCH", "SERVER_ADDRESS_NOT_LOOPBACK", "SUSPICIOUS_SERVER_METADATA", "localhost tunnels remain operator risk"]) {
  assert.match(preflight, new RegExp(identityField.replace(/[()]/g, "\\$&")), `preflight must verify ${identityField}`);
}
for (const prerequisite of ["service_role_exists", "service_role_bypassrls", "service_role_assumable", "SERVICE_ROLE_PREREQUISITE_FAILED"]) {
  assert.match(preflight, new RegExp(prerequisite), `preflight must verify ${prerequisite}`);
}

const apply = scripts.find(({ scriptPath }) => scriptPath.includes("apply"))!.source;
assert.match(apply, new RegExp(migrationFile), "apply must reference the exact migration");
assert.match(apply, /APPLY ADMIN READINESS SECURITY MIGRATION TO LOCAL DISPOSABLE DB/, "apply must require exact typed confirmation");
assert.match(apply, /-f \$MigrationPath/, "apply must use only the approved migration file");

const postflight = scripts.find(({ scriptPath }) => scriptPath.includes("postflight"))!.source;
for (const expectedCheck of ["exact_rpc_signatures=6", "approved_rpc_overloads=6", "unexpected_security_functions=0", "tables=3", "rls=3", "browser_policies=0", "browser_table_grants=0", "service_role_table_grants=3", "service_role_function_grants=6", "browser_function_grants=0", "security_invoker=6", "hardened_search_path=6", "unsafe_columns=0", "table_bytes="]) {
  assert.match(postflight, new RegExp(expectedCheck.replace(/[=]/g, "\\=")), `postflight must verify ${expectedCheck}`);
}
assert.match(postflight, /to_regprocedure/, "postflight must verify exact RPC identities");
assert.match(postflight, /approved_rpc_overloads/, "postflight must reject approved-name overloads");

const behavior = scripts.find(({ scriptPath }) => scriptPath.includes("behavior"))!.source;
for (const scenario of ["csrf_create_success", "csrf_create_collision_conflict", "csrf_read_allow", "csrf_expired_denied", "csrf_session_mismatch_denied", "csrf_rotate_success", "csrf_predecessor_invalidated", "csrf_invalidate_binding_bounded", "throttle_allow", "throttle_rate_limited", "cleanup_expired_rows", "malformed_bounds_denied"]) {
  assert.match(behavior, new RegExp(scenario), `behavior script must cover ${scenario}`);
}
assert.match(behavior, /admin_readiness_local_v1/, "behavior script must use the local-only namespace");
assert.match(behavior, /ROLLBACK;/, "behavior script must roll back its own security test rows");
assert.match(behavior, /RAW_DIAGNOSTICS=NOT_RECORDED/, "behavior evidence must not record raw diagnostics");
assert.match(behavior, /Assert-ServiceRolePrerequisiteEvidence/, "behavior must block without reviewed service_role evidence");
assert.match(behavior, /SERVICE_ROLE_EVIDENCE_MISSING/, "behavior must fail closed when prerequisite evidence is absent");
assert.match(behavior, /PREFLIGHT_TARGET_EVIDENCE_MISMATCH/, "behavior must bind service_role evidence to the prompted database");

const rollback = scripts.find(({ scriptPath }) => scriptPath.includes("rollback"))!.source;
assert.match(rollback, /ROLLBACK ADMIN READINESS SECURITY MIGRATION FROM LOCAL DISPOSABLE DB/, "rollback must require exact typed confirmation");
for (const objectName of [
  "create_admin_readiness_csrf_token_v1",
  "read_admin_readiness_csrf_token_v1",
  "rotate_admin_readiness_csrf_token_v1",
  "invalidate_admin_readiness_csrf_binding_v1",
  "decide_admin_readiness_throttle_v1",
  "cleanup_admin_readiness_security_storage_v1",
  "admin_readiness_csrf_tokens",
  "admin_readiness_csrf_binding_index",
  "admin_readiness_throttle_windows",
]) assert.match(rollback, new RegExp(objectName), `rollback must be limited to ${objectName}`);
assert.doesNotMatch(rollback, /DROP TABLE public\.(?!admin_readiness_csrf_tokens|admin_readiness_csrf_binding_index|admin_readiness_throttle_windows)/i, "rollback must not drop business tables");
assert.match(rollback, /remaining_tables=0/, "rollback must verify removal of the exact tables");
assert.match(rollback, /remaining_functions=0/, "rollback must verify removal of the exact RPCs");
assert.match(rollback, /RequireBusinessSchemaBaseline/, "rollback must support mandatory business-schema verification");
assert.match(rollback, /BUSINESS_SCHEMA_BASELINE_REQUIRED/, "rollback must fail closed if requested baseline evidence is absent");
assert.match(rollback, /BUSINESS_SCHEMA_BASELINE_MISMATCH/, "rollback must reject business-schema baseline drift");
assert.match(rollback, /PREFLIGHT_TARGET_EVIDENCE_MISMATCH/, "rollback must bind baseline evidence to the prompted database");

const checkpoint = readFileSync("docs/prd-phase-2-admin-readiness-local-rehearsal-harness-source-checkpoint.md", "utf8");
assert.match(checkpoint, /process, user, and machine scopes/i, "checkpoint must describe every route-flag scope");

console.log("admin-readiness-local-rehearsal-harness.test.ts passed");
