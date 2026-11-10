import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();

const bootstrap = read("supabase/tests/phase2c_b4p_pre_m031_bootstrap.sql");
const verifier = read("supabase/tests/phase2c_b4p_pre_m031_verify.sql");
const runner = read("scripts/rehearse-phase2c-b4p-local.ps1");
const foundation001 = read("supabase/staging/001_schema_only.sql");
const foundation002 = read("supabase/staging/002_onboarding_verification_upgrade_flow.sql");
const authorization = read("supabase/migrations/20260728000000_authorization_hardening.sql");
const subscriptions = read("supabase/migrations/20260818025000_paid_subscription_tables_prerequisite.sql");
const m024 = read("supabase/migrations/20260820_00_prd_phase_2_compliance_schema_substrate.sql");
const m029 = read("supabase/migrations/20260826_00_canonical_workspace_linkage.sql");
const b1 = read("supabase/migrations/20261021000000_phase2c_nonadopted_review_substrate.sql");
const b2 = read("supabase/migrations/20261022000000_phase2c_nonadopted_review_triage_resubmission.sql");
const m031 = read("supabase/migrations/20261023000000_phase2c_draft_compliance_profile_provisioning.sql");
const behavior = read("supabase/tests/phase2c_draft_compliance_profile_provisioning.sql");
const concurrencySetup = read("supabase/tests/phase2c_b4p_concurrency_setup.sql");
const concurrencyWorker = read("supabase/tests/phase2c_b4p_concurrency_worker.sql");
const concurrencyVerify = read("supabase/tests/phase2c_b4p_concurrency_verify.sql");

const authorizationPath = "supabase/migrations/20260728000000_authorization_hardening.sql";
const authorizationHash = "3EFB2B353A5EDCCC1854D5D6A03343296000B6C1D44307B200562C18DF298C7D";
assert.equal(hash(authorizationPath), authorizationHash);
assert.ok(runner.includes(`'${authorizationPath}' = '${authorizationHash}'`));
assert.match(authorization, /ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false/);
assert.match(authorization, /public\.verification_disclosures is required/);
assert.match(authorization, /public\.merchant_team is required/);
assert.match(foundation001, /CREATE TABLE IF NOT EXISTS merchant_team/);
assert.match(foundation002, /CREATE TABLE IF NOT EXISTS verification_disclosures/);

const includeOrder = [
  "\\ir ../staging/001_schema_only.sql",
  "\\ir ../staging/002_onboarding_verification_upgrade_flow.sql",
  "\\ir ../staging/004_phase1_plan_compatibility.sql",
  "\\ir ../staging/006_solo_plus_prerequisites.sql",
  "\\ir ../staging/007_solo_plus_case_foundation.sql",
  "\\ir ../migrations/20260728000000_authorization_hardening.sql",
  "\\ir ../migrations/20260818025000_paid_subscription_tables_prerequisite.sql",
  "\\ir ../migrations/20260820_00_prd_phase_2_compliance_schema_substrate.sql",
  "\\ir ../migrations/20260824_00_reviewed_profile_bootstrap_rpc.sql",
  "\\ir ../migrations/20260825000000_reviewed_profile_approval_rpc.sql",
  "\\ir ../migrations/20260825010000_cleanup_approval_rpc_diagnostics.sql",
  "\\ir ../migrations/20260825020000_canonical_approval_snapshot_idempotency.sql",
  "\\ir ../migrations/20260826_00_canonical_workspace_linkage.sql",
  "\\ir ../migrations/20260827_00_m028_m029_readiness_integration.sql",
  "\\ir ../migrations/20261021000000_phase2c_nonadopted_review_substrate.sql",
  "\\ir ../migrations/20261022000000_phase2c_nonadopted_review_triage_resubmission.sql",
] as const;
let previous = -1;
for (const include of includeOrder) {
  const current = bootstrap.indexOf(include);
  assert.ok(current > previous, `missing or misordered dependency: ${include}`);
  previous = current;
}
assert.doesNotMatch(bootstrap, /20261023000000_phase2c_draft_compliance_profile_provisioning/);
assert.doesNotMatch(bootstrap, /\\ir .*2026102[4-9]|\\ir .*202611|\\ir .*2027/);

