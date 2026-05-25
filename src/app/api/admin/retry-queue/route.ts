import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getQueueStats, getQueueItems, triggerManualRetry } from "@/lib/services/retry.service";

function requireAdminCookie(request: Request): boolean {
  const cookieHeader = request.headers.get("cookie") || "";
  return cookieHeader.includes("admin_session=authenticated");
}

export async function GET(request: Request) {
  if (!requireAdminCookie(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const stats = await getQueueStats();
    const items = await getQueueItems(30);

    return NextResponse.json({ stats, items });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!requireAdminCookie(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { action, id } = body as { action?: string; id?: string };

  if (action !== "retry_now" || !id) {
    return NextResponse.json({ error: "Action must be 'retry_now' and ID provided." }, { status: 400 });
  }

  try {
    const result = await triggerManualRetry(id);
    if (!result.success) {
      return NextResponse.json({ error: result.error || "Manual retry failed." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
