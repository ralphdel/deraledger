import { cookies } from "next/headers";

export async function requireAdminPortalSession() {
  const cookieStore = await cookies();
  const adminSession = cookieStore.get("admin_session")?.value;

  if (adminSession !== "authenticated") {
    return { ok: false as const, status: 401, error: "Admin session required" };
  }

  return { ok: true as const };
}
