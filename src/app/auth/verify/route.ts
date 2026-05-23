import { NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getAppUrl } from '@/lib/server-utils';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  const email = searchParams.get('email');
  const type = searchParams.get('type') as 'magiclink' | 'recovery' | 'signup' | 'invite' | 'email_change' | null;
  const next = searchParams.get('next') ?? '/dashboard';

  const appUrl = getAppUrl();

  if (token && email && type) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set(name: string, value: string, options: CookieOptions) {
            cookieStore.set({ name, value, ...options });
          },
          remove(name: string, options: CookieOptions) {
            cookieStore.set({ name, value: '', ...options });
          },
        },
      }
    );

    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type,
    });

    if (!error) {
      // Clear the invalid workspace cookie to avoid stale redirect issues on fresh login
      cookieStore.delete('purpledger_workspace_id');
      
      return NextResponse.redirect(`${appUrl}${next}`);
    }
    console.error('Auth verification error:', error.message);
    return NextResponse.redirect(`${appUrl}/login?error=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(`${appUrl}/login?error=Invalid+or+missing+verification+parameters`);
}
