import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "./supabase/server";

export async function requirePermission(merchantId: string, requiredPermission: string) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;

  if (!user) {
    throw new Error("Unauthorized: No active session");
  }

  // Check if owner
  const { data: merchant } = await sb
    .from("merchants")
    .select("user_id")
    .eq("id", merchantId)
    .single();

  if (merchant?.user_id === user.id) {
    return true; // Owner has all permissions
  }

  // Check role in merchant_team
  const { data: teamData } = await sb
    .from("merchant_team")
    .select("roles(permissions)")
    .eq("merchant_id", merchantId)
    .eq("user_id", user.id)
    .single();

  if (!teamData || !teamData.roles) {
    throw new Error("Unauthorized: You are not a member of this team");
  }

  // @ts-ignore
  const permissions = teamData.roles.permissions as Record<string, boolean>;

  if (!permissions || permissions[requiredPermission] !== true) {
    throw new Error(`Forbidden: You do not have the '${requiredPermission}' permission`);
  }

  return true;
}
