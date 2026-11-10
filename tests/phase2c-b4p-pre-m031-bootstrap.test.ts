import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();

/**
 * Mirrors the verifier's deliberately narrow lexical normalization. It is a
 * source-contract guard, not a claim that this replaces PostgreSQL parsing.
 */
const normalizeConstraintDefinitionForContract = (definition: string) => {
  let output = "";
  let inSingleQuotedLiteral = false;
  let inDoubleQuotedIdentifier = false;
  let literalJustClosed = false;
  let previousTokenEnds = false;
  let pendingTokenSeparator = false;

  for (let index = 0; index < definition.length; index += 1) {
    const character = definition[index];
    const nextCharacter = definition[index + 1];

    if (inSingleQuotedLiteral) {
      output += character;
      if (character === "'") {
        if (nextCharacter === "'") {
          output += nextCharacter;
          index += 1;
        } else {
          inSingleQuotedLiteral = false;
          literalJustClosed = true;
          previousTokenEnds = true;
        }
      }
      continue;
    }

    if (inDoubleQuotedIdentifier) {
      output += character;
      if (character === '"') {
        if (nextCharacter === '"') {
          output += nextCharacter;
          index += 1;
        } else {
          inDoubleQuotedIdentifier = false;
          previousTokenEnds = true;
        }
      }
      continue;
    }

    if (character === "'") {
      output += character;
      inSingleQuotedLiteral = true;
      literalJustClosed = false;
      previousTokenEnds = false;
      pendingTokenSeparator = false;
      continue;
    }
    if (character === '"') {
      output += character;
      inDoubleQuotedIdentifier = true;
      literalJustClosed = false;
      previousTokenEnds = false;
      pendingTokenSeparator = false;
      continue;
    }
    if (literalJustClosed && definition.slice(index, index + 6).toLowerCase() === "::text") {
      index += 5;
      literalJustClosed = false;
      previousTokenEnds = true;
      pendingTokenSeparator = false;
      continue;
    }
    if (/\s/.test(character)) {
      if (previousTokenEnds) {
        pendingTokenSeparator = true;
      }
      continue;
    }

    const currentIsTokenWord = /[A-Za-z0-9_$]/.test(character);
    if (pendingTokenSeparator && currentIsTokenWord) {
      output += " ";
    }
    output += character.toLowerCase();
    literalJustClosed = false;
    previousTokenEnds = currentIsTokenWord;
    pendingTokenSeparator = false;
  }

  return output;
};

const bootstrapPath = "supabase/tests/phase2c_b4p_pre_m031_bootstrap.sql";
const verifyPath = "supabase/tests/phase2c_b4p_pre_m031_verify.sql";
const checkDiagnosticPath = "supabase/tests/phase2c_b4p_pre_m031_check_diagnostic.sql";
const runnerPath = "scripts/rehearse-phase2c-b4p-local.ps1";
const bootstrap = read(bootstrapPath);
const verify = read(verifyPath);
const checkDiagnostic = read(checkDiagnosticPath);
const runner = read(runnerPath);
const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

const canonicalSources = [
  ["supabase/staging/001_schema_only.sql", "90EFD55F47664A8463AA453AAE90F7F32C06941A3A574AB4A6990D348107E4DB"],
  ["supabase/staging/002_onboarding_verification_upgrade_flow.sql", "3B430EA1050D633EDE99A9CDF8AE62D63B45FE3126BB180C8038845650933431"],
  ["supabase/staging/004_phase1_plan_compatibility.sql", "E91C94C28E58E3F2B961AD8ECFCAE0B33CF2404B4F741A52C65E6D6DF81453E7"],
  ["supabase/staging/006_solo_plus_prerequisites.sql", "DF5C12E87C35E8B685E2C30C93AB5000C16DD4C613407794C3FA11BE1BE744BD"],
  ["supabase/staging/007_solo_plus_case_foundation.sql", "AC1DF3244FBEDC19BAD593515D30E150CCA7CE1A770FC99F825338CA9AAF295C"],
  ["supabase/migrations/20260728000000_authorization_hardening.sql", "3EFB2B353A5EDCCC1854D5D6A03343296000B6C1D44307B200562C18DF298C7D"],
  ["supabase/migrations/20260818025000_paid_subscription_tables_prerequisite.sql", "A5BC25D7D72B5EB8C7FA3A015DAA9E39D3EC80FE4A4CC1D35DF93E375EEEEEA2"],
  ["supabase/migrations/20260820_00_prd_phase_2_compliance_schema_substrate.sql", "8A42669B40AE29D1170DD09831F0B79E795052614FD874432E6077D1072816CF"],
  ["supabase/migrations/20260824_00_reviewed_profile_bootstrap_rpc.sql", "E607CB2F1EF95FEAE26DFFA153D8206E2D63EFCCCF039026DF9CB48F2862D948"],
  ["supabase/migrations/20260825000000_reviewed_profile_approval_rpc.sql", "B8091BCD633E2F963211B27277DAC583EDD5D0064DA43A732C8E10C9BCA39BE0"],
  ["supabase/migrations/20260825010000_cleanup_approval_rpc_diagnostics.sql", "89DF755AA7DBE06BD0F4C5C911367436157A0D9A5DDC9DF138DF323F40FB4F20"],
  ["supabase/migrations/20260825020000_canonical_approval_snapshot_idempotency.sql", "1F5E63575B8FAAC42B56723019097B3FAFF56292DEED48D1D19F9D87F43E1830"],
  ["supabase/migrations/20260826_00_canonical_workspace_linkage.sql", "3EC3DFA172F5EBC1C34903853FB9746EFB012731DED2CE3B344C7533951A34F9"],
  ["supabase/migrations/20260827_00_m028_m029_readiness_integration.sql", "8759BED04E9F019762B69FDF25C155F9DEAAFF691D844DFCBBE69663F604D49B"],
  ["supabase/migrations/20261021000000_phase2c_nonadopted_review_substrate.sql", "49FD3E667E464D18512C0EF48CC84D475525FB9E635793BD789C6B6326D1B528"],
  ["supabase/migrations/20261022000000_phase2c_nonadopted_review_triage_resubmission.sql", "23F66A123C89CB2E2C6C2F7001FF83840538DEF9CCB0AAFDADC0BB755A12ADF2"],
  ["supabase/migrations/20261023000000_phase2c_draft_compliance_profile_provisioning.sql", "12CDC46047AF9F39A02C9D4AF330256BCD8C48654101F49C5C9940D69BC036CF"],
] as const;

