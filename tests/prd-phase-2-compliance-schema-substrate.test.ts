import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const migrationPath = "supabase/migrations/20260820_00_prd_phase_2_compliance_schema_substrate.sql";
const preflightPath = "supabase/staging/preflight/024_prd_phase_2_compliance_schema_substrate_snapshot.sql";
const postflightPath = "supabase/staging/postflight/024_prd_phase_2_compliance_schema_substrate_verify.sql";

const tables = {
  merchant_compliance_profiles: [
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
  ],
  merchant_compliance_reviews: [
    "id", "merchant_id", "profile_id", "review_type", "target_plan_code", "review_status",
    "evidence_snapshot", "decision_reason_code", "decision_notes", "policy_version",
    "submitted_at", "reviewed_at", "reviewed_by", "idempotency_key", "row_version",
    "created_at", "updated_at",
  ],
  merchant_compliance_events: [
    "id", "merchant_id", "profile_id", "event_type", "from_state", "to_state",
    "reason_code", "notes", "actor_type", "actor_id", "source_type", "source_id",
    "policy_version", "idempotency_key", "expected_row_version", "resulting_row_version",
    "metadata", "created_at",
  ],
  merchant_collection_limit_windows: [
    "id", "merchant_id", "profile_id", "window_type", "window_key", "window_start",
    "window_end", "policy_timezone", "limit_amount", "committed_amount", "reserved_amount",
    "policy_version", "row_version", "created_at", "updated_at",
  ],
  merchant_collection_limit_reservations: [
    "id", "merchant_id", "profile_id", "invoice_id", "payment_record_id", "source_type",
    "source_id", "internal_reference", "idempotency_key", "amount", "currency", "status",
    "reserved_at", "expires_at", "committed_at", "released_at", "release_reason_code",
    "provider_reference", "row_version", "created_at", "updated_at",
  ],
  merchant_collection_limit_reservation_windows: [
    "reservation_id", "window_id", "amount", "created_at",
  ],
  merchant_collection_usage_events: [
    "id", "merchant_id", "profile_id", "window_id", "reservation_id", "payment_record_id",
    "event_type", "direction", "amount", "currency", "internal_reference",
    "provider_reference", "idempotency_key", "actor_type", "actor_id", "reason_code",
    "metadata", "created_at",
  ],
} as const;

const canonicalIndexes = [
  "uq_merchant_compliance_profiles_merchant_id",
  "idx_merchant_compliance_profiles_decision_state",
  "uq_merchant_compliance_reviews_idempotency",
  "idx_merchant_compliance_reviews_queue",
  "uq_merchant_compliance_events_idempotency",
  "idx_merchant_compliance_events_timeline",
  "uq_merchant_collection_limit_windows_identity",
  "idx_merchant_collection_limit_windows_active",
  "uq_merchant_collection_reservations_reference",
  "uq_merchant_collection_reservations_idempotency",
  "idx_merchant_collection_reservations_expiry",
  "merchant_collection_limit_reservation_windows_pkey",
  "uq_merchant_collection_usage_events_idempotency",
  "idx_merchant_collection_usage_events_timeline",
] as const;

