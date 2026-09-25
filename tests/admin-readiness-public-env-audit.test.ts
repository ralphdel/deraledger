import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  auditReadinessPublicEnvironment,
  runReadinessPublicEnvironmentAudit,
} from "../scripts/audit-readiness-public-env";

const serviceRoleJwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature";
const allowedEnvironment = {
  NEXT_PUBLIC_APP_URL: "https://admin.deraledger.com",
  NEXT_PUBLIC_APP_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://public-project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-value-sentinel",
  NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: "pk_live_public-value-sentinel",
};

function capturedRun(args: readonly string[], environment: Record<string, string | undefined>) {
  const output: string[] = [];
  const warnings: string[] = [];
  const exitCode = runReadinessPublicEnvironmentAudit(args, environment, {
    output: (line) => output.push(line),
    warning: (line) => warnings.push(line),
  });
  return { exitCode, output, warnings };
}

const allowedLines = auditReadinessPublicEnvironment(allowedEnvironment);
assert.equal(allowedLines.length, 5);
assert.ok(allowedLines.every((line) => line.startsWith("PASS|") && line.endsWith("|allowed_public_name")));
for (const rawValue of Object.values(allowedEnvironment)) {
  assert.equal(allowedLines.join("\n").includes(rawValue), false);
}

for (const [name, value] of [
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", serviceRoleJwt],
  ["NEXT_PUBLIC_APP_URL", "sb_secret_url-sentinel"],
  ["NEXT_PUBLIC_APP_ENV", "sb_secret_environment-sentinel"],
] as const) {
  const lines = auditReadinessPublicEnvironment({ [name]: value });
  assert.deepEqual(lines, [`BLOCKED|${name}|sensitive_value_pattern`]);
  assert.equal(lines[0].includes(value), false);
}

for (const name of [
  "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SECRET_KEY",
  "NEXT_PUBLIC_PRIVATE_KEY",
  "NEXT_PUBLIC_ACCESS_TOKEN",
]) {
  assert.deepEqual(auditReadinessPublicEnvironment({ [name]: "dangerous-name-value-sentinel" }), [
    `BLOCKED|${name}|forbidden_public_name`,
  ]);
}

assert.equal(capturedRun([], allowedEnvironment).exitCode, 0);
assert.equal(capturedRun([], { NEXT_PUBLIC_APP_ENV: serviceRoleJwt }).exitCode, 1);

const auditDirectory = mkdtempSync(join(tmpdir(), "readiness-public-env-audit-"));
const auditFile = join(auditDirectory, ".env.production-public-audit.local");
writeFileSync(auditFile, [
  "NEXT_PUBLIC_APP_URL=https://admin.deraledger.com",
  "NEXT_PUBLIC_APP_ENV=production",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_secret_file-sentinel",
].join("\n"));
const fileRun = capturedRun([auditFile], {});
assert.equal(fileRun.exitCode, 1);
assert.deepEqual(fileRun.output, [
  "PASS|NEXT_PUBLIC_APP_ENV|allowed_public_name",
  "PASS|NEXT_PUBLIC_APP_URL|allowed_public_name",
  "BLOCKED|NEXT_PUBLIC_SUPABASE_ANON_KEY|sensitive_value_pattern",
]);
assert.equal(fileRun.output.join("\n").includes("sb_secret_file-sentinel"), false);

const missingRun = capturedRun([join(auditDirectory, "missing.local")], allowedEnvironment);
assert.equal(missingRun.exitCode, 0);
assert.deepEqual(missingRun.warnings, ["WARN|LOCAL_ENV_FILE|file_missing"]);
assert.equal(missingRun.warnings.join("\n").includes(auditDirectory), false);

console.log("admin-readiness-public-env-audit.test.ts passed");
