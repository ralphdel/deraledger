import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireAdminPortalSession } from "@/lib/admin-portal-auth";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const guard = await requireAdminPortalSession();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const { batchId } = await params;
  const body = (await request.json().catch(() => null)) as { action?: string; failureReason?: string | null } | null;

  if (!body?.action) {
    return NextResponse.json({ error: "Action is required" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("update_settlement_batch_status", {
    p_batch_id: batchId,
    p_action: body.action,
    p_failure_reason: body.failureReason || null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, result: data });
}
