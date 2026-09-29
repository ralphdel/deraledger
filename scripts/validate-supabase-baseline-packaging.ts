import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type PackagingManifest = {
  schemaVersion: number;
  stagingProjectRef: string;
  productionProjectRef: string;
  officialMigrationDirectory: string;
  allowedAlterBeforeCreate?: Record<string, string[]>;
  requiredCanonicalMigrations?: Record<string, string>;
  workspaceRlsBaseline?: string;
  rootSqlOrder: string[];
  packagePending: string[];
  partialExtractions?: Record<string, string[]>;
  packagedSources: Record<string, string>;
  mustNotPackageAsWritten: string[];
  supersededOrReconciledByOfficialMigrations: string[];
};

export type PackagingAudit = {
  blockers: string[];
  warnings: string[];
  duplicateVersions: Map<string, string[]>;
  duplicateCreateTables: Map<string, string[]>;
  alterBeforeCreate: string[];
};

const normalizeTable = (value: string) =>
  value.replaceAll('"', "").replace(/^public\./i, "").toLowerCase();

export function migrationVersion(file: string): string | null {
  return basename(file).match(/^(\d+)_/)?.[1] ?? null;
}

export function findDuplicateVersions(files: string[]): Map<string, string[]> {
  const byVersion = new Map<string, string[]>();
  for (const file of files) {
    const version = migrationVersion(file);
    if (!version) continue;
    byVersion.set(version, [...(byVersion.get(version) ?? []), basename(file)]);
  }
  return new Map([...byVersion].filter(([, entries]) => entries.length > 1));
}

export function createdTables(sql: string): string[] {
  return [...sql.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:public\.)?"?[a-z_][\w]*"?)/gi)]
    .map((match) => normalizeTable(match[1]));
}

export function alteredTables(sql: string): string[] {
  return [...sql.matchAll(/\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?((?:public\.)?"?[a-z_][\w]*"?)/gi)]
    .map((match) => normalizeTable(match[1]));
}

export function tableOperations(sql: string): Array<{ kind: "create" | "alter"; table: string }> {
  const operations: Array<{ kind: "create" | "alter"; table: string }> = [];
  const pattern = /\b(CREATE)\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:public\.)?"?[a-z_][\w]*"?)(?![\w.])|\b(ALTER)\s+TABLE\s+(?:IF\s+EXISTS\s+)?((?:public\.)?"?[a-z_][\w]*"?)(?![\w.])/gi;
  for (const match of sql.matchAll(pattern)) {
    operations.push({
      kind: match[1] ? "create" : "alter",
      table: normalizeTable(match[2] ?? match[4]),
    });
  }
  return operations;
}

