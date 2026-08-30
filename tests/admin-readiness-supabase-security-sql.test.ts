import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const migrationPath = "supabase/migrations/20260831_00_admin_readiness_durable_security_storage.sql";

assert.ok(existsSync(migrationPath), "the approved admin readiness security migration must exist");
assert.notEqual(readFileSync(migrationPath)[0], 0xef, "migration must be UTF-8 without a BOM");

const sql = readFileSync(migrationPath, "utf8");
const approvedTables = [
  "admin_readiness_csrf_tokens",
  "admin_readiness_csrf_binding_index",
  "admin_readiness_throttle_windows",
] as const;
const approvedFunctions = [
  "create_admin_readiness_csrf_token_v1",
  "read_admin_readiness_csrf_token_v1",
  "rotate_admin_readiness_csrf_token_v1",
  "invalidate_admin_readiness_csrf_binding_v1",
  "decide_admin_readiness_throttle_v1",
  "cleanup_admin_readiness_security_storage_v1",
] as const;

assert.match(sql, /^BEGIN;[\s\S]*COMMIT;\s*$/);
assert.match(sql, /Admin readiness security migration prerequisite failed/);

for (const table of approvedTables) {
  assert.match(sql, new RegExp(`CREATE TABLE public\\.${table} \\(`));
  assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} NO FORCE ROW LEVEL SECURITY`));
}

assert.equal((sql.match(/CREATE TABLE public\./g) ?? []).length, approvedTables.length);
assert.doesNotMatch(sql, /CREATE POLICY|CREATE OR REPLACE POLICY/i);
assert.doesNotMatch(sql, /CREATE TABLE public\.(?!admin_readiness_csrf_tokens|admin_readiness_csrf_binding_index|admin_readiness_throttle_windows)/);

assert.match(sql, /token_digest text PRIMARY KEY/);
assert.match(sql, /session_binding_digest text NOT NULL/);
assert.match(sql, /subject_hash text NOT NULL/);
assert.match(sql, /\^\[0-9a-f\]\{64\}\$/);
assert.match(sql, /operation IN \('readiness_issue', 'readiness_snapshot'\)/);
assert.match(sql, /method = 'POST'/);
for (const namespace of [
  "admin_readiness_local_v1",
  "admin_readiness_staging_v1",
  "admin_readiness_preview_v1",
  "admin_readiness_production_v1",
]) assert.match(sql, new RegExp(`'${namespace}'`));
assert.match(sql, /request_count BETWEEN 1 AND 1000/);
assert.match(sql, /p_limit NOT BETWEEN 1 AND 100/);
assert.match(sql, /interval '30 minutes'/);
assert.match(sql, /v_active_count >= 4/);
assert.match(sql, /p_max_delete_count NOT BETWEEN 1 AND 1000/);
assert.match(sql, /interval '24 hours'/);

for (const rawField of ["raw_token", "jwt", "cookie", "header", "user_metadata", "app_metadata", "email", "user_id"]) {
  assert.doesNotMatch(sql, new RegExp(`\\b${rawField}\\s+(?:text|jsonb|uuid)\\b`, "i"), `${rawField} must not be a security-table column`);
}

assert.match(sql, /REVOKE ALL ON TABLE public\.admin_readiness_csrf_tokens,[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.admin_readiness_csrf_tokens,[\s\S]*TO service_role/);

for (const fn of approvedFunctions) {
  assert.equal((sql.match(new RegExp(`CREATE FUNCTION public\\.${fn}\\(`, "g")) ?? []).length, 1, `${fn} must have one exact definition`);
  assert.match(sql, new RegExp(`CREATE FUNCTION public\\.${fn}\\([\\s\\S]*?SECURITY INVOKER[\\s\\S]*?SET search_path TO pg_catalog, public`));
  assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([\\s\\S]*?FROM PUBLIC, anon, authenticated, service_role`));
  assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([\\s\\S]*?TO service_role`));
}
assert.doesNotMatch(sql, /SECURITY DEFINER/);
assert.equal((sql.match(/CREATE FUNCTION public\./g) ?? []).length, approvedFunctions.length);

assert.match(sql, /ON CONFLICT \(token_digest\) DO NOTHING/);
assert.match(sql, /RETURN QUERY SELECT 'conflict'::text/);
assert.match(sql, /FOR UPDATE/);
assert.match(sql, /SET replaced_by_token_digest = p_new_token_digest/);
assert.match(sql, /pg_advisory_xact_lock/);
assert.match(sql, /LIMIT p_max_delete_count/);
assert.match(sql, /ON CONFLICT \(security_namespace, operation, subject_hash, window_started_at\)[\s\S]*DO UPDATE SET[\s\S]*request_count = LEAST\(w\.request_count \+ 1, 1000\)/);
assert.match(sql, /RETURN QUERY SELECT 'rate_limited'::text/);
assert.match(sql, /v_remaining := p_max_delete_count/);
assert.match(sql, /window_expires_at <= v_now - interval '24 hours'/);

for (const safeCode of [
  "created", "conflict", "invalid", "csrf_unavailable", "found", "missing", "expired",
  "binding_mismatch", "operation_mismatch", "method_mismatch", "rotated", "invalidated",
  "allow", "rate_limited", "throttle_unavailable", "cleaned", "nothing_to_clean", "security_storage_unavailable",
]) assert.match(sql, new RegExp(`'${safeCode}'::text`));
assert.doesNotMatch(sql, /SQLERRM|GET STACKED DIAGNOSTICS|RAISE NOTICE|RAISE WARNING/);

for (const forbiddenTable of [
  "merchants", "merchant_compliance_profiles", "approval_decision_requests", "workspaces", "subscriptions",
  "invoices", "payment_events", "merchant_collection_limit_windows", "merchant_collection_limit_reservations",
]) assert.doesNotMatch(sql, new RegExp(`(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE|ALTER TABLE) public\\.${forbiddenTable}\\b`, "i"));
assert.doesNotMatch(sql, /DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED|issue_canonical_approval|review_compliance_profile_decision|activate|collection unlock/i);
assert.doesNotMatch(sql, /checkout|paystack|subscription|invoice|storefront/i);
assert.match(sql, /Rollback is intentionally user-controlled and separately reviewed/);

console.log("admin-readiness-supabase-security-sql.test.ts passed");
