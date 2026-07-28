import { randomUUID } from "node:crypto";

type SafeDiagnosticValue =
  | string
  | number
  | boolean
  | null
  | readonly string[]
  | Record<string, unknown>;

export type PaymentUpgradeDiagnosticStage =
  | "request_received"
  | "request_validated"
  | "auth_resolved"
  | "merchant_resolved"
  | "solo_plus_preparation_started"
  | "case_rpc_completed"
  | "case_payload_mapped"
  | "requirements_ready"
  | "payment_record_lookup_completed"
  | "payment_record_created_or_reused"
  | "recovery_requested"
  | "case_resolved"
  | "old_payment_resolved"
  | "provider_verification_started"
  | "provider_verification_completed"
  | "recovery_eligibility_determined"
  | "old_payment_superseded"
  | "new_payment_created"
  | "provider_session_reused"
  | "provider_route_selected"
  | "provider_configuration_validated"
  | "provider_initialization_started"
  | "provider_initialization_completed"
  | "provider_session_persisted"
  | "response_ready"
  | "request_failed";

export type PaymentUpgradeDiagnosticEvent = {
  requestId: string;
  stage: PaymentUpgradeDiagnosticStage;
  operation: "payment_upgrade" | "payment_upgrade_recover";
  userId?: string | null;
  merchantId?: string | null;
  planCode?: string | null;
  caseId?: string | null;
  caseStatus?: string | null;
  paymentStatus?: string | null;
  paymentRecordId?: string | null;
  provider?: string | null;
  dataShape?: "null" | "array" | "object" | "primitive";
  arrayLength?: number | null;
  topLevelKeys?: readonly string[];
  nestedCaseKeys?: readonly string[];
  errorName?: string | null;
  errorCode?: string | null;
  postgrestCode?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  shortStack?: string | null;
  metadata?: Record<string, unknown>;
};

type ErrorLike = {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  stack?: unknown;
};

export function createPaymentUpgradeRequestId() {
  return randomUUID();
}

export function describeDataShape(value: unknown) {
  if (value == null) {
    return { dataShape: "null" as const, arrayLength: null, topLevelKeys: [], nestedCaseKeys: [] };
  }

  if (Array.isArray(value)) {
    return {
      dataShape: "array" as const,
      arrayLength: value.length,
      topLevelKeys: [],
      nestedCaseKeys: [],
    };
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const nestedCase = record.case;
    return {
      dataShape: "object" as const,
      arrayLength: null,
      topLevelKeys: Object.keys(record).sort(),
      nestedCaseKeys:
        typeof nestedCase === "object" && nestedCase !== null && !Array.isArray(nestedCase)
          ? Object.keys(nestedCase as Record<string, unknown>).sort()
          : [],
    };
  }

  return { dataShape: "primitive" as const, arrayLength: null, topLevelKeys: [], nestedCaseKeys: [] };
}

export function describeError(error: unknown) {
  const candidate =
    typeof error === "object" && error !== null ? (error as ErrorLike) : null;
  const message = typeof candidate?.message === "string" ? candidate.message : String(error);
  const stack = typeof candidate?.stack === "string" ? candidate.stack : null;

  return {
    errorName: typeof candidate?.name === "string" ? candidate.name : typeof error,
    errorCode: typeof candidate?.code === "string" ? candidate.code : null,
    postgrestCode: typeof candidate?.code === "string" && candidate.code.startsWith("PGRST")
      ? candidate.code
      : null,
    message: sanitizeDiagnosticText(message),
    details:
      typeof candidate?.details === "string"
        ? sanitizeDiagnosticText(candidate.details)
        : null,
    hint:
      typeof candidate?.hint === "string"
        ? sanitizeDiagnosticText(candidate.hint)
        : null,
    shortStack: stack ? sanitizeDiagnosticText(stack.split("\n").slice(0, 4).join(" | ")) : null,
  };
}

export function createPaymentUpgradeLogger(
  requestId: string,
  operation: "payment_upgrade" | "payment_upgrade_recover" = "payment_upgrade",
) {
  return (
    stage: PaymentUpgradeDiagnosticStage,
    event: Omit<PaymentUpgradeDiagnosticEvent, "requestId" | "stage" | "operation"> = {},
  ) => {
    const payload: PaymentUpgradeDiagnosticEvent = {
      requestId,
      stage,
      operation,
      ...event,
      metadata: event.metadata ? sanitizeMetadata(event.metadata) : undefined,
    };

    console.info(
      operation === "payment_upgrade_recover"
        ? "[payment-upgrade-recover]"
        : "[payment-upgrade]",
      payload,
    );
  };
}

function sanitizeMetadata(metadata: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, sanitizeMetadataValue(value)]),
  );
}

function sanitizeMetadataValue(value: unknown): SafeDiagnosticValue {
  if (value == null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return typeof value === "string" ? sanitizeDiagnosticText(value) : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeDiagnosticText(String(entry))).slice(0, 20);
  }

  if (typeof value === "object") {
    return describeDataShape(value);
  }

  return sanitizeDiagnosticText(String(value));
}

function sanitizeDiagnosticText(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(secret|token|password|authorization|cookie)=([^&\s]+)/gi, "$1=[redacted]")
    .slice(0, 1000);
}
