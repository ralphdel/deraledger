import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(path), "utf8").replace(/\r\n?/g, "\n");
const release = read("src/lib/server/solo-plus-review-action-release.ts");
const service = read("src/lib/solo-plus/server/review-service.ts");
const detail = read("src/components/solo-plus/admin-case-detail.tsx");
const form = read("src/components/solo-plus/admin-review-form.tsx");
const ui = read("src/lib/solo-plus/ui.ts");
const orchestration = read("src/lib/solo-plus/orchestration.ts");
const repository = read("src/lib/solo-plus/server/supabase-repository.ts");
const migration = read("supabase/migrations/20261014000000_phase2b_approve_atomicity_fail_closed.sql");
const runner = read("scripts/phase2b-reopen-staging.ps1");
const doc = read("docs/prd-phase-2b-reopen-staging-acceptance.md");
const prefix = "supabase/ops/phase2b_reopen_staging_";
const sql = {
  boundary: read(`${prefix}boundary.sql`),
  preflight: read(`${prefix}preflight.sql`),
  fixture: read(`${prefix}fixture.sql`),
  postflight: read(`${prefix}postflight.sql`),
};

assert.match(release, /SOLO_PLUS_REOPEN_ACCEPTANCE_FLAG[\s\S]*REOPEN_ACCEPTANCE_ENABLED/);
assert.match(release, /reopenGateValue !== "true"[\s\S]*decision !== REOPEN_ACCEPTANCE_DECISION[\s\S]*REJECT_RUN_ID_PATTERN/);
assert.match(release, /\[rejectGateValue, approveGateValue, reopenGateValue\]\.filter\(Boolean\)\.length > 1/);
assert.match(detail, /scopedDecision === "reopen"[\s\S]*caseStatus === "rejected"/);
assert.match(form, /decision === "reopen"[\s\S]*"Reopen"/);
assert.match(form, /decision === "reject" \|\| decision === "approve" \|\| decision === "reopen"/);
assert.match(ui, /Reopen Solo Plus review\?/);
assert.match(ui, /verification pending\. Payment and activation remain unchanged/);
assert.match(service, /input\.decision === "reopen"[\s\S]*caseStatus === "rejected"[\s\S]*rowVersion === input\.expectedRowVersion/);
assert.match(service, /phase2b_reopen_acceptance/);
assert.match(service, /synthetic_reopen_acceptance === true/);
assert.match(service, /caseStatus === "verification_pending"[\s\S]*rowVersion === input\.expectedRowVersion \+ 1/);
assert.match(orchestration, /expectedCurrentStatus: "rejected"[\s\S]*caseStatus: "verification_pending"[\s\S]*eventType: "case_reopened"/);
assert.match(repository, /input\.event\.eventType === "case_reopened"[\s\S]*\? "reopen"/);
assert.match(migration, /v_decision = 'reopen' AND v_case\.case_status <> 'rejected'/);
assert.match(migration, /WHEN v_decision = 'reopen' THEN 'none'/);
assert.match(migration, /WHEN v_decision = 'reopen' THEN NULL[\s\S]*reopened_at = CASE WHEN v_decision = 'reopen'/);

