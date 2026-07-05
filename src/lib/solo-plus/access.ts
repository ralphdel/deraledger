function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export type SoloPlusFeatureFlags = {
  soloPlusEnabled: boolean;
  soloPlusKycEnabled: boolean;
};

export type SoloPlusAccessContext =
  | {
      mode: "public";
      authenticatedUserId: string;
    }
  | {
      mode: "internal_test";
      authenticatedAdminId?: string;
      sandboxMerchantId?: string;
      isAuthorizedAdmin: boolean;
      isSandboxMerchant: boolean;
    };

export type SoloPlusResolvedEventActor = {
  actorType: "merchant" | "admin";
  actorId: string | null;
  accessMode: SoloPlusAccessContext["mode"];
};

export function isSoloPlusFeatureFlags(value: unknown): value is SoloPlusFeatureFlags {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.soloPlusEnabled === "boolean" &&
    typeof candidate.soloPlusKycEnabled === "boolean"
  );
}

export function isSoloPlusAccessContext(value: unknown): value is SoloPlusAccessContext {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  if (candidate.mode === "public") {
    return hasNonEmptyString(candidate.authenticatedUserId);
  }

  if (candidate.mode !== "internal_test") {
    return false;
  }

  if (
    typeof candidate.isAuthorizedAdmin !== "boolean" ||
    typeof candidate.isSandboxMerchant !== "boolean"
  ) {
    return false;
  }

  if (candidate.isAuthorizedAdmin === true && !hasNonEmptyString(candidate.authenticatedAdminId)) {
    return false;
  }

  if (candidate.isSandboxMerchant === true && !hasNonEmptyString(candidate.sandboxMerchantId)) {
    return false;
  }

  if (candidate.isAuthorizedAdmin !== true && candidate.isSandboxMerchant !== true) {
    return false;
  }

  return true;
}

export function canCreatePublicSoloPlusCase(
  flags: SoloPlusFeatureFlags,
  accessContext: SoloPlusAccessContext,
): boolean {
  return (
    accessContext.mode === "public" &&
    hasNonEmptyString(accessContext.authenticatedUserId) &&
    flags.soloPlusEnabled === true &&
    flags.soloPlusKycEnabled === true
  );
}

export function canCreateInternalSoloPlusTestCase(
  flags: SoloPlusFeatureFlags,
  accessContext: SoloPlusAccessContext,
): boolean {
  if (accessContext.mode !== "internal_test") {
    return false;
  }

  if (flags.soloPlusKycEnabled !== true) {
    return false;
  }

  return (
    (accessContext.isAuthorizedAdmin === true &&
      hasNonEmptyString(accessContext.authenticatedAdminId)) ||
    (accessContext.isSandboxMerchant === true &&
      hasNonEmptyString(accessContext.sandboxMerchantId))
  );
}

export function resolveSoloPlusEventActor(
  accessContext: SoloPlusAccessContext,
): SoloPlusResolvedEventActor {
  if (accessContext.mode === "public") {
    return {
      actorType: "merchant",
      actorId: accessContext.authenticatedUserId.trim(),
      accessMode: accessContext.mode,
    };
  }

  if (accessContext.isAuthorizedAdmin === true) {
    return {
      actorType: "admin",
      actorId: accessContext.authenticatedAdminId?.trim() || null,
      accessMode: accessContext.mode,
    };
  }

  return {
    actorType: "merchant",
    actorId: null,
    accessMode: accessContext.mode,
  };
}
