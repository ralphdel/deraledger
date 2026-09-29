import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  alteredTables,
  auditRepository,
  createdTables,
  findDuplicateVersions,
  migrationVersion,
  tableOperations,
  type PackagingManifest,
} from "../scripts/validate-supabase-baseline-packaging";
import {
  buildDisputeEvidenceObjectPath,
  DISPUTE_EVIDENCE_BUCKET,
  DISPUTE_EVIDENCE_MAX_BYTES,
  mergeDisputeEvidenceField,
  parseDisputeEvidenceField,
  validateDisputeEvidenceFile,
} from "../src/lib/disputes/evidence-storage";

assert.equal(migrationVersion("20260825_02_example.sql"), "20260825");
assert.equal(migrationVersion("invalid.sql"), null);
assert.deepEqual(
  [...findDuplicateVersions(["20260825_00_a.sql", "20260825_01_b.sql"])],
  [["20260825", ["20260825_00_a.sql", "20260825_01_b.sql"]]],
);
assert.deepEqual(createdTables("CREATE TABLE IF NOT EXISTS public.widgets (id uuid);"), ["widgets"]);
assert.deepEqual(alteredTables("ALTER TABLE public.widgets ADD COLUMN x text;"), ["widgets"]);
assert.deepEqual(tableOperations("CREATE TABLE widgets(id uuid); ALTER TABLE widgets ADD COLUMN x text;"), [
  { kind: "create", table: "widgets" },
  { kind: "alter", table: "widgets" },
]);

const root = mkdtempSync(join(tmpdir(), "deraledger-baseline-validator-"));
mkdirSync(join(root, "supabase", "migrations"), { recursive: true });
mkdirSync(join(root, "supabase", ".temp"), { recursive: true });
writeFileSync(join(root, "supabase", "base.sql"), "ALTER TABLE missing_first ADD COLUMN x text;\nCREATE TABLE duplicated(id uuid);\n");
writeFileSync(join(root, "supabase", "unsafe.sql"), "CREATE TABLE duplicated(id uuid);\n");
writeFileSync(join(root, "supabase", "migrations", "20260825_00_a.sql"), "ALTER TABLE missing_first ADD COLUMN x text;\n");
writeFileSync(join(root, "supabase", "migrations", "20260825_01_b.sql"), "SELECT 1;\n");
writeFileSync(join(root, "supabase", ".temp", "project-ref"), "gznwibespgkwknnvbrlv\n");
writeFileSync(join(root, "backup.sql"), "-- backup\n");

const manifest: PackagingManifest = {
  schemaVersion: 1,
  stagingProjectRef: "fsjljliiyfchkwbjifzw",
  productionProjectRef: "gznwibespgkwknnvbrlv",
  officialMigrationDirectory: "supabase/migrations",
  allowedAlterBeforeCreate: {},
  rootSqlOrder: ["base.sql", "unsafe.sql"],
  packagePending: ["base.sql"],
  packagedSources: {},
  mustNotPackageAsWritten: ["unsafe.sql"],
  supersededOrReconciledByOfficialMigrations: [],
};
const audit = auditRepository(root, manifest, { backupPath: "backup.sql" });
assert(audit.blockers.some((line) => line.startsWith("DUPLICATE_MIGRATION_VERSION|20260825|")));
assert(audit.blockers.includes("MANUAL_BASELINE_DECISION_REQUIRED|base.sql"));
assert(audit.blockers.includes("ALTER_BEFORE_DETECTABLE_CREATE|20260825_00_a.sql|missing_first"));
assert(audit.blockers.includes("SUPABASE_CONFIG_MISSING"));
assert(audit.blockers.includes("PRODUCTION_REF_LINKED"));
assert(audit.warnings.some((line) => line.startsWith("DUPLICATE_CREATE_TABLE_RISK|duplicated|")));

writeFileSync(join(root, "supabase", ".temp", "project-ref"), "fsjljliiyfchkwbjifzw\n");
writeFileSync(join(root, "supabase", "config.toml"), 'project_id = "deraledger"\n');
writeFileSync(join(root, "supabase", "base.sql"), "CREATE TABLE base(id uuid);\n");
writeFileSync(join(root, "supabase", "unsafe.sql"), "SELECT 1;\n");
rmSync(join(root, "supabase", "migrations", "20260825_00_a.sql"));
writeFileSync(join(root, "supabase", "migrations", "20260826_a.sql"), "SELECT 1;\n");
writeFileSync(join(root, "supabase", "migrations", "20260825_01_b.sql"), "SELECT 1;\n");
const readyManifest = { ...manifest, packagePending: [], supersededOrReconciledByOfficialMigrations: ["base.sql"] };
const ready = auditRepository(root, readyManifest, { backupPath: "backup.sql" });
assert.equal(ready.blockers.length, 0);

