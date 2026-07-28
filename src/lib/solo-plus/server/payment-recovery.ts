import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { PaymentService } from "@/lib/payment";
import type { SoloPlusCaseRecord, SoloPlusCaseRepository } from "@/lib/solo-plus/repository";
import {
  buildSoloPlusPaymentReference,
  findPendingSoloPlusPaymentByCaseId,
  hasReusablePaymentInitialization,
  readPaymentRecoverySnapshot,
  recoverSoloPlusPendingPaymentRecord,
  type PendingPlanPaymentRecord,
  type PaymentInitializationSnapshot,
} from "@/lib/services/plan-payment-recovery.service";
import { processSuccessfulFiatPayment } from "@/lib/services/fiat-payment-confirmation.service";
import {
  createSoloPlusSupabaseRepository,
  createSoloPlusServiceRoleClient,
  type SoloPlusSupabaseClientLike,
} from "./supabase-repository";

type SupportedProvider = "paystack" | "monnify";
type SupportedMethod = "card" | "bank_transfer" | "ussd";

type RecoveryDiagnosticStage =
  | "case_resolved"
  | "old_payment_resolved"
  | "provider_verification_started"
  | "provider_verification_completed"
  | "recovery_eligibility_determined"
  | "old_payment_superseded"
  | "new_payment_created";

type RecoveryDiagnosticEvent = {
  caseId?: string | null;
  caseStatus?: string | null;
  paymentStatus?: string | null;
  paymentRecordId?: string | null;
  provider?: string | null;
  metadata?: Record<string, unknown>;
};

type RecoveryDiagnosticLogger = (
  stage: RecoveryDiagnosticStage,
  event?: RecoveryDiagnosticEvent,
) => void;

export type SoloPlusRecoveryVerificationCategory =
  | "successful"
  | "reusable_session"
  | "unpaid_unrecoverable"
  | "unknown";

export type SoloPlusRecoveryResolution =
  | {
      kind: "resume_existing";
      caseRecord: SoloPlusCaseRecord;
      paymentRecord: PendingPlanPaymentRecord;
      reference: string;
      replay: boolean;
      initialization: PaymentInitializationSnapshot;
    }
  | {
      kind: "initialize_new_attempt";
      caseRecord: SoloPlusCaseRecord;
      paymentRecord: PendingPlanPaymentRecord;
      reference: string;
      replay: boolean;
      supersededPaymentRecordId: string;
    };

export class SoloPlusPaymentRecoveryError extends Error {
  readonly code:
    | "SOLO_PLUS_PAYMENT_ALREADY_COMPLETED"
    | "SOLO_PLUS_PAYMENT_RECOVERY_VERIFICATION_FAILED"
    | "SOLO_PLUS_PAYMENT_RECOVERY_NOT_ALLOWED"
    | "SOLO_PLUS_PAYMENT_RECOVERY_CONFLICT";

  constructor(
    code:
      | "SOLO_PLUS_PAYMENT_ALREADY_COMPLETED"
      | "SOLO_PLUS_PAYMENT_RECOVERY_VERIFICATION_FAILED"
      | "SOLO_PLUS_PAYMENT_RECOVERY_NOT_ALLOWED"
      | "SOLO_PLUS_PAYMENT_RECOVERY_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "SoloPlusPaymentRecoveryError";
    this.code = code;
  }
}

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeAmountKobo(payload: Record<string, unknown>) {
  const raw = payload.amount ?? payload.amountPaid ?? payload.paidAmount;
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed > 1000 ? Math.round(parsed) : Math.round(parsed * 100);
}

function normalizeCurrency(payload: Record<string, unknown>) {
  const currency =
    stringValue(payload.currency) ||
    stringValue(payload.currencyCode) ||
    stringValue(payload.paidCurrency);

  return currency ? currency.toUpperCase() : null;
}

function normalizeStatus(payload: Record<string, unknown>) {
  const candidate =
    stringValue(payload.status) ||
    stringValue(asRecord(payload.data)?.status) ||
    stringValue(payload.paymentStatus);

  return candidate ? candidate.toLowerCase() : null;
}

function normalizeProviderReference(payload: Record<string, unknown>, fallbackReference: string) {
  return (
    stringValue(payload.provider_reference) ||
    stringValue(payload.transactionReference) ||
    stringValue(payload.paymentReference) ||
    stringValue(payload.reference) ||
    stringValue(payload.id) ||
    fallbackReference
  );
}

