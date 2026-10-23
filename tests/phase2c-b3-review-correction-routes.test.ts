import assert from "node:assert/strict";
import { createRequire } from "node:module";

const ids = {
  review: "11111111-1111-4111-8111-111111111111",
  admin: "22222222-2222-4222-8222-222222222222",
  owner: "33333333-3333-4333-8333-333333333333",
  merchant: "44444444-4444-4444-8444-444444444444",
};

function post(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function json(response: Response) {
  return JSON.parse(await response.text()) as Record<string, unknown>;
}

async function run() {
  const require = createRequire(import.meta.url);
  const serverOnlyId = require.resolve("server-only");
  require.cache[serverOnlyId] = {
    exports: {}, filename: serverOnlyId, id: serverOnlyId, loaded: true, path: serverOnlyId,
    children: [], paths: [], isPreloading: false, parent: null, require,
  } as NodeModule;

  const { createRequestReviewCorrectionRoute } = await import("../src/app/api/admin/compliance/reviews/[reviewId]/request-correction/route");
  const { createAdminComplianceReviewsRoute } = await import("../src/app/api/admin/compliance/reviews/route");
  const { createAdminComplianceReviewDetailRoute } = await import("../src/app/api/admin/compliance/reviews/[reviewId]/route");
  const { createMerchantReviewResubmissionRoute } = await import("../src/app/api/compliance/review/resubmit/route");
  const { createMerchantComplianceReviewRoute } = await import("../src/app/api/compliance/review/route");
  const { requireMerchantOwnerSession } = await import("../src/lib/server/merchant-owner-session");

  const context = { params: Promise.resolve({ reviewId: ids.review }) };

  {
    let serviceCalls = 0;
    const handler = createAdminComplianceReviewsRoute({
      requireSuperAdminSession: async () => ({ ok: false, status: 403, error: "SuperAdmin access required" }),
      createService: () => { serviceCalls += 1; return {} as never; },
    });
    const response = await handler();
    assert.equal(response.status, 403);
    assert.equal(serviceCalls, 0);
  }

  {
    const handler = createAdminComplianceReviewDetailRoute({
      requireSuperAdminSession: async () => ({ ok: true, userId: ids.admin }),
      createService: () => ({ getAdminReview: async () => { throw new Error("must not run"); } }) as never,
    });
    const response = await handler(new Request("http://localhost/api/admin/compliance/reviews/not-a-uuid"), {
      params: Promise.resolve({ reviewId: "not-a-uuid" }),
    });
    assert.equal(response.status, 400);
    assert.equal((await json(response)).code, "INVALID_REQUEST");
  }

  {
    let serviceCalls = 0;
    const handler = createRequestReviewCorrectionRoute({
      assertOrigin: () => ({}),
      requireSuperAdminSession: async () => ({ ok: false, status: 401, error: "Unauthorized" }),
      createService: () => { serviceCalls += 1; return {} as never; },
    });
    const response = await handler(post("http://localhost/api/admin/compliance/reviews/x/request-correction", {}), context);
    assert.equal(response.status, 401);
    assert.equal((await json(response)).code, "UNAUTHORIZED");
    assert.equal(serviceCalls, 0);
  }

  {
    const handler = createRequestReviewCorrectionRoute({
      assertOrigin: () => ({}),
      requireSuperAdminSession: async () => ({ ok: false, status: 403, error: "SuperAdmin access required" }),
      createService: () => { throw new Error("must not run"); },
    });
    const response = await handler(post("http://localhost/api/admin/compliance/reviews/x/request-correction", {
      app_metadata: { is_super_admin: true },
    }), context);
    assert.equal(response.status, 403);
    assert.equal((await json(response)).code, "FORBIDDEN");
  }

  {
    let captured: unknown = null;
    const handler = createRequestReviewCorrectionRoute({
      assertOrigin: () => ({}),
      requireSuperAdminSession: async () => ({ ok: true, userId: ids.admin }),
      createService: () => ({
        requestCorrection: async (input: unknown) => {
          captured = input;
          return { result: { kind: "applied" }, review: null };
        },
      }) as never,
    });
    const response = await handler(post("http://localhost/api/admin/compliance/reviews/x/request-correction", {
      reasonCode: "evidence_incomplete",
      requestedFindingCodes: ["legal_name"],
      requestIdempotencyKey: "phase2c-b3-admin-route",
    }), context);
    assert.equal(response.status, 200);
    assert.equal((await json(response)).code, "APPLIED");
    assert.deepEqual(captured, {
      reviewId: ids.review,
      reviewerId: ids.admin,
      reasonCode: "evidence_incomplete",
      requestedFindingCodes: ["legal_name"],
      idempotencyKey: "phase2c-b3-admin-route",
    });
  }

  for (const body of [
    { reasonCode: "free_form", requestedFindingCodes: ["legal_name"], requestIdempotencyKey: "phase2c-b3-invalid-1" },
    { reasonCode: "evidence_incomplete", requestedFindingCodes: ["not a code"], requestIdempotencyKey: "phase2c-b3-invalid-2" },
    { reasonCode: "evidence_incomplete", requestedFindingCodes: ["legal_name"], requestIdempotencyKey: "phase2c-b3-invalid-3", reviewerId: ids.owner },
    { reasonCode: "evidence_incomplete", requestedFindingCodes: ["legal_name"], requestIdempotencyKey: "phase2c-b3-invalid-4", expectedReviewVersion: 99 },
  ]) {
    const handler = createRequestReviewCorrectionRoute({
      assertOrigin: () => ({}),
      requireSuperAdminSession: async () => ({ ok: true, userId: ids.admin }),
      createService: () => ({ requestCorrection: async () => { throw new Error("must not run"); } }) as never,
    });
    const response = await handler(post("http://localhost/api/admin/compliance/reviews/x/request-correction", body), context);
    assert.equal(response.status, 400);
    assert.equal((await json(response)).code, "INVALID_REQUEST");
  }

  {
    const handler = createRequestReviewCorrectionRoute({
      assertOrigin: () => ({}),
      requireSuperAdminSession: async () => ({ ok: true, userId: ids.admin }),
      createService: () => ({ requestCorrection: async () => ({ result: { kind: "version_conflict" }, review: null }) }) as never,
    });
    const response = await handler(post("http://localhost/api/admin/compliance/reviews/x/request-correction", {
      reasonCode: "evidence_mismatch", requestedFindingCodes: ["legal_name"], requestIdempotencyKey: "phase2c-b3-version-conflict",
    }), context);
    assert.equal(response.status, 409);
    assert.equal((await json(response)).code, "VERSION_CONFLICT");
  }

  {
    const handler = createRequestReviewCorrectionRoute({
      assertOrigin: () => ({}),
      requireSuperAdminSession: async () => ({ ok: true, userId: ids.admin }),
      createService: () => ({ requestCorrection: async () => ({ result: { kind: "already_processed" }, review: null }) }) as never,
    });
    const response = await handler(post("http://localhost/api/admin/compliance/reviews/x/request-correction", {
      reasonCode: "evidence_expired", requestedFindingCodes: ["legal_name"], requestIdempotencyKey: "phase2c-b3-admin-replay",
    }), context);
    assert.equal(response.status, 200);
    assert.equal((await json(response)).code, "ALREADY_PROCESSED");
  }

  {
    const handler = createMerchantComplianceReviewRoute({
      requireOwnerSession: async () => ({ ok: false, status: 401, error: "Unauthorized" }),
      createService: () => { throw new Error("must not run"); },
    });
    const response = await handler();
    assert.equal(response.status, 401);
  }

  {
    const session = await requireMerchantOwnerSession({
      authClient: {
        auth: { getUser: async () => ({ data: { user: { id: ids.owner } }, error: null }) },
        from: () => { throw new Error("resolver was injected"); },
      },
      preferredMerchantId: ids.merchant,
      resolveContext: async () => ({
        status: "resolved", merchantId: ids.merchant, relationship: "team_member", roleName: "manager", permissions: {},
      }),
    });
    assert.deepEqual(session, { ok: false, status: 403, error: "Owner access required" });
  }

  {
    const session = await requireMerchantOwnerSession({
      authClient: {
        auth: { getUser: async () => ({ data: { user: { id: ids.owner } }, error: null }) },
        from: () => { throw new Error("resolver was injected"); },
      },
      preferredMerchantId: ids.merchant,
      resolveContext: async () => ({
        status: "resolved", merchantId: ids.merchant, relationship: "super_admin", roleName: "super_admin", permissions: {},
      }),
    });
    assert.deepEqual(session, { ok: false, status: 403, error: "Owner access required" });
  }

  {
    let preferred: string | null | undefined;
    const session = await requireMerchantOwnerSession({
      authClient: {
        auth: { getUser: async () => ({ data: { user: { id: ids.owner } }, error: null }) },
        from: () => { throw new Error("resolver was injected"); },
      },
      preferredMerchantId: ids.merchant,
      resolveContext: async (_client, _user, options) => {
        preferred = options?.preferredMerchantId;
        return { status: "resolved", merchantId: ids.merchant, relationship: "owner", roleName: "owner", permissions: {} };
      },
    });
    assert.deepEqual(session, { ok: true, userId: ids.owner, merchantId: ids.merchant });
    assert.equal(preferred, ids.merchant);
  }

  {
    let captured: unknown = null;
    const handler = createMerchantComplianceReviewRoute({
      requireOwnerSession: async () => ({ ok: true, userId: ids.owner, merchantId: ids.merchant }),
      createService: () => ({
        getMerchantReviewState: async (...input: unknown[]) => {
          captured = input;
          return { status: "NO_REVIEW_ELIGIBLE", eligibility: { canSubmit: false, reason: "PLAN_NOT_ELIGIBLE", plan: null, planLabel: null } };
        },
      }) as never,
    });
    const response = await handler();
    assert.equal(response.status, 200);
    assert.deepEqual(captured, [ids.owner, ids.merchant]);
    assert.equal((await json(response)).state !== undefined, true);
  }

  {
    let captured: unknown = null;
    const handler = createMerchantReviewResubmissionRoute({
      assertOrigin: () => ({}),
      requireOwnerSession: async () => ({ ok: true, userId: ids.owner, merchantId: ids.merchant }),
      createService: () => ({
        resubmitCorrection: async (input: unknown) => {
          captured = input;
          return { result: { kind: "applied" }, review: null };
        },
      }) as never,
    });
    const response = await handler(post("http://localhost/api/compliance/review/resubmit", {
      reviewId: ids.review,
      requestIdempotencyKey: "phase2c-b3-owner-route",
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(captured, { reviewId: ids.review, actorId: ids.owner, merchantId: ids.merchant, idempotencyKey: "phase2c-b3-owner-route" });
  }

  {
    const handler = createMerchantReviewResubmissionRoute({
      assertOrigin: () => ({}),
      requireOwnerSession: async () => ({ ok: true, userId: ids.owner, merchantId: ids.merchant }),
      createService: () => ({ resubmitCorrection: async () => { throw new Error("must not run"); } }) as never,
    });
    const response = await handler(post("http://localhost/api/compliance/review/resubmit", {
      reviewId: ids.review, requestIdempotencyKey: "phase2c-b3-owner-spoof", actorId: ids.admin,
    }));
    assert.equal(response.status, 400);
    assert.equal((await json(response)).code, "INVALID_REQUEST");
  }

  {
    const handler = createMerchantReviewResubmissionRoute({
      assertOrigin: () => { throw new Error("origin mismatch"); },
      requireOwnerSession: async () => ({ ok: true, userId: ids.owner, merchantId: ids.merchant }),
      createService: () => { throw new Error("must not run"); },
    });
    const response = await handler(post("http://localhost/api/compliance/review/resubmit", {
      reviewId: ids.review, requestIdempotencyKey: "phase2c-b3-origin-bad",
    }));
    assert.equal(response.status, 403);
  }

  {
    const handler = createMerchantReviewResubmissionRoute({
      assertOrigin: () => ({}),
      requireOwnerSession: async () => ({ ok: true, userId: ids.owner, merchantId: ids.merchant }),
      createService: () => ({ resubmitCorrection: async () => { throw new Error("secret SQL details"); } }) as never,
    });
    const response = await handler(post("http://localhost/api/compliance/review/resubmit", {
      reviewId: ids.review, requestIdempotencyKey: "phase2c-b3-safe-error",
    }));
    const body = await json(response);
    assert.equal(response.status, 500);
    assert.equal(body.code, "INTERNAL_ERROR");
    assert.equal(JSON.stringify(body).includes("secret SQL details"), false);
  }

  {
    const handler = createMerchantReviewResubmissionRoute({
      assertOrigin: () => ({}),
      requireOwnerSession: async () => ({ ok: true, userId: ids.owner, merchantId: ids.merchant }),
      createService: () => ({ resubmitCorrection: async () => { throw new Error("must not run"); } }) as never,
    });
    const response = await handler(post("http://localhost/api/compliance/review/resubmit", {
      reviewId: ids.review, requestIdempotencyKey: `a${"b".repeat(124)}`,
    }));
    assert.equal(response.status, 400);
    assert.equal((await json(response)).code, "INVALID_REQUEST");
  }

  console.log("Phase 2C-2C-B3 review-correction route tests passed.");
}

void run();
