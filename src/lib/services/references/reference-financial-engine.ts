/**
 * DeraLedger — Reference Financial Engine
 *
 * Pure calculation service. No DB writes. No stored totals.
 * All figures are computed dynamically from live invoice data.
 *
 * RULE: Only "collection" invoices count toward project financials.
 * "record" invoices are lightweight offline records and are excluded.
 */

import type { Reference } from "@/lib/types";

/** Minimal invoice shape needed for financial calculations */
export interface FinancialInvoice {
  id: string;
  reference_id?: string | null;
  invoice_type: "record" | "collection";
  grand_total: number;
  amount_paid: number;
  status: string;
}

export interface ReferenceFinancials {
  /** The optional project ceiling set by the merchant */
  projectTotalValue: number;
  /** Sum of grand_total across all linked COLLECTION invoices */
  totalBilled: number;
  /** Sum of amount_paid across all linked COLLECTION invoices */
  totalCollected: number;
  /**
   * If project_total_value is set: projectTotalValue - totalCollected
   * Otherwise: totalBilled - totalCollected (invoice-based outstanding)
   */
  outstandingBalance: number;
  /**
   * Progress toward project_total_value (0–100).
   * 0 when project_total_value is not set.
   */
  collectionProgress: number;
  /** True when project_total_value > 0 */
  hasProjectTotal: boolean;
  /**
   * Suggested amount for the next invoice in this project.
   * Equals outstandingBalance when project_total_value is set,
   * else 0 (no suggestion without a ceiling).
   */
  suggestedNextInvoiceAmount: number;
  /** Count of linked collection invoices */
  invoiceCount: number;
}

/**
 * Computes all financial metrics for a reference/project.
 *
 * @param ref        The reference record (must include project_total_value)
 * @param allInvoices All invoices for the merchant (unfiltered — function filters internally)
 */
export function computeReferenceFinancials(
  ref: Reference & { project_total_value?: number | null },
  allInvoices: FinancialInvoice[]
): ReferenceFinancials {
  // Only collection invoices that belong to this reference
  const linked = allInvoices.filter(
    (inv) =>
      inv.reference_id === ref.id &&
      inv.invoice_type === "collection"
  );

  const totalBilled = linked.reduce(
    (sum, inv) => sum + Number(inv.grand_total ?? 0),
    0
  );

  const totalCollected = linked.reduce(
    (sum, inv) => sum + Number(inv.amount_paid ?? 0),
    0
  );

  const projectTotalValue = Number(ref.project_total_value ?? 0);
  const hasProjectTotal = projectTotalValue > 0;

  const outstandingBalance = hasProjectTotal
    ? Math.max(0, projectTotalValue - totalCollected)
    : Math.max(0, totalBilled - totalCollected);

  const collectionProgress = hasProjectTotal
    ? Math.min(100, Math.round((totalCollected / projectTotalValue) * 100))
    : 0;

  const suggestedNextInvoiceAmount = hasProjectTotal
    ? outstandingBalance
    : 0;

  return {
    projectTotalValue,
    totalBilled,
    totalCollected,
    outstandingBalance,
    collectionProgress,
    hasProjectTotal,
    suggestedNextInvoiceAmount,
    invoiceCount: linked.length,
  };
}

/**
 * Lightweight version for the public payment portal.
 * Accepts raw numbers directly (pre-fetched from API).
 */
export function computeReferenceFinancialsFromRaw(params: {
  projectTotalValue: number;
  siblingAmountPaid: number; // sum of amount_paid from ALL sibling collection invoices
}): Pick<
  ReferenceFinancials,
  | "projectTotalValue"
  | "totalCollected"
  | "outstandingBalance"
  | "collectionProgress"
  | "hasProjectTotal"
> {
  const { projectTotalValue, siblingAmountPaid } = params;
  const hasProjectTotal = projectTotalValue > 0;
  const totalCollected = siblingAmountPaid;
  const outstandingBalance = hasProjectTotal
    ? Math.max(0, projectTotalValue - totalCollected)
    : 0;
  const collectionProgress = hasProjectTotal
    ? Math.min(100, Math.round((totalCollected / projectTotalValue) * 100))
    : 0;
  return {
    projectTotalValue,
    totalCollected,
    outstandingBalance,
    collectionProgress,
    hasProjectTotal,
  };
}