for (const [path, expectedHash] of canonicalSources) {
  assert.equal(sha256(path), expectedHash, `source pin drift: ${path}`);
  assert.ok(runner.includes(`'${path}' = '${expectedHash}'`), `runner pin missing: ${path}`);
}

const gateIndex = bootstrap.indexOf("\\ir phase2c_b4p_local_target_gate.sql");
const firstMutationIndex = bootstrap.search(/CREATE EXTENSION|CREATE ROLE|CREATE SCHEMA|CREATE TABLE/i);
assert.ok(gateIndex >= 0 && firstMutationIndex > gateIndex, "local target gate must precede schema mutation");
assert.match(bootstrap, /B4P_PRE_M031_BOOTSTRAP_REQUIRES_EMPTY_DATABASE/);
assert.match(bootstrap, /CREATE ROLE service_role[\s\S]+NOLOGIN[\s\S]+BYPASSRLS/);
assert.match(bootstrap, /CREATE ROLE anon[\s\S]+NOLOGIN[\s\S]+NOBYPASSRLS/);
assert.match(bootstrap, /CREATE ROLE authenticated[\s\S]+NOLOGIN[\s\S]+NOBYPASSRLS/);
assert.match(bootstrap, /CREATE EXTENSION IF NOT EXISTS pgcrypto/);
assert.match(bootstrap, /pg_catalog\.pg_auth_members/);
assert.match(bootstrap, /B4P_LOCAL_MANAGED_ROLE_MEMBERSHIP_INCOMPATIBLE/);
assert.doesNotMatch(bootstrap, /20261023000000_phase2c_draft_compliance_profile_provisioning/);
assert.doesNotMatch(bootstrap, /2026102[4-9]|202611|2027/);

