import "server-only";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { getAuthContext, type AuthContext } from "@/lib/auth/session";
import { AppError, publicMessage, type AppErrorCode } from "@/lib/errors";

export type ActionError = {
  code: AppErrorCode;
  message: string;
  reason?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

function failure(
  code: AppErrorCode,
  options: { reason?: string; fieldErrors?: ActionError["fieldErrors"] } = {},
): { ok: false; error: ActionError } {
  return {
    ok: false,
    error: { code, message: publicMessage(code, options.reason), ...options },
  };
}

/**
 * Authenticates, validates input, runs the handler and converts failures into
 * safe results. Kept independent of Next.js request APIs so it can be tested.
 */
export async function executeAction<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  getContext: () => Promise<AuthContext | null>,
  handler: (data: z.output<S>, context: AuthContext) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const context = await getContext();
    if (!context) {
      return failure("not_authenticated");
    }

    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return failure("invalid_input", { fieldErrors: z.flattenError(parsed.error).fieldErrors });
    }

    return { ok: true, data: await handler(parsed.data, context) };
  } catch (error) {
    // Let Next.js handle redirect() and notFound().
    unstable_rethrow(error);

    if (error instanceof AppError) {
      return failure(error.code, { reason: error.reason });
    }
    // Log the error type only; messages can contain user data.
    console.error("[action] unexpected error", error instanceof Error ? error.name : typeof error);
    return failure("unexpected");
  }
}

/**
 * Server Action entry point bound to the request's Supabase session. On
 * success, pages under every organization route are revalidated so lists and
 * totals reflect the change.
 */
export async function runAction<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  handler: (data: z.output<S>, context: AuthContext) => Promise<T>,
): Promise<ActionResult<T>> {
  const result = await executeAction(schema, input, getAuthContext, handler);
  if (result.ok) {
    revalidatePath("/orgs/[organizationId]", "layout");
    revalidatePath("/account");
  }
  return result;
}
