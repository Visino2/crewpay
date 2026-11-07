import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { tryGetClientEnv } from "@/lib/env/client";
import { safeRedirectPath } from "@/lib/security/redirect";

import { SESSION_COOKIE_OPTIONS } from "./cookie-options";

const PROTECTED_PREFIXES = ["/account", "/orgs"];

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function redirectToSignIn(request: NextRequest, carryCookiesFrom?: NextResponse): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = "";
  url.searchParams.set("next", safeRedirectPath(`${request.nextUrl.pathname}${request.nextUrl.search}`));
  const redirect = NextResponse.redirect(url);
  for (const cookie of carryCookiesFrom?.cookies.getAll() ?? []) {
    redirect.cookies.set(cookie);
  }
  redirect.headers.set("Cache-Control", "private, no-store");
  return redirect;
}

/**
 * Refreshes the Supabase session cookie on each request and redirects
 * signed-out visitors away from protected pages. This is a convenience
 * layer: every protected page and action re-verifies the user itself.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const env = tryGetClientEnv();

  if (!env) {
    // Without Supabase configuration nobody can be signed in.
    return isProtectedPath(request.nextUrl.pathname) ? redirectToSignIn(request) : response;
  }

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Responses that set auth cookies must never be cached and shared.
        for (const [key, value] of Object.entries(headers ?? {})) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // Do not add logic between creating the client and this call: it refreshes
  // an expired session and verifies the token.
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims && isProtectedPath(request.nextUrl.pathname)) {
    return redirectToSignIn(request, response);
  }

  return response;
}
