import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getStoragePlanCode, normalizePlanCode } from "@/lib/plans";
import {
  buildSoloPlusPaymentReference,
  createPendingPlanPaymentRecord,
  findFullPaymentRecordByReference,
  findPendingSoloPlusPaymentByCaseId,
  hasReusablePaymentInitialization,
  type PendingPlanPaymentRecord,
  readPaymentInitializationSnapshot,
  mergePaymentInitializationSnapshot,
  updatePlanPaymentRecordById,
} from "@/lib/services/plan-payment-recovery.service";
import { SOLO_PLUS_REQUIRED_REQUIREMENTS } from "../state";
import { createSoloPlusServerService } from "./service-factory";
import {
  createSoloPlusServiceRoleClient,
  type SoloPlusSupabaseClientLike,
} from "./supabase-repository";

type SupportedProvider = "paystack" | "monnify" | "breet";
type SupportedPurpose = "plan_subscription" | "plan_upgrade";
type SupportedMethod = "card" | "bank_transfer" | "ussd" | "crypto";

type SoloPlusPaymentPreparation = {
  caseId: string;
  reference: string;
  paymentRecord: PendingPlanPaymentRecord;
  replay: boolean;
};

type SoloPlusPaymentDiagnosticStage =
  | "case_rpc_completed"
  | "case_payload_mapped"
  | "requirements_ready"
  | "payment_record_lookup_completed"
  | "payment_record_created_or_reused";

type SoloPlusPaymentDiagnosticEvent = {
  caseId?: string | null;
  caseStatus?: string | null;
  paymentStatus?: string | null;
  paymentRecordId?: string | null;
  provider?: string | null;
  metadata?: Record<string, unknown>;
};

type SoloPlusPaymentDiagnosticLogger = (
  stage: SoloPlusPaymentDiagnosticStage,
  event?: SoloPlusPaymentDiagnosticEvent,
) => void;

type SoloPlusConfirmationInput = {
  provider: SupportedProvider;
  internalReference: string;
  providerReference: string;
  paymentPurpose: SupportedPurpose | "plan_renewal";
  amountNgn: string;
  currency: "NGN";
  merchantId?: string | null;
  onboardingSessionId?: string | null;
  platformDirected?: boolean | null;
  rawProviderPayload?: Record<string, unknown> | null;
  requestIdempotencyKey: string;
  serviceClient?: SupabaseClient;
};

const SOLO_PLUS_REQUIREMENTS_POLICY_VERSION = "solo-plus-payment-init-v1";

export class SoloPlusPaymentLifecycleError extends Error {
  readonly code:
    | "SOLO_PLUS_PAYMENT_INIT_CONFLICT"
    | "SOLO_PLUS_PAYMENT_ALREADY_CONFIRMED"
    | "SOLO_PLUS_PAYMENT_CONFIRMATION_CONFLICT"
    | "SOLO_PLUS_PAYMENT_INITIALIZATION_RECOVERY_REQUIRED";

  constructor(
    code:
      | "SOLO_PLUS_PAYMENT_INIT_CONFLICT"
      | "SOLO_PLUS_PAYMENT_ALREADY_CONFIRMED"
      | "SOLO_PLUS_PAYMENT_CONFIRMATION_CONFLICT"
      | "SOLO_PLUS_PAYMENT_INITIALIZATION_RECOVERY_REQUIRED",
    message: string,
  ) {
    super(message);
    this.name = "SoloPlusPaymentLifecycleError";
    this.code = code;
  }
}

function normalizeAmountNgnString(amountKobo: number) {
  return (amountKobo / 100).toFixed(2);
}

function buildProvisionalReference(caseId: string, purpose: SupportedPurpose) {
  const prefix = purpose === "plan_upgrade" ? "SPL-UPG-TMP" : "SPL-SUB-TMP";
  return `${prefix}-${caseId.replace(/-/g, "").toUpperCase()}`;
}

function buildRequirementsSnapshot(flowOrigin: "onboarding" | "upgrade") {
  return {
    commitScope: "solo_plus_commit_7_payment_lifecycle",
    flowOrigin,
    activationDeferred: true,
    paymentConfirmationTargetStatus: "verification_pending",
    requiredRequirements: [...SOLO_PLUS_REQUIRED_REQUIREMENTS],
  };
}

