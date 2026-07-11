import assert from "node:assert/strict";

import { createSoloPlusReviewRouteHandler } from "../src/app/api/admin/solo-plus/review/route";
import type {
  SoloPlusCaseEventRecord,
  SoloPlusCaseMutationResult,
  SoloPlusCaseRecord,
} from "../src/lib/solo-plus/repository";

type GuardResult =
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string };

function buildCaseRecord(overrides: Partial<SoloPlusCaseRecord> = {}): SoloPlusCaseRecord {
  return {
    id: overrides.id || "11111111-1111-4111-8111-111111111111",
    merchantId: overrides.merchantId ?? "22222222-2222-4222-8222-222222222222",
    onboardingSessionId: overrides.onboardingSessionId ?? null,
    flowOrigin: overrides.flowOrigin ?? "upgrade",
    sourcePlan: overrides.sourcePlan ?? "solo_lite",
    targetPlan: "solo_plus",
    caseStatus: overrides.caseStatus ?? "manual_review",
    paymentStatus: overrides.paymentStatus ?? "paid",
    refundStatus: overrides.refundStatus ?? "none",
    paymentRecordId: overrides.paymentRecordId ?? null,
    paymentProvider: overrides.paymentProvider ?? "paystack",
    paymentReference: overrides.paymentReference ?? "solo-plus-pay-ref",
    expectedAmount: overrides.expectedAmount ?? "13000.00",
    paymentCurrency: "NGN",
    requirementsPolicyVersion:
      overrides.requirementsPolicyVersion ?? "solo-plus-policy-v1",
    requirementsSnapshot: overrides.requirementsSnapshot ?? {},
    activePlanSnapshot: overrides.activePlanSnapshot ?? "solo_lite",
    rejectionReason: overrides.rejectionReason ?? null,
    approvedAt: overrides.approvedAt ?? null,
    approvedByAdminId: overrides.approvedByAdminId ?? null,
    rejectedAt: overrides.rejectedAt ?? null,
    rejectedByAdminId: overrides.rejectedByAdminId ?? null,
    reopenedAt: overrides.reopenedAt ?? null,
    reopenedByAdminId: overrides.reopenedByAdminId ?? null,
    idempotencyKey: overrides.idempotencyKey ?? "solo-plus-review-case",
    activationIdempotencyKey: overrides.activationIdempotencyKey ?? null,
    refundIdempotencyKey: overrides.refundIdempotencyKey ?? null,
    rowVersion: overrides.rowVersion ?? 4,
    auditMetadata: overrides.auditMetadata ?? {},
    createdAt: overrides.createdAt ?? "2026-07-10T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-10T00:00:00.000Z",
  };
}

function buildEventRecord(
  overrides: Partial<SoloPlusCaseEventRecord> = {},
): SoloPlusCaseEventRecord {
  return {
    id: overrides.id || "33333333-3333-4333-8333-333333333333",
    caseId: overrides.caseId || "11111111-1111-4111-8111-111111111111",
    eventType: overrides.eventType || "case_approved",
    previousState: overrides.previousState || { caseStatus: "manual_review" },
    newState: overrides.newState || { caseStatus: "approved" },
    actorType: overrides.actorType || "admin",
    actorId: overrides.actorId ?? "44444444-4444-4444-8444-444444444444",
    requestIdempotencyKey:
      overrides.requestIdempotencyKey ?? "solo-plus-review-idem-1",
    reason: overrides.reason ?? null,
    policyVersion: overrides.policyVersion ?? "solo-plus-policy-v1",
    createdAt: overrides.createdAt ?? "2026-07-10T00:00:00.000Z",
  };
}

function buildMutationResult(
  overrides: {
    outcome?: SoloPlusCaseMutationResult["outcome"];
    caseRecord?: Partial<SoloPlusCaseRecord>;
    event?: Partial<SoloPlusCaseEventRecord> | null;
  } = {},
): SoloPlusCaseMutationResult {
  return {
    outcome: overrides.outcome ?? "updated",
    caseRecord: buildCaseRecord(overrides.caseRecord),
    event:
      overrides.event === null
        ? null
        : buildEventRecord(overrides.event ?? undefined),
  };
}

