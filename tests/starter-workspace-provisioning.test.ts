import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createSupabaseStarterWorkspaceRepository,
  getStarterProvisioningLogPayload,
  provisionStarterSignup,
  repairAuthenticatedStarterWorkspace,
  StarterProvisioningError,
  type StarterAuthAdmin,
  type StarterAuthUser,
  type StarterMerchantRecord,
  type StarterWorkspaceRepository,
} from "../src/lib/services/starter-workspace.service";
import {
  isRecoverableStarterUser,
  requestStarterWorkspaceRecovery,
} from "../src/lib/starter-workspace-recovery";

type Row = Record<string, unknown>;

const starterUser: StarterAuthUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "starter@example.test",
  user_metadata: {
    plan: "starter",
    business_name: "Starter Limited",
  },
};

class MemoryStarterRepository implements StarterWorkspaceRepository {
  merchants: StarterMerchantRecord[] = [];
  workspaces = new Map<string, string>();
  roles = new Map([
    ["admin", "admin-role-id"],
    ["accountant", "accountant-role-id"],
    ["viewer", "viewer-role-id"],
  ]);
  insertCount = 0;
  workspaceInsertCount = 0;
  workspaceEnsureCount = 0;
  creatorMembershipEnsureCount = 0;
  lastInsert: Record<string, unknown> | null = null;
  lastWorkspaceInput: (Parameters<StarterWorkspaceRepository["ensureWorkspace"]>[0]) | null = null;

  async findMerchantByUserId(userId: string) {
    return this.merchants.find((merchant) => merchant.user_id === userId) || null;
  }

  async findMerchantById(merchantId: string) {
    return this.merchants.find((merchant) => merchant.id === merchantId) || null;
  }

  async insertMerchant(values: Record<string, unknown>) {
    this.insertCount += 1;
    this.lastInsert = values;
    const id = String(values.id);
    if (this.merchants.some((merchant) => merchant.id === id)) {
      return { merchant: null, error: { code: "23505", message: "duplicate key" } };
    }
    const merchant = { id, user_id: String(values.user_id) };
    this.merchants.push(merchant);
    return { merchant, error: null };
  }

  async findCreatorRoleId() {
    return this.roles.get("admin") || null;
  }

  async upsertCreatorMembership() {
    this.creatorMembershipEnsureCount += 1;
  }

  async ensureWorkspace(input: Parameters<StarterWorkspaceRepository["ensureWorkspace"]>[0]) {
    this.workspaceEnsureCount += 1;
    this.lastWorkspaceInput = input;
    const existing = this.workspaces.get(input.merchantId);
    if (existing) return existing;
    this.workspaceInsertCount += 1;
    const workspaceId = input.merchantId;
    this.workspaces.set(input.merchantId, workspaceId);
    return workspaceId;
  }
}

class ProductionSchemaSupabaseClient {
  tables = new Map<string, Row[]>([
    ["merchants", []],
    ["workspaces", []],
    ["merchant_team", []],
    ["roles", [
      { id: "admin-role-id", name: "admin" },
      { id: "accountant-role-id", name: "accountant" },
      { id: "viewer-role-id", name: "viewer" },
    ]],
  ]);

  columns = new Map<string, Set<string>>([
    ["merchants", new Set([
      "id", "user_id", "business_name", "email", "phone", "logo_url",
      "fee_absorption_default", "verification_status", "merchant_tier",
      "kyc_submitted_at", "kyc_notes", "monthly_collection_limit",
      "holds_pending_review", "created_at", "updated_at", "subscription_plan",
      "workspace_id", "workspace_type", "onboarding_status", "setup_mode",
      "live_features_enabled", "verification_disclosure_acknowledged_at",
      "verification_disclosure_version", "relationship_claim",
      "business_registry_snapshot_id", "business_affiliation_status",
      "paid_setup_started_at", "live_features_activated_at", "is_super_admin",
      "workspace_code",
    ])],
    ["workspaces", new Set([
      "id", "owner_user_id", "merchant_id", "workspace_type", "display_name",
      "plan_type", "onboarding_status", "kyc_status", "kyb_status",
      "affiliation_status", "setup_mode", "live_features_enabled", "created_at",
      "updated_at",
    ])],
    ["merchant_team", new Set([
      "id", "merchant_id", "user_id", "role_id", "is_active", "invited_by",
      "added_at", "last_active_at", "must_change_password",
    ])],
    ["roles", new Set(["id", "name", "permissions", "is_system_role", "created_at"])],
  ]);

