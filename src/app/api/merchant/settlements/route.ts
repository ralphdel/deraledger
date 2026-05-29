import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const merchantId = await resolveCurrentMerchantId(supabase);

  if (!merchantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let { data, error } = await supabase
    .from("settlement_records")
    .select(`
      *,
      payment_records(*),
      merchant_settlement_accounts(bank_name,account_number,account_name,currency),
      merchant_provider_settlement_accounts(provider_name,status,environment),
      provider_settlement_batches(provider_batch_reference,actual_settlement_total,settlement_status,settled_at,provider_reported_settled_at)
    `)
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    const fallback = await supabase
      .from("settlement_records")
      .select(`
        *,
        payment_records(*),
        merchant_settlement_accounts(bank_name,account_number,account_name,currency),
        merchant_provider_settlement_accounts(provider_name,status,environment)
      `)
      .eq("merchant_id", merchantId)
      .order("created_at", { ascending: false })
      .limit(100);

    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data || [];
  return NextResponse.json({
    rows,
    summary: {
      totalCollected: rows.reduce((sum, row) => sum + Number(row.gross_amount || 0), 0),
      totalProviderFees: rows.reduce((sum, row) => sum + Number(row.provider_fee || 0), 0),
      totalPlatformFees: rows.reduce((sum, row) => sum + Number(row.platform_fee || 0), 0),
      expectedSettlement: rows.reduce((sum, row) => sum + Number(row.expected_settlement || 0), 0),
      settledAmount: rows.reduce((sum, row) => sum + Number(row.actual_settlement || 0), 0),
      pendingSettlement: rows
        .filter((row) => ["pending", "processing", "manual_review"].includes(row.settlement_status))
        .reduce((sum, row) => sum + Number(row.expected_settlement || 0), 0),
      failedSettlement: rows
        .filter((row) => ["failed", "disputed"].includes(row.settlement_status))
        .reduce((sum, row) => sum + Number(row.expected_settlement || 0), 0),
    },
  });
}

async function resolveCurrentMerchantId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: owned } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (owned?.id) return owned.id as string;

  const { data: teamRow } = await supabase
    .from("merchant_team")
    .select("merchant_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (teamRow?.merchant_id as string | undefined) || null;
}
