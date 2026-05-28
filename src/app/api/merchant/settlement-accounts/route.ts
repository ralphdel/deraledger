import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const merchantId = await resolveCurrentMerchantId(supabase);

  if (!merchantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("merchant_settlement_accounts")
    .select(`
      *,
      merchant_provider_settlement_accounts(*)
    `)
    .eq("merchant_id", merchantId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ accounts: data || [] });
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