function assertPendingPaymentCompatibility(
  record: PendingPlanPaymentRecord,
  expected: {
    provider: SupportedProvider;
    paymentMethod: SupportedMethod;
    paymentPurpose: SupportedPurpose;
    expectedAmount: string;
  },
) {
  if (String(record.payment_status || "").toLowerCase() === "successful") {
    throw new SoloPlusPaymentLifecycleError(
      "SOLO_PLUS_PAYMENT_ALREADY_CONFIRMED",
      "Solo Plus payment is already confirmed for this case.",
    );
  }

  const conflicts =
    record.provider_name !== expected.provider ||
    record.payment_method !== expected.paymentMethod ||
    record.payment_purpose !== expected.paymentPurpose ||
    Number(record.expected_amount || 0).toFixed(2) !== expected.expectedAmount;

  if (conflicts) {
    throw new SoloPlusPaymentLifecycleError(
      "SOLO_PLUS_PAYMENT_INIT_CONFLICT",
      "Solo Plus case already has a different active payment initialization.",
    );
  }
}

async function ensureCanonicalSoloPlusPaymentRecord(
  serviceClient: SupabaseClient,
  record: PendingPlanPaymentRecord,
  purpose: SupportedPurpose,
) {
  const canonicalReference = buildSoloPlusPaymentReference(record.id, purpose);
  const initialization = readPaymentInitializationSnapshot(record.metadata);

  if (
    record.internal_reference === canonicalReference &&
    record.provider_reference === canonicalReference &&
    initialization != null
  ) {
    return record;
  }

  const nextMetadata = mergePaymentInitializationSnapshot(record.metadata, {
    status: initialization?.status ?? "created",
    provider: record.provider_name,
    completionMode:
      initialization?.completionMode ??
      (purpose === "plan_upgrade" || purpose === "plan_subscription"
        ? record.provider_name === "paystack"
          ? "paystack_resume"
          : record.provider_name === "monnify"
            ? "hosted_checkout_redirect"
            : null
        : null),
    providerReference: canonicalReference,
    authorizationUrl: initialization?.authorizationUrl ?? null,
    accessCode: initialization?.accessCode ?? null,
    checkoutUrl: initialization?.checkoutUrl ?? null,
    providerTransactionReference:
      initialization?.providerTransactionReference ?? null,
    failureCode: initialization?.failureCode ?? null,
    failureMessage: initialization?.failureMessage ?? null,
    initializedAt: initialization?.initializedAt ?? null,
    lastUpdatedAt: new Date().toISOString(),
  });

  await updatePlanPaymentRecordById(serviceClient, record.id, {
    internal_reference: canonicalReference,
    provider_reference: canonicalReference,
    metadata: nextMetadata,
  });

  return {
    ...record,
    internal_reference: canonicalReference,
    provider_reference: canonicalReference,
    metadata: nextMetadata,
  };
}

