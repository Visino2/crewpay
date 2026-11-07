import "server-only";

import { BLAAIZ_BASE_URLS, getBlaaizEnv, type BlaaizEnv } from "@/lib/env/server";
import { Redacted } from "@/lib/security/redacted";

export { BLAAIZ_BASE_URLS };

export type BlaaizEnvironment = keyof typeof BLAAIZ_BASE_URLS;

export type BlaaizConfig = {
  /** Derived from the base URL; development and production use different credentials. */
  environment: BlaaizEnvironment;
  /** One of the documented hosts; never taken from user input (prevents SSRF). */
  baseUrl: BlaaizEnv["BLAAIZ_BASE_URL"];
  /** Always `${baseUrl}/oauth/token`. */
  tokenUrl: string;
  clientId: string;
  clientSecret: Redacted;
  /** Individual scopes requested with every token. */
  scopes: readonly string[];
  webhookSigningSecret: Redacted | null;
};

export function toBlaaizConfig(env: BlaaizEnv): BlaaizConfig {
  return {
    environment: env.BLAAIZ_BASE_URL === BLAAIZ_BASE_URLS.production ? "production" : "development",
    baseUrl: env.BLAAIZ_BASE_URL,
    tokenUrl: env.BLAAIZ_TOKEN_URL,
    clientId: env.BLAAIZ_CLIENT_ID,
    clientSecret: new Redacted(env.BLAAIZ_CLIENT_SECRET),
    scopes: Object.freeze([...env.BLAAIZ_SCOPES]),
    webhookSigningSecret: env.BLAAIZ_WEBHOOK_SIGNING_SECRET
      ? new Redacted(env.BLAAIZ_WEBHOOK_SIGNING_SECRET)
      : null,
  };
}

/** Null when Blaaiz credentials are not configured. */
export function getBlaaizConfig(): BlaaizConfig | null {
  const env = getBlaaizEnv();
  return env ? toBlaaizConfig(env) : null;
}
