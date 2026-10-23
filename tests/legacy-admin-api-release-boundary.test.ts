import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import {
  isExcludedLegacyAdminApiPath,
  isLegacyAdminApiReleaseEnabled,
  isPhase2CB3ComplianceAdminApiPath,
  isPhase2BSoloPlusAdminApiPath,
  shouldBlockExcludedLegacyAdminApi,
} from "../src/lib/server/legacy-admin-api-release";

const ADMIN_API_DIRECTORY = resolve("src/app/api/admin");

function findRouteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = resolve(directory, entry.name);
    return entry.isDirectory()
      ? findRouteFiles(fullPath)
      : entry.name === "route.ts"
        ? [fullPath]
        : [];
  });
}

function routePath(file: string): string {
  const relativePath = relative(ADMIN_API_DIRECTORY, file)
    .split(sep)
    .join("/")
    .replace(/\/route\.ts$/, "");
  return relativePath === "" ? "/api/admin" : `/api/admin/${relativePath}`;
}

function run() {
  const routePaths = findRouteFiles(ADMIN_API_DIRECTORY).map(routePath).sort();
  const soloPlusPaths = routePaths.filter(isPhase2BSoloPlusAdminApiPath);
  const complianceB3Paths = routePaths.filter(isPhase2CB3ComplianceAdminApiPath);
  const excludedPaths = routePaths.filter(isExcludedLegacyAdminApiPath);

  assert.deepEqual(soloPlusPaths, [
    "/api/admin/solo-plus/cases",
    "/api/admin/solo-plus/cases/[caseId]",
    "/api/admin/solo-plus/review",
  ]);
  assert.deepEqual(complianceB3Paths, [
    "/api/admin/compliance/reviews",
    "/api/admin/compliance/reviews/[reviewId]",
    "/api/admin/compliance/reviews/[reviewId]/request-correction",
  ]);
  assert.ok(excludedPaths.length > 0);
  assert.equal(routePaths.length, soloPlusPaths.length + complianceB3Paths.length + excludedPaths.length);

  for (const pathname of excludedPaths) {
    assert.equal(shouldBlockExcludedLegacyAdminApi(pathname, {}), true, pathname);
    assert.equal(
      shouldBlockExcludedLegacyAdminApi(pathname, {
        DERALEDGER_LEGACY_ADMIN_APIS_ENABLED: "false",
      }),
      true,
      pathname,
    );
    assert.equal(
      shouldBlockExcludedLegacyAdminApi(pathname, {
        DERALEDGER_LEGACY_ADMIN_APIS_ENABLED: "true",
        VERCEL_ENV: "preview",
      }),
      false,
      pathname,
    );
  }

  for (const pathname of soloPlusPaths) {
    assert.equal(shouldBlockExcludedLegacyAdminApi(pathname, {}), false, pathname);
  }

  assert.equal(shouldBlockExcludedLegacyAdminApi("/api/admin/solo-plus-malicious", {}), true);
  assert.equal(shouldBlockExcludedLegacyAdminApi("/api/admin/solo-plus", {}), true);
  assert.equal(shouldBlockExcludedLegacyAdminApi("/api/admin/solo-plus/cases/case-id/extra", {}), true);
  assert.equal(shouldBlockExcludedLegacyAdminApi("/api/merchant/profile", {}), false);

  const phase2cB3Paths = [
    "/api/admin/compliance/reviews",
    "/api/admin/compliance/reviews/11111111-1111-4111-8111-111111111111",
    "/api/admin/compliance/reviews/11111111-1111-4111-8111-111111111111/request-correction",
  ];
  for (const pathname of phase2cB3Paths) {
    assert.equal(isPhase2CB3ComplianceAdminApiPath(pathname), true, pathname);
    assert.equal(shouldBlockExcludedLegacyAdminApi(pathname, {}), false, pathname);
  }
  for (const pathname of [
    "/api/admin/compliance",
    "/api/admin/compliance/reviews/export",
    "/api/admin/compliance/reviews/not-a-uuid",
    "/api/admin/compliance/reviews/11111111-1111-4111-8111-111111111111?scope=all",
    "/api/admin/compliance/reviews/%2e%2e",
    "/api/admin/compliance/reviews/id/request-correction/extra",
    "/api/admin/compliance/reviews/id/approve",
    "/api/admin/compliance/reviews/id/reject",
  ]) {
    assert.equal(isPhase2CB3ComplianceAdminApiPath(pathname), false, pathname);
    assert.equal(shouldBlockExcludedLegacyAdminApi(pathname, {}), true, pathname);
  }
  assert.equal(isLegacyAdminApiReleaseEnabled({}), false);
  assert.equal(
    isLegacyAdminApiReleaseEnabled({
      DERALEDGER_LEGACY_ADMIN_APIS_ENABLED: "true",
      VERCEL_ENV: "production",
    }),
    false,
  );

  const proxySource = readFileSync("src/proxy.ts", "utf8");
  assert.match(proxySource, /shouldBlockExcludedLegacyAdminApi\(url\.pathname, process\.env\)/);
  assert.match(proxySource, /status:\s*404/);
  const boundaryCallIndex = proxySource.indexOf(
    "if (shouldBlockExcludedLegacyAdminApi(url.pathname, process.env))",
  );
  assert.ok(boundaryCallIndex >= 0);
  assert.ok(
    boundaryCallIndex < proxySource.indexOf("createServerClient("),
  );

  console.log("legacy-admin-api-release-boundary.test.ts passed");
}

run();
