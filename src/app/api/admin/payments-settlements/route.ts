import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireAdminPortalSession } from "@/lib/admin-portal-auth";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireAdminPortalSession();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider");
  const paymentMethod = searchParams.get("payment_method");
  const settlementStatus = searchParams.get("settlement_status");
  const feePayer = searchParams.get("fee_payer");
  const merchantId = searchParams.get("merchant_id");
  const limit = Math.min(Number(searchParams.get("limit") || 100), 500);

  let query = supabase
    .from("settlement_records")
    .select(`
      *,
      payment_records(*),
      merchants(business_name,email),
      merchant_settlement_accounts(bank_name,account_number,account_name,currency),
      merchant_provider_settlement_accounts(provider_account_reference,provider_subaccount_code,provider_split_reference,status,environment)
    `)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (provider && provider !== "all") query = query.eq("provider_name", provider);
  if (paymentMethod && paymentMethod !== "all") query = query.eq("payment_method", paymentMethod);
  if (settlementStatus && settlementStatus !== "all") query = query.eq("settlement_status", settlementStatus);
  if (feePayer && feePayer !== "all") query = query.eq("fee_payer", feePayer);
  if (merchantId && merchantId !== "all") query = query.eq("merchant_id", merchantId);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data || [];
  return NextResponse.json({
    rows,
    summary: {
      grossAmount: rows.reduce((sum, row) => sum + Number(row.gross_amount || 0), 0),
      providerFees: rows.reduce((sum, row) => sum + Number(row.provider_fee || 0), 0),
      platformFees: rows.reduce((sum, row) => sum + Number(row.platform_fee || 0), 0),
      expectedSettlement: rows.reduce((sum, row) => sum + Number(row.expected_settlement || 0), 0),
      actualSettlement: rows.reduce((sum, row) => sum + Number(row.actual_settlement || 0), 0),
      manualReviewCount: rows.filter((row) => row.settlement_status === "manual_review").length,
    },
  });
}
