import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  canManageSettlementAccounts,
  getDashboardMerchantNavigationDecision,
  resolveMerchantContextForUser,
} from "../src/lib/merchant-context";

type Row = Record<string, any>;
type FakePostgrestError = { code: string; message: string };
type FakePostgrestResponse = { data: Row[]; error: FakePostgrestError | null };

class FakeSupabaseClient {
  tables = new Map<string, Row[]>();
  errors = new Map<string, { code: string; message: string }>();

  from(table: string) {
    return new FakeQuery(table, this.tables.get(table) || [], this.errors.get(table) || null);
  }
}

class FakeQuery {
  private filters: Array<{ key: string; value: unknown }> = [];
  private maxRows: number | null = null;
  private queryError: FakePostgrestError | null = null;

  constructor(
    private readonly table: string,
    private readonly rows: Row[],
    initialError: FakePostgrestError | null,
  ) {
    this.queryError = initialError;
  }

  select() {
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters.push({ key, value });
    return this;
  }

  order(column: string) {
    if (this.rows.length > 0 && !Object.prototype.hasOwnProperty.call(this.rows[0], column)) {
      this.queryError = {
        code: "42703",
        message: `column ${this.table}.${column} does not exist`,
      };
    }
    return this;
  }

  limit(value: number) {
    this.maxRows = value;
    return this;
  }

  async maybeSingle() {
    if (this.queryError) return { data: null, error: this.queryError };
    return { data: this.resultRows()[0] || null, error: null };
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: FakePostgrestResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    if (this.queryError) {
      return Promise.resolve({ data: [], error: this.queryError } satisfies FakePostgrestResponse).then(onfulfilled, onrejected);
    }
    return Promise.resolve({ data: this.resultRows(), error: null } satisfies FakePostgrestResponse).then(onfulfilled, onrejected);
  }

  private resultRows() {
    const filtered = this.rows.filter((row) => (
      this.filters.every((filter) => row[filter.key] === filter.value)
    ));
    return this.maxRows === null ? filtered : filtered.slice(0, this.maxRows);
  }
}

function seedClient() {
  const client = new FakeSupabaseClient();
  client.tables.set("merchants", [
    {
      id: "owner-merchant",
      user_id: "owner-user",
      is_super_admin: false,
      created_at: "2026-07-30T00:00:00.000Z",
    },
    {
      id: "team-merchant",
      user_id: "other-owner",
      is_super_admin: false,
      created_at: "2026-07-30T00:00:00.000Z",
    },
    {
      id: "second-team-merchant",
      user_id: "second-owner",
      is_super_admin: false,
      created_at: "2026-07-30T00:00:00.000Z",
    },
    {
      id: "admin-merchant",
      user_id: "admin-user",
      is_super_admin: true,
      created_at: "2026-07-30T00:00:00.000Z",
    },
  ]);
  client.tables.set("merchant_team", [
    {
      merchant_id: "team-merchant",
      user_id: "viewer-user",
      is_active: true,
      roles: { name: "viewer", permissions: { view_invoices: true, manage_billing: false } },
    },
    {
      merchant_id: "team-merchant",
      user_id: "inactive-user",
      is_active: false,
      roles: { name: "viewer", permissions: { view_invoices: true } },
    },
    {
      merchant_id: "team-merchant",
      user_id: "multi-user",
      is_active: true,
      roles: { name: "viewer", permissions: { view_invoices: true } },
    },
    {
      merchant_id: "second-team-merchant",
      user_id: "multi-user",
      is_active: true,
      roles: { name: "viewer", permissions: { view_invoices: true } },
    },
    {
      merchant_id: "team-merchant",
      user_id: "settlement-manager",
      is_active: true,
      roles: { name: "custom", permissions: { manage_settlement_account: true } },
    },
  ]);
  return client;
}

