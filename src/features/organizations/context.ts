import "server-only";

import { notFound } from "next/navigation";
import { cache } from "react";

import { roleCan, type OrgRole, type Permission } from "@/lib/auth/permissions";
import { requireAuthContext, type AuthContext } from "@/lib/auth/session";
import { uuidSchema } from "@/lib/validation/common";

import { getMembership } from "./data";

export type OrgContext = AuthContext & {
  organization: { id: string; name: string };
  role: OrgRole;
  can: (permission: Permission) => boolean;
};

/**
 * Resolves the signed-in user's membership for an organization in the URL.
 * Invalid IDs and organizations the user does not belong to both render 404,
 * so other tenants' IDs reveal nothing. Cached per request, so the layout and
 * page share one lookup.
 */
export const getOrgContext = cache(async (organizationId: string): Promise<OrgContext> => {
  const auth = await requireAuthContext();
  if (!uuidSchema.safeParse(organizationId).success) {
    notFound();
  }
  const membership = await getMembership(auth.db, organizationId, auth.user.id);
  if (!membership) {
    notFound();
  }
  return {
    ...auth,
    organization: { id: membership.organizationId, name: membership.name },
    role: membership.role,
    can: (permission) => roleCan(membership.role, permission),
  };
});

/** For pages that require a permission; other members get 404 rather than a hint. */
export async function requireOrgPermission(organizationId: string, permission: Permission): Promise<OrgContext> {
  const context = await getOrgContext(organizationId);
  if (!context.can(permission)) {
    notFound();
  }
  return context;
}
