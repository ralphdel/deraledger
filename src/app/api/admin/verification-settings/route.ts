import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Admin API — Verification Settings
 *
 * GET  /api/admin/verification-settings
 *   Returns: { provider, sandboxMode, health }
 *
 * POST /api/admin/verification-settings
 *   Body: { provider?: "DOJAH" | "YOUVERIFY", sandboxMode?: boolean }
 *   Returns: { success: true }
 *
 * Protected: Requires admin_session cookie. No merchant RLS bypass needed
 * since platform_settings is service-role only.
 */

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function requireAdminCookie(request: Request): boolean {
  const cookieHeader = request.headers.get("cookie") || "";
  return cookieHeader.includes("admin_session=authenticated");
}

export async function GET(request: Request) {
  if (!requireAdminCookie(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient();
  const { data: settings } = await sb
    .from("platform_settings")
    .select("key, value")
    .in("key", [
      "active_verification_provider",
      "verification_sandbox_mode",
      "verification_provider_health",
    ]);

  const map: Record<string, string> = {};
  for (const row of settings || []) {
    map[row.key] = row.value;
  }

  let health: Record<string, string> = {
    DOJAH: "UNCHECKED",
    YOUVERIFY: "UNCHECKED",
  };
  try {
    health = JSON.parse(map["verification_provider_health"] || "{}");
  } catch {
    // default
  }

  return NextResponse.json({
    provider: map["active_verification_provider"] || "DOJAH",
    sandboxMode: map["verification_sandbox_mode"] !== "false",
    health,
  });
}

export async function POST(request: Request) {
  if (!requireAdminCookie(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { provider, sandboxMode } = body as {
    provider?: string;
    sandboxMode?: boolean;
  };

  const sb = getServiceClient();
  const now = new Date().toISOString();
  const upserts: { key: string; value: string; updated_by: string | null; updated_at: string }[] = [];

  if (provider !== undefined) {
    const normalized = (provider || "").toUpperCase();
    if (normalized !== "DOJAH" && normalized !== "YOUVERIFY") {
      return NextResponse.json(
        { error: "Invalid provider. Must be DOJAH or YOUVERIFY." },
        { status: 400 }
      );
    }
    upserts.push({ key: "active_verification_provider", value: normalized, updated_by: null, updated_at: now });
  }

  if (sandboxMode !== undefined) {
    upserts.push({
      key: "verification_sandbox_mode",
      value: sandboxMode ? "true" : "false",
      updated_by: null,
      updated_at: now,
    });
  }

  if (upserts.length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { error } = await sb.from("platform_settings").upsert(upserts);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
