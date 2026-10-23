import assert from "node:assert/strict";
import { createRequire } from "node:module";

const ids = {
  owner: "11111111-1111-4111-8111-111111111111",
  merchant: "22222222-2222-4222-8222-222222222222",
};

function post(body: unknown, origin: string | null = "http://localhost") {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin !== null) headers.set("origin", origin);
  return new Request("http://localhost/api/compliance/review/submit", {
    method: "POST", headers, body: JSON.stringify(body),
  });
}

async function body(response: Response) {
  return JSON.parse(await response.text()) as Record<string, unknown>;
}

async function run() {
  const require = createRequire(import.meta.url);
  const serverOnlyId = require.resolve("server-only");
  require.cache[serverOnlyId] = {
    exports: {}, filename: serverOnlyId, id: serverOnlyId, loaded: true, path: serverOnlyId,
    children: [], paths: [], isPreloading: false, parent: null, require,
  } as NodeModule;
  const { createMerchantInitialReviewSubmissionRoute } = await import("../src/app/api/compliance/review/submit/route");
  const { assertSameOriginBrowserMutationRequest } = await import("../src/lib/server/browser-origin");
  const pendingState = {
    status: "PENDING",
    review: {
      reviewId: "33333333-3333-4333-8333-333333333333", merchantId: ids.merchant,
      merchantName: "Bounded Merchant", plan: "solo_lite", planLabel: "Solo Lite", status: "pending",
      submittedAt: "2026-10-23T12:00:00.000Z", reviewedAt: null, policyVersion: "2c-2b-draft-v1",
      rowVersion: 1, reasonCode: null, requestedFindingCodes: [], findings: [], history: [],
    },
  };

  {
    let calls = 0;
    const handler = createMerchantInitialReviewSubmissionRoute({
      assertOrigin: assertSameOriginBrowserMutationRequest,
      requireOwnerSession: async () => ({ ok: false, status: 401, error: "Unauthorized" }),
      createService: () => { calls += 1; return {} as never; },
    });
    const response = await handler(post({ requestIdempotencyKey: "phase2c-b4-route-test" }));
    assert.equal(response.status, 401);
    assert.equal(calls, 0);
  }

  for (const origin of [null, "https://foreign.example"] as const) {
    const handler = createMerchantInitialReviewSubmissionRoute({
      assertOrigin: assertSameOriginBrowserMutationRequest,
      requireOwnerSession: async () => ({ ok: true, userId: ids.owner, merchantId: ids.merchant }),
      createService: () => { throw new Error("must not run"); },
    });
    const response = await handler(post({ requestIdempotencyKey: "phase2c-b4-origin-test" }, origin));
    assert.equal(response.status, 403);
    assert.equal((await body(response)).code, "FORBIDDEN");
  }

  {
    let captured: unknown = null;
    const handler = createMerchantInitialReviewSubmissionRoute({
      assertOrigin: assertSameOriginBrowserMutationRequest,
      requireOwnerSession: async () => ({ ok: true, userId: ids.owner, merchantId: ids.merchant }),
      createService: () => ({
        submitInitialReview: async (input: unknown) => {
          captured = input;
          return { result: { kind: "applied" }, state: pendingState };
        },
      }) as never,
    });
    const response = await handler(post({ requestIdempotencyKey: "phase2c-b4-route-test" }));
    const payload = await body(response);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(payload.code, "APPLIED");
    assert.deepEqual(captured, { actorId: ids.owner, merchantId: ids.merchant, idempotencyKey: "phase2c-b4-route-test" });
  }

  for (const spoofed of [
    { actorId: ids.owner }, { merchantId: ids.merchant }, { workspaceId: ids.merchant },
    { profileId: ids.merchant }, { profileRowVersion: 1 }, { plan: "solo_lite" },
    { policyVersion: "2c-2b-draft-v1" }, { evidenceSnapshot: {} }, { reviewVersion: 1 },
  ]) {
    const handler = createMerchantInitialReviewSubmissionRoute({
      assertOrigin: assertSameOriginBrowserMutationRequest,
      requireOwnerSession: async () => ({ ok: true, userId: ids.owner, merchantId: ids.merchant }),
      createService: () => ({ submitInitialReview: async () => { throw new Error("must not run"); } }) as never,
    });
    const response = await handler(post({ requestIdempotencyKey: "phase2c-b4-spoof-test", ...spoofed }));
    assert.equal(response.status, 400);
    assert.equal((await body(response)).code, "INVALID_REQUEST");
  }

  for (const requestIdempotencyKey of ["short", `a${"b".repeat(128)}`, "invalid key value"]) {
    const handler = createMerchantInitialReviewSubmissionRoute({
      assertOrigin: assertSameOriginBrowserMutationRequest,
      requireOwnerSession: async () => ({ ok: true, userId: ids.owner, merchantId: ids.merchant }),
      createService: () => ({ submitInitialReview: async () => { throw new Error("must not run"); } }) as never,
    });
    const response = await handler(post({ requestIdempotencyKey }));
    assert.equal(response.status, 400);
  }

  const mappings = [
    ["already_processed", 200, "ALREADY_PROCESSED"], ["version_conflict", 409, "VERSION_CONFLICT"],
    ["state_conflict", 409, "STATE_CONFLICT"], ["evidence_conflict", 422, "EVIDENCE_CONFLICT"],
    ["actor_unauthorized", 403, "AUTHORITY_CONFLICT"], ["unsupported_isolation", 503, "SERVICE_UNAVAILABLE"],
    ["invalid_transition", 409, "STATE_CONFLICT"],
  ] as const;
  for (const [kind, status, code] of mappings) {
    const handler = createMerchantInitialReviewSubmissionRoute({
      assertOrigin: assertSameOriginBrowserMutationRequest,
      requireOwnerSession: async () => ({ ok: true, userId: ids.owner, merchantId: ids.merchant }),
      createService: () => ({ submitInitialReview: async () => ({ result: { kind }, state: pendingState }) }) as never,
    });
    const response = await handler(post({ requestIdempotencyKey: `phase2c-b4-map-${kind}` }));
    assert.equal(response.status, status);
    assert.equal((await body(response)).code, code);
  }

  {
    const handler = createMerchantInitialReviewSubmissionRoute({
      assertOrigin: assertSameOriginBrowserMutationRequest,
      requireOwnerSession: async () => ({ ok: true, userId: ids.owner, merchantId: ids.merchant }),
      createService: () => ({ submitInitialReview: async () => { throw new Error("raw postgres provider secret"); } }) as never,
    });
    const response = await handler(post({ requestIdempotencyKey: "phase2c-b4-bounded-error" }));
    const payload = await body(response);
    assert.equal(response.status, 500);
    assert.deepEqual(payload, { ok: false, code: "INTERNAL_ERROR" });
    assert.equal(JSON.stringify(payload).includes("postgres"), false);
  }

  console.log("Phase 2C-2C-B4 initial review submission route tests passed.");
}

void run();
