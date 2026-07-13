import assert from "node:assert/strict";

import { createSoloPlusCaseRouteHandler } from "../src/app/api/solo-plus/case/route";
import { assertSameOriginBrowserMutationRequest } from "../src/lib/server/browser-origin";
import type {
  SoloPlusCaseCreationResult,
  SoloPlusCaseEventRecord,
  SoloPlusCaseRecord,
  SoloPlusCaseRequirementRecord,
} from "../src/lib/solo-plus/repository";

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
    requirementsPolicyVersion: overrides.requirementsPolicyVersion ?? "solo-plus-payment-init-v1",
    requirementsSnapshot: overrides.requirementsSnapshot ?? {},
    activePlanSnapshot: overrides.activePlanSnapshot ?? "solo_lite",
    rejectionReason: overrides.rejectionReason ?? null,
    approvedAt: overrides.approvedAt ?? null,
    approvedByAdminId: overrides.approvedByAdminId ?? null,
    rejectedAt: overrides.rejectedAt ?? null,
    rejectedByAdminId: overrides.rejectedByAdminId ?? null,
    reopenedAt: overrides.reopenedAt ?? null,
    reopenedByAdminId: overrides.reopenedByAdminId ?? null,
    idempotencyKey: overrides.idempotencyKey ?? "solo-plus-case-idem",
    activationIdempotencyKey: overrides.activationIdempotencyKey ?? null,
    refundIdempotencyKey: overrides.refundIdempotencyKey ?? null,
    rowVersion: overrides.rowVersion ?? 1,
    auditMetadata: overrides.auditMetadata ?? { internal: "hidden" },
    createdAt: overrides.createdAt ?? "2026-07-10T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-10T00:00:00.000Z",
  };
}

function buildRequirementRecord(
  overrides: Partial<SoloPlusCaseRequirementRecord> & {
    requirementCode: SoloPlusCaseRequirementRecord["requirementCode"];
  },
): SoloPlusCaseRequirementRecord {
  return {
    id: `${overrides.requirementCode}-requirement`,
    caseId: overrides.caseId || "11111111-1111-4111-8111-111111111111",
    requirementCode: overrides.requirementCode,
    requirementState: overrides.requirementState ?? "not_started",
    verificationLogId: overrides.verificationLogId ?? null,
    evidenceSourceType: overrides.evidenceSourceType ?? null,
    evidenceSourceId: overrides.evidenceSourceId ?? null,
    evidenceReference: overrides.evidenceReference ?? null,
    originalCompletedAt: overrides.originalCompletedAt ?? null,
    reuseDecisionAt: overrides.reuseDecisionAt ?? null,
    reuseReason: overrides.reuseReason ?? null,
    policyRuleApplied: overrides.policyRuleApplied ?? null,
    reviewedByAdminId: overrides.reviewedByAdminId ?? null,
    reviewNote: overrides.reviewNote ?? null,
    providerName: overrides.providerName ?? null,
    providerReference: overrides.providerReference ?? null,
    failureReason: overrides.failureReason ?? null,
    completedAt: overrides.completedAt ?? null,
    metadata: overrides.metadata ?? { rawProviderPayload: "hidden" },
    createdAt: overrides.createdAt ?? "2026-07-10T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-10T00:00:00.000Z",
  };
}

