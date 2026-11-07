"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getClientEnv } from "@/lib/env/client";
import { safeRedirectPath } from "@/lib/security/redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signInSchema, signUpSchema } from "@/lib/validation/auth";

export type AuthFormState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[] | undefined> }
  | { status: "success"; message: string };

export async function signInAction(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: "Enter your email and password." };
  }

  const db = await createSupabaseServerClient();
  const { error } = await db.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    // One message for every failure, so responses don't reveal which emails have accounts.
    return { status: "error", message: "Email or password is incorrect, or the email is not confirmed." };
  }

  redirect(safeRedirectPath(parsed.data.next, "/account"));
}

export async function signUpAction(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }

  const db = await createSupabaseServerClient();
  const { data, error } = await db.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${getClientEnv().NEXT_PUBLIC_APP_URL}/auth/confirm`,
      data: { full_name: parsed.data.fullName },
    },
  });

  if (error) {
    // Supabase rejects weak or breached passwords here; other details stay server-side.
    return error.code === "weak_password"
      ? { status: "error", message: "Choose a stronger password." }
      : { status: "error", message: "We couldn't create the account. Please try again." };
  }

  if (data.session) {
    // Email confirmation is disabled in this environment.
    redirect("/account");
  }

  // Same response whether or not the email already had an account.
  return { status: "success", message: "Check your email for a link to confirm your account." };
}

export async function signOutAction(): Promise<void> {
  const db = await createSupabaseServerClient();
  await db.auth.signOut();
  redirect("/sign-in");
}
