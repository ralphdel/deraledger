import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { createClient as createServerAuthClient } from "@/lib/supabase/server";

type AdminAuthorityUser = {
  id?: string | null;
};

export type AdminAuthorityAuthClient = {
  auth: {
    getUser(): Promise<{
      data: { user: AdminAuthorityUser | null };
      error: { message?: string } | null;
    }>;
  };
};

type AdminAuthorityQuery = {
  select(columns: string): AdminAuthorityQuery;
  eq(column: string, value: unknown): AdminAuthorityQuery;
  limit(count: number): AdminAuthorityQuery;
  maybeSingle(): Promise<{
    data: unknown;
    error: { message?: string } | null;
  }>;
};

export type AdminAuthorityDatabaseClient = {
  from(table: string): AdminAuthorityQuery;
};

export type DbBackedSuperAdminSession =
  | { ok: true; userId: string }
  | {
      ok: false;
      status: 401 | 403 | 503;
      error: "Unauthorized" | "SuperAdmin access required" | "Admin authority unavailable";
    };

export type ResolveDbBackedSuperAdminSessionOptions = {
  authClient?: AdminAuthorityAuthClient;
  authorityClient?: AdminAuthorityDatabaseClient;
  env?: NodeJS.ProcessEnv;
};

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isAuthorityRow(value: unknown): value is { id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    hasNonEmptyString((value as Record<string, unknown>).id)
  );
}

async function createDefaultAuthorityClient(
  env: NodeJS.ProcessEnv,
): Promise<AdminAuthorityDatabaseClient | null> {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!hasNonEmptyString(url) || !hasNonEmptyString(serviceRoleKey)) {
    return null;
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }) as unknown as AdminAuthorityDatabaseClient;
}

/**
 * Resolves Phase 2B operational authority from public.merchants.is_super_admin.
 * Auth metadata is deliberately not an authority input.
 */
export async function resolveDbBackedSuperAdminSession(
  options: ResolveDbBackedSuperAdminSessionOptions = {},
): Promise<DbBackedSuperAdminSession> {
  const env = options.env ?? process.env;
  const authClient = options.authClient ?? ((await createServerAuthClient()) as AdminAuthorityAuthClient);
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();

  if (authError || !hasNonEmptyString(user?.id)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const authorityClient =
    options.authorityClient ?? (await createDefaultAuthorityClient(env));
  if (!authorityClient) {
    return { ok: false, status: 503, error: "Admin authority unavailable" };
  }

  const { data, error } = await authorityClient
    .from("merchants")
    .select("id")
    .eq("user_id", user.id.trim())
    .eq("is_super_admin", true)
    .limit(1)
    .maybeSingle();

  if (error) {
    return { ok: false, status: 503, error: "Admin authority unavailable" };
  }

  if (!isAuthorityRow(data)) {
    return { ok: false, status: 403, error: "SuperAdmin access required" };
  }

  return { ok: true, userId: user.id.trim() };
}
