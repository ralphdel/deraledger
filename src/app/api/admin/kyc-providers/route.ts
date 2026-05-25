import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

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
  const { data: providers, error } = await sb
    .from("verification_providers")
    .select("*")
    .order("priority", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ providers });
}

export async function PATCH(request: Request) {
  if (!requireAdminCookie(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const {
    id,
    status,
    priority,
    bvn_selfie_cost,
    business_cost,
    director_cost,
  } = body as {
    id: string;
    status?: "ACTIVE" | "DEGRADED" | "DOWN" | "DISABLED";
    priority?: number;
    bvn_selfie_cost?: number;
    business_cost?: number;
    director_cost?: number;
  };

  if (!id) {
    return NextResponse.json({ error: "Missing provider row ID." }, { status: 400 });
  }

  const updates: Record<string, any> = {
    updated_at: new Date().toISOString(),
  };

  if (status !== undefined) {
    if (!["ACTIVE", "DEGRADED", "DOWN", "DISABLED"].includes(status)) {
      return NextResponse.json({ error: "Invalid status value." }, { status: 400 });
    }
    updates.status = status;
  }

  if (priority !== undefined) {
    updates.priority = Number(priority);
  }

  if (bvn_selfie_cost !== undefined) {
    updates.bvn_selfie_cost = Number(bvn_selfie_cost);
  }

  if (business_cost !== undefined) {
    updates.business_cost = Number(business_cost);
  }

  if (director_cost !== undefined) {
    updates.director_cost = Number(director_cost);
  }

  const sb = getServiceClient();
  const { error } = await sb
    .from("verification_providers")
    .update(updates)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
