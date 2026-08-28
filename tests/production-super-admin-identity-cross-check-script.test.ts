import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const scriptPath = "scripts/check-production-super-admin-identity-cross-check.ps1";
const script = readFileSync(scriptPath, "utf8");
const trimmedScriptStart = script.replace(/^\uFEFF?/, "").trimStart();
const sqlStart = script.indexOf('$readOnlySql = @"');
const sqlEnd = script.indexOf('"@', sqlStart + 1);
const sql = sqlStart >= 0 && sqlEnd > sqlStart ? script.slice(sqlStart, sqlEnd) : "";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx|ps1)$/.test(entry.name) ? [path] : [];
  });
}

assert.match(trimmedScriptStart, /^param\(/);
assert.match(script, /READ ONLY PRODUCTION SUPER ADMIN IDENTITY CROSS CHECK/);
assert.match(script, /Read-Host "Production PostgreSQL password for \$targetUser@\$targetHost" -AsSecureString/);
assert.match(script, /-h", \$HostValue/);
assert.match(script, /-p", \[string\]\$PortValue/);
assert.match(script, /-U", \$UserValue/);
assert.match(script, /-d", \$DatabaseValue/);
assert.match(script, /-f", \$FilePath/);
assert.match(script, /Start-Process -FilePath \$PsqlPath -ArgumentList @\(/);
assert.doesNotMatch(script, /ConnectionString|DATABASE_URL|SUPABASE_DB_URL|-d\s+\$[A-Za-z]*ConnectionString/i);
assert.match(script, /PRODUCTION_SUPER_ADMIN_IDENTITY_CROSS_CHECK=(?:PASS|MANUAL_REVIEW|FAIL)/);
assert.match(script, /\.local-evidence\/production-super-admin-identity-cross-check-\$timestamp/);
assert.match(script, /target_email_sha256/);
assert.match(script, /auth_user_id_redacted/);
assert.doesNotMatch(script, /Write-Output\s+\$env:PGPASSWORD|Write-Output\s+\$passwordSecure/i);
assert.doesNotMatch(script, /@[A-Za-z0-9._%+-]+\.[A-Za-z]{2,}/);
assert.match(sql, /SELECT[\s\S]*AUTH_USER\|/);
assert.match(sql, /to_regclass\('auth\.users'\)/);
assert.match(sql, /to_regclass\(format\('%I\.%I', target\.schema_name, target\.table_name\)\)/);
assert.match(sql, /\\gexec/);
assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE)\b/i);
assert.match(script, /merchant_team/);
assert.match(script, /customers/);
assert.match(script, /customer_profiles/);
assert.match(script, /workspaces/);
assert.match(script, /merchants/);
assert.doesNotMatch(script, /Invoke-RestMethod|\/auth\/v1\/|route\.ts|page\.tsx|webhook|src\/app/i);
assert.doesNotMatch(script, /approval|activate|collection unlock|provider|checkout|subscription|invoice|storefront/i);
for (const file of sourceFiles("src/app")) {
  assert.doesNotMatch(readFileSync(file, "utf8"), /check-production-super-admin-identity-cross-check|production-super-admin-identity-cross-check/);
}

console.log("production-super-admin-identity-cross-check-script.test.ts passed");
