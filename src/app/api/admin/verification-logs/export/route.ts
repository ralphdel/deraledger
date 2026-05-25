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

function escapeCSV(val: any): string {
  if (val === null || val === undefined) return "";
  let str = String(val);
  // If contains double quotes, escape them by doubling them and enclose in double quotes
  if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
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

  const sb = getServiceClient();
  let query = sb
    .from("verification_logs")
    .select("*, merchants(business_name, email)");

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
    query = query.eq("verification_type", verificationType.toLowerCase());
  }
  if (from) {
    query = query.gte("created_at", from);
  }
  if (to) {
    query = query.lte("created_at", to);
  }

  query = query
    .order("created_at", { ascending: false })
    .limit(10000); // capped max

  const { data: logs, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Generate CSV
  const headers = [
    "Timestamp",
    "Merchant Name",
    "Merchant Email",
    "Verification Type",
    "Provider",
    "Masked BVN",
    "Naira Cost",
    "Attempts",
    "Status",
    "Reference",
    "Error Message",
  ];

  let csvContent = headers.join(",") + "\n";

  for (const log of logs || []) {
    const merchant = log.merchants as any;
    const row = [
      log.created_at,
      merchant?.business_name || "Unknown",
      merchant?.email || "Unknown",
      log.verification_type,
      log.provider_name,
      log.masked_bvn || "",
      log.verification_cost || 0,
      log.attempt_number || 1,
      log.normalized_status,
      log.provider_reference || "",
      log.error_message || "",
    ];
    csvContent += row.map(escapeCSV).join(",") + "\n";
  }

  const filename = `verification_audit_${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csvContent, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