async function run() {
  const client = seedClient();

  const owner = await resolveMerchantContextForUser(client, { id: "owner-user" });
  assert.equal(owner.status, "resolved");
  assert.equal(owner.status === "resolved" && owner.relationship, "owner");
  assert.equal(owner.status === "resolved" && owner.merchantId, "owner-merchant");
  assert.equal(canManageSettlementAccounts(owner), true);

  const viewer = await resolveMerchantContextForUser(
    client,
    { id: "viewer-user" },
    { preferredMerchantId: "team-merchant" },
  );
  assert.equal(viewer.status, "resolved");
  assert.equal(viewer.status === "resolved" && viewer.relationship, "team_member");
  assert.equal(viewer.status === "resolved" && viewer.roleName, "viewer");
  assert.equal(canManageSettlementAccounts(viewer), false);

  const inactive = await resolveMerchantContextForUser(
    client,
    { id: "inactive-user" },
    { preferredMerchantId: "team-merchant" },
  );
  assert.equal(inactive.status, "not_found");

  const unrelated = await resolveMerchantContextForUser(
    client,
    { id: "viewer-user" },
    { preferredMerchantId: "owner-merchant" },
  );
  assert.equal(unrelated.status, "resolved");
  assert.equal(unrelated.status === "resolved" && unrelated.merchantId, "team-merchant");

  const ambiguous = await resolveMerchantContextForUser(client, { id: "multi-user" });
  assert.equal(ambiguous.status, "ambiguous_team_membership");

  const selectedMembership = await resolveMerchantContextForUser(
    client,
    { id: "multi-user" },
    { preferredMerchantId: "second-team-merchant" },
  );
  assert.equal(selectedMembership.status, "resolved");
  assert.equal(selectedMembership.status === "resolved" && selectedMembership.merchantId, "second-team-merchant");

  const settlementManager = await resolveMerchantContextForUser(
    client,
    { id: "settlement-manager" },
    { preferredMerchantId: "team-merchant" },
  );
  assert.equal(canManageSettlementAccounts(settlementManager), true);

  const superAdmin = await resolveMerchantContextForUser(
    client,
    { id: "admin-user", app_metadata: { is_super_admin: true } },
    { preferredMerchantId: "team-merchant" },
  );
  assert.equal(superAdmin.status, "resolved");
  assert.equal(superAdmin.status === "resolved" && superAdmin.relationship, "super_admin");

  const rlsHiddenMerchantClient = new FakeSupabaseClient();
  rlsHiddenMerchantClient.tables.set("merchants", []);
  rlsHiddenMerchantClient.tables.set("merchant_team", [
    {
      merchant_id: "team-merchant-hidden-by-rls",
      user_id: "viewer-user",
      is_active: true,
      roles: { name: "viewer", permissions: { view_invoices: true, manage_settlement_account: false } },
    },
  ]);
  const rlsHiddenMerchantViewer = await resolveMerchantContextForUser(
    rlsHiddenMerchantClient,
    { id: "viewer-user" },
    { preferredMerchantId: "team-merchant-hidden-by-rls" },
  );
  assert.equal(rlsHiddenMerchantViewer.status, "resolved");
  assert.equal(
    rlsHiddenMerchantViewer.status === "resolved" && rlsHiddenMerchantViewer.relationship,
    "team_member",
    "Active team membership should preserve workspace context even if the merchant DTO read is unavailable.",
  );
  assert.deepEqual(
    getDashboardMerchantNavigationDecision(rlsHiddenMerchantViewer, false),
    { action: "stay", reason: "resolved_context_without_merchant_dto" },
    "Dashboard hydration must not redirect a valid active team viewer to onboarding because merchant DTO is null.",
  );
  assert.deepEqual(
    getDashboardMerchantNavigationDecision({ status: "not_found" }, false),
    { action: "onboarding", reason: "no_workspace" },
  );
  assert.deepEqual(
    getDashboardMerchantNavigationDecision({ status: "unauthenticated" }, false),
    { action: "login", reason: "unauthenticated" },
  );
  assert.deepEqual(
    getDashboardMerchantNavigationDecision({ status: "ambiguous_team_membership" }, false),
    { action: "onboarding", reason: "ambiguous_team_membership" },
  );
  assert.deepEqual(
    getDashboardMerchantNavigationDecision({ status: "membership_query_failed" }, false),
    { action: "error", reason: "membership_query_failed" },
    "A bad merchant_team query must show a controlled workspace error, not redirect to onboarding.",
  );

  const membershipFailureClient = new FakeSupabaseClient();
  membershipFailureClient.tables.set("merchants", []);
  membershipFailureClient.errors.set("merchant_team", {
    code: "42703",
    message: "column merchant_team.created_at does not exist",
  });
  const membershipFailure = await resolveMerchantContextForUser(membershipFailureClient, { id: "viewer-user" });
  assert.equal(
    membershipFailure.status,
    "membership_query_failed",
    "PostgREST/schema failures must not be collapsed into no-workspace/not_found.",
  );
  assert.deepEqual(
    getDashboardMerchantNavigationDecision(membershipFailure, false),
    { action: "error", reason: "membership_query_failed" },
  );

  const dataSource = readFileSync("src/lib/data.ts", "utf8");
  const merchantContextSource = readFileSync("src/lib/merchant-context.ts", "utf8");
  const dashboardLayout = readFileSync("src/app/(dashboard)/layout.tsx", "utf8");
  const dashboardPage = readFileSync("src/app/(dashboard)/dashboard/page.tsx", "utf8");
  assert.doesNotMatch(
    merchantContextSource,
    /from\("merchant_team"\)[\s\S]{0,300}\.order\("created_at"/,
    "Merchant-team workspace resolution must not order by merchant_team.created_at because staging does not have that column.",
  );
  assert.match(
    merchantContextSource,
    /membership_query_failed/,
    "Merchant-team query failures should have an explicit sanitized resolver outcome.",
  );
  assert.match(
    dataSource,
    /resolveMerchantContextForUser\(sb, user, \{ preferredMerchantId \}\)/,
    "Dashboard data should use the shared team-aware workspace resolver.",
  );
  assert.match(
    dataSource,
    /readWorkspaceCookie\(\)/,
    "Signed-in team users should be able to resolve the selected workspace cookie.",
  );
  assert.match(
    dashboardLayout,
    /const merchantContext = await resolveMerchantContextForUser\(sb, user,/,
    "Dashboard redirect decisions should use the shared merchant-context resolver.",
  );
  assert.match(
    dashboardLayout,
    /initialDecision\.action === "onboarding"[\s\S]+window\.location\.href = "\/onboarding";/,
    "Only a failed shared merchant context should redirect authenticated users to onboarding.",
  );
  assert.match(
    dashboardLayout,
    /initialDecision\.action === "error"[\s\S]+setMerchantContextError\(initialDecision\.reason\)/,
    "Dashboard query failures should render a controlled error instead of onboarding.",
  );
  assert.match(
    dashboardLayout,
    /Workspace could not load/,
    "Workspace-query failures should keep logout reachable with a controlled dashboard error.",
  );
  assert.match(
    dashboardLayout,
    /if \(m === null\) \{[\s\S]+setMerchant\(/,
    "A valid merchant context with a failed optional merchant DTO load must not redirect to onboarding.",
  );
  assert.doesNotMatch(
    dashboardLayout,
    /if \(m === null\) \{[\s\S]{0,200}window\.location\.href = "\/onboarding";/,
    "Dashboard layout must not treat a nullable merchant DTO as onboarding-required.",
  );
  assert.match(
    dashboardLayout,
    /traceTeamDashboardRedirect\(/,
    "Dashboard layout should emit safe reason-code traces before onboarding/login navigation.",
  );
  assert.match(
    dashboardPage,
    /loadOptionalSettlementReadiness\(merchantData\)/,
    "Dashboard should load settlement readiness only after merchant permissions are known.",
  );
  assert.match(
    dashboardPage,
    /function canViewSettlementReadiness\(merchant: Merchant \| null\)[\s\S]+manage_settlement_account === true/,
    "Viewer dashboard load should not call owner-only settlement-account readiness.",
  );
  assert.match(
    dashboardPage,
    /if \(response\.status === 403\) \{[\s\S]+return null;/,
    "Optional settlement-account 403 should not clear merchant context or trigger onboarding.",
  );
  assert.doesNotMatch(
    dashboardPage,
    /window\.location\.(href|assign|replace)|router\.(push|replace)\("\/onboarding"/,
    "Dashboard page should not redirect to onboarding from optional API failures.",
  );

  const settlementRoute = readFileSync("src/app/api/merchant/settlement-accounts/route.ts", "utf8");
  assert.match(
    settlementRoute,
    /resolveMerchantContextForUser\(supabase, user,/,
    "Settlement account route should use the shared merchant-context resolver.",
  );
  assert.match(
    settlementRoute,
    /canManageSettlementAccounts\(merchantContext\)/,
    "Settlement account management should remain owner or explicitly permitted team access.",
  );
  assert.match(
    settlementRoute,
    /status: 403/,
    "Authenticated team viewers should receive a controlled forbidden response instead of a misleading 401.",
  );

  const adminPage = readFileSync("src/app/admin-login/page.tsx", "utf8");
  const adminAction = readFileSync("src/app/admin-login/actions.ts", "utf8");
  const adminRoute = readFileSync("src/app/api/admin-login/route.ts", "utf8");
  const onboardingPage = readFileSync("src/app/onboarding/page.tsx", "utf8");
  assert.doesNotMatch(
    adminPage,
    /verifyAdminPassword\(password\)/,
    "Admin passwords must not be passed as Server Action arguments.",
  );
  assert.match(adminPage, /fetch\("\/api\/admin-login"/);
  assert.doesNotMatch(adminAction, /password:\s*string/);
  assert.doesNotMatch(adminAction, /ADMIN_PORTAL_PASS/);
  assert.match(adminRoute, /timingSafeEqual/);
  assert.doesNotMatch(
    adminRoute,
    /console\.(log|warn|error|info)/,
    "Application-owned admin login code must not log password-bearing requests.",
  );
  assert.match(
    onboardingPage,
    /setHasSession\(Boolean\(session\?\.user\)\)/,
    "Onboarding should detect authenticated users redirected there by a merchant-context failure.",
  );
  assert.match(
    onboardingPage,
    /await logoutUser\(\);[\s\S]+window\.location\.href = "\/login";/,
    "Authenticated users on onboarding should still have a reachable logout path.",
  );

  console.log("merchant-context-contract.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
