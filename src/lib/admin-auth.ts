import { resolveDbBackedSuperAdminSession } from "@/lib/admin-rbac";

export async function requireSuperAdminSession(): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  return resolveDbBackedSuperAdminSession();
}
