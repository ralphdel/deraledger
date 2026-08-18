import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PLAN_ALIASES,
  getPlanPriceKobo,
  getStoragePlanCode,
  normalizePlanCode,
  type CanonicalPlanCode,
  type LegacyPlanCode,
} from "@/lib/plans";

type PaidPlanCode = Exclude<CanonicalPlanCode, "starter">;

export type PaidOnboardingSession = {
  id: string;
  email: string;
  business_name: string;
  plan: string;
  status: string;
  expires_at: string | null;
  merchant_id?: string | null;
  business_type?: string | null;
  relationship_claim?: string | null;
  verification_disclosure_acknowledged_at?: string | null;
  verification_disclosure_version?: string | null;
};

export class PaidOnboardingPaymentError extends Error {
  constructor(
    public readonly code:
      | "INVALID_PAID_PLAN"
      | "INVALID_AMOUNT"
      | "SESSION_NOT_FOUND"
      | "SESSION_LOOKUP_FAILED"
      | "SESSION_EMAIL_MISMATCH"
      | "SESSION_PLAN_MISMATCH"
      | "SESSION_NOT_PAYABLE"
      | "SESSION_EXPIRED",
    message: string,
    public readonly httpStatus: number,
  ) {
    super(message);
    this.name = "PaidOnboardingPaymentError";
  }
}

export function resolveCanonicalPaidPlan(input: unknown): {
  plan: PaidPlanCode;
  storagePlan: LegacyPlanCode;
  amountKobo: number;
} {
  const rawPlan = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (!Object.prototype.hasOwnProperty.call(PLAN_ALIASES, rawPlan)) {
    throw new PaidOnboardingPaymentError(
      "INVALID_PAID_PLAN",
      "Select a valid paid plan before continuing.",
      400,
    );
  }

  const plan = normalizePlanCode(rawPlan);
  if (plan === "starter") {
    throw new PaidOnboardingPaymentError(
      "INVALID_PAID_PLAN",
      "Starter is free and cannot be processed through paid checkout.",
      400,
    );
  }

  return {
    plan,
    storagePlan: getStoragePlanCode(plan),
    amountKobo: getPlanPriceKobo(plan),
  };
}

export function assertCanonicalPaidAmount(plan: unknown, submittedAmountKobo: unknown) {
  const pricing = resolveCanonicalPaidPlan(plan);
  const submittedAmount = Number(submittedAmountKobo);
  if (!Number.isSafeInteger(submittedAmount) || submittedAmount !== pricing.amountKobo) {
    throw new PaidOnboardingPaymentError(
      "INVALID_AMOUNT",
      "The checkout amount does not match the selected plan price. Please restart checkout.",
      400,
    );
  }
  return pricing;
}

export function validatePaidOnboardingSessionBinding(input: {
  session: PaidOnboardingSession | null;
  email: unknown;
  plan: unknown;
  amountKobo: unknown;
  mode: "initialize" | "confirm";
  nowMs?: number;
}) {
  const pricing = assertCanonicalPaidAmount(input.plan, input.amountKobo);
  const session = input.session;
  if (!session) {
    throw new PaidOnboardingPaymentError(
      "SESSION_NOT_FOUND",
      "Onboarding session was not found. Please restart onboarding.",
      404,
    );
  }

  const submittedEmail = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const sessionEmail = String(session.email || "").trim().toLowerCase();
  if (!submittedEmail || submittedEmail !== sessionEmail) {
    throw new PaidOnboardingPaymentError(
      "SESSION_EMAIL_MISMATCH",
      "Onboarding session details do not match this checkout.",
      403,
    );
  }

  if (normalizePlanCode(session.plan) !== pricing.plan) {
    throw new PaidOnboardingPaymentError(
      "SESSION_PLAN_MISMATCH",
      "Onboarding session plan does not match this checkout.",
      409,
    );
  }

  const acceptedStatuses = input.mode === "initialize"
    ? new Set(["awaiting_payment"])
    : new Set(["awaiting_payment", "processing", "payment_confirmed"]);
  if (!acceptedStatuses.has(String(session.status || "").toLowerCase())) {
    throw new PaidOnboardingPaymentError(
      "SESSION_NOT_PAYABLE",
      "This onboarding session has already been used or is not payable.",
      409,
    );
  }

  const expiresAt = session.expires_at ? new Date(session.expires_at).getTime() : Number.NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= (input.nowMs ?? Date.now())) {
    throw new PaidOnboardingPaymentError(
      "SESSION_EXPIRED",
      "This onboarding session has expired. Please restart onboarding.",
      410,
    );
  }

  return { ...pricing, session };
}

export async function loadAndValidatePaidOnboardingSession(
  supabase: SupabaseClient,
  input: {
    sessionId: unknown;
    email: unknown;
    plan: unknown;
    amountKobo: unknown;
    mode: "initialize" | "confirm";
  },
) {
  const sessionId = typeof input.sessionId === "string" ? input.sessionId.trim() : "";
  if (!sessionId) {
    throw new PaidOnboardingPaymentError(
      "SESSION_NOT_FOUND",
      "Onboarding session was not found. Please restart onboarding.",
      404,
    );
  }

  const { data, error } = await supabase
    .from("onboarding_sessions")
    .select("id,email,business_name,plan,status,expires_at,merchant_id,business_type,relationship_claim,verification_disclosure_acknowledged_at,verification_disclosure_version")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    throw new PaidOnboardingPaymentError(
      "SESSION_LOOKUP_FAILED",
      "Onboarding session could not be verified. Please try again.",
      500,
    );
  }

  return validatePaidOnboardingSessionBinding({
    session: data as PaidOnboardingSession | null,
    email: input.email,
    plan: input.plan,
    amountKobo: input.amountKobo,
    mode: input.mode,
  });
}
