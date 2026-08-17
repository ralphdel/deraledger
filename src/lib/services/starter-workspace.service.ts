import type { SupabaseClient, User } from "@supabase/supabase-js";

type QueryError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
} | null;

type AuthAdminError = Exclude<QueryError, null> & { status?: number } | null;

export type StarterProvisioningStage =
  | "auth_create"
  | "auth_resolve"
  | "metadata_validation"
  | "merchant_lookup"
  | "merchant_insert"
  | "merchant_identity_validation"
  | "membership_role_lookup"
  | "membership_upsert"
  | "workspace_lookup"
  | "workspace_insert"
  | "workspace_update"
  | "merchant_workspace_link";

export type SafeSupabaseError = {
  code: string | null;
  message: string | null;
  details: string | null;
  hint: string | null;
};

export type StarterProvisioningWarning = {
  code: string;
  stage: StarterProvisioningStage;
  message: string;
  supabase: SafeSupabaseError | null;
};

export type StarterMerchantRecord = {
  id: string;
  user_id: string | null;
};

export type StarterWorkspaceInput = {
  userId: string;
  email: string;
  businessName: string;
};

export type StarterWorkspaceResult = {
  merchantId: string;
  workspaceId: string;
  merchantCreated: boolean;
  warnings: StarterProvisioningWarning[];
};

export type StarterActivationProperties = {
  email_otp?: string | null;
};

export type StarterAuthUser = Pick<User, "id" | "email" | "user_metadata">;

export interface StarterAuthAdmin {
  createUser(input: {
    email: string;
    email_confirm: boolean;
    user_metadata: { business_name: string; plan: "starter" };
  }): Promise<{ data: { user: StarterAuthUser | null }; error: AuthAdminError }>;
  generateLink(input: {
    type: "magiclink";
    email: string;
  }): Promise<{
    data: { user?: StarterAuthUser | null; properties?: StarterActivationProperties | null } | null;
    error: QueryError;
  }>;
}

export interface StarterWorkspaceRepository {
  findMerchantByUserId(userId: string): Promise<StarterMerchantRecord | null>;
  findMerchantById(merchantId: string): Promise<StarterMerchantRecord | null>;
  insertMerchant(values: Record<string, unknown>): Promise<{
    merchant: StarterMerchantRecord | null;
    error: QueryError;
  }>;
  findCreatorRoleId(): Promise<string | null>;
  upsertCreatorMembership(values: {
    merchant_id: string;
    user_id: string;
    role_id: string;
    is_active: true;
  }): Promise<void>;
  ensureWorkspace(input: StarterWorkspaceInput & { merchantId: string }): Promise<string>;
}

export class StarterProvisioningError extends Error {
  public readonly supabase: SafeSupabaseError | null;

  constructor(
    public readonly code:
      | "AUTH_USER_RESOLUTION_FAILED"
      | "NOT_STARTER_USER"
      | "STARTER_METADATA_MISSING"
      | "MERCHANT_PROVISION_FAILED"
      | "WORKSPACE_PROVISION_FAILED",
    public readonly stage: StarterProvisioningStage,
    message: string,
    error?: QueryError,
  ) {
    super(message);
    this.name = "StarterProvisioningError";
    this.supabase = toSafeSupabaseError(error);
  }
}

export function getStarterProvisioningLogPayload(error: unknown) {
  if (error instanceof StarterProvisioningError) {
    return {
      code: error.code,
      stage: error.stage,
      message: error.message,
      supabase: error.supabase,
    };
  }

  return {
    code: "UNEXPECTED_STARTER_PROVISIONING_ERROR",
    stage: "unknown",
    message: "Unexpected Starter provisioning error.",
    supabase: null,
  };
}