export function auditRepository(
  repoRoot: string,
  manifest: PackagingManifest,
  options: { backupPath?: string; linkedRefFile?: string } = {},
): PackagingAudit {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const supabaseRoot = join(repoRoot, "supabase");
  const migrationRoot = join(repoRoot, manifest.officialMigrationDirectory);
  const rootFiles = readdirSync(supabaseRoot)
    .filter((entry) => entry.toLowerCase().endsWith(".sql") && statSync(join(supabaseRoot, entry)).isFile())
    .sort();
  const classified = new Set([
    ...manifest.packagePending,
    ...Object.keys(manifest.partialExtractions ?? {}),
    ...Object.keys(manifest.packagedSources),
    ...manifest.mustNotPackageAsWritten,
    ...manifest.supersededOrReconciledByOfficialMigrations,
  ]);

  for (const file of manifest.rootSqlOrder) {
    if (!existsSync(join(supabaseRoot, file))) blockers.push(`MISSING_BASELINE_FILE|${file}`);
  }
  for (const file of rootFiles) {
    if (!manifest.rootSqlOrder.includes(file) || !classified.has(file)) {
      blockers.push(`UNCLASSIFIED_ROOT_SQL|${file}`);
    }
  }
  for (const file of manifest.packagePending) {
    blockers.push(`MANUAL_BASELINE_DECISION_REQUIRED|${file}`);
    if (manifest.supersededOrReconciledByOfficialMigrations.includes(file)) {
      blockers.push(`CONFLICTING_BASELINE_DECISION|${file}`);
    }
  }
  for (const [source, destinations] of Object.entries(manifest.partialExtractions ?? {})) {
    if (!manifest.rootSqlOrder.includes(source)) blockers.push(`PARTIAL_BASELINE_SOURCE_UNINVENTORIED|${source}`);
    if (
      !manifest.packagePending.includes(source)
      && !manifest.supersededOrReconciledByOfficialMigrations.includes(source)
    ) {
      blockers.push(`PARTIAL_BASELINE_DECISION_UNCLASSIFIED|${source}`);
    }
    if (destinations.length === 0) blockers.push(`PARTIAL_BASELINE_DESTINATION_MISSING|${source}`);
    for (const destination of destinations) {
      const normalizedDestination = destination.replaceAll("\\", "/");
      const normalizedMigrationRoot = manifest.officialMigrationDirectory.replaceAll("\\", "/").replace(/\/$/, "");
      if (!normalizedDestination.startsWith(`${normalizedMigrationRoot}/`) || !normalizedDestination.endsWith(".sql")) {
        blockers.push(`PARTIAL_BASELINE_DESTINATION_NOT_OFFICIAL_MIGRATION|${source}|${destination}`);
      }
      if (!existsSync(join(repoRoot, destination))) {
        blockers.push(`PARTIAL_BASELINE_MISSING|${source}|${destination}`);
      }
    }
  }
  for (const [source, destination] of Object.entries(manifest.packagedSources)) {
    if (!existsSync(join(repoRoot, destination))) blockers.push(`PACKAGED_BASELINE_MISSING|${source}|${destination}`);
  }
  for (const [contract, migration] of Object.entries(manifest.requiredCanonicalMigrations ?? {})) {
    const normalizedMigration = migration.replaceAll("\\", "/");
    const normalizedMigrationRoot = manifest.officialMigrationDirectory.replaceAll("\\", "/").replace(/\/$/, "");
    if (!normalizedMigration.startsWith(`${normalizedMigrationRoot}/`) || !normalizedMigration.endsWith(".sql")) {
      blockers.push(`CANONICAL_MIGRATION_PATH_INVALID|${contract}|${migration}`);
    } else if (!existsSync(join(repoRoot, migration))) {
      blockers.push(`CANONICAL_MIGRATION_MISSING|${contract}|${migration}`);
    }
  }

  const workspaceRlsBaseline = manifest.workspaceRlsBaseline;
  if (workspaceRlsBaseline) {
    const workspaceRlsBaselinePath = join(repoRoot, workspaceRlsBaseline);
    if (!existsSync(workspaceRlsBaselinePath)) {
      blockers.push(`WORKSPACE_RLS_BASELINE_MISSING|${workspaceRlsBaseline}`);
    } else {
      const workspaceRlsBaselineSql = readFileSync(workspaceRlsBaselinePath, "utf8");
      const workspaceCreate = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(?:public\.)?workspaces\b/i.exec(workspaceRlsBaselineSql);
      const workspaceRlsEnable = /ALTER\s+TABLE\s+public\.workspaces\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/i.exec(workspaceRlsBaselineSql);
      const createsBeforeEnablingRls = Boolean(
        workspaceCreate && workspaceRlsEnable && workspaceRlsEnable.index > workspaceCreate.index,
      );
      if (!createsBeforeEnablingRls) {
        blockers.push(`WORKSPACE_RLS_BASELINE_CONTRACT_MISSING|${workspaceRlsBaseline}`);
      }
    }
  }

  const migrationFiles = readdirSync(migrationRoot)
    .filter((entry) => entry.toLowerCase().endsWith(".sql"))
    .sort();

  const storageMigration = manifest.requiredCanonicalMigrations?.privateEvidenceStorage;
  if (storageMigration && existsSync(join(repoRoot, storageMigration))) {
    const storageSql = readFileSync(join(repoRoot, storageMigration), "utf8");
    const requiredStorageFragments = [
      "'kyc-documents'",
      "'dispute-evidence'",
      "storage.buckets",
      "storage.objects",
      "FALSE, 10485760",
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
    ];
    for (const fragment of requiredStorageFragments) {
      if (!storageSql.includes(fragment)) blockers.push(`PRIVATE_EVIDENCE_STORAGE_CONTRACT_MISSING|${fragment}`);
    }
    if (/\bCREATE\s+POLICY\b/i.test(storageSql)) {
      blockers.push("PRIVATE_EVIDENCE_BROWSER_POLICY_PRESENT");
    }

    const disputePagePath = join(repoRoot, "src/app/(dashboard)/dashboard/disputes/[id]/page.tsx");
    const adminDisputePagePath = join(repoRoot, "src/app/(admin)/admin/disputes/[id]/page.tsx");
    const disputeRoutePath = join(repoRoot, "src/app/api/merchant/disputes/[id]/evidence/route.ts");
    if (!existsSync(disputePagePath) || !existsSync(adminDisputePagePath) || !existsSync(disputeRoutePath)) {
      blockers.push("PRIVATE_DISPUTE_EVIDENCE_RUNTIME_MISSING");
    } else {
      const disputePage = readFileSync(disputePagePath, "utf8");
      const adminDisputePage = readFileSync(adminDisputePagePath, "utf8");
      const disputeRoute = readFileSync(disputeRoutePath, "utf8");
      if (/getPublicUrl|\.from\(["']kyc-documents["']\)[\s\S]{0,160}\.upload/i.test(disputePage)) {
        blockers.push("PRIVATE_DISPUTE_EVIDENCE_BROWSER_BYPASS_PRESENT");
      }
      if (!adminDisputePage.includes(`/api/merchant/disputes/\${encodeURIComponent(id)}/evidence`)) {
        blockers.push("PRIVATE_DISPUTE_EVIDENCE_ADMIN_SIGNED_READ_MISSING");
      }
      for (const fragment of [
        "resolveMerchantContextForUser",
        "assertSameOriginBrowserMutationRequest",
        "createSignedUrl",
        "DISPUTE_EVIDENCE_BUCKET",
      ]) {
        if (!disputeRoute.includes(fragment)) blockers.push(`PRIVATE_DISPUTE_EVIDENCE_ROUTE_CONTRACT_MISSING|${fragment}`);
      }
    }
  }

  const paidSubscriptionMigration = manifest.requiredCanonicalMigrations?.paidSubscriptionTablesPrerequisite;
  if (paidSubscriptionMigration && existsSync(join(repoRoot, paidSubscriptionMigration))) {
    const paidSubscriptionSql = readFileSync(join(repoRoot, paidSubscriptionMigration), "utf8");
    const requiredSubscriptionFragments = [
      "CREATE TABLE IF NOT EXISTS public.subscriptions",
      "merchant_id UUID NOT NULL",
      "plan_type TEXT NOT NULL",
      "amount_paid NUMERIC(10,2) NOT NULL",
      "start_date TIMESTAMPTZ NOT NULL",
      "expiry_date TIMESTAMPTZ NOT NULL",
      "status TEXT NOT NULL DEFAULT 'active'",
      "last_notified_at TIMESTAMPTZ",
      "is_banner_dismissed BOOLEAN NOT NULL DEFAULT false",
      "updated_at TIMESTAMPTZ NOT NULL DEFAULT now()",
      "CONSTRAINT subscriptions_merchant_id_key UNIQUE (merchant_id)",
      "ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY",
    ];
    for (const fragment of requiredSubscriptionFragments) {
      if (!paidSubscriptionSql.includes(fragment)) {
        blockers.push(`PAID_SUBSCRIPTION_PREREQUISITE_CONTRACT_MISSING|${fragment}`);
      }
    }
    if (/\b(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE|DROP)\b/i.test(paidSubscriptionSql)) {
      blockers.push("PAID_SUBSCRIPTION_PREREQUISITE_MUTATION_PRESENT");
    }

    const migration020 = "20260818020000_paid_flow_subscription_payments_compatibility.sql";
    const migration021 = "20260818030000_paid_upgrade_atomic_confirmation.sql";
    const prerequisiteFile = basename(paidSubscriptionMigration);
    const orderedIndices = [migration020, prerequisiteFile, migration021].map((file) => migrationFiles.indexOf(file));
    if (orderedIndices.some((index) => index < 0) || !(orderedIndices[0] < orderedIndices[1] && orderedIndices[1] < orderedIndices[2])) {
      blockers.push("PAID_SUBSCRIPTION_PREREQUISITE_ORDER_INVALID");
    } else {
      const paymentLedgerSql = readFileSync(join(migrationRoot, migration020), "utf8");
      const confirmationSql = readFileSync(join(migrationRoot, migration021), "utf8");
      if (!paymentLedgerSql.includes("CREATE TABLE IF NOT EXISTS public.subscription_payments")
        || !paymentLedgerSql.includes("CONSTRAINT subscription_payments_paystack_ref_key UNIQUE (paystack_ref)")) {
        blockers.push("PAID_SUBSCRIPTION_PAYMENT_LEDGER_CONTRACT_MISSING");
      }
      if (!confirmationSql.includes("'subscriptions', 'subscription_payments'")
        || !confirmationSql.includes("subscriptions.merchant_id must be unique")
        || !confirmationSql.includes("subscription_payments.paystack_ref must be unique")) {
        blockers.push("MIGRATION_021_SUBSCRIPTION_PREREQUISITE_CONTRACT_MISSING");
      }
    }
  }
  for (const file of manifest.mustNotPackageAsWritten) {
    warnings.push(`MUST_NOT_PACKAGE_AS_WRITTEN|${file}`);
  }

  const duplicateVersions = findDuplicateVersions(migrationFiles);
  for (const [version, files] of duplicateVersions) {
    blockers.push(`DUPLICATE_MIGRATION_VERSION|${version}|${files.join(",")}`);
  }

  const createLocations = new Map<string, string[]>();
  for (const relative of [
    ...rootFiles.map((file) => join("supabase", file)),
    ...migrationFiles.map((file) => join(manifest.officialMigrationDirectory, file)),
  ]) {
    const sql = readFileSync(join(repoRoot, relative), "utf8");
    for (const table of new Set(createdTables(sql))) {
      createLocations.set(table, [...(createLocations.get(table) ?? []), relative.replaceAll("\\", "/")]);
    }
  }
  const duplicateCreateTables = new Map(
    [...createLocations].filter(([, files]) => files.length > 1),
  );
  for (const [table, files] of duplicateCreateTables) {
    warnings.push(`DUPLICATE_CREATE_TABLE_RISK|${table}|${files.join(",")}`);
  }

  const seen = new Set(["users", "objects", "buckets"]);
  const alterBeforeCreate: string[] = [];
  for (const file of migrationFiles) {
    const fullPath = join(migrationRoot, file);
    const sql = readFileSync(fullPath, "utf8");
    for (const operation of tableOperations(sql)) {
      if (operation.kind === "create") seen.add(operation.table);
      else if (!seen.has(operation.table)) {
        const allowed = manifest.allowedAlterBeforeCreate?.[file] ?? [];
        if (allowed.includes(operation.table)) warnings.push(`GUARDED_PRECREATE_ALTER|${file}|${operation.table}`);
        else alterBeforeCreate.push(`${file}|${operation.table}`);
      }
    }
  }
  for (const finding of new Set(alterBeforeCreate)) blockers.push(`ALTER_BEFORE_DETECTABLE_CREATE|${finding}`);

  if (!existsSync(join(supabaseRoot, "config.toml"))) blockers.push("SUPABASE_CONFIG_MISSING");

  if (options.backupPath) {
    const backupPath = resolve(repoRoot, options.backupPath);
    if (!existsSync(backupPath) || statSync(backupPath).size === 0) blockers.push("STAGING_BACKUP_MISSING_OR_EMPTY");
  } else {
    blockers.push("STAGING_BACKUP_NOT_PROVIDED");
  }

  const linkedRefFile = resolve(repoRoot, options.linkedRefFile ?? "supabase/.temp/project-ref");
  if (!existsSync(linkedRefFile)) {
    blockers.push("LINKED_PROJECT_REF_MISSING");
  } else {
    const linkedRef = readFileSync(linkedRefFile, "utf8").trim();
    if (linkedRef === manifest.productionProjectRef) blockers.push("PRODUCTION_REF_LINKED");
    else if (linkedRef !== manifest.stagingProjectRef) blockers.push("LINKED_PROJECT_REF_MISMATCH");
  }

  return { blockers, warnings, duplicateVersions, duplicateCreateTables, alterBeforeCreate };
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function runCli() {
  const repoRoot = resolve(optionValue("--repo") ?? process.cwd());
  const manifestPath = join(repoRoot, "supabase/baseline-packaging-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackagingManifest;
  const audit = auditRepository(repoRoot, manifest, {
    backupPath: optionValue("--backup"),
    linkedRefFile: optionValue("--linked-ref-file"),
  });
  console.log(`PASS|TARGET_GUARD|staging=${manifest.stagingProjectRef}|production_blocked=${manifest.productionProjectRef}`);
  for (const warning of audit.warnings) console.log(`WARN|${warning}`);
  for (const blocker of audit.blockers) console.log(`BLOCKED|${blocker}`);
  console.log(`VERDICT=${audit.blockers.length === 0 ? "READY_FOR_STAGING_REFRESH" : "BLOCKED"}`);
  process.exitCode = audit.blockers.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) runCli();
