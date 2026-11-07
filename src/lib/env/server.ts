import "server-only";

import { z } from "zod";

import { parseEnv } from "./parse";

/**
 * Server-only configuration and secrets. Importing this module from a Client
 * Component fails the build. Never give these variables a NEXT_PUBLIC_ prefix.
 */
const serverEnvSchema = z.object({
  // Bypasses RLS. Reserved for future server jobs (e.g. webhook processing);
  // no request path uses it yet.
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
});

export type ServerEnv = z.output<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

/** Validated lazily so the app can build without credentials present. */
export function getServerEnv(): ServerEnv {
  cached ??= parseEnv(serverEnvSchema, process.env, "server");
  return cached;
}

/** From the official API overview: https://docs.blaaiz.com/docs/api/overview */
export const BLAAIZ_BASE_URLS = {
  development: "https://api-dev.blaaiz.com",
  production: "https://api-prod.blaaiz.com",
} as const;

/** The OAuth client-credentials settings; all-or-nothing. */
const BLAAIZ_OAUTH_KEYS = [
  "BLAAIZ_CLIENT_ID",
  "BLAAIZ_CLIENT_SECRET",
  "BLAAIZ_BASE_URL",
  "BLAAIZ_TOKEN_URL",
  "BLAAIZ_SCOPES",
] as const;

// Individual scopes such as `wallet:read` or `collection:crypto:create`.
// Blaaiz rejects bundle names (`full-access`, `payouts`, ...) in token requests.
const BLAAIZ_SCOPE_PATTERN = /^[a-z0-9-]+(?::[a-z0-9-]+)+$/;

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

const blaaizEnvSchema = z
  .object({
    BLAAIZ_CLIENT_ID: z.string().trim().min(1),
    BLAAIZ_CLIENT_SECRET: z.string().min(1),
    // Only the documented hosts, so credentials can never be sent elsewhere.
    BLAAIZ_BASE_URL: z
      .string()
      .trim()
      .transform(withoutTrailingSlash)
      .pipe(z.enum([BLAAIZ_BASE_URLS.development, BLAAIZ_BASE_URLS.production])),
    BLAAIZ_TOKEN_URL: z.string().trim().transform(withoutTrailingSlash),
    BLAAIZ_SCOPES: z
      .string()
      .transform((value) => value.split(/\s+/).filter(Boolean))
      .pipe(z.array(z.string().regex(BLAAIZ_SCOPE_PATTERN)).min(1)),
    // Not needed for OAuth; required only once webhooks are built.
    BLAAIZ_WEBHOOK_SIGNING_SECRET: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    // The client secret goes to the token URL, so it must be the same host.
    if (env.BLAAIZ_TOKEN_URL !== `${env.BLAAIZ_BASE_URL}/oauth/token`) {
      ctx.addIssue({ code: "custom", path: ["BLAAIZ_TOKEN_URL"], message: "must be BLAAIZ_BASE_URL/oauth/token" });
    }
  });

export type BlaaizEnv = z.output<typeof blaaizEnvSchema>;

/**
 * Blaaiz OAuth settings are all-or-nothing: returns null when none are set
 * and throws (naming the offending variables, never their values) when only
 * some are set or any is invalid.
 */
export function parseBlaaizEnv(source: Record<string, string | undefined>): BlaaizEnv | null {
  const provided = BLAAIZ_OAUTH_KEYS.filter((key) => (source[key] ?? "").trim() !== "");
  if (provided.length === 0) {
    return null;
  }
  const webhookSecret = source.BLAAIZ_WEBHOOK_SIGNING_SECRET;
  return parseEnv(
    blaaizEnvSchema,
    {
      ...Object.fromEntries(BLAAIZ_OAUTH_KEYS.map((key) => [key, source[key]])),
      BLAAIZ_WEBHOOK_SIGNING_SECRET: (webhookSecret ?? "").trim() === "" ? undefined : webhookSecret,
    },
    "server",
  );
}

export function getBlaaizEnv(): BlaaizEnv | null {
  return parseBlaaizEnv(process.env);
}
