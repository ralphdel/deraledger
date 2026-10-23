import "server-only";

import { cookies } from "next/headers";

import { resolveMerchantContextForUser } from "@/lib/merchant-context";
import { createClient as createServerAuthClient } from "@/lib/supabase/server";

export type MerchantOwnerSession =
  | { ok: true; userId: string; merchantId: string }
  | { ok: false; status: 401; error: "Unauthorized" }
  | { ok: false; status: 403; error: "Owner access required" };

type AuthClient = {
  from(table: string): unknown;
  auth: {
    getUser(): Promise<{
      data: { user: { id?: string | null; email?: string | null; app_metadata?: Record<string, unknown> | null } | null };
      error: unknown | null;
    }>;
  };
};

export async function requireMerchantOwnerSession(
  options: {
    authClient?: AuthClient;
    preferredMerchantId?: string | null;
    resolveContext?: typeof resolveMerchantContextForUser;
  } = {},
): Promise<MerchantOwnerSession> {
  const client = options.authClient ?? await createServerAuthClient();
  const { data: { user }, error } = await client.auth.getUser();
  const userId = typeof user?.id === "string" ? user.id.trim() : "";
  if (error || userId === "") return { ok: false, status: 401, error: "Unauthorized" };

  const preferredMerchantId = options.preferredMerchantId === undefined
    ? (await cookies()).get("purpledger_workspace_id")?.value ?? null
    : options.preferredMerchantId;
  const context = await (options.resolveContext ?? resolveMerchantContextForUser)(client, user, {
    preferredMerchantId,
  });
  if (context.status !== "resolved" || context.relationship !== "owner") {
    return { ok: false, status: 403, error: "Owner access required" };
  }
  return { ok: true, userId, merchantId: context.merchantId };
}
