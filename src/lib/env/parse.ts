import type { z } from "zod";

/**
 * Validates environment variables against a schema. On failure the error
 * names the offending variables only — values are never included, so secrets
 * cannot end up in logs or error reports.
 */
export function parseEnv<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined>,
  scope: "server" | "client",
): z.output<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const names = [
      ...new Set(result.error.issues.map((issue) => issue.path.join("."))),
    ];
    throw new Error(
      `Invalid or missing ${scope} environment variables: ${names.join(", ")}`,
    );
  }
  return result.data;
}
