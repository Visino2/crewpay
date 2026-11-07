import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("session cookie options", () => {
  it("are HttpOnly and SameSite=Lax", async () => {
    const { SESSION_COOKIE_OPTIONS } = await import("@/lib/supabase/cookie-options");
    expect(SESSION_COOKIE_OPTIONS).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  });

  it("are Secure in production builds", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { SESSION_COOKIE_OPTIONS } = await import("@/lib/supabase/cookie-options");
    expect(SESSION_COOKIE_OPTIONS.secure).toBe(true);
  });
});

describe("proxy session handling", () => {
  it("recognises protected paths precisely", async () => {
    const { isProtectedPath } = await import("@/lib/supabase/proxy");
    expect(isProtectedPath("/account")).toBe(true);
    expect(isProtectedPath("/account/settings")).toBe(true);
    expect(isProtectedPath("/accounting")).toBe(false);
    expect(isProtectedPath("/sign-in")).toBe(false);
    expect(isProtectedPath("/orgs/6f1c2b4e-8a7d-4c3b-9e2f-1a2b3c4d5e6f/pay-runs")).toBe(true);
    expect(isProtectedPath("/orgsx")).toBe(false);
  });

  it("sends signed-out visitors of protected pages to sign-in, keeping a safe return path", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
    const { updateSession } = await import("@/lib/supabase/proxy");

    const response = await updateSession(new NextRequest("http://localhost:3000/account?tab=members"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe("/account?tab=members");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("fails closed for protected pages when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const { updateSession } = await import("@/lib/supabase/proxy");
    const response = await updateSession(new NextRequest("http://localhost:3000/account"));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/sign-in");
  });

  it("lets public pages through", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const { updateSession } = await import("@/lib/supabase/proxy");
    const response = await updateSession(new NextRequest("http://localhost:3000/sign-in"));
    expect(response.headers.get("location")).toBeNull();
  });
});
