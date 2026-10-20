import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const migrationPath = "supabase/migrations/20261020000000_phase2c_atomic_fiat_plan_renewal.sql";
const migration = readFileSync(migrationPath, "utf8");
const renewalService = readFileSync("src/lib/services/fiat-payment-confirmation.service.ts", "utf8");
const renewInitialize = readFileSync("src/app/api/payment/renew-initialize/route.ts", "utf8");
const legacyRenewInitialize = readFileSync("src/app/api/payment/renew/route.ts", "utf8");
const verifyRenew = readFileSync("src/app/api/payment/verify-renew/route.ts", "utf8");
const paystackWebhook = readFileSync("src/app/api/webhooks/paystack/route.ts", "utf8");
const monnifyWebhook = readFileSync("src/app/api/webhooks/monnify/route.ts", "utf8");
const breetWebhook = readFileSync("src/app/api/webhooks/breet/route.ts", "utf8");
const cryptoCheckout = readFileSync("src/app/api/checkout/crypto-subscription/route.ts", "utf8");
const selfTest = readFileSync("tests/sql/phase2c-atomic-fiat-plan-renewal/self-test.sql", "utf8");
const concurrencyFixture = readFileSync("tests/sql/phase2c-atomic-fiat-plan-renewal/concurrency-fixture.sql", "utf8");
const concurrencyA = readFileSync("tests/sql/phase2c-atomic-fiat-plan-renewal/concurrency-session-a.sql", "utf8");
const concurrencyB = readFileSync("tests/sql/phase2c-atomic-fiat-plan-renewal/concurrency-session-b.sql", "utf8");

