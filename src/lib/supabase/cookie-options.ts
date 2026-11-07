import type { CookieOptionsWithName } from "@supabase/ssr";

import { isProduction } from "@/lib/env/runtime";

/**
 * Session cookie attributes. @supabase/ssr defaults to `httpOnly: false` so a
 * browser Supabase client can read the session. CrewPay never creates a
 * browser client (enforced by ESLint), so the session stays out of reach of
 * page scripts.
 */
export const SESSION_COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: isProduction,
} as const satisfies CookieOptionsWithName;
