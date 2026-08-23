import type { InvoiceCreationAccessResult } from "@/lib/services/access-control";
import {
  observeShadowCapability,
  type ObserveShadowCapabilityInput,
} from "./shadow-capability-observer-core";

export interface ObserveCollectionInvoiceAccessDecisionInput {
  requestedInvoiceType: "record" | "collection";
  invoiceAccess: InvoiceCreationAccessResult;
  observation: Omit<
    ObserveShadowCapabilityInput<InvoiceCreationAccessResult>,
    "routeClass" | "existingGate"
  >;
}

function existingGateFor(access: InvoiceCreationAccessResult) {
  return {
    outcome: access.allowed ? "allow" as const : "deny" as const,
    reasonCodes: access.allowed ? [] : ["invoice_type_gate"],
    value: access,
  };
}

/**
 * Collection-only observation adapter. The existing access object is returned
 * by reference, and Record Invoice never invokes the generic observer.
 */
export async function observeCollectionInvoiceAccessDecision(
  input: ObserveCollectionInvoiceAccessDecisionInput,
): Promise<InvoiceCreationAccessResult> {
  if (input.requestedInvoiceType !== "collection") {
    return input.invoiceAccess;
  }

  const observation = await observeShadowCapability({
    ...input.observation,
    routeClass: "collection_invoice",
    existingGate: existingGateFor(input.invoiceAccess),
  });
  return observation.existingGate.value;
}
