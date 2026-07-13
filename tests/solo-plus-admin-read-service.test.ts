import assert from "node:assert/strict";
import { createRequire } from "node:module";

import type {
  SoloPlusAdminCaseDetailRecord,
  SoloPlusAdminCaseEventListInput,
  SoloPlusAdminCaseEventListResult,
  SoloPlusAdminCaseListInput,
  SoloPlusAdminCaseListResult,
  SoloPlusCaseActivationAtomicParams,
  SoloPlusCaseActivationAtomicResult,
  SoloPlusCaseCreateAtomicInput,
  SoloPlusCaseCreateAtomicResult,
  SoloPlusCaseEventRecord,
  SoloPlusCaseRecord,
  SoloPlusCaseRepository,
  SoloPlusCaseRequirementRecord,
  SoloPlusCaseTransitionAtomicParams,
  SoloPlusCaseTransitionAtomicResult,
  SoloPlusAttachMerchantAtomicParams,
  SoloPlusAttachMerchantAtomicResult,
} from "../src/lib/solo-plus/repository";

type AdminReadServiceModule = typeof import("../src/lib/solo-plus/server/admin-read-service");

let createSoloPlusAdminReadService: AdminReadServiceModule["createSoloPlusAdminReadService"];
let SoloPlusAdminReadServiceError: AdminReadServiceModule["SoloPlusAdminReadServiceError"];

type FakeUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
  email_confirmed_at?: string | null;
};

class FakeAuthClient {
  currentUser: FakeUser | null = null;

  auth = {
    getUser: async () => ({
      data: { user: this.currentUser },
      error: this.currentUser ? null : { message: "missing user" },
    }),
  };
}

class FakeSoloPlusRepository implements SoloPlusCaseRepository {
  listInput: SoloPlusAdminCaseListInput | null = null;
  detailCaseId: string | null = null;
  eventInput: SoloPlusAdminCaseEventListInput | null = null;

  async findCaseById(): Promise<SoloPlusCaseRecord | null> {
    return null;
  }

  async findCaseByIdempotencyKey(): Promise<SoloPlusCaseRecord | null> {
    return null;
  }

  async findActiveCaseByMerchantId(): Promise<SoloPlusCaseRecord | null> {
    return null;
  }

  async findActiveCaseByOnboardingSessionId(): Promise<SoloPlusCaseRecord | null> {
    return null;
  }

  async listRequirements(): Promise<readonly SoloPlusCaseRequirementRecord[]> {
    return [];
  }

  async listSafeEvents(): Promise<readonly SoloPlusCaseEventRecord[]> {
    return [];
  }

  async findLatestReviewDecisionEvent(): Promise<SoloPlusCaseEventRecord | null> {
    return null;
  }

  async listAdminCases(input: SoloPlusAdminCaseListInput): Promise<SoloPlusAdminCaseListResult> {
    this.listInput = JSON.parse(JSON.stringify(input)) as SoloPlusAdminCaseListInput;
    return {
      items: [
        {
          caseRecord: buildCaseRecord({
            caseStatus: "verification_pending",
            updatedAt: "2026-07-12T01:00:00.000Z",
            rowVersion: 6,
          }),
          merchant: {
            merchantId: "22222222-2222-4222-8222-222222222222",
            businessName: "Acme Retail",
            ownerName: "Ada Owner",
            email: "owner@example.test",
            subscriptionPlan: "solo_lite",
          },
          requirements: [
            buildRequirementRecord({
              requirementCode: "bvn",
              requirementState: "passed",
            }),
            buildRequirementRecord({
              requirementCode: "proof_of_address",
              requirementState: "failed",
            }),
            buildRequirementRecord({
              requirementCode: "activity_profile",
              requirementState: "processing",
            }),
          ],
          latestReviewDecisionEvent: buildEventRecord({
            eventType: "case_review_requested_more_information",
            reason: "  <b>Need clearer</b>\nproof of address. ",
            createdAt: "2026-07-12T02:00:00.000Z",
          }),
        },
      ],
      nextCursor: {
        updatedAt: "2026-07-12T01:00:00.000Z",
        caseId: "11111111-1111-4111-8111-111111111111",
      },
    };
  }

