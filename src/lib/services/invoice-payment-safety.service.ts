export const RECORD_INVOICE_PAYMENT_ERROR = {
  code: "RECORD_INVOICE_OFFLINE_ONLY",
  error: "Record invoices are offline records and cannot accept online payments.",
} as const;

export function getInvoicePaymentInitializationError(invoice: {
  invoice_type?: string | null;
} | null | undefined) {
  return invoice?.invoice_type === "record" ? RECORD_INVOICE_PAYMENT_ERROR : null;
}

export function getVerifiedProviderSubaccountCode(
  settlement: {
    ready?: boolean;
    account?: { status?: string | null; verification_status?: string | null } | null;
    mapping?: {
      provider_name?: string | null;
      environment?: string | null;
      status?: string | null;
      provider_subaccount_code?: string | null;
    } | null;
  } | null | undefined,
  input: { provider: string; environment: string },
) {
  const mapping = settlement?.mapping;
  if (!settlement?.ready || !mapping || !settlement.account) return null;
  if (settlement.account.status !== "active" || settlement.account.verification_status !== "verified") {
    return null;
  }
  if (mapping.provider_name !== input.provider || mapping.environment !== input.environment) {
    return null;
  }
  if (!(["connected", "active"] as string[]).includes(String(mapping.status || "").toLowerCase())) {
    return null;
  }
  return typeof mapping.provider_subaccount_code === "string" && mapping.provider_subaccount_code.trim()
    ? mapping.provider_subaccount_code.trim()
    : null;
}
