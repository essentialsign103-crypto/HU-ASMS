// HU-ASMS: Edge Authentication & Role Guard Middleware
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { evaluateRouteGuard } from './lib/auth/middleware-guard';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const pathname = request.nextUrl.pathname;
  const method = request.method;
  const hasNextActionHeader = request.headers.has('next-action');

  // Only protect /admin and /rep routes
  const isAdminRoute = pathname.startsWith('/admin');
  const isRepRoute = pathname.startsWith('/rep');

  if (!isAdminRoute && !isRepRoute) {
    return response;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    const missing = [
      !supabaseUrl ? 'NEXT_PUBLIC_SUPABASE_URL' : null,
      !supabaseAnonKey ? 'NEXT_PUBLIC_SUPABASE_ANON_KEY' : null,
    ]
      .filter(Boolean)
      .join(', ');
    console.error(
      `[HU-ASMS] Middleware: missing environment variable(s): ${missing}. ` +
        'Failing closed on protected route: ' + pathname
    );
    const configDecision = evaluateRouteGuard({
      pathname,
      method,
      hasNextActionHeader,
      hasSupabaseConfig: false,
    });
    if (configDecision.action === 'deny') {
      return NextResponse.json(
        { error: configDecision.error },
        { status: configDecision.status, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return NextResponse.json(
      { error: 'Authentication service is not configured.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        request.cookies.set({ name, value, ...options });
        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        request.cookies.set({ name, value: '', ...options });
        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });
        response.cookies.set({ name, value: '', ...options });
      },
    },
  });

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  let profile: { role?: string | null; is_active?: boolean | null } | null = null;
  let profileError = false;

  if (user && !authError) {
    const { data: profileData, error: profErr } = await supabase
      .from('profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .maybeSingle();

    profile = profileData;
    profileError = Boolean(profErr);
  }

  const decision = evaluateRouteGuard({
    pathname,
    method,
    hasNextActionHeader,
    hasSupabaseConfig: true,
    userId: user?.id ?? null,
    authError: Boolean(authError),
    profile,
    profileError,
  });

  if (decision.action === 'deny') {
    return NextResponse.json(
      { error: decision.error },
      { status: decision.status, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (decision.action === 'redirect') {
    const targetUrl = request.nextUrl.clone();
    targetUrl.pathname = decision.pathname;
    targetUrl.search = '';
    if (decision.redirectTo) {
      targetUrl.searchParams.set('redirectTo', decision.redirectTo);
    }
    if (decision.error) {
      targetUrl.searchParams.set('error', decision.error);
    }
    return NextResponse.redirect(targetUrl);
  }

  return response;
}

export const config = {
  matcher: ['/admin/:path*', '/rep/:path*'],
};
