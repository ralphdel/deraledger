import assert from "node:assert/strict";

import { createSoloPlusCaseEvidenceRouteHandler } from "../src/app/api/solo-plus/case/requirements/evidence/route";
import { assertSameOriginBrowserMutationRequest } from "../src/lib/server/browser-origin";
import type {
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
    caseStatus: overrides.caseStatus ?? "verification_pending",
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
    rowVersion: overrides.rowVersion ?? 2,
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
    metadata: overrides.metadata ?? { rawEvidencePayload: "hidden" },
    createdAt: overrides.createdAt ?? "2026-07-10T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-10T00:00:00.000Z",
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

function createEvidencePostRequest(options: {
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
  return new Request(
    options.url || "https://app.example.test/api/solo-plus/case/requirements/evidence",
    {
      method: "POST",
      headers: requestHeaders,
      body: typeof options.body === "string" ? options.body : JSON.stringify(options.body),
    },
  );
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
  }

  assert.equal("auditMetadata" in caseDto, false);
  assert.equal("paymentProvider" in caseDto, false);
}

function createHandler(options: {
  authenticated?: boolean;
  userId?: string;
  email?: string | null;
  serviceResult?: {
    caseRecord: SoloPlusCaseRecord;
    requirements: readonly SoloPlusCaseRequirementRecord[];
    decisions: Record<string, unknown>;
    merchantId: string | null;
  };
  serviceError?: unknown;
  originGuard?: (request: Request) => { origin: string; requestOrigin: string };
}) {
  const calls = {
    submitEvidence: 0,
    createOrResumeCase: 0,
    readCurrentCase: 0,
    submitInput: [] as unknown[],
  };

  const handler = createSoloPlusCaseEvidenceRouteHandler({
    requireAuthenticatedSession: async () =>
      options.authenticated === false
        ? { ok: false as const, status: 401, error: "Unauthorized" }
        : {
            ok: true as const,
            userId: options.userId ?? "merchant-user-id",
            email: options.email ?? "merchant@example.test",
          },
    createBrowserCaseService: async () => ({
      createOrResumeCase: async () => {
        calls.createOrResumeCase += 1;
        throw new Error("createOrResumeCase not expected in evidence route test.");
      },
      readCurrentCase: async () => {
        calls.readCurrentCase += 1;
        throw new Error("readCurrentCase not expected in evidence route test.");
      },
      submitEvidence: async (input) => {
        calls.submitEvidence += 1;
        calls.submitInput.push(JSON.parse(JSON.stringify(input)) as unknown);
        if (options.serviceError) {
          throw options.serviceError;
        }
        return (
          options.serviceResult || {
            caseRecord: buildCaseRecord(),
            requirements: [
              buildRequirementRecord({
                requirementCode: "activity_profile",
                requirementState: "pending",
                evidenceSourceType: "manual_submission",
                evidenceReference: "activity_profile",
              }),
            ],
            decisions: { activity_profile: null },
            merchantId: "22222222-2222-4222-8222-222222222222",
          }
        );
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
      serviceResult: {
        caseRecord: buildCaseRecord({
          caseStatus: "verification_pending",
          flowOrigin: "onboarding",
          onboardingSessionId: "55555555-5555-4555-8555-555555555555",
          merchantId: null,
        }),
        requirements: [
          buildRequirementRecord({
            requirementCode: "id_document",
            requirementState: "pending",
            evidenceSourceType: "merchant_document",
            evidenceReference: "kyc-documents/id-document.pdf",
            providerReference: "doc-upload-1",
          }),
        ],
        decisions: { id_document: null },
        merchantId: null,
      },
    });
    const response = await handler(
      createEvidencePostRequest({
        body: {
          caseId: "11111111-1111-4111-8111-111111111111",
          onboardingSessionId: "55555555-5555-4555-8555-555555555555",
          idDocument: {
            storageKey: "kyc-documents/id-document.pdf",
            checksumSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            uploadedAt: "2026-07-07T00:00:00.000Z",
            contentType: "application/pdf",
            fileSizeBytes: 2048,
            providerName: "manual_upload",
            providerReference: "doc-upload-1",
          },
        },
      }),
    );
    const body = await readJson(response);
    assert.equal(response.status, 200);
    assert.equal(body.kind, "updated");
    assert.equal(calls.submitEvidence, 1);
    assert.deepEqual(calls.submitInput[0], {
      caseId: "11111111-1111-4111-8111-111111111111",
      onboardingSessionId: "55555555-5555-4555-8555-555555555555",
      idDocument: {
        storageKey: "kyc-documents/id-document.pdf",
        checksumSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        uploadedAt: "2026-07-07T00:00:00.000Z",
        contentType: "application/pdf",
        fileSizeBytes: 2048,
        providerName: "manual_upload",
        providerReference: "doc-upload-1",
      },
      activityProfile: null,
      proofOfAddress: null,
    });
    assert.equal(calls.createOrResumeCase, 0);
    assert.equal(calls.readCurrentCase, 0);
    assertSafeCaseDto(body.case as Record<string, unknown>);
  }

  {
    const { handler } = createHandler({
      originGuard: createOriginGuard(),
      serviceResult: {
        caseRecord: buildCaseRecord(),
        requirements: [
          buildRequirementRecord({
            requirementCode: "proof_of_address",
            requirementState: "reused",
            evidenceSourceType: "merchant_document",
            evidenceReference: "kyc-documents/address.pdf",
          }),
        ],
        decisions: { proof_of_address: { outcome: "reusable" } },
        merchantId: "22222222-2222-4222-8222-222222222222",
      },
    });
    const response = await handler(
      createEvidencePostRequest({
        body: {
          caseId: "11111111-1111-4111-8111-111111111111",
          proofOfAddress: {
            storageKey: "kyc-documents/address.pdf",
            uploadedAt: "2026-07-07T00:00:00.000Z",
            providerReference: "address-ref-1",
          },
        },
      }),
    );
    const body = await readJson(response);
    assert.equal(response.status, 200);
    assert.equal(body.kind, "updated");
    assertSafeCaseDto(body.case as Record<string, unknown>);
  }

  {
    const { handler } = createHandler({ authenticated: false });
    const response = await handler(
      createEvidencePostRequest({
        body: { caseId: "11111111-1111-4111-8111-111111111111" },
      }),
    );
    const body = await readJson(response);
    assert.equal(response.status, 401);
    assert.equal(body.code, "UNAUTHORIZED");
  }

  for (const headers of [
    { "content-type": "application/json" },
    { origin: "https://evil.example.test", "content-type": "application/json" },
    { origin: "https://user:password@app.example.test", "content-type": "application/json" },
  ]) {
    const { handler, calls } = createHandler({
      originGuard: createOriginGuard(toEnv({ CANONICAL_APP_URL: "https://app.example.test" })),
    });
    const response = await handler(
      createEvidencePostRequest({
        body: { caseId: "11111111-1111-4111-8111-111111111111" },
        headers,
        omitOrigin: !("origin" in headers),
      }),
    );
    const body = await readJson(response);
    assert.equal(response.status, 403);
    assert.equal(body.code, "FORBIDDEN");
    assert.equal(calls.submitEvidence, 0);
  }

  {
    const { handler } = createHandler({ originGuard: createOriginGuard() });
    const response = await handler(createEvidencePostRequest({ body: "{" }));
    const body = await readJson(response);
    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_REQUEST");
  }

  for (const invalidBody of [null, []]) {
    const { handler, calls } = createHandler({ originGuard: createOriginGuard() });
    const response = await handler(createEvidencePostRequest({ body: invalidBody }));
    const body = await readJson(response);
    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_REQUEST");
    assert.equal(calls.submitEvidence, 0);
  }

  {
    const { handler } = createHandler({ originGuard: createOriginGuard() });
    const response = await handler(
      createEvidencePostRequest({
        body: { caseId: "11111111-1111-4111-8111-111111111111" },
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
    const response = await handler(
      createEvidencePostRequest({
        body: {
          caseId: "11111111-1111-4111-8111-111111111111",
          activityProfile: {
            businessActivityType: "retail",
            expectedMonthlyTransactionValue: "500000",
            expectedTransactionCount: 150,
            typicalCustomerType: "consumers",
            reasonForHigherCollectionNeed: "x".repeat(96 * 1024),
            expectedSettlementBehaviour: "daily",
          },
        },
      }),
    );
    const body = await readJson(response);
    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_REQUEST");
  }

  for (const body of [
    { caseId: "not-a-uuid" },
    { caseId: "11111111-1111-4111-8111-111111111111", requirementType: "id_document" },
    { caseId: "11111111-1111-4111-8111-111111111111", expectedRowVersion: -1 },
    { caseId: "11111111-1111-4111-8111-111111111111", expectedRowVersion: 1.5 },
    { caseId: "11111111-1111-4111-8111-111111111111", requestIdempotencyKey: "evidence-idem-1" },
    { caseId: "11111111-1111-4111-8111-111111111111", requestIdempotencyKey: "x".repeat(129) },
    { caseId: "11111111-1111-4111-8111-111111111111", merchantId: "malicious-merchant-id" },
    { caseId: "11111111-1111-4111-8111-111111111111", actorId: "spoofed" },
    { caseId: "11111111-1111-4111-8111-111111111111", reviewerId: "spoofed" },
    { caseId: "11111111-1111-4111-8111-111111111111", activatorId: "spoofed" },
    { caseId: "11111111-1111-4111-8111-111111111111", passed: true },
    { caseId: "11111111-1111-4111-8111-111111111111", reused: true },
    { caseId: "11111111-1111-4111-8111-111111111111", waived: true },
    { caseId: "11111111-1111-4111-8111-111111111111", rejected: true },
    { caseId: "11111111-1111-4111-8111-111111111111", providerDecision: "passed" },
  ]) {
    const { handler, calls } = createHandler({ originGuard: createOriginGuard() });
    const response = await handler(createEvidencePostRequest({ body }));
    const payload = await readJson(response);
    assert.equal(response.status, 400);
    assert.equal(payload.code, "INVALID_REQUEST");
    assert.equal(calls.submitEvidence, 0);
  }

  for (const badDocument of [
    {
      storageKey: "../escape.pdf",
      uploadedAt: "2026-07-07T00:00:00.000Z",
    },
    {
      storageKey: "C:\\temp\\proof.pdf",
      uploadedAt: "2026-07-07T00:00:00.000Z",
    },
    {
      storageKey: "https://user:password@example.test/proof.pdf",
      uploadedAt: "2026-07-07T00:00:00.000Z",
    },
    {
      storageKey: "kyc-documents/proof.pdf",
      uploadedAt: "not-a-timestamp",
    },
    {
      storageKey: "kyc-documents/proof.pdf",
      uploadedAt: "2026-07-07T00:00:00.000Z",
      providerReference: "https://provider.example.test/request/1",
    },
    {
      storageKey: "kyc-documents/proof.pdf",
      uploadedAt: "2026-07-07T00:00:00.000Z",
      checksumSha256: "not-a-sha256",
    },
  ]) {
    const { handler, calls } = createHandler({ originGuard: createOriginGuard() });
    const response = await handler(
      createEvidencePostRequest({
        body: {
          caseId: "11111111-1111-4111-8111-111111111111",
          proofOfAddress: badDocument,
        },
      }),
    );
    const body = await readJson(response);
    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_REQUEST");
    assert.equal(calls.submitEvidence, 0);
  }

  {
    const { handler } = createHandler({
      originGuard: createOriginGuard(),
      serviceError: Object.assign(new Error("Solo Plus case was not found."), {
        code: "SOLO_PLUS_CASE_OWNERSHIP_CONFLICT",
      }),
    });
    const response = await handler(
      createEvidencePostRequest({
        body: { caseId: "11111111-1111-4111-8111-111111111111" },
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
      userId: "team-member-user-id",
      email: "team-member@example.test",
      serviceError: Object.assign(new Error("Solo Plus case was not found."), {
        code: "SOLO_PLUS_SERVER_NOT_FOUND",
      }),
    });
    const response = await handler(
      createEvidencePostRequest({
        body: { caseId: "11111111-1111-4111-8111-111111111111" },
      }),
    );
    const body = await readJson(response);
    assert.equal(response.status, 404);
    assert.equal(body.code, "NOT_FOUND");
    assert.equal(body.error, "Solo Plus case was not found.");
  }

  for (const [code, expectedStatus, expectedPublicCode] of [
    ["SOLO_PLUS_SERVER_NOT_FOUND", 404, "NOT_FOUND"],
    ["SOLO_PLUS_IDEMPOTENCY_CONFLICT", 409, "IDEMPOTENCY_CONFLICT"],
    ["SOLO_PLUS_CASE_VERSION_CONFLICT", 409, "VERSION_CONFLICT"],
    ["SOLO_PLUS_CASE_STATE_CONFLICT", 409, "STATE_CONFLICT"],
    ["SOLO_PLUS_CASE_PREREQUISITE_CONFLICT", 409, "PREREQUISITE_CONFLICT"],
  ] as const) {
    const { handler } = createHandler({
      originGuard: createOriginGuard(),
      serviceError: Object.assign(new Error("hidden internal details"), { code }),
    });
    const response = await handler(
      createEvidencePostRequest({
        body: { caseId: "11111111-1111-4111-8111-111111111111" },
      }),
    );
    const body = await readJson(response);
    assert.equal(response.status, expectedStatus);
    assert.equal(body.code, expectedPublicCode);
    assert.equal(String(body.error).includes("hidden internal details"), false);
  }

  console.log("solo-plus-case-evidence-route.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
