import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migrationPath = "supabase/migrations/20260819_01_merchant_settings_profile_compatibility.sql";
const preflightPath = "supabase/staging/preflight/023_merchant_settings_profile_compatibility_snapshot.sql";
const postflightPath = "supabase/staging/postflight/023_merchant_settings_profile_compatibility_verify.sql";

const migration023Columns = [
  "trading_name",
  "owner_name",
  "platform_version",
  "cac_number",
  "bvn",
  "cac_document_url",
  "utility_document_url",
  "cac_status",
  "utility_status",
  "bvn_status",
  "selfie_url",
  "selfie_status",
  "dojah_reference",
  "dojah_match_score",
  "kyc_attempt_count",
  "kyc_last_attempt_at",
  "kyc_provider_metadata",
  "kyc_locked_until",
  "kyc_rejection_reason",
  "kyc_reviewed_at",
  "kyc_reset_at",
  "verification_step_state",
  "business_registry_snapshot_id",
  "business_affiliation_status",
  "settlement_bank_name",
  "settlement_account_number",
  "settlement_account_name",
] as const;

const runtimeMerchantColumns = [
  "id",
  "user_id",
  "business_name",
  "email",
  "phone",
  "logo_url",
  "fee_absorption_default",
  "verification_status",
  "merchant_tier",
  "subscription_plan",
  "kyc_submitted_at",
  "kyc_notes",
  "monthly_collection_limit",
  "holds_pending_review",
  "created_at",
  "updated_at",
  "workspace_id",
  "onboarding_status",
  "setup_mode",
  "live_features_enabled",
  "verification_disclosure_acknowledged_at",
  "verification_disclosure_version",
  "relationship_claim",
  "paid_setup_started_at",
  "live_features_activated_at",
  "is_super_admin",
  "business_type",
  "business_street",
  "business_city",
  "business_state",
  "business_country",
  ...migration023Columns,
] as const;

const derivedMerchantProperties = new Set([
  "currentUserRole",
  "permissions",
  "is_hard_locked",
  "is_read_only",
  "is_suspended",
  "is_team_deactivated",
  "subscription_status",
]);

function stripSqlComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\r\n]*/g, " ");
}

function extractReceiverProperties(source: string, receivers: string[]): Set<string> {
  const escaped = receivers.map((receiver) => receiver.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const matcher = new RegExp(`\\b(?:${escaped.join("|")})\\??\\.([A-Za-z_][A-Za-z0-9_]*)`, "g");
  return new Set([...source.matchAll(matcher)].map((match) => match[1]));
}

function functionSlice(source: string, functionName: string): string {
  const start = source.indexOf(`export async function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} should exist.`);
  const nextExport = source.indexOf("export async function ", start + 1);
  return source.slice(start, nextExport === -1 ? source.length : nextExport);
}

function merchantSelectColumns(source: string): Set<string> {
  const matcher = /\.from\("merchants"\)\s*\.select\(\s*"([^"]+)"/g;
  const columns = new Set<string>();
  for (const match of source.matchAll(matcher)) {
    for (const column of match[1].split(",").map((value) => value.trim())) {
      if (/^[a-z_][a-z0-9_]*$/.test(column)) columns.add(column);
    }
  }
  return columns;
}

