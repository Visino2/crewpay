import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { executeAction } from "@/lib/actions";
import type { AuthContext } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";

const schema = z.object({ name: z.string().min(2) });
const context: AuthContext = {
  db: {} as SupabaseClient,
  user: { id: "6f1c2b4e-8a7d-4c3b-9e2f-1a2b3c4d5e6f", email: "ada@example.com" },
};
const signedIn = async () => context;
const signedOut = async () => null;

describe("executeAction", () => {
  it("refuses signed-out callers before running anything", async () => {
    const handler = vi.fn();
    const result = await executeAction(schema, { name: "Acme" }, signedOut, handler);
    expect(result).toEqual({
      ok: false,
      error: { code: "not_authenticated", message: "Please sign in to continue." },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns field errors for invalid input without running the handler", async () => {
    const handler = vi.fn();
    const result = await executeAction(schema, { name: "A" }, signedIn, handler);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("invalid_input");
    expect(!result.ok && result.error.fieldErrors?.name?.length).toBeGreaterThan(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes parsed data and the verified user to the handler", async () => {
    const result = await executeAction(schema, { name: "Acme" }, signedIn, async (data, ctx) => {
      return `${data.name}:${ctx.user.id}`;
    });
    expect(result).toEqual({ ok: true, data: `Acme:${context.user.id}` });
  });

  it("turns AppErrors into safe results", async () => {
    const result = await executeAction(schema, { name: "Acme" }, signedIn, async () => {
      throw new AppError("invalid_state", "empty_pay_run");
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_state",
        reason: "empty_pay_run",
        message: "Add at least one contractor before submitting.",
      },
    });
  });

  it("hides unexpected errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await executeAction(schema, { name: "Acme" }, signedIn, async () => {
      throw new Error("db password is hunter2");
    });
    expect(result).toEqual({
      ok: false,
      error: { code: "unexpected", message: "Something went wrong. Please try again." },
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("hunter2");
    consoleError.mockRestore();
  });

  it("lets Next.js redirects through", async () => {
    await expect(
      executeAction(schema, { name: "Acme" }, signedIn, async () => redirect("/account")),
    ).rejects.toThrow("NEXT_REDIRECT");
  });
});