  async getAdminCaseDetail(caseId: string): Promise<SoloPlusAdminCaseDetailRecord | null> {
    this.detailCaseId = caseId;
    return {
      caseRecord: buildCaseRecord({
        caseStatus: "rejected",
        paymentStatus: "paid",
        refundStatus: "review_required",
        rejectionReason: "  <script>alert(1)</script> KYC mismatch ",
        rejectedAt: "2026-07-12T03:00:00.000Z",
        activationIdempotencyKey: null,
        rowVersion: 8,
      }),
      merchant: {
        merchantId: "22222222-2222-4222-8222-222222222222",
        businessName: "Acme Retail",
        ownerName: "Ada Owner",
        email: "owner@example.test",
        subscriptionPlan: "solo_lite",
      },
      requirements: [
        buildRequirementRecord({
          requirementCode: "id_document",
          requirementState: "pending",
          evidenceSourceType: "merchant_document",
          evidenceReference: "kyc-documents/id.pdf",
          metadata: {
            contentType: "application/pdf",
            fileSizeBytes: 2048,
            uploadedAt: "2026-07-12T04:00:00.000Z",
            storageKey: "kyc-documents/id.pdf",
          },
        }),
      ],
      latestReviewDecisionEvent: buildEventRecord({
        eventType: "case_rejected",
        reason: "  <script>alert(1)</script> KYC mismatch ",
        createdAt: "2026-07-12T03:00:00.000Z",
      }),
    };
  }

  async listAdminCaseEvents(
    _: string,
    input: SoloPlusAdminCaseEventListInput,
  ): Promise<SoloPlusAdminCaseEventListResult> {
    this.eventInput = JSON.parse(JSON.stringify(input)) as SoloPlusAdminCaseEventListInput;
    return {
      items: [
        buildEventRecord({
          eventType: "case_created",
          actorType: "merchant",
          actorId: "merchant-user-id",
          reason: "Solo Plus case created.",
          createdAt: "2026-07-10T00:00:00.000Z",
        }),
        buildEventRecord({
          eventType: "case_rejected",
          actorType: "admin",
          actorId: "admin-user-id",
          reason: "  <script>alert(1)</script> KYC mismatch ",
          createdAt: "2026-07-12T03:00:00.000Z",
        }),
      ],
      nextCursor: null,
    };
  }

  async createCaseWithRequirementsAndEvent(
    _: SoloPlusCaseCreateAtomicInput,
  ): Promise<SoloPlusCaseCreateAtomicResult> {
    throw new Error("not expected");
  }

  async attachMerchantToOnboardingCase(
    _: SoloPlusAttachMerchantAtomicParams,
  ): Promise<SoloPlusAttachMerchantAtomicResult> {
    throw new Error("not expected");
  }

  async transitionCaseStatus(
    _: SoloPlusCaseTransitionAtomicParams,
  ): Promise<SoloPlusCaseTransitionAtomicResult> {
    throw new Error("not expected");
  }

  async upsertCaseRequirements(): Promise<readonly SoloPlusCaseRequirementRecord[]> {
    throw new Error("not expected");
  }

  async activateSoloPlusCase(
    _: SoloPlusCaseActivationAtomicParams,
  ): Promise<SoloPlusCaseActivationAtomicResult> {
    throw new Error("not expected");
  }
}

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
    paymentReference: overrides.paymentReference ?? "solo-plus-payment-ref",
    expectedAmount: overrides.expectedAmount ?? "13000.00",
    paymentCurrency: "NGN",
    requirementsPolicyVersion: overrides.requirementsPolicyVersion ?? "solo-plus-policy-v1",
    requirementsSnapshot: overrides.requirementsSnapshot ?? {},
    activePlanSnapshot: overrides.activePlanSnapshot ?? "solo_lite",
    rejectionReason: overrides.rejectionReason ?? null,
    approvedAt: overrides.approvedAt ?? null,
    approvedByAdminId: overrides.approvedByAdminId ?? null,
    rejectedAt: overrides.rejectedAt ?? null,
    rejectedByAdminId: overrides.rejectedByAdminId ?? null,
    reopenedAt: overrides.reopenedAt ?? null,
    reopenedByAdminId: overrides.reopenedByAdminId ?? null,
    idempotencyKey: overrides.idempotencyKey ?? "case-idem-1",
    activationIdempotencyKey: overrides.activationIdempotencyKey ?? null,
    refundIdempotencyKey: overrides.refundIdempotencyKey ?? null,
    rowVersion: overrides.rowVersion ?? 1,
    auditMetadata: overrides.auditMetadata ?? { hidden: true },
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
    caseId: overrides.caseId ?? "11111111-1111-4111-8111-111111111111",
    requirementCode: overrides.requirementCode,
    requirementState: overrides.requirementState ?? "not_started",
    verificationLogId: null,
    evidenceSourceType: overrides.evidenceSourceType ?? null,
    evidenceSourceId: null,
    evidenceReference: overrides.evidenceReference ?? null,
    originalCompletedAt: null,
    reuseDecisionAt: null,
    reuseReason: null,
    policyRuleApplied: null,
    reviewedByAdminId: null,
    reviewNote: "internal note",
    providerName: null,
    providerReference: "provider-ref-hidden",
    failureReason: "internal failure",
    completedAt: overrides.completedAt ?? null,
    metadata: overrides.metadata ?? { storageKey: "hidden" },
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
  };
}