assert.match(runner, /\$projectRef = 'fsjljliiyfchkwbjifzw'/);
assert.match(runner, /\$hostName = 'aws-1-eu-central-2\.pooler\.supabase\.com'/);
assert.match(runner, /\$dbUser = 'postgres\.fsjljliiyfchkwbjifzw'/);
assert.match(runner, /'-X', '-W'/);
assert.match(runner, /PREPARE REOPEN FIXTURE \$RunId \$CaseId/);
assert.match(runner, /PGHOSTADDR[\s\S]*PGPASSWORD[\s\S]*PGPASSFILE[\s\S]*PGSERVICE/);
assert.doesNotMatch(runner, /\[string\]\s*\$(?:DbHost|DbUser|ProjectRef|ConnectionString|Password)/i);
assert.doesNotMatch(runner, /Read-Host\s+-AsSecureString|PGPASSWORD\s*=|\.pgpass|postgresql:\/\//i);
assert.doesNotMatch(runner + doc + Object.values(sql).join("\n"), /gznwibespgkwknnvbrlv|production\.supabase|deraledger\.com/i);

for (const [name, source] of Object.entries(sql)) {
  assert.ok(!source.startsWith("\uFEFF"), `${name} must be BOM-free`);
  if (name !== "fixture") {
    assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i,
      `${name} must remain read-only`);
  }
  for (const include of source.matchAll(/^\\ir\s+([^\s]+)$/gm)) {
    read(resolve(dirname(`${prefix}${name}.sql`), include[1]));
  }
  for (const block of source.matchAll(/DO (\$[a-z_]+\$)([\s\S]*?)\1;/g)) {
    assert.doesNotMatch(block[2], /:'[a-z_]+'/, `${name} must not interpolate psql variables inside DO`);
  }
}
assert.match(sql.preflight, /BEGIN READ ONLY/);
assert.match(sql.postflight, /BEGIN READ ONLY/);
assert.match(sql.preflight, /27710a7819d8413aa8764d8762a6a0ca/);
assert.match(sql.preflight, /case_status IS DISTINCT FROM 'rejected'/);
assert.match(sql.preflight, /case_reopened'\) IS DISTINCT FROM 0/);
assert.match(sql.preflight, /PASS\|REOPEN_PREFLIGHT\|/);
assert.match(sql.preflight, /THEN 'ready'/);
assert.match(sql.preflight, /candidate_requires_preparation/);
assert.match(sql.fixture, /fixture_scope', 'phase2b_reopen_acceptance'/);
assert.match(sql.fixture, /fixture_origin_scope', 'phase2b_admin_detail_smoke'/);
assert.match(sql.fixture, /synthetic_reopen_acceptance', true/);
assert.match(sql.fixture, /WHERE id = v_case\.id AND row_version = v_expected/);
assert.equal((sql.fixture.match(/UPDATE public\.solo_plus_cases/g) ?? []).length, 1);
assert.doesNotMatch(sql.fixture, /DELETE FROM|INSERT INTO|CREATE |ALTER |DROP |TRUNCATE /i);
assert.match(sql.postflight, /case_status IS DISTINCT FROM 'verification_pending'/);
assert.match(sql.postflight, /row_version IS DISTINCT FROM v_expected \+ 1/);
assert.match(sql.postflight, /case_reopened'\) IS DISTINCT FROM 1/);
assert.match(sql.postflight, /case_rejected'\) IS DISTINCT FROM 1/);
assert.match(sql.postflight, /verification_pending_without_side_effects/);
assert.match(sql.boundary, /'priorEvents'/);
assert.match(sql.boundary, /event_type IS DISTINCT FROM 'case_reopened'/);
for (const category of ["requirements", "payments", "subscriptions", "workspaceSubscriptions", "planMigrations", "settlementBatches"]) {
  assert.match(sql.boundary, new RegExp(`'${category}'`));
}

assert.match(doc, /rejected -> verification_pending/);
assert.match(doc, /click Reopen exactly once/i);
assert.match(doc, /separate deployment and Reopen execution approvals/i);
assert.match(doc, /fixture_missing/);
assert.match(doc, /phase2b-admin-detail-fixture-staging\.ps1/);
assert.match(doc, /candidate_requires_preparation/);
assert.match(doc, /Only the `ready` marker permits later release planning/);
assert.match(doc, /b5987ad9-f354-48a8-88d3-d0d347b67d83/);
assert.match(doc, /remove the four general review-action values and the[\s\S]*Reopen-specific flag/i);
assert.match(doc, /Cleanup is not authorized/);
assert.doesNotMatch(doc, /approve(?:d)?\s*->\s*(?:verification_pending|reopen)/i);
assert.doesNotMatch(doc, /(?:-File|\\ir|psql[^\n]*)[^\n]*(?:hostile|race)|race-session-[ab]\.sql/i);

console.log("PASS|REOPEN_STAGING|offline_package_contract");
