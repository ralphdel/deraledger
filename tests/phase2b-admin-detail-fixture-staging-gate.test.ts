import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const scriptPath = resolve("scripts/phase2b-admin-detail-fixture-staging.ps1");
const source = readFileSync(scriptPath, "utf8");

const approvedTarget = {
  projectRef: "fsjljliiyfchkwbjifzw",
  host: "aws-1-eu-central-2.pooler.supabase.com",
  port: "5432",
  database: "postgres",
  user: "postgres.fsjljliiyfchkwbjifzw",
};

type FixtureInvocation = Partial<typeof approvedTarget> & {
  operation?: "Preflight" | "Create" | "Postflight" | "Cleanup" | "PostCleanup";
  runMutation?: boolean;
  confirmation?: string;
};

function invokeOffline(overrides: FixtureInvocation = {}) {
  const target = { ...approvedTarget, ...overrides };
  const args = [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", scriptPath,
    "-Operation", overrides.operation ?? "Preflight",
    "-OfflineValidationOnly",
    "-ProjectRef", target.projectRef,
    "-DbHost", target.host,
    "-DbPort", target.port,
    "-DbName", target.database,
    "-DbUser", target.user,
    "-FixtureCaseId", "11111111-2222-4333-8444-555555555555",
    "-FixtureEmail", "phase2b.fixture@example.invalid",
    "-FixtureBusinessName", "Phase 2B Fixture Offline Test",
    "-FixtureRunId", "offline-test",
  ];

  if (overrides.runMutation) args.push("-RunMutation");
  if (overrides.confirmation !== undefined) {
    args.push("-OfflineConfirmation", overrides.confirmation);
  }

  const result = spawnSync("powershell.exe", args, {
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim(),
  };
}

function assertRejectedBeforeDatabaseAccess(
  invocation: FixtureInvocation,
  reason: string,
) {
  const result = invokeOffline(invocation);
  assert.notEqual(result.status, 0, `expected rejection for ${reason}`);
  assert.match(result.output, new RegExp(`BLOCKED\\|FIXTURE\\|${reason}`));
  assert.doesNotMatch(result.output, /PASS\|PSQL|Staging password/i);
}

function run() {
  const safeRead = invokeOffline();
  assert.equal(safeRead.status, 0, safeRead.output);
  assert.match(
    safeRead.output,
    /PASS\|OFFLINE_VALIDATION\|target_and_mutation_gates_passed_before_psql/,
  );
  assert.doesNotMatch(safeRead.output, /PASS\|PSQL|Staging password/i);

  assertRejectedBeforeDatabaseAccess(
    { projectRef: "gznwibespgkwknnvbrlv" },
    "production_indicator",
  );
  assertRejectedBeforeDatabaseAccess(
    { projectRef: "wrong-staging-ref" },
    "staging_target_unproven",
  );
  assertRejectedBeforeDatabaseAccess(
    { host: "wrong.pooler.supabase.com" },
    "staging_target_unproven",
  );
  assertRejectedBeforeDatabaseAccess({ port: "6543" }, "staging_target_unproven");
  assertRejectedBeforeDatabaseAccess(
    { database: "wrong_database" },
    "staging_target_unproven",
  );
  assertRejectedBeforeDatabaseAccess(
    { user: "postgres.wrongprojectref" },
    "staging_target_unproven",
  );
  assertRejectedBeforeDatabaseAccess(
    { operation: "Create" },
    "RunMutation_required",
  );
  assertRejectedBeforeDatabaseAccess(
    { operation: "Create", runMutation: true, confirmation: "WRONG CONFIRMATION" },
    "confirmation_required",
  );

  const confirmedCreate = invokeOffline({
    operation: "Create",
    runMutation: true,
    confirmation: "STAGING CREATE PHASE2B ADMIN DETAIL FIXTURE",
  });
  assert.equal(confirmedCreate.status, 0, confirmedCreate.output);
  assert.match(confirmedCreate.output, /PASS\|OFFLINE_VALIDATION\|/);
  assert.doesNotMatch(confirmedCreate.output, /PASS\|PSQL|Staging password/i);

  assert.match(source, /PGSSLMODE', 'require'/);
  assert.match(source, /Read-Host 'Staging password \(local prompt; never echoed\)' -AsSecureString/);
  assert.match(source, /ZeroFreeBSTR/);
  assert.match(source, /Remove-Item -LiteralPath \$tempSqlPath/);
  assert.match(
    source,
    /FROM public\.solo_plus_cases c[\s\S]+?JOIN merchant m ON m\.id = c\.merchant_id[\s\S]+?WHERE c\.case_status IN/,
    "active-case detection must range over every active case for the fixture merchant",
  );
  assert.match(source, /ARRAY\['activity_profile','bvn','id_document','proof_of_address','selfie_liveness','settlement_account'\]/);

  for (const pristineField of [
    "verification_log_id", "evidence_source_type", "evidence_source_id",
    "evidence_reference", "original_completed_at", "reuse_decision_at",
    "reuse_reason", "policy_rule_applied", "reviewed_by_admin_id", "review_note",
    "provider_name", "provider_reference", "failure_reason", "completed_at",
  ]) {
    assert.match(source, new RegExp(`${pristineField} IS NOT NULL`));
  }
  assert.match(source, /metadata IS DISTINCT FROM '\{\}'::jsonb/);

  const cleanupStart = source.indexOf("'Cleanup' {");
  const cleanupEnd = source.indexOf("'PostCleanup' {", cleanupStart);
  const cleanup = source.slice(cleanupStart, cleanupEnd);
  const lockPosition = cleanup.indexOf("FOR UPDATE;");
  const paymentRecheckPosition = cleanup.indexOf(
    "public.payment_records WHERE solo_plus_case_id = v_case_id",
  );
  const deletePosition = cleanup.indexOf("DELETE FROM public.solo_plus_cases");
  const returningPosition = cleanup.indexOf("RETURNING id INTO v_deleted_case_id");
  const rowCountPosition = cleanup.indexOf(
    "GET DIAGNOSTICS v_deleted_case_count = ROW_COUNT",
  );
  assert.ok(lockPosition >= 0, "cleanup must lock the exact fixture case");
  assert.ok(paymentRecheckPosition > lockPosition, "payment link recheck must follow lock");
  assert.ok(deletePosition > paymentRecheckPosition);
  assert.ok(returningPosition > deletePosition);
  assert.ok(rowCountPosition > returningPosition);
  assert.match(cleanup, /v_deleted_case_count <> 1/);
  assert.match(cleanup, /v_deleted_case_id IS DISTINCT FROM v_case_id/);
  assert.match(cleanup, /audit_metadata ->> 'fixture_scope' = 'phase2b_admin_detail_smoke'/);
  assert.match(cleanup, /audit_metadata ->> 'fixture_run_id' = v_fixture_run_id/);

  assert.doesNotMatch(source, /\$Host\s*=/i);
  assert.doesNotMatch(source, /\[string\]\s*\$Host\b/i);
  assert.doesNotMatch(source, /ArgumentList/);
  assert.doesNotMatch(source, /postgres(?:ql)?:\/\//i);

  console.log("phase2b-admin-detail-fixture-staging-gate.test.ts passed");
}

run();