const rpcName = "confirm_fiat_plan_renewal_v1";
const signature = "uuid,text,text,text,bigint,text,uuid,text,jsonb";
const rpcStart = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${rpcName}`);
assert.notEqual(rpcStart, -1);
const rpcEnd = migration.indexOf("$renewal$;", rpcStart);
assert.notEqual(rpcEnd, -1);
const rpc = migration.slice(rpcStart, rpcEnd);
const bodyStart = migration.indexOf("AS $renewal$", rpcStart) + "AS $renewal$".length;
const rpcBody = migration.slice(bodyStart, rpcEnd).replace(/\r/g, "");
const rpcBodyHash = createHash("md5").update(rpcBody, "utf8").digest("hex");

for (const [tag, expectedCount] of [
  ["$helper$", 6],
  ["$guard$", 2],
  ["$check$", 2],
  ["$renewal$", 2],
  ["$postflight$", 2],
] as const) {
  assert.equal(migration.split(tag).length - 1, expectedCount);
}
assert.match(rpcBody.trim(), /^DECLARE[\s\S]*END;$/);

assert.match(migration, /\nBEGIN;[\s\S]*COMMIT;\s*$/);
assert.match(migration, /SET LOCAL lock_timeout = '5s'/);
assert.match(migration, new RegExp(`to_regprocedure\\(\\s*'public\\.${rpcName}\\(${signature}\\)'`));
assert.match(migration, /unexpected confirm_fiat_plan_renewal_v1 overload/);
assert.match(migration, /owner_name IS DISTINCT FROM current_user/);
assert.match(migration, /body_hash <> '[0-9a-f]{32}'/g);
assert.doesNotMatch(migration, /__RPC_BODY_HASH__/);
assert.equal((migration.match(new RegExp(rpcBodyHash, "g")) ?? []).length, 2);

for (const table of ["payment_records", "merchants", "subscriptions", "subscription_payments"]) {
  assert.match(migration, new RegExp(`public\\.${table}`));
}
assert.match(migration, /relrowsecurity[\s\S]*NOT c\.relforcerowsecurity/);
assert.match(migration, /service_role table privileges drifted/);
assert.match(migration, /payment_records_payment_status_check[\s\S]*payment status CHECK expression drifted/);
assert.match(migration, /browser-role table write grant drifted/);
assert.match(migration, /payment_records'[\s\S]*internal_reference'[\s\S]*'u'/);
assert.match(migration, /subscriptions'[\s\S]*merchant_id'[\s\S]*'u'/);
assert.match(migration, /subscription_payments'[\s\S]*paystack_ref'[\s\S]*'u'/);
assert.match(migration, /NOT c\.condeferrable[\s\S]*i\.indisunique[\s\S]*i\.indisvalid[\s\S]*i\.indpred IS NULL/);
assert.match(migration, /c\.confupdtype = 'a'[\s\S]*c\.confmatchtype = 's'/);
assert.match(migration, /phase2c_assert_fk\('public\.payment_records'[\s\S]*'public\.merchants'[\s\S]*'n'\)/);

assert.match(rpc, /SECURITY DEFINER[\s\S]*SET search_path = pg_catalog, public, pg_temp/);
assert.match(rpc, /FROM public\.payment_records[\s\S]*FOR UPDATE/);
assert.match(rpc, /FROM public\.merchants[\s\S]*FOR UPDATE/);
assert.match(rpc, /FROM public\.subscriptions s[\s\S]*ORDER BY s\.id[\s\S]*FOR UPDATE/);
assert.match(rpc, /FROM public\.subscription_payments[\s\S]*FOR UPDATE/);
assert.ok(
  rpc.indexOf("FROM public.payment_records") < rpc.indexOf("FROM public.merchants") &&
  rpc.indexOf("FROM public.merchants") < rpc.indexOf("FROM public.subscriptions s") &&
  rpc.indexOf("FROM public.subscriptions s") < rpc.indexOf("FROM public.subscription_payments"),
  "Renewal lock order must be payment -> merchant -> subscription -> ledger.",
);

assert.match(rpc, /payment_purpose IS DISTINCT FROM 'plan_renewal'/);
assert.match(rpc, /v_payment\.solo_plus_case_id IS NOT NULL[\s\S]*solo_plus_renewal_deferred/);
assert.match(rpc, /p_canonical_plan NOT IN \('solo_lite', 'business'\)/);
assert.match(rpc, /WHEN 'individual' THEN 'solo_lite'/);
assert.match(rpc, /WHEN 'corporate' THEN 'business'/);
assert.doesNotMatch(rpc, /WHEN 'solo_plus' THEN/);
assert.doesNotMatch(rpc, /WHEN 'starter' THEN/);
assert.match(rpc, /v_payment_plan_id IS DISTINCT FROM v_payment_plan_name/);
assert.match(rpc, /v_merchant_plan IS DISTINCT FROM p_canonical_plan/);
assert.doesNotMatch(rpc, /merchant_tier/);
assert.doesNotMatch(rpc, /metadata\s*->|provider_metadata/);

assert.match(rpc, /v_subscription_count <> 1/);
assert.doesNotMatch(rpc, /ORDER BY (?:created_at|updated_at)[\s\S]*LIMIT 1/i);
assert.match(rpc, /v_payment\.expected_amount IS DISTINCT FROM v_expected_amount_ngn/);
assert.match(rpc, /p_amount_kobo IS DISTINCT FROM v_expected_amount_kobo/);
assert.match(rpc, /upper\(pg_catalog\.btrim\(v_payment\.currency\)\) <> 'NGN'/);
assert.match(rpc, /provider_name[\s\S]*p_provider/);
assert.match(rpc, /internal_reference IS DISTINCT FROM pg_catalog\.btrim\(p_internal_reference\)/);

assert.match(rpc, /IF FOUND THEN[\s\S]*'kind', 'already_processed'/);
assert.match(rpc, /processed_state_inconsistent/);
assert.match(rpc, /payment_record_not_pending/);
assert.ok(rpc.indexOf("SELECT * INTO v_ledger") < rpc.indexOf("UPDATE public.subscriptions"));
assert.ok(rpc.indexOf("UPDATE public.subscriptions") < rpc.indexOf("INSERT INTO public.subscription_payments"));
assert.ok(rpc.indexOf("INSERT INTO public.subscription_payments") < rpc.indexOf("UPDATE public.payment_records"));
assert.match(rpc, /v_period_start \+ \(\(v_expected_amount_ngn \/ v_daily_rate\) \* interval '1 day'\)/);
assert.match(rpc, /payment_type, status[\s\S]*'renewal', 'paid'/);
assert.match(rpc, /payment_status = 'successful'[\s\S]*processing_status = 'processed'[\s\S]*account_setup_status = 'active'/);

for (const denied of ["PUBLIC", "anon", "authenticated"]) {
  assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${rpcName}\\(${signature}\\) FROM ${denied}`));
}
assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpcName}\\(${signature}\\) TO service_role`));
assert.doesNotMatch(migration, /GRANT\s+(?:INSERT|UPDATE|DELETE|ALL).*ON TABLE/i);
assert.doesNotMatch(migration.slice(0, rpcStart), /^\s*(?:ALTER TABLE|CREATE TABLE|CREATE TYPE|CREATE INDEX|UPDATE|INSERT INTO|DELETE FROM|TRUNCATE|DROP TABLE)\b/im);
assert.doesNotMatch(migration, /^\s*(?:TRUNCATE|DROP TABLE)\b/im);

for (const liveSource of [
  renewalService,
  renewInitialize,
  legacyRenewInitialize,
  verifyRenew,
  paystackWebhook,
  monnifyWebhook,
  breetWebhook,
  cryptoCheckout,
]) {
  assert.doesNotMatch(liveSource, new RegExp(rpcName));
}
assert.match(renewInitialize, /paymentPurpose: "plan_subscription"/);
assert.match(renewalService, /async function confirmSubscriptionRenewal/);

assert.match(selfTest, /Lite renewal did not apply/);
assert.match(selfTest, /Business renewal did not apply/);
assert.match(selfTest, /already_processed/);
assert.match(selfTest, /Replay extended Lite twice/);
assert.match(selfTest, /Plan mismatch did not fail closed/);
assert.match(selfTest, /Amount mismatch did not fail closed/);
assert.match(selfTest, /Currency mismatch did not fail closed/);
assert.match(selfTest, /Provider mismatch did not fail closed/);
assert.match(selfTest, /Reference mismatch did not fail closed/);
assert.match(selfTest, /Solo Plus did not fail closed/);
assert.match(selfTest, /Starter did not fail closed/);
assert.match(selfTest, /Unsupported plan did not fail closed/);
assert.match(selfTest, /Forced failure left an expiry mutation/);
assert.match(selfTest, /subscription_ambiguous_or_missing/);
assert.match(selfTest, /ROLLBACK;[\s\S]*self_test_rolled_back/);
assert.doesNotMatch(selfTest, /COMMIT;/);

assert.match(concurrencyFixture, /concurrency_fixture_ready/);
assert.match(concurrencyA, /pg_advisory_xact_lock\(20261020,\s*1\)/);
assert.match(concurrencyA, /concurrency_session_a_holding/);
assert.match(concurrencyA, /pg_sleep\(8\)/);
assert.match(concurrencyA, /concurrency_session_a_applied/);
assert.match(concurrencyA, /concurrency_session_a_committed/);
assert.match(concurrencyA, /v_result IS NULL OR v_result->>'kind' IS DISTINCT FROM 'applied'/);
assert.match(concurrencyA, /RAISE EXCEPTION 'FAIL\|PHASE2C_RENEWAL\|concurrency_session_a\|%'/);
assert.match(concurrencyB, /pg_try_advisory_xact_lock\(20261020,\s*1\)/);
assert.match(concurrencyB, /concurrency_overlap_missing/);
assert.match(concurrencyB, /clock_timestamp\(\)/);
assert.match(concurrencyB, /v_wait_ms\s*<\s*3000/);
assert.match(concurrencyB, /concurrency_wait_insufficient/);
assert.match(concurrencyB, /v_result->>'kind' IS DISTINCT FROM 'already_processed'/);
assert.match(concurrencyB, /concurrency_session_b_replay/);
assert.match(concurrencyB, /count\(\*\)[\s\S]*<> 1/);
assert.match(concurrencyB, /expiry_date > now\(\) \+ interval '30 days'[\s\S]*expiry_date < now\(\) \+ interval '32 days'/);
assert.match(concurrencyB, /payment_status = 'successful'[\s\S]*processing_status = 'processed'[\s\S]*account_setup_status = 'active'/);
assert.match(concurrencyB, /amount_paid = 5000[\s\S]*provider_reference = 'race-provider-ref'[\s\S]*paid_at IS NOT NULL/);
assert.match(concurrencyB, /concurrency_exactly_once/);

const aRpc = concurrencyA.indexOf(`public.${rpcName}(`);
const aAppliedAssertion = concurrencyA.indexOf("v_result IS NULL OR v_result->>'kind' IS DISTINCT FROM 'applied'");
const aApplyFailure = concurrencyA.indexOf("RAISE EXCEPTION 'FAIL|PHASE2C_RENEWAL|concurrency_session_a|%'");
const aRendezvous = concurrencyA.indexOf("pg_advisory_xact_lock(20261020, 1)");
const aHoldMarker = concurrencyA.indexOf("concurrency_session_a_holding");
const aHoldSleep = concurrencyA.indexOf("pg_sleep(8)");
const aCommit = concurrencyA.indexOf("COMMIT;");
assert.ok(
  aRpc < aAppliedAssertion &&
    aAppliedAssertion < aApplyFailure &&
    aApplyFailure < aRendezvous &&
    aRendezvous < aHoldMarker &&
    aHoldMarker < aHoldSleep &&
    aHoldSleep < aCommit,
  "Session A must fail-stop a non-applied result before establishing and exposing the rendezvous.",
);

const bRendezvous = concurrencyB.indexOf("pg_try_advisory_xact_lock(20261020, 1)");
const bStartedAt = concurrencyB.indexOf("v_started_at := pg_catalog.clock_timestamp()");
const bRpc = concurrencyB.indexOf(`public.${rpcName}(`);
const bWaitAssertion = concurrencyB.indexOf("v_wait_ms < 3000");
assert.ok(bRendezvous < bStartedAt && bStartedAt < bRpc && bRpc < bWaitAssertion,
  "Session B must observe A's hold before timing the same renewal RPC and asserting a real wait.");

for (const source of [migration, selfTest, concurrencyFixture, concurrencyA, concurrencyB]) {
  assert.doesNotMatch(source, /https?:\/\/|supabase\.co|gznwibespgkwknnvbrlv|fsjljliiyfchkwbjifzw/i);
  assert.doesNotMatch(source, /PGPASSWORD|\.pgpass|password=/i);
}

console.log("phase2c-atomic-fiat-plan-renewal-migration.test.ts passed");
