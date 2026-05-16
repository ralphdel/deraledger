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

/** Minimal allocation shape */
export interface FinancialAllocation {
  source_invoice_id: string;
  target_invoice_id: string;
  allocated_amount: number;
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
  /** Sum of all deposit amounts allocated to target invoices under this reference */
  depositAllocationsTotal: number;
}

/**
 * Computes all financial metrics for a reference/project.
 *
 * @param ref        The reference record (must include project_total_value)
 * @param allInvoices All invoices for the merchant (unfiltered — function filters internally)
 * @param allAllocations Optional: all invoice_allocations for the merchant (used to sum deposit allocation totals)
 */
export function computeReferenceFinancials(
  ref: Reference & { project_total_value?: number | null },
  allInvoices: FinancialInvoice[],
  allAllocations?: FinancialAllocation[]
): ReferenceFinancials {
  // Only collection invoices that belong to this reference
  const linked = allInvoices.filter(
    (inv) =>
      inv.reference_id === ref.id &&
      inv.invoice_type === "collection"
  );

  const linkedIds = new Set(linked.map((inv) => inv.id));



  const totalCollected = linked.reduce(
    (sum, inv) => sum + Number(inv.amount_paid ?? 0),
    0
  );

  const projectTotalValue = Number(ref.project_total_value ?? 0);
  const hasProjectTotal = projectTotalValue > 0;

  // Use the actual outstanding balance from the DB, which correctly accounts for applied deposits
  const invoiceOutstanding = linked.reduce(
    (sum, inv) => sum + Number((inv as any).outstanding_balance ?? 0),
    0
  );

  const outstandingBalance = hasProjectTotal
    ? Math.max(0, projectTotalValue - totalCollected)
    : invoiceOutstanding;

  // Derive total billed to prevent double-counting of deposit invoice grand totals
  const totalBilled = hasProjectTotal 
    ? projectTotalValue 
    : totalCollected + invoiceOutstanding;

  const collectionProgress = hasProjectTotal
    ? Math.min(100, Math.round((totalCollected / projectTotalValue) * 100))
    : 0;

  const suggestedNextInvoiceAmount = hasProjectTotal
    ? outstandingBalance
    : 0;

  // Sum allocations where target_invoice_id is one of the linked invoices
  const depositAllocationsTotal = (allAllocations || []).reduce((sum, a) => {
    return linkedIds.has(a.target_invoice_id) ? sum + Number(a.allocated_amount ?? 0) : sum;
  }, 0);

  return {
    projectTotalValue,
    totalBilled,
    totalCollected,
    outstandingBalance,
    collectionProgress,
    hasProjectTotal,
    suggestedNextInvoiceAmount,
    invoiceCount: linked.length,
    depositAllocationsTotal,
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
