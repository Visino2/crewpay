import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseEnv } from "@/lib/env/parse";

describe("parseEnv", () => {
  const schema = z.object({ API_TOKEN: z.string().min(32) });

  it("returns validated values", () => {
    const value = "a".repeat(32);
    expect(parseEnv(schema, { API_TOKEN: value }, "server")).toEqual({
      API_TOKEN: value,
    });
  });

  it("names invalid variables without exposing their values", () => {
    const value = "value-that-must-not-leak";
    let message = "";
    try {
      parseEnv(schema, { API_TOKEN: value }, "server");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("API_TOKEN");
    expect(message).not.toContain(value);
  });
});

describe("server env module", () => {
  it("can be imported in tests despite the server-only guard", async () => {
    const mod = await import("@/lib/env/server");
    expect(typeof mod.getServerEnv).toBe("function");
  });
});
