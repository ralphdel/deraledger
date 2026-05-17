import { createClient } from "./supabase/server";

export async function requirePermission(merchantId: string, requiredPermission: string): Promise<{ permitted: boolean, error?: string }> {
  try {
    const sb = await createClient();
    const { data: { session } } = await sb.auth.getSession();
    const user = session?.user;

    if (!user) {
      return { permitted: false, error: "Unauthorized: No active session" };
    }

    // Check if owner
    const { data: merchant } = await sb
      .from("merchants")
      .select("user_id, verification_status")
      .eq("id", merchantId)
      .single();

    const { data: subscription } = await sb
      .from("subscriptions")
      .select("status, expiry_date")
      .eq("merchant_id", merchantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const expiryDate = subscription?.expiry_date ? new Date(subscription.expiry_date) : null;
    const isHardExpired = subscription?.status === "cancelled" ||
      (subscription?.status === "expired" && expiryDate && (Date.now() - expiryDate.getTime()) / (1000 * 60 * 60) > 24);

    if (merchant?.user_id === user.id) {
      if (merchant.verification_status === "suspended") {
        return { permitted: false, error: "Forbidden: this workspace is suspended" };
      }
      if (isHardExpired && requiredPermission !== "manage_billing") {
        return { permitted: false, error: "Forbidden: this workspace subscription is inactive" };
      }
      return { permitted: true }; // Owner has all permissions while workspace is active.
    }

    if (requiredPermission === "manage_billing") {
      return { permitted: false, error: "Forbidden: billing can only be managed by the workspace owner" };
    }

    if (merchant?.verification_status === "suspended") {
      return { permitted: false, error: "Forbidden: this workspace is suspended" };
    }

    if (isHardExpired) {
      return { permitted: false, error: "Forbidden: this workspace subscription is inactive" };
    }

    // Check role in merchant_team
    const { data: teamData } = await sb
      .from("merchant_team")
      .select("roles(permissions)")
      .eq("merchant_id", merchantId)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();

    if (!teamData || !teamData.roles) {
      return { permitted: false, error: "Unauthorized: You are not a member of this team" };
    }

    const role = Array.isArray(teamData.roles) ? teamData.roles[0] : teamData.roles;
    const permissions = role?.permissions as Record<string, boolean> | undefined;

    if (!permissions || permissions[requiredPermission] !== true) {
      return { permitted: false, error: `Forbidden: You do not have the '${requiredPermission}' permission` };
    }

    return { permitted: true };
  } catch (err: unknown) {
    return { permitted: false, error: err instanceof Error ? err.message : "An error occurred checking permissions" };
  }
}
