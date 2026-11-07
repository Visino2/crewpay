import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SessionUser = { id: string; email: string | null };

export type AuthContext = { db: SupabaseClient; user: SessionUser };

const claimsSchema = z.object({
  sub: z.uuid(),
  email: z.string().optional(),
});

/**
 * Returns the signed-in user after verifying the session token (getClaims
 * checks the JWT signature, or asks the Auth server for symmetric keys).
 * Never trust getSession() on the server: it does not verify the token.
 */
export async function getVerifiedUser(db: SupabaseClient): Promise<SessionUser | null> {
  const { data, error } = await db.auth.getClaims();
  if (error || !data) {
    return null;
  }
  const claims = claimsSchema.safeParse(data.claims);
  return claims.success ? { id: claims.data.sub, email: claims.data.email ?? null } : null;
}

/** For Server Actions: null when nobody is signed in. */
export async function getAuthContext(): Promise<AuthContext | null> {
  const db = await createSupabaseServerClient();
  const user = await getVerifiedUser(db);
  return user ? { db, user } : null;
}

/** For protected pages: redirects to sign-in when nobody is signed in. */
export async function requireAuthContext(): Promise<AuthContext> {
  const context = await getAuthContext();
  if (!context) {
    redirect("/sign-in");
  }
  return context;
}