const expectedIncludes = canonicalSources.slice(0, -1).map(([path]) => {
  const relative = path.replace(/^supabase\//, "../");
  return `\\ir ${relative}`;
});
let previousIndex = -1;
for (const include of expectedIncludes) {
  const currentIndex = bootstrap.indexOf(include);
  assert.ok(currentIndex > previousIndex, `missing or out-of-order canonical source: ${include}`);
  previousIndex = currentIndex;
}

for (const relation of [
  "public.merchants",
  "public.workspaces",
  "public.workspace_subscriptions",
  "public.subscriptions",
  "public.merchant_canonical_workspaces",
  "public.merchant_compliance_profiles",
  "public.merchant_compliance_reviews",
  "public.merchant_compliance_events",
]) {
  assert.ok(verify.includes(`'${relation}'`), `postcondition missing relation: ${relation}`);
}
assert.match(verify, /PRE_M031_CATALOG_VERIFY\|PASS/);
assert.match(verify, /pg_catalog\.pg_proc[\s\S]+pg_catalog\.pg_namespace[\s\S]+p\.proname='ensure_draft_compliance_profile_v1'/);
assert.doesNotMatch(verify, /to_regprocedure\('public\.ensure_draft_compliance_profile_v1\(/);
assert.match(verify, /M031_RPC_OR_OVERLOAD_ALREADY_PRESENT/);
assert.match(verify, /pg_catalog\.pg_auth_members/);
assert.match(verify, /B4P_PRE_M031_BROWSER_PRIVILEGE_LEAK/);
assert.ok(verify.includes("('public.merchants','is_super_admin','boolean',true,'false')"));

for (const column of [
  "id", "merchant_id", "plan_code", "business_type", "compliance_status",
  "activation_status", "risk_rating", "restriction_state", "restriction_reason_code",
  "restriction_notes", "restriction_effective_at", "restriction_review_due_at",
  "collection_limit_basis", "approved_monthly_volume", "cumulative_collection_cap",
  "cumulative_collection_used", "hidden_daily_velocity_limit", "single_transaction_limit",
  "outstanding_receivable_cap", "collection_limit_approved", "limits_approved_at",
  "limits_approved_by", "can_collect_payments", "can_use_instant_sale",
  "can_use_receivable_sale", "can_use_storefront", "can_activate_settlement",
  "can_use_deposit_balance", "policy_version", "decision_source_type",
  "decision_source_id", "decision_source_version", "last_reviewed_at",
  "next_review_due_at", "reviewed_by", "row_version", "created_at", "updated_at",
]) {
  assert.ok(
    verify.includes(`('public.merchant_compliance_profiles','${column}'`),
    `profile catalog assertion missing: ${column}`,
  );
}

for (const column of [
  "id", "merchant_id", "plan_type", "amount_paid", "start_date", "expiry_date",
  "status", "last_notified_at", "is_banner_dismissed", "created_at", "updated_at",
]) {
  assert.ok(
    verify.includes(`('public.subscriptions','${column}'`),
    `subscription catalog assertion missing: ${column}`,
  );
}

for (const contract of [
  "merchant_canonical_workspaces_pkey",
  "merchant_canonical_workspaces_workspace_key",
  "merchant_canonical_workspaces_reconcile_key",
  "merchant_canonical_workspaces_version_check",
  "merchant_canonical_workspaces_key_check",
  "merchant_canonical_workspaces_merchant_fkey",
  "merchant_canonical_workspaces_created_by_fkey",
  "merchant_canonical_workspaces_workspace_owner_fkey",
  "merchant_canonical_workspace_supporting_owner_key",
  "uq_merchant_compliance_profiles_merchant_id",
  "merchant_compliance_profiles_merchant_id_fkey",
  "merchant_compliance_profiles_plan_code_check",
  "merchant_compliance_profiles_compliance_status_check",
  "merchant_compliance_profiles_activation_status_check",
  "merchant_compliance_profiles_decision_source_check",
  "merchant_compliance_profiles_row_version_check",
  "merchant_compliance_profiles_limit_approval_check",
  "merchant_compliance_profiles_receivable_collection_check",
  "merchant_compliance_profiles_deposit_requires_receivable_check",
  "merchant_compliance_profiles_plan_entitlement_check",
  "uq_merchant_compliance_reviews_idempotency",
  "merchant_compliance_reviews_merchant_id_fkey",
  "merchant_compliance_reviews_profile_id_fkey",
  "merchant_compliance_reviews_status_check",
  "merchant_compliance_reviews_evidence_snapshot_check",
  "merchant_compliance_reviews_row_version_check",
  "uq_merchant_compliance_events_idempotency",
  "merchant_compliance_events_merchant_id_fkey",
  "merchant_compliance_events_profile_id_fkey",
  "merchant_compliance_events_actor_type_check",
  "merchant_compliance_events_source_check",
  "merchant_compliance_events_versions_check",
  "merchant_compliance_events_state_check",
]) {
  assert.ok(verify.includes(contract), `catalog constraint assertion missing: ${contract}`);
}

assert.match(verify, /pg_catalog\.pg_get_constraintdef\(c\.oid,true\)/);
assert.match(verify, /AS required\(relation_name,constraint_name,semantic_pattern\)/);
assert.match(verify, /v_normalized_definition !~ v_constraint\.semantic_pattern/);
assert.match(verify, /B4P_PRE_M031_CHECK_DEFINITION_INCOMPATIBLE/);
assert.match(verify, /v_in_single_quoted_literal/);
assert.match(verify, /v_in_double_quoted_identifier/);
assert.match(verify, /v_literal_just_closed[\s\S]+::text/);
assert.match(
  verify,
  /v_definition_character ~ '\[\[:space:\]\]' THEN\s+IF v_previous_token_ends THEN\s+v_pending_token_separator := true/,
);
assert.match(
  verify,
  /IF v_pending_token_separator AND v_current_is_token_word THEN\s+v_normalized_definition := v_normalized_definition \|\| ' '/,
);
assert.doesNotMatch(verify, /lower\(pg_catalog\.regexp_replace/);
assert.doesNotMatch(verify, /replace\(v_normalized_definition,'::(?:numeric|bigint)'/);
assert.doesNotMatch(verify, /pg_get_constraintdef[\s\S]{0,500}\bLIKE\b/i);

const semanticChecks = [
  "merchant_canonical_workspaces_version_check",
  "merchant_canonical_workspaces_key_check",
  "merchant_compliance_profiles_plan_code_check",
  "merchant_compliance_profiles_business_type_check",
  "merchant_compliance_profiles_compliance_status_check",
  "merchant_compliance_profiles_activation_status_check",
  "merchant_compliance_profiles_risk_rating_check",
  "merchant_compliance_profiles_restriction_state_check",
  "merchant_compliance_profiles_collection_limit_basis_check",
  "merchant_compliance_profiles_amounts_check",
  "merchant_compliance_profiles_decision_source_check",
  "merchant_compliance_profiles_decision_source_version_check",
  "merchant_compliance_profiles_row_version_check",
  "merchant_compliance_profiles_limit_approval_check",
  "merchant_compliance_profiles_receivable_collection_check",
  "merchant_compliance_profiles_deposit_requires_receivable_check",
  "merchant_compliance_profiles_plan_entitlement_check",
  "merchant_compliance_reviews_type_plan_check",
  "merchant_compliance_reviews_status_check",
  "merchant_compliance_reviews_evidence_snapshot_check",
  "merchant_compliance_reviews_idempotency_key_check",
  "merchant_compliance_reviews_row_version_check",
  "merchant_compliance_events_event_type_check",
  "merchant_compliance_events_actor_type_check",
  "merchant_compliance_events_source_check",
  "merchant_compliance_events_idempotency_key_check",
  "merchant_compliance_events_versions_check",
  "merchant_compliance_events_state_check",
  "merchant_compliance_events_metadata_check",
] as const;

for (const constraint of semanticChecks) {
  const occurrences = verify.split(constraint).length - 1;
  assert.ok(
    occurrences >= 2,
    `named CHECK must have structural and semantic assertions: ${constraint}`,
  );
}

// The companion diagnostic is catalog-read-only and intentionally uses the
// same 29-item semantic inventory. It reports every result before emitting a
// summary; it cannot replace or turn the fail-fast verifier into a success.
assert.match(checkDiagnostic, /\\ir phase2c_b4p_local_target_gate\.sql/);
assert.match(checkDiagnostic, /pg_catalog\.pg_get_constraintdef\(c\.oid, true\)/);
assert.match(checkDiagnostic, /CHECK_RESULT\|%\|%\|%/);
assert.match(checkDiagnostic, /ACTUAL_DEFINITION\|%/);
assert.match(checkDiagnostic, /EXPECTED_PATTERN\|%/);
assert.match(checkDiagnostic, /NORMALIZED_ACTUAL\|%/);
assert.match(checkDiagnostic, /CHECK_DIAGNOSTIC\|TOTAL=29/);
assert.match(checkDiagnostic, /CHECK_DIAGNOSTIC\|MATCH=%/);
assert.match(checkDiagnostic, /CHECK_DIAGNOSTIC\|MISMATCH=%/);
assert.doesNotMatch(checkDiagnostic, /^\s*(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE)\b/im);
assert.doesNotMatch(checkDiagnostic, /RAISE EXCEPTION[\s\S]{0,100}CHECK_/);
assert.match(checkDiagnostic, /IF v_pending_token_separator AND v_current_is_token_word THEN\s+v_normalized_definition := v_normalized_definition \|\| ' '/);
assert.match(checkDiagnostic, /IF v_matches THEN\s+v_match_count := v_match_count \+ 1;\s+ELSE\s+v_mismatch_count := v_mismatch_count \+ 1;/);
for (const constraint of semanticChecks) {
  assert.ok(checkDiagnostic.includes(constraint), `collect-all diagnostic missing CHECK: ${constraint}`);
}

assert.match(runner, /phase2c_b4p_pre_m031_check_diagnostic\.sql/);
assert.match(runner, /function Invoke-PreM031CheckDiagnostic/);
assert.match(runner, /\$CurrentStage -eq 'PRE_M031_CATALOG_VERIFY' -and \$databaseCreated/);
assert.match(runner, /CHECK_DIAGNOSTIC_FAILURE\|/);
assert.match(runner, /B4P_LOCAL_REHEARSAL_CHECK_DIAGNOSTIC_INCOMPLETE/);
assert.ok(
  runner.indexOf("Invoke-PreM031CheckDiagnostic -Database $LocalDatabase") < runner.indexOf("$CurrentStage = 'DATABASE_CLEANUP'"),
  "collect-all diagnostic must run before mandatory cleanup",
);
assert.ok(
  runner.indexOf("$CurrentStage = 'M031_APPLY'") > runner.indexOf("$CurrentStage = 'PRE_M031_CATALOG_VERIFY'"),
  "M031 must remain after authoritative catalog verification",
);

for (const canonicalSemantic of [
  "plan_code=any\\(array\\[''starter'',''solo_lite'',''solo_plus'',''business''\\]\\)",
  "compliance_status=any\\(array\\[''draft'',''lite_pending'',''lite_verified'',''enhanced_pending'',''enhanced_verified'',''business_pending'',''business_verified'',''needs_attention'',''restricted'',''rejected''\\]\\)",
  "activation_status=any\\(array\\[''test_mode'',''pre_approved'',''awaiting_review'',''approved'',''needs_attention'',''restricted'',''suspended''\\]\\)",
  "row_version>0",
  "decision_source_type is null and decision_source_id is null",
  "not collection_limit_approved",
  "not can_use_receivable_sale or can_collect_payments",
  "not can_use_deposit_balance or can_use_receivable_sale",
  "review_status=any\\(array\\[''draft'',''pending'',''approved'',''rejected'',''needs_attention'',''cancelled''\\]\\)",
  "actor_type=any\\(array\\[''system'',''admin'',''merchant'',''reconciliation''\\]\\)",
  "expected_row_version is null or expected_row_version>0",
  "link_version=1",
]) {
  assert.ok(verify.includes(canonicalSemantic), `semantic CHECK proof missing: ${canonicalSemantic}`);
}

const semanticComparisonCases = {
  literalCaseCanonical: "CHECK (compliance_status = 'draft'::text)",
  literalCaseMutated: "CHECK (compliance_status = 'DRAFT'::text)",
  literalWhitespaceCanonical: "CHECK (collection_limit_basis = 'none'::text)",
  literalWhitespaceMutated: "CHECK (collection_limit_basis = 'n o n e'::text)",
  numericCastCanonical: "CHECK (approved_monthly_volume >= 0::numeric)",
  numericCastMutated: "CHECK (approved_monthly_volume::bigint >= 0::bigint)",
  enumCanonical: "CHECK (plan_code = ANY (ARRAY['starter'::text, 'solo_lite'::text]))",
  enumAdded: "CHECK (plan_code = ANY (ARRAY['starter'::text, 'solo_lite'::text, 'unauthorized'::text]))",
  enumRemoved: "CHECK (plan_code = ANY (ARRAY['starter'::text]))",
  operatorMutated: "CHECK (row_version >= 0::bigint)",
  negationMutated: "CHECK (NOT can_use_receivable_sale OR NOT can_collect_payments)",
  orTrueMutated: "CHECK (NOT can_use_receivable_sale OR can_collect_payments OR TRUE)",
  entitlementCanonical: "CHECK (NOT can_use_deposit_balance OR can_use_receivable_sale)",
  entitlementMutated: "CHECK (NOT can_use_deposit_balance OR can_collect_payments)",
  keywordIdentifierCanonical: "CHECK (NOT can_use_receivable_sale OR can_collect_payments)",
  keywordIdentifierMutated: "CHECK (notcan_use_receivable_sale OR can_collect_payments)",
  notInCanonical: "CHECK (plan_code NOT IN ('starter', 'solo_lite'))",
  notInMutated: "CHECK (plan_code NOTIN ('starter', 'solo_lite'))",
  isNotNullCanonical: "CHECK (decision_source_id IS NOT NULL)",
  isNotNullMutated: "CHECK (decision_source_id ISNOT NULL)",
};

assert.equal(
  normalizeConstraintDefinitionForContract("CHECK (compliance_status = 'draft'::text)"),
  normalizeConstraintDefinitionForContract("CHECK (compliance_status = 'draft')"),
  "only the exact redundant text-literal cast may be omitted",
);
for (const [canonical, mutated] of [
  [semanticComparisonCases.literalCaseCanonical, semanticComparisonCases.literalCaseMutated],
  [semanticComparisonCases.literalWhitespaceCanonical, semanticComparisonCases.literalWhitespaceMutated],
  [semanticComparisonCases.numericCastCanonical, semanticComparisonCases.numericCastMutated],
  [semanticComparisonCases.enumCanonical, semanticComparisonCases.enumAdded],
  [semanticComparisonCases.enumCanonical, semanticComparisonCases.enumRemoved],
  ["CHECK (row_version > 0::bigint)", semanticComparisonCases.operatorMutated],
  ["CHECK (NOT can_use_receivable_sale OR can_collect_payments)", semanticComparisonCases.negationMutated],
  ["CHECK (NOT can_use_receivable_sale OR can_collect_payments)", semanticComparisonCases.orTrueMutated],
  [semanticComparisonCases.entitlementCanonical, semanticComparisonCases.entitlementMutated],
  [semanticComparisonCases.keywordIdentifierCanonical, semanticComparisonCases.keywordIdentifierMutated],
  [semanticComparisonCases.notInCanonical, semanticComparisonCases.notInMutated],
  [semanticComparisonCases.isNotNullCanonical, semanticComparisonCases.isNotNullMutated],
] as const) {
  assert.notEqual(
    normalizeConstraintDefinitionForContract(canonical),
    normalizeConstraintDefinitionForContract(mutated),
    `semantic collision: ${canonical} vs ${mutated}`,
  );
}
assert.equal(
  normalizeConstraintDefinitionForContract("CHECK (NOT   can_use_receivable_sale OR\n  can_collect_payments)"),
  normalizeConstraintDefinitionForContract(semanticComparisonCases.keywordIdentifierCanonical),
  "repeated exterior whitespace may collapse only to required token separators",
);

// PostgreSQL 15.18 collect-all evidence supplied the exact normalized
// definitions for the nine previously mismatching constraints. The remaining
// twenty were reported MATCH by that same catalog run. Keep both SQL artifacts
// byte-for-byte aligned at the relation/name/pattern level.
const canonicalProfileSource = read("supabase/migrations/20260820_00_prd_phase_2_compliance_schema_substrate.sql");
const canonicalCheck = (name: string) => {
  const start = canonicalProfileSource.indexOf(`CONSTRAINT ${name}`);
  assert.ok(start >= 0, `canonical CHECK missing: ${name}`);
  const next = canonicalProfileSource.indexOf("CONSTRAINT ", start + 11);
  const section = canonicalProfileSource.slice(start, next < 0 ? undefined : next);
  const expression = section.match(/CHECK\s*\([\s\S]*?\)(?=\s*(?:,\s*$|\s*\);))/)?.[0];
  assert.ok(expression, `canonical CHECK expression missing: ${name}`);
  return expression;
};
const patternInventory = (source: string) => {
  const entries = [...source.matchAll(/\('([^']+)','([^']+)',\s*'(\^(?:''|[^'])*)'\)/g)];
  const patterns = new Map<string, RegExp>();
  for (const [, relation, constraint, pattern] of entries) {
    const identity = `${relation}.${constraint}`;
    assert.ok(!patterns.has(identity), `duplicate CHECK pattern binding: ${identity}`);
    patterns.set(identity, new RegExp(pattern.replace(/''/g, "'")));
  }
  return patterns;
};
const verifierPatterns = patternInventory(verify);
const diagnosticPatterns = patternInventory(checkDiagnostic);
assert.equal(verifierPatterns.size, 29, "authoritative verifier must bind exactly 29 CHECK patterns");
assert.equal(diagnosticPatterns.size, 29, "diagnostic must bind exactly 29 CHECK patterns");
assert.deepEqual([...diagnosticPatterns.keys()], [...verifierPatterns.keys()], "diagnostic CHECK identities must match verifier");
for (const [identity, pattern] of verifierPatterns) {
  assert.equal(diagnosticPatterns.get(identity)?.source, pattern.source, `diagnostic pattern drift: ${identity}`);
}
const verifierCheckPattern = (relation: string, name: string) => {
  const pattern = verifierPatterns.get(`${relation}.${name}`);
  assert.ok(pattern, `verifier CHECK pattern missing: ${relation}.${name}`);
  return pattern;
};

const observedPostgres1518Definitions = [
  ["public.merchant_compliance_profiles", "merchant_compliance_profiles_business_type_check", "CHECK (business_type IS NULL OR (business_type = ANY (ARRAY['unregistered_individual'::text, 'sole_proprietor'::text, 'registered_business_name'::text, 'limited_liability_company'::text, 'incorporated_trustee'::text, 'other_entity'::text])))"],
  ["public.merchant_compliance_profiles", "merchant_compliance_profiles_risk_rating_check", "CHECK (risk_rating IS NULL OR (risk_rating = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'restricted'::text])))"],
  ["public.merchant_compliance_profiles", "merchant_compliance_profiles_restriction_state_check", "CHECK (restriction_state IS NULL OR (restriction_state = ANY (ARRAY['active'::text, 'restricted'::text, 'suspended'::text])))"],
  ["public.merchant_compliance_profiles", "merchant_compliance_profiles_collection_limit_basis_check", "CHECK (collection_limit_basis IS NULL OR (collection_limit_basis = ANY (ARRAY['none'::text, 'cumulative'::text, 'monthly'::text, 'approved_volume'::text])))"],
  ["public.merchant_compliance_profiles", "merchant_compliance_profiles_decision_source_check", "CHECK (decision_source_type IS NULL AND decision_source_id IS NULL OR (decision_source_type = ANY (ARRAY['solo_lite_review'::text, 'solo_plus_case'::text, 'business_kyb_review'::text, 'restriction_review'::text, 'system_reconciliation'::text])) AND decision_source_id IS NOT NULL)"],
  ["public.merchant_compliance_profiles", "merchant_compliance_profiles_limit_approval_check", "CHECK (NOT collection_limit_approved OR collection_limit_basis IS NOT NULL AND collection_limit_basis <> 'none'::text AND limits_approved_at IS NOT NULL AND limits_approved_by IS NOT NULL)"],
  ["public.merchant_compliance_profiles", "merchant_compliance_profiles_plan_entitlement_check", "CHECK ((plan_code <> ALL (ARRAY['starter'::text, 'solo_lite'::text])) OR NOT can_use_receivable_sale AND NOT can_use_deposit_balance)"],
  ["public.merchant_compliance_reviews", "merchant_compliance_reviews_type_plan_check", "CHECK (review_type = 'solo_lite'::text AND target_plan_code = 'solo_lite'::text OR review_type = 'business_kyb'::text AND target_plan_code = 'business'::text)"],
  ["public.merchant_compliance_events", "merchant_compliance_events_source_check", "CHECK (source_type IS NULL AND source_id IS NULL OR (source_type = ANY (ARRAY['solo_lite_review'::text, 'solo_plus_case'::text, 'business_kyb_review'::text, 'restriction_review'::text, 'system_reconciliation'::text])) AND source_id IS NOT NULL)"],
] as const;
assert.equal(observedPostgres1518Definitions.length, 9);
assert.equal(verifierPatterns.size - observedPostgres1518Definitions.length, 20, "runtime report retained twenty existing matches");
for (const [relation, name, actualDefinition] of observedPostgres1518Definitions) {
  assert.match(
    normalizeConstraintDefinitionForContract(actualDefinition),
    verifierCheckPattern(relation, name),
    `PostgreSQL 15.18 definition must match: ${relation}.${name}`,
  );
}

for (const [name, canonicalRule] of [
  ["merchant_compliance_profiles_business_type_check", /business_type IS NULL OR business_type IN/],
  ["merchant_compliance_profiles_risk_rating_check", /risk_rating IS NULL OR risk_rating IN/],
  ["merchant_compliance_profiles_restriction_state_check", /restriction_state IS NULL OR restriction_state IN/],
  ["merchant_compliance_profiles_collection_limit_basis_check", /collection_limit_basis IS NULL OR collection_limit_basis IN/],
  ["merchant_compliance_profiles_decision_source_check", /decision_source_type IS NULL AND decision_source_id IS NULL/],
  ["merchant_compliance_profiles_limit_approval_check", /NOT collection_limit_approved OR/],
  ["merchant_compliance_profiles_plan_entitlement_check", /plan_code NOT IN \('starter', 'solo_lite'\) OR/],
] as const) {
  assert.match(canonicalCheck(name), canonicalRule, `canonical M024 rule missing: ${name}`);
}
const receivableName = "merchant_compliance_profiles_receivable_collection_check";
const depositName = "merchant_compliance_profiles_deposit_requires_receivable_check";
for (const [name, mutations] of [
  [receivableName, [
    "CHECK (notcan_use_receivable_sale OR can_collect_payments)",
    "CHECK (NOT can_use_receivable_sale)",
    "CHECK (NOT can_use_receivable_sale AND can_collect_payments)",
    "CHECK (NOT can_use_receivable_sale OR can_collect_payments OR TRUE)",
    "CHECK (NOT can_use_receivable_sale OR NOT can_collect_payments)",
  ]],
  [depositName, [
    "CHECK (notcan_use_deposit_balance OR can_use_receivable_sale)",
    "CHECK (NOT can_use_deposit_balance)",
    "CHECK (NOT can_use_deposit_balance AND can_use_receivable_sale)",
    "CHECK (NOT can_use_deposit_balance OR can_use_receivable_sale OR TRUE)",
    "CHECK (NOT can_use_deposit_balance OR NOT can_use_receivable_sale)",
    "CHECK (NOT can_use_deposit_balance OR can_collect_payments)",
  ]],
] as const) {
  for (const mutation of mutations) {
    assert.doesNotMatch(normalizeConstraintDefinitionForContract(mutation), verifierCheckPattern("public.merchant_compliance_profiles", name),
      `altered CHECK must not match its verifier pattern: ${name}: ${mutation}`);
  }
}

const correctedPatternMutations = [
  ["public.merchant_compliance_profiles", "merchant_compliance_profiles_business_type_check", "CHECK (business_type IS NULL OR (business_type = ANY (ARRAY['unregistered_individual'::text, 'unauthorized'::text])))"],
  ["public.merchant_compliance_profiles", "merchant_compliance_profiles_risk_rating_check", "CHECK (risk_rating IS NULL OR (risk_rating = ANY (ARRAY['low'::text, 'unauthorized'::text])))"],
  ["public.merchant_compliance_profiles", "merchant_compliance_profiles_restriction_state_check", "CHECK (restriction_state IS NULL OR (restriction_state = ANY (ARRAY['active'::text, 'unauthorized'::text])))"],
  ["public.merchant_compliance_profiles", "merchant_compliance_profiles_collection_limit_basis_check", "CHECK (collection_limit_basis IS NULL OR (collection_limit_basis = ANY (ARRAY['none'::text, 'unauthorized'::text])))"],
  ["public.merchant_compliance_profiles", "merchant_compliance_profiles_decision_source_check", "CHECK (decision_source_type IS NULL AND decision_source_id IS NOT NULL OR (decision_source_type = ANY (ARRAY['solo_lite_review'::text])) AND decision_source_id IS NOT NULL)"],
  ["public.merchant_compliance_profiles", "merchant_compliance_profiles_limit_approval_check", "CHECK (NOT collection_limit_approved OR collection_limit_basis IS NOT NULL)"],
  ["public.merchant_compliance_profiles", "merchant_compliance_profiles_plan_entitlement_check", "CHECK ((plan_code <> ALL (ARRAY['starter'::text, 'solo_lite'::text])) OR NOT can_use_receivable_sale)"],
  ["public.merchant_compliance_reviews", "merchant_compliance_reviews_type_plan_check", "CHECK (review_type = 'solo_lite'::text AND target_plan_code = 'business'::text OR review_type = 'business_kyb'::text AND target_plan_code = 'business'::text)"],
  ["public.merchant_compliance_events", "merchant_compliance_events_source_check", "CHECK (source_type IS NULL AND source_id IS NOT NULL OR (source_type = ANY (ARRAY['solo_lite_review'::text])) AND source_id IS NOT NULL)"],
] as const;
for (const [relation, name, mutation] of correctedPatternMutations) {
  assert.doesNotMatch(
    normalizeConstraintDefinitionForContract(mutation),
    verifierCheckPattern(relation, name),
    `weakened PostgreSQL-style CHECK must not match: ${relation}.${name}`,
  );
}
for (const [relation, name, actualDefinition] of observedPostgres1518Definitions) {
  assert.doesNotMatch(
    normalizeConstraintDefinitionForContract(`${actualDefinition.slice(0, -1)} OR TRUE)`),
    verifierCheckPattern(relation, name),
    `OR TRUE must not match: ${relation}.${name}`,
  );
}

for (const column of [
  "review_type", "target_plan_code", "review_status", "evidence_snapshot",
  "decision_reason_code", "decision_notes", "policy_version", "submitted_at",
  "reviewed_at", "reviewed_by", "idempotency_key", "row_version",
]) {
  assert.ok(
    verify.includes(`('public.merchant_compliance_reviews','${column}'`),
    `review catalog assertion missing: ${column}`,
  );
}

for (const column of [
  "event_type", "from_state", "to_state", "reason_code", "notes", "actor_type",
  "actor_id", "source_type", "source_id", "policy_version", "idempotency_key",
  "expected_row_version", "resulting_row_version", "metadata", "created_at",
]) {
  assert.ok(
    verify.includes(`('public.merchant_compliance_events','${column}'`),
    `event catalog assertion missing: ${column}`,
  );
}

const profileMigration = read("supabase/migrations/20260820_00_prd_phase_2_compliance_schema_substrate.sql");
for (const contract of [
  "merchant_compliance_profiles_plan_code_check",
  "merchant_compliance_profiles_compliance_status_check",
  "merchant_compliance_profiles_activation_status_check",
  "merchant_compliance_profiles_row_version_check",
  "merchant_compliance_profiles_limit_approval_check",
  "merchant_compliance_profiles_plan_entitlement_check",
  "merchant_compliance_reviews_profile_id_fkey",
  "merchant_compliance_events_profile_id_fkey",
]) {
  assert.ok(profileMigration.includes(contract), `canonical profile contract missing: ${contract}`);
}
const workspaceMigration = read("supabase/migrations/20260826_00_canonical_workspace_linkage.sql");
assert.match(workspaceMigration, /FOREIGN KEY \(workspace_id, merchant_id\)[\s\S]+REFERENCES public\.workspaces\(id, merchant_id\)/);
const subscriptionMigration = read("supabase/migrations/20260818025000_paid_subscription_tables_prerequisite.sql");
assert.match(subscriptionMigration, /CONSTRAINT subscriptions_merchant_id_key UNIQUE \(merchant_id\)/);
assert.match(subscriptionMigration, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.subscriptions TO service_role/);

for (const fixedTarget of [
  "$approvedHost = '127.0.0.1'",
  "$approvedPort = '55432'",
  "$approvedUser = 'postgres'",
  "PostgreSQL\\15\\bin\\psql.exe",
  "^CONTROL\\|postgres\\|postgres\\|postgres\\|15[0-9]{4}\\|127\\.0\\.0\\.1\\|55432$",
]) {
  assert.ok(runner.includes(fixedTarget), `runner target control missing: ${fixedTarget}`);
}
assert.match(runner, /ValidatePattern\('\^deraledger_phase2c_b4p_rehearsal_\[a-z0-9_\]\+\$'\)/);
assert.match(runner, /B4P_LOCAL_REHEARSAL_DATABASE_ALREADY_EXISTS/);
assert.match(runner, /'-w','--if-exists',"--maintenance-db=\$maintenanceDatabase",[\s\S]+'-h',\$approvedHost/);
assert.match(runner, /PGPASSWORD[\s\S]+PGPASSFILE/);
assert.match(runner, /function ConvertTo-BoundedDiagnostic/);
assert.match(runner, /function ConvertTo-NativeArgument/);
assert.match(runner, /function Get-NativeFailureDiagnostic/);
assert.match(runner, /NO_NATIVE_DIAGNOSTIC_AVAILABLE/);
assert.match(runner, /password\|pwd[\s\S]+<redacted>/i);
assert.match(runner, /postgres\(\?:ql\)\?:\/\/[\s\S]+<redacted-connection-string>/);
assert.match(runner, /'-v','VERBOSITY=verbose'/);
assert.match(runner, /RedirectStandardOutput = \$true[\s\S]+RedirectStandardError = \$true/);
assert.match(runner, /ReadToEndAsync\(\)[\s\S]+Task\]::WaitAll[\s\S]+\$process\.ExitCode/);
assert.doesNotMatch(runner, /& \$FilePath @Arguments 2>&1/);
assert.match(runner, /B4P_LOCAL_REHEARSAL_COMMAND_FAILED:EXIT_CODE:\$exitCode\|DETAIL:\$safe/);
assert.match(
  runner,
  /\$PrimaryDetail = ConvertTo-BoundedDiagnostic -Detail \$_\.Exception\.Message[\s\S]+B4P_LOCAL_REHEARSAL_PRIMARY_FAILED:\$CurrentStage\|DETAIL:\$PrimaryDetail/,
);
assert.match(runner, /Invoke-NativeChecked[\s\S]+ConvertTo-BoundedDiagnostic -Detail/);

for (const failureChannel of ["$PrimaryFailure", "$CleanupFailure", "$VerificationFailure"]) {
  assert.ok(runner.includes(failureChannel), `failure channel missing: ${failureChannel}`);
}
assert.match(runner, /PRIMARY_FAILURE\|\$PrimaryFailure/);
assert.match(runner, /CLEANUP_FAILURE\|\$CleanupFailure/);
assert.match(runner, /FINAL_VERIFY_FAILURE\|\$VerificationFailure/);
const primaryCatch = runner.indexOf('catch {\n  $PrimaryDetail =');
const unconditionalFinally = runner.indexOf('finally {', primaryCatch);
const finalVerification = runner.indexOf("FINAL_GIT_STASH_VERIFY|PASS", unconditionalFinally);
assert.ok(primaryCatch >= 0 && unconditionalFinally > primaryCatch && finalVerification > unconditionalFinally);
const dropInvocation = runner.indexOf("Invoke-NativeChecked -FilePath $dropdbPath");
const absenceQuery = runner.indexOf("$absenceAfterDrop", dropInvocation);
const droppedPass = runner.indexOf("DATABASE_DROPPED|PASS", dropInvocation);
assert.ok(dropInvocation >= 0 && absenceQuery > dropInvocation && droppedPass > absenceQuery);
assert.match(runner, /pg_catalog\.pg_database[\s\S]+\$absenceAfterDrop\.Count[\s\S]+-ne 'ABSENT'/);
assert.doesNotMatch(runner, /PASS\|DATABASE_DROPPED/);
assert.doesNotMatch(runner + bootstrap + verify, /fsjljliiyfchkwbjifzw|gznwibespgkwknnvbrlv|supabase\.co/);
assert.doesNotMatch(runner + bootstrap + verify, /password\s*=|postgres(?:ql)?:\/\//i);
assert.equal(
  packageJson.scripts["rehearse:phase2c-b4p:local"],
  "powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\rehearse-phase2c-b4p-local.ps1",
);
assert.ok(packageJson.scripts["test:phase2c-b4p"].includes("phase2c-b4p-pre-m031-bootstrap.test.ts"));

console.log("phase2c-b4p-pre-m031-bootstrap.test.ts passed");
