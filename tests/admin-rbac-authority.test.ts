import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";

type AuthorityRow = { id: string } | null;

class FakeAuthorityQuery {
  readonly filters: Array<[string, unknown]> = [];

  constructor(
    private readonly row: AuthorityRow,
    private readonly error: { message: string } | null = null,
  ) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  limit() {
    return this;
  }

  async maybeSingle() {
    return { data: this.row, error: this.error };
  }
}

async function run() {
  const require = createRequire(import.meta.url);
  const serverOnlyShimPath = require.resolve("server-only");
  const serverOnlyShimModule = new Module(serverOnlyShimPath);
  serverOnlyShimModule.filename = serverOnlyShimPath;
  serverOnlyShimModule.loaded = true;
  serverOnlyShimModule.exports = {};
  require.cache[serverOnlyShimPath] = serverOnlyShimModule as never;

  const { resolveDbBackedSuperAdminSession } = await import(
    new URL("../src/lib/admin-rbac.ts", import.meta.url).href
  );

  const authClient = (user: Record<string, unknown> | null) => ({
    auth: {
      getUser: async () => ({
        data: { user },
        error: user ? null : { message: "missing" },
      }),
    },
  });

  const metadataOnlyQuery = new FakeAuthorityQuery(null);
  const metadataOnly = await resolveDbBackedSuperAdminSession({
    authClient: authClient({
      id: "metadata-only-user",
      app_metadata: { is_super_admin: true },
      user_metadata: { is_super_admin: true },
    }) as never,
    authorityClient: { from: () => metadataOnlyQuery } as never,
  });
  assert.deepEqual(metadataOnly, {
    ok: false,
    status: 403,
    error: "SuperAdmin access required",
  });

  const dbAuthorityQuery = new FakeAuthorityQuery({ id: "admin-merchant" });
  const dbBacked = await resolveDbBackedSuperAdminSession({
    authClient: authClient({ id: "db-admin", user_metadata: { is_super_admin: false } }) as never,
    authorityClient: { from: () => dbAuthorityQuery } as never,
  });
  assert.deepEqual(dbBacked, { ok: true, userId: "db-admin" });
  assert.deepEqual(dbAuthorityQuery.filters, [
    ["user_id", "db-admin"],
    ["is_super_admin", true],
  ]);

  const lookupFailure = await resolveDbBackedSuperAdminSession({
    authClient: authClient({ id: "db-admin" }) as never,
    authorityClient: {
      from: () => new FakeAuthorityQuery(null, { message: "catalog unavailable" }),
    } as never,
  });
  assert.deepEqual(lookupFailure, {
    ok: false,
    status: 503,
    error: "Admin authority unavailable",
  });

  const unauthenticated = await resolveDbBackedSuperAdminSession({
    authClient: authClient(null) as never,
    authorityClient: { from: () => new FakeAuthorityQuery(null) } as never,
  });
  assert.deepEqual(unauthenticated, { ok: false, status: 401, error: "Unauthorized" });

  const authoritySource = readFileSync("src/lib/admin-rbac.ts", "utf8");
  const adminGuardSource = readFileSync("src/lib/admin-auth.ts", "utf8");
  const reviewServiceSource = readFileSync(
    "src/lib/solo-plus/server/review-service.ts",
    "utf8",
  );
  const accessContextSource = readFileSync(
    "src/lib/solo-plus/server/access-context.ts",
    "utf8",
  );
  const actionsSource = readFileSync("src/lib/actions.ts", "utf8");
  const proxySource = readFileSync("src/proxy.ts", "utf8");
  for (const source of [
    authoritySource,
    adminGuardSource,
    reviewServiceSource,
    accessContextSource,
    actionsSource,
    proxySource,
  ]) {
    assert.doesNotMatch(source, /user_metadata\?*\.is_super_admin\s*===\s*true/);
  }
  for (const source of [adminGuardSource, reviewServiceSource, proxySource]) {
    assert.doesNotMatch(source, /app_metadata\?*\.is_super_admin\s*===\s*true/);
  }
  assert.match(authoritySource, /\.eq\("is_super_admin", true\)/);
  assert.match(authoritySource, /\.eq\("user_id", user\.id\.trim\(\)\)/);
  assert.match(reviewServiceSource, /mode: "admin_review" as const/);
  assert.doesNotMatch(reviewServiceSource, /mode: "internal_test" as const/);

  console.log("admin-rbac-authority.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