const foreignKeys = [
  ["merchant_compliance_profiles_merchant_id_fkey", "merchant_id", "merchants", "id"],
  ["merchant_compliance_reviews_merchant_id_fkey", "merchant_id", "merchants", "id"],
  ["merchant_compliance_reviews_profile_id_fkey", "profile_id", "merchant_compliance_profiles", "id"],
  ["merchant_compliance_events_merchant_id_fkey", "merchant_id", "merchants", "id"],
  ["merchant_compliance_events_profile_id_fkey", "profile_id", "merchant_compliance_profiles", "id"],
  ["merchant_collection_limit_windows_merchant_id_fkey", "merchant_id", "merchants", "id"],
  ["merchant_collection_limit_windows_profile_id_fkey", "profile_id", "merchant_compliance_profiles", "id"],
  ["merchant_collection_limit_reservations_merchant_id_fkey", "merchant_id", "merchants", "id"],
  ["merchant_collection_limit_reservations_profile_id_fkey", "profile_id", "merchant_compliance_profiles", "id"],
  ["merchant_collection_limit_reservations_invoice_id_fkey", "invoice_id", "invoices", "id"],
  ["merchant_collection_limit_reservations_payment_record_id_fkey", "payment_record_id", "payment_records", "id"],
  ["merchant_collection_res_windows_reservation_id_fkey", "reservation_id", "merchant_collection_limit_reservations", "id"],
  ["merchant_collection_limit_reservation_windows_window_id_fkey", "window_id", "merchant_collection_limit_windows", "id"],
  ["merchant_collection_usage_events_merchant_id_fkey", "merchant_id", "merchants", "id"],
  ["merchant_collection_usage_events_profile_id_fkey", "profile_id", "merchant_compliance_profiles", "id"],
  ["merchant_collection_usage_events_window_id_fkey", "window_id", "merchant_collection_limit_windows", "id"],
  ["merchant_collection_usage_events_reservation_id_fkey", "reservation_id", "merchant_collection_limit_reservations", "id"],
  ["merchant_collection_usage_events_payment_record_id_fkey", "payment_record_id", "payment_records", "id"],
] as const;

const exactIndexDefinitions = [
  /idx_merchant_compliance_profiles_decision_state[\s\S]*?\(merchant_id, plan_code, compliance_status, activation_status, restriction_state\)/,
  /uq_merchant_compliance_reviews_idempotency UNIQUE \(merchant_id, idempotency_key\)/,
  /idx_merchant_compliance_reviews_queue[\s\S]*?\(review_type, review_status, created_at\)/,
  /uq_merchant_compliance_events_idempotency UNIQUE \(merchant_id, idempotency_key\)/,
  /idx_merchant_compliance_events_timeline[\s\S]*?\(merchant_id, created_at\)/,
  /uq_merchant_collection_limit_windows_identity[\s\S]*?UNIQUE \(merchant_id, window_type, window_key, policy_version\)/,
  /idx_merchant_collection_limit_windows_active[\s\S]*?\(merchant_id, window_type, window_start, window_end\)/,
  /uq_merchant_collection_reservations_reference UNIQUE \(merchant_id, internal_reference\)/,
  /uq_merchant_collection_reservations_idempotency UNIQUE \(merchant_id, idempotency_key\)/,
  /idx_merchant_collection_reservations_expiry[\s\S]*?\(status, expires_at\)/,
  /merchant_collection_limit_reservation_windows_pkey PRIMARY KEY \(reservation_id, window_id\)/,
  /uq_merchant_collection_usage_events_idempotency[\s\S]*?UNIQUE \(merchant_id, window_id, idempotency_key\)/,
  /idx_merchant_collection_usage_events_timeline[\s\S]*?\(merchant_id, created_at\)/,
] as const;

const appliedMigrations = [
  "supabase/migrations/20260818_00_core_merchant_schema_compatibility.sql",
  "supabase/migrations/20260818_01_core_merchant_app_contract_compatibility.sql",
  "supabase/migrations/20260818_02_paid_flow_subscription_payments_compatibility.sql",
  "supabase/migrations/20260818_03_paid_upgrade_atomic_confirmation.sql",
  "supabase/migrations/20260819_00_merchant_business_address_compatibility.sql",
  "supabase/migrations/20260819_01_merchant_settings_profile_compatibility.sql",
] as const;

function stripSqlCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\r\n]*/g, " ")
    .replace(/'(?:''|[^'])*'/g, "''");
}

