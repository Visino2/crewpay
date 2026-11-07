import { inspect } from "node:util";

import { describe, expect, it, vi } from "vitest";

import { parseBlaaizEnv } from "@/lib/env/server";
import { BLAAIZ_USER_AGENT, BlaaizAuthError, createBlaaizTokenProvider, type FetchLike } from "@/services/blaaiz/auth";
import { verifyBlaaizConnection } from "@/services/blaaiz/client";
import { BLAAIZ_BASE_URLS, toBlaaizConfig, type BlaaizConfig } from "@/services/blaaiz/config";
import { createBlaaizProvider } from "@/services/blaaiz/provider";

// Placeholders only. The "secret" values are distinctive so leaks are detectable.
const SECRET = "placeholder-client-secret-DO-NOT-LEAK";
const TOKEN = "placeholder-access-token-DO-NOT-LEAK";

const placeholders = {
  BLAAIZ_CLIENT_ID: "placeholder-client-id",
  BLAAIZ_CLIENT_SECRET: SECRET,
  BLAAIZ_BASE_URL: "https://api-dev.blaaiz.com",
  BLAAIZ_TOKEN_URL: "https://api-dev.blaaiz.com/oauth/token",
  BLAAIZ_SCOPES: "wallet:read  currency:read\ncollection:crypto:create",
};

