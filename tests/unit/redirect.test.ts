import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "@/lib/security/redirect";

describe("safeRedirectPath", () => {
  it.each([
    ["/account", "/account"],
    ["/account?tab=members#top", "/account?tab=members#top"],
    ["/a/../account", "/account"],
  ])("keeps the same-site path %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([
    "https://evil.example",
    "//evil.example/path",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "account",
    "/acc\u0000ount",
    `/${"a".repeat(600)}`,
    "",
    null,
    undefined,
    42,
  ])("falls back for %s", (input) => {
    expect(safeRedirectPath(input, "/fallback")).toBe("/fallback");
  });
});
