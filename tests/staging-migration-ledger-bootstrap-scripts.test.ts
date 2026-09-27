import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const bootstrap = readFileSync(resolve(root, 'scripts/bootstrap-staging-migration-ledger.ps1'), 'utf8');
const postflight = readFileSync(resolve(root, 'scripts/postflight-staging-migration-ledger.ps1'), 'utf8');
const packageDoc = readFileSync(resolve(root, 'docs/prd-phase-2b-staging-migration-ledger-bootstrap-package.md'), 'utf8');
const both = `${bootstrap}\n${postflight}`;

assert.match(bootstrap, /STAGING BOOTSTRAP MIGRATION LEDGER/);
assert.match(postflight, /STAGING POSTFLIGHT MIGRATION LEDGER/);
assert.match(both, /fsjljliiyfchkwbjifzw/);
assert.match(both, /aws-1-eu-central-2\.pooler\.supabase\.com/);
assert.match(both, /PGSSLMODE'.*require|PGSSLMODE','require/);
assert.match(bootstrap, /CREATE SCHEMA IF NOT EXISTS supabase_migrations/);
assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS supabase_migrations\.schema_migrations/);
assert.match(bootstrap, /version text PRIMARY KEY/);
assert.match(bootstrap, /statements text\[\]/);
assert.match(bootstrap, /name text/);
assert.match(bootstrap, /BLOCKED\|DRIFT\|protected_objects_without_history/);
assert.match(postflight, /PASS\|DECISION\|STAGING_LEDGER_BOOTSTRAP_READY_FOR_PREFLIGHT/);
assert.match(postflight, /BLOCKED\|LEDGER_SHAPE\|version_primary_key_missing/);
assert.match(postflight, /pg_constraint/);
assert.match(postflight, /con\.contype='p'/);
assert.match(postflight, /canonical_approval_snapshots/);
for (const protectedName of [
  'merchant_compliance_profiles', 'merchant_compliance_reviews', 'merchant_compliance_events',
  'merchant_collection_limit_windows', 'merchant_collection_limit_reservations',
  'merchant_collection_limit_reservation_windows', 'merchant_collection_usage_events',
  'approval_policy_versions', 'approval_decision_requests', 'canonical_approval_snapshots',
  'merchant_canonical_workspaces', 'bootstrap_reviewed_profile_v1',
  'review_compliance_profile_decision_v1', 'issue_canonical_approval_decision_request_v1',
  'read_canonical_approval_snapshot_v1', 'reconcile_canonical_merchant_workspace_link_v1',
  'issue_canonical_approval_decision_request_v2', 'read_canonical_approval_snapshot_v2',
]) {
  assert.match(bootstrap, new RegExp(protectedName));
  assert.match(postflight, new RegExp(protectedName));
}
assert.match(both, /gznwibespgkwknnvbrlv/);
assert.doesNotMatch(both, /postgres(?:ql)?:\/\//i);
assert.match(postflight, /20260820_00_prd_phase_2_compliance_schema_substrate/);
assert.match(postflight, /20260827_00_m028_m029_readiness_integration/);
assert.doesNotMatch(postflight, /version IN \('20260820_00','20260824_00'/);
assert.doesNotMatch(both, /ArgumentList/);
assert.doesNotMatch(both, /\$Host\b/);
assert.doesNotMatch(bootstrap, /\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i);
assert.doesNotMatch(both, /supabase\/migrations|db push|migration repair/i);
assert.match(packageDoc, /SOURCE-ONLY/);
console.log('PASS|STAGING_LEDGER_BOOTSTRAP_SCRIPTS|static_contract');
