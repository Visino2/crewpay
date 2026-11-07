import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { safeRedirectPath } from "@/lib/security/redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { emailOtpTypeSchema } from "@/lib/validation/auth";

/**
 * Email confirmation link target. Handles both link styles:
 *
 * - `?token_hash=…&type=email` from CrewPay's own template
 *   (supabase/templates/confirmation.html). The token is single-use and
 *   verified here, server-side.
 * - `?code=…` from Supabase's default template, whose link goes through
 *   Supabase's /verify endpoint first. That step has already confirmed the
 *   email; the PKCE code only signs the user in, and works in the browser
 *   that started the sign-up. Hosted projects on the default email provider
 *   cannot use a custom template, so production relies on this path until a
 *   custom SMTP provider is configured.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const code = params.get("code");
  const type = emailOtpTypeSchema.safeParse(params.get("type"));
  const next = safeRedirectPath(params.get("next"), "/account");

  if (tokenHash && tokenHash.length <= 512 && type.success) {
    const db = await createSupabaseServerClient();
    const { error } = await db.auth.verifyOtp({ type: type.data, token_hash: tokenHash });
    if (!error) {
      redirect(next);
    }
  } else if (code && code.length <= 512) {
    const db = await createSupabaseServerClient();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) {
      redirect(next);
    }
    // The email is confirmed; only the automatic sign-in failed (e.g. the
    // link was opened in a different browser). Signing in works normally.
    redirect("/sign-in");
  }

  redirect("/sign-in?error=confirmation_failed");
}
