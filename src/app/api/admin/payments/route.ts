import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireAdminPortalSession } from "@/lib/admin-portal-auth";
import { getPaymentEnvironment } from "@/lib/services/payment-routing.service";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const guard = await requireAdminPortalSession();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const environment = getPaymentEnvironment();
  const [providersRes, routesRes, methodsRes] = await Promise.all([
    supabase.from("payment_providers").select("*").order("environment").order("provider_name"),
    supabase.from("payment_provider_routes").select("*").order("environment").order("payment_purpose"),
    supabase.from("payment_method_configs").select("*").order("environment").order("payment_purpose"),
  ]);

  if (providersRes.error || routesRes.error || methodsRes.error) {
    return NextResponse.json(
      { error: providersRes.error?.message || routesRes.error?.message || methodsRes.error?.message },
      { status: 500 }
    );
  }

  const providers = providersRes.data || [];
  const routes = routesRes.data || [];
  const methods = methodsRes.data || [];

  return NextResponse.json({
    environment,
    summary: {
      activeProviders: providers.filter((row) => row.status === "active").length,
      activeRoutes: routes.filter((row) => row.is_enabled).length,
      activeMethods: methods.filter((row) => row.is_enabled).length,
    },
    providers,
    routes,
    methods,
  });
}

export async function POST(request: Request) {
  const guard = await requireAdminPortalSession();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        providers?: Record<string, unknown>[];
        routes?: Record<string, unknown>[];
        methods?: Record<string, unknown>[];
      }
    | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (body.providers?.length) {
    const { error } = await supabase.from("payment_providers").upsert(body.providers, {
      onConflict: "provider_name,environment",
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  if (body.routes?.length) {
    const { error } = await supabase.from("payment_provider_routes").upsert(body.routes, {
      onConflict: "payment_purpose,payment_method,environment",
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  if (body.methods?.length) {
    const { error } = await supabase.from("payment_method_configs").upsert(body.methods, {
      onConflict: "payment_purpose,payment_method,environment",
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