function buildCreationResult(
  overrides: {
    outcome?: SoloPlusCaseCreationResult["outcome"];
    caseRecord?: Partial<SoloPlusCaseRecord>;
    requirements?: Array<
      Partial<SoloPlusCaseRequirementRecord> & {
        requirementCode: SoloPlusCaseRequirementRecord["requirementCode"];
      }
    >;
    createdEvent?: Partial<SoloPlusCaseEventRecord> | null;
  } = {},
): SoloPlusCaseCreationResult {
  return {
    outcome: overrides.outcome ?? "created",
    caseRecord: buildCaseRecord(overrides.caseRecord),
    requirements: overrides.requirements
      ? overrides.requirements.map((requirement) => buildRequirementRecord(requirement))
      : [
          buildRequirementRecord({
            requirementCode: "bvn",
            requirementState: "passed",
            evidenceSourceType: "verification_log",
            evidenceReference: "safe-ref-1",
            providerReference: "provider-ref-1",
          }),
        ],
    createdEvent:
      overrides.createdEvent === null
        ? null
        : ({
            id: "33333333-3333-4333-8333-333333333333",
            caseId: "11111111-1111-4111-8111-111111111111",
            eventType: "case_created",
            previousState: {},
            newState: {},
            actorType: "merchant",
            actorId: "merchant-user-id",
            requestIdempotencyKey: "create-case-idem",
            reason: null,
            policyVersion: "solo-plus-payment-init-v1",
            createdAt: "2026-07-10T00:00:00.000Z",
            ...overrides.createdEvent,
          } satisfies SoloPlusCaseEventRecord),
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await response.text()) as Record<string, unknown>;
}

function toEnv(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as unknown as NodeJS.ProcessEnv;
}

function createOriginGuard(env: NodeJS.ProcessEnv = toEnv({})) {
  return (request: Request) => assertSameOriginBrowserMutationRequest(request, { env });
}

