import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const scriptPath = "scripts/diagnose-production-super-admin-auth.ps1";
const script = readFileSync(scriptPath, "utf8");
const trimmedScriptStart = script.replace(/^\uFEFF?/, "").trimStart();
const headerFactory = script.slice(
  script.indexOf("function New-AuthAdminReadHeaders"),
  script.indexOf("function Write-RedactedEvidence"),
);
const secretHeaderBranch = headerFactory
  .split('"starts_with_sb_secret"')[1]
  .split('"legacy_jwt_service_role_like"')[0];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx|ps1)$/.test(entry.name) ? [path] : [];
  });
}

assert.match(script, /READ ONLY PRODUCTION SUPER ADMIN AUTH DIAGNOSTIC/);
assert.match(script, /param\([\s\S]*\[string\]\$ServiceRoleKeyEnvVarName = ""[\s\S]*\)/);
assert.match(trimmedScriptStart, /^param\(/);
assert.match(script, /GetEnvironmentVariable\(\$EnvVarName\)/);
assert.match(script, /Read-Host\s+"Production service-role key or approved Auth-admin read credential"\s+-AsSecureString/);
assert.match(script, /CREDENTIAL_FINGERPRINT length=\{0\} sha256_12=\{1\} kind=\{2\}/);
assert.match(script, /credential_sha256_12/);
assert.match(script, /credential_kind/);
assert.match(script, /credential_length/);
assert.match(script, /starts_with_sb_secret/);
assert.match(script, /legacy_jwt_service_role_like/);
assert.match(script, /unsupported_credential_kind/);
assert.match(script, /apikey_only_secret/);
assert.match(script, /apikey_and_bearer_legacy_jwt/);
assert.match(script, /"User-Agent" = "DeraLedger-Server-Diagnostic\/1\.0"/);
assert.match(script, /apikey = \$Credential/);
assert.match(script, /\$headers\.Authorization = "Bearer \$Credential"/);
assert.match(script, /"starts_with_sb_secret" \{[\s\S]*?header_mode = "apikey_only_secret"[\s\S]*?headers = \$headers[\s\S]*?\}/);
assert.doesNotMatch(secretHeaderBranch, /Authorization = "Bearer \$Credential"/);
assert.match(script, /credential_kind = \$credentialFingerprint\.credential_kind/);
assert.match(script, /header_mode = \$headerMode/);
assert.match(script, /target_email_sha256/);
assert.match(script, /auth_user_id_redacted/);
assert.match(script, /\.local-evidence\/production-super-admin-auth-diagnostic-\$timestamp/);
assert.match(script, /Invoke-RestMethod\s+-Method Get/);
assert.match(script, /-Headers \$headers/);
assert.match(script, /Read-RequiredTrimmed\s+"Verified immutable production Auth user ID"/);
assert.match(script, /\/auth\/v1\/admin\/users\/\$targetAuthUserId/);
assert.doesNotMatch(script, /\/auth\/v1\/admin\/users\?email=/);
assert.match(script, /auth_user_email_mismatch/);
assert.match(script, /returned Auth user email does not match the target email/);
assert.match(script, /auth_user_id_mismatch/);
assert.match(script, /http_status_code/);
assert.match(script, /auth_error_code/);
assert.match(script, /auth_error_message/);
assert.match(script, /\.supabase\.co/);
assert.match(script, /MANUAL_REVIEW_REQUIRED/);
assert.match(script, /Read-only Auth diagnostic request failed\. Inspect redacted evidence only\./);
assert.doesNotMatch(script, /createUser|updateUser|deleteUser|inviteUserByEmail|generateLink|signIn|signUp/i);
assert.doesNotMatch(script, /-Method\s+(?:Post|Put|Patch|Delete)/i);
assert.doesNotMatch(script, /\/(?:payment|checkout|subscription|invoice|storefront)\b|(?:payment|checkout|subscription|invoice|storefront)_(?:records|sessions|intents)/i);
assert.doesNotMatch(script, /(?:route\.ts|page\.tsx|webhook|src\/app)/i);
assert.doesNotMatch(script, /@[A-Za-z0-9._%+-]+\.[A-Za-z]{2,}/);
assert.doesNotMatch(script, /Write-Output\s+\$credential\b/);
assert.doesNotMatch(script, /Write-Output.*Bearer \$credential/);
assert.doesNotMatch(script, /Write-RedactedEvidence\s+\$evidencePath\s+\$credential\b/);
for (const file of sourceFiles("src/app")) {
  assert.doesNotMatch(readFileSync(file, "utf8"), /diagnose-production-super-admin-auth|production-super-admin-auth-diagnostic/);
}
console.log("production-super-admin-auth-diagnostic-script.test.ts passed");
