import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getStoragePlanCode, normalizePlanCode } from "@/lib/plans";
import {
  createPendingPlanPaymentRecord,
  findFullPaymentRecordByReference,
  findPendingSoloPlusPaymentByCaseId,
  type PendingPlanPaymentRecord,
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
    | "SOLO_PLUS_PAYMENT_CONFIRMATION_CONFLICT";

  constructor(
    code:
      | "SOLO_PLUS_PAYMENT_INIT_CONFLICT"
      | "SOLO_PLUS_PAYMENT_ALREADY_CONFIRMED"
      | "SOLO_PLUS_PAYMENT_CONFIRMATION_CONFLICT",
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

function buildReference(caseId: string, purpose: SupportedPurpose) {
  const prefix = purpose === "plan_upgrade" ? "SPL-UPG" : "SPL-SUB";
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

export async function prepareSoloPlusOnboardingPayment(
  input: {
    onboardingSessionId: string;
    customerEmail: string;
    amountKobo: number;
    paymentMethod: SupportedMethod;
    provider: SupportedProvider;
    metadata: Record<string, unknown>;
    serviceClient?: SupabaseClient;
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

  const caseRecord = created.caseRecord;
  const paymentPurpose = "plan_subscription" as const;
  const reference = buildReference(caseRecord.id, paymentPurpose);
  const existing = await findPendingSoloPlusPaymentByCaseId(serviceClient, caseRecord.id);

  if (existing) {
    assertPendingPaymentCompatibility(existing, {
      provider: input.provider,
      paymentMethod: input.paymentMethod,
      paymentPurpose,
      expectedAmount,
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
      reference: existing.internal_reference,
      paymentRecord: existing,
      replay: true,
    };
  }

  const paymentRecord = await createPendingPlanPaymentRecord(serviceClient, {
    internalReference: reference,
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

  if (caseRecord.caseStatus === "draft") {
    await service.markCaseAwaitingPayment({
      caseId: caseRecord.id,
      expectedRowVersion: caseRecord.rowVersion,
      requestIdempotencyKey: `solo-plus:awaiting-payment:${caseRecord.id}`,
    });
  }

  return {
    caseId: caseRecord.id,
    reference,
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

  const caseRecord = created.caseRecord;
  const paymentPurpose = "plan_upgrade" as const;
  const reference = buildReference(caseRecord.id, paymentPurpose);
  const existing = await findPendingSoloPlusPaymentByCaseId(serviceClient, caseRecord.id);

  if (existing) {
    assertPendingPaymentCompatibility(existing, {
      provider: input.provider,
      paymentMethod: input.paymentMethod,
      paymentPurpose,
      expectedAmount,
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
      reference: existing.internal_reference,
      paymentRecord: existing,
      replay: true,
    };
  }

  const paymentRecord = await createPendingPlanPaymentRecord(serviceClient, {
    internalReference: reference,
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

  if (caseRecord.caseStatus === "draft") {
    await service.markCaseAwaitingPayment({
      caseId: caseRecord.id,
      expectedRowVersion: caseRecord.rowVersion,
      requestIdempotencyKey: `solo-plus:awaiting-payment:${caseRecord.id}`,
    });
  }

  return {
    caseId: caseRecord.id,
    reference,
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
