import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const SETTING_KEYS = [
  "current_platform_version",
  "force_logout_on_update",
  "platform_update_title",
  "platform_update_summary",
  "platform_update_required_action",
  "superadmin_sandbox_email",
] as const;

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
  const { data, error } = await sb
    .from("platform_settings")
    .select("key, value")
    .in("key", SETTING_KEYS as unknown as string[]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const settings = Object.fromEntries((data || []).map((row) => [row.key, row.value || ""]));

  return NextResponse.json({
    currentVersion: Number(settings.current_platform_version || 1),
    forceLogoutOnUpdate: settings.force_logout_on_update !== "false",
    title: settings.platform_update_title || "Platform Update",
    summary: settings.platform_update_summary || "",
    requiredAction: settings.platform_update_required_action || "",
    superadminSandboxEmail: settings.superadmin_sandbox_email || "ralphdel14@yahoo.com",
  });
}

export async function POST(request: Request) {
  if (!requireAdminCookie(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const currentVersion = Number(body.currentVersion);
  if (!Number.isInteger(currentVersion) || currentVersion < 1) {
    return NextResponse.json({ error: "Platform version must be a positive integer." }, { status: 400 });
  }

  const payload = [
    { key: "current_platform_version", value: String(currentVersion) },
    { key: "force_logout_on_update", value: body.forceLogoutOnUpdate === false ? "false" : "true" },
    { key: "platform_update_title", value: String(body.title || "Platform Update").trim() },
    { key: "platform_update_summary", value: String(body.summary || "").trim() },
    { key: "platform_update_required_action", value: String(body.requiredAction || "").trim() },
    { key: "superadmin_sandbox_email", value: String(body.superadminSandboxEmail || "ralphdel14@yahoo.com").trim().toLowerCase() },
  ].map((row) => ({ ...row, updated_at: new Date().toISOString() }));

  const sb = getServiceClient();
  const { error } = await sb.from("platform_settings").upsert(payload, { onConflict: "key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