export async function prepareSoloPlusOnboardingPayment(
  input: {
    onboardingSessionId: string;
    customerEmail: string;
    amountKobo: number;
    paymentMethod: SupportedMethod;
    provider: SupportedProvider;
    metadata: Record<string, unknown>;
    serviceClient?: SupabaseClient;
    diagnostics?: SoloPlusPaymentDiagnosticLogger;
  },
): Promise<SoloPlusPaymentPreparation> {
  const serviceClient = (input.serviceClient ||
    createSoloPlusServiceRoleClient()) as SupabaseClient & SoloPlusSupabaseClientLike;
  const expectedAmount = normalizeAmountNgnString(input.amountKobo);
  const service = await createSoloPlusServerService({
    requestedMode: "public",
    onboardingSessionId: input.onboardingSessionId,
    serviceClient: serviceClient as SoloPlusSupabaseClientLike,
  });

  const created = await service.createOnboardingCase({
    idempotencyKey: `solo-plus:onboarding:${input.onboardingSessionId}`,
    expectedAmount,
    paymentCurrency: "NGN",
    requirementsPolicyVersion: SOLO_PLUS_REQUIREMENTS_POLICY_VERSION,
    requirementsSnapshot: buildRequirementsSnapshot("onboarding"),
  });
  input.diagnostics?.("case_rpc_completed", {
    caseId: created.caseRecord.id,
    caseStatus: created.caseRecord.caseStatus,
    paymentStatus: created.caseRecord.paymentStatus,
    metadata: { outcome: created.outcome },
  });

  const caseRecord = created.caseRecord;
  input.diagnostics?.("case_payload_mapped", {
    caseId: caseRecord.id,
    caseStatus: caseRecord.caseStatus,
    paymentStatus: caseRecord.paymentStatus,
  });
  input.diagnostics?.("requirements_ready", {
    caseId: caseRecord.id,
    metadata: { requirementCount: created.requirements.length },
  });
  const paymentPurpose = "plan_subscription" as const;
  const existing = await findPendingSoloPlusPaymentByCaseId(serviceClient, caseRecord.id);
  input.diagnostics?.("payment_record_lookup_completed", {
    caseId: caseRecord.id,
    paymentRecordId: existing?.id ?? null,
    metadata: { found: Boolean(existing) },
  });

  if (existing) {
    assertPendingPaymentCompatibility(existing, {
      provider: input.provider,
      paymentMethod: input.paymentMethod,
      paymentPurpose,
      expectedAmount,
    });
    const readyRecord = await ensureCanonicalSoloPlusPaymentRecord(
      serviceClient,
      existing,
      paymentPurpose,
    );

    if (caseRecord.caseStatus === "draft") {
      await service.markCaseAwaitingPayment({
        caseId: caseRecord.id,
        expectedRowVersion: caseRecord.rowVersion,
        requestIdempotencyKey: `solo-plus:awaiting-payment:${caseRecord.id}`,
      });
    }

    input.diagnostics?.("payment_record_created_or_reused", {
      caseId: caseRecord.id,
      paymentRecordId: readyRecord.id,
      provider: input.provider,
      metadata: {
        replay: true,
        hasReusableCheckout: Boolean(
          hasReusablePaymentInitialization(readyRecord, input.provider),
        ),
      },
    });
    return {
      caseId: caseRecord.id,
      reference: readyRecord.provider_reference || readyRecord.internal_reference,
      paymentRecord: readyRecord,
      replay: true,
    };
  }

  const paymentRecord = await createPendingPlanPaymentRecord(serviceClient, {
    internalReference: buildProvisionalReference(caseRecord.id, paymentPurpose),
    provider: input.provider,
    paymentMethod: input.paymentMethod,
    paymentPurpose,
    customerEmail: input.customerEmail,
    expectedAmount: Number(expectedAmount),
    planName: normalizePlanCode("solo_plus"),
    planId: getStoragePlanCode("solo_plus"),
    onboardingSessionId: input.onboardingSessionId,
    soloPlusCaseId: caseRecord.id,
    passwordSetupRequired: true,
    metadata: input.metadata,
  });
  input.diagnostics?.("payment_record_created_or_reused", {
    caseId: caseRecord.id,
    paymentRecordId: paymentRecord.id,
    provider: input.provider,
    metadata: { replay: false },
  });

  if (caseRecord.caseStatus === "draft") {
    await service.markCaseAwaitingPayment({
      caseId: caseRecord.id,
      expectedRowVersion: caseRecord.rowVersion,
      requestIdempotencyKey: `solo-plus:awaiting-payment:${caseRecord.id}`,
    });
  }

  return {
    caseId: caseRecord.id,
    reference: paymentRecord.provider_reference || paymentRecord.internal_reference,
    paymentRecord,
    replay: false,
  };
}

