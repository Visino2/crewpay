/**
 * LIVE Blaaiz OAuth check against the DEVELOPMENT environment.
 *
 * Opt in with CREWPAY_RUN_BLAAIZ=1 and the BLAAIZ_* variables in .env.local
 * (see .env.example). Makes exactly two kinds of request: POST /oauth/token
 * and the read-only GET /api/external/wallet. Moves no money. Assertions use
 * only status codes and counts, so the client secret and access token never
 * appear in test output.
 */
import { describe, expect, it } from "vitest";

import { verifyBlaaizConnection } from "@/services/blaaiz/client";
import { getBlaaizConfig, type BlaaizConfig } from "@/services/blaaiz/config";

const enabled = process.env.CREWPAY_RUN_BLAAIZ === "1";

function loadConfig(): BlaaizConfig {
  const config = getBlaaizConfig();
  if (!config) {
    throw new Error("Blaaiz is not configured: set the BLAAIZ_* variables in .env.local");
  }
  return config;
}

describe.skipIf(!enabled)("Blaaiz OAuth (live, development)", () => {
  it("is configured for development with wallet:read", () => {
    const config = loadConfig();
    expect(config.environment).toBe("development");
    expect(config.scopes).toContain("wallet:read");
  });

  it("obtains a token with the configured scopes and lists wallets", async () => {
    const config = loadConfig();
    // Never run this check against production credentials.
    expect(config.environment).toBe("development");
    const result = await verifyBlaaizConnection(config);
    expect(result).toMatchObject({ ok: true, status: 200 });
  });
});
