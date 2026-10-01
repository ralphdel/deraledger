import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const preflightPath = resolve(
  "supabase/ops/phase2b_review_action_hardening_staging_preflight.sql",
);
const postflightPath = resolve(
  "supabase/ops/phase2b_review_action_hardening_staging_postflight.sql",
);
const migrationPath = resolve(
  "supabase/migrations/20260930000000_phase2b_review_action_intent_hardening.sql",
);
const scriptPath = resolve(
  "scripts/phase2b-review-action-hardening-staging-migration.ps1",
);
const runbookPath = resolve(
  "docs/prd-phase-2b-review-action-hardening-staging-migration-runbook.md",
);

const preflight = readFileSync(preflightPath, "utf8");
const postflight = readFileSync(postflightPath, "utf8");
const migration = readFileSync(migrationPath);
const script = readFileSync(scriptPath, "utf8");
const runbook = readFileSync(runbookPath, "utf8");

const expectedHash =
  "bac24995ad801432c6ba53e06d820d7495b0d6bc0bd6e4d1be35e03908648ba9";
assert.equal(createHash("sha256").update(migration).digest("hex"), expectedHash);

const expectedEvents = [
  "case_review_requested_more_information",
  "case_approved",
  "case_rejected",
  "case_reopened",
].sort();

