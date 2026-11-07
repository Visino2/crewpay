"use client";

import { useState, useTransition } from "react";
import { z } from "zod";

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string; fieldErrors?: Record<string, string[] | undefined> } };

export type FieldErrors = Record<string, string | undefined>;

function firstErrors(errors: Record<string, string[] | undefined> | undefined): FieldErrors {
  return Object.fromEntries(Object.entries(errors ?? {}).map(([key, messages]) => [key, messages?.[0]]));
}

/**
 * Client-side form helper: validates with the same zod schema the server uses
 * (for immediate feedback), then calls the Server Action, which validates and
 * authorizes again. Server errors always win.
 */
export function useActionForm<S extends z.ZodType, T>(
  schema: S,
  action: (input: unknown) => Promise<ActionResult<T>>,
  onSuccess: (data: T) => void,
) {
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Accepts raw form values; the schema (here and on the server) decides validity. */
  function submit(input: Record<string, unknown>) {
    setFormError(null);
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      setFieldErrors(firstErrors(z.flattenError(parsed.error).fieldErrors as Record<string, string[] | undefined>));
      return;
    }
    setFieldErrors({});
    startTransition(async () => {
      // Send the raw input: the server parses it again with the same schema.
      const result = await action(input);
      if (result.ok) {
        onSuccess(result.data);
        return;
      }
      setFieldErrors(firstErrors(result.error.fieldErrors));
      setFormError(result.error.message);
    });
  }

  return { submit, fieldErrors, formError, pending, setFieldErrors, setFormError };
}

/** Reads a form's text fields into a plain object. */
export function formValues(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries(
    [...new FormData(form).entries()].map(([key, value]) => [key, typeof value === "string" ? value : ""]),
  );
}