function normalizeExpectedAmountKobo(record: PendingPlanPaymentRecord) {
  const amount = Number(record.expected_amount ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function buildRecoveryReason(provider: string, status: string | null) {
  if (!status) {
    return `Solo Plus ${provider} payment checkout could not be recovered because the provider status was missing.`;
  }

  return `Solo Plus ${provider} payment checkout could not be resumed after provider verification reported ${status}.`;
}

function assertRecoveryCase(caseRecord: SoloPlusCaseRecord | null, merchantId: string) {
  if (!caseRecord) {
    throw new SoloPlusPaymentRecoveryError(
      "SOLO_PLUS_PAYMENT_RECOVERY_NOT_ALLOWED",
      "No active Solo Plus upgrade case is available for recovery.",
    );
  }

  if (
    caseRecord.merchantId !== merchantId ||
    caseRecord.flowOrigin !== "upgrade" ||
    caseRecord.targetPlan !== "solo_plus"
  ) {
    throw new SoloPlusPaymentRecoveryError(
      "SOLO_PLUS_PAYMENT_RECOVERY_NOT_ALLOWED",
      "Solo Plus payment recovery is available only for the active owner-linked upgrade case.",
    );
  }

  return caseRecord;
}

async function verifyRecoverableProviderState(input: {
  paymentRecord: PendingPlanPaymentRecord;
  trustedSupabase: SupabaseClient;
  diagnostics?: RecoveryDiagnosticLogger;
  verifyTransaction?: typeof PaymentService.verifyTransaction;
  processSuccessfulPayment?: typeof processSuccessfulFiatPayment;
}): Promise<{
  category: SoloPlusRecoveryVerificationCategory;
  provider?: SupportedProvider;
  rawPayload?: Record<string, unknown>;
  normalizedStatus?: string | null;
}> {
  const provider = input.paymentRecord.provider_name;
  const reference =
    input.paymentRecord.provider_reference || input.paymentRecord.internal_reference;

  if (provider !== "paystack" && provider !== "monnify") {
    return { category: "unknown", normalizedStatus: "unsupported_provider" };
  }

  const reusable = hasReusablePaymentInitialization(input.paymentRecord, provider);
  if (reusable) {
    return {
      category: "reusable_session",
      provider,
      normalizedStatus: reusable.status,
    };
  }

  input.diagnostics?.("provider_verification_started", {
    paymentRecordId: input.paymentRecord.id,
    provider,
    metadata: {
      reference,
    },
  });

  try {
    const verified = await (input.verifyTransaction || PaymentService.verifyTransaction)(
      reference,
      provider,
    );
    const payload = asRecord(asRecord(verified)?.data) || asRecord(verified) || {};
    const status = normalizeStatus(payload);
    const amountKobo = normalizeAmountKobo(payload);
    const currency = normalizeCurrency(payload);
    const expectedAmountKobo = normalizeExpectedAmountKobo(input.paymentRecord);
    const expectedCurrency = String(input.paymentRecord.currency || "NGN").toUpperCase();
    const normalizedReference =
      stringValue(payload.reference) ||
      stringValue(payload.paymentReference) ||
      stringValue(payload.transactionReference) ||
      reference;
    const expectedReference =
      input.paymentRecord.provider_reference || input.paymentRecord.internal_reference;

    input.diagnostics?.("provider_verification_completed", {
      paymentRecordId: input.paymentRecord.id,
      provider,
      metadata: {
        status,
        hasPayload: Object.keys(payload).length > 0,
        normalizedReference,
        expectedReference,
        amountMatches: amountKobo === expectedAmountKobo,
        currencyMatches: currency === expectedCurrency,
      },
    });

    if (
      normalizedReference !== expectedReference ||
      amountKobo == null ||
      amountKobo !== expectedAmountKobo ||
      currency == null ||
      currency !== expectedCurrency
    ) {
      return {
        category: "unknown",
        provider,
        rawPayload: payload,
        normalizedStatus: status,
      };
    }

    if (status === "success" || status === "paid") {
      await (input.processSuccessfulPayment || processSuccessfulFiatPayment)(
        input.trustedSupabase,
        {
          provider,
          metadata:
            asRecord(payload.metadata) ||
            asRecord(payload.metaData) ||
            asRecord(input.paymentRecord.metadata) ||
          {},
        amountKobo,
        reference: expectedReference,
        providerReference: normalizeProviderReference(payload, expectedReference),
        channel:
          stringValue(payload.channel) ||
          stringValue(payload.paymentMethod) ||
          stringValue(asRecord(input.paymentRecord.metadata)?.payment_method_requested) ||
          "card",
        feesKobo: null,
        settlementAmountKobo: null,
          rawProviderPayload: payload,
        },
      );

      return {
        category: "successful",
        provider,
        rawPayload: payload,
        normalizedStatus: status,
      };
    }

    if (
      status === "pending" ||
      status === "abandoned" ||
      status === "failed" ||
      status === "cancelled" ||
      status === "canceled" ||
      status === "expired"
    ) {
      return {
        category: "unpaid_unrecoverable",
        provider,
        rawPayload: payload,
        normalizedStatus: status,
      };
    }

    return {
      category: "unknown",
      provider,
      rawPayload: payload,
      normalizedStatus: status,
    };
  } catch {
    input.diagnostics?.("provider_verification_completed", {
      paymentRecordId: input.paymentRecord.id,
      provider,
      metadata: {
        status: "verification_failed",
      },
    });

    return {
      category: "unknown",
      provider,
      normalizedStatus: "verification_failed",
    };
  }
}

export async function recoverSoloPlusUpgradePayment(input: {
  merchantId: string;
  recoveryIdempotencyKey: string;
  newProvider: SupportedProvider;
  newPaymentMethod: SupportedMethod;
  serviceClient?: SupabaseClient;
  diagnostics?: RecoveryDiagnosticLogger;
  repository?: Pick<SoloPlusCaseRepository, "findActiveCaseByMerchantId">;
  verifyTransaction?: typeof PaymentService.verifyTransaction;
  processSuccessfulPayment?: typeof processSuccessfulFiatPayment;
  recoverPendingPayment?: typeof recoverSoloPlusPendingPaymentRecord;
  loadPendingPayment?: typeof findPendingSoloPlusPaymentByCaseId;
}): Promise<SoloPlusRecoveryResolution> {
  const trustedSupabase = (input.serviceClient ||
    createSoloPlusServiceRoleClient()) as SupabaseClient & SoloPlusSupabaseClientLike;
  const repository =
    input.repository ||
    createSoloPlusSupabaseRepository({
      client: trustedSupabase as SoloPlusSupabaseClientLike,
    });

  const caseRecord = assertRecoveryCase(
    await repository.findActiveCaseByMerchantId(input.merchantId),
    input.merchantId,
  );
  input.diagnostics?.("case_resolved", {
    caseId: caseRecord.id,
    caseStatus: caseRecord.caseStatus,
    paymentStatus: caseRecord.paymentStatus,
  });

  const currentPaymentRecord = await (input.loadPendingPayment ||
    findPendingSoloPlusPaymentByCaseId)(trustedSupabase, caseRecord.id);

  if (!currentPaymentRecord?.solo_plus_case_id) {
    throw new SoloPlusPaymentRecoveryError(
      "SOLO_PLUS_PAYMENT_RECOVERY_NOT_ALLOWED",
      "Solo Plus payment recovery requires an existing case-linked payment attempt.",
    );
  }

  input.diagnostics?.("old_payment_resolved", {
    caseId: caseRecord.id,
    paymentRecordId: currentPaymentRecord.id,
    provider: currentPaymentRecord.provider_name,
    metadata: {
      paymentStatus: currentPaymentRecord.payment_status,
      processingStatus: currentPaymentRecord.processing_status,
      initializationStatus:
        hasReusablePaymentInitialization(
          currentPaymentRecord,
          currentPaymentRecord.provider_name === "paystack" ||
            currentPaymentRecord.provider_name === "monnify"
            ? currentPaymentRecord.provider_name
            : "paystack",
        )?.status ||
        null,
    },
  });

  const recoverySnapshot = readPaymentRecoverySnapshot(currentPaymentRecord.metadata);
  if (recoverySnapshot?.recoveryOfPaymentRecordId) {
    if (recoverySnapshot.idempotencyKey !== input.recoveryIdempotencyKey) {
      throw new SoloPlusPaymentRecoveryError(
        "SOLO_PLUS_PAYMENT_RECOVERY_CONFLICT",
        "A newer Solo Plus payment recovery attempt is already active for this case.",
      );
    }

    return {
      kind: "initialize_new_attempt",
      caseRecord,
      paymentRecord: currentPaymentRecord,
      reference:
        currentPaymentRecord.provider_reference ||
        buildSoloPlusPaymentReference(
          currentPaymentRecord.id,
          currentPaymentRecord.payment_purpose as "plan_subscription" | "plan_upgrade",
        ),
      replay: true,
      supersededPaymentRecordId: recoverySnapshot.recoveryOfPaymentRecordId,
    };
  }

  const verification = await verifyRecoverableProviderState({
    paymentRecord: currentPaymentRecord,
    trustedSupabase,
    diagnostics: input.diagnostics,
    verifyTransaction: input.verifyTransaction,
    processSuccessfulPayment: input.processSuccessfulPayment,
  });
  input.diagnostics?.("recovery_eligibility_determined", {
    caseId: caseRecord.id,
    paymentRecordId: currentPaymentRecord.id,
    provider: verification.provider || currentPaymentRecord.provider_name,
    metadata: {
      category: verification.category,
      status: verification.normalizedStatus || null,
    },
  });

  if (verification.category === "reusable_session") {
    const reusable = hasReusablePaymentInitialization(
      currentPaymentRecord,
      verification.provider!,
    );

    if (!reusable) {
      throw new SoloPlusPaymentRecoveryError(
        "SOLO_PLUS_PAYMENT_RECOVERY_VERIFICATION_FAILED",
        "The existing Solo Plus checkout session could not be resumed safely.",
      );
    }

    return {
      kind: "resume_existing",
      caseRecord,
      paymentRecord: currentPaymentRecord,
      reference:
        reusable.providerReference ||
        currentPaymentRecord.provider_reference ||
        currentPaymentRecord.internal_reference,
      replay: true,
      initialization: reusable,
    };
  }

  if (verification.category === "successful") {
    throw new SoloPlusPaymentRecoveryError(
      "SOLO_PLUS_PAYMENT_ALREADY_COMPLETED",
      "This Solo Plus payment was already completed. Refresh the status page instead of starting a new attempt.",
    );
  }

  if (verification.category !== "unpaid_unrecoverable" || !verification.provider) {
    throw new SoloPlusPaymentRecoveryError(
      "SOLO_PLUS_PAYMENT_RECOVERY_VERIFICATION_FAILED",
      "We could not verify the previous Solo Plus payment attempt safely enough to recover it.",
    );
  }

  const recoveryResult = await (input.recoverPendingPayment ||
    recoverSoloPlusPendingPaymentRecord)(trustedSupabase, {
    oldPaymentRecordId: currentPaymentRecord.id,
    caseId: caseRecord.id,
    merchantId: input.merchantId,
    recoveryIdempotencyKey: input.recoveryIdempotencyKey,
    providerVerificationCategory: verification.category,
    recoveryReason: buildRecoveryReason(
      verification.provider,
      verification.normalizedStatus || null,
    ),
    newProvider: input.newProvider,
    newPaymentMethod: input.newPaymentMethod,
  });

  input.diagnostics?.("old_payment_superseded", {
    caseId: caseRecord.id,
    paymentRecordId: recoveryResult.oldPayment.id,
    provider: recoveryResult.oldPayment.provider_name,
    metadata: {
      category: verification.category,
      replacementPaymentRecordId: recoveryResult.newPayment.id,
    },
  });
  input.diagnostics?.("new_payment_created", {
    caseId: caseRecord.id,
    paymentRecordId: recoveryResult.newPayment.id,
    provider: recoveryResult.newPayment.provider_name,
    metadata: {
      replay: recoveryResult.kind === "idempotent_replay",
    },
  });

  return {
    kind: "initialize_new_attempt",
    caseRecord,
    paymentRecord: recoveryResult.newPayment,
    reference:
      recoveryResult.newPayment.provider_reference ||
      buildSoloPlusPaymentReference(
        recoveryResult.newPayment.id,
        recoveryResult.newPayment.payment_purpose as "plan_subscription" | "plan_upgrade",
      ),
    replay: recoveryResult.kind === "idempotent_replay",
    supersededPaymentRecordId: recoveryResult.oldPayment.id,
  };
}
