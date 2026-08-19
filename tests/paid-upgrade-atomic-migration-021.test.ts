import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const migrationPath = "supabase/migrations/20260818_03_paid_upgrade_atomic_confirmation.sql";
const preflightPath = "supabase/staging/preflight/021_paid_upgrade_atomic_confirmation_snapshot.sql";
const postflightPath = "supabase/staging/postflight/021_paid_upgrade_atomic_confirmation_verify.sql";

function stripSqlStringsAndComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\r\n]*/g, " ")
    .replace(/'(?:''|[^'])*'/g, "''");
}

function assertBalancedRpcStructure(source: string): void {
  const functionMarker = "CREATE OR REPLACE FUNCTION public.confirm_paid_upgrade_v1";
  const functionStart = source.indexOf(functionMarker);
  assert.notEqual(functionStart, -1, "RPC declaration should exist.");

  const bodyOpen = source.indexOf("AS $$", functionStart);
  assert.notEqual(bodyOpen, -1, "RPC dollar-quoted body should open.");
  const bodyStart = bodyOpen + "AS $$".length;
  const bodyClose = source.indexOf("$$;", bodyStart);
  assert.notEqual(bodyClose, -1, "RPC dollar-quoted body should close.");

  const dollarDelimiters = source.match(/\$\$/g) ?? [];
  assert.equal(dollarDelimiters.length, 4, "Migration should contain one DO block and one RPC dollar-quoted body.");

  const rpcBody = stripSqlStringsAndComments(source.slice(bodyStart, bodyClose));
  const words = rpcBody.match(/\b[A-Za-z_]+\b/g)?.map((word) => word.toUpperCase()) ?? [];
  const caseCount = words.filter((word) => word === "CASE").length;
  const endCount = words.filter((word) => word === "END").length;
  const ifCount = words.filter((word) => word === "IF").length;
  const endIfCount = (rpcBody.match(/\bEND\s+IF\b/gi) ?? []).length;
  const endLoopCount = (rpcBody.match(/\bEND\s+LOOP\b/gi) ?? []).length;

  assert.equal(ifCount, endIfCount * 2, "Every RPC IF should have exactly one END IF.");
  assert.equal(endCount - endIfCount - endLoopCount, caseCount + 1, "Every CASE should have END plus the RPC's final END.");
  assert.match(rpcBody.trim(), /END\s*;$/i, "RPC body should end with END; before its closing dollar quote.");
  assert.match(source.slice(bodyClose).trim(), /^\$\$;[\s\S]*COMMIT;$/i, "Migration should close the RPC and transaction completely.");
}

