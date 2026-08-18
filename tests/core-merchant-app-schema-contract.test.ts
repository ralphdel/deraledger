import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

type Contract = {
  tables: Record<string, [string, string][]>;
  additive_repairs: Record<string, string[]>;
  excluded_provider_columns: string[];
};

const manifestPath = "supabase/contracts/core_merchant_app_schema.json";
const migrationPath = "supabase/migrations/20260818_01_core_merchant_app_contract_compatibility.sql";
const preflightPath = "supabase/staging/preflight/019_core_merchant_app_schema_contract_check.sql";
const postflightPath = "supabase/staging/postflight/019_core_merchant_app_schema_contract_verify.sql";

function executableSql(source: string) {
  return source
    .replace(/--.*$/gm, "")
    .replace(/'(?:''|[^'])*'/g, "''");
}

async function run() {
  for (const path of [manifestPath, migrationPath, preflightPath, postflightPath]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Contract;
  const migration = readFileSync(migrationPath, "utf8");
  const preflight = readFileSync(preflightPath, "utf8");
  const postflight = readFileSync(postflightPath, "utf8");
  const actions = readFileSync("src/lib/actions.ts", "utf8");

  const expectedTables = [
    "clients", "invoices", "line_items", "references", "item_catalog",
    "discount_templates", "merchants", "workspaces", "merchant_team", "roles",
  ];
  assert.deepEqual(Object.keys(manifest.tables).sort(), expectedTables.sort());

  for (const [table, columns] of Object.entries(manifest.tables)) {
    assert.match(preflight, new RegExp(`\\('${table}'`), `${table} must be checked by preflight.`);
    assert.match(postflight, new RegExp(`\\('${table}'`), `${table} must be checked by postflight.`);
    for (const [column, type] of columns) {
      const specification = `${column}=${type}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(preflight, new RegExp(specification), `Preflight must cover ${table}.${column}.`);
      assert.match(postflight, new RegExp(specification), `Postflight must cover ${table}.${column}.`);
    }
  }

  for (const [table, columns] of Object.entries(manifest.additive_repairs)) {
    for (const column of columns) {
      assert.match(
        migration,
        new RegExp(`ALTER TABLE public\\.${table}[\\s\\S]*?ADD COLUMN IF NOT EXISTS ${column}\\b`),
        `Migration must idempotently repair ${table}.${column}.`,
      );
    }
  }

  const invoiceColumns = new Set(manifest.tables.invoices.map(([column]) => column));
  const createStart = actions.indexOf("export async function createInvoiceAction");
  const createEnd = actions.indexOf("// MANUAL PAYMENTS", createStart);
  const createInvoiceSource = actions.slice(createStart, createEnd);
  for (const payloadColumn of [
    "merchant_id", "client_id", "reference_id", "handled_by", "invoice_number",
    "invoice_type", "invoice_stage", "status", "subtotal", "discount_pct",
    "discount_value", "tax_pct", "tax_value", "grand_total", "amount_paid",
    "outstanding_balance", "fee_absorption", "pay_by_date", "notes", "payment_notes",
    "allow_partial_payment", "partial_payment_pct", "payment_provider", "short_link",
    "qr_code_url",
  ]) {
    assert.match(
      createInvoiceSource,
      new RegExp(`\\b${payloadColumn}(?:\\s*:|\\s*,)`),
      `${payloadColumn} must be present in the createInvoiceAction insert payload.`,
    );
    assert.equal(invoiceColumns.has(payloadColumn), true, `${payloadColumn} must be in the invoice schema contract.`);
  }

  for (const source of [preflight, postflight]) {
    assert.doesNotMatch(source, /^\s*\\(?:set|pset|ir|i)\b/im, "SQL Editor checks must not contain psql meta commands.");
    assert.match(source, /check_name, object_type, expected, actual, status, details/);
    assert.match(source, /SET TRANSACTION READ ONLY/);
    assert.match(source, /ROLLBACK;/);
    assert.doesNotMatch(
      executableSql(source),
      /\b(?:CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|GRANT|REVOKE)\b/i,
      "Preflight/postflight executable SQL must remain read-only.",
    );
  }

  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
  assert.doesNotMatch(migration, /\b(?:DROP TABLE|TRUNCATE|DELETE FROM|UPDATE\s+public\.|INSERT INTO)\b/i);
  assert.doesNotMatch(migration, /ALTER TABLE public\.(?:subscriptions|payment_records|payment_events|payment_providers|merchant_settlement)/i);
  assert.match(migration, /No role rows, subscriptions, provider configuration, or business rows are changed/);

  assert.deepEqual(manifest.excluded_provider_columns.sort(), [
    "invoices.crypto_asset",
    "invoices.crypto_deposit_address",
    "invoices.payment_status",
  ]);

  console.log("core-merchant-app-schema-contract.test.ts passed");
}

void run();
