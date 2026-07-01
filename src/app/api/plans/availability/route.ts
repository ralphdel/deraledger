import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  PLAN_CATALOG,
  assertPlanAvailable,
  getPlanDisplayName,
  getPlanPrice,
  getPlanRouteSegment,
  normalizePlanCode,
} from "@/lib/plans";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedPlan = searchParams.get("plan");
  const normalizedPlan = normalizePlanCode(requestedPlan);
  const availability = await assertPlanAvailable(supabase, normalizedPlan);

  return NextResponse.json({
    requestedPlan,
    normalizedPlan,
    available: availability.ok,
    displayName: getPlanDisplayName(normalizedPlan),
    priceNgn: getPlanPrice(normalizedPlan),
    routeSegment: getPlanRouteSegment(normalizedPlan),
    catalog: PLAN_CATALOG[normalizedPlan],
  });
}
