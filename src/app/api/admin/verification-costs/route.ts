import { NextResponse } from "next/server";
import {
  getCostSummary,
  getCostByProvider,
  getCostByMerchant,
  getCostByPeriod,
  detectCostSpike,
} from "@/lib/services/cost.service";

function requireAdminCookie(request: Request): boolean {
  const cookieHeader = request.headers.get("cookie") || "";
  return cookieHeader.includes("admin_session=authenticated");
}

export async function GET(request: Request) {
  if (!requireAdminCookie(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;
  const granularity = (searchParams.get("granularity") || "day") as "day" | "week" | "month";

  const filters = { from, to };

  try {
    const [summary, byProvider, byMerchant, byPeriod, spike] = await Promise.all([
      getCostSummary(filters),
      getCostByProvider(filters),
      getCostByMerchant(10, filters),
      getCostByPeriod(granularity, filters),
      detectCostSpike(),
    ]);

    return NextResponse.json({
      summary,
      byProvider,
      byMerchant,
      byPeriod,
      spike,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
