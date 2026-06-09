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

  const { searchParams } = new URL(request.url);
  const merchantId = searchParams.get("merchantId");
  const provider = searchParams.get("provider");
  const status = searchParams.get("status");
  const verificationType = searchParams.get("verificationType");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const limit = Math.max(1, Number(searchParams.get("limit") || 50));

  const startOffset = (page - 1) * limit;
  const endOffset = startOffset + limit - 1;

  const sb = getServiceClient();
  let query = sb
    .from("verification_logs")
    .select("*, merchants(business_name, email)", { count: "exact" });

  if (merchantId) {
    query = query.eq("merchant_id", merchantId);
  }
  if (provider) {
    query = query.eq("provider_name", provider.toUpperCase());
  }
  if (status) {
    query = query.eq("normalized_status", status.toLowerCase());
  }
  if (verificationType) {
    const typeVal = verificationType.toLowerCase();
    if (typeVal === "bvn_selfie") {
      query = query.in("verification_type", ["bvn_selfie", "representative_bvn_selfie"]);
    } else if (typeVal === "business") {
      query = query.in("verification_type", ["business", "business_registry"]);
    } else if (typeVal === "director") {
      query = query.in("verification_type", ["director", "director_bvn_selfie"]);
    } else {
      query = query.eq("verification_type", typeVal);
    }
  }
  if (from) {
    query = query.gte("created_at", from);
  }
  if (to) {
    query = query.lte("created_at", to);
  }

  query = query
    .order("created_at", { ascending: false })
    .range(startOffset, endOffset);

  const { data: logs, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    logs: logs || [],
    count: count || 0,
    page,
    totalPages: Math.ceil((count || 0) / limit),
  });
}