function executableEventLiterals(sql: string) {
  const withoutExpectedEvidence = sql.replace(/PASS\|[^'\r\n]*/g, "");
  return [...withoutExpectedEvidence.matchAll(/'(case_[a-z_]+)'/g)]
    .map((match) => match[1])
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort();
}

for (const inspector of [preflight, postflight]) {
  assert.match(inspector, /BEGIN TRANSACTION READ ONLY;/i);
  assert.match(inspector, /ROLLBACK;/i);
  assert.doesNotMatch(
    inspector,
    /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|COPY|CREATE|ALTER|DROP|GRANT|REVOKE)\b/i,
  );
  assert.match(inspector, /indisunique/i);
  assert.match(inspector, /indnkeyatts\s*=\s*1/i);
  assert.match(inspector, /indnatts\s*=\s*1/i);
  assert.match(inspector, /indexprs IS NULL/i);
  assert.match(inspector, /amname\s*=\s*'btree'/i);
  assert.match(inspector, /ARRAY\['request_idempotency_key'\]::TEXT\[\]/i);
  assert.match(inspector, /request_idempotency_key IS NOT NULL/i);
  assert.deepEqual(executableEventLiterals(inspector), expectedEvents);
}

assert.match(preflight, /version::TEXT\s*=\s*'20260930000000'/i);
assert.match(preflight, /HAVING count\(\*\) > 1/i);
assert.match(preflight, /compatible_existing_but_unrecorded/i);
assert.match(preflight, /READY_FOR_STAGING_REVIEW_HARDENING_APPLY/i);
assert.match(postflight, /acl\.grantee\s*=\s*0/i);
assert.match(postflight, /rolname\s*=\s*'anon'/i);
assert.match(postflight, /rolname\s*=\s*'authenticated'/i);
assert.match(postflight, /rolname\s*=\s*'service_role'/i);
assert.match(postflight, /search_path=public, pg_temp/i);
assert.match(postflight, /unchanged_by_manual_psql/i);
assert.match(postflight, /OBJECTS_AND_SECURITY_EXACT/i);

for (const requiredValue of [
  "fsjljliiyfchkwbjifzw",
  "aws-1-eu-central-2.pooler.supabase.com",
  "postgres.fsjljliiyfchkwbjifzw",
  "gznwibespgkwknnvbrlv",
  expectedHash,
  "STAGING APPLY PHASE2B REVIEW HARDENING",
  "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED",
  "PASS|DECISION|STAGING_REVIEW_HARDENING_MIGRATION_VERIFIED",
]) {
  assert.equal(script.includes(requiredValue) || runbook.includes(requiredValue), true);
}

assert.match(script, /function Assert-StagingTarget/);
assert.match(script, /PGCONNECT_TIMEOUT', '15'/);
assert.match(script, /lock_timeout=/);
assert.match(script, /statement_timeout=/);
assert.match(script, /ReadToEndAsync\(\)/);
assert.match(script, /UseShellExecute = \$false/);
assert.match(script, /timeout_process_tree_termination_unconfirmed/);
assert.match(script, /function Get-BoundedRedirectedOutput/);
assert.match(script, /function Invoke-TimeoutTermination/);
assert.match(script, /function Invoke-LastChanceProcessTreeTermination/);
assert.match(script, /if \(\$termination\.JobHandleClosed\) \{ \$jobHandle = \[IntPtr\]::Zero \}/);
assert.match(script, /Get-SafeDiagnosticCategory/);
assert.match(script, /Get-NativeFailureEvidence/);
assert.doesNotMatch(script, /Write-(?:Host|Output)\s+\$result\.(?:Stdout|Stderr)/i);
assert.doesNotMatch(script, /Start-Process\s+[^\r\n]*-ArgumentList/i);
assert.doesNotMatch(runbook, /^\s*supabase\s+(?:db push|migration repair)\b/im);
assert.doesNotMatch(runbook, /DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED\s*=\s*(?:true|'true'|"true")/i);

const capturedProcessBody = script.match(
  /function Invoke-CapturedNativeProcess \{([\s\S]*?)\n\}\n\nfunction Get-SafeDiagnosticCategory/,
)?.[1];
assert.ok(capturedProcessBody, "Invoke-CapturedNativeProcess body missing");
assert.doesNotMatch(
  capturedProcessBody,
  /GetAwaiter\(\)\.GetResult\(\)/,
  "native wrapper must not synchronously await redirected streams after an unconfirmed timeout",
);
assert.match(
  capturedProcessBody,
  /Get-BoundedRedirectedOutput[\s\S]*-TimeoutMilliseconds 2000/,
  "native wrapper must use the bounded final stream drain",
);
assert.match(
  capturedProcessBody,
  /finally \{[\s\S]*if \(\$jobHandle -ne \[IntPtr\]::Zero\)[\s\S]*CloseHandle\(\$jobHandle\)/,
  "finally must retain a last handle-cleanup attempt",
);

const invokePhaseBody = script.match(
  /function Invoke-StagingSqlPhase \{([\s\S]*?)\n\}\n\nfunction Invoke-OfflineProcessTest/,
)?.[1];
assert.ok(invokePhaseBody, "Invoke-StagingSqlPhase body missing");
assert.ok(
  (invokePhaseBody.match(/Assert-StagingTarget/g) ?? []).length >= 2,
  "target must be checked before credentials and immediately before process",
);
assert.ok(
  (invokePhaseBody.match(/Assert-MigrationHash/g) ?? []).length >= 2,
  "apply hash must be checked before credentials and immediately before process",
);
assert.ok(
  invokePhaseBody.lastIndexOf("Assert-MigrationHash") <
    invokePhaseBody.indexOf("Invoke-CapturedNativeProcess"),
  "fresh apply hash must precede native invocation",
);
assert.ok(
  invokePhaseBody.indexOf("Assert-StagingTarget") <
    invokePhaseBody.indexOf("Read-Host 'Staging database password"),
  "target guard must precede password prompt",
);

const exactTargetArgs = [
  "-ProjectRef",
  "fsjljliiyfchkwbjifzw",
  "-DbHost",
  "aws-1-eu-central-2.pooler.supabase.com",
  "-DbPort",
  "5432",
  "-DbName",
  "postgres",
  "-DbUser",
  "postgres.fsjljliiyfchkwbjifzw",
];
const offlineArgs = [
  "-OfflineValidationOnly",
  "-OfflineFlagConfirmation",
  "STAGING REVIEW ACTION FLAGS DISABLED",
];

type ScriptResult = {
  status: number | null;
  output: string;
  elapsedMs: number;
};

function runPowerShell(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  timeout = 20_000,
): ScriptResult {
  const started = Date.now();
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      ...args,
    ],
    { encoding: "utf8", env, timeout },
  );
  if (result.error) throw result.error;
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    elapsedMs: Date.now() - started,
  };
}