const missingCanonical = auditRepository(root, {
  ...readyManifest,
  requiredCanonicalMigrations: { storage: "supabase/migrations/missing.sql" },
}, { backupPath: "backup.sql" });
assert(missingCanonical.blockers.includes(
  "CANONICAL_MIGRATION_MISSING|storage|supabase/migrations/missing.sql",
));

writeFileSync(join(root, "supabase", "migrations", "20260827_storage.sql"), "CREATE POLICY unsafe ON storage.objects FOR SELECT USING (true);\n");
const unsafeStorage = auditRepository(root, {
  ...readyManifest,
  requiredCanonicalMigrations: {
    privateEvidenceStorage: "supabase/migrations/20260827_storage.sql",
  },
}, { backupPath: "backup.sql" });
assert(unsafeStorage.blockers.includes("PRIVATE_EVIDENCE_BROWSER_POLICY_PRESENT"));
assert(unsafeStorage.blockers.some((line) => line.startsWith("PRIVATE_EVIDENCE_STORAGE_CONTRACT_MISSING|")));

const missingPartial = auditRepository(root, {
  ...readyManifest,
  partialExtractions: { "base.sql": ["supabase/migrations/does_not_exist.sql"] },
}, { backupPath: "backup.sql" });
assert(missingPartial.blockers.includes(
  "PARTIAL_BASELINE_MISSING|base.sql|supabase/migrations/does_not_exist.sql",
));
assert(missingPartial.blockers.includes(
  "PARTIAL_BASELINE_DESTINATION_NOT_OFFICIAL_MIGRATION|base.sql|supabase/migrations/does_not_exist.sql",
) === false);

const conflictingDecision = auditRepository(root, {
  ...readyManifest,
  packagePending: ["base.sql"],
  supersededOrReconciledByOfficialMigrations: ["base.sql"],
}, { backupPath: "backup.sql" });
assert(conflictingDecision.blockers.includes("CONFLICTING_BASELINE_DECISION|base.sql"));

const unclassifiedPartial = auditRepository(root, {
  ...readyManifest,
  supersededOrReconciledByOfficialMigrations: [],
  partialExtractions: { "base.sql": ["outside.sql"] },
}, { backupPath: "backup.sql" });
assert(unclassifiedPartial.blockers.includes("PARTIAL_BASELINE_DECISION_UNCLASSIFIED|base.sql"));
assert(unclassifiedPartial.blockers.includes(
  "PARTIAL_BASELINE_DESTINATION_NOT_OFFICIAL_MIGRATION|base.sql|outside.sql",
));

const repositoryRoot = process.cwd();
const repositoryMigrations = readdirSync(join(repositoryRoot, "supabase", "migrations"))
  .filter((file) => file.endsWith(".sql"));
assert.equal(findDuplicateVersions(repositoryMigrations).size, 0, "repository migration versions must be unique");
const config = readFileSync(join(repositoryRoot, "supabase", "config.toml"), "utf8");
assert.match(config, /\[db\.seed\][\s\S]*enabled\s*=\s*false/);
assert.doesNotMatch(config, /gznwibespgkwknnvbrlv|fsjljliiyfchkwbjifzw/);

const repositoryManifest = JSON.parse(
  readFileSync(join(repositoryRoot, "supabase", "baseline-packaging-manifest.json"), "utf8"),
) as PackagingManifest;
assert.deepEqual(repositoryManifest.packagePending, []);
assert.equal(
  repositoryManifest.requiredCanonicalMigrations?.privateEvidenceStorage,
  "supabase/migrations/20260729010000_private_evidence_storage_baseline.sql",
);
assert(repositoryManifest.supersededOrReconciledByOfficialMigrations.includes("20260514_phase2_migration.sql"));
assert(repositoryManifest.supersededOrReconciledByOfficialMigrations.includes("setup_trigger.sql"));
assert(repositoryManifest.supersededOrReconciledByOfficialMigrations.includes("kyc_compliance_migration.sql"));
assert(repositoryManifest.supersededOrReconciledByOfficialMigrations.includes("verification_subject_migration.sql"));
assert.deepEqual(repositoryManifest.partialExtractions?.["setup_trigger.sql"], [
  "supabase/migrations/20260425000000_merchant_registration_columns_baseline.sql",
]);
assert.deepEqual(repositoryManifest.partialExtractions?.["20260514_phase2_migration.sql"], [
  "supabase/migrations/20260514000000_platform_acknowledgement_column_baseline.sql",
  "supabase/migrations/20260729010000_private_evidence_storage_baseline.sql",
]);
assert.deepEqual(repositoryManifest.partialExtractions?.["20260528_platform_update_controls.sql"], [
  "supabase/migrations/20260528000000_platform_update_column_baseline.sql",
]);
assert.deepEqual(repositoryManifest.partialExtractions?.["kyc_compliance_migration.sql"], [
  "supabase/migrations/20260729000000_kyc_evidence_security_baseline.sql",
]);
assert.deepEqual(repositoryManifest.partialExtractions?.["verification_subject_migration.sql"], [
  "supabase/migrations/20260424000000_core_schema_baseline.sql",
  "supabase/migrations/20260729000000_kyc_evidence_security_baseline.sql",
]);