function createCasePostRequest(options: {
  body?: unknown;
  headers?: Record<string, string | undefined>;
  url?: string;
  omitOrigin?: boolean;
} = {}): Request {
  const requestHeaders = Object.fromEntries(
    Object.entries({
      ...(options.omitOrigin ? {} : { origin: "https://app.example.test" }),
      "content-type": "application/json",
      ...(options.headers || {}),
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  return new Request(options.url || "https://app.example.test/api/solo-plus/case", {
    method: "POST",
    headers: requestHeaders,
    body: typeof options.body === "string" ? options.body : JSON.stringify(options.body),
  });
}

function assertSafeCaseDto(caseDto: Record<string, unknown>) {
  assert.deepEqual(Object.keys(caseDto).sort(), [
    "activationState",
    "caseId",
    "caseStatus",
    "createdAt",
    "flowOrigin",
    "paymentStatus",
    "refundStatus",
    "requirements",
    "reviewOutcome",
    "rowVersion",
    "updatedAt",
  ]);

  const requirements = caseDto.requirements as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(requirements));
  for (const requirement of requirements) {
    assert.deepEqual(Object.keys(requirement).sort(), [
      "completedAt",
      "evidenceReference",
      "evidenceSourceType",
      "requirementCode",
      "requirementState",
      "updatedAt",
    ]);
    assert.equal("providerReference" in requirement, false);
    assert.equal("providerName" in requirement, false);
    assert.equal("metadata" in requirement, false);
    assert.equal("rawProviderPayload" in requirement, false);
  }

  assert.equal("merchantId" in caseDto, false);
  assert.equal("paymentProvider" in caseDto, false);
  assert.equal("paymentReference" in caseDto, false);
  assert.equal("auditMetadata" in caseDto, false);
}

function createHandler(options: {
  authenticated?: boolean;
  userId?: string;
  email?: string | null;
  serviceResult?: SoloPlusCaseCreationResult;
  readResult?: {
    caseRecord: SoloPlusCaseRecord;
    requirements: readonly SoloPlusCaseRequirementRecord[];
  } | null;
  createServiceError?: unknown;
  readServiceError?: unknown;
  originGuard?: (request: Request) => { origin: string; requestOrigin: string };
}) {
  const calls = {
    createOrResumeCase: 0,
    readCurrentCase: 0,
    submitEvidence: 0,
    createInput: [] as unknown[],
    readInput: [] as unknown[],
  };

  const handler = createSoloPlusCaseRouteHandler({
    requireAuthenticatedSession: async () =>
      options.authenticated === false
        ? { ok: false as const, status: 401, error: "Unauthorized" }
        : {
            ok: true as const,
            userId: options.userId ?? "merchant-user-id",
            email: options.email ?? "merchant@example.test",
          },
    createBrowserCaseService: async () => ({
      createOrResumeCase: async (input) => {
        calls.createOrResumeCase += 1;
        calls.createInput.push(JSON.parse(JSON.stringify(input)) as unknown);
        if (options.createServiceError) {
          throw options.createServiceError;
        }
        return options.serviceResult || buildCreationResult();
      },
      readCurrentCase: async (input) => {
        calls.readCurrentCase += 1;
        calls.readInput.push(JSON.parse(JSON.stringify(input)) as unknown);
        if (options.readServiceError) {
          throw options.readServiceError;
        }
        return options.readResult === undefined
          ? {
              caseRecord: buildCaseRecord(),
              requirements: [
                buildRequirementRecord({
                  requirementCode: "bvn",
                  requirementState: "passed",
                  evidenceSourceType: "verification_log",
                  evidenceReference: "safe-ref-1",
                }),
              ],
            }
          : options.readResult;
      },
      submitEvidence: async () => {
        calls.submitEvidence += 1;
        throw new Error("submitEvidence not expected in case route test.");
      },
    }),
    assertBrowserMutationOriginRequest: options.originGuard,
  });

  return { handler, calls };
}

async function run() {
  {
    const { handler, calls } = createHandler({
      originGuard: createOriginGuard(toEnv({ CANONICAL_APP_URL: "https://app.example.test" })),
      serviceResult: buildCreationResult({
        outcome: "created",
        caseRecord: { caseStatus: "draft", flowOrigin: "onboarding", merchantId: null },
      }),
    });
    const response = await handler.POST(
      createCasePostRequest({
        body: {
          flowOrigin: "onboarding",
          onboardingSessionId: "55555555-5555-4555-8555-555555555555",
          requestIdempotencyKey: "create-case-1",
        },
      }),
    );
    const body = await readJson(response);
    assert.equal(response.status, 200);
    assert.equal(body.kind, "created");
    assert.equal(calls.createOrResumeCase, 1);
    assert.deepEqual(calls.createInput[0], {
      flowOrigin: "onboarding",
      onboardingSessionId: "55555555-5555-4555-8555-555555555555",
      requestIdempotencyKey: "create-case-1",
    });
    assertSafeCaseDto(body.case as Record<string, unknown>);
  }

  {
    const { handler } = createHandler({
      originGuard: createOriginGuard(),
      serviceResult: buildCreationResult({ outcome: "existing_active_case" }),
    });
    const response = await handler.POST(
      createCasePostRequest({
        body: {
          flowOrigin: "upgrade",
          requestIdempotencyKey: "create-case-resume-1",
        },
      }),
    );
    const body = await readJson(response);
    assert.equal(response.status, 200);
    assert.equal(body.kind, "existing_active_case");
  }

  {
    const { handler } = createHandler({ authenticated: false });
    const response = await handler.POST(
      createCasePostRequest({
        body: { flowOrigin: "upgrade", requestIdempotencyKey: "unauth" },
      }),
    );
    const body = await readJson(response);
    assert.equal(response.status, 401);
    assert.equal(body.code, "UNAUTHORIZED");
  }

  {
    const { handler, calls } = createHandler({ originGuard: createOriginGuard() });
    const response = await handler.POST(createCasePostRequest({ body: "{" }));
    const body = await readJson(response);
    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_REQUEST");
    assert.equal(calls.createOrResumeCase, 0);
  }

  for (const invalidBody of [null, []]) {
    const { handler, calls } = createHandler({ originGuard: createOriginGuard() });
    const response = await handler.POST(createCasePostRequest({ body: invalidBody }));
    const body = await readJson(response);
    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_REQUEST");
    assert.equal(calls.createOrResumeCase, 0);
  }

  {
    const { handler } = createHandler({ originGuard: createOriginGuard() });
    const response = await handler.POST(
      createCasePostRequest({
        body: { flowOrigin: "upgrade", requestIdempotencyKey: "content-type" },
        headers: {
          origin: "https://app.example.test",
          "content-type": "text/plain",
        },
      }),
    );
    const body = await readJson(response);
    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_REQUEST");
  }

  {
    const { handler } = createHandler({ originGuard: createOriginGuard() });
    const response = await handler.POST(
      createCasePostRequest({
        body: {
          flowOrigin: "upgrade",
          requestIdempotencyKey: "x".repeat(65 * 1024),
        },
      }),
    );
    const body = await readJson(response);
    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_REQUEST");
  }

  for (const body of [
    { flowOrigin: "upgrade" },
    { flowOrigin: "upgrade", requestIdempotencyKey: "   " },
    { flowOrigin: "upgrade", requestIdempotencyKey: "x".repeat(129) },
  ]) {
    const { handler } = createHandler({ originGuard: createOriginGuard() });
    const response = await handler.POST(createCasePostRequest({ body }));
    const payload = await readJson(response);
    assert.equal(response.status, 400);
    assert.equal(payload.code, "INVALID_REQUEST");
  }

  for (const forbiddenField of [
    "merchantId",
    "userId",
    "actorId",
    "actorType",
    "reviewerId",
    "reviewerAdminId",
    "activatorId",
    "activatorAdminId",
    "serviceRole",
    "serviceRoleKey",
    "serviceRoleToken",
    "caseStatus",
    "paymentStatus",
    "refundStatus",
    "approvedAt",
    "liveFeaturesEnabled",
    "setupMode",
    "subscriptionPlan",
    "merchantTier",
  ]) {
    const { handler, calls } = createHandler({ originGuard: createOriginGuard() });
    const response = await handler.POST(
      createCasePostRequest({
        body: {
          flowOrigin: "upgrade",
          requestIdempotencyKey: "forbidden-field",
          [forbiddenField]: "spoofed",
        },
      }),
    );
    const body = await readJson(response);
    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_REQUEST");
    assert.equal(calls.createOrResumeCase, 0);
  }

  for (const headers of [
    { "content-type": "application/json" },
    { origin: "https://evil.example.test", "content-type": "application/json" },
    { origin: "https://user:password@app.example.test", "content-type": "application/json" },
  ]) {
    const { handler, calls } = createHandler({
      originGuard: createOriginGuard(toEnv({ CANONICAL_APP_URL: "https://app.example.test" })),
    });
    const response = await handler.POST(
      createCasePostRequest({
        body: { flowOrigin: "upgrade", requestIdempotencyKey: "origin-check" },
        headers,
        omitOrigin: !("origin" in headers),
      }),
    );
    const body = await readJson(response);
    assert.equal(response.status, 403);
    assert.equal(body.code, "FORBIDDEN");
    assert.equal(calls.createOrResumeCase, 0);
  }

  {
    const { handler } = createHandler({
      originGuard: createOriginGuard(),
      serviceResult: buildCreationResult({ outcome: "idempotent_replay" }),
    });
    const response = await handler.POST(
      createCasePostRequest({
        body: { flowOrigin: "upgrade", requestIdempotencyKey: "create-case-replay-1" },
      }),
    );
    const body = await readJson(response);
    assert.equal(response.status, 200);
    assert.equal(body.kind, "idempotent_replay");
    assertSafeCaseDto(body.case as Record<string, unknown>);
  }

  {
    const { handler } = createHandler({
      originGuard: createOriginGuard(),
      createServiceError: Object.assign(new Error("idempotency conflict"), {
        code: "SOLO_PLUS_IDEMPOTENCY_CONFLICT",
      }),
    });
    const response = await handler.POST(
      createCasePostRequest({
        body: { flowOrigin: "upgrade", requestIdempotencyKey: "create-case-conflict" },
      }),
    );
    const body = await readJson(response);
    assert.equal(response.status, 409);
    assert.equal(body.code, "IDEMPOTENCY_CONFLICT");
  }

  {
    const { handler } = createHandler({
      originGuard: createOriginGuard(),
      createServiceError: Object.assign(new Error("state conflict"), {
        code: "SOLO_PLUS_CASE_STATE_CONFLICT",
      }),
    });
    const response = await handler.POST(
      createCasePostRequest({
        body: { flowOrigin: "upgrade", requestIdempotencyKey: "create-case-state" },
      }),
    );
    const body = await readJson(response);
    assert.equal(response.status, 409);
    assert.equal(body.code, "STATE_CONFLICT");
  }

  {
    const { handler } = createHandler({
      originGuard: createOriginGuard(),
      createServiceError: Object.assign(new Error("version conflict"), {
        code: "SOLO_PLUS_CASE_VERSION_CONFLICT",
      }),
    });
    const response = await handler.POST(
      createCasePostRequest({
        body: { flowOrigin: "upgrade", requestIdempotencyKey: "create-case-version" },
      }),
    );
    const body = await readJson(response);
    assert.equal(response.status, 409);
    assert.equal(body.code, "VERSION_CONFLICT");
  }

  {
    const { handler } = createHandler({
      originGuard: createOriginGuard(),
      createServiceError: Object.assign(new Error("Solo Plus case was not found."), {
        code: "SOLO_PLUS_SERVER_NOT_FOUND",
      }),
    });
    const response = await handler.POST(
      createCasePostRequest({
        body: { flowOrigin: "upgrade", requestIdempotencyKey: "owner-only" },
      }),
    );
    const body = await readJson(response);
    assert.equal(response.status, 404);
    assert.equal(body.code, "NOT_FOUND");
  }

  {
    const { handler } = createHandler({
      originGuard: createOriginGuard(),
      userId: "team-member-user-id",
      email: "team-member@example.test",
      createServiceError: Object.assign(new Error("Solo Plus case was not found."), {
        code: "SOLO_PLUS_SERVER_NOT_FOUND",
      }),
    });
    const response = await handler.POST(
      createCasePostRequest({
        body: { flowOrigin: "upgrade", requestIdempotencyKey: "team-member-create-resume" },
      }),
    );
    const body = await readJson(response);
    assert.equal(response.status, 404);
    assert.equal(body.code, "NOT_FOUND");
    assert.equal(body.error, "Solo Plus case was not found.");
  }

  {
    const { handler } = createHandler({
      originGuard: createOriginGuard(),
      createServiceError: new Error("hidden supabase details"),
    });
    const response = await handler.POST(
      createCasePostRequest({
        body: { flowOrigin: "upgrade", requestIdempotencyKey: "unexpected-create-failure" },
      }),
    );
    const body = await readJson(response);
    assert.equal(response.status, 500);
    assert.equal(body.code, "INTERNAL_ERROR");
    assert.equal(String(body.error).includes("hidden supabase details"), false);
  }

  {
    const { handler, calls } = createHandler({
      readResult: {
        caseRecord: buildCaseRecord({
          caseStatus: "verification_pending",
          flowOrigin: "upgrade",
          merchantId: "22222222-2222-4222-8222-222222222222",
        }),
        requirements: [
          buildRequirementRecord({
            requirementCode: "activity_profile",
            requirementState: "pending",
            evidenceSourceType: "manual_submission",
            evidenceReference: "activity_profile",
          }),
        ],
      },
    });
    const response = await handler.GET(
      new Request("https://app.example.test/api/solo-plus/case"),
    );
    const body = await readJson(response);
    assert.equal(response.status, 200);
    assert.equal(body.kind, "current_case");
    assert.equal(calls.readCurrentCase, 1);
    assertSafeCaseDto(body.case as Record<string, unknown>);
  }

  {
    const { handler, calls } = createHandler({
      readResult: {
        caseRecord: buildCaseRecord({
          caseStatus: "verification_pending",
          flowOrigin: "onboarding",
          onboardingSessionId: "55555555-5555-4555-8555-555555555555",
          merchantId: null,
        }),
        requirements: [
          buildRequirementRecord({
            requirementCode: "bvn",
            requirementState: "passed",
            evidenceSourceType: "verification_log",
            evidenceReference: "safe-ref-1",
            providerReference: "hidden-provider-ref",
          }),
        ],
      },
    });
    const response = await handler.GET(
      new Request(
        "https://app.example.test/api/solo-plus/case?caseId=11111111-1111-4111-8111-111111111111&onboardingSessionId=55555555-5555-4555-8555-555555555555",
      ),
    );
    const body = await readJson(response);
    assert.equal(response.status, 200);
    assert.equal(body.kind, "current_case");
    assert.equal(calls.readCurrentCase, 1);
    assert.equal(
      response.headers.get("cache-control"),
      "private, no-store, max-age=0",
    );
    assertSafeCaseDto(body.case as Record<string, unknown>);
  }

  {
    const { handler } = createHandler({
      readResult: {
        caseRecord: buildCaseRecord({
          flowOrigin: "onboarding",
          onboardingSessionId: "55555555-5555-4555-8555-555555555555",
          merchantId: null,
        }),
        requirements: [buildRequirementRecord({ requirementCode: "proof_of_address" })],
      },
    });
    const response = await handler.GET(
      new Request(
        "https://app.example.test/api/solo-plus/case?onboardingSessionId=55555555-5555-4555-8555-555555555555",
      ),
    );
    const body = await readJson(response);
    assert.equal(response.status, 200);
    assert.equal(body.kind, "current_case");
    assertSafeCaseDto(body.case as Record<string, unknown>);
  }

  {
    const { handler } = createHandler({ authenticated: false });
    const response = await handler.GET(
      new Request("https://app.example.test/api/solo-plus/case"),
    );
    const body = await readJson(response);
    assert.equal(response.status, 401);
    assert.equal(body.code, "UNAUTHORIZED");
  }

  {
    const { handler } = createHandler({ readResult: null });
    const response = await handler.GET(
      new Request("https://app.example.test/api/solo-plus/case"),
    );
    const body = await readJson(response);
    assert.equal(response.status, 404);
    assert.equal(body.code, "NOT_FOUND");
  }

  {
    const { handler } = createHandler({
      readServiceError: Object.assign(new Error("Solo Plus case was not found."), {
        code: "SOLO_PLUS_CASE_OWNERSHIP_CONFLICT",
      }),
    });
    const response = await handler.GET(
      new Request(
        "https://app.example.test/api/solo-plus/case?caseId=11111111-1111-4111-8111-111111111111",
      ),
    );
    const body = await readJson(response);
    assert.equal(response.status, 404);
    assert.equal(body.code, "NOT_FOUND");
    assert.equal(body.error, "Solo Plus case was not found.");
  }

  {
    const { handler } = createHandler({
      userId: "team-member-user-id",
      email: "team-member@example.test",
      readServiceError: Object.assign(new Error("Solo Plus case was not found."), {
        code: "SOLO_PLUS_SERVER_NOT_FOUND",
      }),
    });
    const response = await handler.GET(
      new Request("https://app.example.test/api/solo-plus/case"),
    );
    const body = await readJson(response);
    assert.equal(response.status, 404);
    assert.equal(body.code, "NOT_FOUND");
    assert.equal(body.error, "Solo Plus case was not found.");
  }

  {
    const { handler } = createHandler({
      readServiceError: new Error("hidden postgres details"),
    });
    const response = await handler.GET(
      new Request("https://app.example.test/api/solo-plus/case"),
    );
    const body = await readJson(response);
    assert.equal(response.status, 500);
    assert.equal(body.code, "INTERNAL_ERROR");
    assert.equal(String(body.error).includes("hidden postgres details"), false);
  }

  console.log("solo-plus-case-route.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