function config(overrides: Record<string, string> = {}): BlaaizConfig {
  return toBlaaizConfig(parseBlaaizEnv({ ...placeholders, ...overrides })!);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const tokenBody = { token_type: "Bearer", expires_in: 900, access_token: TOKEN };

describe("Blaaiz configuration", () => {
  it("is optional: no OAuth variables means not configured", () => {
    expect(parseBlaaizEnv({})).toBeNull();
    expect(parseBlaaizEnv({ BLAAIZ_CLIENT_ID: "  " })).toBeNull();
    expect(parseBlaaizEnv({ BLAAIZ_WEBHOOK_SIGNING_SECRET: "only-this" })).toBeNull();
  });

  it("fails loudly on partial configuration, naming variables but not values", () => {
    const partial = { BLAAIZ_BASE_URL: placeholders.BLAAIZ_BASE_URL, BLAAIZ_CLIENT_SECRET: SECRET };
    expect(() => parseBlaaizEnv(partial)).toThrow(/BLAAIZ_CLIENT_ID.*BLAAIZ_TOKEN_URL|BLAAIZ_TOKEN_URL.*BLAAIZ_CLIENT_ID/);
    expect(() => parseBlaaizEnv(partial)).not.toThrow(new RegExp(SECRET));
  });

  it("accepts only the documented hosts, and a token URL on the same host", () => {
    expect(() => parseBlaaizEnv({ ...placeholders, BLAAIZ_BASE_URL: "https://attacker.example" })).toThrow(/BLAAIZ_BASE_URL/);
    expect(() => parseBlaaizEnv({ ...placeholders, BLAAIZ_BASE_URL: "http://api-dev.blaaiz.com" })).toThrow(/BLAAIZ_BASE_URL/);
    expect(() =>
      parseBlaaizEnv({ ...placeholders, BLAAIZ_TOKEN_URL: "https://attacker.example/oauth/token" }),
    ).toThrow(/BLAAIZ_TOKEN_URL/);
    // Development base URL with the production token URL is a mix-up, not a valid setup.
    expect(() =>
      parseBlaaizEnv({ ...placeholders, BLAAIZ_TOKEN_URL: "https://api-prod.blaaiz.com/oauth/token" }),
    ).toThrow(/BLAAIZ_TOKEN_URL/);
  });

  it("requires individual scopes, not bundle names", () => {
    expect(() => parseBlaaizEnv({ ...placeholders, BLAAIZ_SCOPES: "full-access" })).toThrow(/BLAAIZ_SCOPES/);
    expect(() => parseBlaaizEnv({ ...placeholders, BLAAIZ_SCOPES: "wallet:read payouts" })).toThrow(/BLAAIZ_SCOPES/);
  });

  it("accepts the development credential's assigned scope list as given", () => {
    const assigned =
      "checkout:access checkout:manage wallet:read currency:read bank:read customer:read customer:write beneficiary:read virtual-account:read virtual-account:create virtual-account:close collection:create collection:crypto:create collection:interac:accept collection:interac:create interac-auto-deposit-email:create interac-auto-deposit-email:read refund:create refund:read payout:create swap:create crypto-wallet:read crypto-wallet:create crypto-asset:read crypto-transaction:read crypto-payout:create crypto-swap:create transaction:read fees:read rates:read file:upload webhook:read webhook:write webhook:replay mock:webhook:trigger compliance-kyc:read compliance-kyc:create compliance-kyc:cancel";
    const { scopes } = config({ BLAAIZ_SCOPES: assigned });
    expect(scopes).toHaveLength(38);
    expect(scopes.join(" ")).toBe(assigned);
    expect(scopes).toContain("wallet:read");
  });

  it("derives the environment from the base URL and normalizes values", () => {
    const dev = config({ BLAAIZ_BASE_URL: "https://api-dev.blaaiz.com/", BLAAIZ_TOKEN_URL: " https://api-dev.blaaiz.com/oauth/token " });
    expect(dev).toMatchObject({
      environment: "development",
      baseUrl: BLAAIZ_BASE_URLS.development,
      tokenUrl: "https://api-dev.blaaiz.com/oauth/token",
      scopes: ["wallet:read", "currency:read", "collection:crypto:create"],
      webhookSigningSecret: null,
    });
    const prod = config({
      BLAAIZ_BASE_URL: BLAAIZ_BASE_URLS.production,
      BLAAIZ_TOKEN_URL: "https://api-prod.blaaiz.com/oauth/token",
    });
    expect(prod.environment).toBe("production");
  });

  it("never reveals the client secret when the config is logged or serialized", () => {
    const value = config({ BLAAIZ_WEBHOOK_SIGNING_SECRET: "webhook-secret-DO-NOT-LEAK" });
    for (const rendered of [JSON.stringify(value), inspect(value, { depth: 5 }), `${value.clientSecret}`]) {
      expect(rendered).not.toContain(SECRET);
      expect(rendered).not.toContain("webhook-secret-DO-NOT-LEAK");
    }
    expect(value.clientSecret.reveal()).toBe(SECRET);
  });
});

describe("Blaaiz OAuth token provider", () => {
  it("requests a client-credentials token exactly as documented", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => json(200, tokenBody));
    const token = await createBlaaizTokenProvider(config(), { fetch: fetchMock }).getAccessToken();

    expect(token.reveal()).toBe(TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api-dev.blaaiz.com/oauth/token");
    expect(init).toMatchObject({ method: "POST", cache: "no-store", redirect: "error" });
    expect(init.headers).toMatchObject({
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": BLAAIZ_USER_AGENT,
    });
    const form = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "client_credentials",
      client_id: "placeholder-client-id",
      client_secret: SECRET,
      scope: "wallet:read currency:read collection:crypto:create",
    });
    // The secret travels only in the POST body, never in the URL.
    expect(url).not.toContain(SECRET);
  });

  it("reuses the token until shortly before expiry, then requests a new one", async () => {
    let clock = 1_000_000;
    const fetchMock = vi.fn<FetchLike>(async () => json(200, tokenBody));
    const tokens = createBlaaizTokenProvider(config(), { fetch: fetchMock, now: () => clock });

    await tokens.getAccessToken();
    clock += 839_000; // 900 s lifetime minus a 60 s margin, less one second
    await tokens.getAccessToken();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clock += 1_000;
    await tokens.getAccessToken();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares one request between concurrent callers", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => json(200, tokenBody));
    const tokens = createBlaaizTokenProvider(config(), { fetch: fetchMock });
    await Promise.all([tokens.getAccessToken(), tokens.getAccessToken(), tokens.getAccessToken()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, { error: "invalid_scope", message: "Invalid scope(s) provided" }, "invalid_request"],
    [401, { error: "invalid_client" }, "invalid_client"],
    [403, {}, "forbidden"],
    [429, {}, "rate_limited"],
    [503, {}, "upstream_unavailable"],
  ] as const)("maps HTTP %i to %s without leaking credentials", async (status, body, code) => {
    const tokens = createBlaaizTokenProvider(config(), { fetch: async () => json(status, body) });
    const error = await tokens.getAccessToken().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BlaaizAuthError);
    expect(error).toMatchObject({ code, status });
    expect(String((error as Error).message)).not.toContain(SECRET);
  });

  it("drops error text that echoes a credential", async () => {
    const tokens = createBlaaizTokenProvider(config(), {
      fetch: async () => json(401, { message: `bad secret ${SECRET}` }),
    });
    const error = (await tokens.getAccessToken().catch((caught: unknown) => caught)) as BlaaizAuthError;
    expect(error.detail).toBeNull();
    expect(error.message).not.toContain(SECRET);
  });

  it("rejects malformed or non-Bearer token responses", async () => {
    for (const body of [{ access_token: TOKEN }, { ...tokenBody, token_type: "MAC" }, { ...tokenBody, expires_in: "900" }]) {
      const tokens = createBlaaizTokenProvider(config(), { fetch: async () => json(200, body) });
      await expect(tokens.getAccessToken()).rejects.toMatchObject({ code: "invalid_response" });
    }
  });

  it("reports network failures without details", async () => {
    const tokens = createBlaaizTokenProvider(config(), {
      fetch: async () => {
        throw new TypeError(`connect failed ${SECRET}`);
      },
    });
    const error = (await tokens.getAccessToken().catch((caught: unknown) => caught)) as BlaaizAuthError;
    expect(error).toMatchObject({ code: "network_error", status: null });
    expect(error.message).not.toContain(SECRET);
  });
});

