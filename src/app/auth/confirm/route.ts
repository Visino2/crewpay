import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { safeRedirectPath } from "@/lib/security/redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { emailOtpTypeSchema } from "@/lib/validation/auth";

/**
 * Email confirmation link target. Requires the Supabase email templates to
 * link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
 * (see supabase/templates). The token is single-use and verified server-side.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = emailOtpTypeSchema.safeParse(params.get("type"));
  const next = safeRedirectPath(params.get("next"), "/account");

  if (tokenHash && tokenHash.length <= 512 && type.success) {
    const db = await createSupabaseServerClient();
    const { error } = await db.auth.verifyOtp({ type: type.data, token_hash: tokenHash });
    if (!error) {
      redirect(next);
    }
  }

  redirect("/sign-in?error=confirmation_failed");
}