  from(table: string) {
    return new ProductionSchemaQuery(this, table);
  }
}

class ProductionSchemaQuery {
  private operation: "select" | "insert" | "update" | "upsert" = "select";
  private values: Row | null = null;
  private filters: Array<{ column: string; value: unknown }> = [];
  private selectedColumns = "*";
  private maxRows: number | null = null;

  constructor(
    private readonly client: ProductionSchemaSupabaseClient,
    private readonly table: string,
  ) {}

  select(columns = "*") {
    this.selectedColumns = columns;
    return this;
  }

  insert(values: Row) {
    this.operation = "insert";
    this.values = values;
    return this;
  }

  update(values: Row) {
    this.operation = "update";
    this.values = values;
    return this;
  }

  upsert(values: Row) {
    this.operation = "upsert";
    this.values = values;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, value });
    return this;
  }

  order() {
    return this;
  }

  limit(value: number) {
    this.maxRows = value;
    return this;
  }

  async maybeSingle() {
    const result = this.execute();
    return { ...result, data: Array.isArray(result.data) ? result.data[0] || null : result.data };
  }

  async single() {
    const result = this.execute();
    return { ...result, data: Array.isArray(result.data) ? result.data[0] || null : result.data };
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | Row | null; error: Row | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): { data: Row[] | Row | null; error: Row | null } {
    const allowed = this.client.columns.get(this.table);
    const rows = this.client.tables.get(this.table);
    if (!allowed || !rows) {
      return { data: null, error: this.schemaError(this.table) };
    }

    const unknownWriteColumn = Object.keys(this.values || {}).find((column) => !allowed.has(column));
    if (unknownWriteColumn) {
      return { data: null, error: this.schemaError(unknownWriteColumn) };
    }
    const selected = this.selectedColumns === "*"
      ? []
      : this.selectedColumns.split(",").map((column) => column.trim());
    const unknownSelectedColumn = selected.find((column) => !allowed.has(column));
    if (unknownSelectedColumn) {
      return { data: null, error: this.schemaError(unknownSelectedColumn) };
    }

    if (this.operation === "insert") {
      const next = { ...this.values } as Row;
      if (rows.some((row) => row.id === next.id)) {
        return { data: null, error: { code: "23505", message: "duplicate key" } };
      }
      rows.push(next);
      return { data: this.project(next, selected), error: null };
    }

    const matching = rows.filter((row) => this.filters.every((filter) => row[filter.column] === filter.value));

    if (this.operation === "update") {
      for (const row of matching) Object.assign(row, this.values);
      return { data: matching, error: null };
    }

    if (this.operation === "upsert") {
      const existing = rows.find((row) => (
        row.merchant_id === this.values?.merchant_id && row.user_id === this.values?.user_id
      ));
      if (existing) Object.assign(existing, this.values);
      else rows.push({ id: `${this.table}-${rows.length + 1}`, ...this.values });
      return { data: existing || rows[rows.length - 1], error: null };
    }

    const limited = this.maxRows === null ? matching : matching.slice(0, this.maxRows);
    return { data: limited.map((row) => this.project(row, selected)), error: null };
  }

  private project(row: Row, selected: string[]) {
    if (selected.length === 0) return { ...row };
    return Object.fromEntries(selected.map((column) => [column, row[column]]));
  }

  private schemaError(column: string) {
    return {
      code: "PGRST204",
      message: `Could not find the '${column}' column of '${this.table}' in the schema cache`,
      details: null,
      hint: null,
    };
  }
}

function createAuthAdmin(options: { existing?: boolean } = {}) {
  const calls = { createUser: 0, generateLink: 0 };
  const authAdmin: StarterAuthAdmin = {
    async createUser() {
      calls.createUser += 1;
      return options.existing
        ? { data: { user: null }, error: { status: 422, message: "User already registered" } }
        : { data: { user: starterUser }, error: null };
    },
    async generateLink() {
      calls.generateLink += 1;
      return {
        data: { user: starterUser, properties: { email_otp: "activation-otp" } },
        error: null,
      };
    },
  };
  return { authAdmin, calls };
}