export function getStarterProfile(user: StarterAuthUser | null | undefined) {
  const plan = normalizeText(user?.user_metadata?.plan)?.toLowerCase();
  const businessName = normalizeText(user?.user_metadata?.business_name);
  const email = normalizeEmail(user?.email);

  if (plan !== "starter") {
    throw new StarterProvisioningError(
      "NOT_STARTER_USER",
      "metadata_validation",
      "This account is not eligible for Starter workspace repair.",
    );
  }
  if (!user?.id || !businessName || !email) {
    throw new StarterProvisioningError(
      "STARTER_METADATA_MISSING",
      "metadata_validation",
      "Starter account metadata is incomplete.",
    );
  }

  return { userId: user.id, email, businessName };
}

export async function provisionStarterSignup(
  dependencies: { authAdmin: StarterAuthAdmin; repository: StarterWorkspaceRepository },
  input: { email: string; registeredName: string; tradingName: string; ownerName?: string | null },
) {
  const email = normalizeEmail(input.email);
  const registeredName = normalizeText(input.registeredName);
  const tradingName = normalizeText(input.tradingName);

  if (!email || !registeredName || !tradingName) {
    throw new StarterProvisioningError(
      "STARTER_METADATA_MISSING",
      "metadata_validation",
      "Missing required Starter account fields.",
    );
  }

  const { data: created, error: createError } = await dependencies.authAdmin.createUser({
    email,
    email_confirm: true,
    user_metadata: { business_name: registeredName, plan: "starter" },
  });

  let user = created.user;
  let activationProperties: StarterActivationProperties | null = null;
  const authUserCreated = Boolean(user?.id);

  if (!user) {
    if (!isAlreadyRegisteredError(createError)) {
      throw new StarterProvisioningError(
        "AUTH_USER_RESOLUTION_FAILED",
        "auth_create",
        "Failed to provision Starter auth user.",
        createError,
      );
    }

    const resolved = await dependencies.authAdmin.generateLink({ type: "magiclink", email });
    if (resolved.error || !resolved.data?.user) {
      throw new StarterProvisioningError(
        "AUTH_USER_RESOLUTION_FAILED",
        "auth_resolve",
        "Failed to resolve existing Starter auth user.",
        resolved.error,
      );
    }
    user = resolved.data.user;
    activationProperties = resolved.data.properties || null;
  }

  const profile = getStarterProfile(user);
  if (profile.email !== email) {
    throw new StarterProvisioningError(
      "AUTH_USER_RESOLUTION_FAILED",
      "auth_resolve",
      "Resolved Starter auth user does not match the requested email.",
    );
  }

  const workspace = await ensureStarterWorkspace(dependencies.repository, profile);

  if (!activationProperties) {
    const generated = await dependencies.authAdmin.generateLink({ type: "magiclink", email });
    activationProperties = generated.error ? null : generated.data?.properties || null;
  }

  return {
    ...workspace,
    authUserCreated,
    activationProperties,
  };
}

export async function repairAuthenticatedStarterWorkspace(
  repository: StarterWorkspaceRepository,
  user: StarterAuthUser,
) {
  return ensureStarterWorkspace(repository, getStarterProfile(user));
}

