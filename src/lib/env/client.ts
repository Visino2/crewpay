import { z } from "zod";

import { parseEnv } from "./parse";

/**
 * Browser-safe configuration. These values are inlined into the client bundle
 * at build time, so nothing secret may appear here.
 */
const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

export type ClientEnv = z.output<typeof clientEnvSchema>;

let cached: ClientEnv | undefined;

function readClientEnv(): Record<string, string | undefined> {
  // Next.js only inlines static `process.env.NEXT_PUBLIC_*` references, so
  // each variable must be read explicitly rather than passing process.env.
  return {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

export function getClientEnv(): ClientEnv {
  cached ??= parseEnv(clientEnvSchema, readClientEnv(), "client");
  return cached;
}

/** Like getClientEnv, but returns null instead of throwing when unconfigured. */
export function tryGetClientEnv(): ClientEnv | null {
  if (cached) {
    return cached;
  }
  const result = clientEnvSchema.safeParse(readClientEnv());
  return result.success ? (cached = result.data) : null;
}