function tableBody(source: string, table: string): string {
  const startToken = `CREATE TABLE IF NOT EXISTS public.${table} (`;
  const start = source.indexOf(startToken);
  assert.notEqual(start, -1, `${table} CREATE TABLE should exist.`);

  let depth = 0;
  for (let index = start + startToken.length - 1; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    if (source[index] === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(start + startToken.length, index);
    }
  }
  assert.fail(`${table} CREATE TABLE should have balanced parentheses.`);
}

function assertBalancedParentheses(source: string, label: string) {
  const executable = stripSqlCommentsAndStrings(source);
  let depth = 0;
  for (const character of executable) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    assert.ok(depth >= 0, `${label} should not close a parenthesis before it is opened.`);
  }
  assert.equal(depth, 0, `${label} should have balanced parentheses.`);
}

async function run() {
  for (const path of [migrationPath, preflightPath, postflightPath]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  const migration = readFileSync(migrationPath, "utf8");
  const preflight = readFileSync(preflightPath, "utf8");
  const postflight = readFileSync(postflightPath, "utf8");
  const executableMigration = stripSqlCommentsAndStrings(migration);

  assertBalancedParentheses(migration, "Migration 024");
  assertBalancedParentheses(preflight, "Migration 024 preflight");
  assertBalancedParentheses(postflight, "Migration 024 postflight");

  assert.match(migration, /^BEGIN;[\s\S]*COMMIT;\s*$/m);
  assert.equal((migration.match(/\$migration_024_prerequisites\$/g) ?? []).length, 2);
  assert.equal((migration.match(/\$migration_024_postconditions\$/g) ?? []).length, 2);
  assert.match(migration, /SET LOCAL statement_timeout = '60s'/);
  assert.match(migration, /SET LOCAL lock_timeout = '5s'/);
  assert.match(migration, /NOTIFY pgrst, 'reload schema';/);
  assert.match(migration, /relforcerowsecurity/);
  assert.match(migration, /pg_trigger/);
  assert.match(migration, /attacl IS NOT NULL/);
  assert.match(migration, /index_state\.indnkeyatts = 1/);
  assert.match(preflight, /actual\.contype::text = 'c' AND actual\.connoinherit/);
  assert.match(postflight, /constraint_state\.contype::text <> 'c' OR NOT constraint_state\.connoinherit/);
  assert.doesNotMatch(executableMigration, /\b(?:INSERT\s+INTO|UPDATE\s+(?:ONLY\s+)?public\.|DELETE\s+FROM|TRUNCATE\s+(?:TABLE\s+)?public\.|DROP\s+)\b/i);
  assert.doesNotMatch(executableMigration, /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i);
  assert.doesNotMatch(executableMigration, /\bCREATE\s+POLICY\b/i);
  assert.doesNotMatch(executableMigration, /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TRIGGER|VIEW|MATERIALIZED\s+VIEW|TYPE|SEQUENCE|SCHEMA)\b/i);
  assert.doesNotMatch(executableMigration, /\bON\s+DELETE\s+(?:CASCADE|SET\s+NULL|SET\s+DEFAULT)\b/i);
  assert.doesNotMatch(executableMigration, /ALTER TABLE public\.(?:merchants|workspaces|subscriptions|workspace_subscriptions|payment_records|invoices)\b/i);
  assert.doesNotMatch(executableMigration, /\b(?:setup_mode|live_features_enabled|verification_status)\b/i);

  const createdTables = [...migration.matchAll(/CREATE TABLE IF NOT EXISTS public\.([a-z_]+)/g)].map((match) => match[1]);
  assert.deepEqual(createdTables.sort(), Object.keys(tables).sort(), "Migration 024 must create exactly seven approved tables.");
  assert.equal((migration.match(/CREATE INDEX IF NOT EXISTS /g) ?? []).length, 6);
  assert.doesNotMatch(migration, /CREATE (?:UNIQUE )?INDEX (?!IF NOT EXISTS)/);
  assert.doesNotMatch(migration, /ALTER TABLE public\.[a-z_]+\s+ADD\b/i);

  for (const [table, columns] of Object.entries(tables)) {
    const body = tableBody(migration, table);
    const declaredColumns = [...body.matchAll(/^\s{2}([a-z_][a-z0-9_]*)\s+(?:uuid|text|jsonb|boolean|bigint|numeric\(18,2\)|timestamp with time zone)(?=\s|,)/gm)]
      .map((match) => match[1]);
    assert.deepEqual(declaredColumns, [...columns], `${table} should match the exact approved ordered column manifest.`);
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`));
    assert.match(migration, new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM PUBLIC, anon, authenticated, service_role;`));
    assert.doesNotMatch(migration, new RegExp(`GRANT[^;]*\\bDELETE\\b[^;]*public\\.${table}`, "i"));
  }

  assert.equal((migration.match(/ENABLE ROW LEVEL SECURITY;/g) ?? []).length, 7);
  assert.equal((migration.match(/REVOKE ALL ON TABLE public\./g) ?? []).length, 7);
  assert.equal((migration.match(/ON DELETE RESTRICT/g) ?? []).length, 18, "Every one of the 18 foreign keys must be restricted.");
  const explicitIdentifiers = [
    ...migration.matchAll(/\bCONSTRAINT\s+([a-z_][a-z0-9_]*)/gi),
    ...migration.matchAll(/\bCREATE(?:\s+UNIQUE)?\s+INDEX\s+IF\s+NOT\s+EXISTS\s+([a-z_][a-z0-9_]*)/gi),
  ].map((match) => match[1]);
  for (const identifier of explicitIdentifiers) {
    assert.ok(
      Buffer.byteLength(identifier, "utf8") <= 63,
      `${identifier} exceeds PostgreSQL's 63-byte identifier limit and would be silently truncated.`,
    );
  }
  assert.doesNotMatch(migration, /numeric\((?!18,2\))/i);
  assert.match(migration, /policy_timezone text NOT NULL DEFAULT 'Africa\/Lagos'/);
  assert.match(migration, /CHECK \(policy_timezone = 'Africa\/Lagos'\)/);
  assert.match(migration, /restriction_state text,/);
  assert.doesNotMatch(migration, /restriction_state text[^,\n]*DEFAULT/i);
  assert.match(migration, /currency text NOT NULL DEFAULT 'NGN'[\s\S]*?CHECK \(currency = 'NGN'\)/);

  for (const [constraintName, localColumn, referencedTable, referencedColumn] of foreignKeys) {
    assert.match(
      migration,
      new RegExp(`CONSTRAINT ${constraintName}\\s+FOREIGN KEY \\(${localColumn}\\) REFERENCES public\\.${referencedTable}\\(${referencedColumn}\\) ON DELETE RESTRICT`),
    );
    const manifestRow = new RegExp(`\\('${constraintName}'(?:::[a-z]+)?[^\\n]*'${localColumn}'(?:::[a-z]+)?[^\\n]*'${referencedTable}'(?:::[a-z]+)?[^\\n]*'${referencedColumn}'(?:::[a-z]+)?\\)`);
    assert.match(preflight, manifestRow);
    assert.match(postflight, manifestRow);
  }

  for (const definition of exactIndexDefinitions) assert.match(migration, definition);

  const semanticChecks = [
    /plan_code IN \('starter', 'solo_lite', 'solo_plus', 'business'\)/,
    /compliance_status IN \([\s\S]*?'lite_verified'[\s\S]*?'enhanced_verified'[\s\S]*?'business_verified'[\s\S]*?'rejected'/,
    /activation_status IN \([\s\S]*?'test_mode'[\s\S]*?'approved'[\s\S]*?'suspended'/,
    /risk_rating IS NULL OR risk_rating IN \('low', 'medium', 'high', 'restricted'\)/,
    /restriction_state IS NULL OR restriction_state IN \('active', 'restricted', 'suspended'\)/,
    /hidden_daily_velocity_limit IS NULL OR hidden_daily_velocity_limit > 0/,
    /single_transaction_limit IS NULL OR single_transaction_limit > 0/,
    /NOT collection_limit_approved OR[\s\S]*?collection_limit_basis <> 'none'[\s\S]*?limits_approved_by IS NOT NULL/,
    /NOT can_use_receivable_sale OR can_collect_payments/,
    /NOT can_use_deposit_balance OR can_use_receivable_sale/,
    /plan_code NOT IN \('starter', 'solo_lite'\)/,
    /review_type = 'solo_lite' AND target_plan_code = 'solo_lite'/,
    /review_type = 'business_kyb' AND target_plan_code = 'business'/,
    /actor_type IN \('system', 'admin', 'merchant', 'reconciliation'\)/,
    /window_type IN \('cumulative', 'monthly', 'daily_velocity', 'outstanding_receivable'\)/,
    /window_type = 'cumulative' AND window_end IS NULL/,
    /window_type <> 'cumulative' AND window_end IS NOT NULL AND window_end > window_start/,
    /source_type IN \('invoice', 'storefront_order', 'receivable'\)/,
    /status IN \('reserved', 'committed', 'released', 'expired', 'reversed'\)/,
    /event_type IN \([\s\S]*?'collection_committed'[\s\S]*?'manual_correction'/,
    /direction IN \('debit', 'credit'\)/,
    /actor_type IN \('system', 'admin', 'reconciliation'\)/,
  ] as const;
  for (const semanticCheck of semanticChecks) assert.match(migration, semanticCheck);

  for (const indexName of canonicalIndexes) {
    assert.match(migration, new RegExp(`\\b${indexName}\\b`));
    assert.match(preflight, new RegExp(`\\b${indexName}\\b`));
    assert.match(postflight, new RegExp(`\\b${indexName}\\b`));
  }
  assert.match(preflight, /actual\.index_name IS NOT NULL AND actual\.table_name <> expected\.table_name THEN 'FAIL'/);
  assert.match(migration, /index_state\.tablename = expected_index\.table_name/);

  const constraintNames = [...migration.matchAll(/\bCONSTRAINT\s+([a-z_][a-z0-9_]*)/g)].map((match) => match[1]);
  assert.ok(constraintNames.length > 70, "The complete row-local, key, and FK constraint contract should be present.");
  const expectedConstraintsStart = preflight.indexOf("expected_constraints(");
  const expectedConstraintsEnd = preflight.indexOf("), expected_foreign_keys(", expectedConstraintsStart);
  assert.ok(expectedConstraintsStart >= 0 && expectedConstraintsEnd > expectedConstraintsStart);
  const expectedConstraintsBlock = preflight.slice(expectedConstraintsStart, expectedConstraintsEnd);
  for (const constraintName of constraintNames) {
    const declaration = migration.match(new RegExp(`CONSTRAINT ${constraintName}\\s+(PRIMARY KEY|UNIQUE|FOREIGN KEY|CHECK)`));
    assert.ok(declaration, `${constraintName} should have a recognized constraint type.`);
    const constraintType = ({ "PRIMARY KEY": "p", UNIQUE: "u", "FOREIGN KEY": "f", CHECK: "c" } as const)[declaration[1] as "PRIMARY KEY" | "UNIQUE" | "FOREIGN KEY" | "CHECK"];
    assert.match(expectedConstraintsBlock, new RegExp(`'${constraintName}'[^\\n]*'${constraintType}'`), `Preflight should type-check ${constraintName}.`);
    assert.match(postflight, new RegExp(`${constraintName}:${constraintType}`), `Postflight fingerprint should include ${constraintName}.`);
  }

  const exactGrants = new Map<string, string>([
    ["merchant_compliance_profiles", "SELECT, INSERT, UPDATE"],
    ["merchant_compliance_reviews", "SELECT, INSERT, UPDATE"],
    ["merchant_compliance_events", "SELECT, INSERT"],
    ["merchant_collection_limit_windows", "SELECT, INSERT, UPDATE"],
    ["merchant_collection_limit_reservations", "SELECT, INSERT, UPDATE"],
    ["merchant_collection_limit_reservation_windows", "SELECT, INSERT"],
    ["merchant_collection_usage_events", "SELECT, INSERT"],
  ]);
  for (const [table, privileges] of exactGrants) {
    assert.match(migration, new RegExp(`GRANT ${privileges} ON TABLE public\\.${table} TO service_role;`));
  }

  for (const appendOnlyTable of [
    "merchant_compliance_events",
    "merchant_collection_limit_reservation_windows",
    "merchant_collection_usage_events",
  ]) {
    const grant = migration.match(new RegExp(`GRANT ([^;]+) ON TABLE public\\.${appendOnlyTable} TO service_role;`));
    assert.ok(grant);
    assert.equal(grant[1], "SELECT, INSERT", `${appendOnlyTable} must be append-only by grant.`);
  }

  for (const source of [preflight, postflight]) {
    const executable = stripSqlCommentsAndStrings(source);
    assert.match(source, /SET TRANSACTION READ ONLY;/);
    assert.match(source, /ROLLBACK;/);
    assert.doesNotMatch(source, /^\s*\\(?:set|pset|ir|i)\b/im);
    assert.doesNotMatch(executable, /\b(?:CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|GRANT|REVOKE|NOTIFY)\b/i);
    assert.match(source, /check_name, object_type, expected, actual, status, details/);
    assert.match(source, /pg_default_acl/);
    assert.match(source, /acl\.grantee = 0/);
    assert.match(source, /PUBLIC/);
    assert.match(source, /anon/);
    assert.match(source, /authenticated/);
    assert.match(source, /relforcerowsecurity/);
    assert.match(source, /pg_trigger/);
    assert.match(source, /attacl IS NOT NULL/);
    assert.match(source, /indpred IS NULL/);
    assert.match(source, /indexprs IS NULL/);
    assert.match(source, /indisvalid/);
    assert.match(source, /indisready/);
    assert.match(source, /index_state\.indnkeyatts = 1/);
    assert.match(source, /convalidated/);
    assert.match(source, /confdeltype::text/);
    assert.match(source, /confupdtype::text/);
    assert.match(source, /confmatchtype::text/);
    assert.match(source, /summary\.overall/);
    assert.match(source, /FROM report/);
    for (const [table, columns] of Object.entries(tables)) {
      assert.match(source, new RegExp(`\\b${table}\\b`));
      for (const column of columns) {
        assert.match(source, new RegExp(`\\b${column}\\b`), `${source === preflight ? "preflight" : "postflight"} should cover ${table}.${column}.`);
      }
    }
  }

  assert.match(preflight, /WHEN relation_oid IS NULL THEN 'WARN'/);
  assert.match(preflight, /WHEN relation_oid IS NULL THEN 'WARN' ELSE 'FAIL' END/);
  assert.match(preflight, /partially invented table; stop and investigate/i);
  assert.match(preflight, /hostile table default is reported/i);
  assert.match(preflight, /xpath\('\/\/row\/count\/text\(\)'/);
  assert.match(postflight, /Zero policies is PASS/i);
  assert.match(postflight, /Migration 024 creates no substrate rows/i);
  assert.match(postflight, /explicit per-table REVOKE/i);
  assert.match(postflight, /all exact schema, security, and empty-substrate checks passed/i);

  const protectedDiff = spawnSync("git", ["diff", "--quiet", "HEAD", "--", ...appliedMigrations], {
    encoding: "utf8",
  });
  assert.equal(protectedDiff.status, 0, `Applied migrations 018-023 must remain untouched. ${protectedDiff.stderr}`);

  console.log("prd-phase-2-compliance-schema-substrate.test.ts passed");
}

void run();
