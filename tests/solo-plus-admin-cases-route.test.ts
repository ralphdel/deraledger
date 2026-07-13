import assert from "node:assert/strict";

import { createSoloPlusAdminCasesRouteHandler } from "../src/app/api/admin/solo-plus/cases/route";

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await response.text()) as Record<string, unknown>;
}

function createHandler(options: {
  guardResult?:
    | { ok: true; userId: string }
    | { ok: false; status: number; error: string };
  serviceResult?: {
    items: Array<Record<string, unknown>>;
    nextCursor: string | null;
  };
  serviceError?: unknown;
} = {}) {
  const calls = {
    serviceFactory: 0,
    listCases: 0,
    listInput: [] as unknown[],
  };

  const handler = createSoloPlusAdminCasesRouteHandler({
    requireSuperAdminSession: async () =>
      options.guardResult || { ok: true as const, userId: "admin-user-id" },
    createAdminReadService: async () => {
      calls.serviceFactory += 1;
      return {
        adminUserId: "admin-user-id",
        repository: {} as never,
        listCases: async (input: unknown) => {
          calls.listCases += 1;
          calls.listInput.push(JSON.parse(JSON.stringify(input)) as unknown);
          if (options.serviceError) {
            throw options.serviceError;
          }
          return (
            options.serviceResult || {
              items: [
                {
                  caseId: "11111111-1111-4111-8111-111111111111",
                  merchantDisplayName: "Acme Retail",
                  ownerEmail: "owner@example.test",
                  flowOrigin: "upgrade",
                  caseStatus: "verification_pending",
                  reviewState: "more_information_required",
                  paymentStatus: "paid",
                  refundStatus: "none",
                  rowVersion: 6,
                  requirementSummary: {
                    total: 3,
                    satisfied: 1,
                    actionable: 1,
                    inProgress: 1,
                  },
                  createdAt: "2026-07-10T00:00:00.000Z",
                  updatedAt: "2026-07-12T01:00:00.000Z",
                  statusChangedAt: "2026-07-12T02:00:00.000Z",
                },
              ],
              nextCursor: "opaque-cursor",
            }
          );
        },
      } as never;
    },
  });

  return { handler, calls };
}

async function run() {
  {
    const { handler, calls } = createHandler();
    const response = await handler(
      new Request(
        "https://app.example.test/api/admin/solo-plus/cases?status=verification_pending&flowOrigin=upgrade&paymentStatus=paid&refundStatus=none&q=Acme%20Retail&limit=25",
      ),
    );
    const body = await readJson(response);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(calls.serviceFactory, 1);
    assert.equal(calls.listCases, 1);
    assert.deepEqual(calls.listInput[0], {
      caseStatus: "verification_pending",
      flowOrigin: "upgrade",
      paymentStatus: "paid",
      refundStatus: "none",
      merchantSearch: "Acme Retail",
      cursor: null,
      limit: 25,
    });
    assert.equal(Array.isArray(body.items), true);
    assert.equal(body.nextCursor, "opaque-cursor");
    const item = (body.items as Array<Record<string, unknown>>)[0];
    assert.equal("auditMetadata" in item, false);
    assert.equal("paymentReference" in item, false);
    assert.equal("providerPayload" in item, false);
  }

  {
    const { handler, calls } = createHandler({
      guardResult: { ok: false, status: 401, error: "Unauthorized" },
    });
    const response = await handler(
      new Request("https://app.example.test/api/admin/solo-plus/cases"),
    );
    const body = await readJson(response);
    assert.equal(response.status, 401);
    assert.equal(body.code, "UNAUTHORIZED");
    assert.equal(calls.serviceFactory, 0);
  }

  {
    const { handler, calls } = createHandler({
      guardResult: { ok: false, status: 403, error: "SuperAdmin access required" },
    });
    const response = await handler(
      new Request("https://app.example.test/api/admin/solo-plus/cases"),
    );
    const body = await readJson(response);
    assert.equal(response.status, 403);
    assert.equal(body.code, "FORBIDDEN");
    assert.equal(calls.serviceFactory, 0);
  }

  for (const url of [
    "https://app.example.test/api/admin/solo-plus/cases?status=not_real",
    "https://app.example.test/api/admin/solo-plus/cases?flowOrigin=bad",
    "https://app.example.test/api/admin/solo-plus/cases?paymentStatus=done",
    "https://app.example.test/api/admin/solo-plus/cases?refundStatus=bad",
    "https://app.example.test/api/admin/solo-plus/cases?limit=0",
    "https://app.example.test/api/admin/solo-plus/cases?limit=51",
    "https://app.example.test/api/admin/solo-plus/cases?cursor=not-base64",
  ]) {
    const { handler, calls } = createHandler();
    const response = await handler(new Request(url));
    const body = await readJson(response);
    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_REQUEST");
    assert.equal(calls.listCases, 0);
  }

  {
    const { handler } = createHandler({
      serviceError: Object.assign(new Error("hidden database detail"), {
        code: "SOLO_PLUS_SERVER_FORBIDDEN",
      }),
    });
    const response = await handler(
      new Request("https://app.example.test/api/admin/solo-plus/cases"),
    );
    const body = await readJson(response);
    assert.equal(response.status, 403);
    assert.equal(body.code, "FORBIDDEN");
  }

  {
    const { handler } = createHandler({
      serviceError: new Error("hidden supabase details"),
    });
    const response = await handler(
      new Request("https://app.example.test/api/admin/solo-plus/cases"),
    );
    const body = await readJson(response);
    assert.equal(response.status, 500);
    assert.equal(body.code, "INTERNAL_ERROR");
    assert.equal(String(body.error).includes("hidden supabase details"), false);
  }

  console.log("solo-plus-admin-cases-route.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
