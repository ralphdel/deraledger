import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";

function moduleShim(path: string, exports: object): Module {
  const shim = new Module(path);
  shim.filename = path;
  shim.loaded = true;
  shim.exports = exports;
  return shim;
}

async function run() {
  const require = createRequire(import.meta.url);
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = moduleShim(serverOnlyPath, {}) as never;
  const redis = require("../src/lib/compliance/server/admin-readiness-durable-redis-client") as typeof import("../src/lib/compliance/server/admin-readiness-durable-redis-client");
  const config = require("../src/lib/compliance/server/admin-readiness-route-security-config") as typeof import("../src/lib/compliance/server/admin-readiness-route-security-config");

  // The Redis source remains available for separately reviewed future scale
  // work, but runtime configuration does not select it.
  assert.ok(redis.validateAdminReadinessDurableRedisConfiguration({
    environment: "local", redisEnvironment: "local", namespace: "admin_readiness_local_v1", url: "https://redis.example.test", token: "x".repeat(16),
  }));
  assert.equal(config.createAdminReadinessRouteSecurityConfiguration(), null);

  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
  assert.equal(packageJson.dependencies["@upstash/redis"], "^1.38.3");
  assert.equal(packageJson.dependencies["@upstash/ratelimit"], undefined);

  const configSource = readFileSync("src/lib/compliance/server/admin-readiness-route-security-config.ts", "utf8");
  assert.match(configSource, /^import\s+["']server-only["']/);
  assert.doesNotMatch(configSource, /admin-readiness-durable-redis-client|UPSTASH|createAdminReadinessDurableRedisClient/);
  assert.match(configSource, /SUPABASE_SERVICE_ROLE_KEY/);
  for (const file of [
    "src/lib/compliance/server/admin-readiness-durable-redis-client.ts",
    "src/lib/compliance/server/admin-readiness-csrf-session-binding.ts",
    "src/lib/compliance/server/admin-readiness-csrf-durable-storage.ts",
    "src/lib/compliance/server/admin-readiness-throttle-durable-storage.ts",
    "src/lib/compliance/server/admin-readiness-route-security-config.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /^import\s+["']server-only["']/);
    assert.doesNotMatch(source, /console\.|auth\.admin|approval execution|activation|collection unlock|payment|checkout|subscription|invoice|storefront/i);
  }
  console.log("admin-readiness-durable-security-adapters.test.ts passed");
}

void run();
