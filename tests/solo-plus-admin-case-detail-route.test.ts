import assert from "node:assert/strict";

import { createSoloPlusAdminCaseDetailRouteHandler } from "../src/app/api/admin/solo-plus/cases/[caseId]/route";

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await response.text()) as Record<string, unknown>;
}

function createHandler(options: {
  guardResult?:
    | { ok: true; userId: string }
    | { ok: false; status: number; error: string };
  serviceResult?: Record<string, unknown> | null;
  serviceError?: unknown;
} = {}) {
  const calls = {
    serviceFactory: 0,
    getCaseDetail: 0,
    inputs: [] as unknown[],
  };

  const handler = createSoloPlusAdminCaseDetailRouteHandler({
    requireSuperAdminSession: async () =>
      options.guardResult || { ok: true as const, userId: "admin-user-id" },
    createAdminReadService: async () => {
      calls.serviceFactory += 1;
      return {
        adminUserId: "admin-user-id",
        repository: {} as never,
        getCaseDetail: async (caseId: string, historyInput: { cursor: string | null; limit: number }) => {
          calls.getCaseDetail += 1;
          calls.inputs.push({ caseId, historyInput });
          if (options.serviceError) {
            throw options.serviceError;
          }
          if (options.serviceResult !== undefined) {
            return options.serviceResult;
          }

          return {
            case: {
              caseId,
              merchantId: "22222222-2222-4222-8222-222222222222",
              merchantDisplayName: "Acme Retail",
              ownerEmail: "owner@example.test",
              currentPlan: "solo_lite",
              flowOrigin: "upgrade",
              caseStatus: "approved",
              reviewState: "approved",
              paymentStatus: "paid",
              refundStatus: "none",
              activationState: "approved_pending_activation",
              rowVersion: 8,
              createdAt: "2026-07-10T00:00:00.000Z",
              updatedAt: "2026-07-12T00:00:00.000Z",
              statusChangedAt: "2026-07-12T00:00:00.000Z",
            },
            requirements: [
              {
                requirementCode: "id_document",
                requirementState: "pending",
                evidenceSourceType: "merchant_document",
                evidenceReferenceSummary: {
                  sourceType: "merchant_document",
                  label: "Merchant evidence on file",
                  capturedAt: "2026-07-12T04:00:00.000Z",
                  fileType: "application/pdf",
                  fileSizeBytes: 2048,
                },
                completedAt: null,
                updatedAt: "2026-07-12T04:00:00.000Z",
              },
            ],
            payment: {
              provider: "paystack",
              amount: "13000.00",
              currency: "NGN",
              status: "paid",
              providerReference: "solo-plus-payment-ref",
              confirmedAt: null,
            },
            refund: null,
            reviewHistory: [
              {
                eventType: "case_approved",
                decision: "approve",
                reason: null,
                actorType: "admin",
                reviewerDisplayName: "Super Admin",
                policyVersion: "solo-plus-policy-v1",
                createdAt: "2026-07-12T00:00:00.000Z",
              },
            ],
          };
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
        "https://app.example.test/api/admin/solo-plus/cases/11111111-1111-4111-8111-111111111111?historyLimit=25",
      ),
      {
        params: Promise.resolve({
          caseId: "11111111-1111-4111-8111-111111111111",
        }),
      },
    );
    const body = await readJson(response);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(calls.serviceFactory, 1);
    assert.equal(calls.getCaseDetail, 1);
    assert.deepEqual(calls.inputs[0], {
      caseId: "11111111-1111-4111-8111-111111111111",
      historyInput: {
        cursor: null,
        limit: 25,
      },
    });
    assert.equal((body.case as Record<string, unknown>).activationState, "approved_pending_activation");
    assert.equal("paymentReference" in (body.case as Record<string, unknown>), false);
    assert.equal(
      "storageKey" in (((body.requirements as Array<Record<string, unknown>>)[0].evidenceReferenceSummary as Record<string, unknown>) || {}),
      false,
    );
    assert.equal(
      "actorId" in ((body.reviewHistory as Array<Record<string, unknown>>)[0] as Record<string, unknown>),
      false,
    );
  }

  {
    const { handler, calls } = createHandler({
      guardResult: { ok: false, status: 401, error: "Unauthorized" },
    });
    const response = await handler(
      new Request("https://app.example.test/api/admin/solo-plus/cases/11111111-1111-4111-8111-111111111111"),
      { params: Promise.resolve({ caseId: "11111111-1111-4111-8111-111111111111" }) },
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
      new Request("https://app.example.test/api/admin/solo-plus/cases/11111111-1111-4111-8111-111111111111"),
      { params: Promise.resolve({ caseId: "11111111-1111-4111-8111-111111111111" }) },
    );
    const body = await readJson(response);
    assert.equal(response.status, 403);
    assert.equal(body.code, "FORBIDDEN");
    assert.equal(calls.serviceFactory, 0);
  }

  for (const params of [
    {
      caseId: "not-a-uuid",
      url: "https://app.example.test/api/admin/solo-plus/cases/not-a-uuid",
    },
    {
      caseId: "11111111-1111-4111-8111-111111111111",
      url: "https://app.example.test/api/admin/solo-plus/cases/11111111-1111-4111-8111-111111111111?historyLimit=0",
    },
    {
      caseId: "11111111-1111-4111-8111-111111111111",
      url: "https://app.example.test/api/admin/solo-plus/cases/11111111-1111-4111-8111-111111111111?historyCursor=not-base64",
    },
  ]) {
    const { handler, calls } = createHandler();
    const response = await handler(new Request(params.url), {
      params: Promise.resolve({ caseId: params.caseId }),
    });
    const body = await readJson(response);
    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_REQUEST");
    assert.equal(calls.getCaseDetail, 0);
  }

  {
    const { handler } = createHandler({ serviceResult: null });
    const response = await handler(
      new Request("https://app.example.test/api/admin/solo-plus/cases/11111111-1111-4111-8111-111111111111"),
      { params: Promise.resolve({ caseId: "11111111-1111-4111-8111-111111111111" }) },
    );
    const body = await readJson(response);
    assert.equal(response.status, 404);
    assert.equal(body.code, "NOT_FOUND");
  }

  {
    const { handler } = createHandler({
      serviceError: Object.assign(new Error("blocked"), { code: "SOLO_PLUS_SERVER_FORBIDDEN" }),
    });
    const response = await handler(
      new Request("https://app.example.test/api/admin/solo-plus/cases/11111111-1111-4111-8111-111111111111"),
      { params: Promise.resolve({ caseId: "11111111-1111-4111-8111-111111111111" }) },
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
      new Request("https://app.example.test/api/admin/solo-plus/cases/11111111-1111-4111-8111-111111111111"),
      { params: Promise.resolve({ caseId: "11111111-1111-4111-8111-111111111111" }) },
    );
    const body = await readJson(response);
    assert.equal(response.status, 500);
    assert.equal(body.code, "INTERNAL_ERROR");
    assert.equal(String(body.error).includes("hidden supabase details"), false);
  }

  console.log("solo-plus-admin-case-detail-route.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
