import type { SupabaseClient, User } from "@supabase/supabase-js";

import { ensureWorkspaceForMerchant } from "@/lib/services/onboarding-flow.service";

type QueryError = { code?: string; message?: string } | null;
type AuthAdminError = { code?: string; message?: string; status?: number } | null;

export type StarterMerchantRecord = {
  id: string;
  user_id: string | null;
};

export type StarterWorkspaceInput = {
  userId: string;
  email: string;
  businessName: string;
  tradingName?: string | null;
  ownerName?: string | null;
};

export type StarterWorkspaceResult = {
  merchantId: string;
  merchantCreated: boolean;
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
  updateMerchant(merchantId: string, values: Record<string, unknown>): Promise<void>;
  findOwnerRoleId(): Promise<string | null>;
  upsertOwnerMembership(values: {
    merchant_id: string;
    user_id: string;
    role_id: string;
    is_active: true;
  }): Promise<void>;
  ensureWorkspace(merchantId: string): Promise<string | null>;
}

export class StarterProvisioningError extends Error {
  constructor(
    public readonly code:
      | "AUTH_USER_RESOLUTION_FAILED"
      | "NOT_STARTER_USER"
      | "STARTER_METADATA_MISSING"
      | "MERCHANT_PROVISION_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "StarterProvisioningError";
  }
}

export function getStarterProfile(user: StarterAuthUser | null | undefined) {
  const plan = normalizeText(user?.user_metadata?.plan)?.toLowerCase();
  const businessName = normalizeText(user?.user_metadata?.business_name);
  const email = normalizeEmail(user?.email);

  if (plan !== "starter") {
    throw new StarterProvisioningError(
      "NOT_STARTER_USER",
      "This account is not eligible for Starter workspace repair.",
    );
  }
  if (!user?.id || !businessName || !email) {
    throw new StarterProvisioningError(
      "STARTER_METADATA_MISSING",
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
        "Failed to provision Starter auth user.",
      );
    }

    const resolved = await dependencies.authAdmin.generateLink({ type: "magiclink", email });
    if (resolved.error || !resolved.data?.user) {
      throw new StarterProvisioningError(
        "AUTH_USER_RESOLUTION_FAILED",
        "Failed to resolve existing Starter auth user.",
      );
    }
    user = resolved.data.user;
    activationProperties = resolved.data.properties || null;
  }

  const profile = getStarterProfile(user);
  if (profile.email !== email) {
    throw new StarterProvisioningError(
      "AUTH_USER_RESOLUTION_FAILED",
      "Resolved Starter auth user does not match the requested email.",
    );
  }

  const workspace = await ensureStarterWorkspace(dependencies.repository, {
    ...profile,
    businessName: profile.businessName,
    tradingName,
    ownerName: normalizeText(input.ownerName),
  });

  if (!activationProperties) {
    const generated = await dependencies.authAdmin.generateLink({ type: "magiclink", email });
    if (generated.error) {
      activationProperties = null;
    } else {
      activationProperties = generated.data?.properties || null;
    }
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
      // Using the Auth UUID as the fallback merchant UUID makes concurrent repairs
      // converge on one primary key even without a unique merchants.user_id index.
      id: input.userId,
      user_id: input.userId,
      business_name: input.businessName,
      trading_name: input.tradingName || input.businessName,
      owner_name: input.ownerName || null,
      email: input.email,
      subscription_plan: "starter",
      merchant_tier: "starter",
      verification_status: "unverified",
      fee_absorption_default: "business",
      monthly_collection_limit: 0,
      platform_version: 1,
      onboarding_status: "active",
      setup_mode: false,
      live_features_enabled: false,
    });

    merchant = inserted.merchant;
    merchantCreated = Boolean(merchant);

    if (!merchant && inserted.error) {
      // A concurrent request may have inserted the deterministic merchant first.
      merchant = await repository.findMerchantByUserId(input.userId)
        || await repository.findMerchantById(input.userId);
    }
  }

  if (!merchant || merchant.user_id !== input.userId) {
    throw new StarterProvisioningError(
      "MERCHANT_PROVISION_FAILED",
      "Failed to ensure Starter workspace.",
    );
  }

  await repository.updateMerchant(merchant.id, compactRecord({
    trading_name: input.tradingName,
    owner_name: input.ownerName,
    platform_version: 1,
  }));

  const ownerRoleId = await repository.findOwnerRoleId();
  if (ownerRoleId) {
    await repository.upsertOwnerMembership({
      merchant_id: merchant.id,
      user_id: input.userId,
      role_id: ownerRoleId,
      is_active: true,
    });
  }

  await repository.ensureWorkspace(merchant.id);

  return { merchantId: merchant.id, merchantCreated };
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
      if (error) throw new Error("Failed to read Starter merchant.");
      return data as StarterMerchantRecord | null;
    },
    async findMerchantById(merchantId) {
      const { data, error } = await adminClient
        .from("merchants")
        .select("id,user_id")
        .eq("id", merchantId)
        .maybeSingle();
      if (error) throw new Error("Failed to resolve concurrent Starter merchant.");
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
        error: error ? { code: error.code, message: error.message } : null,
      };
    },
    async updateMerchant(merchantId, values) {
      if (Object.keys(values).length === 0) return;
      const { error } = await adminClient.from("merchants").update(values).eq("id", merchantId);
      if (error) throw new Error("Failed to update Starter merchant profile.");
    },
    async findOwnerRoleId() {
      const { data, error } = await adminClient
        .from("roles")
        .select("id")
        .eq("name", "owner")
        .maybeSingle();
      if (error) throw new Error("Failed to resolve Starter owner role.");
      return typeof data?.id === "string" ? data.id : null;
    },
    async upsertOwnerMembership(values) {
      const { error } = await adminClient
        .from("merchant_team")
        .upsert(values, { onConflict: "merchant_id,user_id" });
      if (error) throw new Error("Failed to ensure Starter owner membership.");
    },
    async ensureWorkspace(merchantId) {
      return ensureWorkspaceForMerchant(adminClient, merchantId);
    },
  };
}

function isAlreadyRegisteredError(error: AuthAdminError | undefined) {
  const message = error?.message?.toLowerCase() || "";
  return error?.status === 422 || message.includes("already") || message.includes("registered");
}

function compactRecord(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
