import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireAdminPortalSession } from "@/lib/admin-portal-auth";
import { refreshAllPayoutMethodSetup, refreshPayoutMethodSetup } from "@/lib/services/payout-setup-refresh.service";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type RefreshMethod = "card" | "bank_transfer" | "ussd" | "crypto";

export async function POST(request: Request) {
  const guard = await requireAdminPortalSession();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const body = await request.json().catch(() => null);
  const merchantId = typeof body?.merchantId === "string" ? body.merchantId.trim() : "";
  const method = typeof body?.method === "string" ? body.method.trim() : "all";

  if (!merchantId) {
    return NextResponse.json({ error: "merchantId is required." }, { status: 400 });
  }

  try {
    if (method === "all") {
      const result = await refreshAllPayoutMethodSetup(supabase, {
        merchantId,
        actorType: "admin",
      });

      return NextResponse.json(result);
    }

    if (!isRefreshMethod(method)) {
      return NextResponse.json({ error: "A valid payment method is required." }, { status: 400 });
    }

    const result = await refreshPayoutMethodSetup(supabase, {
      merchantId,
      method,
      actorType: "admin",
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to refresh payout setup.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function isRefreshMethod(value: string): value is RefreshMethod {
  return value === "card" || value === "bank_transfer" || value === "ussd" || value === "crypto";
}
