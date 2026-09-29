import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { resolveOperationalPortalRouting } from "@/lib/server/admin-domain-routing";
import { shouldBlockExcludedLegacyAdminApi } from "@/lib/server/legacy-admin-api-release";

export async function proxy(request: NextRequest) {
  const url = request.nextUrl.clone();
  if (shouldBlockExcludedLegacyAdminApi(url.pathname, process.env)) {
    return NextResponse.json(
      { error: "Not found" },
      {
        status: 404,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
        },
      },
    );
  }

  const operationalRouting = resolveOperationalPortalRouting(request.nextUrl.hostname, url.pathname);
  if (operationalRouting === "redirect_to_admin") {
    url.pathname = "/admin";
    return NextResponse.redirect(url);
  }
  if (operationalRouting === "redirect_to_public_root") {
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  if (url.pathname.startsWith('/admin') && url.pathname !== '/admin-login') {
    const adminSession = request.cookies.get('admin_session')?.value;
    if (adminSession !== 'authenticated') {
      url.pathname = '/admin-login';
      return NextResponse.redirect(url);
    }
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthRoute = request.nextUrl.pathname.startsWith('/login') || request.nextUrl.pathname.startsWith('/register');
  const protectedDashboardPrefixes = [
    '/dashboard',
    '/invoices',
    '/team',
    '/clients',
    '/settings',
    '/purpbot',
    '/references',
    '/settlements',
    '/accounting-report',
  ];
  const isDashboardRoute = protectedDashboardPrefixes.some((prefix) => request.nextUrl.pathname.startsWith(prefix));
  const isAdminRoute = request.nextUrl.pathname.startsWith('/admin') && request.nextUrl.pathname !== '/admin-login';
  const isSuspendedRoute = request.nextUrl.pathname.startsWith('/suspended');
  const isSetPasswordRoute = request.nextUrl.pathname.startsWith('/set-password');

  // Protect private routes
  if (!user && (isDashboardRoute || isAdminRoute)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Metadata is navigation context only. Admin authority is resolved by the
  // server page/API guard from public.merchants.is_super_admin.
  if (user) {
    if (isDashboardRoute || isAuthRoute) {
      // Look up current merchant status to check for suspension
      const merchantId = request.cookies.get("purpledger_workspace_id")?.value;
      
      if (merchantId) {
        const { data: merchantData } = await supabase
          .from("merchants")
          .select("verification_status, last_acknowledged_version")
          .eq("id", merchantId)
          .single();
          
        if (merchantData?.verification_status === "suspended") {
          if (!isSuspendedRoute) {
            const url = request.nextUrl.clone();
            url.pathname = '/suspended';
            return NextResponse.redirect(url);
          }
        }
        
        // 2. Check if team member needs password reset
        const { data: teamData } = await supabase
          .from("merchant_team")
          .select("must_change_password")
          .eq("user_id", user.id)
          .eq("merchant_id", merchantId)
          .single();
          
        if (teamData?.must_change_password) {
          if (!isSetPasswordRoute) {
            const url = request.nextUrl.clone();
            url.pathname = '/set-password';
            return NextResponse.redirect(url);
          }
        }

        // Check removed: Now handled via UI Modal on the dashboard directly
      }
    }

    // Redirect authenticated users away from login/register screens
    if (isAuthRoute) {
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard';
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|pay/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
