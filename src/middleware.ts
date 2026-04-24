import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  if (url.pathname.startsWith('/admin')) {
    const basicAuth = request.headers.get('authorization');
    const adminUser = process.env.ADMIN_PORTAL_USER;
    const adminPass = process.env.ADMIN_PORTAL_PASS;
    if (adminUser && adminPass) {
      if (basicAuth) {
        const authValue = basicAuth.split(' ')[1];
        const [user, pwd] = atob(authValue).split(':');
        if (user !== adminUser || pwd !== adminPass) {
          return new NextResponse('Auth Required', {
            status: 401,
            headers: { 'WWW-Authenticate': 'Basic realm="Secure Admin Portal"' },
          });
        }
      } else {
        return new NextResponse('Auth Required', {
          status: 401,
          headers: { 'WWW-Authenticate': 'Basic realm="Secure Admin Portal"' },
        });
      }
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
  const isDashboardRoute = request.nextUrl.pathname.startsWith('/dashboard') || request.nextUrl.pathname.startsWith('/invoices') || request.nextUrl.pathname.startsWith('/customers') || request.nextUrl.pathname.startsWith('/settings');
  const isAdminRoute = request.nextUrl.pathname.startsWith('/admin');

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
