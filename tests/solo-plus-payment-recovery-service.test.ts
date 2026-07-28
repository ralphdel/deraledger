import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import type { SoloPlusCaseRecord } from "../src/lib/solo-plus/repository";
import type { PendingPlanPaymentRecord } from "../src/lib/services/plan-payment-recovery.service";

const requireForShim = createRequire(import.meta.url);
const serverOnlyShimPath = requireForShim.resolve("server-only");

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "service-role-key";

const serverOnlyShimModule = new Module(serverOnlyShimPath);
serverOnlyShimModule.filename = serverOnlyShimPath;
serverOnlyShimModule.loaded = true;
serverOnlyShimModule.exports = {};
requireForShim.cache[serverOnlyShimPath] = serverOnlyShimModule;

type RecoveryModule = typeof import("../src/lib/solo-plus/server/payment-recovery");
type PlanPaymentRecoveryModule = typeof import("../src/lib/services/plan-payment-recovery.service");
let recoverSoloPlusUpgradePayment: RecoveryModule["recoverSoloPlusUpgradePayment"];
let SoloPlusPaymentRecoveryError: RecoveryModule["SoloPlusPaymentRecoveryError"];
let mergePaymentInitializationSnapshot: PlanPaymentRecoveryModule["mergePaymentInitializationSnapshot"];
let buildSoloPlusPaymentReference: PlanPaymentRecoveryModule["buildSoloPlusPaymentReference"];

function buildCase(overrides: Partial<SoloPlusCaseRecord> = {}): SoloPlusCaseRecord {
  return {
    id: "8b32fb1c-144d-4013-a80c-6a8e146754f9",
    merchantId: "11111111-1111-1111-1111-111111111111",
    onboardingSessionId: null,
    flowOrigin: "upgrade",
    sourcePlan: "solo_lite",
    targetPlan: "solo_plus",
    caseStatus: "awaiting_payment",
    paymentStatus: "pending",
    refundStatus: "none",
    paymentRecordId: "425fa617-d714-4d1c-9db8-4f46cb98bff1",
    paymentProvider: "paystack",
    paymentReference: "SPL-UPG-425FA617D7144D1C9DB84F46CB98BFF1",
    expectedAmount: "13000.00",
    paymentCurrency: "NGN",
    requirementsPolicyVersion: "solo-plus-payment-init-v1",
    requirementsSnapshot: {},
    activePlanSnapshot: "starter",
    rejectionReason: null,
    approvedAt: null,
    approvedByAdminId: null,
    rejectedAt: null,
    rejectedByAdminId: null,
    reopenedAt: null,
    reopenedByAdminId: null,
    idempotencyKey: "solo-plus:upgrade:merchant-1",
    activationIdempotencyKey: null,
    refundIdempotencyKey: null,
    rowVersion: 2,
    auditMetadata: {},
    createdAt: "2026-07-18T10:00:00.000Z",
    updatedAt: "2026-07-18T10:00:00.000Z",
    ...overrides,
  };
}

function buildPaymentRecord(
  overrides: Partial<PendingPlanPaymentRecord> = {},
): PendingPlanPaymentRecord {
  const id = overrides.id ?? "425fa617-d714-4d1c-9db8-4f46cb98bff1";
  const purpose =
    overrides.payment_purpose ?? ("plan_upgrade" as PendingPlanPaymentRecord["payment_purpose"]);
  return {
    id,
    internal_reference: buildSoloPlusPaymentReference(
      id,
      purpose as "plan_subscription" | "plan_upgrade",
    ),
    provider_name: "paystack",
    provider_reference: buildSoloPlusPaymentReference(
      id,
      purpose as "plan_subscription" | "plan_upgrade",
    ),
    payment_purpose: purpose,
    payment_method: "card",
    payment_status: "pending",
    processing_status: "pending_payment",
    account_setup_status: "pending_payment",
    merchant_id: "11111111-1111-1111-1111-111111111111",
    onboarding_session_id: null,
    solo_plus_case_id: "8b32fb1c-144d-4013-a80c-6a8e146754f9",
    expected_amount: 13000,
    amount_paid: 0,
    currency: "NGN",
    customer_email: "solo-plus-owner-staging@example.com",
    metadata: {},
    raw_provider_payload: {},
    failure_reason: null,
    ...overrides,
  };
}