export async function ensureStarterWorkspace(
  repository: StarterWorkspaceRepository,
  input: StarterWorkspaceInput,
): Promise<StarterWorkspaceResult> {
  const existing = await repository.findMerchantByUserId(input.userId);
  let merchant = existing;
  let merchantCreated = false;

  if (!merchant) {
    const inserted = await repository.insertMerchant({
      // The Auth UUID makes concurrent repairs converge on one merchant primary key
      // even though production does not enforce uniqueness on merchants.user_id.
      id: input.userId,
      user_id: input.userId,
      business_name: input.businessName,
      email: input.email,
      merchant_tier: "starter",
      subscription_plan: "starter",
      verification_status: "unverified",
      monthly_collection_limit: 0,
      holds_pending_review: false,
      onboarding_status: "active",
      setup_mode: false,
      workspace_type: "business",
      live_features_enabled: false,
      business_affiliation_status: "not_started",
    });

    merchant = inserted.merchant;
    merchantCreated = Boolean(merchant);

    if (!merchant) {
      // A concurrent request may have inserted the deterministic merchant first.
      merchant = await repository.findMerchantByUserId(input.userId)
        || await repository.findMerchantById(input.userId);
    }

    if (!merchant) {
      throw new StarterProvisioningError(
        "MERCHANT_PROVISION_FAILED",
        "merchant_insert",
        "Failed to create Starter merchant.",
        inserted.error,
      );
    }
  }

  if (merchant.user_id !== input.userId) {
    throw new StarterProvisioningError(
      "MERCHANT_PROVISION_FAILED",
      "merchant_identity_validation",
      "Starter merchant identity did not match the authenticated user.",
    );
  }

  const warnings: StarterProvisioningWarning[] = [];
  try {
    const creatorRoleId = await repository.findCreatorRoleId();
    if (creatorRoleId) {
      await repository.upsertCreatorMembership({
        merchant_id: merchant.id,
        user_id: input.userId,
        role_id: creatorRoleId,
        is_active: true,
      });
    } else {
      warnings.push({
        code: "MEMBERSHIP_ROLE_UNAVAILABLE",
        stage: "membership_role_lookup",
        message: "Starter merchant was created without a team membership because no creator role was available.",
        supabase: null,
      });
    }
  } catch (error) {
    warnings.push(toProvisioningWarning(error));
  }

  const workspaceId = await repository.ensureWorkspace({
    ...input,
    merchantId: merchant.id,
  });

  return { merchantId: merchant.id, workspaceId, merchantCreated, warnings };
}

