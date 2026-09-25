import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ADMIN_PORTAL_HOST,
  OPERATIONAL_PORTAL_PREFIXES,
  resolveOperationalPortalRouting,
} from "../src/lib/server/admin-domain-routing";

function run() {
  assert.equal(ADMIN_PORTAL_HOST, "admin.deraledger.com");
  assert.deepEqual(OPERATIONAL_PORTAL_PREFIXES, ["/admin", "/admin-login", "/compliance"]);

  assert.equal(resolveOperationalPortalRouting("admin.deraledger.com", "/"), "redirect_to_admin");
  assert.equal(resolveOperationalPortalRouting("admin.deraledger.com", "/admin"), "allow");
  assert.equal(resolveOperationalPortalRouting("admin.deraledger.com", "/admin-login"), "allow");
  assert.equal(resolveOperationalPortalRouting("admin.deraledger.com", "/compliance"), "allow");
  assert.equal(resolveOperationalPortalRouting("admin.deraledger.com", "/compliance/future"), "allow");

  for (const publicHost of ["deraledger.com", "www.deraledger.com"]) {
    assert.equal(resolveOperationalPortalRouting(publicHost, "/admin"), "redirect_to_public_root");
    assert.equal(resolveOperationalPortalRouting(publicHost, "/admin/users"), "redirect_to_public_root");
    assert.equal(resolveOperationalPortalRouting(publicHost, "/admin-login"), "redirect_to_public_root");
    assert.equal(resolveOperationalPortalRouting(publicHost, "/compliance"), "redirect_to_public_root");
    assert.equal(resolveOperationalPortalRouting(publicHost, "/compliance/cases"), "redirect_to_public_root");
    assert.equal(resolveOperationalPortalRouting(publicHost, "/"), "allow");
  }

  assert.equal(resolveOperationalPortalRouting("deraledger-staging.vercel.app", "/admin"), "allow");
  assert.equal(resolveOperationalPortalRouting("deraledger-staging.vercel.app", "/admin-login"), "allow");
  assert.equal(resolveOperationalPortalRouting("WWW.DERALEDGER.COM", "/admin"), "redirect_to_public_root");
  assert.equal(resolveOperationalPortalRouting("www.deraledger.com", "/administrator"), "allow");
  assert.equal(resolveOperationalPortalRouting("admin.deraledger.com", "/api/internal/admin/compliance/readiness/issue"), "allow");
  assert.equal(resolveOperationalPortalRouting("www.deraledger.com", "/api/internal/admin/compliance/readiness/snapshot"), "allow");

  const proxySource = readFileSync("src/proxy.ts", "utf8");
  assert.match(proxySource, /resolveOperationalPortalRouting\(request\.nextUrl\.hostname, url\.pathname\)/);
  assert.match(proxySource, /operationalRouting === "redirect_to_admin"/);
  assert.match(proxySource, /operationalRouting === "redirect_to_public_root"/);
  assert.ok(proxySource.indexOf('operationalRouting === "redirect_to_admin"') < proxySource.indexOf("url.pathname.startsWith('/admin')"));
  assert.ok(proxySource.indexOf('operationalRouting === "redirect_to_public_root"') < proxySource.indexOf("url.pathname.startsWith('/admin')"));

  console.log("admin-domain-routing.test.ts passed");
}

run();