type B2Column = readonly [relation: string, column: string, type: string, producer: string];
const b2Columns: readonly B2Column[] = [
  ["public.merchants", "is_super_admin", "boolean", authorization],
  ["public.merchants", "user_id", "uuid", foundation001],
  ["public.merchants", "subscription_plan", "text", foundation001],
  ["public.merchant_canonical_workspaces", "merchant_id", "uuid", m029],
  ["public.merchant_canonical_workspaces", "workspace_id", "uuid", m029],
  ["public.merchant_compliance_profiles", "id", "uuid", m024],
  ["public.merchant_compliance_profiles", "merchant_id", "uuid", m024],
  ["public.merchant_compliance_profiles", "plan_code", "text", m024],
  ["public.merchant_compliance_profiles", "row_version", "bigint", m024],
  ["public.merchant_compliance_reviews", "id", "uuid", m024],
  ["public.merchant_compliance_reviews", "merchant_id", "uuid", m024],
  ["public.merchant_compliance_reviews", "profile_id", "uuid", m024],
  ["public.merchant_compliance_reviews", "review_status", "text", m024],
  ["public.merchant_compliance_reviews", "evidence_snapshot", "jsonb", m024],
  ["public.merchant_compliance_reviews", "decision_reason_code", "text", m024],
  ["public.merchant_compliance_reviews", "reviewed_by", "uuid", m024],
  ["public.merchant_compliance_reviews", "reviewed_at", "timestamp with time zone", m024],
  ["public.merchant_compliance_reviews", "row_version", "bigint", m024],
  ["public.merchant_compliance_events", "resulting_row_version", "bigint", m024],
] as const;

for (const [relation, column, type, producer] of b2Columns) {
  const tuple = `('${relation}'::regclass, '${column}', '${type}'::regtype)`;
  assert.ok(b2.includes(tuple), `B2 prerequisite tuple missing: ${relation}.${column}`);
  assert.match(producer, new RegExp(`\\b${column}\\b`, "i"), `canonical producer missing: ${relation}.${column}`);
}
assert.equal(b2Columns.length, 19);
assert.ok(verifier.includes("('public.merchants','is_super_admin','boolean',true,'false')"));

for (const guard of [
  "Phase 2C B2 prerequisite missing",
  "Phase 2C B2 column prerequisite incompatible",
  "Phase 2C B2 B1 security prerequisite incompatible",
  "Phase 2C B2 trigger or table security prerequisite incompatible",
  "Phase 2C B2 merchant idempotency prerequisite incompatible",
  "Phase 2C B2 function owner prerequisite incompatible",
  "Phase 2C B2 RPC already exists",
]) {
  assert.ok(b2.includes(guard), `B2 guard missing: ${guard}`);
}
for (const b1Object of [
  "submit_draft_plan_review_v1",
  "freeze_submitted_plan_review_v1",
  "trg_freeze_submitted_plan_review_v1",
  "uq_merchant_compliance_reviews_idempotency",
  "uq_merchant_compliance_events_idempotency",
]) {
  assert.ok(b1.includes(b1Object), `B1 producer missing: ${b1Object}`);
  assert.ok(b2.includes(b1Object), `B2 consumer missing: ${b1Object}`);
}

for (const [consumer, required] of [
  [m031, ["public.merchants", "public.subscriptions", "public.workspaces", "public.merchant_canonical_workspaces", "public.merchant_compliance_profiles", "public.merchant_compliance_reviews", "public.merchant_compliance_events"]],
  [behavior, ["auth.users", "public.merchants", "public.subscriptions", "public.workspaces", "public.workspace_subscriptions", "public.merchant_canonical_workspaces", "public.merchant_compliance_profiles", "public.merchant_compliance_reviews", "public.merchant_compliance_events"]],
  [concurrencySetup + concurrencyWorker + concurrencyVerify, ["auth.users", "public.merchants", "public.subscriptions", "public.workspaces", "public.merchant_canonical_workspaces", "public.merchant_compliance_profiles", "public.merchant_compliance_reviews", "public.merchant_compliance_events"]],
] as const) {
  for (const object of required) {
    assert.ok(consumer.includes(object), `consumer prerequisite inventory drift: ${object}`);
  }
}
assert.match(subscriptions, /CREATE TABLE IF NOT EXISTS public\.subscriptions/);
assert.match(subscriptions, /CONSTRAINT subscriptions_merchant_id_key UNIQUE \(merchant_id\)/);
assert.match(m029, /FOREIGN KEY \(workspace_id, merchant_id\)[\s\S]+REFERENCES public\.workspaces\(id, merchant_id\)/);
assert.match(m031, /ensure_draft_compliance_profile_v1\([\s\S]+p_merchant_id uuid/);
assert.match(m031, /ON CONFLICT \(merchant_id\) DO NOTHING/);
assert.match(m031, /GRANT EXECUTE ON FUNCTION public\.ensure_draft_compliance_profile_v1\(uuid\)[\s\S]+TO service_role/);

console.log("phase2c-b4p-migration-dependency-closure.test.ts passed");
