import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getClientEnv } from "@/lib/env/client";

import { SESSION_COOKIE_OPTIONS } from "./cookie-options";

/**
 * A Supabase client bound to the current request's session. It uses the
 * publishable key, so every query runs as the signed-in user and is subject
 * to RLS. Create one per request; never share it.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  // Read cookies first: it marks the route as dynamic, so authenticated pages
  // are never prerendered at build time.
  const cookieStore = await cookies();
  const env = getClientEnv();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. The proxy refreshes the
          // session on every request, so this is safe to ignore here.
        }
      },
    },
  });
}
