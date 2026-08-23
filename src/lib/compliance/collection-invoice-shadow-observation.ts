import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { createClient } from "@/lib/supabase/server";
import type { InvoiceCreationAccessResult } from "@/lib/services/access-control";
import {
  loadTrustedRuntimeCapabilityContext,
} from "./trusted-runtime-capability-loader";
import {
  createTrustedRuntimeCapabilityRepository,
  type SupabaseReadClientLike,
} from "./trusted-runtime-capability-repository";
import {
  observeCollectionInvoiceAccessDecision,
} from "./collection-invoice-shadow-observation-core";
import {
  buildTrustedRuntimeCapabilityContext,
  toResolveMerchantCapabilitiesInput,
} from "./runtime-capability-context";
import type { ShadowCapabilityObserverConfig } from "./shadow-capability-observer";

type CollectionProvider = "paystack" | "monnify" | "breet";
type PaymentEnvironment = "sandbox" | "live";

export interface ObserveCollectionInvoiceAccessInput {
  invoiceAccess: InvoiceCreationAccessResult;
  trustedMerchantId: string;
  /** Existing server-only service-role client; it is not used while off. */
  readClient: unknown;
}

function isTrue(value: string | undefined) {
  return value === "true";
}

function configuredProvider(): CollectionProvider | null {
  const provider = process.env.DERALEDGER_SHADOW_COLLECTION_INVOICE_PROVIDER;
  return provider === "paystack" || provider === "monnify" || provider === "breet"
    ? provider
    : null;
}

function configuredEnvironment(): PaymentEnvironment | null {
  const environment = process.env.DERALEDGER_SHADOW_COLLECTION_INVOICE_ENVIRONMENT;
  return environment === "sandbox" || environment === "live" ? environment : null;
}

function observerConfig(): ShadowCapabilityObserverConfig | null {
  const provider = configuredProvider();
  const environment = configuredEnvironment();
  if (!provider || !environment) return null;
  return {
    enabled: isTrue(process.env.DERALEDGER_SHADOW_COLLECTION_INVOICE_ENABLED),
    sampled: isTrue(process.env.DERALEDGER_SHADOW_COLLECTION_INVOICE_SAMPLED),
    killSwitchActive: process.env.DERALEDGER_SHADOW_COLLECTION_INVOICE_KILL_SWITCH !== "false",
  };
}

function hashIdentifier(identifier: string): string {
  return createHash("sha256")
    .update(`collection-invoice-shadow-v1:${identifier}`)
    .digest("hex");
}

/**
 * Default-off runtime wrapper for the approved Collection Invoice boundary.
 * It has no authority over the gate and performs only read-only loader work
 * after the existing access result is complete.
 */
export async function observeCollectionInvoiceAccess(
  input: ObserveCollectionInvoiceAccessInput,
): Promise<InvoiceCreationAccessResult> {
  const config = observerConfig();
  if (!config || config.enabled !== true || config.sampled !== true || config.killSwitchActive === true) {
    return input.invoiceAccess;
  }

  const provider = configuredProvider();
  const environment = configuredEnvironment();
  if (!provider || !environment) return input.invoiceAccess;

  const authClient = await createClient();
  const { data: { user }, error: userError } = await authClient.auth.getUser();
  const repository = createTrustedRuntimeCapabilityRepository(input.readClient as SupabaseReadClientLike, {
    provider,
    environment,
  });
  const unauthenticatedContext = buildTrustedRuntimeCapabilityContext({
    commercialEntitlementState: "missing",
  });

  return observeCollectionInvoiceAccessDecision({
    requestedInvoiceType: "collection",
    invoiceAccess: input.invoiceAccess,
    observation: {
      config,
      correlationId: randomUUID(),
      trustedMerchantId: input.trustedMerchantId,
      hashIdentifier,
      load: () => userError || !user
        ? Promise.resolve({
            status: "incomplete" as const,
            context: unauthenticatedContext,
            resolverInput: toResolveMerchantCapabilitiesInput(unauthenticatedContext),
            diagnostics: [{ code: "trusted_identity_missing" as const }],
          })
        : loadTrustedRuntimeCapabilityContext(repository, { authenticatedUserId: user.id }),
      emit: (event) => {
        console.info("[collection-invoice-capability-shadow]", JSON.stringify(event));
      },
    },
  });
}
