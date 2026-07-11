import "server-only";

import {
  canCreateInternalSoloPlusTestCase,
  canCreatePublicSoloPlusCase,
  type SoloPlusAccessContext,
  type SoloPlusFeatureFlags,
} from "../access";
import { createSoloPlusServiceRoleClient, type SoloPlusSupabaseClientLike } from "./supabase-repository";

type SupabaseLikeError = {
  message: string;
};

type SoloPlusAuthUserLike = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
  email_confirmed_at?: string | null;
};

type SoloPlusAuthClientLike = {
  auth: {
    getUser(): Promise<{
      data: { user: SoloPlusAuthUserLike | null };
      error: SupabaseLikeError | null;
    }>;
  };
  from(table: string): SoloPlusSupabaseQueryBuilderLike;
};

type SoloPlusSupabaseQueryBuilderLike = {
  select(columns: string): SoloPlusSupabaseQueryBuilderLike;
  eq(column: string, value: unknown): SoloPlusSupabaseQueryBuilderLike;
  in(column: string, values: readonly unknown[]): SoloPlusSupabaseQueryBuilderLike;
  limit(count: number): SoloPlusSupabaseQueryBuilderLike;
  maybeSingle(): Promise<{ data: unknown; error: SupabaseLikeError | null }>;
  then?<TResult1 = { data: unknown; error: SupabaseLikeError | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: SupabaseLikeError | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
};

type SoloPlusMerchantOwnershipRow = {
  id: string;
  user_id: string | null;
  email: string | null;
  is_super_admin: boolean | null;
};

type SoloPlusOnboardingSessionRow = {
  id: string;
  email: string;
  merchant_id: string | null;
  status?: string | null;
  expires_at?: string | null;
};

export type SoloPlusServerAccessMode = "public" | "internal_test";

export type SoloPlusServerFeatureFlags = SoloPlusFeatureFlags & {
  planMigrationSoloLiteEnabled: boolean;
};

export type SoloPlusResolvedAuthenticatedUser = {
  id: string;
  email: string | null;
  isSuperAdmin: boolean;
  hasVerifiedEmail: boolean;
};

export type SoloPlusResolvedMerchantOwnership = {
  merchantId: string;
  ownerUserId: string;
  email: string | null;
};

export type SoloPlusResolvedOnboardingSessionOwnership = {
  onboardingSessionId: string;
  email: string;
  merchantId: string | null;
  ownershipBasis: "merchant_owner" | "session_email";
};

export type SoloPlusResolvedServerActor = {
  authenticatedUserId: string;
  authenticatedUserEmail: string | null;
  isSuperAdmin: boolean;
  merchantOwnership: SoloPlusResolvedMerchantOwnership | null;
  onboardingSessionOwnership: SoloPlusResolvedOnboardingSessionOwnership | null;
  sandboxMerchantId: string | null;
};

export type ResolveSoloPlusServerAccessOptions = {
  requestedMode: SoloPlusServerAccessMode;
  merchantId?: string | null;
  onboardingSessionId?: string | null;
  authClient?: SoloPlusAuthClientLike;
  serviceClient?: SoloPlusSupabaseClientLike;
  env?: NodeJS.ProcessEnv;
};

export type SoloPlusResolvedServerAccess = {
  accessContext: SoloPlusAccessContext;
  featureFlags: SoloPlusServerFeatureFlags;
  authenticatedUser: SoloPlusResolvedAuthenticatedUser;
  merchantOwnership: SoloPlusResolvedMerchantOwnership | null;
  onboardingSessionOwnership: SoloPlusResolvedOnboardingSessionOwnership | null;
  actor: SoloPlusResolvedServerActor;
};

export type SoloPlusServerAccessErrorCode =
  | "SOLO_PLUS_SERVER_CONFIG_ERROR"
  | "SOLO_PLUS_SERVER_UNAUTHORIZED"
  | "SOLO_PLUS_SERVER_FORBIDDEN"
  | "SOLO_PLUS_SERVER_NOT_FOUND";

export class SoloPlusServerAccessError extends Error {
  readonly code: SoloPlusServerAccessErrorCode;

  constructor(code: SoloPlusServerAccessErrorCode, message: string) {
    super(message);
    this.name = "SoloPlusServerAccessError";
    this.code = code;
  }
}

const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function normalizeOptionalString(value: unknown): string | null {
  return hasNonEmptyString(value) ? value.trim() : null;
}

function normalizeOptionalEmail(value: unknown): string | null {
  return hasNonEmptyString(value) ? value.trim().toLowerCase() : null;
}

function hasVerifiedEmail(user: SoloPlusAuthUserLike | null | undefined): boolean {
  return hasNonEmptyString(user?.email_confirmed_at);
}

function isClaimableOnboardingSession(row: SoloPlusOnboardingSessionRow): boolean {
  const status = normalizeOptionalString(row.status);
  if (status !== "awaiting_payment" && status !== "payment_confirmed") {
    return false;
  }

  if (!hasNonEmptyString(row.expires_at)) {
    return true;
  }

  const parsed = new Date(row.expires_at);
  return !Number.isNaN(parsed.valueOf()) && parsed.valueOf() > Date.now();
}

function assertEnvironment(env: NodeJS.ProcessEnv): void {
  if (!hasNonEmptyString(env.NEXT_PUBLIC_SUPABASE_URL)) {
    throw new SoloPlusServerAccessError(
      "SOLO_PLUS_SERVER_CONFIG_ERROR",
      "Solo Plus server access requires NEXT_PUBLIC_SUPABASE_URL.",
    );
  }

  if (!hasNonEmptyString(env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
    throw new SoloPlusServerAccessError(
      "SOLO_PLUS_SERVER_CONFIG_ERROR",
      "Solo Plus server access requires NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  if (!hasNonEmptyString(env.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new SoloPlusServerAccessError(
      "SOLO_PLUS_SERVER_CONFIG_ERROR",
      "Solo Plus server access requires SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
}

async function createDefaultAuthClient(): Promise<SoloPlusAuthClientLike> {
  const { createClient } = await import("@/lib/supabase/server");
  return (await createClient()) as unknown as SoloPlusAuthClientLike;
}

function readBooleanFlag(value: string | null | undefined): boolean {
  return value != null && TRUE_VALUES.has(String(value).trim().toLowerCase());
}

function assertRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SoloPlusServerAccessError(
      "SOLO_PLUS_SERVER_CONFIG_ERROR",
      `Solo Plus server access could not read ${field}.`,
    );
  }

  return value as Record<string, unknown>;
}

async function loadPlatformSettings(
  serviceClient: SoloPlusSupabaseClientLike,
): Promise<Map<string, string>> {
  const { data, error } = (await (serviceClient
    .from("platform_settings")
    .select("key, value")
    .in("key", [
      "plan_migration_solo_lite_enabled",
      "solo_plus_enabled",
      "solo_plus_kyc_enabled",
      "superadmin_sandbox_email",
    ]) as unknown as Promise<{
      data: unknown;
      error: SupabaseLikeError | null;
    }>)) as {
    data: unknown;
    error: SupabaseLikeError | null;
  };

  if (error) {
    throw new SoloPlusServerAccessError(
      "SOLO_PLUS_SERVER_CONFIG_ERROR",
      "Solo Plus server access could not load platform settings.",
    );
  }

  const rows = Array.isArray(data) ? data : [];
  const settings = new Map<string, string>();

  for (const row of rows) {
    const candidate = assertRecord(row, "platform_settings row");
    const key = normalizeOptionalString(candidate.key);
    if (!key) {
      continue;
    }
    settings.set(key, normalizeOptionalString(candidate.value) || "");
  }

  return settings;
}

export async function loadSoloPlusServerFeatureFlags(
  options: Pick<ResolveSoloPlusServerAccessOptions, "serviceClient" | "env"> = {},
): Promise<SoloPlusServerFeatureFlags> {
  assertEnvironment(options.env ?? process.env);

  const serviceClient = options.serviceClient || createSoloPlusServiceRoleClient();
  const settings = await loadPlatformSettings(serviceClient);

  return {
    planMigrationSoloLiteEnabled: readBooleanFlag(
      settings.get("plan_migration_solo_lite_enabled"),
    ),
    soloPlusEnabled: readBooleanFlag(settings.get("solo_plus_enabled")),
    soloPlusKycEnabled: readBooleanFlag(settings.get("solo_plus_kyc_enabled")),
  };
}

export async function resolveSoloPlusAuthenticatedUser(
  options: Pick<ResolveSoloPlusServerAccessOptions, "authClient" | "env"> = {},
): Promise<SoloPlusResolvedAuthenticatedUser> {
  assertEnvironment(options.env ?? process.env);

  const authClient = options.authClient || (await createDefaultAuthClient());
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser();

  if (error || !user?.id) {
    throw new SoloPlusServerAccessError(
      "SOLO_PLUS_SERVER_UNAUTHORIZED",
      "Solo Plus server access requires an authenticated user.",
    );
  }

  return {
    id: user.id,
    email: normalizeOptionalEmail(user.email),
    isSuperAdmin:
      user.app_metadata?.is_super_admin === true ||
      user.user_metadata?.is_super_admin === true,
    hasVerifiedEmail: hasVerifiedEmail(user),
  };
}

export async function resolveSoloPlusMerchantOwnership(
  merchantId: string,
  options: Pick<ResolveSoloPlusServerAccessOptions, "authClient" | "serviceClient" | "env"> = {},
): Promise<SoloPlusResolvedMerchantOwnership> {
  assertEnvironment(options.env ?? process.env);

  if (!hasNonEmptyString(merchantId)) {
    throw new SoloPlusServerAccessError(
      "SOLO_PLUS_SERVER_FORBIDDEN",
      "Solo Plus merchant resolution requires a merchant ID.",
    );
  }

  const [authenticatedUser, authClient] = await Promise.all([
    resolveSoloPlusAuthenticatedUser(options),
    options.authClient ? Promise.resolve(options.authClient) : createDefaultAuthClient(),
  ]);

  const { data, error } = await authClient
    .from("merchants")
    .select("id, user_id, email, is_super_admin")
    .eq("id", merchantId.trim())
    .maybeSingle();

  if (error) {
    throw new SoloPlusServerAccessError(
      "SOLO_PLUS_SERVER_CONFIG_ERROR",
      "Solo Plus merchant ownership lookup failed.",
    );
  }

  if (!data) {
    throw new SoloPlusServerAccessError(
      "SOLO_PLUS_SERVER_NOT_FOUND",
      "Solo Plus merchant was not found.",
    );
  }

  const row = assertRecord(data, "merchant ownership row") as unknown as SoloPlusMerchantOwnershipRow;

  if (!hasNonEmptyString(row.user_id) || row.user_id.trim() !== authenticatedUser.id) {
    throw new SoloPlusServerAccessError(
      "SOLO_PLUS_SERVER_FORBIDDEN",
      "Solo Plus merchant ownership mismatch.",
    );
  }

  return {
    merchantId: row.id,
    ownerUserId: row.user_id.trim(),
    email: normalizeOptionalEmail(row.email),
  };
}

export async function resolveSoloPlusOnboardingSessionOwnership(
  onboardingSessionId: string,
  options: Pick<ResolveSoloPlusServerAccessOptions, "authClient" | "serviceClient" | "env"> = {},
): Promise<SoloPlusResolvedOnboardingSessionOwnership> {
  assertEnvironment(options.env ?? process.env);

  if (!hasNonEmptyString(onboardingSessionId)) {
    throw new SoloPlusServerAccessError(
      "SOLO_PLUS_SERVER_FORBIDDEN",
      "Solo Plus onboarding-session resolution requires a session ID.",
    );
  }

  const authenticatedUser = await resolveSoloPlusAuthenticatedUser(options);
  const authClient = options.authClient || (await createDefaultAuthClient());
  const { data, error } = await authClient
    .from("onboarding_sessions")
    .select("id, email, merchant_id, status, expires_at")
    .eq("id", onboardingSessionId.trim())
    .maybeSingle();

  if (error) {
    throw new SoloPlusServerAccessError(
      "SOLO_PLUS_SERVER_CONFIG_ERROR",
      "Solo Plus onboarding-session lookup failed.",
    );
  }

  if (!data) {
    throw new SoloPlusServerAccessError(
      "SOLO_PLUS_SERVER_NOT_FOUND",
      "Solo Plus onboarding session was not found.",
    );
  }

  const row = assertRecord(data, "onboarding session row") as unknown as SoloPlusOnboardingSessionRow;
  const sessionEmail = normalizeOptionalEmail(row.email);

  if (hasNonEmptyString(row.merchant_id)) {
    await resolveSoloPlusMerchantOwnership(row.merchant_id, options);
    return {
      onboardingSessionId: row.id,
      email: sessionEmail || "",
      merchantId: row.merchant_id,
      ownershipBasis: "merchant_owner",
    };
  }

  if (
    authenticatedUser.hasVerifiedEmail !== true ||
    !sessionEmail ||
    !authenticatedUser.email ||
    sessionEmail !== authenticatedUser.email ||
    !isClaimableOnboardingSession(row)
  ) {
    throw new SoloPlusServerAccessError(
      "SOLO_PLUS_SERVER_FORBIDDEN",
      "Solo Plus onboarding-session ownership mismatch.",
    );
  }

  return {
    onboardingSessionId: row.id,
    email: sessionEmail,
    merchantId: null,
    ownershipBasis: "session_email",
  };
}

function resolveAccessDeniedError(
  requestedMode: SoloPlusServerAccessMode,
  featureFlags: SoloPlusServerFeatureFlags,
): SoloPlusServerAccessError {
  if (requestedMode === "public") {
    return new SoloPlusServerAccessError(
      featureFlags.soloPlusEnabled && featureFlags.soloPlusKycEnabled
        ? "SOLO_PLUS_SERVER_FORBIDDEN"
        : "SOLO_PLUS_SERVER_FORBIDDEN",
      featureFlags.soloPlusEnabled && featureFlags.soloPlusKycEnabled
        ? "Solo Plus public access requires an authenticated owner context."
        : "Solo Plus public access is disabled.",
    );
  }

  return new SoloPlusServerAccessError(
    featureFlags.soloPlusKycEnabled
      ? "SOLO_PLUS_SERVER_FORBIDDEN"
      : "SOLO_PLUS_SERVER_FORBIDDEN",
    featureFlags.soloPlusKycEnabled
      ? "Solo Plus internal testing currently supports only trusted super-admin access; non-admin sandbox-merchant access is deferred and fails closed until an explicit audited sandbox grant mechanism exists."
      : "Solo Plus internal testing is disabled.",
  );
}

export async function resolveSoloPlusServerAccess(
  options: ResolveSoloPlusServerAccessOptions,
): Promise<SoloPlusResolvedServerAccess> {
  assertEnvironment(options.env ?? process.env);

  const serviceClient = options.serviceClient || createSoloPlusServiceRoleClient();
  const authClient = options.authClient || (await createDefaultAuthClient());

  const [featureFlags, authenticatedUser] = await Promise.all([
    loadSoloPlusServerFeatureFlags({ serviceClient, env: options.env }),
    resolveSoloPlusAuthenticatedUser({ authClient, env: options.env }),
  ]);

  const merchantOwnership = options.merchantId
    ? await resolveSoloPlusMerchantOwnership(options.merchantId, {
        authClient,
        serviceClient,
        env: options.env,
      })
    : null;

  const onboardingSessionOwnership = options.onboardingSessionId
    ? await resolveSoloPlusOnboardingSessionOwnership(options.onboardingSessionId, {
        authClient,
        serviceClient,
        env: options.env,
      })
    : null;

  const accessContext: SoloPlusAccessContext =
    options.requestedMode === "public"
      ? {
          mode: "public",
          authenticatedUserId: authenticatedUser.id,
        }
      : {
          mode: "internal_test",
          authenticatedAdminId: authenticatedUser.isSuperAdmin ? authenticatedUser.id : undefined,
          sandboxMerchantId: undefined,
          isAuthorizedAdmin: authenticatedUser.isSuperAdmin,
          isSandboxMerchant: false,
        };

  const allowed =
    options.requestedMode === "public"
      ? canCreatePublicSoloPlusCase(featureFlags, accessContext)
      : canCreateInternalSoloPlusTestCase(featureFlags, accessContext);

  if (!allowed) {
    throw resolveAccessDeniedError(options.requestedMode, featureFlags);
  }

  const actor: SoloPlusResolvedServerActor = {
    authenticatedUserId: authenticatedUser.id,
    authenticatedUserEmail: authenticatedUser.email,
    isSuperAdmin: authenticatedUser.isSuperAdmin,
    merchantOwnership,
    onboardingSessionOwnership,
    sandboxMerchantId: null,
  };

  return {
    accessContext,
    featureFlags,
    authenticatedUser,
    merchantOwnership,
    onboardingSessionOwnership,
    actor,
  };
}

export function assertSoloPlusServerEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): void {
  assertEnvironment(env);
}
