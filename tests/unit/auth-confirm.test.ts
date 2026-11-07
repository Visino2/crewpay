import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth }),
}));

const { GET } = await import("@/app/auth/confirm/route");

/** Runs the route and returns where it redirected to. */
async function redirectFor(query: string): Promise<string> {
  try {
    await GET(new NextRequest(`https://crewpay.example/auth/confirm${query}`));
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    // NEXT_REDIRECT;<type>;<url>;<status>;
    const url = digest.split(";")[2];
    if (url) return url;
    throw error;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  auth.verifyOtp.mockReset();
  auth.exchangeCodeForSession.mockReset();
});

describe("/auth/confirm", () => {
  it("verifies CrewPay's token_hash links server-side", async () => {
    auth.verifyOtp.mockResolvedValue({ error: null });
    await expect(redirectFor("?token_hash=abc&type=email")).resolves.toBe("/account");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "abc" });
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("rejects invalid token_hash links", async () => {
    auth.verifyOtp.mockResolvedValue({ error: new Error("expired") });
    await expect(redirectFor("?token_hash=abc&type=email")).resolves.toBe("/sign-in?error=confirmation_failed");
  });

  it("signs the user in from Supabase's default-template code links", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    await expect(redirectFor("?code=pkce-code")).resolves.toBe("/account");
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
  });

  it("sends a confirmed user to sign in when the code cannot be exchanged", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: new Error("no code verifier") });
    await expect(redirectFor("?code=pkce-code")).resolves.toBe("/sign-in");
  });

  it("keeps redirects on-site and rejects links with neither parameter", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    await expect(redirectFor("?code=c&next=https://evil.example")).resolves.toBe("/account");
    await expect(redirectFor("")).resolves.toBe("/sign-in?error=confirmation_failed");
    await expect(redirectFor(`?code=${"x".repeat(600)}`)).resolves.toBe("/sign-in?error=confirmation_failed");
  });
});
