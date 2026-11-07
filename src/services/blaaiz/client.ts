import "server-only";

import {
  BLAAIZ_USER_AGENT,
  BlaaizAuthError,
  createBlaaizTokenProvider,
  type BlaaizAuthErrorCode,
  type BlaaizHttpDeps,
  type BlaaizTokenProvider,
} from "./auth";
import type { BlaaizConfig } from "./config";

/**
 * Read-only connectivity check. Uses only the documented
 * `GET /api/external/wallet` ("List all wallets", scope `wallet:read`):
 * https://docs.blaaiz.com/docs/payments/wallet/list-all-wallets
 *
 * No payment, payout or transfer endpoint is implemented.
 */
export const BLAAIZ_WALLETS_PATH = "/api/external/wallet";

export type BlaaizConnectionResult =
  | { ok: true; status: number; walletCount: number | null }
  | { ok: false; stage: "token"; code: BlaaizAuthErrorCode; status: number | null; detail: string | null }
  | {
      ok: false;
      stage: "api";
      code: "unauthorized" | "forbidden" | "rate_limited" | "upstream_unavailable" | "unexpected_status" | "network_error";
      status: number | null;
    };

const REQUEST_TIMEOUT_MS = 15_000;

function apiErrorCode(status: number) {
  if (status === 401) return "unauthorized" as const;
  if (status === 403) return "forbidden" as const;
  if (status === 429) return "rate_limited" as const;
  if (status >= 500) return "upstream_unavailable" as const;
  return "unexpected_status" as const;
}

/** Counts wallets without returning balances or identifiers. */
function countWallets(body: unknown): number | null {
  if (Array.isArray(body)) {
    return body.length;
  }
  const data = typeof body === "object" && body !== null ? (body as Record<string, unknown>).data : undefined;
  return Array.isArray(data) ? data.length : null;
}

export async function verifyBlaaizConnection(
  config: BlaaizConfig,
  deps: BlaaizHttpDeps & { tokens?: BlaaizTokenProvider } = {},
): Promise<BlaaizConnectionResult> {
  const tokens = deps.tokens ?? createBlaaizTokenProvider(config, deps);
  const doFetch = deps.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
  const url = new URL(BLAAIZ_WALLETS_PATH, config.baseUrl).toString();

  // One retry with a fresh token if the cached one was rejected.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let token;
    try {
      token = await tokens.getAccessToken();
    } catch (error) {
      if (error instanceof BlaaizAuthError) {
        return { ok: false, stage: "token", code: error.code, status: error.status, detail: error.detail };
      }
      throw error;
    }

    let response: Response;
    try {
      response = await doFetch(url, {
        method: "GET",
        headers: {
          authorization: `Bearer ${token.reveal()}`,
          accept: "application/json",
          "user-agent": BLAAIZ_USER_AGENT,
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, stage: "api", code: "network_error", status: null };
    }

    if (response.status === 401 && attempt === 0) {
      tokens.invalidate();
      continue;
    }
    if (!response.ok) {
      return { ok: false, stage: "api", code: apiErrorCode(response.status), status: response.status };
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // A 200 without a JSON body still proves connectivity.
    }
    return { ok: true, status: response.status, walletCount: countWallets(body) };
  }

  return { ok: false, stage: "api", code: "unauthorized", status: 401 };
}