function buildEventRecord(overrides: Partial<SoloPlusCaseEventRecord> = {}): SoloPlusCaseEventRecord {
  return {
    id: overrides.id || "33333333-3333-4333-8333-333333333333",
    caseId: overrides.caseId || "11111111-1111-4111-8111-111111111111",
    eventType: overrides.eventType || "case_review_requested_more_information",
    previousState: overrides.previousState || { caseStatus: "manual_review" },
    newState: overrides.newState || { caseStatus: "verification_pending" },
    actorType: overrides.actorType || "admin",
    actorId: overrides.actorId ?? "admin-user-id",
    requestIdempotencyKey: overrides.requestIdempotencyKey ?? "event-idem-1",
    reason: overrides.reason ?? "Need clearer proof of address.",
    policyVersion: overrides.policyVersion ?? "solo-plus-policy-v1",
    createdAt: overrides.createdAt ?? "2026-07-11T00:00:00.000Z",
  };
}

async function run() {
  const require = createRequire(import.meta.url);
  const serverOnlyId = require.resolve("server-only");
  require.cache[serverOnlyId] = {
    exports: {},
    filename: serverOnlyId,
    id: serverOnlyId,
    loaded: true,
    path: serverOnlyId,
    children: [],
    paths: [],
    isPreloading: false,
    parent: null,
    require,
  } as NodeModule;

  ({
    createSoloPlusAdminReadService,
    SoloPlusAdminReadServiceError,
  } = await import("../src/lib/solo-plus/server/admin-read-service"));

  {
    const authClient = new FakeAuthClient();
    authClient.currentUser = {
      id: "merchant-user-id",
      email: "merchant@example.test",
      app_metadata: {},
      user_metadata: {},
      email_confirmed_at: "2026-07-10T00:00:00.000Z",
    };
    const repository = new FakeSoloPlusRepository();

    await assert.rejects(
      () =>
        createSoloPlusAdminReadService({
          authClient: authClient as never,
          repository,
          env: {
            NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
            NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
            SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
            NODE_ENV: "test",
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof SoloPlusAdminReadServiceError);
        assert.equal(error.code, "SOLO_PLUS_SERVER_FORBIDDEN");
        return true;
      },
    );
  }

  {
    const authClient = new FakeAuthClient();
    authClient.currentUser = {
      id: "admin-user-id",
      email: "admin@example.test",
      app_metadata: { is_super_admin: true },
      user_metadata: { is_super_admin: true },
      email_confirmed_at: "2026-07-10T00:00:00.000Z",
    };
    const repository = new FakeSoloPlusRepository();
    const service = await createSoloPlusAdminReadService({
      authClient: authClient as never,
      repository,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        NODE_ENV: "test",
      },
    });

    const queue = await service.listCases({
      caseStatus: "verification_pending",
      flowOrigin: "upgrade",
      paymentStatus: "paid",
      refundStatus: "none",
      merchantSearch: "  Acme Retail  ",
      cursor: null,
      limit: 25,
    });
    assert.equal(repository.listInput?.merchantSearch, "  Acme Retail  ");
    assert.equal(queue.items.length, 1);
    assert.equal(queue.items[0].merchantDisplayName, "Acme Retail");
    assert.equal(queue.items[0].ownerEmail, "owner@example.test");
    assert.equal(queue.items[0].reviewState, "more_information_required");
    assert.equal(queue.items[0].statusChangedAt, "2026-07-12T02:00:00.000Z");
    assert.deepEqual(queue.items[0].requirementSummary, {
      total: 3,
      satisfied: 1,
      actionable: 1,
      inProgress: 1,
    });
    assert.ok(typeof queue.nextCursor === "string");
    assert.equal("auditMetadata" in (queue.items[0] as Record<string, unknown>), false);

    const detail = await service.getCaseDetail("11111111-1111-4111-8111-111111111111", {
      cursor: null,
      limit: 25,
    });
    assert.ok(detail);
    assert.equal(repository.detailCaseId, "11111111-1111-4111-8111-111111111111");
    assert.equal(repository.eventInput?.limit, 25);
    assert.equal(detail?.case.reviewState, "rejected");
    assert.equal(detail?.case.activationState, "inactive");
    assert.equal(detail?.payment?.providerReference, "solo-plus-payment-ref");
    assert.equal(detail?.refund?.status, "review_required");
    assert.equal(detail?.reviewHistory.length, 2);
    assert.equal(detail?.reviewHistory[1].reason, "alert(1) KYC mismatch");
    assert.equal(detail?.reviewHistory[1].reviewerDisplayName, "Super Admin");
    assert.equal(detail?.requirements[0].evidenceReferenceSummary?.label, "Merchant evidence on file");
    assert.equal(
      "storageKey" in ((detail?.requirements[0].evidenceReferenceSummary as Record<string, unknown>) || {}),
      false,
    );
    assert.equal(
      "providerReference" in ((detail?.requirements[0] as Record<string, unknown>) || {}),
      false,
    );
  }

  console.log("solo-plus-admin-read-service.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