const safeExtractions = [
  ["20260425000000_merchant_registration_columns_baseline.sql", /ADD COLUMN IF NOT EXISTS is_test_mode BOOLEAN DEFAULT false/],
  ["20260514000000_platform_acknowledgement_column_baseline.sql", /ADD COLUMN IF NOT EXISTS last_acknowledged_version INTEGER DEFAULT 0 NOT NULL/],
  ["20260528000000_platform_update_column_baseline.sql", /ADD COLUMN IF NOT EXISTS last_update_logout_version INTEGER NOT NULL DEFAULT 0/],
] as const;
for (const [file, expectedDdl] of safeExtractions) {
  const sql = readFileSync(join(repositoryRoot, "supabase", "migrations", file), "utf8");
  assert.match(sql, expectedDdl);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION|CREATE\s+TRIGGER|CREATE\s+POLICY)\b/i);
}

const coreBaseline = readFileSync(
  join(repositoryRoot, "supabase", "migrations", "20260424000000_core_schema_baseline.sql"),
  "utf8",
);
for (const verificationType of [
  "bvn_selfie",
  "business",
  "director",
  "identity",
  "representative_bvn_selfie",
  "individual_bvn_selfie",
  "business_registry",
  "director_bvn_selfie",
]) {
  assert.match(coreBaseline, new RegExp(`'${verificationType}'`));
}

