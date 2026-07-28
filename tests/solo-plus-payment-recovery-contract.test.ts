import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

async function run() {
  const recoverRouteSource = readFileSync(
    "src/app/api/payment/upgrade/recover/route.ts",
    "utf8",
  );
  const checkoutSource = readFileSync(
    "src/app/checkout/upgrade/[plan]/page.tsx",
    "utf8",
  );
  const harnessSource = readFileSync(
    "scripts/test-breet-solo-plus-migrations.ps1",
    "utf8",
  );
  const migrationSource = readFileSync(
    "supabase/migrations/20260718_01_solo_plus_payment_recovery.sql",
    "utf8",
  );
  const paymentLifecycleMigrationSource = readFileSync(
    "supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql",
    "utf8",
  );
  const stagingWrapperPath = "supabase/staging/013_solo_plus_payment_recovery.sql";
  const preflightPath =
    "supabase/staging/preflight/013_solo_plus_payment_recovery_snapshot.sql";
  const postflightPath =
    "supabase/staging/postflight/013_solo_plus_payment_recovery_verify.sql";
  const sqlSelfTestPath =
    "supabase/tests/phase2_solo_plus_payment_recovery_rpc.sql";
  const postflightSource = readFileSync(postflightPath, "utf8");
  const preflightSource = readFileSync(preflightPath, "utf8");
  const stagingWrapperSource = readFileSync(stagingWrapperPath, "utf8");
  const sqlSelfTestSource = readFileSync(sqlSelfTestPath, "utf8");

  assert.equal(
    existsSync(stagingWrapperPath),
    true,
    "The versioned staging wrapper for Solo Plus payment recovery should exist.",
  );
  assert.equal(
    existsSync(preflightPath),
    true,
    "The versioned staging preflight snapshot for Solo Plus payment recovery should exist.",
  );
  assert.equal(
    existsSync(postflightPath),
    true,
    "The versioned staging postflight verification for Solo Plus payment recovery should exist.",
  );
  assert.equal(
    existsSync(sqlSelfTestPath),
    true,
    "The Solo Plus payment recovery RPC SQL self-test should exist.",
  );

  assert.match(
    recoverRouteSource,
    /normalizedPlan !== "solo_plus"/,
    "The recovery route must reject non-Solo-Plus plans.",
  );
  assert.match(
    recoverRouteSource,
    /recoverSoloPlusUpgradePayment\(/,
    "The recovery route should delegate to the Solo Plus recovery service.",
  );
  assert.match(
    recoverRouteSource,
    /requestId/,
    "The recovery route should include requestId in its response contract.",
  );

  assert.match(
    checkoutSource,
    /\/api\/payment\/upgrade\/recover/,
    "The shared upgrade checkout should call the explicit recovery endpoint only when recovery is required.",
  );
  assert.match(
    checkoutSource,
    /Check status and continue/,
    "The checkout page should expose a deliberate Solo Plus recovery action without promising a new attempt before provider verification.",
  );
  assert.match(
    checkoutSource,
    /SOLO_PLUS_PAYMENT_INITIALIZATION_RECOVERY_REQUIRED/,
    "The recovery action should be gated by the explicit Solo Plus recovery-required error code.",
  );
  assert.match(
    checkoutSource,
    /We need to check your previous payment/,
    "The recovery-required UI should explain that the previous payment must be checked first.",
  );
  assert.match(
    checkoutSource,
    /Open checkout again/,
    "A created replacement session should remain reopenable without another recovery request.",
  );
  assert.doesNotMatch(
    checkoutSource,
    /PaystackPop is not a constructor|unrecoverable provider checkout reference/,
    "The Solo Plus recovery UI should not render raw SDK or provider internals.",
  );

  assert.match(
    migrationSource,
    /CREATE OR REPLACE FUNCTION public\.recover_solo_plus_payment_attempt_v1/,
    "The Solo Plus recovery flow should define an atomic recovery RPC.",
  );
  assert.match(
    migrationSource,
    /SECURITY DEFINER/,
    "The recovery RPC should run as a trusted server-side operation.",
  );
  assert.match(
    migrationSource,
    /GRANT EXECUTE ON FUNCTION public\.recover_solo_plus_payment_attempt_v1/,
    "The recovery RPC should grant execute only through the intended trusted role.",
  );
  assert.match(
    migrationSource,
    /payment_status = 'abandoned'/,
    "The recovery RPC should move the old attempt out of the active pending state.",
  );
  assert.match(
    migrationSource,
    /payment_record_id = v_new\.id/,
    "The recovery RPC should repoint the Solo Plus case to the replacement payment attempt.",
  );
  assert.doesNotMatch(
    migrationSource,
    /\{payment_recovery,replacementPaymentRecordId\}/,
    "The replacement payment should not self-link replacementPaymentRecordId in recovery metadata.",
  );
  assert.match(
    paymentLifecycleMigrationSource,
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_records_solo_plus_pending_case\s+ON public\.payment_records\(solo_plus_case_id\)\s+WHERE solo_plus_case_id IS NOT NULL\s+AND payment_status = 'pending'/,
    "The pending Solo Plus payment-attempt uniqueness index should remain present and constrained to one pending row per case.",
  );

  const oldAttemptAbandonedIndex = migrationSource.indexOf(
    "payment_status = 'abandoned'",
  );
  const replacementInsertIndex = migrationSource.indexOf(
    "INSERT INTO public.payment_records",
  );
  assert.ok(
    oldAttemptAbandonedIndex >= 0 && replacementInsertIndex >= 0,
    "The recovery migration should update the old attempt and insert a replacement payment record.",
  );
  assert.ok(
    oldAttemptAbandonedIndex < replacementInsertIndex,
    "The recovery RPC should move the old attempt out of the pending-case unique-index predicate before inserting the replacement.",
  );

  assert.match(
    postflightSource,
    /bool_or\(\s*CASE[\s\S]*search_path=public, pg_temp[\s\S]*\)\s+FILTER\s*\(/,
    "The Commit 12 postflight search_path check should use PostgreSQL-compatible boolean aggregation.",
  );
  assert.doesNotMatch(
    postflightSource,
    /max\(\s*CASE\s*WHEN p\.proconfig IS NULL THEN false[\s\S]*search_path=public, pg_temp[\s\S]*\)\s+FILTER\s*\(/,
    "The Commit 12 postflight verifier must not use max(boolean), which PostgreSQL 15 rejects.",
  );
  assert.doesNotMatch(
    [migrationSource, stagingWrapperSource, preflightSource, postflightSource, sqlSelfTestSource].join(
      "\n",
    ),
    /\b(?:max|min|sum)\s*\(\s*(?:CASE[\s\S]{0,400}\b(?:true|false)\b|(?:true|false)\b)/i,
    "Commit 12 SQL should not aggregate boolean expressions with numeric/text aggregates.",
  );
  assert.doesNotMatch(
    sqlSelfTestSource,
    /\bpg_proc\s+p[\s\S]{0,200}\bp\.relnamespace\b/i,
    "pg_proc helpers must not join pg_namespace through relnamespace.",
  );
  assert.match(
    sqlSelfTestSource,
    /FROM pg_proc p\s+JOIN pg_namespace n ON n\.oid = p\.pronamespace\s+WHERE n\.nspname = 'public'\s+AND p\.proname = p_function_name/i,
    "The service-role-only function assertion should join pg_proc to pg_namespace with pronamespace.",
  );
  assert.doesNotMatch(
    [migrationSource, stagingWrapperSource, preflightSource, postflightSource, sqlSelfTestSource].join(
      "\n",
    ),
    /FROM pg_proc p[\s\S]{0,240}JOIN pg_namespace n ON n\.oid = p\.relnamespace/i,
    "Commit 12 SQL must not use relnamespace for pg_proc namespace joins.",
  );
  assert.doesNotMatch(
    preflightSource,
    /\bp\.solo_plus_case_id\b/,
    "The Commit 12 preflight must not statically reference optional historical payment_records.solo_plus_case_id.",
  );
  assert.doesNotMatch(
    postflightSource,
    /\bp\.solo_plus_case_id\b/,
    "The Commit 12 postflight must not statically reference optional historical payment_records.solo_plus_case_id.",
  );
  assert.match(
    preflightSource,
    /to_jsonb\(p\)\s*->>\s*'solo_plus_case_id'\s*=\s*'8b32fb1c-144d-4013-a80c-6a8e146754f9'/,
    "The Commit 12 preflight should check the live payment fixture linkage through a parse-safe row JSON key.",
  );
  assert.match(
    postflightSource,
    /to_jsonb\(p\)\s*->>\s*'solo_plus_case_id'\s*=\s*'8b32fb1c-144d-4013-a80c-6a8e146754f9'/,
    "The Commit 12 postflight should check the live payment fixture linkage through a parse-safe row JSON key.",
  );
  assert.match(
    preflightSource,
    /payment_fixture_schema_ready/,
    "The Commit 12 preflight should report whether the payment fixture linkage column exists.",
  );
  assert.match(
    postflightSource,
    /payment_fixture_schema_ready/,
    "The Commit 12 postflight should report whether the payment fixture linkage column exists.",
  );
  assert.match(
    preflightSource,
    /case_fixture_schema_ready/,
    "The Commit 12 preflight should report whether the case fixture linkage columns exist.",
  );
  assert.match(
    postflightSource,
    /case_fixture_schema_ready/,
    "The Commit 12 postflight should report whether the case fixture linkage columns exist.",
  );
  for (const source of [preflightSource, postflightSource]) {
    assert.match(
      source,
      /column_name = 'provider_reference'[\s\S]{0,160}udt_name IN \('text', 'varchar'\)/,
      "Commit 12 staging checks should accept text or varchar provider_reference columns.",
    );
    assert.match(
      source,
      /column_name = 'payment_status'[\s\S]{0,160}udt_name IN \('text', 'varchar'\)/,
      "Commit 12 staging checks should accept text or varchar payment_status columns.",
    );
    assert.match(
      source,
      /column_name = 'payment_method'[\s\S]{0,160}udt_name IN \('text', 'varchar'\)/,
      "Commit 12 staging checks should accept text or varchar payment_method columns.",
    );
    assert.match(
      source,
      /column_name = 'provider_name'[\s\S]{0,160}udt_name IN \('text', 'varchar'\)/,
      "Commit 12 staging checks should accept text or varchar provider_name columns.",
    );
    assert.match(
      source,
      /case_link_state/,
      "Commit 12 staging checks should report the case/payment link-state classification.",
    );
    assert.match(
      source,
      /THEN 'linked'[\s\S]*THEN 'legacy_unlinked'[\s\S]*ELSE 'conflicting'/,
      "Commit 12 staging checks should distinguish linked, legacy-unlinked, and conflicting fixture states.",
    );
    assert.match(
      source,
      /pending_case_payment_count = 1[\s\S]*case_link_state IN \('linked', 'legacy_unlinked'\)/,
      "Commit 12 staging checks should allow only one pending case payment and a safe linked or legacy-unlinked state.",
    );
  }
  assert.match(
    sqlSelfTestSource,
    /expected old payment to exit idx_payment_records_solo_plus_pending_case before replacement remains pending/,
    "The SQL regression should prove the old payment exits the pending-case unique-index predicate.",
  );
  assert.match(
    sqlSelfTestSource,
    /newer active pending attempt already exists/,
    "The SQL regression should prove competing pending attempts fail with an explicit recovery conflict.",
  );
  assert.match(
    sqlSelfTestSource,
    /v_conflict_merchant_id UUID := '00000000-0000-4000-8000-000000013102'::uuid;/,
    "The active-pending conflict SQL scenario should use its own merchant fixture.",
  );
  assert.match(
    sqlSelfTestSource,
    /v_success_merchant_id UUID := '00000000-0000-4000-8000-000000013103'::uuid;/,
    "The successful-payment guard SQL scenario should use its own merchant fixture.",
  );
  assert.match(
    sqlSelfTestSource,
    /'solo-plus-recovery-active-conflict-case'[\s\S]*RETURNING id INTO v_conflict_case_id;/,
    "The active-pending conflict case fixture should be isolated from the happy-path recovery case.",
  );
  assert.match(
    sqlSelfTestSource,
    /solo-plus-recovery-legacy-unlinked-case/,
    "The SQL regression should include a fixture for legacy cases whose reverse payment pointers are fully null.",
  );
  assert.match(
    sqlSelfTestSource,
    /expected recovery to accept a fully null legacy case reverse-pointer state/,
    "The SQL regression should prove the RPC accepts only the coherent legacy-unlinked state.",
  );
  assert.match(
    sqlSelfTestSource,
    /expected legacy-unlinked recovery to atomically point the case at the replacement payment/,
    "The SQL regression should prove legacy-unlinked recovery links the case to the replacement atomically.",
  );
  assert.match(
    harnessSource,
    /function Invoke-Commit12PrerequisiteChain[\s\S]*20260707_01_breet_payment_substrate_reconciliation\.sql[\s\S]*20260707_02_solo_plus_payment_lifecycle\.sql[\s\S]*20260710_01_solo_plus_review_decision_rpc\.sql[\s\S]*20260711_01_solo_plus_activation_rpc\.sql/,
    "The hostile harness should use the authoritative prerequisite migration chain before Commit 12 functional checks.",
  );
  assert.match(
    harnessSource,
    /Invoke-Commit12PrerequisiteChain -Scenario "Commit 12 payment recovery RPC regression"[\s\S]*20260718_01_solo_plus_payment_recovery\.sql[\s\S]*phase2_solo_plus_payment_recovery_rpc\.sql/,
    "The hostile harness should run the Commit 12 recovery RPC regression only after the complete prerequisite chain.",
  );

  console.log("solo-plus-payment-recovery-contract.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
