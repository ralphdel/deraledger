import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { refreshPayoutMethodSetup } from "@/lib/services/payout-setup-refresh.service";

export const dynamic = "force-dynamic";

const serviceRole = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type RefreshMethod = "card" | "bank_transfer" | "ussd" | "crypto";

export async function POST(request: Request) {
  const supabase = await createClient();
  const merchantId = await resolveCurrentMerchantId(supabase);

  if (!merchantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const method = typeof body?.method === "string" ? body.method : "";

  if (!isRefreshMethod(method)) {
    return NextResponse.json({ error: "A valid payment method is required." }, { status: 400 });
  }

  try {
    const result = await refreshPayoutMethodSetup(serviceRole, {
      merchantId,
      method,
      actorType: "merchant",
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to refresh payment setup.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
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

function isRefreshMethod(value: string): value is RefreshMethod {
  return value === "card" || value === "bank_transfer" || value === "ussd" || value === "crypto";
}
