import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const url = request.nextUrl.clone();
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
  const isDashboardRoute = request.nextUrl.pathname.startsWith('/dashboard') || request.nextUrl.pathname.startsWith('/invoices') || request.nextUrl.pathname.startsWith('/team') || request.nextUrl.pathname.startsWith('/clients') || request.nextUrl.pathname.startsWith('/settings');
  const isAdminRoute = request.nextUrl.pathname.startsWith('/admin') && request.nextUrl.pathname !== '/admin-login';
  const isSuspendedRoute = request.nextUrl.pathname.startsWith('/suspended');
  const isSetPasswordRoute = request.nextUrl.pathname.startsWith('/set-password');

  // Protect private routes
  if (!user && (isDashboardRoute || isAdminRoute)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Handle superadmin isolation logic
  if (user) {
    const isSuperAdmin = user.app_metadata?.is_super_admin === true;

    // Merchants locked out of Admin UI
    if (isAdminRoute && !isSuperAdmin) {
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard';
      return NextResponse.redirect(url);
    }

    // Allow SuperAdmins to access both Admin and Dashboard for testing/dummy data purposes.
    
    if (!isSuperAdmin && (isDashboardRoute || isAuthRoute)) {
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
      // Send SuperAdmin to admin, standard users to dashboard
      url.pathname = isSuperAdmin ? '/admin' : '/dashboard';
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