function createCodeError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

async function readJson(response: Response): Promise<unknown> {
  return JSON.parse(await response.text());
}

function createJsonOnlyRequest(payload: unknown): Request {
  return {
    json: async () => payload,
  } as unknown as Request;
}

function createHandler(options: {
  guardResult?: GuardResult;
  serviceResult?: SoloPlusCaseMutationResult;
  serviceError?: unknown;
  serviceFactoryError?: unknown;
  onUnexpectedError?: (error: unknown) => void;
}) {
  const calls: {
    serviceFactory: number;
    reviewCase: number;
    reviewInput: unknown[];
  } = {
    serviceFactory: 0,
    reviewCase: 0,
    reviewInput: [],
  };

  const handler = createSoloPlusReviewRouteHandler({
    requireSuperAdminSession: async () =>
      options.guardResult || { ok: true as const, userId: "admin-user-id" },
    createReviewerService: async () => {
      calls.serviceFactory += 1;
      if (options.serviceFactoryError) {
        throw options.serviceFactoryError;
      }

      return {
        reviewerId: "trusted-reviewer-id",
        repository: {} as never,
        reviewCase: async (input) => {
          calls.reviewCase += 1;
          calls.reviewInput.push(JSON.parse(JSON.stringify(input)) as unknown);
          if (options.serviceError) {
            throw options.serviceError;
          }
          return (
            options.serviceResult ||
            buildMutationResult({
              outcome: "updated",
              caseRecord: { caseStatus: "approved", approvedByAdminId: "trusted-reviewer-id" },
              event: { eventType: "case_approved", actorId: "trusted-reviewer-id" },
            })
          );
        },
      };
    },
    onUnexpectedError: options.onUnexpectedError,
  });

  return { handler, calls };
}

