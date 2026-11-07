import type { NextRequest } from "next/server";

import { exportOrganizationHistory } from "@/features/pay-runs/export";
import { getAuthContext } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { uuidSchema } from "@/lib/validation/common";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

/** Downloads the organization's pay-run history as CSV (members only). */
export async function GET(_request: NextRequest, context: RouteContext<"/orgs/[organizationId]/history/export">) {
  const { organizationId } = await context.params;

  const auth = await getAuthContext();
  if (!auth) {
    return new Response("Sign in to export history.", { status: 401, headers: PRIVATE_HEADERS });
  }
  if (!uuidSchema.safeParse(organizationId).success) {
    return new Response("Not found.", { status: 404, headers: PRIVATE_HEADERS });
  }

  try {
    const { filename, csv } = await exportOrganizationHistory(auth.db, auth.user, organizationId);
    return new Response(csv, {
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof AppError && (error.code === "not_found" || error.code === "not_authorized")) {
      // Same response for "not a member" and "no permission": nothing to learn.
      return new Response("Not found.", { status: 404, headers: PRIVATE_HEADERS });
    }
    console.error("[export] failed", error instanceof Error ? error.name : typeof error);
    return new Response("Export failed. Please try again.", { status: 500, headers: PRIVATE_HEADERS });
  }
}