export async function prepareSoloPlusUpgradePayment(
  input: {
    merchantId: string;
    customerEmail: string;
    amountKobo: number;
    paymentMethod: SupportedMethod;
    provider: SupportedProvider;
    metadata: Record<string, unknown>;
    serviceClient?: SupabaseClient;
    diagnostics?: SoloPlusPaymentDiagnosticLogger;
  },
): Promise<SoloPlusPaymentPreparation> {
  const serviceClient = (input.serviceClient ||
    createSoloPlusServiceRoleClient()) as SupabaseClient & SoloPlusSupabaseClientLike;
  const expectedAmount = normalizeAmountNgnString(input.amountKobo);
  const service = await createSoloPlusServerService({
    requestedMode: "public",
    merchantId: input.merchantId,
    serviceClient: serviceClient as SoloPlusSupabaseClientLike,
  });

  const created = await service.createUpgradeCase({
    currentPlan: "solo_lite",
    idempotencyKey: `solo-plus:upgrade:${input.merchantId}`,
    expectedAmount,
    paymentCurrency: "NGN",
    requirementsPolicyVersion: SOLO_PLUS_REQUIREMENTS_POLICY_VERSION,
    requirementsSnapshot: buildRequirementsSnapshot("upgrade"),
  });
  input.diagnostics?.("case_rpc_completed", {
    caseId: created.caseRecord.id,
    caseStatus: created.caseRecord.caseStatus,
    paymentStatus: created.caseRecord.paymentStatus,
    metadata: { outcome: created.outcome },
  });

  const caseRecord = created.caseRecord;
  input.diagnostics?.("case_payload_mapped", {
    caseId: caseRecord.id,
    caseStatus: caseRecord.caseStatus,
    paymentStatus: caseRecord.paymentStatus,
  });
  input.diagnostics?.("requirements_ready", {
    caseId: caseRecord.id,
    metadata: { requirementCount: created.requirements.length },
  });
  const paymentPurpose = "plan_upgrade" as const;
  const existing = await findPendingSoloPlusPaymentByCaseId(serviceClient, caseRecord.id);
  input.diagnostics?.("payment_record_lookup_completed", {
    caseId: caseRecord.id,
    paymentRecordId: existing?.id ?? null,
    metadata: { found: Boolean(existing) },
  });

  if (existing) {
    assertPendingPaymentCompatibility(existing, {
      provider: input.provider,
      paymentMethod: input.paymentMethod,
      paymentPurpose,
      expectedAmount,
    });
    const readyRecord = await ensureCanonicalSoloPlusPaymentRecord(
      serviceClient,
      existing,
      paymentPurpose,
    );

    if (caseRecord.caseStatus === "draft") {
      await service.markCaseAwaitingPayment({
        caseId: caseRecord.id,
        expectedRowVersion: caseRecord.rowVersion,
        requestIdempotencyKey: `solo-plus:awaiting-payment:${caseRecord.id}`,
      });
    }

    input.diagnostics?.("payment_record_created_or_reused", {
      caseId: caseRecord.id,
      paymentRecordId: readyRecord.id,
      provider: input.provider,
      metadata: {
        replay: true,
        hasReusableCheckout: Boolean(
          hasReusablePaymentInitialization(readyRecord, input.provider),
        ),
      },
    });
    return {
      caseId: caseRecord.id,
      reference: readyRecord.provider_reference || readyRecord.internal_reference,
      paymentRecord: readyRecord,
      replay: true,
    };
  }

  const paymentRecord = await createPendingPlanPaymentRecord(serviceClient, {
    internalReference: buildProvisionalReference(caseRecord.id, paymentPurpose),
    provider: input.provider,
    paymentMethod: input.paymentMethod,
    paymentPurpose,
    customerEmail: input.customerEmail,
    expectedAmount: Number(expectedAmount),
    planName: normalizePlanCode("solo_plus"),
    planId: getStoragePlanCode("solo_plus"),
    merchantId: input.merchantId,
    soloPlusCaseId: caseRecord.id,
    metadata: input.metadata,
  });
  input.diagnostics?.("payment_record_created_or_reused", {
    caseId: caseRecord.id,
    paymentRecordId: paymentRecord.id,
    provider: input.provider,
    metadata: { replay: false },
  });

  if (caseRecord.caseStatus === "draft") {
    await service.markCaseAwaitingPayment({
      caseId: caseRecord.id,
      expectedRowVersion: caseRecord.rowVersion,
      requestIdempotencyKey: `solo-plus:awaiting-payment:${caseRecord.id}`,
    });
  }

  return {
    caseId: caseRecord.id,
    reference: paymentRecord.provider_reference || paymentRecord.internal_reference,
    paymentRecord,
    replay: false,
  };
}

export async function confirmSoloPlusPayment(
  input: SoloPlusConfirmationInput,
) {
  const serviceClient = (input.serviceClient ||
    createSoloPlusServiceRoleClient()) as SupabaseClient & SoloPlusSupabaseClientLike;
  const paymentRecord = await findFullPaymentRecordByReference(
    serviceClient,
    input.internalReference,
    input.provider,
  );

  if (!paymentRecord?.solo_plus_case_id) {
    return null;
  }

  const { data, error } = await serviceClient.rpc("confirm_solo_plus_payment_v1", {
    p_internal_reference: input.internalReference,
    p_provider: input.provider,
    p_provider_reference: input.providerReference,
    p_payment_purpose: input.paymentPurpose,
    p_paid_amount: input.amountNgn,
    p_currency: input.currency,
    p_merchant_id: input.merchantId || null,
    p_onboarding_session_id: input.onboardingSessionId || null,
    p_platform_directed: input.platformDirected ?? null,
    p_raw_provider_payload: input.rawProviderPayload || {},
    p_request_idempotency_key: input.requestIdempotencyKey,
  });

  if (error) {
    throw new SoloPlusPaymentLifecycleError(
      "SOLO_PLUS_PAYMENT_CONFIRMATION_CONFLICT",
      `Solo Plus payment confirmation failed: ${error.message}`,
    );
  }

  return data as Record<string, unknown>;
}
