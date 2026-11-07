import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import { AppError, fromDatabaseError } from "@/lib/errors";

/**
 * Calls a database function as the signed-in user and validates its result.
 * Database errors are converted to AppErrors; raw error text is not exposed.
 */
export async function callRpc<S extends z.ZodType>(
  db: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
  resultSchema: S,
): Promise<z.output<S>> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    throw fromDatabaseError(error);
  }
  const result = resultSchema.safeParse(data);
  if (!result.success) {
    throw new AppError("unexpected");
  }
  return result.data;
}

/** Throws the AppError equivalent of a query error, if any. */
export function throwIfError(error: { message?: string; code?: string } | null): void {
  if (error) {
    throw fromDatabaseError(error);
  }
}