async function run() {
  ({
    recoverSoloPlusUpgradePayment,
    SoloPlusPaymentRecoveryError,
  } = await import(
    new URL("../src/lib/solo-plus/server/payment-recovery.ts", import.meta.url)
      .href
  ));
  ({
    mergePaymentInitializationSnapshot,
    buildSoloPlusPaymentReference,
  } = await import(
    new URL("../src/lib/services/plan-payment-recovery.service.ts", import.meta.url)
      .href
  ));

  {
    const caseRecord = buildCase();
    const paymentRecord = buildPaymentRecord({
      metadata: mergePaymentInitializationSnapshot({}, {
        status: "initialized",
        provider: "paystack",
        completionMode: "paystack_resume",
        providerReference: "SPL-UPG-425FA617D7144D1C9DB84F46CB98BFF1",
        authorizationUrl: "https://paystack.test/checkout",
        accessCode: "ACCESS-1",
        checkoutUrl: null,
        providerTransactionReference: null,
        failureCode: null,
        failureMessage: null,
        initializedAt: "2026-07-18T10:01:00.000Z",
        lastUpdatedAt: "2026-07-18T10:01:00.000Z",
      }),
    });

    const result = await recoverSoloPlusUpgradePayment({
      merchantId: caseRecord.merchantId!,
      recoveryIdempotencyKey: "recover-1",
      newProvider: "paystack",
      newPaymentMethod: "card",
      serviceClient: {} as never,
      repository: {
        findActiveCaseByMerchantId: async () => caseRecord,
      },
      loadPendingPayment: async () => paymentRecord,
    });

    assert.equal(result.kind, "resume_existing");
    assert.equal(result.reference, paymentRecord.provider_reference);
    assert.equal(result.initialization.accessCode, "ACCESS-1");
  }

  {
    const caseRecord = buildCase();
    const replacementRecord = buildPaymentRecord({
      id: "d132fb1c-144d-4013-a80c-6a8e146754ff",
      provider_name: "monnify",
      payment_method: "bank_transfer",
      metadata: {
        payment_recovery: {
          recoveryOfPaymentRecordId: "425fa617-d714-4d1c-9db8-4f46cb98bff1",
          idempotencyKey: "recover-2",
        },
      },
    });

    const result = await recoverSoloPlusUpgradePayment({
      merchantId: caseRecord.merchantId!,
      recoveryIdempotencyKey: "recover-2",
      newProvider: "monnify",
      newPaymentMethod: "bank_transfer",
      serviceClient: {} as never,
      repository: {
        findActiveCaseByMerchantId: async () => caseRecord,
      },
      loadPendingPayment: async () => replacementRecord,
    });

    assert.equal(result.kind, "initialize_new_attempt");
    assert.equal(result.replay, true);
    assert.equal(result.paymentRecord.id, replacementRecord.id);
  }

  {
    const caseRecord = buildCase();
    const replacementRecord = buildPaymentRecord({
      metadata: {
        payment_recovery: {
          recoveryOfPaymentRecordId: "425fa617-d714-4d1c-9db8-4f46cb98bff1",
          idempotencyKey: "recover-current",
        },
      },
    });

    await assert.rejects(
      () =>
        recoverSoloPlusUpgradePayment({
          merchantId: caseRecord.merchantId!,
          recoveryIdempotencyKey: "different-key",
          newProvider: "paystack",
          newPaymentMethod: "card",
          serviceClient: {} as never,
          repository: {
            findActiveCaseByMerchantId: async () => caseRecord,
          },
          loadPendingPayment: async () => replacementRecord,
        }),
      (error: unknown) =>
        error instanceof SoloPlusPaymentRecoveryError &&
        error.code === "SOLO_PLUS_PAYMENT_RECOVERY_CONFLICT",
    );
  }

  {
    const caseRecord = buildCase();
    const paymentRecord = buildPaymentRecord();
    let processed = false;

    await assert.rejects(
      () =>
        recoverSoloPlusUpgradePayment({
          merchantId: caseRecord.merchantId!,
          recoveryIdempotencyKey: "recover-3",
          newProvider: "paystack",
          newPaymentMethod: "card",
          serviceClient: {} as never,
          repository: {
            findActiveCaseByMerchantId: async () => caseRecord,
          },
          loadPendingPayment: async () => paymentRecord,
          verifyTransaction: async () => ({
            status: "success",
            reference: paymentRecord.provider_reference,
            amount: 1300000,
            currency: "NGN",
            metadata: { type: "subscription_upgrade" },
          }),
          processSuccessfulPayment: async () => {
            processed = true;
            return {
              received: true,
              processed: true,
              solo_plus: true,
              status: "verification_pending",
            };
          },
        }),
      (error: unknown) =>
        error instanceof SoloPlusPaymentRecoveryError &&
        error.code === "SOLO_PLUS_PAYMENT_ALREADY_COMPLETED",
    );

    assert.equal(processed, true);
  }

  {
    const caseRecord = buildCase();
    const oldPaymentRecord = buildPaymentRecord();
    const newPaymentRecord = buildPaymentRecord({
      id: "535fa617-d714-4d1c-9db8-4f46cb98bff2",
      provider_name: "monnify",
      payment_method: "bank_transfer",
      provider_reference: "SPL-UPG-535FA617D7144D1C9DB84F46CB98BFF2",
      internal_reference: "SPL-UPG-535FA617D7144D1C9DB84F46CB98BFF2",
    });
    let capturedOldPaymentId = "";
    let capturedNewProvider = "";

    const result = await recoverSoloPlusUpgradePayment({
      merchantId: caseRecord.merchantId!,
      recoveryIdempotencyKey: "recover-4",
      newProvider: "monnify",
      newPaymentMethod: "bank_transfer",
      serviceClient: {} as never,
      repository: {
        findActiveCaseByMerchantId: async () => caseRecord,
      },
      loadPendingPayment: async () => oldPaymentRecord,
      verifyTransaction: async () => ({
        status: "abandoned",
        reference: oldPaymentRecord.provider_reference,
        amount: 1300000,
        currency: "NGN",
      }),
      recoverPendingPayment: async (_client, input) => {
        capturedOldPaymentId = input.oldPaymentRecordId;
        capturedNewProvider = input.newProvider;
        return {
          kind: "applied",
          oldPayment: oldPaymentRecord,
          newPayment: newPaymentRecord,
        };
      },
    });

    assert.equal(result.kind, "initialize_new_attempt");
    assert.equal(result.paymentRecord.id, newPaymentRecord.id);
    assert.equal(capturedOldPaymentId, oldPaymentRecord.id);
    assert.equal(capturedNewProvider, "monnify");
  }

  {
    const caseRecord = buildCase();
    const paymentRecord = buildPaymentRecord();
    let recoveryAttempted = false;

    await assert.rejects(
      () =>
        recoverSoloPlusUpgradePayment({
          merchantId: caseRecord.merchantId!,
          recoveryIdempotencyKey: "recover-5",
          newProvider: "paystack",
          newPaymentMethod: "card",
          serviceClient: {} as never,
          repository: {
            findActiveCaseByMerchantId: async () => caseRecord,
          },
          loadPendingPayment: async () => paymentRecord,
          verifyTransaction: async () => ({
            status: "mystery_state",
            reference: paymentRecord.provider_reference,
            amount: 1300000,
            currency: "NGN",
          }),
          recoverPendingPayment: async () => {
            recoveryAttempted = true;
            throw new Error("should not be called");
          },
        }),
      (error: unknown) =>
        error instanceof SoloPlusPaymentRecoveryError &&
        error.code === "SOLO_PLUS_PAYMENT_RECOVERY_VERIFICATION_FAILED",
    );

    assert.equal(recoveryAttempted, false);
  }

  {
    const nonUpgradeCase = buildCase({ flowOrigin: "onboarding" });

    await assert.rejects(
      () =>
        recoverSoloPlusUpgradePayment({
          merchantId: nonUpgradeCase.merchantId!,
          recoveryIdempotencyKey: "recover-6",
          newProvider: "paystack",
          newPaymentMethod: "card",
          serviceClient: {} as never,
          repository: {
            findActiveCaseByMerchantId: async () => nonUpgradeCase,
          },
          loadPendingPayment: async () => buildPaymentRecord(),
        }),
      (error: unknown) =>
        error instanceof SoloPlusPaymentRecoveryError &&
        error.code === "SOLO_PLUS_PAYMENT_RECOVERY_NOT_ALLOWED",
    );
  }

  {
    const caseRecord = buildCase();
    const paymentRecord = buildPaymentRecord();
    let recoveryAttempted = false;

    await assert.rejects(
      () =>
        recoverSoloPlusUpgradePayment({
          merchantId: caseRecord.merchantId!,
          recoveryIdempotencyKey: "recover-7",
          newProvider: "paystack",
          newPaymentMethod: "card",
          serviceClient: {} as never,
          repository: {
            findActiveCaseByMerchantId: async () => caseRecord,
          },
          loadPendingPayment: async () => paymentRecord,
          verifyTransaction: async () => ({
            status: "failed",
            reference: paymentRecord.provider_reference,
            amount: 1200000,
            currency: "NGN",
          }),
          recoverPendingPayment: async () => {
            recoveryAttempted = true;
            throw new Error("should not be called");
          },
        }),
      (error: unknown) =>
        error instanceof SoloPlusPaymentRecoveryError &&
        error.code === "SOLO_PLUS_PAYMENT_RECOVERY_VERIFICATION_FAILED",
    );

    assert.equal(recoveryAttempted, false);
  }

  {
    const caseRecord = buildCase();
    const paymentRecord = buildPaymentRecord();
    let verifyCalled = false;

    const result = await recoverSoloPlusUpgradePayment({
      merchantId: caseRecord.merchantId!,
      recoveryIdempotencyKey: "recover-8",
      newProvider: "paystack",
      newPaymentMethod: "card",
      serviceClient: {} as never,
      repository: {
        findActiveCaseByMerchantId: async () => caseRecord,
      },
      loadPendingPayment: async () =>
        buildPaymentRecord({
          metadata: mergePaymentInitializationSnapshot({}, {
            status: "initialized",
            provider: "paystack",
            completionMode: "paystack_resume",
            providerReference: paymentRecord.provider_reference,
            authorizationUrl: "https://paystack.test/checkout",
            accessCode: "ACCESS-REUSE",
            checkoutUrl: null,
            providerTransactionReference: null,
            failureCode: null,
            failureMessage: null,
            initializedAt: "2026-07-18T10:01:00.000Z",
            lastUpdatedAt: "2026-07-18T10:01:00.000Z",
          }),
        }),
      verifyTransaction: async () => {
        verifyCalled = true;
        return {};
      },
    });

    assert.equal(result.kind, "resume_existing");
    assert.equal(result.initialization.accessCode, "ACCESS-REUSE");
    assert.equal(verifyCalled, false);
  }

  console.log("solo-plus-payment-recovery-service.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