describe("Blaaiz read-only connectivity check", () => {
  function routes(walletResponses: Response[]) {
    return vi.fn<FetchLike>(async (url) =>
      url.endsWith("/oauth/token") ? json(200, tokenBody) : walletResponses.shift()!,
    );
  }

  it("calls only GET /api/external/wallet with the bearer token, returning no balances", async () => {
    const fetchMock = routes([json(200, { data: [{ id: "w1", balance: "10" }, { id: "w2", balance: "20" }] })]);
    const result = await verifyBlaaizConnection(config(), { fetch: fetchMock });

    expect(result).toEqual({ ok: true, status: 200, walletCount: 2 });
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("https://api-dev.blaaiz.com/api/external/wallet");
    expect(init).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
    expect(init.headers).toMatchObject({ authorization: `Bearer ${TOKEN}`, "user-agent": BLAAIZ_USER_AGENT });
    expect(fetchMock.mock.calls.map(([calledUrl, calledInit]) => `${calledInit.method} ${calledUrl}`)).toEqual([
      "POST https://api-dev.blaaiz.com/oauth/token",
      "GET https://api-dev.blaaiz.com/api/external/wallet",
    ]);
  });

  it("retries once with a fresh token after a 401", async () => {
    const fetchMock = routes([json(401, {}), json(200, [])]);
    await expect(verifyBlaaizConnection(config(), { fetch: fetchMock })).resolves.toEqual({
      ok: true,
      status: 200,
      walletCount: 0,
    });
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/oauth/token"))).toHaveLength(2);
  });

  it("reports token and API failures by stage, without secrets", async () => {
    const tokenFailure = await verifyBlaaizConnection(config(), { fetch: async () => json(401, {}) });
    expect(tokenFailure).toEqual({ ok: false, stage: "token", code: "invalid_client", status: 401, detail: null });

    const scopeFailure = await verifyBlaaizConnection(config(), { fetch: routes([json(403, {})]) });
    expect(scopeFailure).toEqual({ ok: false, stage: "api", code: "forbidden", status: 403 });
    expect(JSON.stringify([tokenFailure, scopeFailure])).not.toMatch(new RegExp(`${SECRET}|${TOKEN}`));
  });
});

describe("Blaaiz provider", () => {
  const request = { sourceCurrency: "USD", destinationCurrency: "NGN", recipientAmount: "150000.00" };

  it("reports quotes as unavailable when not configured", async () => {
    await expect(createBlaaizProvider(null).getFeeQuote(request)).resolves.toEqual({
      status: "unavailable",
      reason: "not_configured",
    });
  });

  it("never invents a quote, even when configured", async () => {
    await expect(createBlaaizProvider(config()).getFeeQuote(request)).resolves.toEqual({
      status: "unavailable",
      reason: "not_implemented",
    });
  });
});
