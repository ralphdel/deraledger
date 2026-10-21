import type { ExistingGateDecision } from "../shadow-capability-observer-core";
import type { PolicyDiagnostic } from "./contract";

export interface PolicyShadowResult<T> {
  readonly existingGate: ExistingGateDecision<T>;
  readonly diagnostic: PolicyDiagnostic;
  readonly comparison: "diagnostic_only" | "requires_reconciliation";
  readonly reasonCodes: readonly string[];
}

/** Pure report composition; the caller's existing decision is returned by reference. */
export function composePolicyShadowResult<T>(existingGate: ExistingGateDecision<T>, diagnostic: PolicyDiagnostic): PolicyShadowResult<T> {
  const requiresReconciliation = diagnostic.projectability !== "confidently_projectable";
  return {
    existingGate, diagnostic,
    comparison: requiresReconciliation ? "requires_reconciliation" : "diagnostic_only",
    reasonCodes: [...diagnostic.reasonCodes],
  };
}
