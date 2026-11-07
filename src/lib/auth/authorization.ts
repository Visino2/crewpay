import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/lib/errors";
import { throwIfError } from "@/lib/supabase/rpc";
import { orgRoleSchema } from "@/lib/validation/common";

import { PERMISSIONS, type OrgRole, type Permission } from "./permissions";
import type { SessionUser } from "./session";

/** The caller's role in an organization, or null if not a member (RLS-scoped). */
export async function getMemberRole(
  db: SupabaseClient,
  organizationId: string,
  userId: string,
): Promise<OrgRole | null> {
  const { data, error } = await db
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  throwIfError(error);
  return data ? orgRoleSchema.parse(data.role) : null;
}

/**
 * Server-side role check that runs before the database function's own check.
 * Non-members get `not_found` so other organizations' IDs reveal nothing.
 */
export async function requirePermission(
  db: SupabaseClient,
  user: SessionUser,
  organizationId: string,
  permission: Permission,
): Promise<OrgRole> {
  const role = await getMemberRole(db, organizationId, user.id);
  if (!role) {
    throw new AppError("not_found");
  }
  if (!(PERMISSIONS[permission] as readonly OrgRole[]).includes(role)) {
    throw new AppError("not_authorized");
  }
  return role;
}

/**
 * Resolves the organization that owns a record, as visible to the caller.
 * RLS hides other organizations' rows, so a foreign ID becomes `not_found`.
 */
export async function getOwningOrganization(
  db: SupabaseClient,
  table: "contractors" | "pay_runs" | "pay_run_items" | "organization_invitations",
  id: string,
): Promise<string> {
  const { data, error } = await db.from(table).select("organization_id").eq("id", id).maybeSingle();
  throwIfError(error);
  if (!data) {
    throw new AppError("not_found");
  }
  return String(data.organization_id);
}