async function run() {
  {
    const { handler, calls } = createHandler({
      serviceResult: buildMutationResult({
        caseRecord: {
          caseStatus: "verification_pending",
          paymentStatus: "paid",
        },
        event: {
          eventType: "case_review_requested_more_information",
          reason: "Need clearer proof of address.",
        },
      }),
    });
    const response = await handler(
      new Request("http://localhost/api/admin/solo-plus/review", {
        method: "POST",
        body: JSON.stringify({
          caseId: "11111111-1111-4111-8111-111111111111",
          expectedRowVersion: 4,
          requestIdempotencyKey: "review-more-info-1",
          decision: "request_more_information",
          reason: "Need clearer proof of address.",
        }),
      }),
    );
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 200);
    assert.equal(body.kind, "updated");
    assert.equal((body.case as Record<string, unknown>).caseStatus, "verification_pending");
    assert.equal(calls.serviceFactory, 1);
    assert.equal(calls.reviewCase, 1);
  }

  {
    const { handler } = createHandler({
      serviceResult: buildMutationResult({
        caseRecord: {
          caseStatus: "approved",
          approvedAt: "2026-07-10T00:00:00.000Z",
          approvedByAdminId: "trusted-reviewer-id",
        },
        event: {
          eventType: "case_approved",
          actorId: "trusted-reviewer-id",
        },
      }),
    });
    const response = await handler(
      new Request("http://localhost/api/admin/solo-plus/review", {
        method: "POST",
        body: JSON.stringify({
          caseId: "11111111-1111-4111-8111-111111111111",
          expectedRowVersion: 4,
          requestIdempotencyKey: "review-approve-1",
          decision: "approve",
        }),
      }),
    );
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 200);
    assert.equal((body.case as Record<string, unknown>).caseStatus, "approved");
    assert.equal("planActivated" in body, false);
  }

  {
    const { handler } = createHandler({
      serviceResult: buildMutationResult({
        caseRecord: {
          caseStatus: "rejected",
          refundStatus: "review_required",
          rejectionReason: "KYC mismatch",
          rejectedByAdminId: "trusted-reviewer-id",
        },
        event: {
          eventType: "case_rejected",
          reason: "KYC mismatch",
          actorId: "trusted-reviewer-id",
        },
      }),
    });
    const response = await handler(
      new Request("http://localhost/api/admin/solo-plus/review", {
        method: "POST",
        body: JSON.stringify({
          caseId: "11111111-1111-4111-8111-111111111111",
          expectedRowVersion: 4,
          requestIdempotencyKey: "review-reject-1",
          decision: "reject",
          reason: "KYC mismatch",
        }),
      }),
    );
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 200);
    assert.equal((body.case as Record<string, unknown>).refundStatus, "review_required");
    assert.equal("refundExecuted" in body, false);
  }

  {
    const { handler } = createHandler({
      serviceResult: buildMutationResult({
        caseRecord: {
          caseStatus: "verification_pending",
          refundStatus: "none",
          reopenedAt: "2026-07-10T00:00:00.000Z",
          reopenedByAdminId: "trusted-reviewer-id",
        },
        event: {
          eventType: "case_reopened",
          actorId: "trusted-reviewer-id",
          reason: "Retry review after document refresh.",
        },
      }),
    });
    const response = await handler(
      new Request("http://localhost/api/admin/solo-plus/review", {
        method: "POST",
        body: JSON.stringify({
          caseId: "11111111-1111-4111-8111-111111111111",
          expectedRowVersion: 4,
          requestIdempotencyKey: "review-reopen-1",
          decision: "reopen",
          reason: "Retry review after document refresh.",
        }),
      }),
    );
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 200);
    assert.equal((body.case as Record<string, unknown>).caseStatus, "verification_pending");
  }

  {
    const { handler, calls } = createHandler({
      guardResult: { ok: false, status: 401, error: "Unauthorized" },
    });
    const response = await handler(
      new Request("http://localhost/api/admin/solo-plus/review", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 401);
    assert.equal(body.code, "UNAUTHORIZED");
    assert.equal(calls.serviceFactory, 0);
    assert.equal(calls.reviewCase, 0);
  }

  {
    const { handler, calls } = createHandler({
      guardResult: { ok: false, status: 403, error: "SuperAdmin access required" },
    });
    const response = await handler(
      new Request("http://localhost/api/admin/solo-plus/review", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 403);
    assert.equal(body.code, "FORBIDDEN");
    assert.equal(calls.serviceFactory, 0);
  }

  {
    const { handler, calls } = createHandler({});
    const response = await handler(
      new Request("http://localhost/api/admin/solo-plus/review", {
        method: "POST",
        body: JSON.stringify({
          caseId: "11111111-1111-4111-8111-111111111111",
          expectedRowVersion: 4,
          requestIdempotencyKey: "review-approve-1",
          decision: "approve",
          reviewerId: "malicious-reviewer-id",
        }),
      }),
    );
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_REQUEST");
    assert.match(String(body.error), /reviewerId/i);
    assert.equal(calls.serviceFactory, 0);
  }

  {
    const { handler } = createHandler({});
    const response = await handler(
      new Request("http://localhost/api/admin/solo-plus/review", {
        method: "POST",
        body: JSON.stringify({
          caseId: "not-a-uuid",
          expectedRowVersion: 4,
          requestIdempotencyKey: "review-approve-1",
          decision: "approve",
        }),
      }),
    );
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 400);
    assert.match(String(body.error), /caseId/i);
  }

  {
    const { handler } = createHandler({});
    const response = await handler(
      new Request("http://localhost/api/admin/solo-plus/review", {
        method: "POST",
        body: JSON.stringify({
          caseId: "11111111-1111-4111-8111-111111111111",
          expectedRowVersion: 4,
          requestIdempotencyKey: "review-approve-1",
          decision: "cancel",
        }),
      }),
    );
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 400);
    assert.match(String(body.error), /Decision must be one of/i);
  }

  {
    const { handler } = createHandler({});
    const response = await handler(
      new Request("http://localhost/api/admin/solo-plus/review", {
        method: "POST",
        body: JSON.stringify({
          caseId: "11111111-1111-4111-8111-111111111111",
          expectedRowVersion: 4,
          requestIdempotencyKey: "review-more-info-1",
          decision: "request_more_information",
        }),
      }),
    );
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 400);
    assert.match(String(body.error), /reason is required/i);
  }

  {
    const { handler } = createHandler({});
    const response = await handler(
      new Request("http://localhost/api/admin/solo-plus/review", {
        method: "POST",
        body: JSON.stringify({
          caseId: "11111111-1111-4111-8111-111111111111",
          expectedRowVersion: 4,
          requestIdempotencyKey: "review-reject-1",
          decision: "reject",
          reason: "   ",
        }),
      }),
    );
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 400);
    assert.match(String(body.error), /reason is required/i);
  }

  {
    const { handler } = createHandler({
      serviceResult: buildMutationResult({
        outcome: "idempotent_replay",
        caseRecord: {
          caseStatus: "approved",
          approvedByAdminId: "trusted-reviewer-id",
        },
        event: {
          eventType: "case_approved",
          actorId: "trusted-reviewer-id",
        },
      }),
    });
    const response = await handler(
      new Request("http://localhost/api/admin/solo-plus/review", {
        method: "POST",
        body: JSON.stringify({
          caseId: "11111111-1111-4111-8111-111111111111",
          expectedRowVersion: 4,
          requestIdempotencyKey: "review-approve-1",
          decision: "approve",
        }),
      }),
    );
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 200);
    assert.equal(body.kind, "idempotent_replay");
  }

  {
    const { handler } = createHandler({
      serviceError: createCodeError(
        "SOLO_PLUS_IDEMPOTENCY_CONFLICT",
        "The idempotency key is already bound to a different Solo Plus intent.",
      ),
    });
    const response = await handler(
      new Request("http://localhost/api/admin/solo-plus/review", {
        method: "POST",
        body: JSON.stringify({
          caseId: "11111111-1111-4111-8111-111111111111",
          expectedRowVersion: 4,
          requestIdempotencyKey: "review-conflict-1",
          decision: "reject",
          reason: "Conflict",
        }),
      }),
    );
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 409);
    assert.equal(body.code, "IDEMPOTENCY_CONFLICT");
  }

  {
    const { handler } = createHandler({
      serviceError: createCodeError(
        "SOLO_PLUS_CASE_VERSION_CONFLICT",
        "Solo Plus case version conflict.",
      ),
    });
    const response = await handler(
      new Request("http://localhost/api/admin/solo-plus/review", {
        method: "POST",
        body: JSON.stringify({
          caseId: "11111111-1111-4111-8111-111111111111",
          expectedRowVersion: 4,
          requestIdempotencyKey: "review-version-1",
          decision: "approve",
        }),
      }),
    );
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 409);
    assert.equal(body.code, "VERSION_CONFLICT");
  }

  {
    const { handler } = createHandler({
      serviceError: createCodeError(
        "SOLO_PLUS_CASE_STATE_CONFLICT",
        "Solo Plus case state conflict.",
      ),
    });
    const response = await handler(
      new Request("http://localhost/api/admin/solo-plus/review", {
        method: "POST",
        body: JSON.stringify({
          caseId: "11111111-1111-4111-8111-111111111111",
          expectedRowVersion: 4,
          requestIdempotencyKey: "review-state-1",
          decision: "approve",
        }),
      }),
    );
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 409);
    assert.equal(body.code, "STATE_CONFLICT");
  }

  {
    const { handler } = createHandler({
      serviceError: createCodeError(
        "SOLO_PLUS_CASE_NOT_FOUND",
        "Solo Plus case was not found.",
      ),
    });
    const response = await handler(
      new Request("http://localhost/api/admin/solo-plus/review", {
        method: "POST",
        body: JSON.stringify({
          caseId: "11111111-1111-4111-8111-111111111111",
          expectedRowVersion: 4,
          requestIdempotencyKey: "review-not-found-1",
          decision: "approve",
        }),
      }),
    );
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 404);
    assert.equal(body.code, "NOT_FOUND");
    assert.equal(body.error, "Solo Plus case was not found.");
  }

  {
    let capturedUnexpected: unknown = null;
    const { handler } = createHandler({
      serviceError: new Error("database exploded with hidden internals"),
      onUnexpectedError: (error) => {
        capturedUnexpected = error;
      },
    });
    const response = await handler(
      new Request("http://localhost/api/admin/solo-plus/review", {
        method: "POST",
        body: JSON.stringify({
          caseId: "11111111-1111-4111-8111-111111111111",
          expectedRowVersion: 4,
          requestIdempotencyKey: "review-500-1",
          decision: "approve",
        }),
      }),
    );
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 500);
    assert.equal(body.code, "INTERNAL_ERROR");
    assert.equal(String(body.error).includes("hidden internals"), false);
    assert.ok(capturedUnexpected instanceof Error);
  }

  {
    const { handler, calls } = createHandler({
      serviceFactoryError: createCodeError(
        "SOLO_PLUS_SERVER_FORBIDDEN",
        "Solo Plus reviewer decisions require an authenticated super-admin reviewer.",
      ),
    });
    const response = await handler(
      new Request("http://localhost/api/admin/solo-plus/review", {
        method: "POST",
        body: JSON.stringify({
          caseId: "11111111-1111-4111-8111-111111111111",
          expectedRowVersion: 4,
          requestIdempotencyKey: "review-forbidden-1",
          decision: "approve",
        }),
      }),
    );
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 403);
    assert.equal(body.code, "FORBIDDEN");
    assert.equal(calls.serviceFactory, 1);
    assert.equal(calls.reviewCase, 0);
  }

  {
    const { handler } = createHandler({});
    const response = await handler(
      new Request("http://localhost/api/admin/solo-plus/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_REQUEST");
  }

  {
    const { handler, calls } = createHandler({});
    const response = await handler(createJsonOnlyRequest(null));
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_REQUEST");
    assert.equal(calls.serviceFactory, 0);
    assert.equal(calls.reviewCase, 0);
  }

  {
    const { handler, calls } = createHandler({});
    const response = await handler(createJsonOnlyRequest([]));
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_REQUEST");
    assert.equal(calls.serviceFactory, 0);
    assert.equal(calls.reviewCase, 0);
  }

  {
    const { handler, calls } = createHandler({});
    const response = await handler(
      createJsonOnlyRequest({
        caseId: "11111111-1111-4111-8111-111111111111",
        expectedRowVersion: -1,
        requestIdempotencyKey: "review-negative-version-1",
        decision: "approve",
      }),
    );
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_REQUEST");
    assert.equal(calls.serviceFactory, 0);
    assert.equal(calls.reviewCase, 0);
  }

  {
    const { handler, calls } = createHandler({});
    const response = await handler(
      createJsonOnlyRequest({
        caseId: "11111111-1111-4111-8111-111111111111",
        expectedRowVersion: 1.5,
        requestIdempotencyKey: "review-fractional-version-1",
        decision: "approve",
      }),
    );
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_REQUEST");
    assert.equal(calls.serviceFactory, 0);
    assert.equal(calls.reviewCase, 0);
  }

  {
    const { handler, calls } = createHandler({});
    const response = await handler(
      createJsonOnlyRequest({
        caseId: "11111111-1111-4111-8111-111111111111",
        expectedRowVersion: Number.MAX_SAFE_INTEGER + 1,
        requestIdempotencyKey: "review-unsafe-version-1",
        decision: "approve",
      }),
    );
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_REQUEST");
    assert.equal(calls.serviceFactory, 0);
    assert.equal(calls.reviewCase, 0);
  }

  {
    const { handler, calls } = createHandler({});
    const response = await handler(
      createJsonOnlyRequest({
        caseId: "11111111-1111-4111-8111-111111111111",
        expectedRowVersion: Number.NaN,
        requestIdempotencyKey: "review-nan-version-1",
        decision: "approve",
      }),
    );
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_REQUEST");
    assert.equal(calls.serviceFactory, 0);
    assert.equal(calls.reviewCase, 0);
  }

  {
    const { handler, calls } = createHandler({});
    const response = await handler(
      createJsonOnlyRequest({
        caseId: "11111111-1111-4111-8111-111111111111",
        expectedRowVersion: Number.POSITIVE_INFINITY,
        requestIdempotencyKey: "review-infinity-version-1",
        decision: "approve",
      }),
    );
    const body = (await readJson(response)) as Record<string, unknown>;
    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_REQUEST");
    assert.equal(calls.serviceFactory, 0);
    assert.equal(calls.reviewCase, 0);
  }

  console.log("solo-plus-review-route.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