function expectBlocked(
  result: ScriptResult,
  evidence: RegExp,
  expectZeroBoundaries = true,
) {
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, evidence);
  if (expectZeroBoundaries) {
    assert.match(
      result.output,
      /BLOCKED\|OFFLINE_BOUNDARIES\|password=0\|psql_resolve=0\|process=0/,
    );
  }
  assert.doesNotMatch(result.output, /Staging database password/i);
}

const validOffline = runPowerShell([
  "-Operation",
  "Preflight",
  ...exactTargetArgs,
  ...offlineArgs,
]);
assert.equal(validOffline.status, 0, validOffline.output);
assert.match(
  validOffline.output,
  /PASS\|OFFLINE_BOUNDARIES\|password=0\|psql_resolve=0\|process=0/,
);

const productionArgs = [...exactTargetArgs];
productionArgs[1] = "gznwibespgkwknnvbrlv";
expectBlocked(
  runPowerShell(["-Operation", "Preflight", ...productionArgs, ...offlineArgs]),
  /BLOCKED\|TARGET\|production_ref_blocked/,
);

const wrongRefArgs = [...exactTargetArgs];
wrongRefArgs[1] = "aaaaaaaaaaaaaaaaaaaa";
expectBlocked(
  runPowerShell(["-Operation", "Preflight", ...wrongRefArgs, ...offlineArgs]),
  /BLOCKED\|TARGET\|staging_tuple_mismatch/,
);

const liveHostArgs = [...exactTargetArgs];
liveHostArgs[3] = "live.database.example";
expectBlocked(
  runPowerShell(["-Operation", "Preflight", ...liveHostArgs, ...offlineArgs]),
  /BLOCKED\|TARGET\|production_indicator_blocked/,
);

expectBlocked(
  runPowerShell(
    ["-Operation", "Preflight", ...exactTargetArgs, ...offlineArgs],
    {
      ...process.env,
      DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED: "true",
    },
  ),
  /BLOCKED\|FLAGS\|review_action_flag_present/,
);

