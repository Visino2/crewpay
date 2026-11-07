import "server-only";

import { z } from "zod";

import { Redacted } from "@/lib/security/redacted";

import type { BlaaizConfig } from "./config";

/**
 * OAuth client-credentials token handling, as documented at
 * https://docs.blaaiz.com/docs/guides/authentication and
 * https://docs.blaaiz.com/docs/payments/authentication/get-oauth-access-token
 *
 * - POST /oauth/token, application/x-www-form-urlencoded, with grant_type,
 *   client_id, client_secret and scope (individual scopes, space-separated).
 * - Response: { token_type: "Bearer", expires_in, access_token }. No refresh
 *   token; request a new token when the current one expires.
 * - Every request must send a User-Agent header.
 *
 * The client secret and access token are only ever held in Redacted values
 * and never appear in errors or logs.
 */

/** Blaaiz rejects requests without a User-Agent at the gateway. */
export const BLAAIZ_USER_AGENT = "CrewPay/0.1 (server)";

const REQUEST_TIMEOUT_MS = 15_000;
/** Renew this long before expiry so a token never expires mid-request. */
const EXPIRY_MARGIN_MS = 60_000;

export type BlaaizAuthErrorCode =
  | "invalid_request" // 400, e.g. an unknown or unassigned scope
  | "invalid_client" // 401, wrong client ID or secret
  | "forbidden" // 403, e.g. API access disabled or IP not whitelisted
  | "rate_limited" // 429
  | "upstream_unavailable" // 5xx
  | "network_error"
  | "invalid_response";

export class BlaaizAuthError extends Error {
  constructor(
    readonly code: BlaaizAuthErrorCode,
    readonly status: number | null,
    /** A short, sanitized error code or message from Blaaiz, if any. */
    readonly detail: string | null = null,
  ) {
    super(`Blaaiz token request failed: ${code}${status ? ` (HTTP ${status})` : ""}${detail ? `: ${detail}` : ""}`);
    this.name = "BlaaizAuthError";
  }
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().refine((value) => value.toLowerCase() === "bearer"),
  // The docs show 900 without a unit; OAuth (RFC 6749 §5.1) defines seconds.
  expires_in: z.number().positive().finite(),
});

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type BlaaizHttpDeps = {
  fetch?: FetchLike;
  /** Milliseconds since the epoch; injectable for tests. */
  now?: () => number;
};

export type BlaaizTokenProvider = {
  /** Returns a cached token while it is valid, otherwise requests a new one. */
  getAccessToken(): Promise<Redacted>;
  /** Drops the cached token, e.g. after the API answers 401. */
  invalidate(): void;
};

function errorCodeForStatus(status: number): BlaaizAuthErrorCode {
  if (status === 401) return "invalid_client";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "upstream_unavailable";
  return "invalid_request";
}

/** Extracts a short error code/message, dropping anything that echoes a credential. */
async function safeErrorDetail(response: Response, config: BlaaizConfig): Promise<string | null> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const candidate = [record.error, record.message].find(
    (value): value is string => typeof value === "string" && /^[\w .,'()-]{1,120}$/.test(value),
  );
  if (!candidate || candidate.includes(config.clientSecret.reveal()) || candidate.includes(config.clientId)) {
    return null;
  }
  return candidate;
}

export function createBlaaizTokenProvider(config: BlaaizConfig, deps: BlaaizHttpDeps = {}): BlaaizTokenProvider {
  const doFetch: FetchLike = deps.fetch ?? ((url, init) => fetch(url, init));
  const now = deps.now ?? Date.now;
  let cached: { token: Redacted; renewAt: number } | null = null;
  let pending: Promise<Redacted> | null = null;

  async function requestToken(): Promise<Redacted> {
    const requestedAt = now();
    let response: Response;
    try {
      response = await doFetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
          "user-agent": BLAAIZ_USER_AGENT,
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: config.clientId,
          client_secret: config.clientSecret.reveal(),
          scope: config.scopes.join(" "),
        }),
        // Never cache credentials or tokens, and never follow a redirect that
        // could carry the client secret to another host.
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new BlaaizAuthError("network_error", null);
    }

    if (!response.ok) {
      throw new BlaaizAuthError(
        errorCodeForStatus(response.status),
        response.status,
        await safeErrorDetail(response, config),
      );
    }

    let parsed: z.ZodSafeParseResult<z.output<typeof tokenResponseSchema>>;
    try {
      parsed = tokenResponseSchema.safeParse(await response.json());
    } catch {
      throw new BlaaizAuthError("invalid_response", response.status);
    }
    if (!parsed.success) {
      throw new BlaaizAuthError("invalid_response", response.status);
    }

    const lifetimeMs = parsed.data.expires_in * 1000;
    const token = new Redacted(parsed.data.access_token);
    cached = { token, renewAt: requestedAt + lifetimeMs - Math.min(EXPIRY_MARGIN_MS, lifetimeMs / 2) };
    return token;
  }

  return {
    getAccessToken() {
      if (cached && now() < cached.renewAt) {
        return Promise.resolve(cached.token);
      }
      // Concurrent callers share one token request.
      pending ??= requestToken().finally(() => {
        pending = null;
      });
      return pending;
    },
    invalidate() {
      cached = null;
    },
  };
}