export function createSupabaseStarterWorkspaceRepository(
  adminClient: SupabaseClient,
): StarterWorkspaceRepository {
  return {
    async findMerchantByUserId(userId) {
      const { data, error } = await adminClient
        .from("merchants")
        .select("id,user_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        throw new StarterProvisioningError(
          "MERCHANT_PROVISION_FAILED",
          "merchant_lookup",
          "Failed to read Starter merchant.",
          error,
        );
      }
      return data as StarterMerchantRecord | null;
    },
    async findMerchantById(merchantId) {
      const { data, error } = await adminClient
        .from("merchants")
        .select("id,user_id")
        .eq("id", merchantId)
        .maybeSingle();
      if (error) {
        throw new StarterProvisioningError(
          "MERCHANT_PROVISION_FAILED",
          "merchant_lookup",
          "Failed to resolve concurrent Starter merchant.",
          error,
        );
      }
      return data as StarterMerchantRecord | null;
    },
    async insertMerchant(values) {
      const { data, error } = await adminClient
        .from("merchants")
        .insert(values)
        .select("id,user_id")
        .single();
      return {
        merchant: data as StarterMerchantRecord | null,
        error: error ? pickSupabaseError(error) : null,
      };
    },
    async findCreatorRoleId() {
      const { data, error } = await adminClient
        .from("roles")
        .select("id")
        .eq("name", "admin")
        .maybeSingle();
      if (error) {
        throw new StarterProvisioningError(
          "MERCHANT_PROVISION_FAILED",
          "membership_role_lookup",
          "Failed to resolve the Starter creator role.",
          error,
        );
      }
      return typeof data?.id === "string" ? data.id : null;
    },
    async upsertCreatorMembership(values) {
      const { error } = await adminClient
        .from("merchant_team")
        .upsert(values, { onConflict: "merchant_id,user_id" });
      if (error) {
        throw new StarterProvisioningError(
          "MERCHANT_PROVISION_FAILED",
          "membership_upsert",
          "Failed to ensure Starter creator membership.",
          error,
        );
      }
    },
    async ensureWorkspace(input) {
      const existingResult = await adminClient
        .from("workspaces")
        .select("id,merchant_id")
        .eq("merchant_id", input.merchantId)
        .maybeSingle();
      if (existingResult.error) {
        throw new StarterProvisioningError(
          "WORKSPACE_PROVISION_FAILED",
          "workspace_lookup",
          "Failed to read Starter workspace.",
          existingResult.error,
        );
      }

      let workspace = existingResult.data as { id: string; merchant_id: string | null } | null;
      let workspaceInsertError: QueryError = null;

      if (!workspace) {
        const inserted = await adminClient
          .from("workspaces")
          .insert({
            // Deterministic fallback prevents duplicate workspaces during concurrent repair.
            id: input.merchantId,
            owner_user_id: input.userId,
            merchant_id: input.merchantId,
            workspace_type: "business",
            display_name: input.businessName,
            plan_type: "starter",
            onboarding_status: "active",
            setup_mode: false,
            live_features_enabled: false,
          })
          .select("id,merchant_id")
          .single();
        workspace = inserted.data as { id: string; merchant_id: string | null } | null;
        workspaceInsertError = inserted.error ? pickSupabaseError(inserted.error) : null;

        if (!workspace) {
          const concurrentByMerchant = await adminClient
            .from("workspaces")
            .select("id,merchant_id")
            .eq("merchant_id", input.merchantId)
            .maybeSingle();
          if (concurrentByMerchant.error) {
            throw new StarterProvisioningError(
              "WORKSPACE_PROVISION_FAILED",
              "workspace_lookup",
              "Failed to resolve concurrent Starter workspace.",
              concurrentByMerchant.error,
            );
          }
          workspace = concurrentByMerchant.data as { id: string; merchant_id: string | null } | null;
        }

        if (!workspace) {
          const concurrentById = await adminClient
            .from("workspaces")
            .select("id,merchant_id")
            .eq("id", input.merchantId)
            .maybeSingle();
          if (concurrentById.error) {
            throw new StarterProvisioningError(
              "WORKSPACE_PROVISION_FAILED",
              "workspace_lookup",
              "Failed to resolve deterministic Starter workspace.",
              concurrentById.error,
            );
          }
          const candidate = concurrentById.data as { id: string; merchant_id: string | null } | null;
          workspace = candidate?.merchant_id === input.merchantId ? candidate : null;
        }

        if (!workspace) {
          throw new StarterProvisioningError(
            "WORKSPACE_PROVISION_FAILED",
            "workspace_insert",
            "Failed to create Starter workspace.",
            workspaceInsertError,
          );
        }
      }

      const workspaceUpdate = await adminClient
        .from("workspaces")
        .update({
          owner_user_id: input.userId,
          merchant_id: input.merchantId,
          workspace_type: "business",
          display_name: input.businessName,
          plan_type: "starter",
          onboarding_status: "active",
          setup_mode: false,
          live_features_enabled: false,
        })
        .eq("id", workspace.id);
      if (workspaceUpdate.error) {
        throw new StarterProvisioningError(
          "WORKSPACE_PROVISION_FAILED",
          "workspace_update",
          "Failed to update Starter workspace.",
          workspaceUpdate.error,
        );
      }

      const merchantLink = await adminClient
        .from("merchants")
        .update({ workspace_id: workspace.id })
        .eq("id", input.merchantId);
      if (merchantLink.error) {
        throw new StarterProvisioningError(
          "WORKSPACE_PROVISION_FAILED",
          "merchant_workspace_link",
          "Failed to link Starter merchant to its workspace.",
          merchantLink.error,
        );
      }

      return workspace.id;
    },
  };
}

function isAlreadyRegisteredError(error: AuthAdminError | undefined) {
  const message = error?.message?.toLowerCase() || "";
  return error?.status === 422 || message.includes("already") || message.includes("registered");
}

function toProvisioningWarning(error: unknown): StarterProvisioningWarning {
  if (error instanceof StarterProvisioningError) {
    return {
      code: "MEMBERSHIP_PROVISION_WARNING",
      stage: error.stage,
      message: error.message,
      supabase: error.supabase,
    };
  }
  return {
    code: "MEMBERSHIP_PROVISION_WARNING",
    stage: "membership_upsert",
    message: "Starter merchant was created but its team membership could not be ensured.",
    supabase: null,
  };
}

function toSafeSupabaseError(error: QueryError | undefined): SafeSupabaseError | null {
  if (!error) return null;
  return {
    code: normalizeText(error.code),
    message: normalizeText(error.message),
    details: normalizeText(error.details),
    hint: normalizeText(error.hint),
  };
}

function pickSupabaseError(error: Exclude<QueryError, null>) {
  return {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  };
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