const tempRoot = mkdtempSync(resolve(tmpdir(), "phase2b-staging-wrapper-"));
try {
  const preflightEvidencePath = resolve(tempRoot, "preflight.txt");
  writeFileSync(
    preflightEvidencePath,
    [
      "PASS|TARGET|staging_guarded",
      "PASS|PRODUCTION_REF|blocked",
      "PASS|FLAGS|operator_confirmed_disabled",
      "PASS|SOURCE_HASH|20260930000000|matched",
      "PASS|BUSINESS_ROW_COUNTS|cases=1|requirements=6|events=0|payments=0",
      "PASS|DECISION|READY_FOR_STAGING_REVIEW_HARDENING_APPLY",
    ].join("\n"),
    "utf8",
  );

  const validApplyOffline = runPowerShell([
    "-Operation",
    "Apply",
    ...exactTargetArgs,
    ...offlineArgs,
    "-OfflineApplyConfirmation",
    "STAGING APPLY PHASE2B REVIEW HARDENING",
    "-ApprovedPreflightEvidencePath",
    preflightEvidencePath,
  ]);
  assert.equal(validApplyOffline.status, 0, validApplyOffline.output);
  assert.match(validApplyOffline.output, /PASS\|SOURCE_HASH\|20260930000000\|matched/);
  assert.match(
    validApplyOffline.output,
    /PASS\|OFFLINE_BOUNDARIES\|password=0\|psql_resolve=0\|process=0/,
  );

  expectBlocked(
    runPowerShell([
      "-Operation",
      "Apply",
      ...exactTargetArgs,
      ...offlineArgs,
      "-OfflineApplyConfirmation",
      "WRONG CONFIRMATION",
      "-ApprovedPreflightEvidencePath",
      preflightEvidencePath,
    ]),
    /BLOCKED\|APPLY\|typed_confirmation_required/,
  );

  const mutatedMigrationPath = resolve(tempRoot, "mutated.sql");
  writeFileSync(mutatedMigrationPath, Buffer.concat([migration, Buffer.from("\n-- mutation\n")]));
  expectBlocked(
    runPowerShell([
      "-Operation",
      "Apply",
      ...exactTargetArgs,
      ...offlineArgs,
      "-OfflineApplyConfirmation",
      "STAGING APPLY PHASE2B REVIEW HARDENING",
      "-ApprovedPreflightEvidencePath",
      preflightEvidencePath,
      "-OfflineMigrationPath",
      mutatedMigrationPath,
    ]),
    /BLOCKED\|SOURCE_HASH\|migration_hash_mismatch/,
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

const timeoutSelfTest = runPowerShell(
  ["-Operation", "OfflineProcessTest", "-OfflineProcessScenario", "Timeout"],
  process.env,
  15_000,
);
assert.equal(timeoutSelfTest.status, 0, timeoutSelfTest.output);
assert.ok(timeoutSelfTest.elapsedMs < 12_000, "timeout path did not terminate promptly");
assert.match(timeoutSelfTest.output, /BLOCKED\|SELFTEST\|native_process_timeout/);
assert.match(
  timeoutSelfTest.output,
  /BLOCKED\|SELFTEST_DIAGNOSTIC\|timeout_process_tree_terminated/,
);
assert.match(
  timeoutSelfTest.output,
  /PASS\|OFFLINE_PROCESS_TEST\|timeout_process_tree_terminated/,
);

const fallbackSelfTest = runPowerShell([
  "-Operation",
  "OfflineProcessTest",
  "-OfflineProcessScenario",
  "PrimaryFailureFallbackSuccess",
]);
assert.equal(fallbackSelfTest.status, 0, fallbackSelfTest.output);
assert.match(fallbackSelfTest.output, /BLOCKED\|SELFTEST\|native_process_timeout/);
assert.match(
  fallbackSelfTest.output,
  /BLOCKED\|SELFTEST_DIAGNOSTIC\|timeout_process_tree_terminated/,
);
assert.match(
  fallbackSelfTest.output,
  /PASS\|OFFLINE_PROCESS_TEST\|primary_failed_fallback_succeeded\|handle_cleanup_preserved/,
);

const unconfirmedStarted = Date.now();
const unconfirmedSelfTest = runPowerShell([
  "-Operation",
  "OfflineProcessTest",
  "-OfflineProcessScenario",
  "UnconfirmedTermination",
]);
assert.equal(unconfirmedSelfTest.status, 0, unconfirmedSelfTest.output);
assert.ok(
  Date.now() - unconfirmedStarted < 5_000,
  "unconfirmed termination path did not return promptly",
);
assert.match(unconfirmedSelfTest.output, /BLOCKED\|SELFTEST\|native_process_timeout/);
assert.match(
  unconfirmedSelfTest.output,
  /BLOCKED\|SELFTEST_DIAGNOSTIC\|timeout_process_tree_termination_unconfirmed/,
);
assert.match(
  unconfirmedSelfTest.output,
  /PASS\|OFFLINE_PROCESS_TEST\|termination_unconfirmed_returned_promptly\|handle_cleanup_preserved/,
);
assert.doesNotMatch(unconfirmedSelfTest.output, /raw-output-must-not-appear/);
assert.doesNotMatch(unconfirmedSelfTest.output, /postgresql-secret-must-not-appear/);

const authSelfTest = runPowerShell([
  "-Operation",
  "OfflineProcessTest",
  "-OfflineProcessScenario",
  "AuthenticationFailure",
]);
assert.equal(authSelfTest.status, 0, authSelfTest.output);
assert.match(authSelfTest.output, /BLOCKED\|SELFTEST\|psql_exit_nonzero/);
assert.match(
  authSelfTest.output,
  /BLOCKED\|SELFTEST_DIAGNOSTIC\|authentication_failed/,
);
assert.doesNotMatch(authSelfTest.output, /postgres(?:ql)?:\/\//i);
assert.doesNotMatch(authSelfTest.output, /abcdefghijklmnopqrstuvwxyz0123456789/i);

const genericSelfTest = runPowerShell([
  "-Operation",
  "OfflineProcessTest",
  "-OfflineProcessScenario",
  "GenericFailure",
]);
assert.equal(genericSelfTest.status, 0, genericSelfTest.output);
assert.match(genericSelfTest.output, /BLOCKED\|SELFTEST_DIAGNOSTIC\|psql_error/);
assert.match(genericSelfTest.output, /PASS\|OFFLINE_PROCESS_TEST\|generic_failure_bounded/);

console.log("phase2b-review-action-hardening-staging-runbook.test.ts passed");