async function run() {
  {
    const repository = new MemoryStarterRepository();
    const { authAdmin, calls } = createAuthAdmin();
    const result = await provisionStarterSignup(
      { authAdmin, repository },
      {
        email: " Starter@Example.Test ",
        registeredName: "Starter Limited",
        tradingName: "Starter Shop",
        ownerName: "Starter Owner",
      },
    );

    assert.equal(calls.createUser, 1, "New Starter signup must create one Auth user.");
    assert.equal(repository.insertCount, 1, "New Starter signup must create one merchant.");
    assert.equal(repository.workspaceEnsureCount, 1, "New Starter signup must ensure its workspace row.");
    assert.equal(repository.creatorMembershipEnsureCount, 1, "New Starter signup should use the production admin role for creator membership.");
    assert.equal(result.merchantId, starterUser.id);
    assert.equal(result.merchantCreated, true);
    assert.equal(repository.lastInsert?.subscription_plan, "starter");
    assert.equal(repository.lastInsert?.merchant_tier, "starter");
    assert.equal(repository.lastInsert?.setup_mode, false);
    assert.equal(repository.lastInsert?.live_features_enabled, false);
    assert.equal(repository.lastInsert?.holds_pending_review, false);
    assert.equal(repository.lastInsert?.workspace_type, "business");
    assert.equal(repository.lastInsert?.business_affiliation_status, "not_started");
    assert.equal("trading_name" in (repository.lastInsert || {}), false);
    assert.equal("owner_name" in (repository.lastInsert || {}), false);
    assert.equal("platform_version" in (repository.lastInsert || {}), false);
    assert.equal("subscription" in (repository.lastInsert || {}), false, "Starter provisioning must not create or require a subscription.");
    assert.equal(result.workspaceId, starterUser.id);
    assert.equal(repository.lastWorkspaceInput?.businessName, "Starter Limited");
  }

  {
    const productionClient = new ProductionSchemaSupabaseClient();
    const repository = createSupabaseStarterWorkspaceRepository(productionClient as never);
    const first = await repairAuthenticatedStarterWorkspace(repository, starterUser);
    const replay = await repairAuthenticatedStarterWorkspace(repository, starterUser);
    const merchants = productionClient.tables.get("merchants") || [];
    const workspaces = productionClient.tables.get("workspaces") || [];
    const team = productionClient.tables.get("merchant_team") || [];

    assert.equal(first.merchantCreated, true);
    assert.equal(replay.merchantCreated, false);
    assert.equal(merchants.length, 1, "Production-schema repair must create one merchant.");
    assert.equal(workspaces.length, 1, "Production-schema repair must create one workspace.");
    assert.equal(team.length, 1, "Production-schema repair must upsert one admin creator membership.");
    assert.equal(team[0].role_id, "admin-role-id");
    assert.equal(merchants[0].workspace_id, workspaces[0].id);
    assert.equal(workspaces[0].onboarding_status, "active");
    assert.equal(workspaces[0].setup_mode, false);
    assert.equal(workspaces[0].live_features_enabled, false);
  }

  {
    const repository = new MemoryStarterRepository();
    const result = await repairAuthenticatedStarterWorkspace(repository, starterUser);

    assert.equal(result.merchantCreated, true, "A logged-in Starter identity with no merchant must be repaired.");
    assert.equal(repository.insertCount, 1);
    assert.equal(repository.workspaceEnsureCount, 1);
  }

  {
    const repository = new MemoryStarterRepository();
    await repairAuthenticatedStarterWorkspace(repository, starterUser);
    const replay = await repairAuthenticatedStarterWorkspace(repository, starterUser);

    assert.equal(replay.merchantCreated, false);
    assert.equal(repository.insertCount, 1, "Repeated Starter provisioning must not duplicate the merchant.");
    assert.equal(repository.merchants.length, 1);
    assert.equal(repository.workspaceEnsureCount, 2, "Repeated provisioning may safely re-ensure the same workspace.");
    assert.equal(repository.workspaceInsertCount, 1, "Repeated provisioning must not duplicate the workspace.");
    assert.equal(repository.creatorMembershipEnsureCount, 2, "Creator membership upsert should remain idempotent.");
  }

  {
    const repository = new MemoryStarterRepository();
    repository.merchants.push({ id: "trigger-created-merchant", user_id: starterUser.id });
    const { authAdmin } = createAuthAdmin({ existing: true });
    const result = await provisionStarterSignup(
      { authAdmin, repository },
      {
        email: "starter@example.test",
        registeredName: "Starter Limited",
        tradingName: "Starter Shop",
      },
    );

    assert.equal(result.merchantId, "trigger-created-merchant");
    assert.equal(repository.insertCount, 0, "A trigger-created merchant must be reused.");
  }

  {
    const repository = new MemoryStarterRepository();
    repository.roles.delete("admin");
    const result = await repairAuthenticatedStarterWorkspace(repository, starterUser);

    assert.equal(result.merchantCreated, true);
    assert.equal(result.workspaceId, starterUser.id);
    assert.equal(repository.creatorMembershipEnsureCount, 0);
    assert.equal(result.warnings.length, 1, "A missing creator role must be non-fatal.");
    assert.equal(result.warnings[0].code, "MEMBERSHIP_ROLE_UNAVAILABLE");
  }

  {
    const repository = new MemoryStarterRepository();
    repository.insertMerchant = async () => ({
      merchant: null,
      error: {
        code: "PGRST204",
        message: "Could not find a production column",
        details: "schema cache mismatch",
        hint: "Use production-safe columns",
      },
    });

    await assert.rejects(
      () => repairAuthenticatedStarterWorkspace(repository, starterUser),
      (error: unknown) => {
        assert.ok(error instanceof StarterProvisioningError);
        assert.equal(error.code, "MERCHANT_PROVISION_FAILED");
        assert.equal(error.stage, "merchant_insert");
        assert.deepEqual(error.supabase, {
          code: "PGRST204",
          message: "Could not find a production column",
          details: "schema cache mismatch",
          hint: "Use production-safe columns",
        });
        assert.deepEqual(getStarterProvisioningLogPayload(error), {
          code: "MERCHANT_PROVISION_FAILED",
          stage: "merchant_insert",
          message: "Failed to create Starter merchant.",
          supabase: error.supabase,
        });
        return true;
      },
    );
    assert.deepEqual(getStarterProvisioningLogPayload(new Error("secret-like raw error")), {
      code: "UNEXPECTED_STARTER_PROVISIONING_ERROR",
      stage: "unknown",
      message: "Unexpected Starter provisioning error.",
      supabase: null,
    });
  }

  {
    const paidUser = {
      ...starterUser,
      user_metadata: { plan: "solo_plus", business_name: "Paid Limited" },
    };
    assert.equal(isRecoverableStarterUser(paidUser), false);
    let fetchCalls = 0;
    const recovery = await requestStarterWorkspaceRecovery(
      async () => {
        fetchCalls += 1;
        return new Response(null, { status: 200 });
      },
      paidUser,
    );
    assert.deepEqual(recovery, { attempted: false, repaired: false });
    assert.equal(fetchCalls, 0, "Paid-plan users must never call the Starter repair endpoint.");
  }

  {
    const onboardingSource = readFileSync("src/app/onboarding/[plan]/page.tsx", "utf8");
    const dashboardLayoutSource = readFileSync("src/app/(dashboard)/layout.tsx", "utf8");
    const starterServiceSource = readFileSync("src/lib/services/starter-workspace.service.ts", "utf8");
    const starterRouteSource = readFileSync("src/app/api/onboarding/provision-starter/route.ts", "utf8");
    assert.doesNotMatch(
      starterServiceSource,
      /trading_name|owner_name|platform_version/,
      "Starter database writes must not assume columns missing from production.",
    );
    assert.match(starterServiceSource, /\.eq\("name", "admin"\)/);
    assert.doesNotMatch(starterServiceSource, /\.eq\("name", "owner"\)/);
    assert.match(starterServiceSource, /\.update\(\{ workspace_id: workspace\.id \}\)/);
    assert.match(starterRouteSource, /getStarterProvisioningLogPayload\(error\)/);
    assert.match(
      onboardingSource,
      /if \(planId === "starter"\)[\s\S]+fetch\("\/api\/onboarding\/provision-starter"/,
      "Starter onboarding should use direct free provisioning.",
    );
    assert.match(
      onboardingSource,
      /const sessionRes = await fetch\("\/api\/onboarding\/create-session"/,
      "Non-Starter onboarding must retain the existing paid-plan session flow.",
    );
    assert.match(
      onboardingSource,
      /router\.push\(`\/checkout\/subscription\?plan=/,
      "Non-Starter onboarding must still continue to checkout.",
    );
    assert.match(
      dashboardLayoutSource,
      /requestStarterWorkspaceRecovery\(fetch, user\)[\s\S]+resolveMerchantContextForUser/,
      "Dashboard must attempt one authenticated Starter repair before deciding to redirect.",
    );
  }

  console.log("starter-workspace-provisioning.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