async function run() {
  const migration = readFileSync(migrationPath, "utf8");
  const preflight = readFileSync(preflightPath, "utf8");
  const postflight = readFileSync(postflightPath, "utf8");
  const actions = readFileSync("src/lib/actions.ts", "utf8");
  const settings = readFileSync("src/app/(dashboard)/settings/page.tsx", "utf8");
  const dashboardLayout = readFileSync("src/app/(dashboard)/layout.tsx", "utf8");
  const adminVerification = readFileSync("src/app/(admin)/admin/verification/page.tsx", "utf8");
  const onboardingFlow = readFileSync("src/lib/services/onboarding-flow.service.ts", "utf8");
  const verificationRequirements = readFileSync("src/lib/verification-requirements.ts", "utf8");

  assert.match(migration, /^BEGIN;[\s\S]*COMMIT;\s*$/m);
  assert.equal((migration.match(/\$\$/g) ?? []).length, 4, "Migration 023 should contain two complete DO blocks.");
  assert.match(migration, /NOTIFY pgrst, 'reload schema';/);

  const uncommentedMigration = stripSqlComments(migration);
  assert.doesNotMatch(uncommentedMigration, /^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/im);
  const alterStart = uncommentedMigration.indexOf("ALTER TABLE public.merchants");
  const alterEnd = uncommentedMigration.indexOf("DO $$", alterStart);
  const additiveDdl = uncommentedMigration.slice(alterStart, alterEnd);
  assert.doesNotMatch(additiveDdl, /\bDEFAULT\b/i);
  assert.doesNotMatch(additiveDdl, /\b(?:setup_mode|live_features_enabled|verification_status|identity_verified)\b/);
  assert.doesNotMatch(additiveDdl, /\b(?:payment_provider|payment_subaccount_code|subaccount_verified)\b/);

  for (const column of migration023Columns) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`));
  }

  for (const source of [preflight, postflight]) {
    assert.match(source, /SET TRANSACTION READ ONLY;/);
    assert.match(source, /ROLLBACK;/);
    assert.doesNotMatch(source, /^\s*\\(?:set|pset|ir|i)\b/im);
    assert.match(source, /check_name, object_type, expected, actual, status, details/);
    for (const column of runtimeMerchantColumns) {
      assert.match(source, new RegExp(`\\('${column}'(?:\\:\:text)?[,)]`), `${column} should be covered by the SQL contract.`);
    }
  }
  assert.match(preflight, /actual_type IS NULL THEN CASE WHEN repairable_by_023 THEN 'WARN' ELSE 'FAIL' END/);
  assert.match(postflight, /WHEN actual_type IS NULL THEN 'FAIL'/);

  const propertySources: Array<[string, string, string[]]> = [
    ["settings", settings, ["merchant", "nextMerchant"]],
    ["dashboard layout", dashboardLayout, ["merchant", "m"]],
    ["admin verification", adminVerification, ["selectedMerchant", "freshMerchant", "m"]],
    ["onboarding flow", onboardingFlow, ["merchant"]],
    ["verification requirements", verificationRequirements, ["merchant"]],
  ];
  const runtimeColumnSet = new Set<string>(runtimeMerchantColumns);
  for (const [label, source, receivers] of propertySources) {
    for (const property of extractReceiverProperties(source, receivers)) {
      assert.equal(
        runtimeColumnSet.has(property) || derivedMerchantProperties.has(property),
        true,
        `${label} references merchant.${property}, which is absent from the clean-production profile contract.`,
      );
    }
  }

  const verificationActionNames = [
    "submitKycAction",
    "submitDojahKycAction",
    "adminUpdateKycDocumentStatusAction",
    "adminApproveVerificationAction",
    "adminApproveIndividualIdentityReviewAction",
    "adminRejectVerificationAction",
    "adminResetVerificationAction",
    "adminRequestReuploadAction",
    "verifyRcNumberAction",
    "getDirectorApprovalContextAction",
    "requestManualReviewAction",
  ];
  for (const actionName of verificationActionNames) {
    const actionSource = functionSlice(actions, actionName);
    for (const column of merchantSelectColumns(actionSource)) {
      assert.equal(
        runtimeColumnSet.has(column),
        true,
        `${actionName} selects merchants.${column}, which is absent from the profile contract.`,
      );
    }
  }

  const submitKyc = functionSlice(actions, "submitKycAction");
  assert.doesNotMatch(submitKyc, /syncMerchantSetupStatus/);
  assert.match(submitKyc, /allowedSettingsKeys/);
  assert.match(submitKyc, /Object\.entries\(updates\)\.filter/);
  assert.match(submitKyc, /const safeUpdates = Object\.fromEntries/);
  const allowedStart = submitKyc.indexOf("const allowedSettingsKeys");
  const allowedEnd = submitKyc.indexOf("]);", allowedStart);
  const allowedSettingsBlock = submitKyc.slice(allowedStart, allowedEnd);
  for (const forbidden of [
    "setup_mode",
    "live_features_enabled",
    "verification_status",
    "bvn_status",
    "selfie_status",
    "cac_status",
    "utility_status",
    "business_affiliation_status",
    "identity_verified",
  ]) {
    assert.doesNotMatch(allowedSettingsBlock, new RegExp(`\\b${forbidden}\\b`));
  }

  console.log("merchant-settings-profile-schema-contract.test.ts passed");
}

void run();