const kycEvidenceMigration = readFileSync(
  join(repositoryRoot, "supabase", "migrations", "20260729000000_kyc_evidence_security_baseline.sql"),
  "utf8",
);
const executableKycEvidenceMigration = kycEvidenceMigration.replace(/^\s*--.*$/gm, "");
for (const table of [
  "verification_providers",
  "verification_retry_queue",
  "verification_rate_limits",
  "provider_health_events",
  "business_director_verifications",
]) {
  assert.match(kycEvidenceMigration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`));
}
for (const protectedTable of [
  "verification_providers",
  "verification_logs",
  "verification_retry_queue",
  "verification_rate_limits",
  "provider_health_events",
  "business_director_verifications",
  "user_kyc_profiles",
  "business_registry_snapshots",
  "business_affiliations",
  "director_invitations",
  "director_verifications",
  "verification_costs",
]) {
  assert.match(kycEvidenceMigration, new RegExp(`ALTER TABLE public\\.${protectedTable} ENABLE ROW LEVEL SECURITY`));
  assert.match(kycEvidenceMigration, new RegExp(`ALTER TABLE public\\.${protectedTable} NO FORCE ROW LEVEL SECURITY`));
}
assert.match(kycEvidenceMigration, /REVOKE ALL ON TABLE[\s\S]*FROM PUBLIC, anon, authenticated, service_role;/);
assert.match(kycEvidenceMigration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.verification_logs TO service_role;/);
assert.match(kycEvidenceMigration, /GRANT SELECT \([\s\S]*returned_bvn_name[\s\S]*\) ON TABLE public\.verification_logs TO authenticated;/);
assert.match(kycEvidenceMigration, /GRANT SELECT \([\s\S]*director_name[\s\S]*\) ON TABLE public\.business_director_verifications TO authenticated;/);
assert.match(kycEvidenceMigration, /USING \(public\.can_read_merchant_row_v1\(merchant_id\)\)/);
assert.match(kycEvidenceMigration, /service_role grant mismatch/);
assert.match(kycEvidenceMigration, /id primary key mismatch/);
assert.match(kycEvidenceMigration, /public\.%.% expected type %/);
assert.match(kycEvidenceMigration, /authenticated verification_logs column grants mismatch/);
assert.match(kycEvidenceMigration, /verification_logs\.verification_type contract is not canonical/);
assert.match(kycEvidenceMigration, /verification_logs\.verification_subject contract is not canonical/);
assert.doesNotMatch(executableKycEvidenceMigration, /INSERT\s+INTO\s+public\.verification_providers/i);
assert.doesNotMatch(executableKycEvidenceMigration, /https?:\/\//i);
assert.doesNotMatch(executableKycEvidenceMigration, /\bapi_base_url\b/i);
assert.doesNotMatch(executableKycEvidenceMigration, /storage\.(?:buckets|objects)|kyc-documents/i);

const settingsPage = readFileSync(
  join(repositoryRoot, "src", "app", "(dashboard)", "settings", "page.tsx"),
  "utf8",
);
assert.match(settingsPage, /from\("business_director_verifications"\)[\s\S]{0,120}select\("id, director_name, director_role, verification_status"\)/);
assert.doesNotMatch(settingsPage, /from\("business_director_verifications"\)[\s\S]{0,120}select\("\*"\)/);

const storageMigration = readFileSync(
  join(repositoryRoot, "supabase", "migrations", "20260729010000_private_evidence_storage_baseline.sql"),
  "utf8",
);
assert.match(storageMigration, /'kyc-documents', 'kyc-documents', FALSE, 10485760/);
assert.match(storageMigration, /'dispute-evidence', 'dispute-evidence', FALSE, 10485760/);
assert.match(storageMigration, /image\/jpeg[\s\S]*image\/png[\s\S]*image\/webp[\s\S]*application\/pdf/);
assert.match(storageMigration, /storage\.objects RLS must remain enabled/);
assert.match(storageMigration, /Unexpected browser\/storage policy already references a private evidence bucket/);
assert.doesNotMatch(storageMigration, /CREATE\s+POLICY/i);
assert.doesNotMatch(storageMigration, /\b(?:UPDATE|DELETE)\s+storage\.(?:buckets|objects)\b/i);

const disputePage = readFileSync(
  join(repositoryRoot, "src", "app", "(dashboard)", "dashboard", "disputes", "[id]", "page.tsx"),
  "utf8",
);
const disputeEvidenceRoute = readFileSync(
  join(repositoryRoot, "src", "app", "api", "merchant", "disputes", "[id]", "evidence", "route.ts"),
  "utf8",
);
const adminDisputePage = readFileSync(
  join(repositoryRoot, "src", "app", "(admin)", "admin", "disputes", "[id]", "page.tsx"),
  "utf8",
);
assert.doesNotMatch(disputePage, /kyc-documents|dispute-rebuttals|getPublicUrl|\.storage\s*\./);
assert.match(disputePage, /\/api\/merchant\/disputes\/\$\{encodeURIComponent\(dispute\.id\)\}\/evidence/);
assert.match(disputeEvidenceRoute, /resolveMerchantContextForUser/);
assert.match(disputeEvidenceRoute, /assertSameOriginBrowserMutationRequest/);
assert.match(disputeEvidenceRoute, /createSignedUrl/);
assert.match(disputeEvidenceRoute, /DISPUTE_EVIDENCE_BUCKET/);
assert.doesNotMatch(disputeEvidenceRoute, /getPublicUrl/);
assert.match(adminDisputePage, /\/api\/merchant\/disputes\/\$\{encodeURIComponent\(id\)\}\/evidence/);
assert.match(adminDisputePage, /merchant_evidence: evidencePayload\.evidence\?\.signedUrl/);

const merchantId = "11111111-1111-4111-8111-111111111111";
const disputeId = "22222222-2222-4222-8222-222222222222";
const objectId = "33333333-3333-4333-8333-333333333333";
const objectPath = buildDisputeEvidenceObjectPath({
  merchantId,
  disputeId,
  objectId,
  contentType: "application/pdf",
});
assert.equal(objectPath, `${merchantId}/${disputeId}/${objectId}.pdf`);
assert.equal(DISPUTE_EVIDENCE_BUCKET, "dispute-evidence");
assert.equal(DISPUTE_EVIDENCE_MAX_BYTES, 10 * 1024 * 1024);
assert.deepEqual(parseDisputeEvidenceField(mergeDisputeEvidenceField("customer-proof", objectPath)), {
  customerEvidence: "customer-proof",
  objectPath,
});
assert.deepEqual(parseDisputeEvidenceField("customer-proof|https://legacy.example/public"), {
  customerEvidence: "customer-proof",
  objectPath: null,
});
assert.equal(validateDisputeEvidenceFile({
  name: "evidence.pdf",
  size: 128,
  type: "application/pdf",
  async arrayBuffer() { return new ArrayBuffer(0); },
}).name, "evidence.pdf");
assert.throws(() => validateDisputeEvidenceFile({
  name: "payload.exe",
  size: 128,
  type: "application/octet-stream",
  async arrayBuffer() { return new ArrayBuffer(0); },
}), /PDF, JPEG, PNG, or WebP/);

const decisionMemo = readFileSync(
  join(repositoryRoot, "docs", "old-staging-manual-baseline-decisions.md"),
  "utf8",
);
assert.match(decisionMemo, /current source verdict is `READY_FOR_STAGING_REFRESH`/i);
assert.match(decisionMemo, /individual_bvn_selfie/);
assert.match(decisionMemo, /SECURITY DEFINER/);

console.log("PASS|SUPABASE_BASELINE_PACKAGING_VALIDATOR|offline_unit_contract");