async function run() {
  for (const path of [migrationPath, preflightPath, postflightPath]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  const migration = readFileSync(migrationPath, "utf8");
  const preflight = readFileSync(preflightPath, "utf8");
  const postflight = readFileSync(postflightPath, "utf8");
  const confirmation = readFileSync("src/lib/services/fiat-payment-confirmation.service.ts", "utf8");
  const binding = readFileSync("src/lib/services/paid-upgrade-confirmation.service.ts", "utf8");

  assertBalancedRpcStructure(migration);
  assert.throws(
    () => assertBalancedRpcStructure(migration.replace(/\$\$;\s*\n\s*REVOKE ALL ON FUNCTION/, "REVOKE ALL ON FUNCTION")),
    /body should close/,
  );
  assert.throws(
    () => {
      const reportedBranch = "IF v_plan = 'solo_lite' THEN";
      const metadataStart = migration.indexOf("COALESCE(p_provider_metadata");
      const branchStart = migration.indexOf(reportedBranch, metadataStart);
      assert.notEqual(branchStart, -1, "Explicit Solo Lite metadata branch should exist.");
      const danglingThen = migration.slice(0, branchStart + reportedBranch.length);
      assertBalancedRpcStructure(danglingThen);
    },
    /body should close/,
  );
  assert.throws(
    () => {
      const rpcStart = migration.indexOf("CREATE OR REPLACE FUNCTION public.confirm_paid_upgrade_v1");
      const unbalancedRpc = migration.slice(0, rpcStart) + migration.slice(rpcStart).replace(/END IF;/, "");
      assertBalancedRpcStructure(unbalancedRpc);
    },
    /Every RPC IF|Every CASE/,
  );
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
  const migrationDdl = migration.slice(0, migration.indexOf("CREATE OR REPLACE FUNCTION"));
  const activationRpc = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION"));
  assert.match(migrationDdl, /ADD COLUMN IF NOT EXISTS business_type text/);
  assert.match(migrationDdl, /ADD COLUMN IF NOT EXISTS subscription_notifications_sent jsonb DEFAULT '\{\}'::jsonb/);
  assert.match(migrationDdl, /ALTER COLUMN subscription_notifications_sent SET DEFAULT '\{\}'::jsonb/);
  assert.doesNotMatch(migrationDdl, /^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/im);
  assert.doesNotMatch(activationRpc, /\bbusiness_type\b/);
  assert.match(activationRpc, /subscription_notifications_sent = '\{\}'::jsonb/);
  assert.match(activationRpc, /v_subscription_plan public\.subscriptions\.plan_type%TYPE/);
  assert.match(activationRpc, /v_subscription_plan := v_storage_plan/);
  assert.match(activationRpc, /v_merchant\.id, v_subscription_plan,/);
  assert.doesNotMatch(migration, /'public\.subscription_plan_type'::regtype/);
  assert.doesNotMatch(activationRpc, /::public\.subscription_plan_type/);
  assert.doesNotMatch(migrationDdl, /CREATE TYPE public\.subscription_plan_type/i);
  assert.match(migrationDdl, /type_row\.oid[\s\S]*type_row\.typtype[\s\S]*v_legacy_plan_type_oid/);
  assert.match(migrationDdl, /v_subscription_plan_column_type <> 'text'/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.confirm_paid_upgrade_v1/);
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path = public, pg_temp/);
  assert.match(migration, /FROM public\.payment_records[\s\S]*FOR UPDATE/);
  assert.match(migration, /payment_status <> 'pending'[\s\S]*processing_status <> 'pending_payment'/);
  assert.match(migration, /expected_amount IS NULL[\s\S]*expected_amount <= 0/);
  assert.match(migration, /v_expected_amount_ngn := CASE WHEN v_plan = 'solo_lite' THEN 5000\.00 ELSE 20000\.00 END/);
  assert.match(migration, /p_amount_kobo <> v_expected_amount_kobo/);
  assert.doesNotMatch(activationRpc, /OR\s+CASE\s+WHEN\s+v_plan/);
  assert.match(activationRpc, /IF v_plan = 'solo_lite' THEN[\s\S]*new_plan[\s\S]*NOT IN \('individual', 'solo_lite'\)[\s\S]*END IF;/);
  assert.match(activationRpc, /ELSIF v_plan = 'business' THEN[\s\S]*new_plan[\s\S]*NOT IN \('corporate', 'business'\)[\s\S]*END IF;/);
  assert.match(activationRpc, /ELSE[\s\S]*paid_upgrade_plan_invalid[\s\S]*END IF;/);
  assert.match(migration, /INSERT INTO public\.subscription_payments/);
  assert.match(migration, /UPDATE public\.merchants/);
  assert.match(migration, /UPDATE public\.workspaces/);
  assert.match(migration, /INSERT INTO public\.workspace_subscriptions/);
  assert.match(migration, /INSERT INTO public\.subscriptions/);
  assert.match(migration, /UPDATE public\.payment_records/);
  assert.match(migration, /subscription_payments[\s\S]*paystack_ref/);
  assert.match(migration, /idempotent_replay/);
  assert.match(migration, /processed_ledger_inconsistent/);
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC/);
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM anon/);
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE)\b/i);

  const upgradeConfirmation = confirmation.slice(
    confirmation.indexOf("async function confirmSubscriptionUpgrade"),
    confirmation.indexOf("async function confirmInitialSubscription"),
  );
  assert.match(upgradeConfirmation, /confirmPaidUpgradeAtomically/);
  assert.doesNotMatch(upgradeConfirmation, /\.from\("merchants"\)|\.from\("subscriptions"\)|\.from\("subscription_payments"\)/);
  assert.match(binding, /p_payment_record_id: intent\.paymentRecordId/);
  assert.doesNotMatch(binding, /p_merchant_id:|p_plan:|p_expected_amount:/);
  assert.match(confirmation, /linkedPaymentRecord\?\.payment_purpose === "plan_upgrade"/);

  const upgradeRoute = readFileSync("src/app/api/payment/upgrade/route.ts", "utf8");
  const initializationCall = upgradeRoute.slice(
    upgradeRoute.indexOf("PaymentService.initializeTransaction"),
    upgradeRoute.indexOf("}, fiatProvider)") + "}, fiatProvider)".length,
  );
  assert.doesNotMatch(initializationCall, /subaccountCode|incomeSplitConfig/);

  for (const source of [preflight, postflight]) {
    assert.match(source, /SET TRANSACTION READ ONLY/);
    assert.match(source, /ROLLBACK;/);
    assert.doesNotMatch(source, /^\s*\\(?:set|pset|ir|i)\b/im);
    assert.match(source, /check_name, object_type, expected, actual, status, details/);
  }
  assert.match(preflight, /unexpected overloads cannot be repaired safely/i);
  assert.match(preflight, /column\.merchants\.business_type[\s\S]*actual_type IS NULL THEN 'WARN'/);
  assert.match(preflight, /column\.merchants\.subscription_notifications_sent[\s\S]*actual_type IS NULL THEN 'WARN'/);
  assert.match(preflight, /without backfilling business meaning/i);
  assert.match(preflight, /type\.public\.subscription_plan_type[\s\S]*WHEN oid IS NULL THEN 'WARN'/);
  assert.match(preflight, /column\.subscriptions\.plan_type[\s\S]*formatted_type = 'text' THEN 'PASS'/);
  assert.doesNotMatch(preflight, /'public\.subscription_plan_type'::regtype/);
  assert.match(postflight, /column\.merchants\.business_type/);
  assert.match(postflight, /column\.merchants\.subscription_notifications_sent/);
  assert.match(postflight, /actual_default = '''\{\}''::jsonb'/);
  assert.match(postflight, /type\.public\.subscription_plan_type/);
  assert.match(postflight, /column\.subscriptions\.plan_type/);
  assert.doesNotMatch(postflight, /'public\.subscription_plan_type'::regtype/);
  assert.match(postflight, /service_role=true; public\/anon\/authenticated=false/);

  console.log("paid-upgrade-atomic-migration-021.test.ts passed");
}

void run();
