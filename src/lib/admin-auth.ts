import { createClient } from "@/lib/supabase/server";

export async function requireSuperAdminSession(): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const isSuperAdmin =
    user.user_metadata?.is_super_admin === true ||
    user.app_metadata?.is_super_admin === true;

  if (!isSuperAdmin) {
    return { ok: false, status: 403, error: "SuperAdmin access required" };
  }

  return { ok: true, userId: user.id };
}
